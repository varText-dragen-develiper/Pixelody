(function pixelodyWorkspaceDevLabHostFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports ? require('./contract') : root.PixelodyWorkspaceCompositionContract;
  const specimens = typeof module === 'object' && module.exports ? require('./dev-lab-specimens') : root.PixelodyWorkspaceDevLabSpecimens;
  const compositionSession = typeof module === 'object' && module.exports ? require('./composition-session') : root.PixelodyWorkspaceCompositionSession;
  const interactionAdapter = typeof module === 'object' && module.exports ? require('./interaction-adapter') : root.PixelodyWorkspaceInteractionAdapter;
  const api = factory(composition, specimens, compositionSession, interactionAdapter);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceDevLabHost = api;
  if (root?.document) {
    const start = () => api.initialize(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceDevLabHostApi(composition, specimens, compositionSession, interactionAdapter) {
  'use strict';

  if (!composition || !specimens || !compositionSession || !interactionAdapter) throw new Error('Workspace Dev Lab host requires composition, specimen, session, and interaction contracts.');

  const WIDTHS = Object.freeze({ wide: 1180, intermediate: 820, narrow: 430 });

  function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function bundleKey(specimen) {
    return specimen.reads[0] || '';
  }

  function renderSpecimen(document, specimen, context, target) {
    target.replaceChildren();
    const shell = element(document, 'div', 'cw-module-shell');
    const head = element(document, 'div', 'cw-module-head');
    head.append(element(document, 'span', '', specimen.kicker), element(document, 'b', '', specimen.key));
    const body = element(document, 'div', 'cw-module-body');
    const snapshot = context.read(bundleKey(specimen));
    body.append(element(document, 'h3', '', specimen.label));

    if (specimen.kind === 'library') {
      body.append(element(document, 'p', '', `${snapshot.collection} · locally owned and indexed`));
      const metric = element(document, 'div', 'cw-metric');
      metric.append(element(document, 'strong', '', String(snapshot.tracks)), element(document, 'span', '', `${snapshot.albums} ALBUMS / ${snapshot.playlists} PLAYLISTS`));
      body.append(metric);
    } else if (specimen.kind === 'tracks') {
      body.append(element(document, 'p', '', 'Deterministic collection order · source format remains literal'));
      const list = element(document, 'div', 'cw-track-list');
      snapshot.forEach((track, index) => {
        const row = element(document, 'div', 'cw-track-row');
        row.append(element(document, 'b', '', `${String(index + 1).padStart(2, '0')}  ${track.title} · ${track.artist}`), element(document, 'span', '', `${track.duration} / ${track.format}`));
        list.append(row);
      });
      body.append(list);
    } else if (specimen.kind === 'queue') {
      body.append(element(document, 'p', '', `${snapshot.remaining} deterministic items remain`));
      const list = element(document, 'div', 'cw-queue-list');
      snapshot.items.forEach((title, index) => {
        const row = element(document, 'div', 'cw-queue-row');
        row.append(element(document, 'b', '', title), element(document, 'span', '', index ? `+${index + 1}` : 'NEXT'));
        list.append(row);
      });
      body.append(list);
    } else if (specimen.kind === 'information') {
      body.append(element(document, 'p', '', 'Truthful file and output facts; no bit-perfect claim.'));
      const grid = element(document, 'div', 'cw-info-grid');
      Object.entries(snapshot).forEach(([key, value]) => {
        const cell = element(document, 'div');
        cell.append(element(document, 'small', '', key), element(document, 'b', '', value));
        grid.append(cell);
      });
      body.append(grid);
    } else if (specimen.kind === 'signal') {
      body.append(element(document, 'p', '', 'Decorative normalized frame · one shared scheduler declared'));
      const bars = element(document, 'div', 'cw-signal-bars');
      snapshot.bars.forEach((value, index) => {
        const bar = element(document, 'i');
        bar.setAttribute('aria-hidden', 'true');
        bar.style.setProperty('--bar', String(value));
        bar.style.setProperty('--index', String(index));
        bars.append(bar);
      });
      body.append(bars);
    } else if (specimen.kind === 'transport') {
      body.append(element(document, 'p', '', snapshot.playing ? 'Playing through controlled host commands' : 'Paused through controlled host commands'));
      const controls = element(document, 'div', 'cw-transport-buttons');
      [['playback.previous', 'Previous', '←'], ['playback.toggle', snapshot.playing ? 'Pause' : 'Play', snapshot.playing ? 'Ⅱ' : '▶'], ['playback.next', 'Next', '→']].forEach(([command, label, glyph]) => {
        const button = element(document, 'button', '', glyph);
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => context.command(command, { source: 'composition-lab' }));
        controls.append(button);
      });
      body.append(controls);
    } else if (specimen.kind === 'now-playing') {
      body.append(element(document, 'p', '', `${snapshot.artist} · ${snapshot.album}`));
      body.append(element(document, 'div', 'cw-quality', snapshot.quality));
      const metric = element(document, 'div', 'cw-metric');
      metric.append(element(document, 'strong', '', snapshot.title), element(document, 'span', '', `${snapshot.position}s / ${snapshot.duration}s`));
      body.append(metric);
    } else if (specimen.kind === 'artwork') {
      body.append(element(document, 'p', '', `${snapshot.artist} · ${snapshot.album}`));
      const artwork = element(document, 'div', 'cw-artwork-specimen');
      artwork.setAttribute('aria-label', `Original geometric artwork placeholder for ${snapshot.title}`);
      artwork.append(element(document, 'span', '', 'NA'), element(document, 'b', '', snapshot.title));
      body.append(artwork);
    } else if (specimen.kind === 'lyrics') {
      body.append(element(document, 'p', '', snapshot.available ? 'Local lyric fixture · synchronized timing not claimed' : 'No lyrics available'));
      const lyrics = element(document, 'div', 'cw-lyrics-specimen');
      snapshot.lines.forEach((line, index) => lyrics.append(element(document, 'p', index === 1 ? 'active' : '', line)));
      body.append(lyrics);
    }
    shell.append(head, body);
    target.append(shell);
  }

  function createLifecycle(document, specimen, context) {
    let target = null;
    let configuration = {};
    function paint() { if (target) renderSpecimen(document, specimen, context, target); }
    return {
      mount(payload) { target = payload.surface; configuration = payload.configuration; target.dataset.shape = payload.layout.shape; paint(); },
      update(payload) { configuration = payload.configuration; paint(); },
      setLayout(layout) { if (target) target.dataset.shape = layout.shape; },
      setVisibility(visibility) { if (target) { target.hidden = !visibility.visible; target.dataset.visibilityReason = visibility.reason; } },
      focus() { target?.focus(); return Boolean(target); },
      serializeConfiguration() { return configuration; },
      destroy() { target?.replaceChildren(); target = null; },
    };
  }

  function createFallbackLifecycle(document, specimen) {
    let target = null;
    return {
      mount(payload) {
        target = payload.surface;
        target.dataset.shape = payload.layout.shape;
        const copy = element(document, 'div', 'cw-module-body cw-fallback-copy');
        copy.append(element(document, 'strong', '', `${specimen.label} fallback`), element(document, 'p', '', 'The primary factory failed deliberately. This product-owned neutral surface preserved the job and shape.'));
        target.replaceChildren(copy);
      },
      update() {},
      setLayout(layout) { if (target) target.dataset.shape = layout.shape; },
      setVisibility(visibility) { if (target) target.hidden = !visibility.visible; },
      focus() { target?.focus(); return Boolean(target); },
      serializeConfiguration() { return {}; },
      destroy() { target?.replaceChildren(); target = null; },
    };
  }

  function initialize(document) {
    const stage = document.querySelector('#composition-stage');
    if (!stage) return null;
    const viewport = document.querySelector('#cw-preview-viewport');
    const status = document.querySelector('#cw-status');
    const failureControl = document.querySelector('#cw-failure');
    const motionControl = document.querySelector('#cw-motion');
    const remountControl = document.querySelector('#cw-remount');
    const modeToggle = document.querySelector('#cw-mode-toggle');
    const widthControls = [...document.querySelectorAll('[data-width-mode]')];
    const edit = {
      fieldset: document.querySelector('#cw-edit-fieldset'),
      target: document.querySelector('#cw-edit-target'),
      splitAxis: document.querySelector('#cw-split-axis'),
      replacement: document.querySelector('#cw-replacement'),
      shape: document.querySelector('#cw-shape'),
      modeState: document.querySelector('#cw-mode-state'),
      guidance: document.querySelector('#cw-edit-guidance'),
      announcement: document.querySelector('#cw-edit-announcement'),
      undo: document.querySelector('#cw-undo'),
      redo: document.querySelector('#cw-redo'),
      cancel: document.querySelector('#cw-cancel'),
      save: document.querySelector('#cw-save'),
      restore: document.querySelector('#cw-restore'),
      layoutName: document.querySelector('#cw-layout-name'),
      saveAs: document.querySelector('#cw-save-as'),
      savedLayout: document.querySelector('#cw-saved-layout'),
      applySaved: document.querySelector('#cw-apply-saved'),
      resizeFieldset: document.querySelector('#cw-resize-fieldset'),
      resizeSplit: document.querySelector('#cw-resize-split'),
      resizeRatio: document.querySelector('#cw-resize-ratio'),
      resizeOutput: document.querySelector('#cw-resize-output'),
      resizeApply: document.querySelector('#cw-resize-apply'),
      resizeEqual: document.querySelector('#cw-resize-equal'),
    };
    const inspector = {
      hostState: document.querySelector('#cw-host-state'),
      signature: document.querySelector('#cw-graph-signature'),
      tier: document.querySelector('#cw-inspector-tier'),
      selected: document.querySelector('#cw-selected'),
      operation: document.querySelector('#cw-operation'),
      interaction: document.querySelector('#cw-interaction-state'),
      error: document.querySelector('#cw-error'),
      constraints: document.querySelector('#cw-constraints'),
      graph: document.querySelector('#cw-graph'),
      tierOutput: document.querySelector('#cw-tier-output'),
    };
    const state = {
      failureModuleKey: '',
      widthMode: 'wide',
      selectedId: '',
      operation: 'initialize',
      lastError: '',
      instances: new Map(),
      elements: new Map(),
      containers: new Map(),
      registry: null,
      session: null,
      graph: null,
      projection: null,
      playback: { ...specimens.FIXTURE.playback },
      editSerial: 0,
      suppressHandleClick: false,
      interaction: { phase: 'idle', pointerId: null, sourceId: '', targetId: '', intent: null, startX: 0, startY: 0, ghost: null, suppressClick: false, splitId: '', startWeights: null, previewWeights: null, totalPixels: 0, axis: 'horizontal' },
    };

    function setOperation(value) { state.operation = value; inspector.operation.textContent = value; }
    function setError(value) { state.lastError = value || ''; inspector.error.textContent = state.lastError || 'None'; }
    function bundle(key) {
      if (key === 'lab.failure') return { moduleKey: state.failureModuleKey };
      if (key === 'library.summary') return specimens.FIXTURE.library;
      if (key === 'tracks.list') return specimens.FIXTURE.tracks;
      if (key === 'queue.snapshot') return specimens.FIXTURE.queue;
      if (key === 'playback.snapshot') return state.playback;
      if (key === 'track.information') return specimens.FIXTURE.information;
      if (key === 'signal.frame') return specimens.FIXTURE.signal;
      if (key === 'lyrics.snapshot') return specimens.FIXTURE.lyrics;
      throw Object.assign(new Error(`Unknown lab bundle "${key}".`), { code: 'LAB_BUNDLE_UNKNOWN' });
    }
    function updatePlaybackInstances() {
      state.instances.forEach((instance) => {
        if (['transport.controls', 'now-playing'].includes(instance.requestedKey) && !instance.usedFallback) instance.update(instance.snapshot().configuration, 'fixture-command');
      });
    }
    const host = {
      read: bundle,
      subscribe() { return () => {}; },
      command(key) {
        if (key === 'playback.toggle') state.playback = { ...state.playback, playing: !state.playback.playing };
        if (key === 'playback.next') state.playback = { ...state.playback, title: 'Soft Machine Weather', artist: 'Mara Vale', album: 'Public Weather', position: 0, duration: 227 };
        if (key === 'playback.previous') state.playback = { ...specimens.FIXTURE.playback };
        setOperation(`module-command:${key}`);
        updatePlaybackInstances();
        status.textContent = `Accepted ${key} through the host command adapter.`;
        return { accepted: true };
      },
      announce(message) { status.textContent = message; },
    };

    function option(documentValue, value, label) {
      const node = element(documentValue, 'option', '', label);
      node.value = value;
      return node;
    }

    function moduleNodes(graph = state.graph) {
      const result = [];
      composition.walkGraph(graph, (node) => { if (node.type === 'module') result.push(node); });
      return result;
    }

    function explainError(error) {
      if (!error) return 'The composition command was rejected.';
      const validationError = error.errors?.[0] || error.cause?.errors?.[0] || error.cause;
      if (validationError?.message) return `${error.code}: ${validationError.message}`;
      return `${error.code || 'COMPOSITION_COMMAND_REJECTED'}: ${error.message || 'The command was rejected.'}`;
    }

    function announce(message, error = false) {
      edit.announcement.textContent = message;
      edit.announcement.dataset.error = String(error);
      status.textContent = message;
    }

    function splitNodes(graph = state.graph) {
      const result = [];
      composition.walkGraph(graph, (node) => { if (node.type === 'split') result.push(node); });
      return result;
    }

    function setInteractionState(label) {
      if (inspector.interaction) inspector.interaction.textContent = label;
    }

    function clearInteractionPaint(options = {}) {
      document.querySelectorAll('[data-drop-intent]').forEach((node) => { delete node.dataset.dropIntent; delete node.dataset.dropLabel; });
      document.querySelectorAll('[data-place-compatible]').forEach((node) => { delete node.dataset.placeCompatible; });
      document.querySelectorAll('.cw-reflow-neighbor').forEach((node) => node.classList.remove('cw-reflow-neighbor'));
      state.interaction.ghost?.remove();
      document.body.dataset.pointerPhase = 'idle';
      const suppressClick = options.keepSuppressClick ? state.interaction.suppressClick : false;
      state.interaction = { phase: 'idle', pointerId: null, sourceId: '', targetId: '', intent: null, startX: 0, startY: 0, ghost: null, suppressClick, splitId: '', startWeights: null, previewWeights: null, totalPixels: 0, axis: 'horizontal' };
      setInteractionState('Idle');
    }

    function legalIntent(kind, sourceId, targetId) {
      return interactionAdapter.rankLegalDropIntents(state.graph, { sourceId, targetId, xRatio: 0.5, yRatio: 0.5 }).find((entry) => entry.kind === kind) || null;
    }

    function commitIntent(dropIntent, route, message) {
      if (!dropIntent) {
        announce('That placement is not legal for the selected source and target.', true);
        return false;
      }
      state.editSerial += 1;
      const operation = interactionAdapter.operationForIntent(dropIntent, { route, serial: state.editSerial });
      return handleSessionResult(state.session.apply(operation), message || `${dropIntent.label}: ${dropIntent.sourceId} → ${dropIntent.targetId}.`);
    }

    function showDropPreview(target, dropIntent) {
      document.querySelectorAll('[data-drop-intent]').forEach((node) => { delete node.dataset.dropIntent; delete node.dataset.dropLabel; });
      document.querySelectorAll('.cw-reflow-neighbor').forEach((node) => node.classList.remove('cw-reflow-neighbor'));
      if (!target || !dropIntent) {
        state.interaction.targetId = '';
        state.interaction.intent = null;
        setInteractionState(state.interaction.phase === 'dragging' ? 'Dragging · no legal target' : 'Idle');
        return;
      }
      target.dataset.dropIntent = dropIntent.kind;
      target.dataset.dropLabel = dropIntent.label;
      [...(target.parentElement?.children || [])].filter((node) => node.classList?.contains('cw-module') && node !== target).forEach((node) => node.classList.add('cw-reflow-neighbor'));
      state.interaction.targetId = dropIntent.targetId;
      state.interaction.intent = dropIntent;
      if (state.interaction.ghost) state.interaction.ghost.textContent = `${state.interaction.sourceId} · ${dropIntent.label}`;
      setInteractionState(`${dropIntent.label} → ${dropIntent.targetId}`);
    }

    function beginPick(sourceId) {
      if (state.session.snapshot().mode !== 'edit') return;
      clearInteractionPaint();
      selectModule(sourceId);
      state.interaction.phase = 'picked';
      state.interaction.sourceId = sourceId;
      document.body.dataset.pointerPhase = 'picked';
      interactionAdapter.compatibleTargets(state.graph, sourceId).forEach((targetId) => { if (state.elements.has(targetId)) state.elements.get(targetId).dataset.placeCompatible = 'true'; });
      setInteractionState(`Picked ${sourceId}`);
      announce(`Picked up ${sourceId}. Use a labeled Place before or Place after button on a compatible module.`);
      state.elements.get(sourceId)?.focus();
    }

    function placePicked(targetId, kind) {
      const sourceId = state.interaction.sourceId;
      if (state.interaction.phase !== 'picked' || !sourceId) return false;
      const dropIntent = legalIntent(kind, sourceId, targetId);
      clearInteractionPaint();
      return commitIntent(dropIntent, 'click', `${dropIntent?.label || 'Place'}: ${sourceId} → ${targetId}.`);
    }

    function createGhost(sourceId, x, y) {
      const ghost = element(document, 'div', 'cw-drag-ghost', `Moving ${sourceId}`);
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.transform = `translate3d(${x + 14}px,${y + 14}px,0)`;
      document.body.append(ghost);
      return ghost;
    }

    function updateDrag(event) {
      const interaction = state.interaction;
      if (interaction.phase === 'pending' && Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) >= 6) {
        interaction.phase = 'dragging';
        interaction.ghost = createGhost(interaction.sourceId, event.clientX, event.clientY);
        document.body.dataset.pointerPhase = 'dragging';
      }
      if (interaction.phase !== 'dragging') return;
      interaction.ghost.style.transform = `translate3d(${event.clientX + 14}px,${event.clientY + 14}px,0)`;
      const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.cw-module');
      const targetId = hit?.dataset.nodeId || '';
      const rect = hit?.getBoundingClientRect();
      const ranked = rect ? interactionAdapter.rankLegalDropIntents(state.graph, { sourceId: interaction.sourceId, targetId, point: { x: event.clientX, y: event.clientY }, targetRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }) : [];
      showDropPreview(hit, ranked[0] || null);
      const viewportRect = viewport.getBoundingClientRect();
      const visibleTop = Math.max(0, viewportRect.top);
      const visibleBottom = Math.min(document.documentElement.clientHeight, viewportRect.bottom);
      const delta = interactionAdapter.autoscrollDelta(event.clientY - visibleTop, Math.max(1, visibleBottom - visibleTop));
      if (delta && !event.target.closest('[data-cw-native-scroll],input,select,textarea,a')) {
        const scrollOwner = viewport.scrollHeight > viewport.clientHeight ? viewport : document.scrollingElement;
        scrollOwner?.scrollBy({ top: delta, behavior: 'auto' });
      }
    }

    function previewSplitWeights(splitElement, weights) {
      if (!splitElement || !weights) return;
      splitElement.style.setProperty('--cw-split-a', `${weights[0]}fr`);
      splitElement.style.setProperty('--cw-split-b', `${weights[1]}fr`);
      splitElement.style.setProperty('--cw-split-ratio', String(weights[0] / (weights[0] + weights[1])));
    }

    function commitResize(splitId, weights, route) {
      if (!splitId || !weights) return false;
      return handleSessionResult(state.session.apply({ type: 'resizeSplit', splitId, weights }), `Resized ${splitId} to ${Math.round(weights[0] * 100)} / ${Math.round(weights[1] * 100)} through the ${route} route.`);
    }

    function updateResize(event) {
      const interaction = state.interaction;
      if (interaction.phase !== 'resizing') return;
      const coordinate = interaction.axis === 'horizontal' ? event.clientX : event.clientY;
      const start = interaction.axis === 'horizontal' ? interaction.startX : interaction.startY;
      interaction.previewWeights = interactionAdapter.resizeWeights(interaction.startWeights, coordinate - start, interaction.totalPixels);
      previewSplitWeights(state.containers.get(interaction.splitId), interaction.previewWeights);
      setInteractionState(`Resize ${interaction.splitId} · ${Math.round(interaction.previewWeights[0] * 100)} / ${Math.round(interaction.previewWeights[1] * 100)}`);
    }

    function finishPointer(event) {
      const interaction = state.interaction;
      if (interaction.pointerId !== event.pointerId) return;
      if (interaction.phase === 'dragging') {
        const dropIntent = interaction.intent;
        const sourceId = interaction.sourceId;
        state.suppressHandleClick = true;
        clearInteractionPaint();
        if (dropIntent) commitIntent(dropIntent, 'pointer', `${dropIntent.label}: ${sourceId} → ${dropIntent.targetId}.`);
        else announce(`Canceled drag for ${sourceId}; no legal target was active.`);
        setTimeout(() => { state.suppressHandleClick = false; }, 0);
      } else if (interaction.phase === 'resizing') {
        const splitId = interaction.splitId;
        const weights = interaction.previewWeights || interaction.startWeights;
        clearInteractionPaint();
        commitResize(splitId, weights, 'pointer');
      } else if (interaction.phase === 'pending') {
        state.interaction.phase = 'idle';
        state.interaction.pointerId = null;
        setInteractionState('Idle');
      }
    }

    function refreshEditChoices() {
      if (!state.graph || !state.registry) return;
      const selected = composition.findNode(state.graph, state.selectedId)?.node;
      const nodes = moduleNodes();
      const selectedLocation = composition.findNode(state.graph, state.selectedId);
      const priorTarget = edit.target.value;
      edit.target.replaceChildren();
      const structuralTargets = selectedLocation?.parent?.type === 'grid'
        ? nodes.filter((node) => node.id !== state.selectedId && composition.findNode(state.graph, node.id)?.parent?.id === selectedLocation.parent.id)
        : [];
      if (!structuralTargets.length) edit.target.append(option(document, '', 'No compatible sibling target'));
      structuralTargets.forEach((node) => edit.target.append(option(document, node.id, `${state.registry.get(node.moduleKey)?.accessibility.name || node.moduleKey} · ${node.id}`)));
      if ([...edit.target.options].some((entry) => entry.value === priorTarget)) edit.target.value = priorTarget;
      document.querySelectorAll('[data-edit-command="move-before"],[data-edit-command="move-after"],[data-edit-command="split-before"],[data-edit-command="split-after"],[data-edit-command="stack"]').forEach((button) => { button.disabled = !structuralTargets.length || state.session?.snapshot().mode !== 'edit'; });

      const mountedKeys = new Set(nodes.map((node) => node.moduleKey));
      const priorReplacement = edit.replacement.value;
      edit.replacement.replaceChildren();
      specimens.CATALOG_SPECIMENS.filter((specimen) => specimen.key !== selected?.moduleKey && (!mountedKeys.has(specimen.key) || specimen.instancePolicy === 'multiple')).forEach((specimen) => edit.replacement.append(option(document, specimen.key, specimen.label)));
      if ([...edit.replacement.options].some((entry) => entry.value === priorReplacement)) edit.replacement.value = priorReplacement;

      const descriptor = selected?.type === 'module' ? state.registry.get(selected.moduleKey) : null;
      edit.shape.replaceChildren();
      Object.keys(descriptor?.shapes || {}).forEach((shape) => edit.shape.append(option(document, shape, shape)));
      if (selected && [...edit.shape.options].some((entry) => entry.value === selected.shape)) edit.shape.value = selected.shape;

      const priorSplit = edit.resizeSplit.value;
      const splits = splitNodes();
      edit.resizeSplit.replaceChildren();
      if (!splits.length) edit.resizeSplit.append(option(document, '', 'No split container'));
      splits.forEach((split) => edit.resizeSplit.append(option(document, split.id, `${split.id} · ${split.axis}`)));
      if (splits.some((split) => split.id === priorSplit)) edit.resizeSplit.value = priorSplit;
      const activeSplit = splits.find((split) => split.id === edit.resizeSplit.value) || splits[0];
      if (activeSplit) {
        const total = activeSplit.weights.reduce((sum, value) => sum + value, 0);
        edit.resizeRatio.value = String(Math.round((activeSplit.weights[0] / total) * 100));
        edit.resizeOutput.textContent = `${edit.resizeRatio.value}%`;
      }
      edit.resizeFieldset.disabled = state.session?.snapshot().mode !== 'edit' || !activeSplit;
    }

    function syncSessionUi(message = '') {
      const session = state.session?.snapshot();
      if (!session) return;
      const editing = session.mode === 'edit';
      document.body.dataset.compositionMode = session.mode;
      modeToggle.setAttribute('aria-pressed', String(editing));
      modeToggle.textContent = editing ? 'Exit Composition Mode' : 'Enter Composition Mode';
      edit.modeState.textContent = editing ? session.dirty ? 'EDITING · UNSAVED' : 'EDITING · CLEAN' : 'USE MODE';
      edit.guidance.textContent = editing ? 'Drag only from MOVE handles, resize only from separators, or click MOVE then a labeled placement. Menu and keyboard routes remain available.' : 'Enter Composition Mode to edit the graph. Ordinary module controls remain independent.';
      edit.fieldset.disabled = !editing;
      edit.undo.disabled = !session.canUndo;
      edit.redo.disabled = !session.canRedo;
      edit.cancel.disabled = !editing;
      edit.save.disabled = !editing;
      edit.restore.disabled = !editing;
      edit.layoutName.disabled = !editing;
      edit.saveAs.disabled = !editing;
      edit.savedLayout.disabled = !editing || !session.savedLayouts.length;
      edit.applySaved.disabled = !editing || !session.savedLayouts.length;
      edit.resizeFieldset.disabled = !editing;
      const selectedSaved = edit.savedLayout.value;
      edit.savedLayout.replaceChildren();
      if (!session.savedLayouts.length) edit.savedLayout.append(option(document, '', 'None saved'));
      else session.savedLayouts.forEach((name) => edit.savedLayout.append(option(document, name, name)));
      if (session.savedLayouts.includes(selectedSaved)) edit.savedLayout.value = selectedSaved;
      if (message) announce(message);
      if (!editing && state.interaction.phase !== 'idle') clearInteractionPaint();
      refreshEditChoices();
    }

    function handleSessionResult(result, successMessage, options = {}) {
      if (!result.ok) {
        const explanation = explainError(result.error);
        setError(explanation);
        announce(explanation, true);
        syncSessionUi();
        return false;
      }
      state.graph = result.snapshot.graph;
      setError('');
      if (options.render !== false) mountGraph();
      syncSessionUi(successMessage);
      return true;
    }

    function applyEditOperation(operation, successMessage) {
      if (!state.selectedId) {
        announce('Select a module before applying a composition command.', true);
        return false;
      }
      return handleSessionResult(state.session.apply(operation), successMessage);
    }

    function selectedAndTarget() {
      return { sourceId: state.selectedId, targetId: edit.target.value };
    }

    function runEditCommand(command) {
      const pair = selectedAndTarget();
      if (['move-before', 'move-after', 'split-before', 'split-after', 'stack'].includes(command) && !pair.targetId) {
        announce('The selected module has no compatible sibling target for that structural command.', true);
        return false;
      }
      state.editSerial += 1;
      if (command === 'move-before' || command === 'move-after') return applyEditOperation({ type: command === 'move-before' ? 'moveBefore' : 'moveAfter', ...pair }, `Moved ${pair.sourceId} ${command === 'move-before' ? 'before' : 'after'} ${pair.targetId}.`);
      if (command === 'split-before' || command === 'split-after') return applyEditOperation({ type: 'splitWith', ...pair, splitId: `edit-split-${state.editSerial}`, axis: edit.splitAxis.value, position: command === 'split-before' ? 'before' : 'after', weights: [1, 1] }, `Split ${pair.sourceId} and ${pair.targetId} ${edit.splitAxis.value}ly.`);
      if (command === 'stack') return applyEditOperation({ type: 'stackWith', ...pair, stackId: `edit-stack-${state.editSerial}`, position: 'after', activeChildId: pair.sourceId }, `Stacked ${pair.sourceId} with ${pair.targetId}.`);
      if (command === 'replace') return applyEditOperation({ type: 'replaceModule', moduleId: state.selectedId, moduleKey: edit.replacement.value }, `Replaced ${state.selectedId} with ${edit.replacement.options[edit.replacement.selectedIndex]?.text || edit.replacement.value}.`);
      if (command === 'shape') return applyEditOperation({ type: 'setModuleShape', moduleId: state.selectedId, shape: edit.shape.value }, `Changed ${state.selectedId} to ${edit.shape.value} shape.`);
      if (command === 'reset-module') return applyEditOperation({ type: 'resetModule', moduleId: state.selectedId }, `Reset ${state.selectedId} to its registered defaults.`);
      if (command === 'hide') return applyEditOperation({ type: 'removeOptionalModule', sourceId: state.selectedId }, `Hid optional module ${state.selectedId}.`);
      announce(`Unknown edit command ${command}.`, true);
      return false;
    }

    function selectModule(id) {
      state.selectedId = id;
      state.elements.forEach((node, key) => { node.dataset.selected = String(key === id); });
      const graphNode = composition.findNode(state.graph, id)?.node;
      const descriptor = graphNode ? state.registry.get(graphNode.moduleKey) : null;
      inspector.selected.textContent = graphNode ? `${id} / ${graphNode.moduleKey}` : 'None';
      inspector.constraints.textContent = descriptor ? JSON.stringify({ requestedShape: graphNode.shape, projectedShape: state.projection.shapes[id], supportedShapes: Object.keys(descriptor.shapes), instancePolicy: descriptor.instancePolicy, performance: descriptor.performance, accessibility: descriptor.accessibility, productJobs: descriptor.productJobs }, null, 2) : 'Select a module.';
      refreshEditChoices();
    }

    function renderNode(node, activeStackChildId = '') {
      let target;
      if (node.type === 'module') {
        target = element(document, 'article', 'cw-node cw-module');
        target.id = `paint-${node.id}`;
        target.tabIndex = 0;
        target.dataset.nodeId = node.id;
        target.setAttribute('aria-label', `${state.registry.get(node.moduleKey).accessibility.name} module`);
        target.addEventListener('click', (event) => { if (!event.target.closest('button')) { selectModule(node.id); setOperation(`select:${node.id}`); } });
        const descriptor = state.registry.get(node.moduleKey);
        const shape = state.projection.shapes[node.id];
        const shapeContext = descriptor.shapes[shape];
        const instance = state.registry.createInstance({ moduleKey: node.moduleKey, instanceId: node.id, configuration: node.configuration, layout: { shape, inlineSize: shapeContext.targetInline, blockSize: shapeContext.targetBlock, motionAllowed: document.body.dataset.motion !== 'off', conserve: false }, visibility: activeStackChildId ? { visible: node.id === activeStackChildId, reason: node.id === activeStackChildId ? 'visible' : 'stack-inactive' } : true }, host);
        target.dataset.fallback = String(instance.usedFallback);
        instance.mount(target);
        const editChrome = element(document, 'div', 'cw-module-edit-chrome');
        const dragHandle = element(document, 'button', 'cw-drag-handle', 'MOVE');
        dragHandle.type = 'button';
        dragHandle.setAttribute('aria-label', `Drag or pick up ${descriptor.accessibility.name}`);
        dragHandle.title = 'Drag to a ranked target, or click then choose Place before/after.';
        dragHandle.addEventListener('pointerdown', (event) => {
          const allowed = interactionAdapter.pointerStartAllowed({ mode: state.session.snapshot().mode, primaryButton: event.button === 0, dedicatedHandle: true, nestedInteractive: Boolean(event.target.closest('button:not(.cw-drag-handle),input,select,textarea,a,[data-cw-native-scroll]')) });
          if (!allowed) return;
          event.preventDefault();
          event.stopPropagation();
          clearInteractionPaint();
          state.interaction.phase = 'pending';
          state.interaction.pointerId = event.pointerId;
          state.interaction.sourceId = node.id;
          state.interaction.startX = event.clientX;
          state.interaction.startY = event.clientY;
          dragHandle.setPointerCapture?.(event.pointerId);
          selectModule(node.id);
          setInteractionState(`Ready to move ${node.id}`);
        });
        dragHandle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (state.suppressHandleClick) { state.suppressHandleClick = false; return; }
          if (state.session.snapshot().mode !== 'edit') return;
          if (state.interaction.phase === 'picked' && state.interaction.sourceId === node.id) {
            clearInteractionPaint();
            announce(`Canceled picked module ${node.id}.`);
          } else beginPick(node.id);
        });
        const placeControls = element(document, 'div', 'cw-place-controls');
        [['move-before', 'Place before'], ['move-after', 'Place after']].forEach(([kind, label]) => {
          const place = element(document, 'button', '', label);
          place.type = 'button';
          place.dataset.placeKind = kind;
          place.setAttribute('aria-label', `${label} ${descriptor.accessibility.name}`);
          place.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); placePicked(node.id, kind); });
          placeControls.append(place);
        });
        editChrome.append(dragHandle, placeControls);
        target.append(editChrome);
        state.instances.set(node.id, instance);
        state.elements.set(node.id, target);
        return target;
      }
      target = element(document, 'div', `cw-node cw-${node.type}`);
      target.dataset.nodeId = node.id;
      state.containers.set(node.id, target);
      if (node.type === 'root') target.append(renderNode(node.children[0]));
      else if (node.type === 'split') {
        const paintedAxis = node.id === 'workspace-split' ? state.projection.splitAxis : node.axis;
        target.dataset.axis = paintedAxis;
        previewSplitWeights(target, node.weights);
        node.children.forEach((child) => target.append(renderNode(child)));
        const resizeHandle = element(document, 'button', 'cw-resize-handle', '');
        resizeHandle.type = 'button';
        resizeHandle.dataset.splitId = node.id;
        resizeHandle.setAttribute('aria-label', `Resize ${node.id} ${paintedAxis} split`);
        resizeHandle.setAttribute('aria-orientation', paintedAxis);
        resizeHandle.title = 'Drag to resize. Arrow keys resize in five-percent steps.';
        resizeHandle.addEventListener('pointerdown', (event) => {
          if (state.session.snapshot().mode !== 'edit' || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          clearInteractionPaint();
          const rect = target.getBoundingClientRect();
          const activeAxis = target.dataset.axis;
          state.interaction.phase = 'resizing';
          state.interaction.pointerId = event.pointerId;
          state.interaction.splitId = node.id;
          state.interaction.startWeights = [...node.weights];
          state.interaction.previewWeights = [...node.weights];
          state.interaction.startX = event.clientX;
          state.interaction.startY = event.clientY;
          state.interaction.axis = activeAxis;
          state.interaction.totalPixels = activeAxis === 'horizontal' ? rect.width : rect.height;
          document.body.dataset.pointerPhase = 'resizing';
          resizeHandle.setPointerCapture?.(event.pointerId);
          setInteractionState(`Resize ${node.id}`);
        });
        resizeHandle.addEventListener('keydown', (event) => {
          if (state.session.snapshot().mode !== 'edit') return;
          const activeAxis = target.dataset.axis;
          const decrement = activeAxis === 'horizontal' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
          const increment = activeAxis === 'horizontal' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
          if (!decrement && !increment) return;
          event.preventDefault();
          const weights = interactionAdapter.resizeWeights(node.weights, increment ? 5 : -5, 100);
          commitResize(node.id, weights, 'keyboard');
        });
        target.append(resizeHandle);
      } else if (node.type === 'grid') {
        target.style.setProperty('--cw-columns', String(state.projection.columns));
        node.children.forEach((child) => {
          const painted = renderNode(child);
          applyPlacement(painted, state.projection.placements[child.id]);
          target.append(painted);
        });
      } else if (node.type === 'dock') {
        target.dataset.edge = state.projection.dockEdge;
        target.append(renderNode(node.children[0]));
      } else if (node.type === 'overlay') {
        target.dataset.bounds = node.boundsPolicy;
        target.append(renderNode(node.children[0]));
      } else if (node.type === 'stack') {
        const tabs = element(document, 'div', 'cw-stack-tabs');
        tabs.setAttribute('role', 'tablist');
        const panels = element(document, 'div', 'cw-stack-panels');
        node.children.forEach((child) => {
          const childDescriptor = child.type === 'module' ? state.registry.get(child.moduleKey) : null;
          const button = element(document, 'button', '', childDescriptor?.accessibility.name || `${child.type} ${child.id}`);
          button.type = 'button';
          button.setAttribute('role', 'tab');
          button.setAttribute('aria-selected', String(child.id === node.activeChildId));
          button.dataset.stackChild = child.id;
          tabs.append(button);
          const panel = element(document, 'div', 'cw-stack-panel');
          panel.dataset.stackPanel = child.id;
          panel.hidden = child.id !== node.activeChildId;
          panel.append(renderNode(child, node.activeChildId));
          panels.append(panel);
          button.addEventListener('click', () => {
            [...tabs.children].forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
            [...panels.children].forEach((candidate) => {
              const visible = candidate === panel;
              candidate.hidden = !visible;
              const instance = state.instances.get(candidate.dataset.stackPanel);
              instance?.setVisibility({ visible, reason: visible ? 'visible' : 'stack-inactive' });
            });
            setOperation(`stack-preview:${child.id}`);
            selectModule(child.id);
          });
        });
        target.append(tabs, panels);
      }
      return target;
    }

    function applyPlacement(node, placement) {
      if (!node || !placement) return;
      node.style.gridColumn = `${placement.columnStart} / span ${placement.columnSpan}`;
      node.style.gridRow = `${placement.rowStart} / span ${placement.rowSpan}`;
    }

    function projectedWidth() {
      return state.widthMode === 'auto' ? viewport.clientWidth : WIDTHS[state.widthMode];
    }

    function applyProjection(operation = 'responsive-project') {
      try {
        state.projection = specimens.deriveProjection(state.graph, projectedWidth());
        const projectionValidation = specimens.validateProjection(state.projection);
        if (!projectionValidation.valid) throw new Error(projectionValidation.errors.join(' '));
        document.body.dataset.tier = state.projection.tier;
        const split = state.containers.get('workspace-split');
        const grid = state.containers.get('workspace-grid');
        const dock = state.containers.get('playback-dock');
        if (split) split.dataset.axis = state.projection.splitAxis;
        if (split) split.querySelector('.cw-resize-handle')?.setAttribute('aria-orientation', state.projection.splitAxis);
        if (grid) grid.style.setProperty('--cw-columns', String(state.projection.columns));
        if (dock) dock.dataset.edge = state.projection.dockEdge;
        Object.entries(state.projection.placements).forEach(([id, placement]) => applyPlacement(state.elements.get(id) || state.containers.get(id), placement));
        state.instances.forEach((instance, id) => {
          const descriptor = instance.descriptor;
          const shape = state.projection.shapes[id];
          const context = descriptor.shapes[shape];
          instance.setLayout({ shape, inlineSize: context.targetInline, blockSize: context.targetBlock, motionAllowed: document.body.dataset.motion !== 'off', conserve: false });
        });
        inspector.tier.textContent = `${state.projection.tier} / ${state.projection.columns} columns / ${state.projection.splitAxis}`;
        inspector.tierOutput.textContent = `${state.projection.tier.toUpperCase()} · ${state.projection.columns} COLUMN${state.projection.columns === 1 ? '' : 'S'}`;
        setOperation(operation);
        setError('');
        if (state.selectedId) selectModule(state.selectedId);
      } catch (error) {
        setError(`${error.code || 'PROJECTION_FAILED'}: ${error.message}`);
        inspector.hostState.textContent = 'FALLBACK';
      }
    }

    function destroyAll() {
      [...state.instances.values()].reverse().forEach((instance) => { try { instance.destroy(); } catch (error) { setError(`${error.code || 'DESTROY_FAILED'}: ${error.message}`); } });
      state.instances.clear();
      state.elements.clear();
      state.containers.clear();
      stage.replaceChildren();
    }

    function mountGraph() {
      clearInteractionPaint();
      destroyAll();
      inspector.hostState.textContent = 'MOUNTING';
      try {
        state.graph = state.session.snapshot().graph;
        const normalized = composition.normalizeGraph(state.graph, { moduleCatalog: state.registry.catalog(), requiredJobs: specimens.REQUIRED_JOBS });
        if (!normalized.valid) throw Object.assign(new Error(normalized.errors.map((entry) => entry.message).join(' ')), { code: 'LAB_GRAPH_INVALID' });
        state.graph = normalized.graph;
        state.projection = specimens.deriveProjection(state.graph, projectedWidth());
        const projectionValidation = specimens.validateProjection(state.projection);
        if (!projectionValidation.valid) throw Object.assign(new Error(projectionValidation.errors.join(' ')), { code: 'LAB_PROJECTION_INVALID' });
        stage.append(renderNode(state.graph));
        applyProjection('mount:normalized-graph');
        inspector.signature.textContent = `cw-${specimens.hashText(normalized.signature)}`;
        inspector.signature.title = normalized.signature;
        inspector.graph.textContent = JSON.stringify(state.graph, null, 2);
        const fallbackCount = [...state.instances.values()].filter((instance) => instance.usedFallback).length;
        inspector.hostState.textContent = fallbackCount ? 'FALLBACK ACTIVE' : 'HEALTHY';
        status.textContent = `${state.instances.size} modules mounted · ${fallbackCount} fallback${fallbackCount === 1 ? '' : 's'} · production workspace untouched.`;
        setError('');
        const fallbackSelection = moduleNodes()[0]?.id || '';
        selectModule(state.selectedId && state.instances.has(state.selectedId) ? state.selectedId : state.instances.has('tracks-module') ? 'tracks-module' : fallbackSelection);
      } catch (error) {
        destroyAll();
        inspector.hostState.textContent = 'SAFE EMPTY';
        setError(`${error.code || 'HOST_MOUNT_FAILED'}: ${error.message}`);
        status.textContent = 'Composition host failed safely. The standalone production workspace remains available.';
      }
    }

    function initializeSession() {
      state.registry = specimens.createRegistry({ createLifecycle: (specimen, context) => createLifecycle(document, specimen, context), createFallbackLifecycle: (specimen) => createFallbackLifecycle(document, specimen) });
      const validationOptions = { moduleCatalog: state.registry.catalog(), requiredJobs: specimens.REQUIRED_JOBS };
      const normalized = composition.normalizeGraph(specimens.GRAPH, validationOptions);
      if (!normalized.valid) throw Object.assign(new Error(normalized.errors.map((entry) => entry.message).join(' ')), { code: 'LAB_GRAPH_INVALID' });
      state.session = compositionSession.createSession(normalized.graph, { validationOptions, creatorDefaultGraph: normalized.graph });
      state.graph = state.session.snapshot().graph;
      mountGraph();
      syncSessionUi('Use Mode. Layout commands are inactive; ordinary module controls remain available.');
    }

    specimens.SPECIMENS.forEach((specimen) => {
      const option = element(document, 'option', '', specimen.label);
      option.value = specimen.key;
      failureControl.append(option);
    });
    widthControls.forEach((button) => button.addEventListener('click', () => {
      if (state.interaction.phase !== 'idle') clearInteractionPaint();
      state.widthMode = button.dataset.widthMode;
      widthControls.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
      viewport.dataset.widthMode = state.widthMode;
      requestAnimationFrame(() => applyProjection(`preview-width:${state.widthMode}`));
    }));
    failureControl.addEventListener('change', () => { state.failureModuleKey = failureControl.value; setOperation(`failure-injection:${state.failureModuleKey || 'none'}`); mountGraph(); syncSessionUi(); });
    motionControl.addEventListener('change', () => { document.body.dataset.motion = motionControl.value; applyProjection(`motion:${motionControl.value}`); });
    remountControl.addEventListener('click', () => { setOperation('destroy-remount'); mountGraph(); syncSessionUi('Destroyed and remounted the current graph without changing the transaction.'); });
    modeToggle.addEventListener('click', () => {
      const snapshot = state.session.snapshot();
      const result = snapshot.mode === 'use' ? state.session.enter() : state.session.exit();
      handleSessionResult(result, snapshot.mode === 'use' ? 'Composition Mode entered. Use MOVE handles, split separators, click placement, or explicit commands.' : 'Composition Mode exited with the committed graph.', { render: false });
    });
    document.querySelectorAll('[data-edit-command]').forEach((button) => button.addEventListener('click', () => runEditCommand(button.dataset.editCommand)));
    edit.undo.addEventListener('click', () => handleSessionResult(state.session.undo(), 'Undid the last composition edit.'));
    edit.redo.addEventListener('click', () => handleSessionResult(state.session.redo(), 'Redid the composition edit.'));
    edit.cancel.addEventListener('click', () => handleSessionResult(state.session.cancel(), 'Canceled the transaction and restored its entry graph.'));
    edit.save.addEventListener('click', () => handleSessionResult(state.session.save(), 'Saved the composition for this in-memory lab session.', { render: false }));
    edit.restore.addEventListener('click', () => handleSessionResult(state.session.restoreCreator(), 'Restored the creator layout as the current draft.'));
    edit.saveAs.addEventListener('click', () => handleSessionResult(state.session.saveAs(edit.layoutName.value), `Saved session layout “${edit.layoutName.value.trim()}”.`, { render: false }));
    edit.applySaved.addEventListener('click', () => handleSessionResult(state.session.applySaved(edit.savedLayout.value), `Applied named session layout “${edit.savedLayout.value}”.`));
    edit.resizeRatio.addEventListener('input', () => {
      edit.resizeOutput.textContent = `${edit.resizeRatio.value}%`;
      const ratio = Number(edit.resizeRatio.value) / 100;
      previewSplitWeights(state.containers.get(edit.resizeSplit.value), [ratio, 1 - ratio]);
      setInteractionState(`Preview ${edit.resizeSplit.value} · ${edit.resizeRatio.value}%`);
    });
    edit.resizeSplit.addEventListener('change', () => refreshEditChoices());
    edit.resizeApply.addEventListener('click', () => {
      const ratio = Number(edit.resizeRatio.value) / 100;
      commitResize(edit.resizeSplit.value, [ratio, 1 - ratio], 'menu');
    });
    edit.resizeEqual.addEventListener('click', () => commitResize(edit.resizeSplit.value, [0.5, 0.5], 'click'));
    document.addEventListener('pointermove', (event) => {
      if (state.interaction.pointerId !== event.pointerId) return;
      if (state.interaction.phase === 'pending' || state.interaction.phase === 'dragging') updateDrag(event);
      else if (state.interaction.phase === 'resizing') updateResize(event);
    });
    document.addEventListener('pointerup', finishPointer);
    document.addEventListener('pointercancel', (event) => {
      if (state.interaction.pointerId !== event.pointerId) return;
      const wasResizing = state.interaction.phase === 'resizing';
      clearInteractionPaint();
      if (wasResizing) mountGraph();
      announce('Canceled the pointer interaction without changing the graph.');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.interaction.phase !== 'idle') {
        event.preventDefault();
        const wasResizing = state.interaction.phase === 'resizing';
        clearInteractionPaint();
        if (wasResizing) mountGraph();
        announce('Canceled the active pointer or pick interaction.');
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        modeToggle.click();
        modeToggle.focus();
        return;
      }
      if (state.session.snapshot().mode !== 'edit' || (!event.ctrlKey && !event.metaKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSessionResult(state.session.save(), 'Saved the composition for this in-memory lab session.', { render: false });
      } else if (event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        handleSessionResult(state.session.redo(), 'Redid the composition edit.');
      } else if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        handleSessionResult(state.session.undo(), 'Undid the last composition edit.');
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleSessionResult(state.session.redo(), 'Redid the composition edit.');
      }
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (state.widthMode === 'auto') applyProjection('resize-observer'); }).observe(viewport);
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) { motionControl.value = 'reduced'; document.body.dataset.motion = 'reduced'; }
    viewport.dataset.widthMode = state.widthMode;
    try { initializeSession(); } catch (error) {
      inspector.hostState.textContent = 'SAFE EMPTY';
      setError(`${error.code || 'HOST_INITIALIZE_FAILED'}: ${error.message}`);
      status.textContent = 'Composition session failed safely. The production workspace remains untouched.';
    }
    return Object.freeze({ mount: mountGraph, destroy: destroyAll, applyProjection, runEditCommand, state });
  }

  return Object.freeze({ WIDTHS, renderSpecimen, createLifecycle, createFallbackLifecycle, initialize });
}));
