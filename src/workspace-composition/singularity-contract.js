(function pixelodySingularityContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySingularityContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSingularityContractApi() {
  'use strict';

  const MODULE_IDS = Object.freeze(['library', 'albums', 'tracks', 'secondary']);
  const MODULE_KEYS = Object.freeze({
    library: 'library.browser',
    albums: 'artwork.stage',
    tracks: 'tracks.browser',
    secondary: 'track.information',
  });

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function viewport(value = {}) {
    const width = clamp(value.width, 800, 2400);
    const height = clamp(value.height, 700, 1600);
    const tier = width >= 1180 ? 'wide' : width >= 850 ? 'narrow' : 'compact';
    const playerHeight = tier === 'compact' ? 118 : 132;
    const margin = tier === 'wide' ? 36 : tier === 'narrow' ? 28 : 20;
    const fieldBottom = height - playerHeight;
    const center = tier === 'compact'
      ? { x: width / 2, y: 164, radius: 68 }
      : { x: width / 2, y: Math.round((fieldBottom + 44) * 0.48), radius: tier === 'wide' ? 112 : 92 };
    return Object.freeze({ width, height, tier, playerHeight, margin, fieldBottom, center });
  }

  function freezePoints(points) {
    return Object.freeze(points.map(([x, y]) => Object.freeze([Math.round(x), Math.round(y)])));
  }

  function dormantPolygon(id, input) {
    const frame = viewport(input);
    const { x, y, radius } = frame.center;
    const inner = radius + 12;
    const tangent = Math.round(radius * 0.46);
    const top = frame.margin + 38;
    const bottom = frame.fieldBottom - frame.margin;
    const left = frame.margin;
    const right = frame.width - frame.margin;
    const compactSpread = frame.tier === 'compact' ? 0.72 : 1;
    const polygons = {
      library: [[left, y - radius * compactSpread], [x - inner, y - tangent], [x - inner, y + tangent], [left, y + radius * compactSpread]],
      albums: [[x - radius * compactSpread, top], [x - tangent, y - inner], [x + tangent, y - inner], [x + radius * compactSpread, top]],
      tracks: [[x + inner, y - tangent], [right, y - radius * compactSpread], [right, y + radius * compactSpread], [x + inner, y + tangent]],
      secondary: [[x - tangent, y + inner], [x - radius * compactSpread, bottom], [x + radius * compactSpread, bottom], [x + tangent, y + inner]],
    };
    if (!MODULE_IDS.includes(id)) throw new Error(`Unknown singularity module: ${id}`);
    return freezePoints(polygons[id]);
  }

  function activeRect(id, input) {
    const frame = viewport(input);
    if (!MODULE_IDS.includes(id)) throw new Error(`Unknown singularity module: ${id}`);
    if (frame.tier === 'compact') {
      const y = frame.center.y + frame.center.radius + 34;
      return Object.freeze({ x: frame.margin, y, width: frame.width - (frame.margin * 2), height: Math.max(248, frame.fieldBottom - y - frame.margin) });
    }
    const gap = frame.center.radius + (frame.tier === 'wide' ? 42 : 30);
    const leftSide = id === 'library' || id === 'albums';
    const x = leftSide ? frame.margin : frame.center.x + gap;
    const rightEdge = leftSide ? frame.center.x - gap : frame.width - frame.margin;
    return Object.freeze({
      x: Math.round(x),
      y: frame.margin + 44,
      width: Math.max(310, Math.round(rightEdge - x)),
      height: Math.max(430, Math.round(frame.fieldBottom - (frame.margin * 2) - 44)),
    });
  }

  function polygonBounds(points, inset = 0) {
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const x = Math.min(...xs) + inset;
    const y = Math.min(...ys) + inset;
    const right = Math.max(...xs) - inset;
    const bottom = Math.max(...ys) - inset;
    return Object.freeze({ x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) });
  }

  function dormantContentRect(id, input) {
    const frame = viewport(input);
    const inset = frame.tier === 'compact' ? 6 : 10;
    return polygonBounds(dormantPolygon(id, frame), inset);
  }

  function activePolygon(id, input) {
    const frame = viewport(input);
    const rect = activeRect(id, frame);
    if (frame.tier === 'compact') {
      const throat = 24;
      const mid = frame.center.x;
      return freezePoints([
        [rect.x, rect.y], [mid - throat, rect.y], [mid, rect.y - 18], [mid + throat, rect.y],
        [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height],
      ]);
    }
    const leftSide = id === 'library' || id === 'albums';
    const cut = 34;
    if (leftSide) {
      return freezePoints([
        [rect.x, rect.y], [rect.x + rect.width - cut, rect.y], [rect.x + rect.width, rect.y + cut],
        [rect.x + rect.width, rect.y + rect.height - cut], [rect.x + rect.width - cut, rect.y + rect.height], [rect.x, rect.y + rect.height],
      ]);
    }
    return freezePoints([
      [rect.x + cut, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height],
      [rect.x + cut, rect.y + rect.height], [rect.x, rect.y + rect.height - cut], [rect.x, rect.y + cut],
    ]);
  }

  function contentRect(id, input) {
    const rect = activeRect(id, input);
    const inset = 26;
    return Object.freeze({ x: rect.x + inset, y: rect.y + inset, width: rect.width - (inset * 2), height: rect.height - (inset * 2) });
  }

  function hinge(id, input) {
    const frame = viewport(input);
    const rect = activeRect(id, frame);
    const { x, y, radius } = frame.center;
    if (frame.tier === 'compact') return freezePoints([[x, y + radius], [x, rect.y - 18], [x, rect.y]]);
    const leftSide = id === 'library' || id === 'albums';
    const planeX = leftSide ? rect.x + rect.width : rect.x;
    const centerX = leftSide ? x - radius : x + radius;
    return freezePoints([[centerX, y], [planeX, y - 28], [planeX, y + 28]]);
  }

  function cssPolygon(points) {
    return `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(', ')})`;
  }

  function initialPresentationState() {
    return Object.freeze({ previewId: '', openId: '', trigger: '', returnFocusId: '' });
  }

  function transitionPresentation(state, action = {}) {
    const current = state || initialPresentationState();
    const id = MODULE_IDS.includes(action.id) ? action.id : '';
    if (action.type === 'preview' && id) return Object.freeze({ ...current, previewId: id, trigger: action.trigger || 'pointer' });
    if (action.type === 'clear-preview' && !current.openId) return initialPresentationState();
    if (action.type === 'open' && id) return Object.freeze({ previewId: id, openId: id, trigger: action.trigger || 'explicit', returnFocusId: String(action.returnFocusId || '') });
    if (action.type === 'close') return Object.freeze({ ...initialPresentationState(), returnFocusId: current.returnFocusId });
    return current;
  }

  function initialPlaybackState() {
    return Object.freeze({ selectedId: '', requestedId: '', confirmedId: '', paused: true, failedRequestId: '' });
  }

  function transitionPlayback(state, action = {}) {
    const current = state || initialPlaybackState();
    const id = String(action.id || '');
    if (action.type === 'select') return Object.freeze({ ...current, selectedId: id });
    if (action.type === 'request') return Object.freeze({ ...current, requestedId: id, failedRequestId: '' });
    if (action.type === 'confirm') return Object.freeze({ ...current, requestedId: '', confirmedId: id, paused: false, failedRequestId: '' });
    if (action.type === 'pause') return Object.freeze({ ...current, paused: true });
    if (action.type === 'resume') return Object.freeze({ ...current, paused: false });
    if (action.type === 'fail') return Object.freeze({ ...current, requestedId: '', failedRequestId: id });
    return current;
  }

  function seamState(playback) {
    const confirmedId = String(playback?.confirmedId || '');
    const requestedId = String(playback?.requestedId || '');
    const failedRequestId = String(playback?.failedRequestId || '');
    if (failedRequestId) return Object.freeze({ visible: true, phase: 'failed', trackId: failedRequestId, confirmedId });
    if (requestedId) return Object.freeze({ visible: true, phase: 'requested', trackId: requestedId, confirmedId });
    if (!confirmedId) return Object.freeze({ visible: false, phase: 'idle', trackId: '', confirmedId: '' });
    return Object.freeze({ visible: true, phase: playback.paused ? 'paused' : 'confirmed', trackId: confirmedId, confirmedId });
  }

  return Object.freeze({
    MODULE_IDS, MODULE_KEYS, viewport, dormantPolygon, dormantContentRect, polygonBounds, activeRect, activePolygon, contentRect, hinge, cssPolygon,
    initialPresentationState, transitionPresentation, initialPlaybackState, transitionPlayback, seamState,
  });
}));
