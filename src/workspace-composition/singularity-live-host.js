(function pixelodySingularityLiveHostFactory(root, factory) {
  const contract = typeof module === 'object' && module.exports ? require('./singularity-contract') : root.PixelodySingularityContract;
  const profile = typeof module === 'object' && module.exports ? require('./singularity-profile') : root.PixelodySingularityProfile;
  const panelModel = typeof module === 'object' && module.exports ? require('./singularity-panel-model') : root.PixelodySingularityPanelModel;
  const proxyProbe = typeof module === 'object' && module.exports ? require('./singularity-proxy-portal-probe') : root.PixelodySingularityProxyPortalProbe;
  const graphProbe = typeof module === 'object' && module.exports ? require('./singularity-graph-projection-probe') : root.PixelodySingularityGraphProjectionProbe;
  const api = factory(contract, profile, panelModel, proxyProbe, graphProbe);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySingularityLiveHost = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSingularityLiveHostApi(contract, profile, panelModel, proxyProbe, graphProbe) {
  'use strict';

  if (!contract || !profile || !panelModel || !proxyProbe || !graphProbe) throw new Error('Singularity live host requires both probes and the dedicated gravitational profile/model.');

  const MODES = Object.freeze(['proxy', 'graph']);
  const ROOT_SELECTORS = profile.rootSelectors();
  const LABELS = Object.freeze(Object.fromEntries(profile.PANELS.map((panel) => [panel.id, panel.label])));

  function createHost(options = {}) {
    const documentObject = options.document;
    if (!documentObject) throw new Error('Singularity live host requires a document.');
    const windowObject = documentObject.defaultView || globalThis;
    const originalLocations = new Map();
    const roots = new Map();
    const shellElements = new Map();
    const planeElements = new Map();
    const mountElements = new Map();
    const gateElements = new Map();
    const temporaryFocusTargets = new Set();
    let host = null;
    let center = null;
    let seam = null;
    let playbackStatus = null;
    let portal = null;
    let portalMount = null;
    let closeButton = null;
    let status = null;
    let mode = '';
    let presentation = contract.initialPresentationState();
    let resizeObserver = null;
    let resizeRenderTimer = 0;
    let lastRenderedViewportTier = '';
    let keyListener = null;

    function scheduleResizeRender() {
      if (!host) return;
      const nextTier = contract.viewport(currentViewport()).tier;
      const schedule = windowObject.setTimeout?.bind(windowObject) || setTimeout;
      const cancel = windowObject.clearTimeout?.bind(windowObject) || clearTimeout;
      if (nextTier !== lastRenderedViewportTier) {
        if (resizeRenderTimer) cancel(resizeRenderTimer);
        resizeRenderTimer = 0;
        render();
        return;
      }
      if (resizeRenderTimer) cancel(resizeRenderTimer);
      resizeRenderTimer = schedule(() => {
        resizeRenderTimer = 0;
        if (!host) return;
        render();
      }, 120);
    }

    function rememberRoot(id) {
      const selector = ROOT_SELECTORS[id];
      const element = selector ? documentObject.querySelector(selector) : null;
      if (!element) return null;
      if (!originalLocations.has(element)) {
        originalLocations.set(element, Object.freeze({
          parent: element.parentNode,
          nextSibling: element.nextSibling,
          hidden: element.hidden,
          inert: element.inert,
          ariaHidden: element.getAttribute('aria-hidden'),
          tabIndex: element.getAttribute('tabindex'),
          style: element.getAttribute('style'),
        }));
      }
      roots.set(id, element);
      return element;
    }

    function restoreElement(element) {
      const original = originalLocations.get(element);
      if (!original?.parent) return;
      if (original.nextSibling?.parentNode === original.parent) original.parent.insertBefore(element, original.nextSibling);
      else original.parent.appendChild(element);
      element.hidden = original.hidden;
      element.inert = original.inert;
      if (original.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', original.ariaHidden);
      if (original.tabIndex === null) element.removeAttribute('tabindex');
      else element.setAttribute('tabindex', original.tabIndex);
      if (original.style === null) element.removeAttribute('style');
      else element.setAttribute('style', original.style);
      element.removeAttribute('data-singularity-product-state');
      temporaryFocusTargets.delete(element);
    }

    function restoreAllRoots() {
      [...originalLocations.keys()].forEach(restoreElement);
      roots.clear();
      originalLocations.clear();
    }

    function createElement(tag, className, text = '') {
      const element = documentObject.createElement(tag);
      element.className = className;
      if (text) element.textContent = text;
      return element;
    }

    function buildHost() {
      host = createElement('section', 'sg-live-host');
      host.setAttribute('aria-label', `Singularity ${mode} development probe`);
      host.dataset.probeMode = mode;
      host.dataset.profileId = profile.PROFILE_ID;
      host.dataset.panelModel = panelModel.MODEL_ID;
      center = createElement('div', 'sg-center');
      center.setAttribute('aria-hidden', 'true');
      seam = createElement('div', 'sg-confirmed-seam');
      seam.setAttribute('aria-hidden', 'true');
      playbackStatus = createElement('p', 'sg-playback-status');
      playbackStatus.setAttribute('role', 'status');
      playbackStatus.setAttribute('aria-live', 'polite');
      playbackStatus.setAttribute('aria-atomic', 'true');
      portal = createElement('section', 'sg-portal');
      portal.id = 'sg-product-portal';
      portal.setAttribute('aria-label', 'Released product surface');
      portal.hidden = true;
      portalMount = createElement('div', 'sg-product-mount');
      closeButton = createElement('button', 'sg-close', 'Return to field');
      closeButton.type = 'button';
      closeButton.hidden = true;
      closeButton.addEventListener('click', closeActive);
      portal.append(portalMount);

      profile.PANEL_IDS.forEach((id) => {
        const shell = createElement('div', 'sg-shell');
        shell.dataset.moduleId = id;
        shell.id = `sg-shell-${id}`;
        shell.setAttribute('aria-hidden', 'true');
        const plane = createElement('div', 'sg-gravity-plane');
        plane.dataset.moduleId = id;
        const mount = createElement('div', 'sg-shell-mount');
        plane.appendChild(mount);
        shell.appendChild(plane);
        shellElements.set(id, shell);
        planeElements.set(id, plane);
        mountElements.set(id, mount);
        const gate = createElement('button', 'sg-gate');
        gate.type = 'button';
        gate.dataset.moduleId = id;
        const panel = profile.panel(id);
        const available = panel?.available === true;
        const gateDetail = available
          ? mode === 'graph' ? 'R2 WHOLE PANEL / HOVER TO RECTIFY' : 'FOCUS TO RELEASE'
          : `FOUNDATION GAP / ${String(panel?.gap || 'PRODUCT ROOT').replaceAll('-', ' ').toUpperCase()}`;
        gate.innerHTML = `<span>${LABELS[id]}</span><small>${gateDetail}</small>`;
        gate.disabled = !available;
        gate.setAttribute('aria-pressed', 'false');
        gate.setAttribute('aria-expanded', 'false');
        gate.setAttribute('aria-controls', mode === 'proxy' ? portal.id : shell.id);
        gate.addEventListener('pointerenter', () => preview(id, 'pointer'));
        gate.addEventListener('pointerleave', () => clearPreview(id));
        gate.addEventListener('focus', () => preview(id, 'focus'));
        gate.addEventListener('blur', () => clearPreview(id));
        gate.addEventListener('click', () => open(id, gate));
        shell.addEventListener('pointerenter', () => {
          if (mode === 'graph') preview(id, 'pointer');
        });
        shell.addEventListener('pointerleave', () => {
          if (mode === 'graph') clearPreview(id);
        });
        shell.addEventListener('click', () => {
          if (mode === 'graph' && !presentation.openId) open(id, gate);
        });
        gateElements.set(id, gate);
        host.append(shell, gate);
      });

      status = createElement('p', 'sg-status');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      host.append(center, seam, playbackStatus, portal, closeButton, status);
      const player = documentObject.querySelector('.player');
      if (player) documentObject.body.insertBefore(host, player);
      else documentObject.body.appendChild(host);
    }

    function currentViewport() {
      return { width: windowObject.innerWidth || 1440, height: windowObject.innerHeight || 920 };
    }

    function setBox(element, rect) {
      if (!element || !rect) return;
      element.style.left = `${rect.x}px`;
      element.style.top = `${rect.y}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
    }

    function polygonCentroid(points) {
      const sum = points.reduce((value, point) => ({ x: value.x + point[0], y: value.y + point[1] }), { x: 0, y: 0 });
      return { x: sum.x / points.length, y: sum.y / points.length };
    }

    function placeGate(id, polygon, frame) {
      const gate = gateElements.get(id);
      const point = polygonCentroid(polygon);
      const width = frame.tier === 'compact' ? 124 : 150;
      gate.style.left = `${Math.round(point.x - (width / 2))}px`;
      gate.style.top = `${Math.round(point.y - 22)}px`;
      gate.style.width = `${width}px`;
    }

    function setRootState(element, visible, interactive, projectionState) {
      if (!element) return;
      element.hidden = !visible;
      element.inert = !interactive;
      element.setAttribute('aria-hidden', String(!interactive));
      element.dataset.singularityProductState = projectionState || (interactive ? 'active' : 'dormant');
    }

    function normalizeGraphRoot(element) {
      if (!element?.style?.setProperty) return;
      const properties = {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        'min-width': '0',
        'max-width': 'none',
        'min-height': '0',
        'max-height': 'none',
        margin: '0',
        transform: 'none',
        'clip-path': 'none',
        overflow: 'auto',
      };
      Object.entries(properties).forEach(([name, value]) => element.style.setProperty(name, value, 'important'));
    }

    function visibleFocusEntry(rootElement) {
      const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [href]';
      const candidates = [
        ...(rootElement.matches?.(selector) ? [rootElement] : []),
        ...(rootElement.querySelectorAll?.(selector) || []),
      ];
      const entry = candidates.find((candidate) => {
        if (candidate.hidden || candidate.disabled || candidate.inert || candidate.getAttribute?.('aria-hidden') === 'true') return false;
        return typeof candidate.getClientRects !== 'function' || candidate.getClientRects().length > 0;
      });
      if (entry) return entry;
      if (rootElement.getAttribute('tabindex') === null) {
        rootElement.setAttribute('tabindex', '-1');
        temporaryFocusTargets.add(rootElement);
      }
      return rootElement;
    }

    function restoreTemporaryFocusTarget(rootElement) {
      if (!rootElement || !temporaryFocusTargets.has(rootElement)) return;
      const original = originalLocations.get(rootElement);
      if (original?.tabIndex === null) rootElement.removeAttribute('tabindex');
      else if (original) rootElement.setAttribute('tabindex', original.tabIndex);
      temporaryFocusTargets.delete(rootElement);
    }

    function graphMountRoots() {
      Object.keys(ROOT_SELECTORS).forEach((id) => {
        const rootElement = rememberRoot(id);
        const mount = mountElements.get(id);
        if (rootElement && mount && rootElement.parentNode !== mount) mount.appendChild(rootElement);
        normalizeGraphRoot(rootElement);
      });
    }

    function proxyRestoreBorrowedRoot() {
      const borrowed = portalMount?.firstElementChild;
      if (borrowed && originalLocations.has(borrowed)) restoreElement(borrowed);
    }

    function playbackState() {
      const value = options.readPlayback?.() || {};
      return Object.freeze({
        selectedId: String(value.selectedId || ''),
        requestedId: String(value.requestedId || ''),
        confirmedId: String(value.confirmedId || ''),
        paused: value.paused !== false,
        failedRequestId: String(value.failedRequestId || ''),
      });
    }

    function paintPlayback() {
      if (!host) return;
      const state = contract.seamState(playbackState());
      host.dataset.playbackPhase = state.phase;
      center.dataset.playbackPhase = state.phase;
      seam.hidden = !state.visible;
      seam.dataset.phase = state.phase;
      playbackStatus.dataset.phase = state.phase;
      playbackStatus.textContent = state.phase === 'confirmed'
        ? 'PLAYING CONFIRMED'
        : state.phase === 'paused'
          ? 'CURRENT / PAUSED'
          : state.phase === 'requested'
            ? 'REQUESTED / OUTPUT UNCHANGED'
            : state.phase === 'failed'
              ? state.confirmedId ? 'REQUEST FAILED / CURRENT RETAINED' : 'REQUEST FAILED / NO OUTPUT'
              : 'OUTPUT IDLE';
    }

    function render() {
      if (!host) return;
      const input = { viewport: currentViewport(), presentation, playback: playbackState() };
      const snapshot = mode === 'graph' ? graphProbe.snapshot(input) : proxyProbe.snapshot(input);
      const frame = snapshot.frame;
      lastRenderedViewportTier = frame.tier;
      host.dataset.viewportTier = frame.tier;
      host.dataset.openModule = presentation.openId || '';
      host.dataset.previewModule = presentation.previewId || '';
      center.style.left = `${frame.center.x - frame.center.radius}px`;
      center.style.top = `${frame.center.y - frame.center.radius}px`;
      center.style.width = `${frame.center.radius * 2}px`;
      center.style.height = `${frame.center.radius * 2}px`;
      seam.style.left = `${frame.center.x - 1}px`;
      seam.style.top = `${frame.center.y + frame.center.radius - 4}px`;
      seam.style.height = `${Math.max(12, frame.height - frame.playerHeight - frame.center.y - frame.center.radius + 6)}px`;

      profile.PANEL_IDS.forEach((id) => {
        const shell = shellElements.get(id);
        const dormant = contract.dormantPolygon(id, frame);
        const dormantRect = contract.dormantContentRect(id, frame);
        const projected = mode === 'graph'
          ? snapshot.projections.find((item) => item.moduleId === id)
          : snapshot.shells.find((item) => item.id === id);
        shell.style.clipPath = mode === 'graph' ? 'none' : contract.cssPolygon(projected.polygon);
        shell.dataset.state = projected.state;
        if (mode === 'graph') shell.setAttribute('aria-hidden', String(projected.interactive !== true));
        placeGate(id, dormant, frame);
        const gate = gateElements.get(id);
        gate.setAttribute('aria-pressed', String(presentation.openId === id));
        gate.setAttribute('aria-expanded', String(presentation.openId === id));
        gate.dataset.state = presentation.openId === id ? 'open' : presentation.previewId === id ? 'preview' : 'dormant';
        if (mode === 'graph') {
          const rootElement = roots.get(id);
          const plane = planeElements.get(id);
          const mount = mountElements.get(id);
          setBox(shell, projected.contentRect);
          // A whole panel can move completely away from the pointer while it
          // rectifies (the wide secondary panel crosses the center). Retain a
          // transparent, shell-owned footprint over its exact dormant bounds
          // during preview so native hover/click ownership does not collapse
          // merely because the authored surface moved. The product root stays
          // inert until explicit activation.
          shell.style.setProperty('--sg-hover-left', `${dormantRect.x - projected.contentRect.x}px`);
          shell.style.setProperty('--sg-hover-top', `${dormantRect.y - projected.contentRect.y}px`);
          shell.style.setProperty('--sg-hover-width', `${dormantRect.width}px`);
          shell.style.setProperty('--sg-hover-height', `${dormantRect.height}px`);
          plane.dataset.projectionState = projected.model.state;
          plane.dataset.projectionSide = projected.model.side;
          plane.style.transformOrigin = projected.model.transformOrigin;
          plane.style.transform = projected.model.transform;
          plane.style.opacity = String(projected.model.opacity);
          plane.style.filter = projected.model.filter;
          mount.dataset.projectionState = projected.state;
          setBox(mount, { x: 0, y: 0, width: projected.contentRect.width, height: projected.contentRect.height });
          setRootState(rootElement, projected.visuallyPresent === true, projected.interactive === true, projected.state);
        }
      });

      if (mode === 'proxy' && snapshot.portal) {
        portal.hidden = false;
        portal.setAttribute('aria-label', `${LABELS[snapshot.portal.moduleId]} readable surface`);
        portal.style.clipPath = contract.cssPolygon(snapshot.portal.polygon);
        setBox(portalMount, snapshot.portal.contentRect);
      } else if (mode === 'proxy') {
        portal.hidden = true;
      }
      const activeGeometry = presentation.openId
        ? mode === 'proxy'
          ? snapshot.portal
          : snapshot.projections.find((item) => item.moduleId === presentation.openId)
        : null;
      closeButton.hidden = !activeGeometry?.contentRect;
      if (activeGeometry?.contentRect) {
        closeButton.style.left = `${activeGeometry.contentRect.x + activeGeometry.contentRect.width - 148}px`;
        closeButton.style.top = `${activeGeometry.contentRect.y + 8}px`;
      }
      status.textContent = presentation.openId
        ? `${LABELS[presentation.openId]} released into a readable plane. Escape returns to the field.`
        : `${mode === 'proxy' ? 'Proxy / portal probe. Focus a module to preview; activate it to read.' : `${profile.LABEL} / R2. Complete panels remain visible in depth; hover or focus rectifies, and click holds.`}`;
      paintPlayback();
    }

    function preview(id, trigger) {
      if (presentation.openId || profile.panel(id)?.available !== true) return;
      presentation = contract.transitionPresentation(presentation, { type: 'preview', id, trigger });
      render();
    }

    function clearPreview(id) {
      if (presentation.openId || presentation.previewId !== id) return;
      presentation = contract.transitionPresentation(presentation, { type: 'clear-preview' });
      render();
    }

    function open(id, gate) {
      if (profile.panel(id)?.available !== true) return false;
      const rootElement = mode === 'graph' ? roots.get(id) : rememberRoot(id);
      if (!rootElement) {
        status.textContent = `${LABELS[id]} could not mount; the original Pixelody workspace remains available after leaving the probe.`;
        return false;
      }
      if (presentation.openId && presentation.openId !== id) restoreTemporaryFocusTarget(roots.get(presentation.openId));
      if (mode === 'proxy') {
        proxyRestoreBorrowedRoot();
        portalMount.appendChild(rootElement);
        setRootState(rootElement, true, true, 'rectified-open');
      }
      presentation = contract.transitionPresentation(presentation, { type: 'open', id, trigger: 'explicit', returnFocusId: gate?.dataset.moduleId || id });
      render();
      visibleFocusEntry(rootElement).focus?.({ preventScroll: true });
      return true;
    }

    function closeActive() {
      const returnId = presentation.returnFocusId || presentation.openId;
      const activeRoot = roots.get(presentation.openId);
      if (mode === 'proxy') proxyRestoreBorrowedRoot();
      presentation = contract.transitionPresentation(presentation, { type: 'close' });
      render();
      restoreTemporaryFocusTarget(activeRoot);
      gateElements.get(returnId)?.focus?.({ preventScroll: true });
    }

    function applicationSurfaceOpen() {
      const ids = [
        'trackMenu', 'playlistMenu', 'queueDrawer', 'migrationDrawer', 'settingsOverlay', 'jamsOverlay',
        'supportOwnOverlay', 'shortcutsOverlay', 'trackEditorOverlay', 'playlistPickerOverlay', 'playlistCreatorOverlay', 'backgroundCabinet',
      ];
      return ids.some((id) => {
        const element = documentObject.getElementById?.(id) || documentObject.querySelector?.(`#${id}`);
        if (!element || element.hidden === true) return false;
        return !element.classList?.contains?.('hidden');
      });
    }

    function activate(nextMode) {
      if (!MODES.includes(nextMode)) return { ok: false, code: 'invalid-mode' };
      if (host && mode === nextMode) return { ok: true, status: 'already-active', mode };
      if (host) deactivate();
      mode = nextMode;
      buildHost();
      documentObject.body.dataset.singularityProbe = mode;
      profile.PANEL_IDS.forEach(rememberRoot);
      const missing = profile.PANEL_IDS.filter((id) => profile.panel(id)?.available === true && !roots.get(id));
      if (missing.length) {
        deactivate();
        return { ok: false, code: 'product-root-missing', missing: Object.freeze([...missing]) };
      }
      if (mode === 'graph') graphMountRoots();
      presentation = contract.initialPresentationState();
      keyListener = (event) => {
        if (event.key !== 'Escape' || !presentation.openId || applicationSurfaceOpen()) return;
        event.preventDefault();
        event.stopPropagation?.();
        closeActive();
      };
      documentObject.addEventListener('keydown', keyListener, true);
      // A graph route owns four complete product roots. Repainting all four on
      // every native resize tick creates a queue of obsolete layouts while a
      // person drags the window. Keep immediate renders for semantic state and
      // tier changes, but collapse same-tier geometry updates into one trailing
      // render that always settles on the latest viewport.
      resizeObserver = typeof windowObject.ResizeObserver === 'function' ? new windowObject.ResizeObserver(scheduleResizeRender) : null;
      resizeObserver?.observe(documentObject.documentElement);
      render();
      return { ok: true, status: 'active', mode };
    }

    function deactivate() {
      if (!host) return { ok: true, status: 'inactive' };
      if (mode === 'proxy') proxyRestoreBorrowedRoot();
      restoreAllRoots();
      resizeObserver?.disconnect?.();
      resizeObserver = null;
      if (resizeRenderTimer) {
        const cancel = windowObject.clearTimeout?.bind(windowObject) || clearTimeout;
        cancel(resizeRenderTimer);
      }
      resizeRenderTimer = 0;
      lastRenderedViewportTier = '';
      if (keyListener) documentObject.removeEventListener('keydown', keyListener, true);
      keyListener = null;
      host.remove();
      host = null;
      center = null;
      seam = null;
      playbackStatus = null;
      portal = null;
      portalMount = null;
      closeButton = null;
      status = null;
      shellElements.clear();
      planeElements.clear();
      mountElements.clear();
      gateElements.clear();
      temporaryFocusTargets.clear();
      presentation = contract.initialPresentationState();
      mode = '';
      delete documentObject.body.dataset.singularityProbe;
      delete documentObject.body.dataset.singularityProbeReady;
      return { ok: true, status: 'inactive' };
    }

    function setMode(nextMode) {
      if (!nextMode) return deactivate();
      try {
        const result = activate(nextMode);
        if (result.ok) documentObject.body.dataset.singularityProbeReady = 'true';
        return result;
      } catch (error) {
        try { deactivate(); } catch {}
        return { ok: false, code: 'mount-failed', message: String(error?.message || error).slice(0, 180) };
      }
    }

    return Object.freeze({ setMode, activate, deactivate, open, closeActive, refreshPlayback: paintPlayback, snapshot: () => Object.freeze({ mode, presentation, active: Boolean(host), playback: playbackState() }) });
  }

  return Object.freeze({ MODES, ROOT_SELECTORS, createHost });
}));
