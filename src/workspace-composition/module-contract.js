(function pixelodyWorkspaceModuleContractFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.PixelodyWorkspaceCompositionContract;
  const api = factory(composition);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceModuleContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceModuleContractApi(composition) {
  'use strict';

  if (!composition) throw new Error('Workspace module contract requires the composition contract.');

  const MODULE_CONTRACT_VERSION = 1;
  const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
  const INSTANCE_POLICIES = Object.freeze(['single', 'multiple']);
  const PERFORMANCE_COSTS = Object.freeze(['low', 'medium', 'high']);
  const SCHEDULER_MODES = Object.freeze(['none', 'shared']);
  const MOTION_OFF_POLICIES = Object.freeze(['unchanged', 'static', 'hide-decoration']);
  const FOCUS_POLICIES = Object.freeze(['none', 'entry', 'roving', 'document']);
  const STATUS_POLICIES = Object.freeze(['none', 'polite', 'assertive']);
  const MINI_RELATIONSHIPS = Object.freeze(['main-only', 'distinct', 'shared-configuration', 'mini-only']);
  const RESIZE_AXES = Object.freeze(['inline', 'block']);
  const SCROLL_POLICIES = Object.freeze(['none', 'inline', 'block', 'both']);
  const LAYOUT_DIRECTIONS = Object.freeze(['ltr', 'rtl']);
  const LAYOUT_MODES = Object.freeze(['workspace', 'mini']);
  const VISIBILITY_REASONS = Object.freeze(['visible', 'stack-inactive', 'occluded', 'window-hidden', 'suspended']);
  const REQUIRED_LIFECYCLE_METHODS = Object.freeze(['mount', 'update', 'setLayout', 'setVisibility', 'focus', 'serializeConfiguration', 'destroy']);
  const DESCRIPTOR_KEYS = new Set([
    'contractVersion', 'key', 'version', 'family', 'productJobs', 'reads', 'commands',
    'shapes', 'defaultShape', 'instancePolicy', 'performance', 'motionOff',
    'accessibility', 'miniRelationship', 'configurationSchemaVersion',
    'defaultConfiguration', 'fallbackKey', 'fallbackDescription', 'isFallback', 'create',
  ]);

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function issue(code, path, message) {
    return Object.freeze({ code, path, message });
  }

  function stringKeyArray(value, path, errors) {
    if (!Array.isArray(value)) {
      errors.push(issue('MODULE_KEY_ARRAY_INVALID', path, `${path} must be an array.`));
      return [];
    }
    const seen = new Set();
    const result = [];
    value.forEach((entry, index) => {
      if (!composition.KEY_PATTERN.test(entry || '')) errors.push(issue('MODULE_KEY_INVALID', `${path}[${index}]`, `${path} entries must be lowercase namespaced keys.`));
      else if (seen.has(entry)) errors.push(issue('MODULE_KEY_DUPLICATE', `${path}[${index}]`, `Duplicate key "${entry}" in ${path}.`));
      else { seen.add(entry); result.push(entry); }
    });
    return result;
  }

  function boundedNumber(value, fallback, minimum, maximum, path, errors) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      errors.push(issue('MODULE_SIZE_INVALID', path, `${path} must be between ${minimum} and ${maximum}.`));
      return fallback;
    }
    return number;
  }

  function normalizeShape(key, value, path, errors) {
    if (!composition.SHAPE_FAMILIES.includes(key)) {
      errors.push(issue('MODULE_SHAPE_KEY_INVALID', path, `Unknown shape family "${key}".`));
      return null;
    }
    if (!composition.isPlainRecord(value)) {
      errors.push(issue('MODULE_SHAPE_DESCRIPTOR_INVALID', path, 'Shape descriptor must be an object.'));
      return null;
    }
    const allowed = new Set(['minInline', 'minBlock', 'maxInline', 'maxBlock', 'targetInline', 'targetBlock', 'resizeAxes', 'scrollPolicy']);
    Object.keys(value).forEach((field) => { if (!allowed.has(field)) errors.push(issue('MODULE_SHAPE_FIELD_UNKNOWN', `${path}.${field}`, `Unknown shape field "${field}".`)); });
    const minInline = boundedNumber(value.minInline, 1, 0, 8192, `${path}.minInline`, errors);
    const minBlock = boundedNumber(value.minBlock, 1, 0, 8192, `${path}.minBlock`, errors);
    const maxInline = boundedNumber(value.maxInline, 8192, minInline, 8192, `${path}.maxInline`, errors);
    const maxBlock = boundedNumber(value.maxBlock, 8192, minBlock, 8192, `${path}.maxBlock`, errors);
    const targetInline = boundedNumber(value.targetInline, minInline, minInline, maxInline, `${path}.targetInline`, errors);
    const targetBlock = boundedNumber(value.targetBlock, minBlock, minBlock, maxBlock, `${path}.targetBlock`, errors);
    const resizeAxes = Array.isArray(value.resizeAxes) ? [...new Set(value.resizeAxes)] : [];
    resizeAxes.forEach((axis, index) => { if (!RESIZE_AXES.includes(axis)) errors.push(issue('MODULE_RESIZE_AXIS_INVALID', `${path}.resizeAxes[${index}]`, `Unknown resize axis "${axis}".`)); });
    const scrollPolicy = value.scrollPolicy || 'none';
    if (!SCROLL_POLICIES.includes(scrollPolicy)) errors.push(issue('MODULE_SCROLL_POLICY_INVALID', `${path}.scrollPolicy`, `Unknown scroll policy "${scrollPolicy}".`));
    return Object.freeze({ minInline, minBlock, maxInline, maxBlock, targetInline, targetBlock, resizeAxes: Object.freeze(resizeAxes.filter((axis) => RESIZE_AXES.includes(axis))), scrollPolicy: SCROLL_POLICIES.includes(scrollPolicy) ? scrollPolicy : 'none' });
  }

  function normalizePerformance(value, errors) {
    const source = composition.isPlainRecord(value) ? value : {};
    if (!composition.isPlainRecord(value)) errors.push(issue('MODULE_PERFORMANCE_INVALID', 'descriptor.performance', 'performance must be an object.'));
    const allowed = new Set(['cost', 'scheduler', 'pausesWhenHidden', 'conserveFps']);
    Object.keys(source).forEach((field) => { if (!allowed.has(field)) errors.push(issue('MODULE_PERFORMANCE_FIELD_UNKNOWN', `descriptor.performance.${field}`, `Unknown performance field "${field}".`)); });
    const cost = source.cost || 'low';
    const scheduler = source.scheduler || 'none';
    if (!PERFORMANCE_COSTS.includes(cost)) errors.push(issue('MODULE_COST_INVALID', 'descriptor.performance.cost', `Unknown performance cost "${cost}".`));
    if (!SCHEDULER_MODES.includes(scheduler)) errors.push(issue('MODULE_SCHEDULER_INVALID', 'descriptor.performance.scheduler', `Unknown scheduler mode "${scheduler}".`));
    const pausesWhenHidden = source.pausesWhenHidden !== false;
    const conserveFps = boundedNumber(source.conserveFps, scheduler === 'shared' ? 12 : 0, 0, 60, 'descriptor.performance.conserveFps', errors);
    if (scheduler === 'none' && conserveFps !== 0) errors.push(issue('MODULE_SCHEDULER_FPS_INVALID', 'descriptor.performance.conserveFps', 'A module without a scheduler must use conserveFps 0.'));
    return Object.freeze({ cost: PERFORMANCE_COSTS.includes(cost) ? cost : 'low', scheduler: SCHEDULER_MODES.includes(scheduler) ? scheduler : 'none', pausesWhenHidden, conserveFps });
  }

  function normalizeAccessibility(value, errors) {
    const source = composition.isPlainRecord(value) ? value : {};
    if (!composition.isPlainRecord(value)) errors.push(issue('MODULE_ACCESSIBILITY_INVALID', 'descriptor.accessibility', 'accessibility must be an object.'));
    const allowed = new Set(['name', 'focusPolicy', 'status', 'nonDragActions']);
    Object.keys(source).forEach((field) => { if (!allowed.has(field)) errors.push(issue('MODULE_ACCESSIBILITY_FIELD_UNKNOWN', `descriptor.accessibility.${field}`, `Unknown accessibility field "${field}".`)); });
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) errors.push(issue('MODULE_ACCESSIBLE_NAME_MISSING', 'descriptor.accessibility.name', 'A module must declare a non-empty accessible name.'));
    const focusPolicy = source.focusPolicy || 'none';
    const status = source.status || 'none';
    if (!FOCUS_POLICIES.includes(focusPolicy)) errors.push(issue('MODULE_FOCUS_POLICY_INVALID', 'descriptor.accessibility.focusPolicy', `Unknown focus policy "${focusPolicy}".`));
    if (!STATUS_POLICIES.includes(status)) errors.push(issue('MODULE_STATUS_POLICY_INVALID', 'descriptor.accessibility.status', `Unknown status policy "${status}".`));
    if (source.nonDragActions !== true) errors.push(issue('MODULE_NON_DRAG_ACTIONS_REQUIRED', 'descriptor.accessibility.nonDragActions', 'Composition modules must support non-drag placement actions.'));
    return Object.freeze({ name, focusPolicy: FOCUS_POLICIES.includes(focusPolicy) ? focusPolicy : 'none', status: STATUS_POLICIES.includes(status) ? status : 'none', nonDragActions: source.nonDragActions === true });
  }

  function normalizeDescriptor(value) {
    const errors = [];
    if (!composition.isPlainRecord(value)) return Object.freeze({ valid: false, descriptor: null, errors: Object.freeze([issue('MODULE_DESCRIPTOR_INVALID', 'descriptor', 'Module descriptor must be an object.')]) });
    Object.keys(value).forEach((key) => { if (!DESCRIPTOR_KEYS.has(key)) errors.push(issue('MODULE_DESCRIPTOR_FIELD_UNKNOWN', `descriptor.${key}`, `Unknown module descriptor field "${key}".`)); });
    const contractVersion = Number(value.contractVersion ?? MODULE_CONTRACT_VERSION);
    if (contractVersion !== MODULE_CONTRACT_VERSION) errors.push(issue('MODULE_CONTRACT_VERSION_UNSUPPORTED', 'descriptor.contractVersion', `Unsupported module contract version "${contractVersion}".`));
    const key = typeof value.key === 'string' ? value.key : '';
    const family = typeof value.family === 'string' ? value.family : '';
    if (!composition.KEY_PATTERN.test(key)) errors.push(issue('MODULE_KEY_INVALID', 'descriptor.key', 'Module key must be a lowercase namespaced key.'));
    if (!composition.KEY_PATTERN.test(family)) errors.push(issue('MODULE_FAMILY_INVALID', 'descriptor.family', 'Module family must be a lowercase namespaced key.'));
    const version = typeof value.version === 'string' ? value.version : '';
    if (!SEMVER_PATTERN.test(version)) errors.push(issue('MODULE_VERSION_INVALID', 'descriptor.version', 'Module version must be semantic version text such as 1.0.0.'));
    const productJobs = stringKeyArray(value.productJobs ?? [], 'descriptor.productJobs', errors);
    const reads = stringKeyArray(value.reads ?? [], 'descriptor.reads', errors);
    const commands = stringKeyArray(value.commands ?? [], 'descriptor.commands', errors);
    const shapes = Object.create(null);
    if (!composition.isPlainRecord(value.shapes) || !Object.keys(value.shapes).length) errors.push(issue('MODULE_SHAPES_INVALID', 'descriptor.shapes', 'A module must declare at least one shape descriptor.'));
    else Object.keys(value.shapes).sort().forEach((shape) => {
      const normalized = normalizeShape(shape, value.shapes[shape], `descriptor.shapes.${shape}`, errors);
      if (normalized) shapes[shape] = normalized;
    });
    const defaultShape = value.defaultShape || Object.keys(shapes)[0] || '';
    if (!own(shapes, defaultShape)) errors.push(issue('MODULE_DEFAULT_SHAPE_INVALID', 'descriptor.defaultShape', 'defaultShape must reference a declared shape.'));
    const instancePolicy = value.instancePolicy || 'single';
    if (!INSTANCE_POLICIES.includes(instancePolicy)) errors.push(issue('MODULE_INSTANCE_POLICY_INVALID', 'descriptor.instancePolicy', `Unknown instance policy "${instancePolicy}".`));
    const performance = normalizePerformance(value.performance, errors);
    const motionOff = value.motionOff || 'unchanged';
    if (!MOTION_OFF_POLICIES.includes(motionOff)) errors.push(issue('MODULE_MOTION_OFF_INVALID', 'descriptor.motionOff', `Unknown motion-off policy "${motionOff}".`));
    const accessibility = normalizeAccessibility(value.accessibility, errors);
    const miniRelationship = value.miniRelationship || 'main-only';
    if (!MINI_RELATIONSHIPS.includes(miniRelationship)) errors.push(issue('MODULE_MINI_RELATIONSHIP_INVALID', 'descriptor.miniRelationship', `Unknown mini relationship "${miniRelationship}".`));
    const configurationSchemaVersion = Number(value.configurationSchemaVersion ?? 1);
    if (!Number.isInteger(configurationSchemaVersion) || configurationSchemaVersion < 1) errors.push(issue('MODULE_CONFIGURATION_VERSION_INVALID', 'descriptor.configurationSchemaVersion', 'configurationSchemaVersion must be a positive integer.'));
    const defaultConfiguration = composition.normalizeConfiguration(value.defaultConfiguration ?? {}, 'descriptor.defaultConfiguration');
    errors.push(...defaultConfiguration.errors);
    const isFallback = value.isFallback === true;
    const fallbackKey = typeof value.fallbackKey === 'string' ? value.fallbackKey : '';
    const fallbackDescription = typeof value.fallbackDescription === 'string' ? value.fallbackDescription.trim() : '';
    if (!isFallback && !composition.KEY_PATTERN.test(fallbackKey)) errors.push(issue('MODULE_FALLBACK_KEY_INVALID', 'descriptor.fallbackKey', 'Non-fallback modules must reference a product-owned fallback module key.'));
    if (isFallback && fallbackKey) errors.push(issue('MODULE_FALLBACK_RECURSIVE', 'descriptor.fallbackKey', 'A fallback module cannot declare another fallback.'));
    if (!fallbackDescription) errors.push(issue('MODULE_FALLBACK_DESCRIPTION_MISSING', 'descriptor.fallbackDescription', 'fallbackDescription is required.'));
    if (typeof value.create !== 'function') errors.push(issue('MODULE_FACTORY_MISSING', 'descriptor.create', 'A module descriptor must provide create(context).'));

    if (errors.length) return Object.freeze({ valid: false, descriptor: null, errors: Object.freeze(errors) });
    const descriptor = {
      contractVersion,
      key,
      version,
      family,
      productJobs: Object.freeze(productJobs),
      reads: Object.freeze(reads),
      commands: Object.freeze(commands),
      shapes: Object.freeze(shapes),
      defaultShape,
      targetShape: defaultShape,
      instancePolicy,
      performance,
      motionOff,
      accessibility,
      miniRelationship,
      configurationSchemaVersion,
      defaultConfiguration: defaultConfiguration.configuration,
      fallbackKey,
      fallbackDescription,
      isFallback,
      create: value.create,
    };
    return Object.freeze({ valid: true, descriptor: Object.freeze(descriptor), errors: Object.freeze([]) });
  }

  function validateDescriptor(value) {
    const result = normalizeDescriptor(value);
    return Object.freeze({ valid: result.valid, errors: result.errors });
  }

  function validateLifecycle(value) {
    const errors = [];
    if (!value || typeof value !== 'object') return Object.freeze({ valid: false, errors: Object.freeze([issue('MODULE_LIFECYCLE_INVALID', 'lifecycle', 'Module lifecycle must be an object.')]) });
    REQUIRED_LIFECYCLE_METHODS.forEach((method) => {
      if (typeof value[method] !== 'function') errors.push(issue('MODULE_LIFECYCLE_METHOD_MISSING', `lifecycle.${method}`, `Module lifecycle is missing ${method}().`));
    });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }

  function readonlyClone(value, path = 'snapshot') {
    const normalized = composition.normalizeConfiguration(value, path);
    if (!normalized.valid) {
      const failure = new Error(`${path} must contain bounded JSON data.`);
      failure.code = 'MODULE_SNAPSHOT_INVALID';
      failure.validation = normalized;
      throw failure;
    }
    return normalized.configuration;
  }

  function normalizeLayoutContext(value, descriptor) {
    const errors = [];
    const source = composition.isPlainRecord(value) ? value : {};
    if (!composition.isPlainRecord(value)) errors.push(issue('MODULE_LAYOUT_INVALID', 'layout', 'Layout context must be an object.'));
    const allowed = new Set(['shape', 'inlineSize', 'blockSize', 'pixelRatio', 'direction', 'mode', 'motionAllowed', 'conserve']);
    Object.keys(source).forEach((field) => { if (!allowed.has(field)) errors.push(issue('MODULE_LAYOUT_FIELD_UNKNOWN', `layout.${field}`, `Unknown layout field "${field}".`)); });
    const shape = source.shape || descriptor.defaultShape;
    if (!own(descriptor.shapes, shape)) errors.push(issue('MODULE_LAYOUT_SHAPE_UNSUPPORTED', 'layout.shape', `Module "${descriptor.key}" does not support shape "${shape}".`));
    const shapeDescriptor = descriptor.shapes[shape] || descriptor.shapes[descriptor.defaultShape];
    const inlineSize = boundedNumber(source.inlineSize, shapeDescriptor.targetInline, shapeDescriptor.minInline, shapeDescriptor.maxInline, 'layout.inlineSize', errors);
    const blockSize = boundedNumber(source.blockSize, shapeDescriptor.targetBlock, shapeDescriptor.minBlock, shapeDescriptor.maxBlock, 'layout.blockSize', errors);
    const pixelRatio = boundedNumber(source.pixelRatio, 1, 0.5, 4, 'layout.pixelRatio', errors);
    const direction = source.direction || 'ltr';
    const mode = source.mode || 'workspace';
    if (!LAYOUT_DIRECTIONS.includes(direction)) errors.push(issue('MODULE_LAYOUT_DIRECTION_INVALID', 'layout.direction', `Unknown layout direction "${direction}".`));
    if (!LAYOUT_MODES.includes(mode)) errors.push(issue('MODULE_LAYOUT_MODE_INVALID', 'layout.mode', `Unknown layout mode "${mode}".`));
    const layout = Object.freeze({
      shape: own(descriptor.shapes, shape) ? shape : descriptor.defaultShape,
      inlineSize,
      blockSize,
      pixelRatio,
      direction: LAYOUT_DIRECTIONS.includes(direction) ? direction : 'ltr',
      mode: LAYOUT_MODES.includes(mode) ? mode : 'workspace',
      motionAllowed: source.motionAllowed !== false,
      conserve: source.conserve === true,
    });
    return Object.freeze({ valid: errors.length === 0, layout: errors.length ? null : layout, candidate: layout, errors: Object.freeze(errors) });
  }

  function normalizeVisibilityState(value) {
    const errors = [];
    const source = typeof value === 'boolean' ? { visible: value } : value;
    if (!composition.isPlainRecord(source)) return Object.freeze({ valid: false, visibility: null, errors: Object.freeze([issue('MODULE_VISIBILITY_INVALID', 'visibility', 'Visibility must be a boolean or object.')]) });
    const allowed = new Set(['visible', 'reason']);
    Object.keys(source).forEach((field) => { if (!allowed.has(field)) errors.push(issue('MODULE_VISIBILITY_FIELD_UNKNOWN', `visibility.${field}`, `Unknown visibility field "${field}".`)); });
    if (typeof source.visible !== 'boolean') errors.push(issue('MODULE_VISIBILITY_VALUE_INVALID', 'visibility.visible', 'visibility.visible must be boolean.'));
    const defaultReason = source.visible === false ? 'occluded' : 'visible';
    const reason = source.reason || defaultReason;
    if (!VISIBILITY_REASONS.includes(reason)) errors.push(issue('MODULE_VISIBILITY_REASON_INVALID', 'visibility.reason', `Unknown visibility reason "${reason}".`));
    if (source.visible === true && reason !== 'visible') errors.push(issue('MODULE_VISIBILITY_REASON_CONFLICT', 'visibility.reason', 'A visible module must use reason "visible".'));
    if (source.visible === false && reason === 'visible') errors.push(issue('MODULE_VISIBILITY_REASON_CONFLICT', 'visibility.reason', 'A hidden module cannot use reason "visible".'));
    const visibility = Object.freeze({ visible: source.visible === true, reason: VISIBILITY_REASONS.includes(reason) ? reason : defaultReason });
    return Object.freeze({ valid: errors.length === 0, visibility: errors.length ? null : visibility, errors: Object.freeze(errors) });
  }

  function createCapabilityContext(descriptor, host = {}, identity = {}) {
    const allowedReads = new Set(descriptor.reads);
    const allowedCommands = new Set(descriptor.commands);
    function assertRead(key) {
      if (!allowedReads.has(key)) {
        const failure = new Error(`Module "${descriptor.key}" attempted undeclared read "${key}".`);
        failure.code = 'MODULE_READ_UNDECLARED';
        throw failure;
      }
    }
    function assertCommand(key) {
      if (!allowedCommands.has(key)) {
        const failure = new Error(`Module "${descriptor.key}" attempted undeclared command "${key}".`);
        failure.code = 'MODULE_COMMAND_UNDECLARED';
        throw failure;
      }
    }
    return Object.freeze({
      moduleKey: descriptor.key,
      family: descriptor.family,
      instanceId: typeof identity.instanceId === 'string' ? identity.instanceId : '',
      read(key) {
        assertRead(key);
        if (typeof host.read !== 'function') throw Object.assign(new Error(`Host read adapter is unavailable for "${key}".`), { code: 'MODULE_READ_ADAPTER_MISSING' });
        return readonlyClone(host.read(key));
      },
      subscribe(key, listener) {
        assertRead(key);
        if (typeof listener !== 'function') throw Object.assign(new Error('Module subscription listener must be a function.'), { code: 'MODULE_SUBSCRIBER_INVALID' });
        if (typeof host.subscribe !== 'function') throw Object.assign(new Error(`Host subscribe adapter is unavailable for "${key}".`), { code: 'MODULE_SUBSCRIBE_ADAPTER_MISSING' });
        const unsubscribe = host.subscribe(key, (snapshot) => listener(readonlyClone(snapshot)));
        return typeof unsubscribe === 'function' ? unsubscribe : () => {};
      },
      command(key, payload = {}) {
        assertCommand(key);
        if (typeof host.command !== 'function') throw Object.assign(new Error(`Host command adapter is unavailable for "${key}".`), { code: 'MODULE_COMMAND_ADAPTER_MISSING' });
        const normalized = composition.normalizeConfiguration(payload, `command.${key}`);
        if (!normalized.valid) throw Object.assign(new Error(`Module command payload for "${key}" is invalid.`), { code: 'MODULE_COMMAND_PAYLOAD_INVALID', validation: normalized });
        return host.command(key, normalized.configuration);
      },
      announce(message) {
        if (typeof host.announce === 'function') host.announce(String(message || ''));
      },
    });
  }

  return Object.freeze({
    MODULE_CONTRACT_VERSION,
    SEMVER_PATTERN,
    INSTANCE_POLICIES,
    PERFORMANCE_COSTS,
    SCHEDULER_MODES,
    MOTION_OFF_POLICIES,
    FOCUS_POLICIES,
    STATUS_POLICIES,
    MINI_RELATIONSHIPS,
    RESIZE_AXES,
    SCROLL_POLICIES,
    LAYOUT_DIRECTIONS,
    LAYOUT_MODES,
    VISIBILITY_REASONS,
    REQUIRED_LIFECYCLE_METHODS,
    normalizeDescriptor,
    validateDescriptor,
    validateLifecycle,
    createCapabilityContext,
    readonlyClone,
    normalizeLayoutContext,
    normalizeVisibilityState,
  });
}));
