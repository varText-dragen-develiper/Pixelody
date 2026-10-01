(function pixelodyWorkspaceCompositionSessionFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports ? require('./contract') : root.PixelodyWorkspaceCompositionContract;
  const operations = typeof module === 'object' && module.exports ? require('./operations') : root.PixelodyWorkspaceCompositionOperations;
  const api = factory(composition, operations);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceCompositionSession = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceCompositionSessionApi(composition, operations) {
  'use strict';

  if (!composition || !operations) throw new Error('Composition session requires graph and operation contracts.');

  const MODES = Object.freeze(['use', 'edit']);
  const MAX_HISTORY = 100;
  const MAX_SAVED_LAYOUTS = 24;
  const LAYOUT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,47}$/u;

  function resultFailure(code, message, details = {}) {
    return Object.freeze({ ok: false, error: Object.freeze({ code, message, ...details }) });
  }

  function clone(value) {
    return JSON.parse(composition.stableStringify(value));
  }

  function createSession(initialGraph, options = {}) {
    const validationOptions = options.validationOptions || {};
    const normalizedInitial = composition.normalizeGraph(initialGraph, validationOptions);
    if (!normalizedInitial.valid) throw Object.assign(new Error('Composition session initial graph is invalid.'), { code: 'COMPOSITION_SESSION_GRAPH_INVALID', validation: normalizedInitial });
    const normalizedCreator = composition.normalizeGraph(options.creatorDefaultGraph || normalizedInitial.graph, validationOptions);
    if (!normalizedCreator.valid) throw Object.assign(new Error('Composition session creator graph is invalid.'), { code: 'COMPOSITION_SESSION_CREATOR_INVALID', validation: normalizedCreator });

    let mode = 'use';
    let committedGraph = normalizedInitial.graph;
    let draftGraph = normalizedInitial.graph;
    let entryGraph = normalizedInitial.graph;
    const creatorDefaultGraph = normalizedCreator.graph;
    const undo = [];
    const redo = [];
    const savedLayouts = new Map();
    let revision = 0;

    function signature(graph) { return composition.stableStringify(graph); }
    function isDirty() { return signature(draftGraph) !== signature(committedGraph); }
    function snapshot() {
      return Object.freeze({
        mode,
        revision,
        dirty: isDirty(),
        canUndo: mode === 'edit' && undo.length > 0,
        canRedo: mode === 'edit' && redo.length > 0,
        graph: draftGraph,
        committedGraph,
        creatorDefaultGraph,
        savedLayouts: Object.freeze([...savedLayouts.keys()].sort()),
      });
    }
    function success(action, details = {}) { return Object.freeze({ ok: true, action, snapshot: snapshot(), ...details }); }
    function requireEdit(action) {
      return mode === 'edit' ? null : resultFailure('COMPOSITION_MODE_INACTIVE', `${action} is available only in Composition Mode.`);
    }
    function pushBounded(stack, graph) {
      stack.push(graph);
      if (stack.length > MAX_HISTORY) stack.shift();
    }

    function enter() {
      if (mode === 'edit') return resultFailure('COMPOSITION_MODE_ALREADY_ACTIVE', 'Composition Mode is already active.');
      mode = 'edit';
      entryGraph = committedGraph;
      draftGraph = committedGraph;
      undo.length = 0;
      redo.length = 0;
      return success('enter');
    }

    function exit() {
      const inactive = requireEdit('Exit');
      if (inactive) return inactive;
      if (isDirty()) return resultFailure('COMPOSITION_UNSAVED_CHANGES', 'The draft has unsaved changes. Use Save or Cancel before leaving Composition Mode.');
      mode = 'use';
      undo.length = 0;
      redo.length = 0;
      return success('exit');
    }

    function apply(operation) {
      const inactive = requireEdit('Layout editing');
      if (inactive) return inactive;
      const applied = operations.applyOperation(draftGraph, operation, { ...validationOptions, creatorDefaultGraph });
      if (!applied.ok) return applied;
      pushBounded(undo, draftGraph);
      draftGraph = applied.graph;
      redo.length = 0;
      revision += 1;
      return success(operation.type, { receipt: applied.receipt });
    }

    function undoOperation() {
      const inactive = requireEdit('Undo');
      if (inactive) return inactive;
      if (!undo.length) return resultFailure('COMPOSITION_UNDO_EMPTY', 'There is no composition edit to undo.');
      pushBounded(redo, draftGraph);
      draftGraph = undo.pop();
      revision += 1;
      return success('undo');
    }

    function redoOperation() {
      const inactive = requireEdit('Redo');
      if (inactive) return inactive;
      if (!redo.length) return resultFailure('COMPOSITION_REDO_EMPTY', 'There is no composition edit to redo.');
      pushBounded(undo, draftGraph);
      draftGraph = redo.pop();
      revision += 1;
      return success('redo');
    }

    function cancel() {
      const inactive = requireEdit('Cancel');
      if (inactive) return inactive;
      draftGraph = entryGraph;
      committedGraph = entryGraph;
      mode = 'use';
      undo.length = 0;
      redo.length = 0;
      revision += 1;
      return success('cancel');
    }

    function save() {
      const inactive = requireEdit('Save');
      if (inactive) return inactive;
      committedGraph = draftGraph;
      entryGraph = committedGraph;
      mode = 'use';
      undo.length = 0;
      redo.length = 0;
      revision += 1;
      return success('save');
    }

    function normalizeLayoutName(value) {
      const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      return LAYOUT_NAME_PATTERN.test(name) ? name : '';
    }

    function saveAs(value) {
      const inactive = requireEdit('Save As');
      if (inactive) return inactive;
      const name = normalizeLayoutName(value);
      if (!name) return resultFailure('COMPOSITION_LAYOUT_NAME_INVALID', 'Layout name must be 1–48 readable characters and begin with a letter or number.');
      if (!savedLayouts.has(name) && savedLayouts.size >= MAX_SAVED_LAYOUTS) return resultFailure('COMPOSITION_LAYOUT_LIMIT_REACHED', `A session can hold at most ${MAX_SAVED_LAYOUTS} named layouts.`);
      savedLayouts.set(name, composition.deepFreeze(clone(draftGraph)));
      committedGraph = draftGraph;
      entryGraph = committedGraph;
      mode = 'use';
      undo.length = 0;
      redo.length = 0;
      revision += 1;
      return success('saveAs', { name });
    }

    function applySaved(value) {
      const inactive = requireEdit('Apply named layout');
      if (inactive) return inactive;
      const name = normalizeLayoutName(value);
      if (!savedLayouts.has(name)) return resultFailure('COMPOSITION_LAYOUT_NOT_FOUND', `Named layout "${name || value}" was not found in this session.`);
      return apply({ type: 'applyPreset', graph: savedLayouts.get(name) });
    }

    function restoreCreator() {
      const inactive = requireEdit('Restore Creator Layout');
      if (inactive) return inactive;
      return apply({ type: 'resetComposition', graph: creatorDefaultGraph });
    }

    return Object.freeze({ snapshot, enter, exit, apply, undo: undoOperation, redo: redoOperation, cancel, save, saveAs, applySaved, restoreCreator, normalizeLayoutName });
  }

  return Object.freeze({ MODES, MAX_HISTORY, MAX_SAVED_LAYOUTS, LAYOUT_NAME_PATTERN, createSession });
}));
