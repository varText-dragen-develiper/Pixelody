(function pixelodySingularityProxyPortalProbeFactory(root, factory) {
  const contract = typeof module === 'object' && module.exports ? require('./singularity-contract') : root.PixelodySingularityContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySingularityProxyPortalProbe = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createProxyPortalProbeApi(contract) {
  'use strict';

  if (!contract) throw new Error('Singularity proxy/portal probe requires the shared contract.');
  const PROBE_ID = 'singularity-h-a-proxy-portal-r1';

  function snapshot(options = {}) {
    const frame = contract.viewport(options.viewport);
    const presentation = options.presentation || contract.initialPresentationState();
    const playback = options.playback || contract.initialPlaybackState();
    const activeId = presentation.openId || '';
    const previewId = activeId || presentation.previewId || '';
    const shells = contract.MODULE_IDS.map((id) => Object.freeze({
      id,
      moduleKey: contract.MODULE_KEYS[id],
      inert: true,
      ariaHidden: true,
      state: id === activeId ? 'released' : id === previewId ? 'preview' : 'dormant',
      polygon: contract.dormantPolygon(id, frame),
    }));
    const portal = activeId ? Object.freeze({
      moduleId: activeId,
      moduleKey: contract.MODULE_KEYS[activeId],
      ownsProductRoot: false,
      borrowsProductRoot: true,
      polygon: contract.activePolygon(activeId, frame),
      contentRect: contract.contentRect(activeId, frame),
      hinge: contract.hinge(activeId, frame),
      axisAlignedContent: true,
    }) : null;
    return Object.freeze({
      probeId: PROBE_ID,
      architecture: 'proxy-shells-single-product-portal',
      frame,
      presentation,
      shells: Object.freeze(shells),
      portal,
      seam: contract.seamState(playback),
    });
  }

  function ownerMoves(previous, next) {
    const before = previous?.portal?.moduleKey || '';
    const after = next?.portal?.moduleKey || '';
    if (before === after) return Object.freeze([]);
    const moves = [];
    if (before) moves.push(Object.freeze({ moduleKey: before, destination: 'legacy-owner', restoreFocus: true }));
    if (after) moves.push(Object.freeze({ moduleKey: after, destination: 'single-portal', preserveNode: true }));
    return Object.freeze(moves);
  }

  return Object.freeze({ PROBE_ID, snapshot, ownerMoves });
}));
