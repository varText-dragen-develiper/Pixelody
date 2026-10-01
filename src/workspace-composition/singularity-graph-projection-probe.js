(function pixelodySingularityGraphProjectionProbeFactory(root, factory) {
  const contract = typeof module === 'object' && module.exports ? require('./singularity-contract') : root.PixelodySingularityContract;
  const profile = typeof module === 'object' && module.exports ? require('./singularity-profile') : root.PixelodySingularityProfile;
  const panelModel = typeof module === 'object' && module.exports ? require('./singularity-panel-model') : root.PixelodySingularityPanelModel;
  const api = factory(contract, profile, panelModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySingularityGraphProjectionProbe = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createGraphProjectionProbeApi(contract, profile, panelModel) {
  'use strict';

  if (!contract || !profile || !panelModel) throw new Error('Singularity graph-projection probe requires its contract, profile, and panel model.');
  const PROBE_ID = 'singularity-h-b-graph-projection-r2';
  const PROFILE_ID = profile.PROFILE_ID;

  function graph() {
    return profile.graphForVersion();
  }

  function snapshot(options = {}) {
    const frame = contract.viewport(options.viewport);
    const presentation = options.presentation || contract.initialPresentationState();
    const playback = options.playback || contract.initialPlaybackState();
    const activeId = presentation.openId || '';
    const previewId = presentation.previewId || '';
    const rectifiedId = activeId || previewId;
    const projections = profile.PANEL_IDS.map((id) => {
      const rectified = id === rectifiedId;
      const interactive = id === activeId;
      const model = panelModel.project(id, { viewport: frame, presentation });
      return Object.freeze({
        id: `singularity-${id}`,
        moduleId: id,
        moduleKey: contract.MODULE_KEYS[id],
        continuouslyMounted: true,
        ownsProductRoot: true,
        state: rectified ? interactive ? 'rectified-open' : 'rectified-preview' : 'dormant',
        polygon: rectified ? contract.activePolygon(id, frame) : contract.dormantPolygon(id, frame),
        contentRect: rectified ? contract.contentRect(id, frame) : contract.dormantContentRect(id, frame),
        hinge: rectified ? contract.hinge(id, frame) : null,
        interactive,
        visuallyPresent: true,
        ariaHidden: !interactive,
        model,
      });
    });
    return Object.freeze({
      probeId: PROBE_ID,
      profileId: PROFILE_ID,
      architecture: 'graph-owned-continuous-product-projection',
      frame,
      graph: graph(),
      presentation,
      projections: Object.freeze(projections),
      anchored: Object.freeze({ queue: 'secondary-folio', nowPlaying: 'bottom-datum', transport: 'bottom-datum' }),
      seam: contract.seamState(playback),
    });
  }

  function ownerMoves(previous, next) {
    const before = previous?.presentation?.openId || '';
    const after = next?.presentation?.openId || '';
    if (before === after) return Object.freeze([]);
    return Object.freeze(profile.PANEL_IDS.map((id) => Object.freeze({
      moduleKey: contract.MODULE_KEYS[id],
      destination: 'same-mounted-shell',
      projection: id === after ? 'rectified-open' : 'dormant',
      preserveNode: true,
    })));
  }

  return Object.freeze({ PROBE_ID, PROFILE_ID, MODEL_ID: panelModel.MODEL_ID, graph, snapshot, ownerMoves });
}));
