(function pixelodyWorkspaceCompositionOperationsFactory(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.PixelodyWorkspaceCompositionContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceCompositionOperations = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceCompositionOperationsApi(contract) {
  'use strict';

  if (!contract) throw new Error('Workspace composition operations require the composition contract.');

  const OPERATION_VERSION = 1;
  const OPERATION_TYPES = Object.freeze([
    'insertModule',
    'removeOptionalModule',
    'moveBefore',
    'moveAfter',
    'splitWith',
    'stackWith',
    'unstack',
    'setActiveStackChild',
    'resizeSplit',
    'setNodePlacement',
    'setNodePin',
    'setModuleShape',
    'setModuleConfiguration',
    'replaceModule',
    'assignAmbient',
    'applyPreset',
    'resetModule',
    'resetComposition',
    'restoreGraph',
  ]);

  function clone(value) {
    return JSON.parse(contract.stableStringify(value));
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function failure(code, message, details = {}) {
    return Object.freeze({ ok: false, error: Object.freeze({ code, message, ...details }) });
  }

  function locate(graph, id) {
    let found = null;
    function visit(node, parent = null, index = 0) {
      if (!node || found) return;
      if (node.id === id) {
        found = { node, parent, index };
        return;
      }
      (node.children || []).forEach((child, childIndex) => visit(child, node, childIndex));
    }
    visit(graph);
    return found;
  }

  function collectIds(node) {
    const ids = new Set();
    (function visit(current) {
      if (!current) return;
      ids.add(current.id);
      (current.children || []).forEach(visit);
    }(node));
    return ids;
  }

  function clearPlacement(node) {
    if (node && own(node, 'placement')) delete node.placement;
    return node;
  }

  function inheritPlacement(child, container) {
    if (child && container?.placement && !child.placement) child.placement = clone(container.placement);
    return child;
  }

  function compactNode(node) {
    if (!node || node.type === 'module') return node;
    node.children = (node.children || []).map(compactNode).filter(Boolean);
    if (node.type === 'root') return node;
    if (!node.children.length) return null;
    if (['split', 'stack'].includes(node.type) && node.children.length === 1) return inheritPlacement(node.children[0], node);
    if (node.type === 'stack' && !node.children.some((child) => child.id === node.activeChildId)) node.activeChildId = node.children[0].id;
    if (node.type === 'split') {
      const safe = Array.isArray(node.weights) && node.weights.length === 2 ? node.weights.map(Number) : [0.5, 0.5];
      const total = safe.reduce((sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 1), 0);
      node.weights = safe.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight / total : 1 / safe.length));
    }
    return node;
  }

  function removeLocated(location) {
    if (!location?.parent) return false;
    location.parent.children.splice(location.index, 1);
    return true;
  }

  function structuralOptions(options = {}) {
    return {
      moduleCatalog: options.moduleCatalog,
      resolveModule: options.resolveModule,
      requiredJobs: [],
      shellJobs: [],
    };
  }

  function normalizeDetachedNode(value, options = {}) {
    if (!value || value.type === 'root') return { valid: false, errors: [{ code: 'DETACHED_NODE_INVALID', message: 'Detached nodes cannot be root nodes.' }] };
    const wrapped = { type: 'root', id: 'detached-root', schemaVersion: contract.COMPOSITION_CONTRACT_VERSION, children: [value] };
    const result = contract.normalizeGraph(wrapped, structuralOptions(options));
    return result.valid ? { valid: true, node: clone(result.graph.children[0]), errors: [] } : { valid: false, errors: result.errors };
  }

  function ensureNewIds(graph, node) {
    const existing = collectIds(graph);
    const duplicate = [...collectIds(node)].find((id) => existing.has(id));
    return duplicate ? failure('NODE_ID_DUPLICATE', `Node id "${duplicate}" already exists in the composition.`, { nodeId: duplicate }) : null;
  }

  function containerAcceptsInsertion(node) {
    return node && ['grid', 'stack'].includes(node.type);
  }

  function insertIntoContainer(container, node, index) {
    const targetIndex = Number.isInteger(Number(index))
      ? Math.max(0, Math.min(container.children.length, Number(index)))
      : container.children.length;
    clearPlacement(node);
    container.children.splice(targetIndex, 0, node);
    if (container.type === 'stack' && !container.activeChildId) container.activeChildId = node.id;
  }

  function operationInsertModule(graph, operation, options) {
    const container = locate(graph, operation.containerId);
    if (!container) return failure('TARGET_NOT_FOUND', `Container "${operation.containerId}" was not found.`);
    if (!containerAcceptsInsertion(container.node)) return failure('TARGET_NOT_INSERTABLE', 'Modules can initially be inserted only into grid or stack containers.', { targetId: operation.containerId });
    const normalized = normalizeDetachedNode(operation.node, options);
    if (!normalized.valid || normalized.node.type !== 'module') return failure('MODULE_NODE_INVALID', 'insertModule requires one valid module node.', { errors: normalized.errors });
    const duplicate = ensureNewIds(graph, normalized.node);
    if (duplicate) return duplicate;
    insertIntoContainer(container.node, normalized.node, operation.index);
    return { ok: true, graph };
  }

  function operationRemoveOptionalModule(graph, operation) {
    const source = locate(graph, operation.sourceId);
    if (!source) return failure('SOURCE_NOT_FOUND', `Module "${operation.sourceId}" was not found.`);
    if (source.node.type !== 'module') return failure('SOURCE_NOT_MODULE', 'Only module nodes can be removed with removeOptionalModule.', { sourceId: operation.sourceId });
    if (!removeLocated(source)) return failure('ROOT_REMOVE_FORBIDDEN', 'The root composition cannot be removed.');
    return { ok: true, graph: compactNode(graph) };
  }

  function moveRelative(graph, operation, after) {
    if (operation.sourceId === operation.targetId) return failure('MOVE_TARGET_SAME', 'A node cannot be moved relative to itself.');
    const source = locate(graph, operation.sourceId);
    if (!source) return failure('SOURCE_NOT_FOUND', `Source "${operation.sourceId}" was not found.`);
    if (!source.parent) return failure('ROOT_MOVE_FORBIDDEN', 'The root composition cannot be moved.');
    if (collectIds(source.node).has(operation.targetId)) return failure('MOVE_INTO_DESCENDANT', 'A node cannot be moved relative to one of its descendants.');
    const moving = source.node;
    removeLocated(source);
    // Compact the source branch before finding the target again. When the
    // source and target were the two children of a split or stack, this is the
    // operation's recombine/unstack meaning: the one-child wrapper disappears
    // and the moving node is inserted beside its former sibling in the owning
    // container. Without this step the node was merely reinserted into the
    // same wrapper and a visible "recombine" gesture changed nothing.
    const compacted = compactNode(graph);
    const target = locate(compacted, operation.targetId);
    if (!target || !target.parent) return failure('TARGET_NOT_FOUND', `Target "${operation.targetId}" was not found after detaching the source.`);
    clearPlacement(moving);
    target.parent.children.splice(target.index + (after ? 1 : 0), 0, moving);
    return { ok: true, graph: compactNode(compacted) };
  }

  function detachedOrExistingSource(graph, operation, options) {
    if (operation.sourceId) {
      const source = locate(graph, operation.sourceId);
      if (!source) return failure('SOURCE_NOT_FOUND', `Source "${operation.sourceId}" was not found.`);
      if (!source.parent) return failure('ROOT_MOVE_FORBIDDEN', 'The root composition cannot be moved.');
      if (collectIds(source.node).has(operation.targetId)) return failure('MOVE_INTO_DESCENDANT', 'A node cannot be moved into one of its descendants.');
      removeLocated(source);
      return { ok: true, node: source.node };
    }
    const normalized = normalizeDetachedNode(operation.node, options);
    if (!normalized.valid) return failure('DETACHED_NODE_INVALID', 'The supplied node is invalid.', { errors: normalized.errors });
    const duplicate = ensureNewIds(graph, normalized.node);
    if (duplicate) return duplicate;
    return { ok: true, node: normalized.node };
  }

  function operationSplitWith(graph, operation, options) {
    if (!contract.NODE_ID_PATTERN.test(operation.splitId || '')) return failure('WRAPPER_ID_INVALID', 'splitWith requires a valid splitId.');
    if (!contract.SPLIT_AXES.includes(operation.axis)) return failure('SPLIT_AXIS_INVALID', `Split axis must be one of: ${contract.SPLIT_AXES.join(', ')}.`);
    if (!['before', 'after'].includes(operation.position)) return failure('SPLIT_POSITION_INVALID', 'Split position must be "before" or "after".');
    const originalTarget = locate(graph, operation.targetId);
    if (!originalTarget || !originalTarget.parent) return failure('TARGET_NOT_FOUND', `Target "${operation.targetId}" was not found or cannot be wrapped.`);
    if (collectIds(graph).has(operation.splitId)) return failure('NODE_ID_DUPLICATE', `Node id "${operation.splitId}" already exists.`);
    const sourceResult = detachedOrExistingSource(graph, operation, options);
    if (!sourceResult.ok) return sourceResult;
    const target = locate(graph, operation.targetId);
    if (!target || !target.parent) return failure('TARGET_NOT_FOUND', `Target "${operation.targetId}" was not found after detaching the source.`);
    const sourceNode = clearPlacement(sourceResult.node);
    const targetNode = target.node;
    const wrapper = {
      type: 'split',
      id: operation.splitId,
      axis: operation.axis,
      weights: Array.isArray(operation.weights) ? operation.weights : [0.5, 0.5],
      children: operation.position === 'before' ? [sourceNode, targetNode] : [targetNode, sourceNode],
    };
    if (targetNode.placement) wrapper.placement = clone(targetNode.placement);
    clearPlacement(targetNode);
    target.parent.children[target.index] = wrapper;
    return { ok: true, graph: compactNode(graph) };
  }

  function operationStackWith(graph, operation, options) {
    if (!contract.NODE_ID_PATTERN.test(operation.stackId || '')) return failure('WRAPPER_ID_INVALID', 'stackWith requires a valid stackId.');
    if (collectIds(graph).has(operation.stackId)) return failure('NODE_ID_DUPLICATE', `Node id "${operation.stackId}" already exists.`);
    const originalTarget = locate(graph, operation.targetId);
    if (!originalTarget || !originalTarget.parent) return failure('TARGET_NOT_FOUND', `Target "${operation.targetId}" was not found or cannot be wrapped.`);
    const sourceResult = detachedOrExistingSource(graph, operation, options);
    if (!sourceResult.ok) return sourceResult;
    const target = locate(graph, operation.targetId);
    if (!target || !target.parent) return failure('TARGET_NOT_FOUND', `Target "${operation.targetId}" was not found after detaching the source.`);
    const sourceNode = clearPlacement(sourceResult.node);
    const targetNode = target.node;
    const children = operation.position === 'before' ? [sourceNode, targetNode] : [targetNode, sourceNode];
    const activeChildId = operation.activeChildId || sourceNode.id;
    if (!children.some((child) => child.id === activeChildId)) return failure('STACK_ACTIVE_CHILD_INVALID', 'activeChildId must reference one of the new stack children.');
    const wrapper = { type: 'stack', id: operation.stackId, activeChildId, children };
    if (targetNode.placement) wrapper.placement = clone(targetNode.placement);
    clearPlacement(targetNode);
    target.parent.children[target.index] = wrapper;
    return { ok: true, graph: compactNode(graph) };
  }

  function operationUnstack(graph, operation) {
    const stack = locate(graph, operation.stackId);
    const destination = locate(graph, operation.containerId);
    if (!stack || stack.node.type !== 'stack') return failure('STACK_NOT_FOUND', `Stack "${operation.stackId}" was not found.`);
    if (!destination || !containerAcceptsInsertion(destination.node)) return failure('TARGET_NOT_INSERTABLE', 'unstack requires a destination grid or stack container.');
    if (collectIds(stack.node).has(destination.node.id)) return failure('MOVE_INTO_DESCENDANT', 'A stacked child cannot be moved into its own descendant.');
    const childIndex = stack.node.children.findIndex((child) => child.id === operation.childId);
    if (childIndex < 0) return failure('STACK_CHILD_NOT_FOUND', `Child "${operation.childId}" is not a direct member of stack "${operation.stackId}".`);
    const child = stack.node.children.splice(childIndex, 1)[0];
    if (stack.node.activeChildId === child.id) stack.node.activeChildId = stack.node.children[0]?.id || '';
    const compacted = compactNode(graph);
    const nextDestination = locate(compacted, operation.containerId);
    if (!nextDestination || !containerAcceptsInsertion(nextDestination.node)) return failure('TARGET_NOT_FOUND', 'The destination was removed while compacting the stack.');
    insertIntoContainer(nextDestination.node, child, operation.index);
    return { ok: true, graph: compactNode(compacted) };
  }

  function operationSetActiveStackChild(graph, operation) {
    const stack = locate(graph, operation.stackId);
    if (!stack || stack.node.type !== 'stack') return failure('STACK_NOT_FOUND', `Stack "${operation.stackId}" was not found.`);
    if (!stack.node.children.some((child) => child.id === operation.childId)) return failure('STACK_CHILD_NOT_FOUND', `Child "${operation.childId}" is not a direct member of stack "${operation.stackId}".`);
    stack.node.activeChildId = operation.childId;
    return { ok: true, graph };
  }

  function operationResizeSplit(graph, operation) {
    const split = locate(graph, operation.splitId);
    if (!split || split.node.type !== 'split') return failure('SPLIT_NOT_FOUND', `Split "${operation.splitId}" was not found.`);
    if (!Array.isArray(operation.weights) || operation.weights.length !== split.node.children.length) return failure('SPLIT_WEIGHT_COUNT_INVALID', 'resizeSplit weights must match the split child count.');
    if (operation.weights.some((weight) => !Number.isFinite(Number(weight)) || Number(weight) <= 0)) return failure('SPLIT_WEIGHT_INVALID', 'resizeSplit weights must be finite positive numbers.');
    split.node.weights = operation.weights.map(Number);
    return { ok: true, graph };
  }

  function moduleLocation(graph, operation) {
    const module = locate(graph, operation.moduleId);
    if (!module) return failure('MODULE_NOT_FOUND', `Module "${operation.moduleId}" was not found.`);
    if (module.node.type !== 'module') return failure('SOURCE_NOT_MODULE', `Node "${operation.moduleId}" is not a module.`);
    return { ok: true, location: module };
  }

  function operationSetModuleShape(graph, operation) {
    const result = moduleLocation(graph, operation);
    if (!result.ok) return result;
    if (!contract.SHAPE_FAMILIES.includes(operation.shape)) return failure('MODULE_SHAPE_INVALID', `Unknown module shape "${operation.shape}".`);
    result.location.node.shape = operation.shape;
    return { ok: true, graph };
  }

  // Grid children carry an optional address and footprint. Only a direct grid
  // child may be placed: split proportions have their own operation and
  // assigning grid cells inside a stack would create state the theme cannot
  // honestly render. Null returns the child to theme-managed auto placement.
  function operationSetNodePlacement(graph, operation) {
    const located = locate(graph, operation.nodeId);
    if (!located) return failure('NODE_NOT_FOUND', `Node "${operation.nodeId}" was not found.`);
    if (!located.parent || located.parent.type !== 'grid') {
      return failure('PLACEMENT_PARENT_NOT_GRID', 'Placement applies only to a direct child of a grid.', { nodeId: operation.nodeId });
    }
    if (operation.placement === null) {
      clearPlacement(located.node);
      return { ok: true, graph };
    }
    if (!contract.isPlainRecord(operation.placement)) return failure('PLACEMENT_INVALID', 'setNodePlacement requires a placement record or null.');
    if (Object.keys(operation.placement).some((key) => !['columnStart', 'rowStart', 'columnSpan', 'rowSpan'].includes(key))) return failure('PLACEMENT_FIELD_UNKNOWN', 'Placement only accepts columnStart, rowStart, columnSpan, and rowSpan.');
    const columns = Number(located.parent.columns) || 12;
    const hasColumnStart = operation.placement.columnStart !== undefined;
    const hasRowStart = operation.placement.rowStart !== undefined;
    const columnStart = Number(operation.placement.columnStart);
    const rowStart = Number(operation.placement.rowStart);
    const columnSpan = Number(operation.placement.columnSpan);
    const rowSpan = Number(operation.placement.rowSpan);
    if (hasColumnStart && (!Number.isInteger(columnStart) || columnStart < 1 || columnStart > columns)) return failure('PLACEMENT_COLUMN_START_INVALID', `columnStart must be an integer from 1 to ${columns}.`);
    if (hasRowStart && (!Number.isInteger(rowStart) || rowStart < 1 || rowStart > 96)) return failure('PLACEMENT_ROW_START_INVALID', 'rowStart must be an integer from 1 to 96.');
    if (!Number.isInteger(columnSpan) || columnSpan < 1 || columnSpan > columns) return failure('PLACEMENT_COLUMN_SPAN_INVALID', `columnSpan must be an integer from 1 to ${columns}.`);
    if (!Number.isInteger(rowSpan) || rowSpan < 1 || rowSpan > 24) return failure('PLACEMENT_ROW_SPAN_INVALID', 'rowSpan must be an integer from 1 to 24.');
    if (hasColumnStart && columnStart + columnSpan - 1 > columns) return failure('PLACEMENT_COLUMN_RANGE_INVALID', 'columnStart plus columnSpan must fit inside the parent grid.');
    if (hasRowStart && rowStart + rowSpan - 1 > 96) return failure('PLACEMENT_ROW_RANGE_INVALID', 'rowStart plus rowSpan must fit inside the addressable canvas.');
    located.node.placement = {
      ...(hasColumnStart ? { columnStart } : {}),
      ...(hasRowStart ? { rowStart } : {}),
      columnSpan,
      rowSpan,
    };
    return { ok: true, graph };
  }

  // Anchoring, in the owner's words: saying which pane is not the one that
  // should give when something is dragged into it. A pinned pane keeps its
  // position, its size, or both, and whatever pushes against it yields
  // instead -- including the pane being dragged.
  function operationSetNodePin(graph, operation) {
    if (typeof operation.nodeId !== 'string' || !operation.nodeId) return failure('NODE_ID_INVALID', 'setNodePin requires a nodeId.');
    const located = locate(graph, operation.nodeId);
    if (!located) return failure('NODE_NOT_FOUND', `Node "${operation.nodeId}" was not found.`);
    if (!located.parent || located.parent.type !== 'grid') {
      return failure('PIN_PARENT_NOT_GRID', 'Anchoring applies only to a direct child of a grid.', { nodeId: operation.nodeId });
    }
    if (located.node.type === 'overlay') return failure('PIN_OVERLAY_FORBIDDEN', 'An overlay is not placed on the grid, so it cannot be anchored.');
    const pin = operation.pin === null || operation.pin === undefined ? 'none' : operation.pin;
    if (typeof pin !== 'string' || !contract.PIN_STATES.includes(pin)) {
      return failure('PIN_INVALID', `Pin must be one of ${contract.PIN_STATES.join(', ')}, or null to release it.`);
    }
    if (pin === 'none') delete located.node.pin;
    else located.node.pin = pin;
    return { ok: true, graph };
  }

  function operationSetModuleConfiguration(graph, operation) {
    const result = moduleLocation(graph, operation);
    if (!result.ok) return result;
    result.location.node.configuration = operation.configuration ?? {};
    return { ok: true, graph };
  }

  function operationReplaceModule(graph, operation, options) {
    const result = moduleLocation(graph, operation);
    if (!result.ok) return result;
    const moduleKey = typeof operation.moduleKey === 'string' ? operation.moduleKey : '';
    const descriptor = descriptorFor(moduleKey, options);
    if (!descriptor) return failure('MODULE_REPLACEMENT_UNKNOWN', `Replacement module "${moduleKey}" is not registered.`);
    const shape = operation.shape || descriptor.targetShape || descriptor.defaultShape || 'panel';
    const shapes = Array.isArray(descriptor.shapes) ? descriptor.shapes : Object.keys(descriptor.shapes || {});
    if (!shapes.includes(shape)) return failure('MODULE_REPLACEMENT_SHAPE_INVALID', `Replacement module "${moduleKey}" does not support shape "${shape}".`);
    result.location.node.moduleKey = moduleKey;
    result.location.node.shape = shape;
    result.location.node.configuration = clone(operation.configuration ?? descriptor.defaultConfiguration ?? {});
    return { ok: true, graph };
  }

  function operationAssignAmbient(graph, operation) {
    const result = moduleLocation(graph, { moduleId: operation.sourceId });
    if (!result.ok) return result;
    if (!result.location.parent) return failure('ROOT_WRAP_FORBIDDEN', 'The root cannot become an ambient module.');
    if (!contract.NODE_ID_PATTERN.test(operation.overlayId || '')) return failure('WRAPPER_ID_INVALID', 'assignAmbient requires a valid overlayId.');
    if (collectIds(graph).has(operation.overlayId)) return failure('NODE_ID_DUPLICATE', `Node id "${operation.overlayId}" already exists.`);
    const module = result.location.node;
    const wrapper = {
      type: 'overlay',
      id: operation.overlayId,
      anchor: operation.anchor || 'fill',
      boundsPolicy: operation.boundsPolicy || 'contained',
      children: [module],
    };
    if (module.placement) wrapper.placement = clone(module.placement);
    clearPlacement(module);
    module.shape = 'ambient';
    result.location.parent.children[result.location.index] = wrapper;
    return { ok: true, graph };
  }

  function descriptorFor(moduleKey, options = {}) {
    if (typeof options.resolveModule === 'function') return options.resolveModule(moduleKey) || null;
    if (options.moduleCatalog && own(options.moduleCatalog, moduleKey)) return options.moduleCatalog[moduleKey];
    return null;
  }

  function operationResetModule(graph, operation, options) {
    const result = moduleLocation(graph, operation);
    if (!result.ok) return result;
    const descriptor = descriptorFor(result.location.node.moduleKey, options) || {};
    result.location.node.shape = descriptor.targetShape || descriptor.defaultShape || 'panel';
    result.location.node.configuration = clone(descriptor.defaultConfiguration || {});
    return { ok: true, graph };
  }

  function replacementGraph(operation, options, key, missingCode) {
    const source = operation.graph || options[key];
    if (!source) return failure(missingCode, `No ${key} graph was supplied.`);
    return { ok: true, graph: clone(source) };
  }

  const HANDLERS = Object.freeze({
    insertModule: operationInsertModule,
    removeOptionalModule: operationRemoveOptionalModule,
    moveBefore: (graph, operation) => moveRelative(graph, operation, false),
    moveAfter: (graph, operation) => moveRelative(graph, operation, true),
    splitWith: operationSplitWith,
    stackWith: operationStackWith,
    unstack: operationUnstack,
    setActiveStackChild: operationSetActiveStackChild,
    resizeSplit: operationResizeSplit,
    setNodePlacement: operationSetNodePlacement,
    setNodePin: operationSetNodePin,
    setModuleShape: operationSetModuleShape,
    setModuleConfiguration: operationSetModuleConfiguration,
    replaceModule: operationReplaceModule,
    assignAmbient: operationAssignAmbient,
    applyPreset: (graph, operation, options) => replacementGraph(operation, options, 'presetGraph', 'PRESET_GRAPH_MISSING'),
    resetModule: operationResetModule,
    resetComposition: (graph, operation, options) => replacementGraph(operation, options, 'creatorDefaultGraph', 'CREATOR_DEFAULT_MISSING'),
    restoreGraph: (graph, operation) => replacementGraph(operation, {}, 'graph', 'RESTORE_GRAPH_MISSING'),
  });

  function applyOperation(inputGraph, operation, options = {}) {
    const beforeResult = contract.normalizeGraph(inputGraph, options);
    if (!beforeResult.valid) return failure('SOURCE_GRAPH_INVALID', 'The source composition graph is invalid.', { errors: beforeResult.errors });
    if (!contract.isPlainRecord(operation)) return failure('OPERATION_INVALID', 'Composition operation must be an object.');
    if (!OPERATION_TYPES.includes(operation.type)) return failure('OPERATION_TYPE_UNKNOWN', `Unknown composition operation "${operation.type}".`);

    const beforeGraph = beforeResult.graph;
    const mutableGraph = clone(beforeGraph);
    const handled = HANDLERS[operation.type](mutableGraph, operation, options);
    if (!handled.ok) return handled;
    const afterResult = contract.normalizeGraph(handled.graph, options);
    if (!afterResult.valid) return failure('OPERATION_RESULT_INVALID', `Operation "${operation.type}" would create an invalid composition.`, { errors: afterResult.errors });
    if (beforeResult.signature === afterResult.signature) return failure('OPERATION_NO_CHANGE', `Operation "${operation.type}" did not change the composition.`);

    const receipt = contract.deepFreeze({
      version: OPERATION_VERSION,
      type: operation.type,
      beforeSignature: beforeResult.signature,
      afterSignature: afterResult.signature,
      inverse: {
        type: 'restoreGraph',
        graph: clone(beforeGraph),
      },
    });
    return Object.freeze({ ok: true, graph: afterResult.graph, receipt });
  }

  function applyOperations(inputGraph, operations, options = {}) {
    if (!Array.isArray(operations) || !operations.length) return failure('OPERATION_BATCH_INVALID', 'Operation batch must contain at least one operation.');
    let graph = inputGraph;
    const receipts = [];
    for (let index = 0; index < operations.length; index += 1) {
      const result = applyOperation(graph, operations[index], options);
      if (!result.ok) return failure('OPERATION_BATCH_FAILED', `Operation batch failed at index ${index}.`, { index, cause: result.error });
      graph = result.graph;
      receipts.push(result.receipt);
    }
    return Object.freeze({ ok: true, graph, receipts: Object.freeze(receipts) });
  }

  return Object.freeze({
    OPERATION_VERSION,
    OPERATION_TYPES,
    applyOperation,
    applyOperations,
  });
}));
