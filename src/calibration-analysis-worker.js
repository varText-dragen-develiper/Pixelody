/* global importScripts, self */
'use strict';

// Capture stays on the renderer thread; the expensive deconvolution and
// first-arrival extraction intentionally do not. calibration-dsp.js is loaded
// unchanged so this worker and the node audit execute the same DSP.
importScripts('calibration-dsp.js');

const dsp = self.PixelodyCalibrationDsp;

function rangeStats(samples, startIndex, endIndex) {
  const start = Math.max(0, Math.floor(startIndex));
  const end = Math.min(samples.length, Math.ceil(endIndex));
  let sum = 0;
  let peak = 0;
  let clippedFrames = 0;
  for (let index = start; index < end; index += 1) {
    const value = samples[index] || 0;
    const absolute = Math.abs(value);
    sum += value * value;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.995) clippedFrames += 1;
  }
  const frameCount = Math.max(0, end - start);
  return { frameCount, rms: Math.sqrt(sum / Math.max(1, frameCount)), peak, clippedFrames };
}

function peakToSidelobeDb(impulseResponse, arrivalIndex, sampleRate) {
  const envelope = dsp.analyticEnvelope(impulseResponse);
  const exclusion = Math.round(sampleRate * 0.004);
  const direct = Math.max(envelope[arrivalIndex] || 0, 1e-30);
  let sideLobe = 1e-30;
  for (let index = 0; index < envelope.length; index += 1) {
    if (Math.abs(index - arrivalIndex) > exclusion) sideLobe = Math.max(sideLobe, envelope[index]);
  }
  return 20 * Math.log10(direct / sideLobe);
}

function analyse(payload) {
  const samples = new Float32Array(payload.samples);
  const sampleRate = Number(payload.sampleRate);
  const noiseRms = Math.max(Number(payload.noiseRms) || 0, 1e-12);
  const sweep = dsp.makeSweep({ durationSeconds: 4, sampleRate });
  const preFrames = Math.round(sampleRate * 0.12);
  const tailFrames = Math.round(sampleRate * 0.8);
  // Deconvolving with the inverse filter places the impulse (sweepLength - 1)
  // samples after the point where the sweep actually began, because the inverse
  // filter is the time-reversed sweep and the convolution runs its full length.
  // That constant has to come back off, or every reported latency is inflated by
  // the whole sweep duration - roughly 4000 ms here. Relative delays between two
  // members survive it, because it is common-mode, which is exactly why it can
  // sit in a build looking plausible.
  const deconvolutionOffset = sweep.sweep.length - 1;
  const trials = payload.trials.map((trial) => {
    const expectedIndex = Math.round((trial.captureTime - payload.captureStartTime) * sampleRate);
    const startIndex = Math.max(0, expectedIndex - preFrames);
    const endIndex = Math.min(samples.length, expectedIndex + sweep.sweep.length + tailFrames);
    const recording = Float64Array.from(samples.subarray(startIndex, endIndex));
    // This response remains anchored to capture index startIndex. We return the
    // arrival as an absolute capture index; no member response is re-zeroed.
    const impulseResponse = dsp.deconvolve(recording, sweep.inverse);
    const measurement = dsp.measureMember(impulseResponse, { sampleRate });
    const arrivalIndex = startIndex + measurement.index - deconvolutionOffset;
    const signal = rangeStats(samples, expectedIndex, expectedIndex + sweep.sweep.length);
    const signalToNoiseDb = 20 * Math.log10(Math.max(signal.rms, 1e-12) / noiseRms);
    const sidelobeDb = peakToSidelobeDb(impulseResponse, measurement.index, sampleRate);
    const reflectionDominant = measurement.reflectionDominant === true;
    const usable = signal.clippedFrames === 0 && signalToNoiseDb >= 12 && sidelobeDb >= 6 && !reflectionDominant;
    // Diagnose from most fundamental to most subtle. Signal-to-noise is checked
    // before placement because placement confidence is meaningless without a
    // signal: a silent or buried capture makes the arrival detector latch onto
    // noise, which reads as reflection-dominant and would tell the user to move
    // the microphone when the actual problem is that nothing was playing.
    let reason = '';
    if (signal.clippedFrames) reason = 'captured-clipping';
    else if (signalToNoiseDb < 12) reason = 'low-capture-snr';
    else if (reflectionDominant) reason = 'reflection-dominant-placement';
    else if (sidelobeDb < 6) reason = 'low-peak-to-sidelobe';
    return {
      ...trial,
      usable,
      reason,
      detectedTime: payload.captureStartTime + arrivalIndex / sampleRate,
      arrivalIndex,
      latencyMs: Number(((arrivalIndex - expectedIndex) / sampleRate * 1000).toFixed(4)),
      peakToSidelobeDb: Number(sidelobeDb.toFixed(2)),
      signalToNoiseDb: Number(signalToNoiseDb.toFixed(2)),
      placementConfidenceDb: measurement.confidenceDb,
      reflectionDominant,
      polarity: measurement.polarity < 0 ? 'inverted' : 'normal',
      usableBandHz: [measurement.band.lowHz, measurement.band.highHz],
      rms: Number(signal.rms.toFixed(6)),
      peak: Number(signal.peak.toFixed(6)),
      clippedFrames: signal.clippedFrames,
    };
  });
  return { trials, analysisMs: Number((performance.now() - payload.startedAt).toFixed(1)), sweepDurationSeconds: 4 };
}

self.onmessage = (event) => {
  try {
    const result = analyse(event.data);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) });
  }
};
