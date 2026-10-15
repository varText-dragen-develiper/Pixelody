(function pixelodyComposableThemeExperimentFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyComposableThemeExperiment = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createComposableThemeExperimentApi() {
  'use strict';

  const PROFILE_ID = 'counterspace-relay-r1';
  const THEME_ID = 'dev-lab';
  const LABEL = 'Counterspace Relay';
  const MOVABLE_IDS = Object.freeze(['tracks-module', 'library-module', 'information-module']);

  function moduleNode(id, moduleKey, shape, placement = undefined) {
    const node = { type: 'module', id, moduleKey, shape, configuration: {} };
    if (placement) node.placement = placement;
    return node;
  }

  function graphForVersion(version = 1) {
    const creatorOrder = Number(version) >= 2
      ? ['tracks-module', 'information-module', 'library-module']
      : [...MOVABLE_IDS];
    const movable = {
      'tracks-module': moduleNode('tracks-module', 'tracks.browser', 'stage', { columnSpan: 8, rowSpan: 2 }),
      'library-module': moduleNode('library-module', 'library.browser', 'panel', { columnSpan: 4, rowSpan: 1 }),
      'information-module': moduleNode('information-module', 'track.information', 'panel', { columnSpan: 4, rowSpan: 1 }),
    };
    return {
      type: 'root',
      id: `${PROFILE_ID}-root`,
      schemaVersion: 1,
      children: [{
        type: 'split',
        id: `${PROFILE_ID}-vertical-frame`,
        axis: 'vertical',
        weights: [0.84, 0.16],
        children: [{
          type: 'split',
          id: `${PROFILE_ID}-work-field`,
          axis: 'horizontal',
          weights: [0.78, 0.22],
          children: [{
            type: 'grid',
            id: `${PROFILE_ID}-canvas`,
            columns: 12,
            rowPolicy: 'flow',
            children: [
              ...creatorOrder.map((id) => movable[id]),
              {
                type: 'overlay',
                id: 'signal-overlay',
                anchor: 'bottom-right',
                boundsPolicy: 'contained',
                children: [moduleNode('signal-module', 'audio.visualizer', 'ambient')],
              },
            ],
          }, {
            type: 'dock',
            id: 'queue-drawer-dock',
            edge: 'right',
            sizePolicy: 'fraction',
            size: 0.22,
            children: [moduleNode('queue-module', 'queue.view', 'panel')],
          }],
        }, {
          type: 'dock',
          id: 'playback-bottom-dock',
          edge: 'bottom',
          sizePolicy: 'content',
          children: [{
            type: 'split',
            id: 'playback-relay-split',
            axis: 'horizontal',
            weights: [0.34, 0.66],
            children: [
              moduleNode('now-playing-module', 'now-playing', 'strip'),
              moduleNode('transport-module', 'transport.controls', 'strip'),
            ],
          }],
        }],
      }],
    };
  }

  return Object.freeze({ PROFILE_ID, THEME_ID, LABEL, MOVABLE_IDS, graphForVersion });
}));
