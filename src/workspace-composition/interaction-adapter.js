(function pixelodyWorkspaceInteractionAdapterFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports ? require('./contract') : root.PixelodyWorkspaceCompositionContract;
  const api = factory(composition);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceInteractionAdapter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceInteractionAdapterApi(composition) {
  'use strict';

  if (!composition) throw new Error('Workspace interaction adapter requires the composition contract.');

  const ADAPTERS = Object.freeze({ A: 'reorder-only', B: 'spatial-zones', C: 'hybrid-ranked' });
  const SELECTED_ADAPTER = ADAPTERS.C;
  const ROUTES = Object.freeze(['pointer', 'click', 'menu', 'keyboard']);
  const INTENT_KINDS = Object.freeze(['move-before', 'move-after', 'split-before-horizontal', 'split-after-horizontal', 'split-before-vertical', 'split-after-vertical', 'stack']);
  const LABELS = Object.freeze({
    'move-before': 'Move before',
    'move-after': 'Move after',
    'split-before-horizontal': 'Split left',
    'split-after-horizontal': 'Split right',
    'split-before-vertical': 'Split above',
    'split-after-vertical': 'Split below',
    stack: 'Stack together',
  });

  function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

  function compatibleTargets(graph, sourceId) {
    const source = composition.findNode(graph, sourceId);
    if (!source || source.node.type !== 'module') return [];
    const targets = [];
    composition.walkGraph(graph, (node) => {
      if (node.type === 'module' && node.id !== sourceId) targets.push(node.id);
    });
    return targets;
  }

  function ratios(input = {}) {
    if (Number.isFinite(input.xRatio) && Number.isFinite(input.yRatio)) return { x: clamp(Number(input.xRatio), 0, 1), y: clamp(Number(input.yRatio), 0, 1) };
    const rect = input.targetRect || {};
    const point = input.point || {};
    const width = Math.max(1, Number(rect.width) || 1);
    const height = Math.max(1, Number(rect.height) || 1);
    return {
      x: clamp((Number(point.x) - (Number(rect.left) || 0)) / width, 0, 1),
      y: clamp((Number(point.y) - (Number(rect.top) || 0)) / height, 0, 1),
    };
  }

  function intent(kind, sourceId, targetId, score) {
    const split = kind.match(/^split-(before|after)-(horizontal|vertical)$/);
    return Object.freeze({
      kind,
      label: LABELS[kind],
      sourceId,
      targetId,
      score: Math.round(score * 1000) / 1000,
      ...(split ? { position: split[1], axis: split[2] } : {}),
    });
  }

  function rankLegalDropIntents(graph, input = {}) {
    const sourceId = String(input.sourceId || '');
    const targetId = String(input.targetId || '');
    if (!compatibleTargets(graph, sourceId).includes(targetId)) return Object.freeze([]);
    const adapter = Object.values(ADAPTERS).includes(input.adapter) ? input.adapter : SELECTED_ADAPTER;
    const { x, y } = ratios(input);
    const targetRect = input.targetRect || {};
    const primary = Number(targetRect.height) > Number(targetRect.width) ? y : x;
    const reorderKind = primary < 0.5 ? 'move-before' : 'move-after';
    const reorderOther = primary < 0.5 ? 'move-after' : 'move-before';
    const centered = Math.abs(x - 0.5) <= 0.2 && Math.abs(y - 0.5) <= 0.2;
    const edgeScores = [
      ['split-before-horizontal', x <= 0.2 ? 110 - x : 25 - x],
      ['split-after-horizontal', x >= 0.8 ? 109 + x : 24 + x],
      ['split-before-vertical', y <= 0.2 ? 108 - y : 23 - y],
      ['split-after-vertical', y >= 0.8 ? 107 + y : 22 + y],
    ];
    const reorder = [intent(reorderKind, sourceId, targetId, 72 + Math.abs(primary - 0.5)), intent(reorderOther, sourceId, targetId, 32 - Math.abs(primary - 0.5))];
    const spatial = [intent('stack', sourceId, targetId, centered ? 100 : 30 - Math.abs(x - 0.5) - Math.abs(y - 0.5)), ...edgeScores.map(([kind, score]) => intent(kind, sourceId, targetId, score))];
    const candidates = adapter === ADAPTERS.A ? reorder : adapter === ADAPTERS.B ? spatial : [...reorder, ...spatial];
    return Object.freeze(candidates.sort((a, b) => b.score - a.score || INTENT_KINDS.indexOf(a.kind) - INTENT_KINDS.indexOf(b.kind)));
  }

  function operationForIntent(dropIntent, options = {}) {
    if (!dropIntent || !INTENT_KINDS.includes(dropIntent.kind)) throw Object.assign(new Error('A known drop intent is required.'), { code: 'DROP_INTENT_INVALID' });
    const route = options.route || 'pointer';
    if (!ROUTES.includes(route)) throw Object.assign(new Error(`Unknown composition input route "${route}".`), { code: 'DROP_ROUTE_INVALID' });
    const pair = { sourceId: dropIntent.sourceId, targetId: dropIntent.targetId };
    if (dropIntent.kind === 'move-before' || dropIntent.kind === 'move-after') return Object.freeze({ type: dropIntent.kind === 'move-before' ? 'moveBefore' : 'moveAfter', ...pair });
    const serial = Math.max(1, Math.trunc(Number(options.serial) || 1));
    if (dropIntent.kind === 'stack') return Object.freeze({ type: 'stackWith', ...pair, stackId: `c6-stack-${serial}`, position: 'after', activeChildId: pair.sourceId });
    return Object.freeze({ type: 'splitWith', ...pair, splitId: `c6-split-${serial}`, axis: dropIntent.axis, position: dropIntent.position, weights: [1, 1] });
  }

  function resizeWeights(weights, deltaPixels, totalPixels, minimumRatio = 0.2) {
    if (!Array.isArray(weights) || weights.length !== 2 || weights.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) throw Object.assign(new Error('Resize requires two positive split weights.'), { code: 'RESIZE_WEIGHTS_INVALID' });
    const total = Number(weights[0]) + Number(weights[1]);
    const extent = Number(totalPixels);
    if (!Number.isFinite(extent) || extent <= 0 || !Number.isFinite(Number(deltaPixels))) throw Object.assign(new Error('Resize geometry must be finite and positive.'), { code: 'RESIZE_GEOMETRY_INVALID' });
    const minimum = clamp(Number(minimumRatio) || 0.2, 0.1, 0.45);
    const first = clamp(Number(weights[0]) / total + Number(deltaPixels) / extent, minimum, 1 - minimum);
    return Object.freeze([Math.round(first * 10000) / 10000, Math.round((1 - first) * 10000) / 10000]);
  }

  function autoscrollDelta(position, extent, options = {}) {
    const edge = Math.max(16, Number(options.edge) || 48);
    const maximum = Math.max(1, Number(options.maximum) || 24);
    const point = Number(position);
    const size = Number(extent);
    if (!Number.isFinite(point) || !Number.isFinite(size) || size <= 0) return 0;
    if (point < edge) return -Math.ceil(maximum * clamp((edge - point) / edge, 0, 1));
    if (point > size - edge) return Math.ceil(maximum * clamp((point - (size - edge)) / edge, 0, 1));
    return 0;
  }

  function pointerStartAllowed(input = {}) {
    return input.mode === 'edit' && input.primaryButton === true && input.dedicatedHandle === true && input.nestedInteractive === false;
  }

  function evaluateAdapters() {
    return Object.freeze({
      selected: SELECTED_ADAPTER,
      reason: 'Hybrid ranked intents preserve fast reorder, spatial split and stack discovery, and one canonical operation boundary.',
      candidates: Object.freeze([
        Object.freeze({ id: ADAPTERS.A, coverage: 2, spatialPreview: false, canonicalOperations: true, selected: false }),
        Object.freeze({ id: ADAPTERS.B, coverage: 5, spatialPreview: true, canonicalOperations: true, selected: false }),
        Object.freeze({ id: ADAPTERS.C, coverage: 7, spatialPreview: true, canonicalOperations: true, selected: true }),
      ]),
    });
  }

  return Object.freeze({ ADAPTERS, SELECTED_ADAPTER, ROUTES, INTENT_KINDS, LABELS, compatibleTargets, rankLegalDropIntents, operationForIntent, resizeWeights, autoscrollDelta, pointerStartAllowed, evaluateAdapters });
}));
