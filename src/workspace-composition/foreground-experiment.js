(function pixelodyForegroundStageExperimentFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyForegroundStageExperiment = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createForegroundStageExperimentApi() {
  'use strict';

  // Foreground Stage is the comparison spine for the Studio foundation
  // rebuild. Studio keeps three permanent columns; this preset keeps one
  // foreground and a margin. The grid's first movable child owns the stage
  // and the remaining two recede, so promotion -- not traversal between
  // fixed panels -- is how a listener changes what they are working in.
  // Nothing here changes how a module behaves; only where it sits and how
  // much of the canvas it is allowed to claim.
  const PROFILE_ID = 'foreground-stage-r1';
  const THEME_ID = 'foreground';
  const LABEL = 'Foreground Stage';
  const MOVABLE_IDS = Object.freeze(['tracks-module', 'library-module', 'information-module']);

  function moduleNode(id, moduleKey, shape) {
    return { type: 'module', id, moduleKey, shape, configuration: {} };
  }

  function graphForVersion(version = 1) {
    // Version 2 is the remix comparison: the same canvas with a different
    // creator-default foreground, to prove the stage is a position rather
    // than a property of the track browser.
    const creatorOrder = Number(version) >= 2
      ? ['library-module', 'tracks-module', 'information-module']
      : [...MOVABLE_IDS];
    const movable = {
      'tracks-module': moduleNode('tracks-module', 'tracks.browser', 'stage'),
      'library-module': moduleNode('library-module', 'library.browser', 'panel'),
      'information-module': moduleNode('information-module', 'track.information', 'panel'),
    };
    return {
      type: 'root',
      id: `${PROFILE_ID}-root`,
      schemaVersion: 1,
      children: [{
        type: 'split',
        id: `${PROFILE_ID}-vertical-frame`,
        axis: 'vertical',
        weights: [0.88, 0.12],
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
            // No placement spans on the movable children on purpose. A span
            // declared here would follow the module when it is promoted or
            // demoted and immediately contradict the painted stage. Slot
            // position is the authority; the theme layer reads
            // data-cw-topology-slot and owns the geometry.
            children: [
              ...creatorOrder.map((id) => movable[id]),
              {
                type: 'overlay',
                id: 'signal-overlay',
                anchor: 'bottom-left',
                boundsPolicy: 'contained',
                children: [moduleNode('signal-module', 'audio.visualizer', 'ambient')],
              },
            ],
          }, {
            type: 'dock',
            id: 'queue-margin-dock',
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
            id: 'playback-foreground-split',
            axis: 'horizontal',
            weights: [0.3, 0.7],
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
