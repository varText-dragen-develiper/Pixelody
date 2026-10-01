(function pixelodyWorkspaceCompositionContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceCompositionContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceCompositionContractApi() {
  'use strict';

  const COMPOSITION_CONTRACT_VERSION = 1;
  const MAX_GRAPH_DEPTH = 32;
  const MAX_GRAPH_NODES = 256;
  const MAX_CONTAINER_CHILDREN = 128;
  const MAX_CONFIGURATION_BYTES = 32768;
  const MAX_TOTAL_CONFIGURATION_BYTES = 262144;
  const MAX_STRING_LENGTH = 8192;
  const MAX_ARRAY_LENGTH = 512;

  const KEY_PATTERN = /^[a-z][a-z0-9.-]{1,63}$/;
  const NODE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
  // The grid is four times finer across and six times finer down than the
  // archive it was measured from. The archive frame still renders identically:
  // its spans are simply multiplied, and the fine grid is widened by the one
  // gutter the coarse one was missing, which is what makes the two models
  // agree to the pixel. What changes is that a pane can be placed where it is
  // aimed rather than at the nearest 50px boundary.
  const COLUMN_DIVISIONS = 4;
  const ROW_DIVISIONS = 6;
  const MAX_COLUMNS = 24 * COLUMN_DIVISIONS;
  const MAX_ROW_SPAN = 24 * ROW_DIVISIONS;
  const MAX_ROWS = 96 * ROW_DIVISIONS;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const NODE_TYPES = Object.freeze(['root', 'split', 'stack', 'grid', 'dock', 'overlay', 'module']);
  const SHAPE_FAMILIES = Object.freeze(['micro', 'strip', 'tile', 'panel', 'stage', 'ambient', 'mini']);
  const SPLIT_AXES = Object.freeze(['horizontal', 'vertical']);
  const GRID_ROW_POLICIES = Object.freeze(['flow', 'dense']);
  const DOCK_EDGES = Object.freeze(['top', 'right', 'bottom', 'left']);
  const DOCK_SIZE_POLICIES = Object.freeze(['content', 'fixed', 'fraction']);
  const OVERLAY_ANCHORS = Object.freeze(['fill', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']);
  const OVERLAY_BOUNDS_POLICIES = Object.freeze(['contained', 'safe-area']);

  // The interface calls this anchoring, which is the owner's word for it. The
  // key is `pin` because `anchor` already means something else on an overlay
  // node -- which corner it hangs from -- and one word for two ideas in the
  // same schema is a bug waiting to be written.
  const PIN_STATES = Object.freeze(['none', 'position', 'size', 'firm']);
  const COMMON_KEYS = Object.freeze(['type', 'id', 'placement']);
  const TYPE_KEYS = Object.freeze({
    root: Object.freeze([...COMMON_KEYS, 'schemaVersion', 'children']),
    split: Object.freeze([...COMMON_KEYS, 'pin', 'axis', 'weights', 'children']),
    stack: Object.freeze([...COMMON_KEYS, 'pin', 'activeChildId', 'children']),
    grid: Object.freeze([...COMMON_KEYS, 'pin', 'columns', 'rowPolicy', 'children']),
    dock: Object.freeze([...COMMON_KEYS, 'pin', 'edge', 'sizePolicy', 'size', 'children']),
    overlay: Object.freeze([...COMMON_KEYS, 'anchor', 'boundsPolicy', 'children']),
    module: Object.freeze([...COMMON_KEYS, 'pin', 'moduleKey', 'shape', 'configuration']),
  });

  function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function error(code, path, message) {
    return Object.freeze({ code, path, message });
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function stableStringify(value) {
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function utf8ByteLength(value) {
    const text = String(value);
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') return Buffer.byteLength(text, 'utf8');
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function cloneJsonValue(value, path, state, depth = 0) {
    if (depth > MAX_GRAPH_DEPTH) {
      state.errors.push(error('CONFIGURATION_DEPTH_EXCEEDED', path, `Configuration exceeds maximum depth ${MAX_GRAPH_DEPTH}.`));
      return null;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        state.errors.push(error('CONFIGURATION_NUMBER_INVALID', path, 'Configuration numbers must be finite.'));
        return null;
      }
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) {
        state.errors.push(error('CONFIGURATION_STRING_TOO_LONG', path, `Configuration strings are limited to ${MAX_STRING_LENGTH} characters.`));
        return value.slice(0, MAX_STRING_LENGTH);
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) state.errors.push(error('CONFIGURATION_ARRAY_TOO_LONG', path, `Configuration arrays are limited to ${MAX_ARRAY_LENGTH} entries.`));
      const length = Math.min(value.length, MAX_ARRAY_LENGTH);
      return Array.from({ length }, (_, index) => cloneJsonValue(value[index], `${path}[${index}]`, state, depth + 1));
    }
    if (!isPlainRecord(value)) {
      state.errors.push(error('CONFIGURATION_VALUE_INVALID', path, 'Configuration values must be JSON-compatible plain data.'));
      return null;
    }
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) {
        state.errors.push(error('CONFIGURATION_KEY_FORBIDDEN', `${path}.${key}`, `Configuration key "${key}" is forbidden.`));
        continue;
      }
      result[key] = cloneJsonValue(value[key], `${path}.${key}`, state, depth + 1);
    }
    return result;
  }

  function normalizeConfiguration(value, path = 'configuration') {
    const state = { errors: [] };
    const configuration = cloneJsonValue(value ?? Object.create(null), path, state);
    const bytes = utf8ByteLength(stableStringify(configuration));
    if (bytes > MAX_CONFIGURATION_BYTES) state.errors.push(error('MODULE_CONFIGURATION_TOO_LARGE', path, `Module configuration is limited to ${MAX_CONFIGURATION_BYTES} bytes.`));
    return Object.freeze({
      valid: state.errors.length === 0,
      configuration: state.errors.length === 0 ? deepFreeze(configuration) : null,
      candidate: deepFreeze(configuration),
      errors: Object.freeze(state.errors.slice()),
      bytes,
    });
  }

  function normalizePlacement(value, path, errors) {
    if (value === undefined) return undefined;
    if (!isPlainRecord(value)) {
      errors.push(error('PLACEMENT_INVALID', path, 'Placement must be an object.'));
      return undefined;
    }
    for (const key of Object.keys(value)) {
      if (!['columnStart', 'rowStart', 'columnSpan', 'rowSpan'].includes(key)) errors.push(error('PLACEMENT_KEY_UNKNOWN', `${path}.${key}`, `Unknown placement key "${key}".`));
    }
    const hasColumnStart = value.columnStart !== undefined;
    const hasRowStart = value.rowStart !== undefined;
    const columnStart = Number(value.columnStart);
    const rowStart = Number(value.rowStart);
    const columnSpan = Number(value.columnSpan ?? 1);
    const rowSpan = Number(value.rowSpan ?? 1);
    if (hasColumnStart && (!Number.isInteger(columnStart) || columnStart < 1 || columnStart > MAX_COLUMNS)) errors.push(error('PLACEMENT_COLUMN_START_INVALID', `${path}.columnStart`, `columnStart must be an integer from 1 to ${MAX_COLUMNS}.`));
    if (hasRowStart && (!Number.isInteger(rowStart) || rowStart < 1 || rowStart > MAX_ROWS)) errors.push(error('PLACEMENT_ROW_START_INVALID', `${path}.rowStart`, `rowStart must be an integer from 1 to ${MAX_ROWS}.`));
    if (!Number.isInteger(columnSpan) || columnSpan < 1 || columnSpan > MAX_COLUMNS) errors.push(error('PLACEMENT_COLUMN_SPAN_INVALID', `${path}.columnSpan`, `columnSpan must be an integer from 1 to ${MAX_COLUMNS}.`));
    if (!Number.isInteger(rowSpan) || rowSpan < 1 || rowSpan > MAX_ROW_SPAN) errors.push(error('PLACEMENT_ROW_SPAN_INVALID', `${path}.rowSpan`, `rowSpan must be an integer from 1 to ${MAX_ROW_SPAN}.`));
    return Object.freeze({
      ...(hasColumnStart ? { columnStart: Math.max(1, Math.min(MAX_COLUMNS, Math.round(columnStart) || 1)) } : {}),
      ...(hasRowStart ? { rowStart: Math.max(1, Math.min(MAX_ROWS, Math.round(rowStart) || 1)) } : {}),
      columnSpan: Math.max(1, Math.min(MAX_COLUMNS, Math.round(columnSpan) || 1)),
      rowSpan: Math.max(1, Math.min(MAX_ROW_SPAN, Math.round(rowSpan) || 1)),
    });
  }

  function normalizedWeights(value, childCount, path, errors) {
    if (childCount === 0) return Object.freeze([]);
    const source = Array.isArray(value) ? value.map(Number) : Array(childCount).fill(1);
    if (source.length !== childCount) errors.push(error('SPLIT_WEIGHT_COUNT_INVALID', path, 'Split weights must match the child count.'));
    const weights = Array.from({ length: childCount }, (_, index) => Number(source[index]));
    weights.forEach((weight, index) => {
      if (!Number.isFinite(weight) || weight <= 0) errors.push(error('SPLIT_WEIGHT_INVALID', `${path}[${index}]`, 'Split weights must be finite positive numbers.'));
    });
    const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
    const total = safe.reduce((sum, weight) => sum + weight, 0) || 1;
    const normalized = safe.map((weight) => Number((weight / total).toFixed(6)));
    const drift = Number((1 - normalized.reduce((sum, weight) => sum + weight, 0)).toFixed(6));
    normalized[normalized.length - 1] = Number((normalized[normalized.length - 1] + drift).toFixed(6));
    return Object.freeze(normalized);
  }

  function normalizeNode(value, path, state, depth = 0) {
    if (depth > MAX_GRAPH_DEPTH) {
      state.errors.push(error('GRAPH_DEPTH_EXCEEDED', path, `Composition graph exceeds maximum depth ${MAX_GRAPH_DEPTH}.`));
      return null;
    }
    if (!isPlainRecord(value)) {
      state.errors.push(error('NODE_INVALID', path, 'Composition nodes must be plain objects.'));
      return null;
    }
    if (state.nodeCount >= MAX_GRAPH_NODES) {
      if (!state.nodeLimitReported) state.errors.push(error('GRAPH_NODE_LIMIT_EXCEEDED', path, `Composition graph is limited to ${MAX_GRAPH_NODES} nodes.`));
      state.nodeLimitReported = true;
      return null;
    }
    state.nodeCount += 1;

    const type = typeof value.type === 'string' ? value.type : '';
    if (!NODE_TYPES.includes(type)) {
      state.errors.push(error('NODE_TYPE_INVALID', `${path}.type`, `Unknown composition node type "${type}".`));
      return null;
    }
    const allowed = new Set(TYPE_KEYS[type]);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) state.errors.push(error('NODE_KEY_FORBIDDEN', `${path}.${key}`, `Node key "${key}" is forbidden.`));
      else if (!allowed.has(key)) state.errors.push(error('NODE_KEY_UNKNOWN', `${path}.${key}`, `Unknown ${type} node key "${key}".`));
    }

    const id = typeof value.id === 'string' ? value.id : '';
    if (!NODE_ID_PATTERN.test(id)) state.errors.push(error('NODE_ID_INVALID', `${path}.id`, 'Node id must be 1-128 safe identifier characters.'));
    if (id && state.ids.has(id)) state.errors.push(error('NODE_ID_DUPLICATE', `${path}.id`, `Duplicate node id "${id}".`));
    if (id) state.ids.add(id);

    const node = { type, id };
    if (type !== 'root') {
      const placement = normalizePlacement(value.placement, `${path}.placement`, state.errors);
      if (placement) node.placement = placement;
      // normalizeNode builds a fresh node and copies only what it knows about,
      // so a field that is not read here is silently dropped on every resolve.
      if (value.pin !== undefined && value.pin !== null) {
        if (typeof value.pin === 'string' && PIN_STATES.includes(value.pin)) {
          if (value.pin !== 'none') node.pin = value.pin;
        } else state.errors.push(error('NODE_PIN_INVALID', `${path}.pin`, `Pin must be one of ${PIN_STATES.join(', ')}.`));
      }
    } else if (value.placement !== undefined) state.errors.push(error('ROOT_PLACEMENT_FORBIDDEN', `${path}.placement`, 'The root node cannot declare grid placement.'));

    if (type === 'module') {
      const moduleKey = typeof value.moduleKey === 'string' ? value.moduleKey : '';
      const shape = value.shape === undefined ? 'panel' : value.shape;
      if (!KEY_PATTERN.test(moduleKey)) state.errors.push(error('MODULE_KEY_INVALID', `${path}.moduleKey`, 'moduleKey must be a lowercase namespaced key.'));
      if (!SHAPE_FAMILIES.includes(shape)) state.errors.push(error('MODULE_SHAPE_INVALID', `${path}.shape`, `Unknown module shape "${shape}".`));
      const configState = { errors: state.errors };
      const configuration = cloneJsonValue(value.configuration ?? Object.create(null), `${path}.configuration`, configState);
      const configBytes = utf8ByteLength(stableStringify(configuration));
      state.configurationBytes += configBytes;
      if (configBytes > MAX_CONFIGURATION_BYTES) state.errors.push(error('MODULE_CONFIGURATION_TOO_LARGE', `${path}.configuration`, `Module configuration is limited to ${MAX_CONFIGURATION_BYTES} bytes.`));
      if (state.configurationBytes > MAX_TOTAL_CONFIGURATION_BYTES) state.errors.push(error('GRAPH_CONFIGURATION_TOO_LARGE', path, `Composition configuration is limited to ${MAX_TOTAL_CONFIGURATION_BYTES} bytes total.`));
      node.moduleKey = moduleKey;
      node.shape = SHAPE_FAMILIES.includes(shape) ? shape : 'panel';
      node.configuration = configuration;
      return deepFreeze(node);
    }

    const suppliedChildren = Array.isArray(value.children) ? value.children : [];
    if (!Array.isArray(value.children)) state.errors.push(error('NODE_CHILDREN_INVALID', `${path}.children`, `${type} node children must be an array.`));
    if (suppliedChildren.length > MAX_CONTAINER_CHILDREN) state.errors.push(error('NODE_CHILD_LIMIT_EXCEEDED', `${path}.children`, `A composition container is limited to ${MAX_CONTAINER_CHILDREN} direct children.`));
    const sourceChildren = suppliedChildren.slice(0, MAX_CONTAINER_CHILDREN);
    node.children = sourceChildren.map((child, index) => normalizeNode(child, `${path}.children[${index}]`, state, depth + 1)).filter(Boolean);

    if (type === 'root') {
      node.schemaVersion = Number(value.schemaVersion ?? COMPOSITION_CONTRACT_VERSION);
      if (node.schemaVersion !== COMPOSITION_CONTRACT_VERSION) state.errors.push(error('SCHEMA_VERSION_UNSUPPORTED', `${path}.schemaVersion`, `Unsupported composition schema version "${node.schemaVersion}".`));
      if (node.children.length !== 1) state.errors.push(error('ROOT_CHILD_COUNT_INVALID', `${path}.children`, 'The root node must contain exactly one child.'));
    } else if (type === 'split') {
      node.axis = SPLIT_AXES.includes(value.axis) ? value.axis : 'horizontal';
      if (!SPLIT_AXES.includes(value.axis)) state.errors.push(error('SPLIT_AXIS_INVALID', `${path}.axis`, `Split axis must be one of: ${SPLIT_AXES.join(', ')}.`));
      if (node.children.length !== 2) state.errors.push(error('SPLIT_CHILD_COUNT_INVALID', `${path}.children`, 'A split must contain exactly two children.'));
      node.weights = normalizedWeights(value.weights, node.children.length, `${path}.weights`, state.errors);
    } else if (type === 'stack') {
      if (node.children.length < 2) state.errors.push(error('STACK_CHILD_COUNT_INVALID', `${path}.children`, 'A stack must contain at least two children.'));
      node.activeChildId = typeof value.activeChildId === 'string' && value.activeChildId ? value.activeChildId : node.children[0]?.id || '';
      if (!node.children.some((child) => child.id === node.activeChildId)) state.errors.push(error('STACK_ACTIVE_CHILD_INVALID', `${path}.activeChildId`, 'activeChildId must reference a direct stack child.'));
    } else if (type === 'grid') {
      node.columns = Number(value.columns ?? 12);
      node.rowPolicy = GRID_ROW_POLICIES.includes(value.rowPolicy) ? value.rowPolicy : 'flow';
      if (!Number.isInteger(node.columns) || node.columns < 1 || node.columns > MAX_COLUMNS) state.errors.push(error('GRID_COLUMNS_INVALID', `${path}.columns`, `Grid columns must be an integer from 1 to ${MAX_COLUMNS}.`));
      if (!GRID_ROW_POLICIES.includes(value.rowPolicy ?? 'flow')) state.errors.push(error('GRID_ROW_POLICY_INVALID', `${path}.rowPolicy`, `Grid rowPolicy must be one of: ${GRID_ROW_POLICIES.join(', ')}.`));
      if (!node.children.length) state.errors.push(error('GRID_CHILD_COUNT_INVALID', `${path}.children`, 'A grid must contain at least one child.'));
    } else if (type === 'dock') {
      node.edge = DOCK_EDGES.includes(value.edge) ? value.edge : 'bottom';
      node.sizePolicy = DOCK_SIZE_POLICIES.includes(value.sizePolicy) ? value.sizePolicy : 'content';
      if (!DOCK_EDGES.includes(value.edge)) state.errors.push(error('DOCK_EDGE_INVALID', `${path}.edge`, `Dock edge must be one of: ${DOCK_EDGES.join(', ')}.`));
      if (!DOCK_SIZE_POLICIES.includes(value.sizePolicy ?? 'content')) state.errors.push(error('DOCK_SIZE_POLICY_INVALID', `${path}.sizePolicy`, `Dock sizePolicy must be one of: ${DOCK_SIZE_POLICIES.join(', ')}.`));
      if (node.children.length !== 1) state.errors.push(error('DOCK_CHILD_COUNT_INVALID', `${path}.children`, 'A dock must contain exactly one child.'));
      if (node.sizePolicy === 'fixed') {
        node.size = Number(value.size);
        if (!Number.isFinite(node.size) || node.size <= 0 || node.size > 4096) state.errors.push(error('DOCK_FIXED_SIZE_INVALID', `${path}.size`, 'A fixed dock size must be greater than 0 and no more than 4096.'));
      } else if (node.sizePolicy === 'fraction') {
        node.size = Number(value.size);
        if (!Number.isFinite(node.size) || node.size <= 0 || node.size >= 1) state.errors.push(error('DOCK_FRACTION_INVALID', `${path}.size`, 'A fractional dock size must be greater than 0 and less than 1.'));
      } else if (value.size !== undefined) state.errors.push(error('DOCK_CONTENT_SIZE_FORBIDDEN', `${path}.size`, 'A content-sized dock cannot declare an explicit size.'));
    } else if (type === 'overlay') {
      node.anchor = OVERLAY_ANCHORS.includes(value.anchor) ? value.anchor : 'fill';
      node.boundsPolicy = OVERLAY_BOUNDS_POLICIES.includes(value.boundsPolicy) ? value.boundsPolicy : 'contained';
      if (!OVERLAY_ANCHORS.includes(value.anchor ?? 'fill')) state.errors.push(error('OVERLAY_ANCHOR_INVALID', `${path}.anchor`, `Overlay anchor must be one of: ${OVERLAY_ANCHORS.join(', ')}.`));
      if (!OVERLAY_BOUNDS_POLICIES.includes(value.boundsPolicy ?? 'contained')) state.errors.push(error('OVERLAY_BOUNDS_INVALID', `${path}.boundsPolicy`, `Overlay boundsPolicy must be one of: ${OVERLAY_BOUNDS_POLICIES.join(', ')}.`));
      if (node.children.length !== 1) state.errors.push(error('OVERLAY_CHILD_COUNT_INVALID', `${path}.children`, 'An overlay must contain exactly one child.'));
    }
    return deepFreeze(node);
  }

  function descriptorFor(moduleKey, options = {}) {
    if (typeof options.resolveModule === 'function') return options.resolveModule(moduleKey) || null;
    if (isPlainRecord(options.moduleCatalog) && own(options.moduleCatalog, moduleKey)) return options.moduleCatalog[moduleKey];
    return null;
  }

  function descriptorShapes(descriptor) {
    if (!descriptor) return [];
    if (Array.isArray(descriptor.shapes)) return descriptor.shapes;
    if (isPlainRecord(descriptor.shapes)) return Object.keys(descriptor.shapes);
    return [];
  }

  function walkGraph(graph, visitor) {
    function visit(node, parent = null, index = 0, depth = 0) {
      if (!node) return;
      visitor(node, parent, index, depth);
      (node.children || []).forEach((child, childIndex) => visit(child, node, childIndex, depth + 1));
    }
    visit(graph, null, 0, 0);
  }

  function deriveFocusOrder(graph, options = {}) {
    const order = [];
    function visit(node) {
      if (!node) return;
      if (node.type === 'module') {
        order.push(node.id);
        return;
      }
      if (node.type === 'stack') {
        const active = node.children.find((child) => child.id === node.activeChildId) || node.children[0];
        if (active) visit(active);
        if (options.includeInactiveStackChildren) node.children.filter((child) => child !== active).forEach(visit);
        return;
      }
      (node.children || []).forEach(visit);
    }
    visit(graph);
    return Object.freeze(order);
  }

  function validateSemantics(graph, options, errors) {
    const jobs = new Set(options.shellJobs || []);
    const moduleCounts = new Map();
    walkGraph(graph, (node) => {
      if (node.type !== 'module') return;
      const descriptor = descriptorFor(node.moduleKey, options);
      if ((options.moduleCatalog || options.resolveModule) && !descriptor) {
        errors.push(error('MODULE_UNKNOWN', `node:${node.id}`, `Unknown module key "${node.moduleKey}".`));
        return;
      }
      if (!descriptor) return;
      const shapes = descriptorShapes(descriptor);
      if (shapes.length && !shapes.includes(node.shape)) errors.push(error('MODULE_SHAPE_UNSUPPORTED', `node:${node.id}`, `Module "${node.moduleKey}" does not support shape "${node.shape}".`));
      const count = (moduleCounts.get(node.moduleKey) || 0) + 1;
      moduleCounts.set(node.moduleKey, count);
      if (descriptor.instancePolicy === 'single' && count > 1) errors.push(error('MODULE_INSTANCE_POLICY_VIOLATED', `node:${node.id}`, `Module "${node.moduleKey}" allows only one instance.`));
      (descriptor.productJobs || []).forEach((job) => jobs.add(job));
    });
    (options.requiredJobs || []).forEach((job) => {
      if (!jobs.has(job)) errors.push(error('REQUIRED_JOB_MISSING', 'graph', `Required product job "${job}" is not reachable.`));
    });
  }

  function normalizeGraph(value, options = {}) {
    const state = { errors: [], ids: new Set(), nodeCount: 0, nodeLimitReported: false, configurationBytes: 0 };
    const graph = normalizeNode(value, 'graph', state, 0);
    if (graph) validateSemantics(graph, options, state.errors);
    const valid = Boolean(graph) && state.errors.length === 0;
    return Object.freeze({
      valid,
      graph: valid ? graph : null,
      candidate: graph,
      errors: Object.freeze(state.errors.slice()),
      nodeCount: state.nodeCount,
      signature: graph ? stableStringify(graph) : '',
    });
  }

  function validateGraph(value, options = {}) {
    const result = normalizeGraph(value, options);
    return Object.freeze({ valid: result.valid, errors: result.errors, nodeCount: result.nodeCount, signature: result.signature });
  }

  function assertGraph(value, options = {}) {
    const result = normalizeGraph(value, options);
    if (result.valid) return result.graph;
    const failure = new Error(`Invalid composition graph: ${result.errors.map((entry) => entry.message).join(' ')}`);
    failure.code = 'COMPOSITION_GRAPH_INVALID';
    failure.validation = result;
    throw failure;
  }

  function findNode(graph, id) {
    let found = null;
    walkGraph(graph, (node, parent, index) => {
      if (!found && node.id === id) found = Object.freeze({ node, parent, index });
    });
    return found;
  }

  function resolveGraph(candidate, fallback, options = {}) {
    const candidateResult = normalizeGraph(candidate, options);
    if (candidateResult.valid) return Object.freeze({ graph: candidateResult.graph, usedFallback: false, errors: Object.freeze([]), signature: candidateResult.signature });
    const fallbackResult = normalizeGraph(fallback, options);
    if (!fallbackResult.valid) {
      const failure = new Error('Neither candidate nor fallback composition graph is valid.');
      failure.code = 'COMPOSITION_FALLBACK_INVALID';
      failure.candidateValidation = candidateResult;
      failure.fallbackValidation = fallbackResult;
      throw failure;
    }
    return Object.freeze({ graph: fallbackResult.graph, usedFallback: true, errors: candidateResult.errors, signature: fallbackResult.signature });
  }


  // ==================================================================
  // PLACEMENT GEOMETRY
  //
  // Composition Mode could only ever express ordering -- moveBefore,
  // moveAfter, splitWith, stackWith -- which is why a drop could not mean a
  // coordinate and had to wait for a slot to clip into. setNodePlacement has
  // always been able to say exactly where something goes; nothing ever built
  // the number it needed.
  //
  // These are those numbers. They live here rather than in the studio because
  // they are arithmetic, not interaction: they can be proved without a
  // browser, and both the studio and the port check can share one definition
  // instead of keeping two that drift.
  // ==================================================================

  // Pointer position -> grid cell, both 1-based to match the placement record.
  //
  // `metrics` is what a caller reads once from the grid element:
  //   left, top      the grid's content-box origin, in the same coordinate
  //                  space as `point`
  //   columns        the grid's own column count
  //   width          the grid's content-box width
  //   rowSize        the height of one row track
  //   gap            the gutter between tracks, 0 when there is none
  //   scale          the authoring surface's zoom, 1 when not zoomed
  //
  // Zoom is a divisor rather than a second code path, which is the whole
  // reason this is arithmetic: a zoomed canvas and an unzoomed one resolve
  // through the same three lines.
  //
  // Returns null when the metrics cannot describe a grid, so a caller can fall
  // back to its existing behaviour rather than committing a guess.
  function placementFromPoint(metrics, point) {
    if (!isPlainRecord(metrics) || !isPlainRecord(point)) return null;
    const columns = Math.round(Number(metrics.columns));
    const width = Number(metrics.width);
    const rowSize = Number(metrics.rowSize);
    if (!Number.isInteger(columns) || columns < 1 || columns > MAX_COLUMNS) return null;
    if (!Number.isFinite(width) || width <= 0) return null;
    if (!Number.isFinite(rowSize) || rowSize <= 0) return null;
    const scale = Number.isFinite(Number(metrics.scale)) && Number(metrics.scale) > 0 ? Number(metrics.scale) : 1;
    const gap = Number.isFinite(Number(metrics.gap)) && Number(metrics.gap) > 0 ? Number(metrics.gap) : 0;
    const left = Number(metrics.left) || 0;
    const top = Number(metrics.top) || 0;
    const x = (Number(point.x) - left) / scale;
    const y = (Number(point.y) - top) / scale;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    // A column track is what is left of the width once every gutter between
    // tracks is removed. Measuring the pitch instead would drift by a gutter
    // at the far edge of a wide grid.
    const trackWidth = (width / scale - (gap * (columns - 1))) / columns;
    if (!(trackWidth > 0)) return null;
    // Dividing a screen coordinate by the zoom does not always land back on
    // the layout value it came from: at 0.67x the left edge of column 10
    // returns 452.99999999999994, which floors into column 9. A billionth of a
    // cell is far above that error and far below anything a pointer can
    // express, so it settles the seam cases without moving any other answer.
    const seam = 1e-9;
    const columnStart = Math.max(1, Math.min(columns, Math.floor(x / (trackWidth + gap) + seam) + 1));
    const rowStart = Math.max(1, Math.min(MAX_ROWS, Math.floor(y / (rowSize + gap) + seam) + 1));
    return { columnStart, rowStart };
  }

  // Keep a placement inside its parent. The operation layer refuses anything
  // that overflows, so an interaction can stay optimistic and clamp here
  // rather than each caller inventing its own edge handling.
  function clampPlacementToGrid(placement, columns) {
    if (!isPlainRecord(placement)) return null;
    const limit = Math.round(Number(columns));
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COLUMNS) return null;
    const columnSpan = Math.max(1, Math.min(limit, Math.round(Number(placement.columnSpan ?? 1)) || 1));
    const rowSpan = Math.max(1, Math.min(MAX_ROW_SPAN, Math.round(Number(placement.rowSpan ?? 1)) || 1));
    const result = { columnSpan, rowSpan };
    if (placement.columnStart !== undefined) {
      const columnStart = Math.max(1, Math.min(limit, Math.round(Number(placement.columnStart)) || 1));
      result.columnStart = Math.min(columnStart, (limit - columnSpan) + 1);
    }
    if (placement.rowStart !== undefined) {
      const rowStart = Math.max(1, Math.min(MAX_ROWS, Math.round(Number(placement.rowStart)) || 1));
      result.rowStart = Math.min(rowStart, (MAX_ROWS - rowSpan) + 1);
    }
    return result;
  }

  // Do two placed footprints share a cell. The port check has been carrying
  // its own copy of this; it is the runtime's predicate and belongs here, so
  // the occupancy work has one definition to build on rather than two.
  function placementsOverlap(left, right) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const box = (value) => {
      const columnStart = Number(value.columnStart);
      const rowStart = Number(value.rowStart);
      if (!Number.isFinite(columnStart) || !Number.isFinite(rowStart)) return null;
      return {
        columnStart,
        rowStart,
        columnSpan: Math.max(1, Number(value.columnSpan) || 1),
        rowSpan: Math.max(1, Number(value.rowSpan) || 1),
      };
    };
    const a = box(left);
    const b = box(right);
    // An unplaced node flows rather than occupying a coordinate, so it cannot
    // collide with anything.
    if (!a || !b) return false;
    return a.columnStart < b.columnStart + b.columnSpan
      && b.columnStart < a.columnStart + a.columnSpan
      && a.rowStart < b.rowStart + b.rowSpan
      && b.rowStart < a.rowStart + a.rowSpan;
  }


  // ==================================================================
  // DISPLACEMENT
  //
  // What happens to everyone else when one pane is dropped or stretched onto
  // cells somebody is already using.
  //
  // The order is compress, then relocate, then refuse. Compressing keeps a
  // pane exactly where it is and only makes it smaller, so a person watching
  // sees the thing they are holding push its neighbour thinner rather than
  // fling it somewhere else. Relocation is the fallback for a pane that
  // cannot get thin enough, and refusing the whole arrangement is the
  // fallback for that.
  //
  // Compression is also the cheap case, and provably so: a compressed
  // footprint is a subset of the one it replaces, so it cannot overlap
  // anything its old footprint did not. That means compression never
  // cascades and never needs a second pass. Only relocation can start a
  // chain, so only relocation is allowed to.
  // ==================================================================


  // Can `box` be made to clear `blocker` by shrinking alone, without leaving
  // the area it already occupies? Returns the smaller footprint, or null when
  // every option would take it below its floor.
  function compressedAway(box, blocker, floors) {
    if (!placementsOverlap(box, blocker)) return { ...box };
    const minColumnSpan = Math.max(1, Math.round(Number(floors?.minColumnSpan)) || 1);
    const minRowSpan = Math.max(1, Math.round(Number(floors?.minRowSpan)) || 1);
    const candidates = [];

    // Keep the left edge, pull the right edge in until it clears.
    const keptLeftSpan = blocker.columnStart - box.columnStart;
    if (keptLeftSpan >= minColumnSpan) {
      candidates.push({ ...box, columnSpan: keptLeftSpan });
    }
    // Keep the right edge, push the left edge in.
    const blockerRight = blocker.columnStart + blocker.columnSpan;
    const keptRightSpan = (box.columnStart + box.columnSpan) - blockerRight;
    if (keptRightSpan >= minColumnSpan) {
      candidates.push({ ...box, columnStart: blockerRight, columnSpan: keptRightSpan });
    }
    // The same two moves on the row axis.
    const keptTopSpan = blocker.rowStart - box.rowStart;
    if (keptTopSpan >= minRowSpan) {
      candidates.push({ ...box, rowSpan: keptTopSpan });
    }
    const blockerBottom = blocker.rowStart + blocker.rowSpan;
    const keptBottomSpan = (box.rowStart + box.rowSpan) - blockerBottom;
    if (keptBottomSpan >= minRowSpan) {
      candidates.push({ ...box, rowStart: blockerBottom, rowSpan: keptBottomSpan });
    }
    if (!candidates.length) return null;

    // Keep the most area; break ties towards the option that also keeps the
    // pane's own origin, because a pane that shrinks from its far edge looks
    // like it stayed put and a pane that shrinks from its near edge looks like
    // it slid.
    let best = null;
    let bestScore = -1;
    for (const candidate of candidates) {
      const area = candidate.columnSpan * candidate.rowSpan;
      const stayed = (candidate.columnStart === box.columnStart && candidate.rowStart === box.rowStart) ? 1 : 0;
      const score = (area * 2) + stayed;
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }

  // Plan the whole arrangement. `entries` is [{ id, placement, floors? }] for
  // every child of the grid; a child with no placement is flowing and is left
  // alone. Returns { ok: true, placements, compressed, relocated } carrying
  // only the nodes that changed, or { ok: false, reason }.
  function resolvePlacements(entries, moverId, desired, columns, options) {
    if (!Array.isArray(entries)) return { ok: false, reason: 'ENTRIES_INVALID' };
    const limit = Math.round(Number(columns));
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COLUMNS) return { ok: false, reason: 'COLUMNS_INVALID' };
    const target = clampPlacementToGrid(desired, limit);
    if (!target || target.columnStart === undefined || target.rowStart === undefined) return { ok: false, reason: 'DESIRED_INVALID' };

    const others = [];
    let moverSeen = false;
    for (const entry of entries) {
      if (!isPlainRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
      if (entry.id === moverId) { moverSeen = true; continue; }
      if (!isPlainRecord(entry.placement)) continue;
      if (entry.placement.columnStart === undefined || entry.placement.rowStart === undefined) continue;
      others.push({ id: entry.id, placement: { ...entry.placement }, floors: entry.floors || options });
    }
    if (!moverSeen) return { ok: false, reason: 'MOVER_NOT_FOUND' };

    const settled = new Map(others.map((entry) => [entry.id, entry.placement]));
    const floorsById = new Map(others.map((entry) => [entry.id, entry.floors]));
    const changed = new Map();
    const compressed = [];
    const relocated = [];

    const collides = (id, box) => {
      for (const [otherId, placement] of settled) {
        if (otherId === id) continue;
        if (placementsOverlap(box, placement)) return true;
      }
      return placementsOverlap(box, changed.get(moverId) || target);
    };

    changed.set(moverId, target);

    // A generous but finite guard: a cycle here would be an infinite loop
    // inside a pointer gesture.
    const queue = [{ id: moverId, placement: target }];
    let guard = (others.length + 1) * 8;
    while (queue.length) {
      if ((guard -= 1) < 0) return { ok: false, reason: 'DID_NOT_SETTLE' };
      const active = queue.shift();
      for (const [id, placement] of [...settled]) {
        if (id === active.id) continue;
        if (!placementsOverlap(active.placement, placement)) continue;

        // 1. Compress in place.
        const smaller = compressedAway(placement, active.placement, floorsById.get(id));
        if (smaller && !collides(id, smaller)) {
          settled.set(id, smaller);
          changed.set(id, smaller);
          compressed.push(id);
          // A subset cannot collide with anything new, so nothing is queued.
          continue;
        }

        // 2. Relocate: straight down in its own column, by the minimum that
        //    clears the pane that is actually pushing it -- not by enough to
        //    find an empty hole. Hunting for a hole would make this pane
        //    leapfrog its neighbour and leave the neighbour untouched, which
        //    is the teleporting behaviour this whole ordering exists to avoid.
        //    Landing on somebody is expected: they are queued next and pushed
        //    in turn, which is what makes the shuffle look like one motion.
        const rowStart = active.placement.rowStart + active.placement.rowSpan;
        if (rowStart + placement.rowSpan - 1 > MAX_ROWS) return { ok: false, reason: 'NO_ROOM' };
        const moved = { ...placement, rowStart };
        settled.set(id, moved);
        changed.set(id, moved);
        relocated.push(id);
        queue.push({ id, placement: moved });
      }
    }

    const placements = {};
    for (const [id, placement] of changed) placements[id] = placement;
    return { ok: true, placements, compressed, relocated };
  }


  // ==================================================================
  // ANCHORS
  //
  // Three attempts to make the drag resolver feel continuous all failed the
  // same way: where two ways of clearing a neighbour are equally defensible,
  // the solver picks one arbitrarily, and an arbitrary choice flips as the
  // pointer moves. The fix is not a better tiebreak. It is to stop the tie
  // from existing.
  //
  // An anchor is the person saying which pane is not the one that should
  // give. A pane anchored in position will not be relocated; a pane anchored
  // in size will not be compressed; a pane anchored firmly is neither, and is
  // simply a wall. What pushes against a wall is what yields -- including the
  // pane being dragged, which compresses itself rather than shoving something
  // the person has declared fixed.
  //
  // The anchor values are 'none', 'position', 'size' and 'firm'. Anything
  // unrecognised reads as 'none', so an older graph loads as fully mobile.
  // ==================================================================

  function anchorOf(entry) {
    const value = typeof entry?.pin === 'string' ? entry.pin : 'none';
    return PIN_STATES.includes(value) ? value : 'none';
  }

  function canRelocate(anchor) { return anchor === 'none' || anchor === 'size'; }
  function canCompress(anchor) { return anchor === 'none' || anchor === 'position'; }
  // A wall is a pane that can give neither ground nor size. A pane anchored
  // only in position is not a wall: it stays on its row and still gets
  // thinner, which is the whole point of pinning where something sits without
  // also freezing how big it is.
  function isWall(anchor) { return !canRelocate(anchor) && !canCompress(anchor); }

  // Shrink `box` until it clears `blocker`, preferring the edge that the
  // blocker is pushing against. Returns null when no option stays above the
  // floors. Shared by neighbours yielding to a drag and by a dragged pane
  // yielding to an anchor.
  function compressionOptions(box, blocker, floors) {
    const minColumnSpan = Math.max(1, Math.round(Number(floors?.minColumnSpan)) || 1);
    const minRowSpan = Math.max(1, Math.round(Number(floors?.minRowSpan)) || 1);
    const options = [];
    const keptLeft = blocker.columnStart - box.columnStart;
    if (keptLeft >= minColumnSpan) options.push({ side: 'left', placement: { ...box, columnSpan: keptLeft } });
    const blockerRight = blocker.columnStart + blocker.columnSpan;
    const keptRight = (box.columnStart + box.columnSpan) - blockerRight;
    if (keptRight >= minColumnSpan) options.push({ side: 'right', placement: { ...box, columnStart: blockerRight, columnSpan: keptRight } });
    const keptTop = blocker.rowStart - box.rowStart;
    if (keptTop >= minRowSpan) options.push({ side: 'top', placement: { ...box, rowSpan: keptTop } });
    const blockerBottom = blocker.rowStart + blocker.rowSpan;
    const keptBottom = (box.rowStart + box.rowSpan) - blockerBottom;
    if (keptBottom >= minRowSpan) options.push({ side: 'bottom', placement: { ...box, rowStart: blockerBottom, rowSpan: keptBottom } });
    return options;
  }

  // Which edge should the pane in the way give up? The one the dragged pane is
  // coming from. Choosing by remaining area instead swaps sides as the dragged
  // pane crosses the middle, which is a jump the width of the whole pane.
  function yieldingSide(options, box, blocker) {
    if (!options.length) return null;
    const overlap = (aStart, aSpan, bStart, bSpan) => Math.min(aStart + aSpan, bStart + bSpan) - Math.max(aStart, bStart);
    const columnOverlap = overlap(box.columnStart, box.columnSpan, blocker.columnStart, blocker.columnSpan);
    const rowOverlap = overlap(box.rowStart, box.rowSpan, blocker.rowStart, blocker.rowSpan);
    const columnSide = (blocker.columnStart + blocker.columnSpan / 2) <= (box.columnStart + box.columnSpan / 2) ? 'right' : 'left';
    const rowSide = (blocker.rowStart + blocker.rowSpan / 2) <= (box.rowStart + box.rowSpan / 2) ? 'bottom' : 'top';
    const order = columnOverlap <= rowOverlap ? [columnSide, rowSide] : [rowSide, columnSide];
    for (const side of order) {
      const option = options.find((candidate) => candidate.side === side);
      if (option) return option.placement;
    }
    return options[0].placement;
  }

  // Resolve a placement against a canvas that has anchors in it.
  //
  // `entries` is [{ id, placement, anchor?, floors? }]. Returns
  // { ok, placements, compressed, relocated, moverCompressed } carrying only
  // what changed, or { ok: false, reason }.
  function resolveWithAnchors(entries, moverId, desired, columns) {
    if (!Array.isArray(entries)) return { ok: false, reason: 'ENTRIES_INVALID' };
    const limit = Math.round(Number(columns));
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COLUMNS) return { ok: false, reason: 'COLUMNS_INVALID' };
    let target = clampPlacementToGrid(desired, limit);
    if (!target || target.columnStart === undefined || target.rowStart === undefined) return { ok: false, reason: 'DESIRED_INVALID' };

    const others = [];
    let mover = null;
    for (const entry of entries) {
      if (!isPlainRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
      if (entry.id === moverId) { mover = entry; continue; }
      if (!isPlainRecord(entry.placement)) continue;
      if (entry.placement.columnStart === undefined || entry.placement.rowStart === undefined) continue;
      others.push({ id: entry.id, placement: { ...entry.placement }, anchor: anchorOf(entry), floors: entry.floors });
    }
    if (!mover) return { ok: false, reason: 'MOVER_NOT_FOUND' };
    // A firmly anchored pane is not draggable at all. The interface should not
    // offer the gesture, and if it does, this refuses rather than quietly
    // breaking the promise the anchor made.
    if (isWall(anchorOf(mover))) return { ok: false, reason: 'MOVER_ANCHORED' };

    // 1. Walls first. The dragged pane yields to anything anchored against
    //    relocation, because that is what the person pinned it for.
    let moverCompressed = false;
    for (const other of others) {
      if (!isWall(other.anchor)) continue;
      if (!placementsOverlap(target, other.placement)) continue;
      const shrunk = yieldingSide(compressionOptions(target, other.placement, mover.floors), target, other.placement);
      if (!shrunk) return { ok: false, reason: 'BLOCKED_BY_ANCHOR' };
      target = shrunk;
      moverCompressed = true;
    }
    // Shrinking away from one wall can push it into another, so settle.
    for (let pass = 0; pass < others.length + 1; pass += 1) {
      const wall = others.find((other) => isWall(other.anchor) && placementsOverlap(target, other.placement));
      if (!wall) break;
      const shrunk = yieldingSide(compressionOptions(target, wall.placement, mover.floors), target, wall.placement);
      if (!shrunk) return { ok: false, reason: 'BLOCKED_BY_ANCHOR' };
      target = shrunk;
      moverCompressed = true;
    }
    if (others.some((other) => isWall(other.anchor) && placementsOverlap(target, other.placement))) {
      return { ok: false, reason: 'BLOCKED_BY_ANCHOR' };
    }

    // 2. Everything mobile yields around the settled target.
    const settled = new Map(others.map((entry) => [entry.id, entry.placement]));
    const byId = new Map(others.map((entry) => [entry.id, entry]));
    const changed = new Map([[moverId, target]]);
    const compressed = [];
    const relocated = [];

    const collides = (id, box) => {
      for (const [otherId, placement] of settled) {
        if (otherId === id) continue;
        if (placementsOverlap(box, placement)) return true;
      }
      return placementsOverlap(box, changed.get(moverId));
    };

    const queue = [{ id: moverId, placement: target }];
    let guard = (others.length + 1) * 8;
    while (queue.length) {
      if ((guard -= 1) < 0) return { ok: false, reason: 'DID_NOT_SETTLE' };
      const active = queue.shift();
      for (const [id, placement] of [...settled]) {
        if (id === active.id) continue;
        if (!placementsOverlap(active.placement, placement)) continue;
        const entry = byId.get(id);

        if (canCompress(entry.anchor)) {
          const options = compressionOptions(placement, active.placement, entry.floors)
            .filter((option) => !collides(id, option.placement));
          const shrunk = yieldingSide(options, placement, active.placement);
          if (shrunk) {
            settled.set(id, shrunk);
            changed.set(id, shrunk);
            compressed.push(id);
            // A compressed footprint is a subset of the one it replaces, so it
            // cannot collide with anything its old one did not. Nothing queues.
            continue;
          }
        }

        if (!canRelocate(entry.anchor)) return { ok: false, reason: 'BLOCKED_BY_ANCHOR' };
        const rowStart = active.placement.rowStart + active.placement.rowSpan;
        if (rowStart + placement.rowSpan - 1 > MAX_ROWS) return { ok: false, reason: 'NO_ROOM' };
        const moved = { ...placement, rowStart };
        settled.set(id, moved);
        changed.set(id, moved);
        relocated.push(id);
        queue.push({ id, placement: moved });
      }
    }

    const placements = {};
    for (const [id, placement] of changed) placements[id] = placement;
    return { ok: true, placements, compressed, relocated, moverCompressed };
  }

  return Object.freeze({
    COMPOSITION_CONTRACT_VERSION,
    MAX_GRAPH_DEPTH,
    MAX_GRAPH_NODES,
    MAX_CONTAINER_CHILDREN,
    MAX_CONFIGURATION_BYTES,
    MAX_TOTAL_CONFIGURATION_BYTES,
    KEY_PATTERN,
    NODE_ID_PATTERN,
    NODE_TYPES,
    SHAPE_FAMILIES,
    SPLIT_AXES,
    GRID_ROW_POLICIES,
    DOCK_EDGES,
    DOCK_SIZE_POLICIES,
    OVERLAY_ANCHORS,
    OVERLAY_BOUNDS_POLICIES,
    isPlainRecord,
    stableStringify,
    deepFreeze,
    walkGraph,
    deriveFocusOrder,
    findNode,
    normalizeConfiguration,
    normalizeGraph,
    validateGraph,
    assertGraph,
    resolveGraph,
    COLUMN_DIVISIONS,
    ROW_DIVISIONS,
    MAX_COLUMNS,
    MAX_ROW_SPAN,
    MAX_ROWS,
    placementFromPoint,
    clampPlacementToGrid,
    placementsOverlap,
    compressedAway,
    resolvePlacements,
    PIN_STATES,
    anchorOf,
    compressionOptions,
    resolveWithAnchors,
  });
}));
