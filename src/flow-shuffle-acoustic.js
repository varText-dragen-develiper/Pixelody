(function flowShuffleAcousticFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffleAcoustic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleAcoustic() {
  'use strict';
  const VERSION = 1;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function normalizeJob(source = {}) { return { version: VERSION, status: ['idle', 'running', 'paused', 'cancelled', 'complete'].includes(source.status) ? source.status : 'idle', nextIndex: Math.max(0, Math.round(Number(source.nextIndex) || 0)), processed: Math.max(0, Math.round(Number(source.processed) || 0)), limit: clamp(Math.round(Number(source.limit) || 120), 1, 500), cancelled: source.cancelled === true }; }
  function analyzePcm(samples, sampleRate = 44100, options = {}) {
    const values = Array.from(samples || []).slice(0, clamp(Math.round(Number(options.maxSamples) || 441000), 1024, 441000));
    if (!values.length) return null;
    let sum = 0; let peak = 0; let crossings = 0; let previous = values[0];
    const bands = Array(8).fill(0);
    values.forEach((raw, index) => { const value = clamp(Number(raw) || 0, -1, 1); sum += value * value; peak = Math.max(peak, Math.abs(value)); if ((value >= 0) !== (previous >= 0)) crossings += 1; previous = value; bands[index % bands.length] += Math.abs(value); });
    const rms = Math.sqrt(sum / values.length); const duration = values.length / Math.max(1, sampleRate); const hz = crossings / Math.max(0.001, duration * 2); const tempo = clamp(Math.round(hz * 60 / 4), 40, 240);
    const embedding = bands.map((value) => Number((value / values.length).toFixed(5)));
    return { version: VERSION, source: 'local-pcm-prototype', analyzedAt: new Date(0).toISOString(), loudnessDb: Number((20 * Math.log10(Math.max(rms, 0.00001))).toFixed(2)), tempo, tempoConfidence: Number(clamp(duration / 10, 0, 1).toFixed(2)), key: 'unknown', dynamics: Number((peak - rms).toFixed(4)), embedding };
  }
  function similarity(left, right) { if (!left?.embedding || !right?.embedding || left.embedding.length !== right.embedding.length) return 0; const distance = left.embedding.reduce((sum, value, index) => sum + Math.abs(Number(value) - Number(right.embedding[index])), 0) / left.embedding.length; return Number(clamp(1 - distance * 4, 0, 1).toFixed(3)); }
  return Object.freeze({ VERSION, analyzePcm, normalizeJob, similarity });
}));
