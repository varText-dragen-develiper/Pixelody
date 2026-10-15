(function pixelodySingularityProfileFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySingularityProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSingularityProfileApi() {
  'use strict';

  const PROFILE_ID = 'singularity-gravitational-field-r2';
  const MODEL_ID = 'singularity-projective-panel-r1';
  const LABEL = 'Singularity Gravitational Field';
  const PANEL_IDS = Object.freeze(['library', 'albums', 'tracks', 'secondary']);
  const PANELS = Object.freeze([
    Object.freeze({ id: 'library', label: 'Library', moduleKey: 'library.browser', selector: '[data-cw-product-root="library.browser"]', side: 'left', available: true }),
    Object.freeze({ id: 'albums', label: 'Albums / collection', moduleKey: 'artwork.stage', selector: '[data-singularity-product-root="albums.collection"]', side: 'top', available: true, rootPolicy: 'theme-scoped-split' }),
    Object.freeze({ id: 'tracks', label: 'Tracks', moduleKey: 'tracks.browser', selector: '[data-singularity-product-root="tracks.collection"]', side: 'right', available: true, rootPolicy: 'theme-scoped-split' }),
    Object.freeze({ id: 'secondary', label: 'Queue / information', moduleKey: 'track.information', selector: '[data-cw-product-root="track.information"]', side: 'bottom', available: true }),
  ]);
  const PANEL_BY_ID = Object.freeze(Object.fromEntries(PANELS.map((panel) => [panel.id, panel])));

  function panel(id) {
    return PANEL_BY_ID[id] || null;
  }

  function rootSelectors() {
    return Object.freeze(Object.fromEntries(PANELS.filter((item) => item.selector).map((item) => [item.id, item.selector])));
  }

  function moduleNode(id, moduleKey, shape) {
    return { type: 'module', id, moduleKey, shape, configuration: { projectionModel: MODEL_ID } };
  }

  function graphForVersion() {
    return {
      type: 'root',
      id: `${PROFILE_ID}-root`,
      schemaVersion: 1,
      children: [{
        type: 'split',
        id: `${PROFILE_ID}-frame`,
        axis: 'vertical',
        weights: [0.84, 0.16],
        children: [{
          type: 'grid',
          id: `${PROFILE_ID}-field`,
          columns: 12,
          rowPolicy: 'flow',
          children: [
            moduleNode('singularity-library', 'library.browser', 'panel'),
            moduleNode('singularity-albums', 'artwork.stage', 'stage'),
            moduleNode('singularity-tracks', 'tracks.browser', 'stage'),
            moduleNode('singularity-secondary', 'track.information', 'panel'),
            moduleNode('singularity-queue', 'queue.view', 'panel'),
          ],
        }, {
          type: 'dock',
          id: `${PROFILE_ID}-playback`,
          edge: 'bottom',
          sizePolicy: 'content',
          children: [{
            type: 'split',
            id: `${PROFILE_ID}-playback-split`,
            axis: 'horizontal',
            weights: [0.34, 0.66],
            children: [
              moduleNode('singularity-now-playing', 'now-playing', 'strip'),
              moduleNode('singularity-transport', 'transport.controls', 'strip'),
            ],
          }],
        }],
      }],
    };
  }

  return Object.freeze({ PROFILE_ID, MODEL_ID, LABEL, PANEL_IDS, PANELS, PANEL_BY_ID, panel, rootSelectors, graphForVersion });
}));
