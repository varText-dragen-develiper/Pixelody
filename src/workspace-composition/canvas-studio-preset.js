(function pixelodyCanvasStudioPresetFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCanvasStudioPreset = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasStudioPresetApi() {
  'use strict';

  // The starting point for building a navigation system rather than a theme.
  //
  // A literally empty canvas is not expressible: the contract requires the
  // root to hold exactly one child and a grid to hold at least one. So the
  // canvas opens with a single pane and everything else waits in the tray.
  // That is as close to a blank page as the kernel allows without widening
  // the node vocabulary.
  //
  // REQUIRED_JOBS is deliberately empty here. The durable authority normally
  // refuses any composition that cannot reach all six product jobs, which
  // would make a one-pane canvas unopenable and every intermediate draft
  // illegal. The floor moves up to the Canvas Studio UI instead: the rail
  // shows which jobs are still unplaced and refuses to save until they all
  // are. This is a development-profile relaxation, not a product decision.
  const PROFILE_ID = 'canvas-studio-r1';
  const THEME_ID = 'foreground';
  const LABEL = 'Canvas Studio';
  const REQUIRED_JOBS = Object.freeze([]);
  const COMMIT_REQUIRED_JOBS = Object.freeze(['library-access', 'track-browsing', 'queue-access', 'current-track-identity', 'playback-transport', 'track-information']);
  const CANVAS_GRID_ID = 'canvas-field';
  const OPENING_MODULE = Object.freeze({ id: 'pane-1', moduleKey: 'tracks.browser', shape: 'stage' });

  function graphForVersion() {
    return {
      type: 'root',
      id: `${PROFILE_ID}-root`,
      schemaVersion: 1,
      children: [{
        type: 'grid',
        id: CANVAS_GRID_ID,
        columns: 12,
        rowPolicy: 'flow',
        children: [{
          type: 'module',
          id: OPENING_MODULE.id,
          moduleKey: OPENING_MODULE.moduleKey,
          shape: OPENING_MODULE.shape,
          configuration: {},
        }],
      }],
    };
  }

  return Object.freeze({ PROFILE_ID, THEME_ID, LABEL, REQUIRED_JOBS, COMMIT_REQUIRED_JOBS, CANVAS_GRID_ID, OPENING_MODULE, graphForVersion });
}));
