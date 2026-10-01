(function pixelodyInformationRegistryFactory(root, factory) {
  const contract = (typeof module === 'object' && module.exports)
    ? require('./contract')
    : root && root.PixelodyInformationContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyInformationRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInformationRegistryApi(contract) {
  'use strict';

  if (!contract) throw new Error('PixelodyInformationRegistry requires PixelodyInformationContract first.');
  const bundles = new Map();
  const profiles = new Map();

  function registerBundle(bundle) {
    const { valid, errors } = contract.validateBundle(bundle);
    if (!valid) throw new Error(`Invalid information bundle:\n- ${errors.join('\n- ')}`);
    if (bundles.has(bundle.key)) throw new Error(`Information bundle "${bundle.key}" is already registered.`);
    bundles.set(bundle.key, Object.freeze({ ...bundle }));
    return true;
  }

  function registerProfile(profile) {
    const { valid, errors } = contract.validateProfile(profile);
    if (!valid) throw new Error(`Invalid information profile:\n- ${errors.join('\n- ')}`);
    if (profiles.has(profile.key)) throw new Error(`Information profile "${profile.key}" is already registered.`);
    profiles.set(profile.key, Object.freeze({ ...profile, bundles: Object.freeze(profile.bundles.slice()), regions: Object.freeze(profile.regions.slice()) }));
    return true;
  }

  function hasBundle(key) { return bundles.has(key); }
  function hasProfile(key) { return profiles.has(key); }
  function getProfile(key) { return profiles.get(key); }

  function resolveBundle(key, snapshot) {
    const bundle = bundles.get(key);
    if (!bundle) throw new Error(`Information bundle "${key}" is not registered.`);
    return bundle.project(snapshot || {});
  }

  function resolveBundles(keys, snapshot) {
    return Object.freeze(Object.fromEntries((keys || []).map((key) => [key, resolveBundle(key, snapshot)])));
  }

  function listBundles() {
    return Array.from(bundles.values()).map(({ key, owner, description = '' }) => ({ key, owner, description }));
  }

  function listProfiles() {
    return Array.from(profiles.values()).map(({ key, bundles: profileBundles, regions }) => ({ key, bundles: profileBundles.slice(), slots: regions.map((region) => region.slot) }));
  }

  function __resetForTests() {
    bundles.clear();
    profiles.clear();
  }

  return Object.freeze({
    registerBundle,
    registerProfile,
    hasBundle,
    hasProfile,
    getProfile,
    resolveBundle,
    resolveBundles,
    listBundles,
    listProfiles,
    __resetForTests,
  });
}));
