(function pixelodyContextFolioFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyContextFolio = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createContextFolioApi() {
  'use strict';

  const SECTION_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function createContextFolio(environment = {}) {
    const documentObject = environment.document || (typeof document !== 'undefined' ? document : null);
    let triggerRoot = null;
    let surface = null;
    let closeButton = null;
    let options = {};
    let activeSection = null;
    let returnFocus = null;
    let mounted = false;

    function triggers() { return Array.from(triggerRoot?.querySelectorAll?.('[data-context-folio-section]') || []); }
    function sectionFor(trigger) { return trigger?.dataset?.contextFolioSection || trigger?.getAttribute?.('data-context-folio-section') || ''; }
    function validSection(section) { return typeof section === 'string' && SECTION_PATTERN.test(section); }
    function setTriggerState(section) {
      triggers().forEach((trigger) => {
        const selected = sectionFor(trigger) === section;
        trigger.setAttribute?.('aria-expanded', String(selected));
        if (surface?.id) trigger.setAttribute?.('aria-controls', surface.id);
        if (selected) trigger.setAttribute?.('aria-current', 'page');
        else trigger.removeAttribute?.('aria-current');
      });
    }
    function focusSurface() {
      const target = closeButton || surface?.querySelector?.(FOCUSABLE) || surface;
      target?.focus?.();
    }
    function open(section, trigger = null) {
      if (!mounted) throw new Error('Context Folio must be mounted before opening.');
      if (!validSection(section)) throw new Error(`Invalid Context Folio section "${section}".`);
      const matchingTrigger = trigger || triggers().find((candidate) => sectionFor(candidate) === section) || null;
      if (matchingTrigger) returnFocus = matchingTrigger;
      activeSection = section;
      surface.hidden = false;
      surface.inert = false;
      surface.setAttribute?.('aria-hidden', 'false');
      surface.dataset.contextFolioSection = section;
      setTriggerState(section);
      options.onSectionChange?.(section, { trigger: matchingTrigger, surface });
      options.onOpen?.(section);
      queueMicrotask(focusSurface);
      return true;
    }
    function close(reason = 'dismiss', restoreFocus = true) {
      if (!mounted || !surface) return false;
      const previousSection = activeSection;
      activeSection = null;
      surface.hidden = true;
      surface.inert = true;
      surface.setAttribute?.('aria-hidden', 'true');
      delete surface.dataset.contextFolioSection;
      setTriggerState(null);
      options.onClose?.(previousSection, reason);
      if (restoreFocus) queueMicrotask(() => returnFocus?.focus?.());
      return true;
    }
    function triggerFromTarget(target) { return target?.closest?.('[data-context-folio-section]') || null; }
    function onTriggerClick(event) {
      const trigger = triggerFromTarget(event.target);
      if (!trigger || !triggerRoot.contains?.(trigger)) return;
      const section = sectionFor(trigger);
      if (!validSection(section)) return;
      event.preventDefault?.();
      open(section, trigger);
    }
    function onCloseClick(event) {
      event.preventDefault?.();
      close('close-button', true);
    }
    function onSurfaceKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault?.();
        close('escape', true);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(surface.querySelectorAll?.(FOCUSABLE) || []).filter((node) => !node.hidden && node.getAttribute?.('aria-hidden') !== 'true');
      if (!focusable.length) { event.preventDefault?.(); surface.focus?.(); return; }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && documentObject?.activeElement === first) { event.preventDefault?.(); last.focus?.(); }
      else if (!event.shiftKey && documentObject?.activeElement === last) { event.preventDefault?.(); first.focus?.(); }
    }

    function mount(config = {}) {
      if (mounted) destroy();
      triggerRoot = config.triggerRoot;
      surface = config.surface;
      closeButton = config.closeButton || surface?.querySelector?.('[data-context-folio-close]') || null;
      if (!triggerRoot || !surface || !closeButton) throw new Error('Context Folio requires a trigger root, surface, and close button.');
      options = config;
      if (!surface.id) surface.id = config.id || 'context-folio';
      surface.setAttribute?.('role', 'dialog');
      surface.setAttribute?.('aria-modal', 'true');
      if (!surface.hasAttribute?.('tabindex')) surface.setAttribute?.('tabindex', '-1');
      triggerRoot.addEventListener?.('click', onTriggerClick);
      closeButton.addEventListener?.('click', onCloseClick);
      surface.addEventListener?.('keydown', onSurfaceKeyDown);
      mounted = true;
      close('mount', false);
      return true;
    }

    function destroy() {
      if (!mounted) return;
      triggerRoot?.removeEventListener?.('click', onTriggerClick);
      closeButton?.removeEventListener?.('click', onCloseClick);
      surface?.removeEventListener?.('keydown', onSurfaceKeyDown);
      close('destroy', false);
      triggerRoot = null;
      surface = null;
      closeButton = null;
      options = {};
      activeSection = null;
      returnFocus = null;
      mounted = false;
    }

    return Object.freeze({
      mount,
      open,
      close,
      destroy,
      meta: Object.freeze({ label: 'Context Folio', contractVersion: 1, owns: 'presentation-only' }),
      state: () => Object.freeze({ mounted, activeSection, open: Boolean(activeSection), returnOwner: sectionFor(returnFocus) || null }),
    });
  }

  return Object.freeze({ SECTION_PATTERN, FOCUSABLE, createContextFolio });
}));
