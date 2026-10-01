(function pixelodyCanvasModuleEffectsFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCanvasModuleEffects = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasModuleEffectsApi() {
  'use strict';

  // Visual behavior is stored as ordinary bounded module configuration, but
  // only these authored primitives are accepted. Canvas Studio never persists
  // arbitrary CSS, selectors, URLs, keyframes, or executable snippets.
  const OPTIONS = Object.freeze({
    animation: Object.freeze(['none', 'breathe', 'float', 'pulse', 'scan', 'jitter']),
    particles: Object.freeze(['none', 'pixels', 'sparks', 'stars', 'dust']),
    trigger: Object.freeze(['always', 'playback', 'interaction']),
    intensity: Object.freeze(['subtle', 'standard', 'vivid']),
    speed: Object.freeze(['slow', 'normal', 'fast']),
  });
  const DEFAULTS = Object.freeze({ animation: 'none', particles: 'none', trigger: 'interaction', intensity: 'subtle', speed: 'normal' });

  function plain(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function choice(key, value) {
    return OPTIONS[key].includes(value) ? value : DEFAULTS[key];
  }

  function normalize(value) {
    const source = plain(value) ? value : {};
    return Object.freeze({
      animation: choice('animation', source.animation),
      particles: choice('particles', source.particles),
      trigger: choice('trigger', source.trigger),
      intensity: choice('intensity', source.intensity),
      speed: choice('speed', source.speed),
    });
  }

  function fromConfiguration(configuration) {
    return normalize(plain(configuration) ? configuration.effects : null);
  }

  function mergeConfiguration(configuration, patch) {
    const base = plain(configuration) ? JSON.parse(JSON.stringify(configuration)) : {};
    base.effects = normalize({ ...fromConfiguration(base), ...(plain(patch) ? patch : {}) });
    return base;
  }

  return Object.freeze({ OPTIONS, DEFAULTS, normalize, fromConfiguration, mergeConfiguration });
}));
