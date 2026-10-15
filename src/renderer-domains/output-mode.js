(function pixelodyOutputModeFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyOutputMode = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createOutputModeApi() {
  'use strict';
  // Pixelody plays through Chromium's Web Audio / media element, which on
  // Windows opens the endpoint in WASAPI *shared* mode: the Windows mixer sits
  // between Pixelody and the DAC and runs at the device's configured format.
  // Pixelody never requests exclusive mode, so this indicator reports what it
  // can honestly know and says plainly what it cannot.
  const khz = (hertz) => `${(hertz / 1000).toFixed(hertz % 1000 === 0 ? 0 : 1)} kHz`;

  function describeOutputMode({ platform = '', contextSampleRate = 0, trackSampleRate = 0, nativePlayback = false, activeLabel = '' } = {}) {
    const windows = platform === 'win32' || platform === 'windows';
    const resampled = contextSampleRate > 0 && trackSampleRate > 0 && Math.round(contextSampleRate) !== Math.round(trackSampleRate);
    if (nativePlayback) {
      return { mode: 'native', label: 'Native output', detail: 'A native output path is active. Check the helper readout for its exact mode.', exclusive: false, resampled: false, bitPerfect: false };
    }
    const label = windows ? 'Shared mode' : 'System mixer';
    let detail = windows
      ? 'Windows mixes Pixelody with other apps at the device format. Pixelody does not use exclusive mode.'
      : 'The operating system mixer handles output. Pixelody does not use exclusive mode.';
    if (resampled) detail += ` This track is ${khz(trackSampleRate)} and the engine runs at ${khz(contextSampleRate)}, so it is resampled.`;
    else if (contextSampleRate > 0 && trackSampleRate > 0) detail += ' The sample rate matches the engine, but the system mixer can still change the format.';
    detail += ' Not bit-perfect.';
    if (activeLabel) detail = `${activeLabel}: ${detail}`;
    return { mode: 'shared', label, detail, exclusive: false, resampled, bitPerfect: false };
  }

  return Object.freeze({ describeOutputMode });
}));
