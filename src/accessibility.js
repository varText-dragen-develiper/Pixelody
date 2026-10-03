// Binds the accessibility controls in Settings > Style & color. Self-contained
// on purpose: it owns its own storage key and DOM, so renderer.js stays out of
// it. Text scale is the window zoom (main process); contrast is a data
// attribute that src/accessibility.css reads.
(function bindAccessibility() {
  'use strict';
  const api = window.PixelodyAccessibility;
  if (!api) return;
  const queryOS = () => ({
    forcedColors: window.matchMedia('(forced-colors: active)').matches,
    prefersMore: window.matchMedia('(prefers-contrast: more)').matches,
  });
  const controller = api.createAccessibilityController({
    storage: window.localStorage,
    os: queryOS,
    setTextScale: (factor) => (window.desktop?.setTextScale ? window.desktop.setTextScale(factor) : Promise.resolve()),
    applyContrast: (resolved, settings) => {
      document.documentElement.dataset.contrast = resolved;
      document.documentElement.dataset.contrastSetting = settings.contrast;
    },
  });
  const sync = () => {
    const settings = controller.current();
    document.querySelectorAll('#textScaleSetting [data-text-scale]').forEach((button) => {
      const active = Number(button.dataset.textScale) === settings.textScale;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('#contrastSetting [data-contrast-mode]').forEach((button) => {
      const active = button.dataset.contrastMode === settings.contrast;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const note = document.getElementById('contrastOsNote');
    if (note) note.classList.toggle('hidden', !(settings.contrast === 'auto' && (queryOS().forcedColors || queryOS().prefersMore)));
  };
  const bind = () => {
    document.querySelectorAll('#textScaleSetting [data-text-scale]').forEach((button) => {
      button.addEventListener('click', () => { controller.update({ textScale: Number(button.dataset.textScale) }); sync(); });
    });
    document.querySelectorAll('#contrastSetting [data-contrast-mode]').forEach((button) => {
      button.addEventListener('click', () => { controller.update({ contrast: button.dataset.contrastMode }); sync(); });
    });
    document.getElementById('resetAccessibility')?.addEventListener('click', () => { controller.reset(); sync(); });
    ['(forced-colors: active)', '(prefers-contrast: more)'].forEach((query) => window.matchMedia(query).addEventListener?.('change', () => { controller.apply(); sync(); }));
    controller.apply();
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
}());
