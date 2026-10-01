(function pixelodyFirstPartyWorkspaceModulesFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports ? require('./contract') : root.PixelodyWorkspaceCompositionContract;
  const moduleContract = typeof module === 'object' && module.exports ? require('./module-contract') : root.PixelodyWorkspaceModuleContract;
  const moduleRegistry = typeof module === 'object' && module.exports ? require('./module-registry') : root.PixelodyWorkspaceModuleRegistry;
  const api = factory(composition, moduleContract, moduleRegistry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFirstPartyWorkspaceModules = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFirstPartyWorkspaceModulesApi(composition, moduleContract, moduleRegistry) {
  'use strict';

  if (!composition || !moduleContract || !moduleRegistry) throw new Error('First-party workspace modules require the composition module runtime.');

  const SHAPES = Object.freeze({
    panel: Object.freeze({ minInline: 180, minBlock: 120, maxInline: 1800, maxBlock: 1400, targetInline: 320, targetBlock: 420, resizeAxes: ['inline', 'block'], scrollPolicy: 'block' }),
    stage: Object.freeze({ minInline: 320, minBlock: 220, maxInline: 2400, maxBlock: 1800, targetInline: 760, targetBlock: 620, resizeAxes: ['inline', 'block'], scrollPolicy: 'block' }),
    strip: Object.freeze({ minInline: 160, minBlock: 52, maxInline: 2200, maxBlock: 320, targetInline: 560, targetBlock: 96, resizeAxes: ['inline'], scrollPolicy: 'none' }),
    tile: Object.freeze({ minInline: 120, minBlock: 120, maxInline: 1200, maxBlock: 1200, targetInline: 260, targetBlock: 260, resizeAxes: ['inline', 'block'], scrollPolicy: 'none' }),
    ambient: Object.freeze({ minInline: 180, minBlock: 72, maxInline: 2400, maxBlock: 720, targetInline: 720, targetBlock: 160, resizeAxes: ['inline', 'block'], scrollPolicy: 'none' }),
    mini: Object.freeze({ minInline: 160, minBlock: 42, maxInline: 720, maxBlock: 180, targetInline: 320, targetBlock: 64, resizeAxes: ['inline'], scrollPolicy: 'none' }),
  });

  const MODULE_SPECS = Object.freeze([
    Object.freeze({ key: 'library.browser', family: 'family.library', label: 'Library', selector: '[data-cw-product-root="library.browser"]', jobs: ['library-access'], reads: ['library.summary'], commands: ['library.open'], shapes: ['panel'], defaultShape: 'panel', focusPolicy: 'entry', rootPolicy: 'independent' }),
    Object.freeze({ key: 'tracks.browser', family: 'family.tracks', label: 'Track browser', selector: '[data-cw-product-root="tracks.browser"]', jobs: ['track-browsing'], reads: ['tracks.summary'], commands: ['tracks.open'], shapes: ['panel', 'stage'], defaultShape: 'stage', focusPolicy: 'document', rootPolicy: 'independent' }),
    Object.freeze({ key: 'queue.view', family: 'family.queue', label: 'Queue', selector: '[data-cw-product-root="queue.view"]', jobs: ['queue-access'], reads: ['queue.summary'], commands: ['queue.open'], shapes: ['panel'], defaultShape: 'panel', focusPolicy: 'entry', rootPolicy: 'independent' }),
    Object.freeze({ key: 'track.information', family: 'family.information', label: 'Track information', selector: '[data-cw-product-root="track.information"]', jobs: ['track-information'], reads: ['track.information'], commands: ['track-information.open'], shapes: ['panel'], defaultShape: 'panel', focusPolicy: 'entry', rootPolicy: 'independent' }),
    Object.freeze({ key: 'audio.visualizer', family: 'family.signal', label: 'Signal field', selector: '[data-cw-product-root="audio.visualizer"]', jobs: ['decorative-signal-view'], reads: ['signal.frame'], commands: [], shapes: ['tile', 'ambient'], defaultShape: 'ambient', focusPolicy: 'none', instancePolicy: 'multiple', maxInstances: 4, cost: 'medium', scheduler: 'shared', motionOff: 'static', rootPolicy: 'embedded-fallback', ownerKey: 'tracks.browser' }),
    Object.freeze({ key: 'transport.controls', family: 'family.transport', label: 'Transport', selector: '[data-cw-product-root="transport.controls"]', jobs: ['playback-transport'], reads: ['playback.summary'], commands: ['playback.previous', 'playback.toggle', 'playback.next'], shapes: ['strip', 'mini'], defaultShape: 'strip', focusPolicy: 'entry', miniRelationship: 'shared-configuration', rootPolicy: 'shared-shell-member', ownerSelector: '.player' }),
    Object.freeze({ key: 'now-playing', family: 'family.playback', label: 'Now playing', selector: '[data-cw-product-root="now-playing"]', jobs: ['current-track-identity'], reads: ['playback.summary'], commands: [], shapes: ['strip', 'mini'], defaultShape: 'strip', focusPolicy: 'entry', miniRelationship: 'shared-configuration', rootPolicy: 'shared-shell-member', ownerSelector: '.player' }),
    Object.freeze({ key: 'artwork.stage', family: 'family.artwork', label: 'Artwork stage', selector: '[data-cw-product-root="artwork.stage"]', jobs: ['artwork-view'], reads: ['playback.summary'], commands: [], shapes: ['tile', 'panel', 'stage'], defaultShape: 'tile', focusPolicy: 'none', optional: true, rootPolicy: 'embedded-fallback', ownerKey: 'tracks.browser' }),
    Object.freeze({ key: 'workspace.route-navigator', family: 'family.navigation', label: 'Route navigator', jobs: ['workspace-navigation'], reads: ['library.summary', 'queue.summary', 'playback.summary'], commands: ['library.open', 'tracks.open', 'queue.open', 'track-information.open', 'settings.open'], shapes: ['panel', 'strip'], defaultShape: 'panel', focusPolicy: 'entry', optional: true, rootPolicy: 'independent', generated: 'route-navigator' }),
  ]);

  const SPEC_BY_KEY = Object.freeze(Object.fromEntries(MODULE_SPECS.map((spec) => [spec.key, spec])));

  function shapeMap(keys) {
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, SHAPES[key]])));
  }

  function restoreAttribute(element, name, value) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  function focusEntry(element) {
    if (!element) return false;
    const target = element.matches?.('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')
      ? element
      : element.querySelector?.('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');
    target?.focus?.();
    return Boolean(target);
  }

  function primaryLifecycle(spec, context, documentObject, claimRoot) {
    const claim = typeof claimRoot === 'function' ? claimRoot(spec) : null;
    const element = claim?.element || documentObject?.querySelector?.(spec.selector);
    if (!element) throw Object.assign(new Error(`First-party root for "${spec.key}" is unavailable.`), { code: 'FIRST_PARTY_ROOT_MISSING', moduleKey: spec.key });
    const original = Object.freeze({
      module: element.getAttribute('data-cw-module'),
      instance: element.getAttribute('data-cw-instance-id'),
      shape: element.getAttribute('data-cw-shape'),
      parent: element.getAttribute('data-cw-parent-id'),
      visibility: element.getAttribute('data-cw-visibility'),
    });
    let configuration = Object.freeze({});
    let mounted = false;

    function refreshReads() {
      const snapshots = Object.create(null);
      spec.reads.forEach((key) => { snapshots[key] = context.read(key); });
      if (spec.key === 'audio.visualizer') {
        const bars = snapshots['signal.frame']?.bars || [];
        element.querySelectorAll?.('i').forEach((bar, index) => bar.style.setProperty('--cw-signal-level', String(Math.max(0.08, Math.min(1, Number(bars[index]) || 0.08)))));
      }
      return snapshots;
    }

    return {
      mount(payload) {
        configuration = payload.configuration;
        element.dataset.cwModule = spec.key;
        element.dataset.cwInstanceId = context.instanceId;
        element.dataset.cwShape = payload.layout.shape;
        element.dataset.cwVisibility = payload.visibility.visible ? 'visible' : payload.visibility.reason;
        refreshReads();
        mounted = true;
      },
      update(payload) { configuration = payload.configuration; refreshReads(); },
      setLayout(layout) { element.dataset.cwShape = layout.shape; },
      setVisibility(visibility) { element.dataset.cwVisibility = visibility.visible ? 'visible' : visibility.reason; },
      focus() { return focusEntry(element); },
      serializeConfiguration() { return configuration; },
      destroy() {
        if (!mounted) return;
        restoreAttribute(element, 'data-cw-module', original.module);
        restoreAttribute(element, 'data-cw-instance-id', original.instance);
        restoreAttribute(element, 'data-cw-shape', original.shape);
        restoreAttribute(element, 'data-cw-parent-id', original.parent);
        restoreAttribute(element, 'data-cw-visibility', original.visibility);
        element.removeAttribute('data-cw-selected');
        element.style.removeProperty('--cw-module-order');
        claim?.release?.();
        mounted = false;
      },
    };
  }

  function fallbackLifecycle(spec, context, documentObject) {
    let root = null;
    let configuration = Object.freeze({});
    return {
      mount(payload) {
        configuration = payload.configuration;
        root = documentObject.createElement('section');
        root.className = 'cw-product-fallback';
        root.dataset.cwModule = `fallback.${spec.key}`;
        root.dataset.cwInstanceId = context.instanceId;
        root.dataset.cwShape = payload.layout.shape;
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', `${spec.label} safe fallback`);
        const copy = documentObject.createElement('p');
        copy.textContent = `${spec.label} could not mount. Pixelody kept its product-owned safe route.`;
        root.appendChild(copy);
        spec.commands.forEach((command) => {
          const button = documentObject.createElement('button');
          button.type = 'button';
          button.textContent = command.replaceAll('.', ' ');
          button.addEventListener('click', () => context.command(command, { source: 'workspace-fallback' }));
          root.appendChild(button);
        });
        payload.surface?.appendChild?.(root);
        context.announce(`${spec.label} safe fallback mounted.`);
      },
      update(payload) { configuration = payload.configuration; },
      setLayout(layout) { if (root) root.dataset.cwShape = layout.shape; },
      setVisibility(visibility) { if (root) root.hidden = !visibility.visible; },
      focus() { return focusEntry(root); },
      serializeConfiguration() { return configuration; },
      destroy() { root?.remove?.(); root = null; },
    };
  }

  function routeNavigatorLifecycle(spec, context, documentObject) {
    let root = null;
    let configuration = Object.freeze({});
    let status = null;
    const destinations = Object.freeze([
      Object.freeze({ label: 'Browse tracks', command: 'tracks.open' }),
      Object.freeze({ label: 'Library', command: 'library.open' }),
      Object.freeze({ label: 'Queue', command: 'queue.open' }),
      Object.freeze({ label: 'Track information', command: 'track-information.open' }),
      Object.freeze({ label: 'Settings', command: 'settings.open' }),
    ]);

    function refresh() {
      if (!status) return;
      const library = context.read('library.summary') || {};
      const queue = context.read('queue.summary') || {};
      const playback = context.read('playback.summary') || {};
      const parts = [
        `${Number(library.trackCount) || 0} local tracks`,
        `${Number(queue.count) || 0} queued`,
        playback.title && playback.title !== 'Choose a track' ? `current: ${playback.title}` : 'nothing playing',
      ];
      status.textContent = parts.join(' · ');
    }

    return {
      mount(payload) {
        configuration = payload.configuration;
        root = documentObject.createElement('section');
        root.className = 'cw-route-navigator';
        root.dataset.cwModule = spec.key;
        root.dataset.cwInstanceId = context.instanceId;
        root.dataset.cwShape = payload.layout.shape;
        root.dataset.bfAssetSlot = 'route-navigator-skin';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'Workspace route navigator');
        const kicker = documentObject.createElement('small');
        kicker.textContent = 'WORKSPACE ROUTE';
        const heading = documentObject.createElement('strong');
        heading.textContent = 'Go to';
        status = documentObject.createElement('p');
        status.className = 'cw-route-navigator-status';
        const nav = documentObject.createElement('nav');
        nav.setAttribute('aria-label', 'Pixelody destinations');
        destinations.forEach((destination) => {
          const button = documentObject.createElement('button');
          button.type = 'button';
          button.textContent = destination.label;
          button.dataset.routeCommand = destination.command;
          button.addEventListener('click', () => context.command(destination.command, { source: 'workspace-route-navigator' }));
          nav.appendChild(button);
        });
        root.append(kicker, heading, status, nav);
        payload.surface?.appendChild?.(root);
        refresh();
      },
      update(payload) { configuration = payload.configuration; refresh(); },
      setLayout(layout) { if (root) root.dataset.cwShape = layout.shape; },
      setVisibility(visibility) { if (root) root.hidden = !visibility.visible; },
      focus() { return focusEntry(root); },
      serializeConfiguration() { return configuration; },
      destroy() { root?.remove?.(); root = null; status = null; },
    };
  }

  function descriptorFor(spec, documentObject, fallback = false, claimRoot = null) {
    return {
      contractVersion: 1,
      key: fallback ? `fallback.${spec.key}` : spec.key,
      version: '1.0.0-c8',
      family: spec.family,
      productJobs: spec.jobs,
      reads: spec.reads,
      commands: spec.commands,
      shapes: shapeMap(spec.shapes),
      defaultShape: spec.defaultShape,
      instancePolicy: spec.instancePolicy || 'single',
      performance: { cost: fallback ? 'low' : spec.cost || 'low', scheduler: fallback ? 'none' : spec.scheduler || 'none', pausesWhenHidden: true, conserveFps: spec.scheduler === 'shared' && !fallback ? 12 : 0 },
      motionOff: fallback ? 'unchanged' : spec.motionOff || 'unchanged',
      accessibility: { name: fallback ? `${spec.label} fallback` : spec.label, focusPolicy: fallback ? 'entry' : spec.focusPolicy, status: 'polite', nonDragActions: true },
      miniRelationship: spec.miniRelationship || 'main-only',
      configurationSchemaVersion: 1,
      defaultConfiguration: {},
      fallbackKey: fallback ? '' : `fallback.${spec.key}`,
      fallbackDescription: `Use the product-owned ${spec.label.toLowerCase()} safe route.`,
      isFallback: fallback,
      create: (context) => fallback
        ? fallbackLifecycle(spec, context, documentObject)
        : spec.generated === 'route-navigator'
          ? routeNavigatorLifecycle(spec, context, documentObject)
          : primaryLifecycle(spec, context, documentObject, claimRoot),
    };
  }

  function createRegistry(options = {}) {
    if (!options.document) throw new Error('First-party module registry requires a document adapter.');
    const registry = moduleRegistry.createRegistry();
    const rootClaims = new Map();
    function claimRoot(spec) {
      let record = rootClaims.get(spec.key);
      if (!record) {
        record = { base: options.document.querySelector(spec.selector), claimed: new Set() };
        rootClaims.set(spec.key, record);
      }
      if (!record.base) return null;
      let element = record.base;
      let cloned = false;
      if (spec.instancePolicy === 'multiple' && record.claimed.has(record.base)) {
        element = record.base.cloneNode(true);
        element.removeAttribute('id');
        element.dataset.cwCloneSource = spec.key;
        record.base.parentNode?.insertBefore?.(element, record.base.nextSibling);
        cloned = true;
      }
      record.claimed.add(element);
      return {
        element,
        release() {
          record.claimed.delete(element);
          if (cloned) element.remove();
        },
      };
    }
    MODULE_SPECS.forEach((spec) => {
      registry.register(descriptorFor(spec, options.document, true), { origin: 'product' });
      registry.register(descriptorFor(spec, options.document, false, claimRoot), { origin: 'product' });
    });
    registry.seal();
    return registry;
  }

  return Object.freeze({ SHAPES, MODULE_SPECS, SPEC_BY_KEY, descriptorFor, createRegistry });
}));
