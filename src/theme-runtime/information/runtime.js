(function pixelodyInformationRuntimeFactory(root, factory) {
  const contract = (typeof module === 'object' && module.exports)
    ? require('./contract')
    : root && root.PixelodyInformationContract;
  const registry = (typeof module === 'object' && module.exports)
    ? require('./registry')
    : root && root.PixelodyInformationRegistry;
  const api = factory(contract, registry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyInformationRuntime = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInformationRuntimeApi(contract, registry) {
  'use strict';

  if (!contract || !registry) throw new Error('PixelodyInformationRuntime requires its contract and registry first.');

  function createRuntime(options = {}) {
    const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    const slots = options.slots || contract.DEFAULT_SLOTS;
    let activeProfile = null;
    let roots = [];

    function destroy() {
      roots.forEach((root) => root.remove());
      roots = [];
      activeProfile = null;
    }

    function createRegion(region) {
      const slot = slots[region.slot];
      const target = documentRef?.querySelector(slot.selector);
      if (!target) return null;
      const wrapper = documentRef.createElement('div');
      wrapper.innerHTML = region.markup.trim();
      const element = wrapper.firstElementChild;
      if (!element) return null;
      element.dataset.themeInformationProfile = activeProfile.key;
      element.dataset.themeInformationSlot = region.slot;
      if (slot.placement === 'prepend') target.prepend(element);
      else target.append(element);
      return element;
    }

    function setProfile(profileKey) {
      if (!profileKey) {
        destroy();
        return false;
      }
      const profile = registry.getProfile(profileKey);
      if (!profile) throw new Error(`Information profile "${profileKey}" is not registered.`);
      if (activeProfile?.key === profileKey && roots.length) return false;
      destroy();
      activeProfile = profile;
      roots = profile.regions.map(createRegion).filter(Boolean);
      if (roots.length !== profile.regions.length) {
        // A partial HUD is more misleading than the neutral product fallback.
        // Tear down every region if any product-owned slot is unavailable.
        destroy();
        return false;
      }
      return true;
    }

    function update(snapshot) {
      if (!activeProfile) return null;
      const resolved = registry.resolveBundles(activeProfile.bundles, snapshot);
      const projection = activeProfile.project(resolved, snapshot) || {};
      const fields = projection.fields && typeof projection.fields === 'object' ? projection.fields : projection;
      roots.forEach((root) => {
        for (const [field, value] of Object.entries(fields)) {
          if (!contract.validFieldName(field)) continue;
          root.querySelectorAll(`[data-theme-info-field="${field}"]`).forEach((node) => {
            node.textContent = value == null ? '' : String(value);
          });
        }
        for (const [state, value] of Object.entries(projection.states || {})) {
          if (contract.validFieldName(state)) root.dataset[state] = String(value);
        }
      });
      return projection;
    }

    return Object.freeze({ setProfile, update, destroy, getActiveProfile: () => activeProfile?.key || null, getMountedRoots: () => roots.slice() });
  }

  return Object.freeze({ createRuntime });
}));
