(function pixelodyInformationContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyInformationContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInformationContractApi() {
  'use strict';

  const INFORMATION_CONTRACT_VERSION = 1;
  const KEY_PATTERN = /^[a-z][a-z0-9.-]{1,63}$/;
  const FIELD_PATTERN = /^[a-z][a-zA-Z0-9.-]{0,63}$/;

  // Profiles target product-owned slots rather than arbitrary selectors. This
  // keeps layout freedom in the theme layer without letting a profile capture
  // playback controls or move truth ownership into presentation code.
  const DEFAULT_SLOTS = Object.freeze({
    'hero.overlay': Object.freeze({ selector: '#playlistHero', placement: 'prepend' }),
    'hero.content-end': Object.freeze({ selector: '.hero-copy', placement: 'append' }),
    'stage.overlay': Object.freeze({ selector: '.main-stage', placement: 'prepend' }),
    'player.overlay': Object.freeze({ selector: '.player', placement: 'prepend' }),
    'inspector.content-start': Object.freeze({ selector: '#inspectorPanel', placement: 'prepend' }),
  });

  function validateKey(value, label) {
    return typeof value === 'string' && KEY_PATTERN.test(value)
      ? []
      : [`${label} must be a lowercase namespaced key (letters, numbers, dots, or hyphens).`];
  }

  function validateBundle(bundle) {
    const errors = [];
    if (!bundle || typeof bundle !== 'object') return { valid: false, errors: ['Information bundle must be an object.'] };
    errors.push(...validateKey(bundle.key, 'Information bundle key'));
    if (typeof bundle.project !== 'function') errors.push('Information bundle must provide a project(snapshot) function.');
    if (!bundle.owner || typeof bundle.owner !== 'string') errors.push('Information bundle must name its authoritative owner.');
    return { valid: errors.length === 0, errors };
  }

  function validateProfile(profile, slots = DEFAULT_SLOTS) {
    const errors = [];
    if (!profile || typeof profile !== 'object') return { valid: false, errors: ['Information profile must be an object.'] };
    errors.push(...validateKey(profile.key, 'Information profile key'));
    if (!Array.isArray(profile.bundles)) errors.push('Information profile bundles must be an array.');
    else profile.bundles.forEach((key) => errors.push(...validateKey(key, `Bundle reference "${key}"`)));
    if (!Array.isArray(profile.regions) || !profile.regions.length) errors.push('Information profile must declare at least one region.');
    else profile.regions.forEach((region, index) => {
      if (!region || typeof region !== 'object') {
        errors.push(`Region ${index} must be an object.`);
        return;
      }
      if (!slots[region.slot]) errors.push(`Region ${index} references unknown product slot "${region.slot}".`);
      if (typeof region.markup !== 'string' || !region.markup.trim()) errors.push(`Region ${index} must provide static markup.`);
      if (typeof region.markup === 'string' && /<script\b|\son[a-z]+\s*=|javascript:/i.test(region.markup)) {
        errors.push(`Region ${index} contains executable markup, which is not allowed.`);
      }
    });
    if (typeof profile.project !== 'function') errors.push('Information profile must provide a project(bundles, snapshot) function.');
    return { valid: errors.length === 0, errors };
  }

  function validFieldName(value) {
    return typeof value === 'string' && FIELD_PATTERN.test(value);
  }

  return Object.freeze({
    INFORMATION_CONTRACT_VERSION,
    KEY_PATTERN,
    FIELD_PATTERN,
    DEFAULT_SLOTS,
    validateBundle,
    validateProfile,
    validFieldName,
  });
}));
