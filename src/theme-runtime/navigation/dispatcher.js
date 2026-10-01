(function pixelodyNavigationDispatcherFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyNavigationDispatcher = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNavigationDispatcherModule() {
  'use strict';

  // The dispatcher is what makes a mechanic "globally assignable" at
  // runtime: it owns exactly one mounted mechanic for a given container and
  // swaps it (destroy the old, mount the new) when the caller asks for a
  // different registered key. It has no opinion about *where* a desired key
  // comes from -- see docs/themes/THEME_RUNTIME_ARCHITECTURE.md Phase 2 for why
  // that's a small static map in renderer.js today rather than a manifest
  // file read (the running app has no runtime path to *.theme.json yet).
  //
  // registry must satisfy the shape from theme-runtime/navigation/registry.js
  // (hasMechanic/getMechanic); this module doesn't import registry.js
  // directly so it can be unit-tested against a fake registry without
  // pulling in the real one.
  function createNavigationDispatcher(registry, options = {}) {
    if (!registry || typeof registry.hasMechanic !== 'function' || typeof registry.getMechanic !== 'function') {
      throw new Error('createNavigationDispatcher requires a registry with hasMechanic()/getMechanic().');
    }
    const fallbackKey = options.fallbackKey || 'linear-list';

    let container = null;
    let mountOptions = null;
    let currentKey = null;
    let currentMechanic = null;

    function resolveKey(requestedKey) {
      return requestedKey && registry.hasMechanic(requestedKey) ? requestedKey : fallbackKey;
    }

    // First mount for this dispatcher instance. mountOptions is remembered
    // so a later setMechanic() swap can re-mount a different mechanic into
    // the same container with the same callbacks, without the caller
    // having to repeat itself.
    function mount(targetContainer, requestedKey, tracks, mountOpts = {}) {
      if (!registry.hasMechanic(fallbackKey)) {
        throw new Error(`Navigation dispatcher fallback mechanic "${fallbackKey}" is not registered.`);
      }
      container = targetContainer;
      mountOptions = mountOpts;
      currentKey = resolveKey(requestedKey);
      currentMechanic = registry.getMechanic(currentKey);
      currentMechanic.mount(container, tracks, mountOptions);
      return currentKey;
    }

    // Swaps the mounted mechanic if `requestedKey` resolves to something
    // other than what's currently mounted. Returns whether a swap
    // happened. The newly-mounted mechanic starts with an empty track list
    // (matching linear-list.js's own mount() contract of not painting
    // until the next update()) -- callers should follow a swap with
    // update() once they have tracks to paint, exactly like renderer.js's
    // selectTheme() does.
    function setMechanic(requestedKey) {
      if (!container) throw new Error('Navigation dispatcher setMechanic() called before mount().');
      const resolved = resolveKey(requestedKey);
      if (resolved === currentKey) return false;
      currentMechanic?.destroy();
      currentKey = resolved;
      currentMechanic = registry.getMechanic(resolved);
      currentMechanic.mount(container, [], mountOptions);
      return true;
    }

    function update(tracks, activeId, updateOptions = {}) {
      currentMechanic?.update(tracks, activeId, updateOptions);
    }

    function destroy() {
      currentMechanic?.destroy();
      currentMechanic = null;
      currentKey = null;
      container = null;
      mountOptions = null;
    }

    function getCurrentKey() {
      return currentKey;
    }

    return Object.freeze({ mount, setMechanic, update, destroy, getCurrentKey });
  }

  return Object.freeze({ createNavigationDispatcher });
}));
