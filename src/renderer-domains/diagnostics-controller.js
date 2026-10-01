(function pixelodyDiagnosticsControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyDiagnosticsController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDiagnosticsControllerApi() {
  'use strict';
  const numericSamples = (values = []) => values.map(Number).filter(Number.isFinite);
  function average(values = []) { const samples = numericSamples(values); return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null; }
  function standardDeviation(values = []) { const samples = numericSamples(values); if (samples.length < 2) return 0; const mean = average(samples); return Math.sqrt(samples.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / samples.length); }
  function median(values = []) { const samples = numericSamples(values).sort((left, right) => left - right); if (!samples.length) return null; const middle = Math.floor(samples.length / 2); return samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2; }
  function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'; return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  function gainRisk(contextActive, peakDb, headroomDb) {
    if (!contextActive) return { label: 'Idle', detail: 'No active graph' };
    if (peakDb >= 10 || headroomDb >= 14) return { label: 'High', detail: `${headroomDb.toFixed(1)} dB headroom cut` };
    if (peakDb >= 6 || headroomDb >= 8) return { label: 'Watch', detail: `${headroomDb.toFixed(1)} dB headroom cut` };
    return { label: 'Safe', detail: `${headroomDb.toFixed(1)} dB headroom cut` };
  }
  function createDiagnosticsController(options = {}) {
    if (typeof options.buildSnapshot !== 'function' || typeof options.renderSnapshot !== 'function') throw new Error('Diagnostics controller requires snapshot and render adapters.');
    let lastSnapshot = null;
    const snapshot = () => { lastSnapshot = options.buildSnapshot(); return lastSnapshot; };
    const render = () => { const value = snapshot(); options.renderSnapshot(value); return value; };
    const current = () => lastSnapshot;
    return Object.freeze({ current, render, snapshot });
  }
  return Object.freeze({ average, createDiagnosticsController, formatBytes, gainRisk, median, numericSamples, standardDeviation });
}));
