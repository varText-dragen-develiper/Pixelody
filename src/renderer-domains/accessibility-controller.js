(function pixelodyAccessibilityFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyAccessibility = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAccessibilityApi() {
  'use strict';
  const STORAGE_KEY = 'pixelody.accessibility';
  const TEXT_SCALES = Object.freeze([1, 1.15, 1.3, 1.5]);
  const CONTRAST_MODES = Object.freeze(['auto', 'standard', 'high']);
  const defaults = Object.freeze({ textScale: 1, contrast: 'auto' });

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const requested = Number(source.textScale);
    const textScale = TEXT_SCALES.includes(requested) ? requested : defaults.textScale;
    const contrast = CONTRAST_MODES.includes(source.contrast) ? source.contrast : defaults.contrast;
    return { textScale, contrast };
  }

  // "auto" follows the operating system: Windows contrast themes report
  // forced-colors, and a "more contrast" preference reports prefers-contrast.
  function resolveContrast(settings, os = {}) {
    if (settings.contrast === 'high') return 'high';
    if (settings.contrast === 'standard') return 'standard';
    return os.forcedColors || os.prefersMore ? 'high' : 'standard';
  }

  function readSettings(storage) {
    try { return normalizeSettings(JSON.parse(storage.getItem(STORAGE_KEY))); } catch { return { ...defaults }; }
  }
  function writeSettings(storage, settings) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings))); return true; } catch { return false; }
  }

  function createAccessibilityController({ storage, setTextScale, applyContrast, os = () => ({}) }) {
    let settings = readSettings(storage);
    // Zoom is only pushed to the main process when the user changed it or a
    // non-default size was saved. A default launch must leave the window zoom
    // alone so it never overrides other zoom owners (tests, dev zoom flags).
    const apply = ({ zoom = settings.textScale !== 1 } = {}) => {
      try { applyContrast(resolveContrast(settings, os()), settings); } catch { /* presentation only */ }
      if (!zoom) return;
      try { Promise.resolve(setTextScale(settings.textScale)).catch(() => {}); } catch { /* main-process zoom unavailable */ }
    };
    return Object.freeze({
      current: () => ({ ...settings }),
      apply,
      update(patch) { settings = normalizeSettings({ ...settings, ...patch }); writeSettings(storage, settings); apply({ zoom: true }); return { ...settings }; },
      reset() { settings = { ...defaults }; writeSettings(storage, settings); apply({ zoom: true }); return { ...settings }; },
    });
  }

  return Object.freeze({ CONTRAST_MODES, STORAGE_KEY, TEXT_SCALES, createAccessibilityController, defaults, normalizeSettings, readSettings, resolveContrast });
}));
