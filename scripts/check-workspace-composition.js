const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const contract = require('../src/workspace-composition/contract');
const operations = require('../src/workspace-composition/operations');
const moduleContract = require('../src/workspace-composition/module-contract');
const moduleRegistry = require('../src/workspace-composition/module-registry');
const compositionSession = require('../src/workspace-composition/composition-session');
const interactionAdapter = require('../src/workspace-composition/interaction-adapter');
const workspacePersistence = require('../src/workspace-composition/persistence');
const firstPartyModules = require('../src/workspace-composition/first-party-modules');
const productionHost = require('../src/workspace-composition/production-host');
const themeExperiment = require('../src/workspace-composition/theme-experiment');
const canvasStudioPreset = require('../src/workspace-composition/canvas-studio-preset');
const moduleEffects = require('../src/workspace-composition/module-effects');
const navigationContract = require('../src/theme-runtime/navigation/contract');
const routeFieldMechanic = require('../src/theme-runtime/navigation/route-field');
const devLabSpecimens = require('../src/workspace-composition/dev-lab-specimens');
const devLabHost = require('../src/workspace-composition/dev-lab-host');

const moduleCatalog = Object.freeze({
  'library.browser': Object.freeze({
    productJobs: ['library-access'],
    shapes: ['panel'],
    instancePolicy: 'single',
    targetShape: 'panel',
    defaultConfiguration: { density: 'comfortable' },
  }),
  'tracks.browser': Object.freeze({
    productJobs: ['track-browsing'],
    shapes: ['panel', 'stage'],
    instancePolicy: 'single',
    targetShape: 'stage',
  }),
  'queue.view': Object.freeze({
    productJobs: ['queue-access'],
    shapes: ['strip', 'panel'],
    instancePolicy: 'single',
    targetShape: 'panel',
  }),
  'now-playing': Object.freeze({
    productJobs: ['current-track-identity'],
    shapes: ['strip', 'tile'],
    instancePolicy: 'single',
    targetShape: 'strip',
  }),
  'transport.controls': Object.freeze({
    productJobs: ['playback-transport'],
    shapes: ['strip', 'mini'],
    instancePolicy: 'single',
    targetShape: 'strip',
  }),
  'track.information': Object.freeze({
    productJobs: ['track-information'],
    shapes: ['panel'],
    instancePolicy: 'single',
    targetShape: 'panel',
  }),
  'audio.visualizer': Object.freeze({
    productJobs: ['decorative-signal-view'],
    shapes: ['strip', 'tile', 'stage', 'ambient'],
    instancePolicy: 'multiple',
    targetShape: 'tile',
    defaultConfiguration: { renderer: 'spectrum-deck', palette: 'neutral' },
  }),
  'artwork.stage': Object.freeze({
    productJobs: ['artwork-view'],
    shapes: ['tile', 'stage', 'ambient'],
    instancePolicy: 'single',
    targetShape: 'stage',
  }),
  'lyrics.view': Object.freeze({
    productJobs: ['lyrics-view'],
    shapes: ['panel', 'stage'],
    instancePolicy: 'single',
    targetShape: 'panel',
    defaultConfiguration: { timing: 'static' },
  }),
});

const requiredJobs = Object.freeze([
  'library-access',
  'track-browsing',
  'current-track-identity',
  'playback-transport',
]);

const validationOptions = Object.freeze({ moduleCatalog, requiredJobs });

function moduleNode(id, moduleKey, shape, configuration = {}) {
  return { type: 'module', id, moduleKey, shape, configuration };
}

function baseGraph() {
  return {
    type: 'root',
    id: 'workspace-root',
    schemaVersion: 1,
    children: [{
      type: 'split',
      id: 'workspace-shell',
      axis: 'vertical',
      weights: [8, 1],
      children: [{
        type: 'grid',
        id: 'primary-grid',
        columns: 12,
        rowPolicy: 'flow',
        children: [
          { ...moduleNode('library-module', 'library.browser', 'panel'), placement: { columnSpan: 3, rowSpan: 2 } },
          { ...moduleNode('tracks-module', 'tracks.browser', 'stage'), placement: { columnSpan: 6, rowSpan: 2 } },
          { ...moduleNode('queue-module', 'queue.view', 'panel'), placement: { columnSpan: 3, rowSpan: 1 } },
          { ...moduleNode('info-module', 'track.information', 'panel'), placement: { columnSpan: 3, rowSpan: 1 } },
          { ...moduleNode('visualizer-module', 'audio.visualizer', 'tile', { palette: 'neutral', renderer: 'spectrum-deck' }), placement: { columnSpan: 3, rowSpan: 1 } },
        ],
      }, {
        type: 'dock',
        id: 'transport-dock',
        edge: 'bottom',
        sizePolicy: 'content',
        children: [{
          type: 'stack',
          id: 'player-stack',
          activeChildId: 'transport-module',
          children: [
            moduleNode('transport-module', 'transport.controls', 'strip'),
            moduleNode('now-playing-module', 'now-playing', 'strip'),
          ],
        }],
      }],
    }],
  };
}

function find(graph, id) {
  return contract.findNode(graph, id)?.node || null;
}

function childIds(graph, id) {
  return find(graph, id).children.map((child) => child.id);
}

function expectFailure(result, code) {
  assert.equal(result.ok, false, `Expected failure ${code}.`);
  assert.equal(result.error.code, code);
}

function runContractChecks() {
  assert.equal(contract.COMPOSITION_CONTRACT_VERSION, 1);
  assert.ok(contract.NODE_TYPES.includes('overlay'));
  assert.ok(contract.SHAPE_FAMILIES.includes('ambient'));

  const normalized = contract.normalizeGraph(baseGraph(), validationOptions);
  assert.equal(normalized.valid, true, normalized.errors.map((entry) => entry.message).join('\n'));
  assert.equal(normalized.nodeCount, 12);
  assert.equal(Object.isFrozen(normalized.graph), true);
  assert.equal(Object.isFrozen(find(normalized.graph, 'primary-grid')), true);
  assert.equal(find(normalized.graph, 'workspace-shell').weights.reduce((sum, weight) => sum + weight, 0), 1);
  assert.deepEqual(contract.deriveFocusOrder(normalized.graph), ['library-module', 'tracks-module', 'queue-module', 'info-module', 'visualizer-module', 'transport-module']);
  assert.deepEqual(contract.deriveFocusOrder(normalized.graph, { includeInactiveStackChildren: true }).slice(-2), ['transport-module', 'now-playing-module']);

  const reorderedKeys = JSON.parse(JSON.stringify(baseGraph()));
  reorderedKeys.children[0].children[0].children[4].configuration = { renderer: 'spectrum-deck', palette: 'neutral' };
  assert.equal(contract.normalizeGraph(reorderedKeys, validationOptions).signature, normalized.signature, 'object key order must not change graph identity');

  const duplicate = baseGraph();
  duplicate.children[0].children[0].children[1].id = 'library-module';
  const duplicateResult = contract.normalizeGraph(duplicate, validationOptions);
  assert.equal(duplicateResult.valid, false);
  assert.ok(duplicateResult.errors.some((entry) => entry.code === 'NODE_ID_DUPLICATE'));

  const unknownNodeKey = baseGraph();
  unknownNodeKey.children[0].privateSelector = '#player';
  assert.ok(contract.normalizeGraph(unknownNodeKey, validationOptions).errors.some((entry) => entry.code === 'NODE_KEY_UNKNOWN'));

  const unknownModule = baseGraph();
  unknownModule.children[0].children[0].children[4].moduleKey = 'unknown.widget';
  assert.ok(contract.normalizeGraph(unknownModule, validationOptions).errors.some((entry) => entry.code === 'MODULE_UNKNOWN'));

  const unsupportedShape = baseGraph();
  unsupportedShape.children[0].children[0].children[0].shape = 'stage';
  assert.ok(contract.normalizeGraph(unsupportedShape, validationOptions).errors.some((entry) => entry.code === 'MODULE_SHAPE_UNSUPPORTED'));

  const executableConfiguration = baseGraph();
  executableConfiguration.children[0].children[0].children[4].configuration = { callback() {} };
  assert.ok(contract.normalizeGraph(executableConfiguration, validationOptions).errors.some((entry) => entry.code === 'CONFIGURATION_VALUE_INVALID'));

  const hostileConfiguration = baseGraph();
  hostileConfiguration.children[0].children[0].children[4].configuration = JSON.parse('{"safe":true,"__proto__":{"polluted":true}}');
  const hostileResult = contract.normalizeGraph(hostileConfiguration, validationOptions);
  assert.equal(hostileResult.valid, false);
  assert.ok(hostileResult.errors.some((entry) => entry.code === 'CONFIGURATION_KEY_FORBIDDEN'));
  assert.equal({}.polluted, undefined);

  const sparseConfiguration = baseGraph();
  sparseConfiguration.children[0].children[0].children[4].configuration = { values: Array(2) };
  assert.ok(contract.normalizeGraph(sparseConfiguration, validationOptions).errors.some((entry) => entry.code === 'CONFIGURATION_VALUE_INVALID'));

  const missingJob = baseGraph();
  missingJob.children[0].children[0].children = missingJob.children[0].children[0].children.filter((node) => node.id !== 'tracks-module');
  assert.ok(contract.normalizeGraph(missingJob, validationOptions).errors.some((entry) => entry.code === 'REQUIRED_JOB_MISSING'));

  const shellSatisfied = contract.normalizeGraph(missingJob, { moduleCatalog, requiredJobs, shellJobs: ['track-browsing'] });
  assert.equal(shellSatisfied.valid, true);

  const invalidCandidate = baseGraph();
  invalidCandidate.schemaVersion = 99;
  const fallback = contract.resolveGraph(invalidCandidate, baseGraph(), validationOptions);
  assert.equal(fallback.usedFallback, true);
  assert.ok(fallback.errors.some((entry) => entry.code === 'SCHEMA_VERSION_UNSUPPORTED'));

  const tooManyChildren = baseGraph();
  tooManyChildren.children[0].children[0].children = Array.from({ length: contract.MAX_CONTAINER_CHILDREN + 1 }, (_, index) => moduleNode(`visualizer-${index}`, 'audio.visualizer', 'tile'));
  assert.ok(contract.normalizeGraph(tooManyChildren, { moduleCatalog }).errors.some((entry) => entry.code === 'NODE_CHILD_LIMIT_EXCEEDED'));

  const tooManyNodes = {
    type: 'root', id: 'large-root', schemaVersion: 1, children: [{
      type: 'grid', id: 'large-grid', columns: 12, rowPolicy: 'flow',
      children: Array.from({ length: contract.MAX_CONTAINER_CHILDREN }, (_, index) => ({
        type: 'grid', id: `nested-grid-${index}`, columns: 1, rowPolicy: 'flow',
        children: [moduleNode(`nested-module-${index}`, 'audio.visualizer', 'tile')],
      })),
    }],
  };
  assert.ok(contract.normalizeGraph(tooManyNodes, { moduleCatalog }).errors.some((entry) => entry.code === 'GRAPH_NODE_LIMIT_EXCEEDED'));
}

function runOperationChecks() {
  const source = contract.assertGraph(baseGraph(), validationOptions);
  const sourceSignature = contract.stableStringify(source);

  const insert = operations.applyOperation(source, {
    type: 'insertModule',
    containerId: 'primary-grid',
    index: 2,
    node: moduleNode('visualizer-two', 'audio.visualizer', 'tile', { renderer: 'paper-seismograph' }),
  }, validationOptions);
  assert.equal(insert.ok, true, insert.error?.message);
  assert.equal(childIds(insert.graph, 'primary-grid')[2], 'visualizer-two');
  assert.equal(find(source, 'visualizer-two'), null, 'operations must not mutate their source graph');
  const undoInsert = operations.applyOperation(insert.graph, insert.receipt.inverse, validationOptions);
  assert.equal(undoInsert.ok, true);
  assert.equal(contract.stableStringify(undoInsert.graph), sourceSignature);

  const removeRequired = operations.applyOperation(source, { type: 'removeOptionalModule', sourceId: 'tracks-module' }, validationOptions);
  expectFailure(removeRequired, 'OPERATION_RESULT_INVALID');
  assert.ok(removeRequired.error.errors.some((entry) => entry.code === 'REQUIRED_JOB_MISSING'));

  const removeOptional = operations.applyOperation(source, { type: 'removeOptionalModule', sourceId: 'visualizer-module' }, validationOptions);
  assert.equal(removeOptional.ok, true);
  assert.equal(find(removeOptional.graph, 'visualizer-module'), null);

  const move = operations.applyOperation(source, { type: 'moveBefore', sourceId: 'info-module', targetId: 'library-module' }, validationOptions);
  assert.equal(move.ok, true);
  assert.deepEqual(childIds(move.graph, 'primary-grid').slice(0, 2), ['info-module', 'library-module']);
  assert.equal(find(move.graph, 'transport-dock')?.type, 'dock', 'Unrelated moves must preserve semantic dock wrappers.');

  const split = operations.applyOperation(source, {
    type: 'splitWith',
    targetId: 'tracks-module',
    splitId: 'artwork-track-split',
    axis: 'horizontal',
    position: 'before',
    weights: [1, 2],
    node: moduleNode('artwork-module', 'artwork.stage', 'stage'),
  }, validationOptions);
  assert.equal(split.ok, true, split.error?.message);
  assert.deepEqual(childIds(split.graph, 'artwork-track-split'), ['artwork-module', 'tracks-module']);
  assert.deepEqual(find(split.graph, 'artwork-track-split').placement, { columnSpan: 6, rowSpan: 2 });
  const recombineSplit = operations.applyOperation(split.graph, { type: 'moveBefore', sourceId: 'artwork-module', targetId: 'tracks-module' }, validationOptions);
  assert.equal(recombineSplit.ok, true, recombineSplit.error?.message);
  assert.equal(find(recombineSplit.graph, 'artwork-track-split'), null, 'Moving one split sibling beside the other must compact the split wrapper.');
  assert.deepEqual(childIds(recombineSplit.graph, 'primary-grid').slice(1, 3), ['artwork-module', 'tracks-module']);

  const stack = operations.applyOperation(source, {
    type: 'stackWith',
    sourceId: 'visualizer-module',
    targetId: 'queue-module',
    stackId: 'queue-visualizer-stack',
    position: 'after',
    activeChildId: 'visualizer-module',
  }, validationOptions);
  assert.equal(stack.ok, true, stack.error?.message);
  assert.deepEqual(childIds(stack.graph, 'queue-visualizer-stack'), ['queue-module', 'visualizer-module']);
  assert.equal(find(stack.graph, 'queue-visualizer-stack').activeChildId, 'visualizer-module');
  const recombineStack = operations.applyOperation(stack.graph, { type: 'moveAfter', sourceId: 'visualizer-module', targetId: 'queue-module' }, validationOptions);
  assert.equal(recombineStack.ok, true, recombineStack.error?.message);
  assert.equal(find(recombineStack.graph, 'queue-visualizer-stack'), null, 'Moving one stack sibling beside the other must compact the stack wrapper.');

  const activate = operations.applyOperation(stack.graph, {
    type: 'setActiveStackChild',
    stackId: 'queue-visualizer-stack',
    childId: 'queue-module',
  }, validationOptions);
  assert.equal(activate.ok, true);
  assert.equal(find(activate.graph, 'queue-visualizer-stack').activeChildId, 'queue-module');

  const unstack = operations.applyOperation(stack.graph, {
    type: 'unstack',
    stackId: 'queue-visualizer-stack',
    childId: 'visualizer-module',
    containerId: 'primary-grid',
    index: 0,
  }, validationOptions);
  assert.equal(unstack.ok, true, unstack.error?.message);
  assert.equal(childIds(unstack.graph, 'primary-grid')[0], 'visualizer-module');
  assert.equal(find(unstack.graph, 'queue-visualizer-stack'), null, 'single-child stack should compact to its remaining child');

  const resize = operations.applyOperation(source, { type: 'resizeSplit', splitId: 'workspace-shell', weights: [3, 1] }, validationOptions);
  assert.equal(resize.ok, true);
  assert.deepEqual(find(resize.graph, 'workspace-shell').weights, [0.75, 0.25]);

  const place = operations.applyOperation(source, { type: 'setNodePlacement', nodeId: 'queue-module', placement: { columnStart: 7, rowStart: 3, columnSpan: 5, rowSpan: 2 } }, validationOptions);
  assert.equal(place.ok, true, place.error?.message);
  assert.deepEqual(find(place.graph, 'queue-module').placement, { columnStart: 7, rowStart: 3, columnSpan: 5, rowSpan: 2 });
  const clearPlace = operations.applyOperation(place.graph, { type: 'setNodePlacement', nodeId: 'queue-module', placement: null }, validationOptions);
  assert.equal(clearPlace.ok, true, clearPlace.error?.message);
  assert.equal(find(clearPlace.graph, 'queue-module').placement, undefined);
  expectFailure(operations.applyOperation(source, { type: 'setNodePlacement', nodeId: 'transport-module', placement: { columnSpan: 2, rowSpan: 1 } }, validationOptions), 'PLACEMENT_PARENT_NOT_GRID');
  expectFailure(operations.applyOperation(source, { type: 'setNodePlacement', nodeId: 'queue-module', placement: { columnSpan: 99, rowSpan: 1 } }, validationOptions), 'PLACEMENT_COLUMN_SPAN_INVALID');
  expectFailure(operations.applyOperation(source, { type: 'setNodePlacement', nodeId: 'queue-module', placement: { columnStart: 0, rowStart: 1, columnSpan: 2, rowSpan: 1 } }, validationOptions), 'PLACEMENT_COLUMN_START_INVALID');
  expectFailure(operations.applyOperation(source, { type: 'setNodePlacement', nodeId: 'queue-module', placement: { columnStart: 1, rowStart: 97, columnSpan: 2, rowSpan: 1 } }, validationOptions), 'PLACEMENT_ROW_START_INVALID');

  const shape = operations.applyOperation(source, { type: 'setModuleShape', moduleId: 'visualizer-module', shape: 'stage' }, validationOptions);
  assert.equal(shape.ok, true);
  assert.equal(find(shape.graph, 'visualizer-module').shape, 'stage');

  const unsupported = operations.applyOperation(source, { type: 'setModuleShape', moduleId: 'library-module', shape: 'stage' }, validationOptions);
  expectFailure(unsupported, 'OPERATION_RESULT_INVALID');

  const configure = operations.applyOperation(source, {
    type: 'setModuleConfiguration',
    moduleId: 'visualizer-module',
    configuration: { renderer: 'spectral-loom', nested: { density: 3 } },
  }, validationOptions);
  assert.equal(configure.ok, true);
  assert.equal(contract.stableStringify(find(configure.graph, 'visualizer-module').configuration), contract.stableStringify({ nested: { density: 3 }, renderer: 'spectral-loom' }));

  const replace = operations.applyOperation(source, { type: 'replaceModule', moduleId: 'visualizer-module', moduleKey: 'artwork.stage', shape: 'stage' }, validationOptions);
  assert.equal(replace.ok, true, replace.error?.message);
  assert.equal(find(replace.graph, 'visualizer-module').moduleKey, 'artwork.stage');
  assert.equal(find(replace.graph, 'visualizer-module').shape, 'stage');
  assert.equal(contract.stableStringify(find(replace.graph, 'visualizer-module').configuration), '{}');
  expectFailure(operations.applyOperation(source, { type: 'replaceModule', moduleId: 'visualizer-module', moduleKey: 'unknown.module' }, validationOptions), 'MODULE_REPLACEMENT_UNKNOWN');
  expectFailure(operations.applyOperation(source, { type: 'replaceModule', moduleId: 'tracks-module', moduleKey: 'artwork.stage' }, validationOptions), 'OPERATION_RESULT_INVALID');

  const ambient = operations.applyOperation(source, {
    type: 'assignAmbient',
    sourceId: 'visualizer-module',
    overlayId: 'visualizer-overlay',
    anchor: 'fill',
    boundsPolicy: 'safe-area',
  }, validationOptions);
  assert.equal(ambient.ok, true, ambient.error?.message);
  assert.equal(find(ambient.graph, 'visualizer-module').shape, 'ambient');
  assert.equal(find(ambient.graph, 'visualizer-overlay').children[0].id, 'visualizer-module');

  const resetModule = operations.applyOperation(configure.graph, { type: 'resetModule', moduleId: 'visualizer-module' }, validationOptions);
  assert.equal(resetModule.ok, true);
  assert.equal(find(resetModule.graph, 'visualizer-module').shape, 'tile');
  assert.equal(contract.stableStringify(find(resetModule.graph, 'visualizer-module').configuration), contract.stableStringify({ palette: 'neutral', renderer: 'spectrum-deck' }));

  const alternate = operations.applyOperation(source, { type: 'removeOptionalModule', sourceId: 'visualizer-module' }, validationOptions).graph;
  const applyPreset = operations.applyOperation(source, { type: 'applyPreset', graph: alternate }, validationOptions);
  assert.equal(applyPreset.ok, true);
  assert.equal(find(applyPreset.graph, 'visualizer-module'), null);

  const resetComposition = operations.applyOperation(alternate, { type: 'resetComposition' }, { ...validationOptions, creatorDefaultGraph: source });
  assert.equal(resetComposition.ok, true);
  assert.equal(contract.stableStringify(resetComposition.graph), sourceSignature);

  const sameShape = operations.applyOperation(source, { type: 'setModuleShape', moduleId: 'visualizer-module', shape: 'tile' }, validationOptions);
  expectFailure(sameShape, 'OPERATION_NO_CHANGE');

  const batch = operations.applyOperations(source, [
    { type: 'setModuleShape', moduleId: 'visualizer-module', shape: 'stage' },
    { type: 'setModuleConfiguration', moduleId: 'visualizer-module', configuration: { renderer: 'spectral-loom' } },
  ], validationOptions);
  assert.equal(batch.ok, true);
  assert.equal(batch.receipts.length, 2);

  const failedBatch = operations.applyOperations(source, [
    { type: 'setModuleShape', moduleId: 'visualizer-module', shape: 'stage' },
    { type: 'removeOptionalModule', sourceId: 'tracks-module' },
  ], validationOptions);
  expectFailure(failedBatch, 'OPERATION_BATCH_FAILED');
  assert.equal(contract.stableStringify(source), sourceSignature, 'failed batches must leave the source graph untouched');
}

function moduleDescriptor(overrides = {}) {
  return {
    contractVersion: 1,
    key: 'module.transport',
    version: '1.0.0',
    family: 'family.transport',
    productJobs: ['playback-transport'],
    reads: ['playback.snapshot'],
    commands: ['playback.toggle'],
    shapes: {
      strip: {
        minInline: 240,
        minBlock: 48,
        maxInline: 1600,
        maxBlock: 240,
        targetInline: 720,
        targetBlock: 72,
        resizeAxes: ['inline'],
        scrollPolicy: 'none',
      },
      mini: {
        minInline: 160,
        minBlock: 40,
        maxInline: 600,
        maxBlock: 160,
        targetInline: 320,
        targetBlock: 56,
        resizeAxes: ['inline'],
        scrollPolicy: 'none',
      },
    },
    defaultShape: 'strip',
    instancePolicy: 'single',
    performance: { cost: 'low', scheduler: 'none', pausesWhenHidden: true, conserveFps: 0 },
    motionOff: 'unchanged',
    accessibility: { name: 'Playback transport', focusPolicy: 'roving', status: 'polite', nonDragActions: true },
    miniRelationship: 'shared-configuration',
    configurationSchemaVersion: 1,
    defaultConfiguration: { density: 'comfortable' },
    fallbackKey: 'fallback.transport',
    fallbackDescription: 'Use product-owned transport controls.',
    isFallback: false,
    create: () => lifecycleFixture([]),
    ...overrides,
  };
}

function fallbackDescriptor(overrides = {}) {
  const base = moduleDescriptor();
  return {
    ...base,
    key: 'fallback.transport',
    instancePolicy: 'multiple',
    reads: [],
    commands: [],
    fallbackKey: '',
    fallbackDescription: 'Stable product-owned transport fallback.',
    isFallback: true,
    ...overrides,
  };
}

function lifecycleFixture(events, getSerialized = () => ({ density: 'comfortable' })) {
  return {
    mount(value) { events.push(['mount', value]); },
    update(value) { events.push(['update', value]); },
    setLayout(value) { events.push(['layout', value]); },
    setVisibility(value) { events.push(['visibility', value]); },
    focus(value) { events.push(['focus', value]); return true; },
    serializeConfiguration() { events.push(['serialize']); return getSerialized(); },
    destroy() { events.push(['destroy']); },
  };
}

function expectThrowCode(action, code) {
  assert.throws(action, (error) => error?.code === code, `Expected thrown error ${code}.`);
}

function runModuleContractChecks() {
  const valid = moduleContract.normalizeDescriptor(moduleDescriptor());
  assert.equal(valid.valid, true, valid.errors.map((entry) => entry.message).join('\n'));
  assert.equal(Object.isFrozen(valid.descriptor), true);
  assert.equal(Object.isFrozen(valid.descriptor.shapes.strip), true);
  assert.equal(valid.descriptor.performance.pausesWhenHidden, true);
  assert.equal(valid.descriptor.accessibility.nonDragActions, true);

  const unknownField = moduleContract.validateDescriptor(moduleDescriptor({ rawHtml: '<button>unsafe</button>' }));
  assert.equal(unknownField.valid, false);
  assert.ok(unknownField.errors.some((entry) => entry.code === 'MODULE_DESCRIPTOR_FIELD_UNKNOWN'));

  const noAlternative = moduleContract.validateDescriptor(moduleDescriptor({ accessibility: { name: 'Transport', focusPolicy: 'entry', status: 'none', nonDragActions: false } }));
  assert.equal(noAlternative.valid, false);
  assert.ok(noAlternative.errors.some((entry) => entry.code === 'MODULE_NON_DRAG_ACTIONS_REQUIRED'));

  const invalidLifecycle = moduleContract.validateLifecycle({ mount() {} });
  assert.equal(invalidLifecycle.valid, false);
  assert.ok(invalidLifecycle.errors.some((entry) => entry.path === 'lifecycle.destroy'));

  const layout = moduleContract.normalizeLayoutContext({ shape: 'strip', inlineSize: 800, blockSize: 80, pixelRatio: 2, direction: 'rtl', mode: 'workspace', motionAllowed: false, conserve: true }, valid.descriptor);
  assert.equal(layout.valid, true);
  assert.equal(layout.layout.conserve, true);
  assert.equal(moduleContract.normalizeLayoutContext({ shape: 'stage' }, valid.descriptor).valid, false);
  assert.equal(moduleContract.normalizeVisibilityState({ visible: false, reason: 'stack-inactive' }).valid, true);
  assert.equal(moduleContract.normalizeVisibilityState({ visible: true, reason: 'occluded' }).valid, false);
}

function runModuleRegistryChecks() {
  const events = [];
  let capturedContext = null;
  let subscriptionListener = null;
  const commands = [];
  const host = {
    read(key) { return { key, nested: { playing: true } }; },
    subscribe(_key, listener) { subscriptionListener = listener; return () => events.push(['unsubscribe']); },
    command(key, payload) { commands.push([key, payload]); return 'accepted'; },
    announce(message) { events.push(['announce', message]); },
    secret: 'must-not-be-exposed',
  };
  const registry = moduleRegistry.createRegistry();
  registry.register(fallbackDescriptor({ create: () => lifecycleFixture(events) }), { origin: 'product' });
  registry.register(moduleDescriptor({
    create(context) {
      capturedContext = context;
      return lifecycleFixture(events, () => ({ density: 'compact', nested: { value: 2 } }));
    },
  }), { origin: 'trusted-runtime' });
  const catalog = registry.seal();
  assert.equal(registry.isSealed(), true);
  assert.equal(Object.isFrozen(catalog), true);
  assert.deepEqual(catalog['module.transport'].shapes, ['mini', 'strip']);
  const catalogGraph = contract.validateGraph({
    type: 'root',
    id: 'catalog-root',
    schemaVersion: 1,
    children: [moduleNode('catalog-transport', 'module.transport', 'strip')],
  }, { moduleCatalog: catalog, requiredJobs: ['playback-transport'] });
  assert.equal(catalogGraph.valid, true, catalogGraph.errors.map((entry) => entry.message).join('\n'));
  expectThrowCode(() => registry.register(moduleDescriptor({ key: 'module.late' })), 'MODULE_REGISTRY_SEALED');

  const instance = registry.createInstance({
    moduleKey: 'module.transport',
    instanceId: 'transport-main',
    configuration: { density: 'comfortable' },
    layout: { shape: 'strip', inlineSize: 720, blockSize: 72 },
    visibility: true,
  }, host);
  assert.equal(instance.usedFallback, false);
  assert.equal(capturedContext.instanceId, 'transport-main');
  assert.deepEqual(Object.keys(capturedContext).sort(), ['announce', 'command', 'family', 'instanceId', 'moduleKey', 'read', 'subscribe']);
  assert.equal(capturedContext.host, undefined);
  assert.equal(capturedContext.secret, undefined);
  assert.equal(Object.isFrozen(capturedContext), true);

  const snapshot = capturedContext.read('playback.snapshot');
  assert.equal(snapshot.nested.playing, true);
  assert.equal(Object.isFrozen(snapshot.nested), true);
  expectThrowCode(() => capturedContext.read('library.snapshot'), 'MODULE_READ_UNDECLARED');
  expectThrowCode(() => capturedContext.command('library.delete', {}), 'MODULE_COMMAND_UNDECLARED');
  expectThrowCode(() => capturedContext.command('playback.toggle', { bad: () => true }), 'MODULE_COMMAND_PAYLOAD_INVALID');
  assert.equal(capturedContext.command('playback.toggle', { source: 'workspace' }), 'accepted');
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'playback.toggle');
  assert.equal(commands[0][1].source, 'workspace');
  assert.equal(Object.getPrototypeOf(commands[0][1]), null);

  let subscribedSnapshot = null;
  const unsubscribe = capturedContext.subscribe('playback.snapshot', (next) => { subscribedSnapshot = next; });
  subscriptionListener({ nested: { playing: false } });
  assert.equal(subscribedSnapshot.nested.playing, false);
  assert.equal(Object.isFrozen(subscribedSnapshot.nested), true);
  unsubscribe();

  instance.mount({ kind: 'test-surface' });
  expectThrowCode(() => instance.mount({ kind: 'second-surface' }), 'MODULE_ALREADY_MOUNTED');
  instance.update({ density: 'compact' }, 'user');
  instance.setLayout({ shape: 'mini', inlineSize: 320, blockSize: 56, motionAllowed: false, conserve: true });
  instance.setVisibility({ visible: false, reason: 'stack-inactive' });
  assert.equal(instance.focus({ reason: 'keyboard', target: 'play' }), true);
  assert.equal(contract.stableStringify(instance.serializeConfiguration()), contract.stableStringify({ density: 'compact', nested: { value: 2 } }));
  assert.equal(instance.snapshot().layout.shape, 'mini');
  expectThrowCode(() => registry.createInstance({ moduleKey: 'module.transport', instanceId: 'transport-second' }, host), 'MODULE_INSTANCE_POLICY_VIOLATED');
  assert.equal(instance.destroy(), true);
  assert.equal(instance.destroy(), false);
  expectThrowCode(() => instance.focus(), 'MODULE_INSTANCE_DESTROYED');
  assert.deepEqual(events.map((entry) => entry[0]), ['unsubscribe', 'mount', 'update', 'layout', 'visibility', 'focus', 'serialize', 'destroy']);

  const cleanupStart = events.length;
  expectThrowCode(() => registry.createInstance({ moduleKey: 'module.transport', instanceId: 'transport-invalid-layout', layout: { shape: 'stage' } }, host), 'MODULE_LAYOUT_INVALID');
  assert.deepEqual(events.slice(cleanupStart), [], 'invalid initial host context must be rejected before factory execution');
  const afterCleanup = registry.createInstance({ moduleKey: 'module.transport', instanceId: 'transport-after-cleanup' }, host);
  afterCleanup.destroy();

  const fallbackEvents = [];
  const fallbackRegistry = moduleRegistry.createRegistry();
  fallbackRegistry.register(fallbackDescriptor({ create: () => lifecycleFixture(fallbackEvents) }));
  fallbackRegistry.register(moduleDescriptor({ key: 'module.failing', create() { throw new Error('deliberate primary failure'); } }));
  fallbackRegistry.seal();
  const fallback = fallbackRegistry.createInstance({ moduleKey: 'module.failing', instanceId: 'failing-main' }, host);
  assert.equal(fallback.usedFallback, true);
  assert.equal(fallback.moduleKey, 'fallback.transport');
  assert.equal(fallback.primaryFailure.code, 'MODULE_FACTORY_FAILED');
  fallback.destroy();

  const unsafeFallbackRegistry = moduleRegistry.createRegistry();
  expectThrowCode(() => unsafeFallbackRegistry.register(fallbackDescriptor(), { origin: 'trusted-runtime' }), 'MODULE_FALLBACK_NOT_PRODUCT_OWNED');

  const mismatchRegistry = moduleRegistry.createRegistry();
  mismatchRegistry.register(fallbackDescriptor({ shapes: { strip: moduleDescriptor().shapes.strip } }));
  mismatchRegistry.register(moduleDescriptor());
  expectThrowCode(() => mismatchRegistry.seal(), 'MODULE_FALLBACK_SHAPE_MISMATCH');
}

function neutralLifecycle(events = []) {
  return {
    mount(value) { events.push(['mount', value]); },
    update(value) { events.push(['update', value]); },
    setLayout(value) { events.push(['layout', value]); },
    setVisibility(value) { events.push(['visibility', value]); },
    focus(value) { events.push(['focus', value]); return true; },
    serializeConfiguration() { return {}; },
    destroy() { events.push(['destroy']); },
  };
}

function runCompositionSessionChecks() {
  const session = compositionSession.createSession(baseGraph(), { validationOptions, creatorDefaultGraph: baseGraph() });
  assert.equal(session.snapshot().mode, 'use');
  assert.equal(session.snapshot().dirty, false);
  assert.equal(session.apply({ type: 'moveBefore', sourceId: 'queue-module', targetId: 'library-module' }).error.code, 'COMPOSITION_MODE_INACTIVE');
  assert.equal(session.enter().ok, true);
  assert.equal(session.snapshot().mode, 'edit');
  assert.equal(session.apply({ type: 'moveBefore', sourceId: 'queue-module', targetId: 'library-module' }).ok, true);
  assert.equal(session.snapshot().dirty, true);
  assert.equal(find(session.snapshot().graph, 'transport-dock')?.type, 'dock');
  assert.equal(find(session.snapshot().graph, 'visualizer-overlay'), null, 'The generic baseGraph fixture does not use an overlay.');
  assert.equal(session.snapshot().canUndo, true);
  assert.equal(session.exit().error.code, 'COMPOSITION_UNSAVED_CHANGES');
  assert.equal(session.undo().ok, true);
  assert.equal(session.snapshot().dirty, false);
  assert.equal(session.snapshot().canRedo, true);
  assert.equal(session.redo().ok, true);
  assert.equal(session.save().ok, true);
  assert.equal(session.snapshot().mode, 'use');
  assert.equal(session.snapshot().dirty, false);

  assert.equal(session.enter().ok, true);
  const requiredHide = session.apply({ type: 'removeOptionalModule', sourceId: 'tracks-module' });
  assert.equal(requiredHide.ok, false);
  assert.equal(requiredHide.error.code, 'OPERATION_RESULT_INVALID');
  assert.equal(session.apply({ type: 'removeOptionalModule', sourceId: 'visualizer-module' }).ok, true);
  assert.equal(session.saveAs('Signal Free').ok, true);
  assert.deepEqual(session.snapshot().savedLayouts, ['Signal Free']);

  assert.equal(session.enter().ok, true);
  assert.equal(session.restoreCreator().ok, true);
  assert.ok(find(session.snapshot().graph, 'visualizer-module'));
  assert.equal(session.applySaved('Signal Free').ok, true);
  assert.equal(find(session.snapshot().graph, 'visualizer-module'), null);
  assert.equal(session.cancel().ok, true);
  assert.equal(session.snapshot().mode, 'use');
  assert.equal(find(session.snapshot().graph, 'visualizer-module'), null, 'Cancel returns to the graph committed at transaction entry.');

  assert.equal(session.enter().ok, true);
  assert.equal(session.saveAs(' bad/name ').error.code, 'COMPOSITION_LAYOUT_NAME_INVALID');
  assert.equal(session.exit().ok, true, 'A clean transaction may exit without Save or Cancel.');
  assert.equal(session.undo().error.code, 'COMPOSITION_MODE_INACTIVE');
  assert.equal(session.normalizeLayoutName('  My   Layout  '), 'My Layout');
  assert.equal(session.normalizeLayoutName('/invalid'), '');
}

function runInteractionAdapterChecks() {
  const graph = contract.normalizeGraph(baseGraph(), validationOptions).graph;
  assert.equal(interactionAdapter.SELECTED_ADAPTER, interactionAdapter.ADAPTERS.C);
  assert.deepEqual(interactionAdapter.evaluateAdapters().candidates.map((entry) => entry.id), ['reorder-only', 'spatial-zones', 'hybrid-ranked']);
  assert.equal(interactionAdapter.evaluateAdapters().selected, 'hybrid-ranked');
  assert.deepEqual(interactionAdapter.compatibleTargets(graph, 'queue-module'), ['library-module', 'tracks-module', 'info-module', 'visualizer-module', 'transport-module', 'now-playing-module']);
  assert.deepEqual(interactionAdapter.compatibleTargets(graph, 'transport-module'), ['library-module', 'tracks-module', 'queue-module', 'info-module', 'visualizer-module', 'now-playing-module'], 'Nested modules may now be moved out of a fixed owner through the same canonical operation boundary.');

  const geometry = { sourceId: 'queue-module', targetId: 'tracks-module', targetRect: { left: 0, top: 0, width: 400, height: 200 } };
  const left = interactionAdapter.rankLegalDropIntents(graph, { ...geometry, point: { x: 10, y: 100 } });
  const center = interactionAdapter.rankLegalDropIntents(graph, { ...geometry, point: { x: 200, y: 100 } });
  const reorder = interactionAdapter.rankLegalDropIntents(graph, { ...geometry, point: { x: 100, y: 100 } });
  assert.equal(left[0].kind, 'split-before-horizontal');
  assert.equal(center[0].kind, 'stack');
  assert.equal(reorder[0].kind, 'move-before');
  assert.equal(interactionAdapter.rankLegalDropIntents(graph, { ...geometry, targetId: 'missing-module', point: { x: 200, y: 100 } }).length, 0);

  const canonicalIntent = center[0];
  const operationsByRoute = interactionAdapter.ROUTES.map((route) => interactionAdapter.operationForIntent(canonicalIntent, { route, serial: 7 }));
  operationsByRoute.slice(1).forEach((operation) => assert.deepEqual(operation, operationsByRoute[0], 'Pointer, click, menu, and keyboard routes must emit the same canonical operation.'));
  const resultsByRoute = operationsByRoute.map((operation) => operations.applyOperation(graph, operation, validationOptions));
  resultsByRoute.forEach((result) => assert.equal(result.ok, true, result.error?.message));
  resultsByRoute.slice(1).forEach((result) => {
    assert.deepEqual(result.graph, resultsByRoute[0].graph, 'Every C6 route must normalize to the same graph.');
    assert.deepEqual(result.receipt, resultsByRoute[0].receipt, 'Every C6 route must produce the same operation receipt.');
  });

  assert.deepEqual(interactionAdapter.resizeWeights([0.5, 0.5], 25, 100), [0.75, 0.25]);
  assert.deepEqual(interactionAdapter.resizeWeights([0.5, 0.5], 500, 100), [0.8, 0.2], 'Resize clamps panes to a usable minimum.');
  assert.equal(interactionAdapter.autoscrollDelta(4, 600) < 0, true);
  assert.equal(interactionAdapter.autoscrollDelta(596, 600) > 0, true);
  assert.equal(interactionAdapter.autoscrollDelta(300, 600), 0);
  assert.equal(interactionAdapter.pointerStartAllowed({ mode: 'edit', primaryButton: true, dedicatedHandle: true, nestedInteractive: false }), true);
  assert.equal(interactionAdapter.pointerStartAllowed({ mode: 'use', primaryButton: true, dedicatedHandle: true, nestedInteractive: false }), false);
  assert.equal(interactionAdapter.pointerStartAllowed({ mode: 'edit', primaryButton: true, dedicatedHandle: false, nestedInteractive: false }), false);
  assert.throws(() => interactionAdapter.operationForIntent(canonicalIntent, { route: 'unknown', serial: 1 }), (error) => error.code === 'DROP_ROUTE_INVALID');
}

function runWorkspacePersistenceChecks() {
  let clock = Date.parse('2026-08-24T12:00:00.000Z');
  const authority = workspacePersistence.createAuthority({ now: () => clock });
  const initial = authority.defaultState();
  assert.equal(initial.schemaVersion, 1);
  assert.equal(initial.workspaceId, 'primary');
  assert.equal(initial.revision, 1);
  assert.equal(contract.normalizeGraph(initial.graph, authority.validationOptions()).signature, contract.normalizeGraph(devLabSpecimens.GRAPH, authority.validationOptions()).signature);
  assert.equal(initial.graphSignature, initial.creatorSignature);
  assert.equal(initial.lastKnownGoodSignature, initial.creatorSignature);

  const moved = operations.applyOperation(initial.graph, { type: 'moveBefore', sourceId: 'queue-module', targetId: 'library-module' }, authority.validationOptions());
  assert.equal(moved.ok, true, moved.error?.message);
  clock += 1000;
  const committed = authority.commit(initial, moved.graph, { expectedRevision: 1, activeThemeId: 'pixelody-studio' });
  assert.equal(committed.ok, true);
  assert.equal(committed.state.revision, 2);
  assert.equal(committed.state.lastKnownGoodSignature, initial.graphSignature);
  assert.notEqual(committed.state.graphSignature, initial.graphSignature);
  assert.equal(authority.commit(committed.state, initial.graph, { expectedRevision: 1 }).status, 'revision-conflict');
  const cancelled = authority.cancel(committed.state, { expectedRevision: 2 });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.wrote, false);
  assert.equal(cancelled.state.revision, 2);

  const migrated = authority.normalizeState({ schemaVersion: 0, graph: moved.graph });
  assert.equal(migrated.status, 'migrated');
  assert.equal(migrated.state.substitutionReceipts.at(-1).type, 'schema-migration');
  const future = authority.normalizeState({ schemaVersion: 99, graph: moved.graph });
  assert.equal(future.status, 'future-schema-recovered');
  assert.equal(future.state.startup.safeMode, true);
  assert.equal(future.state.graphSignature, authority.creatorSignature);

  const corrupted = authority.normalizeState({ ...committed.state, graph: { type: 'root', id: 'broken' }, graphSignature: 'forged' });
  assert.equal(corrupted.state.recovery.recoveredFrom, 'last-known-good');
  assert.equal(corrupted.state.graphSignature, initial.graphSignature);
  assert.equal(corrupted.state.substitutionReceipts.at(-1).type, 'graph-recovery');

  const catalog = { ...workspacePersistence.defaultCatalog() };
  delete catalog['audio.visualizer'];
  const creatorWithFallback = JSON.parse(JSON.stringify(devLabSpecimens.GRAPH));
  contract.walkGraph(creatorWithFallback, (node) => { if (node.moduleKey === 'audio.visualizer') node.moduleKey = 'fallback.audio.visualizer'; });
  const dependencyAuthority = workspacePersistence.createAuthority({ moduleCatalog: catalog, creatorDefaultGraph: creatorWithFallback, moduleSubstitutions: { 'audio.visualizer': 'fallback.audio.visualizer' }, themeIds: ['pixelody-studio'] });
  const substituted = dependencyAuthority.normalizeState({ ...initial, activeThemeId: 'missing-theme' });
  assert.equal(find(substituted.state.graph, 'signal-module').moduleKey, 'fallback.audio.visualizer');
  assert.equal(substituted.state.activeThemeId, 'pixelody-studio');
  assert.deepEqual(substituted.state.substitutionReceipts.slice(-2).map((entry) => entry.type), ['module-substitution', 'theme-substitution']);

  let startup = committed.state;
  startup = authority.startupAction(startup, 'failed', { errorCode: 'PAINT_ONE' });
  startup = authority.startupAction(startup, 'failed', { errorCode: 'PAINT_TWO' });
  startup = authority.startupAction(startup, 'failed', { errorCode: 'PAINT_THREE' });
  assert.equal(startup.startup.safeMode, true);
  assert.equal(startup.graphSignature, authority.creatorSignature);
  assert.equal(startup.substitutionReceipts.at(-1).type, 'startup-safe-mode');
  const healthy = authority.startupAction(startup, 'healthy');
  assert.equal(healthy.startup.consecutiveFailures, 0);
  assert.equal(healthy.startup.safeMode, false);

  let expired = 0;
  let scheduled = null;
  const watchdog = new workspacePersistence.WorkspaceStartupWatchdog({ delayMs: 1200, onExpired: () => { expired += 1; }, setTimer: (callback) => { scheduled = callback; return 1; }, clearTimer: () => { scheduled = null; } });
  watchdog.begin();
  assert.equal(typeof scheduled, 'function');
  scheduled();
  assert.equal(expired, 1);
  watchdog.begin();
  watchdog.healthy();
  assert.equal(scheduled, null);
}

function runC8ProductionFoundationChecks() {
  assert.equal(firstPartyModules.MODULE_SPECS.length, 9, 'C8 must register seven required first-party modules plus optional artwork and route navigation.');
  const expected = ['artwork.stage', 'audio.visualizer', 'library.browser', 'now-playing', 'queue.view', 'track.information', 'tracks.browser', 'transport.controls', 'workspace.route-navigator'];
  assert.deepEqual(firstPartyModules.MODULE_SPECS.map((specimen) => specimen.key).sort(), expected);
  firstPartyModules.MODULE_SPECS.forEach((specimen) => {
    const primary = moduleContract.normalizeDescriptor(firstPartyModules.descriptorFor(specimen, {}, false));
    const fallback = moduleContract.normalizeDescriptor(firstPartyModules.descriptorFor(specimen, {}, true));
    assert.equal(primary.valid, true, `${specimen.key} primary descriptor must satisfy the module contract.`);
    assert.equal(fallback.valid, true, `${specimen.key} fallback descriptor must satisfy the module contract.`);
    assert.deepEqual(fallback.descriptor.productJobs, primary.descriptor.productJobs, `${specimen.key} fallback must preserve product jobs.`);
    assert.deepEqual(Object.keys(fallback.descriptor.shapes), Object.keys(primary.descriptor.shapes), `${specimen.key} fallback must preserve shape families.`);
    assert.ok(['independent', 'embedded-fallback', 'shared-shell-member'].includes(specimen.rootPolicy), `${specimen.key} must declare an explicit product-root policy.`);
  });
  const signalSpec = firstPartyModules.MODULE_SPECS.find((specimen) => specimen.key === 'audio.visualizer');
  assert.equal(signalSpec.instancePolicy, 'multiple');
  assert.equal(signalSpec.maxInstances, 4, 'The production tray needs a bounded multi-instance Signal policy.');
  const registry = firstPartyModules.createRegistry({ document: {} });
  assert.equal(registry.keys().length, 18);
  expected.forEach((key) => {
    assert.ok(registry.catalog()[key], `C8 registry is missing ${key}.`);
    assert.ok(registry.catalog()[`fallback.${key}`], `C8 registry is missing fallback.${key}.`);
  });
  const records = productionHost.moduleRecords(devLabSpecimens.GRAPH);
  assert.equal(records.length, 7);
  assert.deepEqual(productionHost.siblingRecords(devLabSpecimens.GRAPH, 'library-module').map((record) => record.node.id), ['library-module', 'tracks-module', 'queue-module', 'information-module']);

  const productionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace-composition', 'production-host.js'), 'utf8');
  const painterSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace-composition', 'canvas-painter.js'), 'utf8');
  const studioSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace-composition', 'canvas-studio.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const cssSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'dev-lab.css'), 'utf8');
  const foregroundSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'foreground.css'), 'utf8');
  for (const key of expected.filter((candidate) => candidate !== 'workspace.route-navigator')) assert.match(indexSource, new RegExp(`data-cw-product-root="${key.replace('.', '\\.')}`), `Production DOM root is missing for ${key}.`);
  assert.equal(firstPartyModules.SPEC_BY_KEY['workspace.route-navigator'].generated, 'route-navigator', 'The route navigator must remain a product-owned generated module rather than static theme markup.');
  for (const script of ['contract.js', 'operations.js', 'composition-session.js', 'module-contract.js', 'module-registry.js', 'interaction-adapter.js', 'first-party-modules.js', 'module-effects.js', 'production-host.js']) assert.match(indexSource, new RegExp(`workspace-composition/${script.replace('.', '\\.')}`), `Production script chain is missing ${script}.`);
  assert.deepEqual(moduleEffects.fromConfiguration({ effects: { animation: 'float', particles: 'stars', trigger: 'playback', intensity: 'vivid', speed: 'fast' } }), { animation: 'float', particles: 'stars', trigger: 'playback', intensity: 'vivid', speed: 'fast' });
  assert.deepEqual(moduleEffects.fromConfiguration({ effects: { animation: 'url(evil)', particles: '<script>', trigger: 'click', intensity: 99, speed: 'warp' } }), moduleEffects.DEFAULTS, 'Module effects must fail closed to authored presets instead of accepting CSS or script-like values.');
  assert.match(studioSource, /Motion & particles/, 'Canvas Studio must expose module animation and particle controls in the selected-pane editor.');
  assert.match(studioSource, /setModuleConfiguration/, 'Visual behavior edits must dispatch through canonical module configuration operations.');
  assert.match(painterSource, /data(?:set)?\.cwParticles|dataset\.cwParticles/, 'The painter must project persisted particle configuration onto the module shell.');
  assert.match(foregroundSource, /data-cw-particles="pixels"/, 'Foreground must paint at least one bounded particle primitive.');
  assert.match(foregroundSource, /data-performance="conserve"[\s\S]{0,180}cw-module-effects/, 'Performance Conserve must remove decorative module effects.');
  assert.match(rendererSource, /runtimeInfo\.isDevelopment === true && appearance\.theme === 'dev-lab'/, 'C8 host must remain gated to development Dev Lab.');
  assert.match(productionSource, /reportWorkspaceStartup\('begin'/);
  assert.match(productionSource, /reportWorkspaceStartup\('healthy'/);
  assert.match(productionSource, /saveWorkspaceComposition/);
  assert.match(productionSource, /cancelWorkspaceComposition/);
  assert.match(productionSource, /Finish and save/);
  assert.match(productionSource, /if \(!studioEnabled\) installEditChrome\(graph\)/, 'Canvas Studio must not paint the conflicting legacy C8 chrome.');
  assert.match(productionSource, /studio\?\.focusEntry\?\.\(\)/, 'Composition Mode entry must move focus into Canvas Studio.');
  assert.match(productionSource, /autoscrollDelta/, 'The production Canvas bridge must expose the C6 autoscroll adapter.');
  assert.match(studioSource, /setActiveStackChild/, 'Canvas Studio must expose stack-child navigation.');
  assert.match(studioSource, /cw-studio-target-actions/, 'Canvas Studio must expose non-drag arbitrary destination actions.');
  assert.match(studioSource, /cw-studio-drop-preview/, 'Canvas Studio must paint a geometric drop preview.');
  assert.match(studioSource, /elementsFromPoint/, 'Captured pointer dragging must hit-test the live canvas instead of the captured Move button.');
  assert.match(studioSource, /previewGridReflow/, 'Grid dragging must reflow neighbouring panes before release.');
  assert.match(studioSource, /function liftPane/, 'Dragging must lift the module itself into a pointer-following surface.');
  assert.match(studioSource, /cw-drag-placeholder/, 'A lifted module needs a provisional semantic slot that reflows its neighbours.');
  assert.match(studioSource, /lastValidIntent/, 'Transient hit-test gaps must retain the last valid fitted canvas slot.');
  assert.match(studioSource, /dropIntentSatisfied/, 'A released drag must verify that its canonical graph contains the previewed relationship.');
  assert.match(studioSource, /translate3d/, 'The lifted pane must follow the pointer on the compositor instead of triggering left/top layout.');
  assert.match(studioSource, /requestAnimationFrame/, 'Trusted pointer streams must be coalesced to the display cadence.');
  assert.match(studioSource, /previewKey/, 'Unchanged destinations must not rebuild previews or remeasure neighbour reflow.');
  assert.match(studioSource, /cwStudioDragConserve/, 'Slow drag frames need an automatic lightweight visual fallback.');
  assert.match(studioSource, /cwStudioPreviewFallback/, 'Live drag preview needs an observable fail-safe when DOM invariants diverge.');
  assert.match(studioSource, /cw-pane-menu-button/, 'Every editable pane must expose the same canonical action menu without requiring right-click.');
  assert.match(studioSource, /cw-inline-target-menu/, 'Click-to-move destinations must be available on the canvas without requiring the rail.');
  assert.match(studioSource, /addEventListener\('contextmenu', handleCanvasContextMenu, true\)/, 'Right-clicking a Canvas Studio module must open its selection menu.');
  assert.match(studioSource, /removeEventListener\('contextmenu', handleCanvasContextMenu, true\)/, 'Canvas Studio must release its module context-menu listener on teardown.');
  assert.match(studioSource, /setAttribute\('role', 'menu'\)/, 'The module context menu must expose menu semantics.');
  assert.match(studioSource, /cw-module-context-action/, 'The module context menu must expose the canonical pane actions.');
  assert.match(foregroundSource, /\.cw-module-context-menu\s*\{[^}]*position:\s*fixed/s, 'The module context menu must follow the pointer independently of pane clipping.');
  assert.match(studioSource, /cw-studio-tray-search/, 'Canvas Studio must provide a searchable module tray.');
  assert.match(studioSource, /openAddPaneMenu/, 'Available modules must be reachable directly from the canvas as well as the sidebar tray.');
  assert.match(studioSource, /cw-canvas-add-button/, 'Composition Mode must expose a visible on-canvas Add Pane launcher.');
  assert.match(studioSource, /event\.key === 'ContextMenu'.*event\.shiftKey && event\.key === 'F10'/s, 'Focused panes must expose the same menu through the keyboard context-menu routes.');
  assert.match(studioSource, /snapshot\.canUndo.*bridge\.undo\(\)/s, 'Canvas Studio must provide a guarded undo shortcut.');
  assert.match(studioSource, /canDuplicateSelected\(snapshot\.graph\).*duplicateSelected\(\)/s, 'Canvas Studio must provide a capability-checked duplicate shortcut.');
  assert.match(studioSource, /Pane selection cleared\. Press Escape again/, 'Escape must clear a pane selection before attempting to leave Composition Mode.');
  assert.match(studioSource, /cw-preview-block-size/, 'Vertical resizing must expose a continuous painted preview before its grid-span commit.');
  assert.match(studioSource, /TEMPLATE_DEFINITIONS/, 'Canvas Studio must expose named graph templates.');
  assert.match(foregroundSource, /data-cw-studio-enabled="true".*cw-production-edit-chrome/, 'Foreground must suppress legacy edit chrome while Canvas Studio owns Composition Mode.');
  assert.match(mainSource, /--pixelody-dev-user-data=/, 'Manual Canvas QA needs an explicit isolated development user-data route.');
  assert.match(productionSource, /cw-production-drag-handle/);
  assert.match(productionSource, /rankLegalDropIntents/);
  assert.match(productionSource, /painter\.update/);
  assert.match(painterSource, /topologySignature/);
  assert.match(painterSource, /cwPaintMode = 'incremental'/);
  assert.match(painterSource, /role', 'separator'/);
  assert.match(studioSource, /cw-pane-drag-handle/);
  assert.match(studioSource, /cw-pane-resize-handle/);
  assert.match(studioSource, /handlePointerCancel/);
  assert.match(productionSource, /fixed group/);
  assert.doesNotMatch(indexSource, /workspaceProduction(?:Previous|Next|Save)/, 'Ambiguous global move/save controls must not return.');
  assert.ok(productionSource.indexOf('active = true;') < productionSource.indexOf("classList.add('cw-production-host-active')"), 'The visible C8 active marker must not race ahead of host activation.');
  assert.match(cssSource, /data-runtime-mode="development"\]\[data-theme="dev-lab"\]\.cw-production-host-active/);

  const canvasAuthority = workspacePersistence.createAuthority({
    creatorDefaultGraph: canvasStudioPreset.graphForVersion(),
    themeIds: [canvasStudioPreset.THEME_ID],
    defaultThemeId: canvasStudioPreset.THEME_ID,
    requiredJobs: canvasStudioPreset.REQUIRED_JOBS,
    commitRequiredJobs: canvasStudioPreset.COMMIT_REQUIRED_JOBS,
  });
  const openingCanvas = canvasAuthority.defaultState();
  const incompleteDraft = JSON.parse(JSON.stringify(openingCanvas.graph));
  incompleteDraft.children[0].children[0].shape = 'panel';
  const incompleteCommit = canvasAuthority.commit(openingCanvas, incompleteDraft, { expectedRevision: openingCanvas.revision, activeThemeId: canvasStudioPreset.THEME_ID });
  assert.equal(incompleteCommit.ok, false, 'Canvas authority must reject an incomplete durable write even though its opening graph is intentionally incomplete.');
  assert.equal(incompleteCommit.status, 'validation-error');
  const completeCommit = canvasAuthority.commit(openingCanvas, devLabSpecimens.GRAPH, { expectedRevision: openingCanvas.revision, activeThemeId: canvasStudioPreset.THEME_ID });
  assert.equal(completeCommit.ok, true, completeCommit.error);
}

function runComposableThemeExperimentChecks() {
  const v1 = workspacePersistence.createAuthority({
    creatorDefaultGraph: themeExperiment.graphForVersion(1),
    themeIds: ['pixelody-studio', 'dev-lab'],
    defaultThemeId: 'dev-lab',
  });
  const initial = v1.defaultState();
  assert.equal(initial.graphSignature, initial.creatorSignature, 'Experiment first activation must be the authoritative creator default.');
  assert.equal(initial.graph.id, `${themeExperiment.PROFILE_ID}-root`);
  assert.deepEqual(
    productionHost.siblingRecords(initial.graph, 'tracks-module').map((record) => record.node.id),
    ['tracks-module', 'library-module', 'information-module'],
    'Counterspace Relay must expose exactly three compatible Canvas siblings.',
  );
  const remixed = operations.applyOperation(initial.graph, { type: 'moveBefore', sourceId: 'library-module', targetId: 'tracks-module' }, v1.validationOptions());
  assert.equal(remixed.ok, true, remixed.error?.message);
  const committed = v1.commit(initial, remixed.graph, { expectedRevision: initial.revision, activeThemeId: 'dev-lab' });
  assert.equal(committed.ok, true);
  assert.notEqual(committed.state.graphSignature, committed.state.creatorSignature, 'Personal remix must remain distinct from the creator default.');

  const v2 = workspacePersistence.createAuthority({
    creatorDefaultGraph: themeExperiment.graphForVersion(2),
    themeIds: ['pixelody-studio', 'dev-lab'],
    defaultThemeId: 'dev-lab',
  });
  const updated = v2.normalizeState(committed.state).state;
  assert.equal(updated.graphSignature, committed.state.graphSignature, 'A creator-default update must preserve the personal override graph.');
  assert.notEqual(updated.creatorSignature, committed.state.creatorSignature, 'The creator-default update must remain separately observable.');
  assert.deepEqual(
    productionHost.siblingRecords(updated.creatorDefaultGraph, 'tracks-module').map((record) => record.node.id),
    ['tracks-module', 'information-module', 'library-module'],
  );
}

function runDevLabHostChecks() {
  assert.equal(devLabSpecimens.SPECIMENS.length, 7, 'C4 must paint exactly seven neutral specimen modules.');
  assert.deepEqual(devLabSpecimens.TIERS, ['wide', 'intermediate', 'narrow']);
  assert.equal(devLabSpecimens.hashText('same-graph'), devLabSpecimens.hashText('same-graph'));
  assert.notEqual(devLabSpecimens.hashText('same-graph'), devLabSpecimens.hashText('different-graph'));
  assert.deepEqual(devLabHost.WIDTHS, { wide: 1180, intermediate: 820, narrow: 430 });

  let injectedFailure = '';
  const lifecycleEvents = [];
  const registry = devLabSpecimens.createRegistry({
    createLifecycle: () => neutralLifecycle(lifecycleEvents),
    createFallbackLifecycle: () => neutralLifecycle(lifecycleEvents),
  });
  assert.equal(registry.keys().length, 20, 'Seven default modules, three optional replacement modules, and terminal product fallbacks must be registered.');
  const normalized = contract.normalizeGraph(devLabSpecimens.GRAPH, { moduleCatalog: registry.catalog(), requiredJobs: devLabSpecimens.REQUIRED_JOBS });
  assert.equal(normalized.valid, true, normalized.errors.map((entry) => entry.message).join('\n'));
  assert.equal(normalized.nodeCount, 13);
  const wrapperPreservation = operations.applyOperation(normalized.graph, { type: 'moveBefore', sourceId: 'tracks-module', targetId: 'library-module' }, { moduleCatalog: registry.catalog(), requiredJobs: devLabSpecimens.REQUIRED_JOBS });
  assert.equal(wrapperPreservation.ok, true, wrapperPreservation.error?.message);
  assert.equal(find(wrapperPreservation.graph, 'signal-overlay')?.type, 'overlay', 'Unrelated edits must preserve a valid semantic overlay.');
  assert.equal(find(wrapperPreservation.graph, 'playback-dock')?.type, 'dock', 'Unrelated edits must preserve a valid semantic dock.');
  assert.deepEqual(new Set([...contract.NODE_TYPES].filter((type) => type !== 'root' && type !== 'module')), new Set(['split', 'stack', 'grid', 'dock', 'overlay']));
  const paintedTypes = new Set();
  const moduleNodes = [];
  contract.walkGraph(normalized.graph, (node) => {
    paintedTypes.add(node.type);
    if (node.type === 'module') moduleNodes.push(node);
  });
  ['root', 'split', 'stack', 'grid', 'dock', 'overlay', 'module'].forEach((type) => assert.ok(paintedTypes.has(type), `C4 graph must exercise ${type}.`));
  assert.equal(moduleNodes.length, 7);

  const widths = { wide: 1180, intermediate: 820, narrow: 430 };
  Object.entries(widths).forEach(([tier, width]) => {
    const projection = devLabSpecimens.deriveProjection(normalized.graph, width);
    assert.equal(projection.tier, tier);
    const projectionValidation = devLabSpecimens.validateProjection(projection);
    assert.equal(projectionValidation.valid, true, projectionValidation.errors.join('\n'));
    moduleNodes.forEach((node) => {
      const descriptor = registry.get(node.moduleKey);
      assert.ok(descriptor.shapes[projection.shapes[node.id]], `${tier} projection gives ${node.moduleKey} an unsupported ${projection.shapes[node.id]} shape.`);
    });
  });
  assert.equal(devLabSpecimens.deriveProjection(normalized.graph, 1180).splitAxis, 'horizontal');
  assert.equal(devLabSpecimens.deriveProjection(normalized.graph, 820).splitAxis, 'vertical');
  assert.equal(devLabSpecimens.deriveProjection(normalized.graph, 430).columns, 1);
  expectThrowCode(() => devLabSpecimens.tierForWidth(-1), 'LAB_WIDTH_INVALID');

  const host = {
    read(key) {
      if (key === 'lab.failure') return { moduleKey: injectedFailure };
      return {};
    },
    command() { return { accepted: true }; },
    subscribe() { return () => {}; },
  };
  const instances = moduleNodes.map((node) => registry.createInstance({
    moduleKey: node.moduleKey,
    instanceId: node.id,
    configuration: node.configuration,
    layout: { shape: node.shape },
    visibility: true,
  }, host));
  assert.equal(instances.length, 7);
  assert.equal(instances.some((instance) => instance.usedFallback), false);
  instances.forEach((instance) => { instance.mount({ kind: 'deterministic-node-surface' }); instance.destroy(); });

  injectedFailure = 'tracks.browser';
  const failedPrimary = registry.createInstance({ moduleKey: 'tracks.browser', instanceId: 'tracks-failure-proof', layout: { shape: 'stage' } }, host);
  assert.equal(failedPrimary.usedFallback, true);
  assert.equal(failedPrimary.moduleKey, 'fallback.tracks.browser');
  assert.equal(failedPrimary.primaryFailure.code, 'MODULE_FACTORY_FAILED');
  failedPrimary.destroy();

  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'workspace-composition-lab.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'workspace-composition-lab.css'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src', 'workspace-composition', 'dev-lab-host.js'), 'utf8');
  const productionHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /DEVELOPMENT ONLY/);
  assert.match(html, /id="composition-stage"/);
  assert.match(html, /id="cw-constraints"/);
  assert.match(html, /id="cw-failure"/);
  ['contract.js', 'operations.js', 'module-contract.js', 'module-registry.js', 'composition-session.js', 'interaction-adapter.js', 'dev-lab-specimens.js', 'dev-lab-host.js'].forEach((file) => assert.match(html, new RegExp(file.replace('.', '\\.'))));
  ['cw-mode-toggle', 'cw-edit-fieldset', 'cw-edit-target', 'cw-replacement', 'cw-shape', 'cw-undo', 'cw-redo', 'cw-cancel', 'cw-save', 'cw-save-as', 'cw-restore', 'cw-edit-announcement'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`), `C5 command surface requires ${id}.`));
  ['cw-interaction-state', 'cw-resize-fieldset', 'cw-resize-split', 'cw-resize-ratio', 'cw-resize-apply', 'cw-resize-equal'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`), `C6 interaction surface requires ${id}.`));
  assert.match(css, /body\[data-tier="intermediate"\]/);
  assert.match(css, /body\[data-tier="narrow"\]/);
  assert.match(css, /body\[data-motion="off"\]/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /:focus-visible/);
  ['split', 'stack', 'grid', 'dock', 'overlay'].forEach((type) => assert.match(source, new RegExp(`node\\.type === '${type}'`), `Paint host must render ${type} nodes.`));
  assert.match(source, /createFallbackLifecycle/);
  assert.match(source, /instance\.destroy\(\)/);
  assert.match(source, /normalizeGraph\(specimens\.GRAPH/);
  assert.match(source, /compositionSession\.createSession/);
  assert.match(source, /data-edit-command/);
  assert.match(source, /cw-drag-handle/);
  assert.match(source, /cw-resize-handle/);
  assert.match(source, /rankLegalDropIntents/);
  assert.match(source, /autoscrollDelta/);
  assert.match(source, /state\.session\.apply\(operation\)/);
  assert.match(css, /data-drop-intent/);
  assert.match(css, /data-pointer-phase="picked"/);
  assert.match(source, /event\.altKey/);
  assert.match(source, /state\.session\.undo\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|window\.pixelody|electronAPI|ipcRenderer|AudioContext|fetch\(/, 'C4 host must stay isolated from persistence, Electron, audio ownership, and network access.');
  assert.doesNotMatch(productionHtml, /workspace-composition-lab|dev-lab-host\.js|dev-lab-specimens\.js/, 'The production renderer must not load the C4 host.');
}

function run() {
  runContractChecks();
  runOperationChecks();
  runModuleContractChecks();
  runModuleRegistryChecks();
  runCompositionSessionChecks();
  runInteractionAdapterChecks();
  runWorkspacePersistenceChecks();
  runC8ProductionFoundationChecks();
  runComposableThemeExperimentChecks();
  runDevLabHostChecks();
  console.log('Composable workspace audit passed: graph authority, operations, capability isolation, lifecycle/fallback, transactional sessions, C6 route parity, C7 persistence/recovery, C8 first-party production adapters, ranked intents, and responsive host projections are deterministic.');
}

run();
