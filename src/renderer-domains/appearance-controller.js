(function pixelodyAppearanceControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyAppearanceController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAppearanceControllerApi() {
  'use strict';
  // Theme keys that were renamed before public release. Saved selections and
  // restored backups still carry the old keys, so map them to the new ones.
  const LEGACY_THEME_KEYS = Object.freeze({ marathon: 'bulkhead', 'marathon-modern': 'graphite-loadout' });
  function migrateThemeKey(key) {
    return Object.prototype.hasOwnProperty.call(LEGACY_THEME_KEYS, key) ? LEGACY_THEME_KEYS[key] : key;
  }
  function normalizeAppearance(value, defaults = {}, creatorDefaults = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const result = { ...defaults, ...source, creatorLayer: { ...creatorDefaults, ...(source.creatorLayer || {}) } };
    ['theme', 'palette', 'studioPalette', 'canvasThemePort'].forEach((field) => {
      if (typeof result[field] === 'string') result[field] = migrateThemeKey(result[field]);
    });
    return result;
  }
  function normalizeMotionEffects(value, defaults = {}) { return { ...defaults, ...(value && typeof value === 'object' ? value : {}) }; }
  function normalizeInterfaceSounds(value, defaults = {}) {
    const result = { ...defaults, ...(value && typeof value === 'object' ? value : {}) };
    if (!['off', 'subtle', 'expressive'].includes(result.mode)) result.mode = defaults.mode || 'subtle';
    result.volume = Math.max(0, Math.min(1, Number(result.volume ?? defaults.volume ?? 0.28)));
    return result;
  }
  function hexRgb(hex) { const value = String(hex || '').replace('#', ''); const normalized = value.length === 3 ? value.split('').map((channel) => channel + channel).join('') : value.padEnd(6, '0').slice(0, 6); const number = parseInt(normalized, 16); return [(number >> 16) & 255, (number >> 8) & 255, number & 255]; }
  function mixHex(first, second, amount) { const left = hexRgb(first); const right = hexRgb(second); return `#${left.map((channel, index) => Math.round(channel + (right[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`; }
  function isLightColor(hex = '') {
    const [red, green, blue] = hexRgb(hex);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 150;
  }
  return Object.freeze({ hexRgb, isLightColor, mixHex, migrateThemeKey, normalizeAppearance, normalizeInterfaceSounds, normalizeMotionEffects });
}));
