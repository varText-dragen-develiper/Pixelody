(function pixelodyWorkspaceProductionHostFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports ? require('./contract') : root.PixelodyWorkspaceCompositionContract;
  const sessionDomain = typeof module === 'object' && module.exports ? require('./composition-session') : root.PixelodyWorkspaceCompositionSession;
  const interactionAdapter = typeof module === 'object' && module.exports ? require('./interaction-adapter') : root.PixelodyWorkspaceInteractionAdapter;
  const firstParty = typeof module === 'object' && module.exports ? require('./first-party-modules') : root.PixelodyFirstPartyWorkspaceModules;
  const themeExperiment = typeof module === 'object' && module.exports ? require('./theme-experiment') : root.PixelodyComposableThemeExperiment;
  const canvasPainter = typeof module === 'object' && module.exports ? require('./canvas-painter') : root.PixelodyCanvasPainter;
  const canvasStudio = typeof module === 'object' && module.exports ? require('./canvas-studio') : root.PixelodyCanvasStudio;
  const playerControlsApi = typeof module === 'object' && module.exports ? require('./player-controls') : root.PixelodyPlayerControls;
  const api = factory(composition, sessionDomain, interactionAdapter, firstParty, themeExperiment, canvasPainter, canvasStudio, playerControlsApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceProductionHost = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceProductionHostApi(composition, sessionDomain, interactionAdapter, firstParty, themeExperiment, canvasPainter, canvasStudio, playerControlsApi) {
  'use strict';

  if (!composition || !sessionDomain || !interactionAdapter || !firstParty) throw new Error('Production workspace host requires the composition runtime, interaction adapter, and first-party modules.');

  const REQUIRED_JOBS = Object.freeze(['library-access', 'track-browsing', 'queue-access', 'current-track-identity', 'playback-transport', 'track-information']);
  const DIRECT_WORKSPACE_KEYS = new Set(['library.browser', 'tracks.browser', 'track.information']);

  function walkGraph(node, visitor, parent = null) {
    if (!node) return;
    visitor(node, parent);
    (node.children || []).forEach((child) => walkGraph(child, visitor, node));
  }

  function moduleRecords(graph) {
    const records = [];
    walkGraph(graph, (node, parent) => {
      if (node.type === 'module') records.push(Object.freeze({ node, parentId: parent?.id || '' }));
    });
    return records;
  }

  function findRecord(graph, id) {
    return moduleRecords(graph).find((record) => record.node.id === id) || null;
  }

  function siblingRecords(graph, id) {
    let result = [];
    walkGraph(graph, (node) => {
      if ((node.children || []).some((child) => child.id === id)) result = node.children.filter((child) => child.type === 'module').map((child) => findRecord(graph, child.id));
    });
    return result.filter(Boolean);
  }

  function clampSize(value, fallback) {
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  }

  function createHost(options = {}) {
    const documentObject = options.document;
    const desktop = options.desktop;
    if (!documentObject || !desktop) throw new Error('Production workspace host requires document and desktop adapters.');
    const registry = firstParty.createRegistry({ document: documentObject });
    const fallbackSurface = documentObject.querySelector('.workspace');
    const workbench = documentObject.querySelector('#workspaceProductionWorkbench');
    const moduleSelect = documentObject.querySelector('#workspaceProductionModule');
    const status = documentObject.querySelector('#workspaceProductionStatus');
    const identity = documentObject.querySelector('#workspaceProductionIdentity');
    const profileName = documentObject.querySelector('#workspaceProductionProfileName');
    // `true` keeps the original single-profile call site working and resolves
    // to Counterspace Relay. A caller that knows which composable profile the
    // main process actually seeded may pass its identity instead; only
    // PROFILE_ID and LABEL are read from it here.
    const experimentProfile = options.experimentProfile === true
      ? themeExperiment
      : (options.experimentProfile && typeof options.experimentProfile === 'object' && options.experimentProfile.PROFILE_ID ? options.experimentProfile : null);
    const controls = {
      mode: documentObject.querySelector('#workspaceProductionMode'),
      undo: documentObject.querySelector('#workspaceProductionUndo'),
      redo: documentObject.querySelector('#workspaceProductionRedo'),
      restore: documentObject.querySelector('#workspaceProductionRestore'),
      cancel: documentObject.querySelector('#workspaceProductionCancel'),
      legacy: documentObject.querySelector('#workspaceProductionLegacy'),
    };
    if (!workbench || !moduleSelect || !status || Object.values(controls).some((control) => !control)) throw new Error('Production workspace workbench markup is incomplete.');

    // A painted host walks the graph and relocates the real product roots into
    // painted containers. Without it the host keeps its original behavior:
    // adapters mount onto the legacy shell and only slot order changes.
    const painter = options.paintCanvas === true && canvasPainter
      ? canvasPainter.createPainter({
        document: documentObject,
        // Resolve the mounted instance first. This is essential for a safe
        // fallback: its root is created by the lifecycle and deliberately does
        // not match the missing primary product selector.
        resolveRoot: (moduleKey, instanceId) => documentObject.querySelector(`[data-cw-instance-id="${CSS.escape(instanceId)}"]`)
          || documentObject.querySelector(firstParty.SPEC_BY_KEY[moduleKey]?.selector || ''),
        describeModule: (moduleKey) => firstParty.SPEC_BY_KEY[moduleKey] || {},
        anchors: Array.isArray(options.canvasAnchors) ? options.canvasAnchors : [],
      })
      : null;
    // Canvas Studio is the authoring rail. It owns no state: every control it
    // offers becomes one canonical operation through the same session the
    // pointer routes use, so undo, cancel, and the atomic save are unchanged.
    // The small controls on the player bar (mini player, queue, mute, volume,
    // format badge, audio systems) move freely along it. Their arrangement is
    // part of the transport module's configuration and is laid out after
    // every paint, in Use Mode as much as while composing.
    const playerControls = painter && playerControlsApi ? playerControlsApi.createLayout({ document: documentObject }) : null;
    const studioEnabled = options.canvasStudio === true && Boolean(canvasStudio);
    let studio = null;
    const instances = new Map();
    let active = false;
    let activating = null;
    let workspaceState = null;
    let workspaceRevision = 0;
    let session = null;
    let selectedId = '';
    let statusTone = 'idle';
    let interaction = null;
    let editChrome = [];
    let editSerial = 1;
    let saving = false;
    let deferredPresentationHandle = 0;
    let deferredPresentationGraph = null;
    let deferredPresentationUsesIdle = false;

    const capabilityHost = Object.freeze({
      read: (key) => options.read?.(key) ?? {},
      subscribe: (key, listener) => options.subscribe?.(key, listener) || (() => {}),
      command: (key, payload) => options.command?.(key, payload),
      announce: (message) => options.announce?.(message),
    });

    function setStatus(message, tone = 'idle') {
      status.textContent = String(message || '');
      status.dataset.tone = tone;
      statusTone = tone;
      studio?.setStatus?.(status.textContent, tone);
      options.onStatus?.(status.textContent, tone);
    }

    function editingSnapshot() {
      return session?.snapshot?.() || { mode: 'use', dirty: false, graph: workspaceState?.graph, canUndo: false, canRedo: false };
    }

    function createWorkspaceSession(graph, creatorDefaultGraph = workspaceState?.creatorDefaultGraph || graph) {
      return sessionDomain.createSession(graph, {
        creatorDefaultGraph,
        // Canvas Studio drafts with no required-job floor: a canvas is built
        // up one pane at a time, and every intermediate state would otherwise
        // be illegal. Durable commits still use the complete product-job floor.
        validationOptions: { moduleCatalog: registry.catalog(), requiredJobs: studioEnabled ? [] : REQUIRED_JOBS },
      });
    }

    function setSelected(id) {
      const graph = editingSnapshot().graph;
      const available = moduleRecords(graph);
      selectedId = available.some((record) => record.node.id === id) ? id : available[0]?.node.id || '';
      moduleSelect.value = selectedId;
      documentObject.querySelectorAll('[data-cw-instance-id]').forEach((element) => element.toggleAttribute('data-cw-selected', element.dataset.cwInstanceId === selectedId));
      renderControls();
    }

    function renderModulePicker(graph) {
      const previous = selectedId;
      moduleSelect.replaceChildren();
      moduleRecords(graph).forEach(({ node, parentId }) => {
        const option = documentObject.createElement('option');
        option.value = node.id;
        const movable = DIRECT_WORKSPACE_KEYS.has(node.moduleKey);
        const group = movable ? 'Canvas' : node.moduleKey === 'queue.view' ? 'Queue drawer · fixed' : ['transport.controls', 'now-playing'].includes(node.moduleKey) ? 'Playback bar · fixed' : 'Signal layer · fixed';
        option.textContent = `${firstParty.SPEC_BY_KEY[node.moduleKey]?.label || node.moduleKey} · ${group}`;
        moduleSelect.appendChild(option);
      });
      const optional = firstParty.MODULE_SPECS.filter((spec) => spec.optional);
      optional.forEach((spec) => {
        const option = documentObject.createElement('option');
        option.disabled = true;
        option.textContent = `${spec.label} · registered / not placed`;
        moduleSelect.appendChild(option);
      });
      setSelected(previous);
    }

    function renderControls() {
      const snapshot = editingSnapshot();
      const editing = snapshot.mode === 'edit';
      controls.mode.textContent = editing ? snapshot.dirty ? 'Finish and save' : 'Finish Composition Mode' : 'Enter Composition Mode';
      controls.mode.setAttribute('aria-pressed', String(editing));
      controls.mode.disabled = saving;
      controls.undo.disabled = !snapshot.canUndo;
      controls.redo.disabled = !snapshot.canRedo;
      controls.restore.disabled = !editing;
      controls.cancel.disabled = !editing;
      moduleSelect.disabled = !active;
      documentObject.body.dataset.compositionMode = editing ? 'edit' : 'use';
      documentObject.body.dataset.cwStudioEnabled = String(studioEnabled);
      identity.textContent = active ? `Revision ${workspaceRevision} · ${snapshot.dirty ? 'unsaved draft' : 'authoritative'}${experimentProfile ? ' · creator/remix experiment' : ''}` : 'Legacy adapters idle';
      updateEditChrome(snapshot.graph, editing);
    }

    function movableSiblings(graph, id) {
      return siblingRecords(graph, id).filter((record) => DIRECT_WORKSPACE_KEYS.has(record.node.moduleKey));
    }

    function updateEditChrome(graph, editing) {
      editChrome.forEach(({ nodeId, movable, handle, before, after, label }) => {
        const record = findRecord(graph, nodeId);
        if (!record) return;
        const siblings = movable ? movableSiblings(graph, nodeId) : [];
        const index = siblings.findIndex((entry) => entry.node.id === nodeId);
        if (handle) handle.disabled = !editing;
        if (before) before.disabled = !editing || index <= 0;
        if (after) after.disabled = !editing || index < 0 || index >= siblings.length - 1;
        if (label) label.textContent = movable ? 'Canvas · drag to place' : record.node.moduleKey === 'queue.view' ? 'Queue drawer · fixed group' : ['transport.controls', 'now-playing'].includes(record.node.moduleKey) ? 'Playback bar · fixed group' : 'Signal layer · fixed group';
      });
    }

    function clearDropPreview() {
      documentObject.querySelectorAll('[data-cw-drop-intent]').forEach((element) => {
        delete element.dataset.cwDropIntent;
        delete element.dataset.cwDropLabel;
      });
    }

    function clearInteraction(message = '') {
      interaction?.ghost?.remove();
      interaction = null;
      clearDropPreview();
      documentObject.body.dataset.cwPointerPhase = 'idle';
      if (message) setStatus(message, 'warning');
    }

    function applyIntent(intent, route = 'pointer') {
      if (!intent || editingSnapshot().mode !== 'edit') return false;
      const operation = interactionAdapter.operationForIntent(intent, { route, serial: editSerial++ });
      const result = session.apply(operation);
      if (!result.ok) {
        setStatus(result.error.message, 'error');
        return false;
      }
      applyGraph(result.snapshot.graph, { layoutOnly: ['move-before', 'move-after'].includes(intent.kind) });
      const source = firstParty.SPEC_BY_KEY[findRecord(result.snapshot.graph, intent.sourceId)?.node.moduleKey]?.label || intent.sourceId;
      const target = firstParty.SPEC_BY_KEY[findRecord(result.snapshot.graph, intent.targetId)?.node.moduleKey]?.label || intent.targetId;
      const relation = intent.kind === 'move-before' ? 'placed before'
        : intent.kind === 'move-after' ? 'placed after'
          : intent.kind === 'stack' ? 'stacked with'
            : `${intent.label.toLowerCase()} of`;
      setStatus(`${source} ${relation} ${target}. Finish and save when the layout is right.`, 'success');
      return true;
    }

    // One funnel for every studio-authored edit. Anything that cannot be
    // expressed as a validated operation does not belong in the rail.
    function dispatchOperation(operation, message, hints = {}) {
      if (!session || editingSnapshot().mode !== 'edit') return { ok: false, error: { message: 'Composition Mode is not active.' } };
      const result = session.apply({ ...operation, serial: editSerial++ });
      if (!result.ok) {
        setStatus(result.error.message, 'error');
        return result;
      }
      applyGraph(result.snapshot.graph, {
        layoutOnly: hints.layoutOnly === true || ['setNodePlacement', 'resizeSplit'].includes(operation.type),
      });
      if (message) setStatus(message, 'success');
      return result;
    }

    function studioBridge() {
      return Object.freeze({
        snapshot: editingSnapshot,
        dispatch: dispatchOperation,
        setStatus,
        specs: () => firstParty.SPEC_BY_KEY,
        moduleSpecs: () => firstParty.MODULE_SPECS,
        shapes: () => firstParty.SHAPES,
        requiredJobs: () => REQUIRED_JOBS,
        canvasGridId: () => options.canvasGridId || '',
        beginInteraction: cancelDeferredPresentation,
        playerControls: () => playerControls,
        select: (nodeId) => { if (nodeId) setSelected(nodeId); },
        undo: () => undoRedo(-1),
        redo: () => undoRedo(1),
        restore: () => restoreCreator(),
        enter: () => enterOrFinish(),
        rankDropIntents: (input) => {
          const { graph, ...geometry } = input || {};
          return interactionAdapter.rankLegalDropIntents(graph || editingSnapshot().graph, { adapter: interactionAdapter.SELECTED_ADAPTER, ...geometry });
        },
        applyDropIntent: (intent, route) => applyIntent(intent, route),
        resizeWeights: (weights, deltaPixels, totalPixels) => interactionAdapter.resizeWeights(weights, deltaPixels, totalPixels),
        autoscrollDelta: (position, extent, scrollOptions) => interactionAdapter.autoscrollDelta(position, extent, scrollOptions),
        save: () => { saveAndExit(); },
        cancel: () => { cancelAndExit(); },
        returnToLegacy: () => options.returnToLegacy?.(),
      });
    }

    function moveDirect(nodeId, direction) {
      const snapshot = editingSnapshot();
      if (snapshot.mode !== 'edit') return;
      const siblings = movableSiblings(snapshot.graph, nodeId);
      const index = siblings.findIndex((record) => record.node.id === nodeId);
      const target = direction < 0 ? siblings[index - 1] : siblings[index + 1];
      if (!target) return;
      applyIntent(Object.freeze({
        kind: direction < 0 ? 'move-before' : 'move-after',
        label: direction < 0 ? 'Move left' : 'Move right',
        sourceId: nodeId,
        targetId: target.node.id,
      }), 'keyboard');
    }

    function startDrag(event, nodeId) {
      if (!interactionAdapter.pointerStartAllowed({ mode: editingSnapshot().mode, primaryButton: event.button === 0, dedicatedHandle: true, nestedInteractive: false })) return;
      const record = findRecord(editingSnapshot().graph, nodeId);
      if (!record || !DIRECT_WORKSPACE_KEYS.has(record.node.moduleKey)) return;
      event.preventDefault();
      event.stopPropagation();
      setSelected(nodeId);
      const ghost = documentObject.createElement('div');
      ghost.className = 'cw-production-drag-ghost';
      ghost.textContent = `Moving ${firstParty.SPEC_BY_KEY[record.node.moduleKey]?.label || record.node.moduleKey}`;
      documentObject.body.appendChild(ghost);
      interaction = { pointerId: event.pointerId, sourceId: nodeId, startX: event.clientX, startY: event.clientY, phase: 'pending', intent: null, ghost };
      documentObject.body.dataset.cwPointerPhase = 'pending';
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
    }

    function updateDrag(event) {
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY);
      if (interaction.phase === 'pending' && distance < 5) return;
      interaction.phase = 'dragging';
      documentObject.body.dataset.cwPointerPhase = 'dragging';
      interaction.ghost.style.transform = `translate(${Math.round(event.clientX + 14)}px,${Math.round(event.clientY + 14)}px)`;
      clearDropPreview();
      const targetRoot = event.target?.closest?.('[data-cw-instance-id]') || documentObject.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('[data-cw-instance-id]');
      const targetId = targetRoot?.dataset.cwInstanceId || '';
      const targetRecord = findRecord(editingSnapshot().graph, targetId);
      if (!targetRoot || targetId === interaction.sourceId || !targetRecord || !DIRECT_WORKSPACE_KEYS.has(targetRecord.node.moduleKey)) {
        interaction.intent = null;
        setStatus('Dragging · move over another Canvas module.', 'warning');
        return;
      }
      const rect = targetRoot.getBoundingClientRect();
      const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      const ranked = interactionAdapter.rankLegalDropIntents(editingSnapshot().graph, {
        adapter: interactionAdapter.ADAPTERS.A,
        sourceId: interaction.sourceId,
        targetId,
        xRatio,
        yRatio: 0.5,
        targetRect: { width: 2, height: 1 },
      });
      interaction.intent = ranked[0] || null;
      if (!interaction.intent) {
        setStatus('Dragging · that module is in a different fixed group.', 'warning');
        return;
      }
      targetRoot.dataset.cwDropIntent = interaction.intent.kind;
      targetRoot.dataset.cwDropLabel = interaction.intent.kind === 'move-before' ? 'DROP LEFT' : 'DROP RIGHT';
      interaction.ghost.textContent = interaction.intent.kind === 'move-before' ? 'Place left' : 'Place right';
      setStatus(`${interaction.ghost.textContent} of ${firstParty.SPEC_BY_KEY[targetRecord.node.moduleKey]?.label || targetId}.`, 'success');
    }

    function finishDrag(event) {
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      const intent = interaction.phase === 'dragging' ? interaction.intent : null;
      clearInteraction();
      if (intent) applyIntent(intent, 'pointer');
      else setStatus('Nothing moved. Drag the handle onto the left or right half of another Canvas module.', 'warning');
    }

    function clearEditChrome() {
      editChrome.forEach(({ chrome }) => chrome.remove());
      editChrome = [];
      clearInteraction();
    }

    function installEditChrome(graph) {
      clearEditChrome();
      moduleRecords(graph).forEach(({ node }) => {
        const root = [...documentObject.querySelectorAll('[data-cw-instance-id]')].find((element) => element.dataset.cwInstanceId === node.id);
        if (!root) return;
        const movable = DIRECT_WORKSPACE_KEYS.has(node.moduleKey);
        root.dataset.cwMovable = String(movable);
        const chrome = documentObject.createElement('div');
        chrome.className = 'cw-production-edit-chrome';
        chrome.setAttribute('role', 'toolbar');
        chrome.setAttribute('aria-label', `${firstParty.SPEC_BY_KEY[node.moduleKey]?.label || node.moduleKey} composition controls`);
        const label = documentObject.createElement('span');
        label.className = 'cw-production-group-label';
        let handle = null;
        let before = null;
        let after = null;
        if (movable) {
          handle = documentObject.createElement('button');
          handle.type = 'button';
          handle.className = 'cw-production-drag-handle';
          handle.textContent = 'DRAG';
          handle.setAttribute('aria-label', `Drag ${firstParty.SPEC_BY_KEY[node.moduleKey]?.label || node.moduleKey} to another Canvas position`);
          handle.addEventListener('pointerdown', (event) => startDrag(event, node.id));
          before = documentObject.createElement('button');
          before.type = 'button';
          before.textContent = '←';
          before.title = 'Move left';
          before.setAttribute('aria-label', `Move ${firstParty.SPEC_BY_KEY[node.moduleKey]?.label || node.moduleKey} left`);
          before.addEventListener('click', (event) => { event.stopPropagation(); moveDirect(node.id, -1); });
          after = documentObject.createElement('button');
          after.type = 'button';
          after.textContent = '→';
          after.title = 'Move right';
          after.setAttribute('aria-label', `Move ${firstParty.SPEC_BY_KEY[node.moduleKey]?.label || node.moduleKey} right`);
          after.addEventListener('click', (event) => { event.stopPropagation(); moveDirect(node.id, 1); });
          chrome.append(handle, before, after);
        }
        chrome.append(label);
        root.prepend(chrome);
        editChrome.push({ nodeId: node.id, movable, chrome, handle, before, after, label });
      });
      updateEditChrome(graph, editingSnapshot().mode === 'edit');
    }

    function createAndMountInstance(node) {
      const instance = registry.createInstance({
        moduleKey: node.moduleKey,
        instanceId: node.id,
        configuration: node.configuration || {},
        layout: { shape: node.shape },
        visibility: true,
      }, capabilityHost);
      instances.set(node.id, instance);
      try {
        instance.mount(instance.usedFallback ? fallbackSurface : documentObject.querySelector(firstParty.SPEC_BY_KEY[node.moduleKey]?.selector || '.workspace'));
      } catch (error) {
        instances.delete(node.id);
        try { instance.destroy(); } catch (_ignored) { /* original mount error is authoritative */ }
        throw error;
      }
      return instance;
    }

    function reconcileInstances(graph) {
      const desired = new Map(moduleRecords(graph).map(({ node }) => [node.id, node]));

      // Replacements can change an instance id while retaining a single-instance
      // module key. Retire absent lifecycles before admitting their replacements.
      [...instances.entries()].forEach(([instanceId, instance]) => {
        if (desired.has(instanceId)) return;
        try { instance.destroy(); } finally { instances.delete(instanceId); }
      });

      desired.forEach((node, instanceId) => {
        const current = instances.get(instanceId);
        if (current && current.requestedKey !== node.moduleKey) {
          try { current.destroy(); } finally { instances.delete(instanceId); }
        }
        if (!instances.has(instanceId)) createAndMountInstance(node);
        else instances.get(instanceId)?.update?.(node.configuration || {}, 'composition');
      });
    }

    function instanceReconciliationNeeded(graph) {
      const desired = new Map(moduleRecords(graph).map(({ node }) => [node.id, node.moduleKey]));
      if (desired.size !== instances.size) return true;
      return [...desired.entries()].some(([instanceId, moduleKey]) => instances.get(instanceId)?.requestedKey !== moduleKey);
    }

    function refreshInstanceLayouts(graph) {
      moduleRecords(graph).forEach(({ node }) => {
        const element = documentObject.querySelector(`[data-cw-instance-id="${CSS.escape(node.id)}"]`);
        if (!element) return;
        const instance = instances.get(node.id);
        const rect = element.getBoundingClientRect?.() || {};
        const shape = firstParty.SHAPES[node.shape] || firstParty.SHAPES.panel;
        instance?.setLayout?.({
          shape: node.shape,
          inlineSize: Math.max(shape.minInline, Math.min(shape.maxInline, clampSize(rect.width, shape.targetInline))),
          blockSize: Math.max(shape.minBlock, Math.min(shape.maxBlock, clampSize(rect.height, shape.targetBlock))),
          pixelRatio: Math.max(0.5, Math.min(4, Number(globalThis.devicePixelRatio) || 1)),
          direction: 'ltr',
          mode: 'workspace',
          motionAllowed: documentObject.body.dataset.motion !== 'off',
          conserve: documentObject.body.dataset.performance === 'conserve',
        });
      });
    }

    function cancelDeferredPresentation() {
      if (!deferredPresentationHandle) return;
      const view = documentObject.defaultView;
      if (deferredPresentationUsesIdle) view?.cancelIdleCallback?.(deferredPresentationHandle);
      else view?.clearTimeout?.(deferredPresentationHandle);
      deferredPresentationHandle = 0;
      deferredPresentationGraph = null;
      deferredPresentationUsesIdle = false;
    }

    function scheduleDeferredPresentation(graph) {
      deferredPresentationGraph = graph;
      if (deferredPresentationHandle) return;
      const view = documentObject.defaultView;
      const flush = () => {
        deferredPresentationHandle = 0;
        deferredPresentationUsesIdle = false;
        const pendingGraph = deferredPresentationGraph;
        deferredPresentationGraph = null;
        if (!pendingGraph || !session) return;
        refreshInstanceLayouts(pendingGraph);
        studio?.sync();
      };
      if (typeof view?.requestIdleCallback === 'function') {
        deferredPresentationUsesIdle = true;
        deferredPresentationHandle = view.requestIdleCallback(flush, { timeout: 180 });
      } else {
        deferredPresentationHandle = view?.setTimeout?.(flush, 24) || 0;
      }
    }

    function applyGraph(graph, options = {}) {
      clearEditChrome();
      // paint() restores the previous canvas before resolving roots. Existing
      // lifecycles must remain alive for that restoration; newly inserted
      // lifecycles must exist before the new graph is collected. Reconcile
      // first, then paint, then attach graph-specific edit controls.
      const lifecycleChange = instanceReconciliationNeeded(graph);
      if (lifecycleChange) painter?.prepareForReconcile?.();
      reconcileInstances(graph);
      const incrementalPaint = paintGraph(graph, { incremental: !lifecycleChange });
      const layoutOnly = studioEnabled && options.layoutOnly === true && incrementalPaint;
      // Canvas Studio owns the complete editing vocabulary when enabled. The
      // original C8 chrome only supported three direct siblings and described
      // every other root as a fixed group, which conflicts with the graph and
      // duplicates the new move/resize controls.
      if (!studioEnabled) installEditChrome(graph);
      const records = moduleRecords(graph);
      let directOrder = 0;
      records.forEach(({ node, parentId }) => {
        const element = documentObject.querySelector(`[data-cw-instance-id="${CSS.escape(node.id)}"]`);
        if (!element) return;
        element.dataset.cwParentId = parentId;
        if (DIRECT_WORKSPACE_KEYS.has(node.moduleKey)) {
          element.style.setProperty('--cw-module-order', String(directOrder));
          if (experimentProfile) element.dataset.cwTopologySlot = String(directOrder);
          else delete element.dataset.cwTopologySlot;
          directOrder += 1;
        }
      });
      if (layoutOnly) {
        renderControls();
        scheduleDeferredPresentation(graph);
      } else {
        cancelDeferredPresentation();
        refreshInstanceLayouts(graph);
        renderModulePicker(graph);
        studio?.sync();
      }
    }

    // Painting happens after layout is applied so a committed move actually
    // re-renders instead of only re-ordering. The painter is idempotent: it
    // restores the original DOM before laying the canvas out again.
    function paintGraph(graph, options = {}) {
      if (!painter) return;
      const updatedRoot = options.incremental ? painter.update?.(graph) : null;
      const paintedRoot = updatedRoot || painter.paint(graph);
      if (!paintedRoot) throw new Error('Pixelody Canvas could not find its product workspace surface.');
      try { playerControls?.apply(graph); } catch (error) { console.warn('Player controls layout failed:', error); }
      return Boolean(updatedRoot);
    }

    function mountGraph(graph) {
      applyGraph(graph);
    }

    function destroyInstances() {
      cancelDeferredPresentation();
      clearEditChrome();
      try { studio?.destroy(); } catch (error) { console.warn('Canvas Studio teardown failed:', error); }
      studio = null;
      try { playerControls?.clear(); } catch (error) { console.warn('Player controls teardown failed:', error); }
      try { painter?.destroy(); } catch (error) { console.warn('Pixelody Canvas teardown failed:', error); }
      [...instances.values()].reverse().forEach((instance) => {
        try { instance.destroy(); } catch (error) { console.warn('Pixelody first-party module cleanup failed:', error); }
      });
      instances.clear();
      documentObject.querySelectorAll('[data-cw-topology-slot]').forEach((element) => element.removeAttribute('data-cw-topology-slot'));
    }

    async function activate() {
      if (active) return { ok: true, status: 'already-active' };
      if (activating) return activating;
      activating = (async () => {
        workbench.hidden = studioEnabled;
        setStatus('Loading the authoritative workspace and mounting first-party adapters…');
        const begun = await desktop.reportWorkspaceStartup('begin', { watchdogMs: 5000 });
        if (!begun?.ok) throw new Error(begun?.error || 'Workspace startup receipt was rejected.');
        workspaceRevision = begun.state.revision;
        const loaded = await desktop.loadWorkspaceComposition();
        if (!loaded?.ok || !loaded.state?.graph) throw new Error('Authoritative workspace could not be loaded.');
        workspaceState = loaded.state;
        workspaceRevision = loaded.state.revision;
        if (experimentProfile && workspaceState.creatorDefaultGraph?.id !== `${experimentProfile.PROFILE_ID}-root`) throw new Error('The isolated composable-theme authority was not active.');
        const requestedPreset = studioEnabled ? options.resolveThemePreset?.() : null;
        if (requestedPreset?.graph && workspaceState.graph.id !== requestedPreset.graph.id) {
          const presetCommit = await desktop.saveWorkspaceComposition(requestedPreset.graph, {
            expectedRevision: workspaceRevision,
            activeThemeId: options.activeThemeId || 'dev-lab',
            reason: 'canvas-theme-port-startup-preset',
          });
          if (!presetCommit?.ok) throw new Error(presetCommit?.error || 'The selected Canvas theme preset could not be restored.');
          workspaceState = presetCommit.state;
          workspaceRevision = presetCommit.state.revision;
        }
        session = createWorkspaceSession(workspaceState.graph, requestedPreset?.graph || workspaceState.creatorDefaultGraph);
        if (studioEnabled && !studio) studio = canvasStudio.createStudio({ document: documentObject, bridge: studioBridge() });
        mountGraph(workspaceState.graph);
        studio?.mount(documentObject.body);
        // A canvas still identical to its creator default has never been
        // authored. Opening it in Use Mode hides the only thing on screen
        // worth doing, so a fresh canvas enters Composition Mode itself.
        // Authored profiles can expose the editor without behaving like a
        // blank, unfinished canvas on first launch or after restoring defaults.
        if (studioEnabled && experimentProfile?.START_IN_USE_MODE !== true && workspaceState.graphSignature === workspaceState.creatorSignature) {
          const opened = session.enter();
          if (opened?.ok) {
            renderControls();
            studio?.sync();
            studio?.focusEntry?.();
            setStatus('Canvas Studio open. Place a module from the tray to begin.', 'success');
          }
        }
        const healthy = await desktop.reportWorkspaceStartup('healthy', {});
        if (!healthy?.ok) throw new Error(healthy?.error || 'Workspace healthy receipt was rejected.');
        workspaceState = healthy.state;
        workspaceRevision = healthy.state.revision;
        active = true;
        documentObject.body.classList.add('cw-production-host-active');
        if (experimentProfile) documentObject.body.dataset.cwCompositionProfile = experimentProfile.PROFILE_ID;
        if (profileName) profileName.textContent = experimentProfile?.LABEL || 'Pixelody Canvas Alpha';
        applyGraph(session.snapshot().graph);
        setStatus('First-party production adapters are live. Use Mode is locked.', 'success');
        return { ok: true, status: 'active', revision: workspaceRevision };
      })().catch(async (error) => {
        destroyInstances();
        documentObject.body.classList.remove('cw-production-host-active');
        documentObject.body.dataset.compositionMode = 'use';
        await desktop.reportWorkspaceStartup('failed', { errorCode: String(error?.code || 'C8_HOST_ACTIVATION_FAILED').slice(0, 120) }).catch(() => {});
        setStatus(`Composable host failed closed: ${error.message}`, 'error');
        options.onFailure?.(error);
        return { ok: false, status: 'failed', error: error.message };
      }).finally(() => { activating = null; });
      return activating;
    }

    async function deactivate() {
      if (activating) await activating;
      if (!active) { workbench.hidden = true; return { ok: true, status: 'inactive' }; }
      const snapshot = editingSnapshot();
      if (snapshot.mode === 'edit') session.cancel();
      destroyInstances();
      session = null;
      workspaceState = null;
      workspaceRevision = 0;
      active = false;
      selectedId = '';
      documentObject.body.classList.remove('cw-production-host-active');
      delete documentObject.body.dataset.cwCompositionProfile;
      delete documentObject.body.dataset.cwStudioEnabled;
      if (profileName) profileName.textContent = 'Pixelody Canvas Alpha';
      documentObject.body.dataset.compositionMode = 'use';
      workbench.hidden = true;
      setStatus('Legacy workspace restored.', 'success');
      renderControls();
      return { ok: true, status: 'inactive' };
    }

    async function setActive(shouldActivate) {
      return shouldActivate ? activate() : deactivate();
    }

    async function enterOrFinish() {
      if (!active || !session) return;
      const snapshot = session.snapshot();
      if (snapshot.mode === 'use') {
        const result = session.enter();
        if (result.ok) setStatus('Composition Mode entered. Select a module, then move it or restore the creator layout.', 'success');
        renderControls();
        studio?.sync();
        studio?.focusEntry?.();
        return;
      }
      if (snapshot.dirty) {
        await saveAndExit();
        return;
      }
      session.exit();
      setStatus('Composition Mode exited. Use Mode is locked.', 'success');
      renderControls();
      studio?.sync();
    }

    function undoRedo(direction) {
      const result = direction < 0 ? session?.undo() : session?.redo();
      if (!result?.ok) return;
      applyGraph(result.snapshot.graph);
      setStatus(direction < 0 ? 'Composition edit undone.' : 'Composition edit redone.', 'success');
    }

    function restoreCreator() {
      const result = session?.restoreCreator();
      if (!result?.ok) return;
      applyGraph(result.snapshot.graph);
      setStatus('Creator layout staged. Save to make it authoritative, or Cancel to discard it.', 'warning');
    }

    async function applyThemePreset(preset) {
      if (!active || !session) return { ok: false, status: 'inactive', error: 'Canvas is not active.' };
      if (!preset?.key || !preset?.graph) return { ok: false, status: 'invalid-preset', error: 'Canvas theme preset is incomplete.' };
      const snapshot = editingSnapshot();
      if (snapshot.mode === 'edit' && snapshot.dirty) {
        setStatus('Finish or discard the current Composition Mode draft before switching theme presets.', 'warning');
        return { ok: false, status: 'unsaved-draft', error: 'Composition Mode has unsaved changes.' };
      }
      if (snapshot.graph?.id === preset.graph.id) return { ok: true, status: 'already-active', state: workspaceState };
      if (snapshot.mode === 'edit') session.exit();
      setStatus(`Restoring the stock ${preset.label || preset.key} composition…`);
      const result = await desktop.saveWorkspaceComposition(preset.graph, {
        expectedRevision: workspaceRevision,
        activeThemeId: options.activeThemeId || 'dev-lab',
        reason: 'canvas-theme-port-switch',
      });
      if (!result?.ok) {
        setStatus(result?.error || 'The stock theme composition could not be applied.', 'error');
        return result || { ok: false, status: 'commit-failed', error: 'Workspace commit failed.' };
      }
      workspaceState = result.state;
      workspaceRevision = result.state.revision;
      session = createWorkspaceSession(result.state.graph, preset.graph);
      applyGraph(result.state.graph);
      setStatus(`${preset.label || preset.key} stock composition restored. Use Mode is locked.`, 'success');
      return { ok: true, status: 'applied', state: result.state };
    }

    async function saveAndExit() {
      const snapshot = editingSnapshot();
      if (snapshot.mode !== 'edit') return;
      if (!snapshot.dirty) {
        session.exit();
        setStatus('Composition Mode exited. Use Mode is locked.', 'success');
        renderControls();
        studio?.sync();
        return;
      }
      if (studioEnabled) {
        const reachable = new Set();
        composition.walkGraph(snapshot.graph, (node) => {
          if (node.type !== 'module') return;
          (firstParty.SPEC_BY_KEY[node.moduleKey]?.jobs || []).forEach((job) => reachable.add(job));
        });
        const missing = REQUIRED_JOBS.filter((job) => !reachable.has(job));
        if (missing.length) {
          setStatus(`This canvas cannot be saved yet. Still unplaced: ${missing.join(', ')}.`, 'error');
          return;
        }
      }
      saving = true;
      renderControls();
      setStatus('Validating and committing the complete workspace…');
      let result;
      try {
        result = await desktop.saveWorkspaceComposition(snapshot.graph, { expectedRevision: workspaceRevision, activeThemeId: options.activeThemeId || 'dev-lab', reason: 'c8-production-host-save' });
      } catch (error) {
        saving = false;
        setStatus(`Workspace commit failed; the draft remains open. ${error?.message || ''}`.trim(), 'error');
        renderControls();
        return;
      }
      if (!result?.ok) {
        saving = false;
        setStatus(result?.error || 'Workspace commit failed; the draft remains open.', 'error');
        renderControls();
        return;
      }
      workspaceState = result.state;
      workspaceRevision = result.state.revision;
      session.save();
      saving = false;
      applyGraph(result.state.graph);
      setStatus('Workspace saved atomically. Composition Mode exited and Use Mode is locked.', 'success');
    }

    async function cancelAndExit() {
      const snapshot = editingSnapshot();
      if (snapshot.mode !== 'edit') return;
      const result = await desktop.cancelWorkspaceComposition({ expectedRevision: workspaceRevision });
      if (!result?.ok) {
        setStatus(result?.error || 'Workspace cancellation could not confirm current authority.', 'error');
        return;
      }
      const cancelled = session.cancel();
      applyGraph(cancelled.snapshot.graph);
      setStatus('Draft discarded. Composition Mode exited without a durable write.', 'success');
    }

    controls.mode.addEventListener('click', enterOrFinish);
    controls.undo.addEventListener('click', () => undoRedo(-1));
    controls.redo.addEventListener('click', () => undoRedo(1));
    controls.restore.addEventListener('click', restoreCreator);
    controls.cancel.addEventListener('click', cancelAndExit);
    controls.legacy.addEventListener('click', () => options.returnToLegacy?.());
    moduleSelect.addEventListener('change', () => setSelected(moduleSelect.value));
    documentObject.addEventListener('click', (event) => {
      if (!active || editingSnapshot().mode !== 'edit') return;
      const root = event.target.closest?.('[data-cw-instance-id]');
      if (!root) return;
      setSelected(root.dataset.cwInstanceId);
    }, true);
    documentObject.addEventListener('pointermove', updateDrag);
    documentObject.addEventListener('pointerup', finishDrag);
    documentObject.addEventListener('pointercancel', (event) => {
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      clearInteraction('Drag canceled without changing the layout.');
    });

    renderControls();
    return Object.freeze({
      activate,
      deactivate,
      setActive,
      applyThemePreset,
      isActive: () => active,
      snapshot: () => Object.freeze({ active, workspaceRevision, selectedId, statusTone, session: session?.snapshot?.() || null }),
    });
  }

  return Object.freeze({ REQUIRED_JOBS, DIRECT_WORKSPACE_KEYS, moduleRecords, siblingRecords, createHost });
}));
