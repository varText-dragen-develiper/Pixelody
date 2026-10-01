(function pixelodyNavigationContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyNavigationContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNavigationContractApi() {
  'use strict';

  // See theme-runtime/navigation/contract.md for the full explanation. This
  // file is the single source of truth for what a "navigation mechanic"
  // module must implement -- both the registry (registry.js) and any test or
  // lint tooling should check against MECHANIC_CONTRACT_VERSION and
  // validateMechanic() here rather than re-describing the shape elsewhere.
  const MECHANIC_CONTRACT_VERSION = 1;

  const REQUIRED_METHODS = Object.freeze(['mount', 'update', 'destroy']);

  // The "common thread" every mechanic must honor regardless of how
  // different its layout/motion/mechanics are from any other mechanic. This
  // is documentation, not code that can be statically enforced -- it exists
  // as a single array so contract.md, code review checklists, and
  // check:themes-style tooling can quote the same list instead of drifting.
  const COMMON_THREAD_REQUIREMENTS = Object.freeze([
    'Full keyboard operability: arrow/tab traversal, Enter to activate, Escape to back out.',
    'Exactly one active/selected item at all times, with a visible focus or selection indicator.',
    'Fires the same lifecycle callbacks the host provides (onSelect, onActivate, onContextMenu) instead of inventing new ones.',
    'Collapses to a fully static, non-decorative state when the host reports motion-off (mirrors the existing motionDisabled() convention).',
    'Stays legible at narrow window width.',
    'Never touches the mini player -- navigation mechanics are a main-window library/playlist browsing concept only.',
  ]);

  function isFunction(value) {
    return typeof value === 'function';
  }

  // Structural validation only: confirms the required methods exist and are
  // callable-shaped. It cannot verify the COMMON_THREAD_REQUIREMENTS at
  // runtime (those are behavioral) -- that verification happens through the
  // manual pass described in THEME_SYSTEM.md and docs/themes/THEME_RUNTIME_ARCHITECTURE.md.
  function validateMechanic(module) {
    const errors = [];
    if (!module || typeof module !== 'object') {
      return { valid: false, errors: ['Mechanic module must be an object.'] };
    }
    REQUIRED_METHODS.forEach((method) => {
      if (!isFunction(module[method])) errors.push(`Mechanic module is missing a "${method}" function.`);
    });
    if (module.meta !== undefined && (typeof module.meta !== 'object' || module.meta === null)) {
      errors.push('Mechanic module "meta" must be an object when provided.');
    }
    return { valid: errors.length === 0, errors };
  }

  return Object.freeze({
    MECHANIC_CONTRACT_VERSION,
    REQUIRED_METHODS,
    COMMON_THREAD_REQUIREMENTS,
    validateMechanic,
  });
}));
