(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyDesktopThemeControls = api;
  if (root?.document) api.installHeaderControls(root.document);
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const layouts = Object.freeze({
    fit: Object.freeze({ size: 'contain', repeat: 'no-repeat' }),
    fill: Object.freeze({ size: 'cover', repeat: 'no-repeat' }),
    stretch: Object.freeze({ size: '100% 100%', repeat: 'no-repeat' }),
    tile: Object.freeze({ size: '256px auto', repeat: 'repeat' }),
  });
  function layoutKey(collectionId, theme, artwork) {
    return JSON.stringify([String(collectionId || 'all'), String(theme || 'studio'), String(artwork || 'theme')]);
  }
  function imageLayout(appearance, collectionId, theme, artwork) {
    const saved = appearance.backgroundImageLayouts?.[layoutKey(collectionId, theme, artwork)];
    return Object.hasOwn(layouts, saved) ? saved : theme === 'cartridge-quest' ? 'fit' : 'fill';
  }
  function saveImageLayout(appearance, collectionId, theme, artwork, value) {
    if (!Object.hasOwn(layouts, value)) return false;
    appearance.backgroundImageLayouts = { ...appearance.backgroundImageLayouts, [layoutKey(collectionId, theme, artwork)]: value };
    return true;
  }
  function installHeaderControls(doc) {
    let scheduled = false;
    function synchronize() {
      scheduled = false;
      const bar = doc.querySelector('.topbar');
      if (!bar) return;
      let actions = bar.querySelector('.desktop-canvas-actions');
      const launchers = [...doc.querySelectorAll('.cw-studio-launcher,.cw-studio-legacy-launcher')];
      if (launchers.length && !actions) {
        actions = doc.createElement('div'); actions.className = 'desktop-canvas-actions';
        actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Canvas controls');
        bar.querySelector('.global-search')?.after(actions);
      }
      for (const launcher of launchers) if (launcher.parentElement !== actions) actions.append(launcher);
      const nav = doc.querySelector('.desktop-panel-navigation');
      if (nav && !nav.closest('.desktop-panel-cabinet')) {
        const cabinet = doc.createElement('details'); cabinet.className = 'desktop-panel-cabinet';
        const summary = doc.createElement('summary'); summary.textContent = 'Panels';
        cabinet.append(summary, nav); (actions || bar.querySelector('.global-search'))?.after(cabinet);
        nav.setAttribute('popover', 'manual');
        cabinet.addEventListener('toggle', () => {
          if (cabinet.open) {
            nav.showPopover();
            const bounds = summary.getBoundingClientRect();
            nav.style.left = `${Math.max(8, Math.min(bounds.right - nav.offsetWidth, doc.defaultView.innerWidth - nav.offsetWidth - 8))}px`;
            nav.style.top = `${bounds.bottom + 6}px`;
          } else if (nav.matches(':popover-open')) nav.hidePopover();
        });
        cabinet.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); cabinet.open = false; summary.focus(); }
        });
        nav.addEventListener('click', event => { if (event.target.closest('button')) cabinet.open = false; });
      }
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true; queueMicrotask(synchronize);
    }
    function start() {
      synchronize();
      // Canvas mounts its controls asynchronously as direct body children.
      new MutationObserver(schedule).observe(doc.body, { childList: true });
      doc.addEventListener('pointerdown', event => {
        const cabinet = doc.querySelector('.desktop-panel-cabinet[open]');
        if (cabinet && !cabinet.contains(event.target)) cabinet.open = false;
      });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
  return Object.freeze({ layouts, layoutKey, imageLayout, saveImageLayout, installHeaderControls });
}));
