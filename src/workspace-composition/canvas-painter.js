(function pixelodyCanvasPainterFactory(root, factory) {
  const moduleEffects = typeof module === 'object' && module.exports
    ? require('./module-effects')
    : root.PixelodyCanvasModuleEffects;
  const api = factory(moduleEffects);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCanvasPainter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasPainterApi(moduleEffects) {
  'use strict';

  // The bridge between the composition graph and real Pixelody.
  //
  // dev-lab-host.js already paints split/grid/dock/overlay/stack containers,
  // but only around neutral specimen fixtures in the standalone lab. The C8
  // production host does the opposite: it mounts the seven real adapters but
  // paints nothing, so every theme still renders through the legacy shell's
  // three elements. Nothing joined the two halves.
  //
  // This painter is that join. It walks a normalized graph, paints the same
  // container vocabulary the lab uses, and then relocates the REAL product
  // roots into those containers. Every move is recorded, so teardown puts the
  // original DOM back exactly as it was found.
  //
  // It owns presentation only. It reads a graph, moves elements, and records
  // how to undo that. It never mutates application state, never decides what
  // a module contains, and never validates the graph -- the contract, the
  // registry, and the session remain the authorities above it.

  const NODE_CLASS = Object.freeze({
    root: 'cw-root',
    split: 'cw-split',
    grid: 'cw-grid',
    dock: 'cw-dock',
    overlay: 'cw-overlay',
    stack: 'cw-stack',
  });
  if (!moduleEffects) throw new Error('Canvas painter requires the module effects contract.');

  function createPainter(options = {}) {
    const documentObject = options.document;
    if (!documentObject) throw new Error('Canvas painter requires a document.');
    const resolveRoot = typeof options.resolveRoot === 'function' ? options.resolveRoot : () => null;
    const describeModule = typeof options.describeModule === 'function' ? options.describeModule : () => ({});
    const surfaceSelector = options.surfaceSelector || '.workspace';
    // An anchored node keeps a product-owned element that must not be broken
    // apart. Its container is painted and the whole anchor moves into it; its
    // descendants are wrapped for identity but never relocated. The player bar
    // is the motivating case: transport and now-playing are separate modules
    // living inside one product-owned bar, and pulling them out of it would
    // strand volume, queue, and the mini-player button.
    const anchors = Array.isArray(options.anchors) ? options.anchors : [];

    let canvasRoot = null;
    let painted = false;
    let pendingTransient = null;
    let topology = '';
    let fullPaintCount = 0;
    let incrementalUpdateCount = 0;
    let resolved = new Map();
    const moved = [];
    const wrapped = [];
    const hidden = [];
    const containers = new Map();
    const moduleElements = new Map();

    function element(tag, className) {
      const node = documentObject.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    function recordMove(node) {
      moved.push({ node, parent: node.parentNode, nextSibling: node.nextSibling });
    }

    function recordHidden(node) {
      hidden.push({ node, inlineDisplay: node.style.display });
      node.style.display = 'none';
    }

    // A grid child's placement is the only spatial value the graph carries.
    // Emitting it as custom properties keeps the theme in charge of what a
    // span means -- the painter never writes grid-column itself.
    function applyPlacement(container, node) {
      if (!node.placement) {
        container.style.removeProperty('--cw-column-start');
        container.style.removeProperty('--cw-row-start');
        container.style.removeProperty('--cw-column-span');
        container.style.removeProperty('--cw-row-span');
        delete container.dataset.cwPlaced;
        delete container.dataset.cwPositioned;
        return;
      }
      if (node.placement.columnStart) container.style.setProperty('--cw-column-start', String(node.placement.columnStart));
      else container.style.removeProperty('--cw-column-start');
      if (node.placement.rowStart) container.style.setProperty('--cw-row-start', String(node.placement.rowStart));
      else container.style.removeProperty('--cw-row-start');
      container.style.setProperty('--cw-column-span', String(node.placement.columnSpan || 1));
      container.style.setProperty('--cw-row-span', String(node.placement.rowSpan || 1));
      container.dataset.cwPlaced = 'true';
      if (node.placement.columnStart && node.placement.rowStart) container.dataset.cwPositioned = 'true';
      else delete container.dataset.cwPositioned;
    }

    function anchorFor(nodeId) {
      return anchors.find((entry) => entry.nodeId === nodeId) || null;
    }

    function normalizedWeightFractions(weights, count) {
      const safe = Array.from({ length: count }, (_, index) => {
        const value = Number(weights?.[index]);
        return Number.isFinite(value) && value > 0 ? value : 1;
      });
      const total = safe.reduce((sum, value) => sum + value, 0) || count;
      return safe.map((value) => value / total);
    }

    function topologySignature(node) {
      if (!node) return '';
      const children = (node.children || []).map(topologySignature);
      // Reordering children inside one grid is a presentation/order update,
      // not a topology replacement. Keeping this signature order-insensitive
      // lets update() move the existing containers without tearing down and
      // relocating every live product root.
      if (node.type === 'grid') children.sort();
      return `${node.type}:${node.id}:${node.type === 'module' ? node.moduleKey : ''}[${children.join('|')}]`;
    }

    function applyNodePresentation(container, node) {
      applyPlacement(container, node);
      // Anchoring is invisible until it refuses to do something, and a pane
      // that silently will not move reads as broken rather than pinned.
      if (node.pin && node.pin !== 'none') container.dataset.cwPin = node.pin;
      else delete container.dataset.cwPin;
      if (node.type === 'module') {
        container.dataset.cwShape = node.shape || '';
        const effects = moduleEffects.fromConfiguration(node.configuration);
        container.dataset.cwAnimation = effects.animation;
        container.dataset.cwParticles = effects.particles;
        container.dataset.cwEffectTrigger = effects.trigger;
        container.dataset.cwEffectIntensity = effects.intensity;
        container.dataset.cwEffectSpeed = effects.speed;
        return;
      }
      if (node.type === 'split') {
        container.dataset.axis = node.axis;
        const fractions = normalizedWeightFractions(node.weights, (node.children || []).length);
        fractions.forEach((fraction, index) => container.style.setProperty(`--cw-split-${index}`, String(fraction)));
        container.style.setProperty('--cw-split-count', String(fractions.length));
        container.style.setProperty('--cw-split-template', fractions.map((fraction) => `minmax(0, ${fraction}fr)`).join(' '));
      } else if (node.type === 'grid') {
        container.style.setProperty('--cw-columns', String(node.columns || 12));
        container.dataset.rowPolicy = node.rowPolicy || 'flow';
      } else if (node.type === 'dock') {
        container.dataset.edge = node.edge;
        container.dataset.sizePolicy = node.sizePolicy;
        container.style.removeProperty('--cw-dock-size');
        if (node.sizePolicy === 'fraction' && Number.isFinite(Number(node.size))) container.style.setProperty('--cw-dock-size', `${Number(node.size) * 100}%`);
        if (node.sizePolicy === 'fixed' && Number.isFinite(Number(node.size))) container.style.setProperty('--cw-dock-size', `${Number(node.size)}px`);
      } else if (node.type === 'overlay') {
        container.dataset.anchorPoint = node.anchor;
        container.dataset.bounds = node.boundsPolicy;
      } else if (node.type === 'stack') {
        container.dataset.activeChildId = node.activeChildId || '';
      }
    }

    function paintModule(node, { relocate }) {
      const container = element('div', 'cw-node cw-module');
      container.dataset.cwNodeId = node.id;
      container.dataset.cwModuleKey = node.moduleKey;
      const moduleDescription = describeModule(node.moduleKey, node.id) || {};
      container.dataset.cwRootPolicy = moduleDescription.rootPolicy || 'independent';
      if (moduleDescription.ownerKey) container.dataset.cwRootOwner = moduleDescription.ownerKey;
      else if (moduleDescription.ownerSelector) container.dataset.cwRootOwner = moduleDescription.ownerSelector;
      applyNodePresentation(container, node);
      const effects = element('span', 'cw-module-effects');
      effects.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 12; index += 1) {
        const particle = element('i');
        particle.style.setProperty('--cw-particle-index', String(index));
        particle.style.setProperty('--cw-particle-x', `${(index * 37 + 11) % 97}%`);
        particle.style.setProperty('--cw-particle-y', `${(index * 61 + 17) % 89}%`);
        effects.appendChild(particle);
      }
      container.appendChild(effects);
      const productRoot = resolved.get(node.id) || null;
      if (!productRoot) {
        // A module whose product root is absent paints as an empty, labeled
        // container rather than silently collapsing the composition. The
        // registry's own fallback still owns the functional recovery.
        container.dataset.cwRootMissing = 'true';
        containers.set(node.id, container);
        return container;
      }
      container.dataset.cwRootMissing = 'false';
      moduleElements.set(node.id, productRoot);
      if (relocate) {
        recordMove(productRoot);
        // A queue drawer or any other surface that ships hidden becomes a
        // placed, permanent member of the composition while the canvas owns
        // the layout. The class is restored on teardown.
        if (productRoot.classList.contains('hidden')) {
          wrapped.push({ kind: 'hidden-class', node: productRoot });
          productRoot.classList.remove('hidden');
        }
        container.appendChild(productRoot);
      } else {
        // Wrap in place: the element keeps its product-owned parent, but gains
        // a module container so selection, edit chrome, and theme rules can
        // address it the same way as a relocated one.
        const parent = productRoot.parentNode;
        if (parent) {
          wrapped.push({ kind: 'wrap', node: productRoot, wrapper: container, parent, nextSibling: productRoot.nextSibling });
          parent.insertBefore(container, productRoot);
          container.appendChild(productRoot);
          container.dataset.cwInPlace = 'true';
        }
      }
      containers.set(node.id, container);
      return container;
    }

    function paintNode(node, context = { relocate: true }) {
      if (node.type === 'module') return paintModule(node, context);

      const container = element('div', `cw-node ${NODE_CLASS[node.type] || 'cw-node'}`);
      container.dataset.cwNodeId = node.id;
      container.dataset.cwNodeType = node.type;
      applyNodePresentation(container, node);
      containers.set(node.id, container);

      const anchor = anchorFor(node.id);
      if (anchor) {
        // Paint the container, move the whole product-owned element into it,
        // and wrap descendants in place instead of relocating them.
        const anchorElement = anchor.element || documentObject.querySelector(anchor.selector);
        (node.children || []).forEach((child) => paintNode(child, { relocate: false }));
        if (anchorElement) {
          recordMove(anchorElement);
          container.appendChild(anchorElement);
          container.dataset.cwAnchored = anchor.selector;
        }
        return container;
      }

      (node.children || []).forEach((child) => {
        const childElement = paintNode(child, context);
        if (childElement && !childElement.dataset.cwInPlace) container.appendChild(childElement);
        if (node.type === 'stack' && child.id !== (node.activeChildId || (node.children || [])[0]?.id)) {
          childElement.hidden = true;
        }
      });
      if (node.type === 'split') {
        const handle = element('button', 'cw-split-handle');
        handle.type = 'button';
        handle.dataset.cwSplitId = node.id;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', node.axis === 'horizontal' ? 'vertical' : 'horizontal');
        handle.setAttribute('aria-label', `Resize ${node.axis} canvas split`);
        handle.setAttribute('aria-valuemin', '20');
        handle.setAttribute('aria-valuemax', '80');
        const first = normalizedWeightFractions(node.weights, 2)[0] || 0.5;
        handle.setAttribute('aria-valuenow', String(Math.round(first * 100)));
        container.appendChild(handle);
      }
      return container;
    }

    // Every product root and anchor is resolved up front, against the intact
    // document. Relocation detaches subtrees from the document until the
    // canvas is attached at the end, so a module nested inside an already
    // moved sibling -- the signal overlay living inside the track browser is
    // the real case -- would resolve to null if it were looked up mid-paint.
    function collectRoots(node, map) {
      if (!node) return map;
      if (node.type === 'module') {
        const found = resolveRoot(node.moduleKey, node.id);
        if (found) map.set(node.id, found);
        return map;
      }
      (node.children || []).forEach((child) => collectRoots(child, map));
      return map;
    }

    // Repainting moves the same DOM nodes rather than recreating them, so
    // element identity survives and scroll offsets can be carried across. They
    // are not carried by the browser: detaching a scroller resets it to zero,
    // which meant every composition edit threw the track list back to the top.
    // Focus is restored for the same reason -- moving the focused element
    // drops focus to the body.
    function captureTransientState() {
      const scrolls = new Map();
      if (canvasRoot) {
        canvasRoot.querySelectorAll('*').forEach((node) => {
          if (node.scrollTop || node.scrollLeft) scrolls.set(node, { top: node.scrollTop, left: node.scrollLeft });
        });
      }
      const active = documentObject.activeElement;
      const focus = active && canvasRoot?.contains(active) ? active : null;
      return { scrolls, focus };
    }

    function restoreTransientState(state) {
      if (!state) return;
      state.scrolls.forEach((offset, node) => {
        if (!node.isConnected) return;
        node.scrollTop = offset.top;
        node.scrollLeft = offset.left;
      });
      if (state.focus?.isConnected) {
        try { state.focus.focus({ preventScroll: true }); } catch { /* focus is best effort */ }
      }
    }

    function paint(graph) {
      if (!graph) return null;
      const transient = pendingTransient || captureTransientState();
      pendingTransient = null;
      if (painted) teardown();
      const surface = documentObject.querySelector(surfaceSelector);
      if (!surface) return null;
      resolved = collectRoots(graph, new Map());
      anchors.forEach((entry) => { entry.element = documentObject.querySelector(entry.selector); });
      canvasRoot = element('div', 'cw-canvas');
      canvasRoot.dataset.cwCanvas = 'true';
      canvasRoot.dataset.cwPaintMode = 'full';
      fullPaintCount += 1;
      canvasRoot.dataset.cwFullPaintCount = String(fullPaintCount);
      canvasRoot.dataset.cwIncrementalUpdateCount = String(incrementalUpdateCount);
      canvasRoot.appendChild(paintNode(graph));
      surface.appendChild(canvasRoot);
      // Anything left behind in the host surface is legacy shell furniture --
      // panel resizers, drag handles, decorative HUD layers from retired
      // themes. It is hidden rather than removed so teardown is exact.
      Array.from(surface.children).forEach((child) => {
        if (child !== canvasRoot) recordHidden(child);
      });
      documentObject.body.dataset.cwCanvasPainted = 'true';
      painted = true;
      topology = topologySignature(graph);
      restoreTransientState(transient);
      return canvasRoot;
    }

    function update(graph) {
      if (!painted || !graph || topologySignature(graph) !== topology) return null;
      (function visit(node) {
        const container = containers.get(node.id);
        if (!container) return;
        applyNodePresentation(container, node);
        if (node.type === 'stack') {
          (node.children || []).forEach((child) => {
            const childElement = containers.get(child.id);
            if (childElement) childElement.hidden = child.id !== (node.activeChildId || node.children[0]?.id);
          });
        }
        if (node.type === 'split') {
          const handle = container.querySelector(':scope > .cw-split-handle');
          const first = normalizedWeightFractions(node.weights, 2)[0] || 0.5;
          handle?.setAttribute('aria-valuenow', String(Math.round(first * 100)));
        }
        if (node.type === 'grid') {
          // Preserve semantic/focus order when a spatial edit sorts grid
          // children, but move the existing shells instead of repainting them.
          (node.children || []).forEach((child) => {
            const childElement = containers.get(child.id);
            if (childElement?.parentElement === container) container.appendChild(childElement);
          });
        }
        (node.children || []).forEach(visit);
      }(graph));
      incrementalUpdateCount += 1;
      canvasRoot.dataset.cwPaintMode = 'incremental';
      canvasRoot.dataset.cwFullPaintCount = String(fullPaintCount);
      canvasRoot.dataset.cwIncrementalUpdateCount = String(incrementalUpdateCount);
      return canvasRoot;
    }

    // The host sometimes has to destroy or replace module lifecycles between
    // paints. Restore product-owned DOM first, but retain scroll and focus so
    // the immediately following paint can put transient UI state back.
    function prepareForReconcile() {
      pendingTransient = captureTransientState();
      if (painted) teardown();
    }

    function teardown() {
      if (!painted) return;
      // Unwrap first, then restore moves in reverse, then unhide. Order
      // matters: a wrapper removed after its child was moved back would strand
      // an empty container in product-owned DOM.
      wrapped.slice().reverse().forEach((entry) => {
        if (entry.kind === 'hidden-class') { entry.node.classList.add('hidden'); return; }
        if (entry.parent) entry.parent.insertBefore(entry.node, entry.wrapper);
        entry.wrapper.remove();
      });
      wrapped.length = 0;
      moved.slice().reverse().forEach((entry) => {
        if (!entry.parent) return;
        if (entry.nextSibling && entry.nextSibling.parentNode === entry.parent) entry.parent.insertBefore(entry.node, entry.nextSibling);
        else entry.parent.appendChild(entry.node);
      });
      moved.length = 0;
      hidden.forEach((entry) => { entry.node.style.display = entry.inlineDisplay; });
      hidden.length = 0;
      canvasRoot?.remove();
      canvasRoot = null;
      containers.clear();
      moduleElements.clear();
      resolved = new Map();
      topology = '';
      delete documentObject.body.dataset.cwCanvasPainted;
      painted = false;
    }

    return Object.freeze({
      paint,
      repaint: paint,
      update,
      prepareForReconcile,
      destroy: () => { pendingTransient = null; teardown(); },
      isPainted: () => painted,
      containerFor: (nodeId) => containers.get(nodeId) || null,
      moduleElementFor: (nodeId) => moduleElements.get(nodeId) || null,
      stats: () => Object.freeze({ fullPaintCount, incrementalUpdateCount, topology }),
    });
  }

  return Object.freeze({ createPainter, NODE_CLASS });
}));
