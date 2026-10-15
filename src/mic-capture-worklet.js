class PixelodyMicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const requestedFrames = Number(options.processorOptions?.capacityFrames) || sampleRate * 6;
    this.capacityFrames = Math.max(1024, Math.min(Math.round(requestedFrames), Math.round(sampleRate * 20)));
    this.samples = new Float32Array(this.capacityFrames);
    this.writeIndex = 0;
    this.totalFrames = 0;
    this.firstFrame = null;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'snapshot') this.postSnapshot(event.data.requestId);
      if (event.data?.type === 'reset') this.reset();
    };
  }

  reset() {
    this.samples.fill(0);
    this.writeIndex = 0;
    this.totalFrames = 0;
    this.firstFrame = null;
  }

  postSnapshot(requestId) {
    const frameCount = Math.min(this.totalFrames, this.capacityFrames);
    const copy = new Float32Array(frameCount);
    if (frameCount) {
      const startIndex = this.totalFrames <= this.capacityFrames ? 0 : this.writeIndex;
      const firstLength = Math.min(frameCount, this.capacityFrames - startIndex);
      copy.set(this.samples.subarray(startIndex, startIndex + firstLength), 0);
      if (firstLength < frameCount) copy.set(this.samples.subarray(0, frameCount - firstLength), firstLength);
    }
    const startFrame = this.firstFrame === null
      ? currentFrame
      : this.totalFrames <= this.capacityFrames
        ? this.firstFrame
        : currentFrame - frameCount;
    this.port.postMessage({
      type: 'snapshot',
      requestId,
      startFrame,
      endFrame: currentFrame,
      sampleRate,
      frameCount,
      samples: copy.buffer,
    }, [copy.buffer]);
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    if (this.firstFrame === null) this.firstFrame = currentFrame;
    for (let index = 0; index < input.length; index += 1) {
      this.samples[this.writeIndex] = input[index];
      this.writeIndex = (this.writeIndex + 1) % this.capacityFrames;
    }
    this.totalFrames += input.length;
    return true;
  }
}

registerProcessor('pixelody-mic-capture', PixelodyMicCaptureProcessor);
