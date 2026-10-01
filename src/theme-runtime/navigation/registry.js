(function pixelodyNavigationRegistryFactory(root, factory) {
  const resolvedContract = (typeof module === 'object' && module.exports)
    ? require('./contract')
    : root && root.PixelodyNavigationContract;
  const api = factory(resolvedContract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyNavigationRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNavigationRegistryApi(contract) {
  'use strict';

  if (!contract) throw new Error('PixelodyNavigationRegistry requires PixelodyNavigationContract to be loaded first.');

  // Lowercase kebab-case, same discipline as theme ids in theme.schema.json,
  // so a mechanic key reads the same wherever it shows up (manifest,
  // registry, docs).
  const KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

  const mechanics = new Map();

  // A mechanic is registered exactly once under a stable key. This is what
  // makes it "globally assignable": any theme manifest can reference the key
  // once it exists here, the same way any theme can already reuse a shared
  // CSS file. Re-registering the same key is almost always a copy-paste
  // mistake, so it throws instead of silently overwriting.
  function registerMechanic(key, module, meta = {}) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new Error(`Navigation mechanic key "${key}" must be lowercase kebab-case, 2-40 characters.`);
    }
    if (mechanics.has(key)) {
      throw new Error(`Navigation mechanic "${key}" is already registered. Choose a different key or remove the duplicate registration.`);
    }
    const { valid, errors } = contract.validateMechanic(module);
    if (!valid) {
      throw new Error(`Navigation mechanic "${key}" does not satisfy the contract:\n- ${errors.join('\n- ')}`);
    }
    mechanics.set(key, { key, module, meta: { ...meta } });
    return true;
  }

  function getMechanic(key) {
    const entry = mechanics.get(key);
    return entry ? entry.module : undefined;
  }

  function hasMechanic(key) {
    return mechanics.has(key);
  }

  function listMechanics() {
    return Array.from(mechanics.values()).map(({ key, meta }) => ({ key, meta }));
  }

  // Test-only escape hatch. Production code should never call this -- the
  // registry is meant to be populated once, at startup, from the fixed set
  // of built-in mechanic modules.
  function __resetForTests() {
    mechanics.clear();
  }

  return Object.freeze({
    registerMechanic,
    getMechanic,
    hasMechanic,
    listMechanics,
    __resetForTests,
  });
}));
