(function pixelodyVisualizerSignalFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyVisualizerSignal = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSignalApi() {
  'use strict';

  const FRAME_VERSION = 1;
  const DEFAULT_BIN_COUNT = 96;
  const DEFAULT_SAMPLE_COUNT = 192;
  const PRESETS = Object.freeze(['balanced', 'bass', 'percussive', 'ambient', 'stereo']);

  function clamp(value, minimum = 0, maximum = 1, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function normalizeArray(values, length, fallback = 0) {
    const source = values && typeof values.length === 'number' ? values : [];
    const targetLength = Math.max(1, Math.floor(Number(length) || 1));
    const output = new Float32Array(targetLength);
    if (!source.length) {
      output.fill(fallback);
      return output;
    }
    if (source.length === 1) {
      output.fill(clamp(source[0]));
      return output;
    }
    for (let index = 0; index < targetLength; index += 1) {
      const position = index * (source.length - 1) / Math.max(1, targetLength - 1);
      const left = Math.floor(position);
      const right = Math.min(source.length - 1, left + 1);
      const mix = position - left;
      output[index] = clamp(Number(source[left]) * (1 - mix) + Number(source[right]) * mix);
    }
    return output;
  }

  function waveformArray(values, length) {
    const source = values && typeof values.length === 'number' ? values : [];
    if (!source.length) {
      const silence = new Float32Array(Math.max(1, Math.floor(Number(length) || 1)));
      silence.fill(0.5);
      return silence;
    }
    const normalized = new Float32Array(source.length || 1);
    for (let index = 0; index < normalized.length; index += 1) {
      const value = Number(source[index]);
      normalized[index] = clamp(value, -1, 1, 0) * 0.5 + 0.5;
    }
    return normalizeArray(normalized, length, 0.5);
  }

  function average(values, from, to) {
    let total = 0;
    let count = 0;
    for (let index = from; index < Math.min(values.length, to); index += 1) {
      total += values[index];
      count += 1;
    }
    return count ? total / count : 0;
  }

  function deriveBands(spectrum) {
    const length = spectrum.length;
    return Object.freeze({
      sub: average(spectrum, 0, Math.ceil(length * 0.055)),
      bass: average(spectrum, Math.ceil(length * 0.035), Math.ceil(length * 0.16)),
      lowMid: average(spectrum, Math.ceil(length * 0.12), Math.ceil(length * 0.33)),
      mid: average(spectrum, Math.ceil(length * 0.28), Math.ceil(length * 0.58)),
      highMid: average(spectrum, Math.ceil(length * 0.5), Math.ceil(length * 0.78)),
      air: average(spectrum, Math.ceil(length * 0.72), length),
    });
  }

  function deriveRms(waveform) {
    let sum = 0;
    for (let index = 0; index < waveform.length; index += 1) {
      const centered = waveform[index] * 2 - 1;
      sum += centered * centered;
    }
    return clamp(Math.sqrt(sum / Math.max(1, waveform.length)) * 1.6);
  }

  function deriveCentroid(spectrum) {
    let weighted = 0;
    let total = 0;
    for (let index = 0; index < spectrum.length; index += 1) {
      weighted += spectrum[index] * index;
      total += spectrum[index];
    }
    return total ? clamp(weighted / total / Math.max(1, spectrum.length - 1)) : 0;
  }

  function makeSignalFrame(input = {}) {
    const alreadyNormalized = input.version === FRAME_VERSION;
    const spectrum = normalizeArray(input.spectrum, input.binCount || DEFAULT_BIN_COUNT);
    const waveform = alreadyNormalized ? normalizeArray(input.waveform, input.sampleCount || DEFAULT_SAMPLE_COUNT, 0.5) : waveformArray(input.waveform, input.sampleCount || DEFAULT_SAMPLE_COUNT);
    const left = alreadyNormalized ? normalizeArray(input.left || input.waveform, waveform.length, 0.5) : waveformArray(input.left || input.waveform, waveform.length);
    const right = alreadyNormalized ? normalizeArray(input.right || input.waveform, waveform.length, 0.5) : waveformArray(input.right || input.waveform, waveform.length);
    const bands = deriveBands(spectrum);
    const rms = input.rms === undefined ? deriveRms(waveform) : clamp(input.rms);
    const leftRms = deriveRms(left);
    const rightRms = deriveRms(right);
    const stereoWidth = input.stereoWidth === undefined
      ? clamp(average(left.map((value, index) => Math.abs(value - right[index])), 0, left.length) * 3)
      : clamp(input.stereoWidth);
    return Object.freeze({
      version: FRAME_VERSION,
      timestamp: Math.max(0, Number(input.timestamp) || 0),
      spectrum,
      waveform,
      left,
      right,
      bands,
      rms,
      peak: clamp(input.peak === undefined ? Math.max(rms, bands.bass, bands.mid) : input.peak),
      beat: clamp(input.beat),
      flux: clamp(input.flux),
      centroid: input.centroid === undefined ? deriveCentroid(spectrum) : clamp(input.centroid),
      stereoWidth,
      balance: clamp(input.balance === undefined ? (rightRms - leftRms) * 1.5 : input.balance, -1, 1, 0),
      playing: input.playing === true,
    });
  }

  function seededNoise(index, seed) {
    const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function makeDemoFrame(timestamp = 0, preset = 'balanced', seed = 7) {
    const time = Math.max(0, Number(timestamp) || 0) / 1000;
    const selectedPreset = PRESETS.includes(preset) ? preset : 'balanced';
    const profile = {
      balanced: [0.72, 0.62, 0.54, 0.46, 0.34, 0.24],
      bass: [1, 0.92, 0.54, 0.34, 0.2, 0.12],
      percussive: [0.72, 0.7, 0.62, 0.72, 0.6, 0.42],
      ambient: [0.42, 0.5, 0.66, 0.78, 0.58, 0.35],
      stereo: [0.62, 0.58, 0.66, 0.62, 0.48, 0.3],
    }[selectedPreset];
    const spectrum = new Float32Array(DEFAULT_BIN_COUNT);
    const beatPhase = time * (selectedPreset === 'ambient' ? 1.45 : selectedPreset === 'percussive' ? 4.2 : 2.35);
    const beat = Math.pow(Math.max(0, Math.sin(beatPhase * Math.PI)), selectedPreset === 'ambient' ? 2.5 : 7);
    for (let index = 0; index < spectrum.length; index += 1) {
      const position = index / (spectrum.length - 1);
      const bandIndex = Math.min(5, Math.floor(position * 6));
      const comb = 0.5 + 0.28 * Math.sin(index * 0.58 + time * 3.1) + 0.22 * Math.sin(index * 0.17 - time * 1.7);
      const noise = seededNoise(index + Math.floor(time * 8), seed) * 0.13;
      const transient = beat * (1 - position * 0.72) * (selectedPreset === 'percussive' ? 0.5 : 0.28);
      spectrum[index] = clamp(profile[bandIndex] * (0.46 + comb * 0.54) + noise + transient);
    }
    const waveform = new Float32Array(DEFAULT_SAMPLE_COUNT);
    const left = new Float32Array(DEFAULT_SAMPLE_COUNT);
    const right = new Float32Array(DEFAULT_SAMPLE_COUNT);
    const width = selectedPreset === 'stereo' ? 0.9 : selectedPreset === 'ambient' ? 0.62 : 0.38;
    for (let index = 0; index < waveform.length; index += 1) {
      const phase = index / waveform.length * Math.PI * 2;
      const carrier = Math.sin(phase * 2 + time * 4.1) * 0.42 + Math.sin(phase * 5 - time * 2.2) * 0.21 + Math.sin(phase * 11 + time) * 0.08;
      const envelope = 0.54 + beat * 0.38 + (selectedPreset === 'ambient' ? Math.sin(time * 0.7) * 0.12 : 0);
      waveform[index] = clamp(carrier * envelope, -1, 1);
      left[index] = clamp(carrier * envelope + Math.sin(phase * 3 + time * 2.4) * width * 0.18, -1, 1);
      right[index] = clamp(carrier * envelope + Math.sin(phase * 3 + time * 2.4 + width * 1.8) * width * 0.18, -1, 1);
    }
    return makeSignalFrame({ timestamp, spectrum, waveform, left, right, beat, flux: clamp(beat * 0.8 + 0.12), stereoWidth: width, playing: true });
  }

  return Object.freeze({ DEFAULT_BIN_COUNT, DEFAULT_SAMPLE_COUNT, FRAME_VERSION, PRESETS, clamp, makeDemoFrame, makeSignalFrame, normalizeArray });
}));
