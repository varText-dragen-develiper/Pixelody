(function pixelodyWorkspaceDevLabSpecimensFactory(root, factory) {
  const composition = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.PixelodyWorkspaceCompositionContract;
  const moduleRegistry = typeof module === 'object' && module.exports
    ? require('./module-registry')
    : root.PixelodyWorkspaceModuleRegistry;
  const api = factory(composition, moduleRegistry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyWorkspaceDevLabSpecimens = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceDevLabSpecimensApi(composition, moduleRegistry) {
  'use strict';

  if (!composition || !moduleRegistry) throw new Error('Workspace Dev Lab specimens require the composition contract and module registry.');

  const TIERS = Object.freeze(['wide', 'intermediate', 'narrow']);
  const REQUIRED_JOBS = Object.freeze([
    'library-access',
    'track-browsing',
    'queue-access',
    'current-track-identity',
    'playback-transport',
    'track-information',
  ]);

  const FIXTURE = composition.deepFreeze({
    library: { collection: 'Local archive', playlists: 14, albums: 286, tracks: 3842 },
    tracks: [
      { id: 'track-1', title: 'Glass Transit', artist: 'Nova Assembly', duration: '4:12', format: 'FLAC 24/96' },
      { id: 'track-2', title: 'Soft Machine Weather', artist: 'Mara Vale', duration: '3:47', format: 'ALAC 24/48' },
      { id: 'track-3', title: 'Relay Bloom', artist: 'Signal Orchard', duration: '5:03', format: 'FLAC 16/44.1' },
    ],
    queue: { items: ['Soft Machine Weather', 'Relay Bloom', 'Night Cartography'], remaining: 3 },
    playback: { title: 'Glass Transit', artist: 'Nova Assembly', album: 'Memory Terminal', playing: true, position: 172, duration: 252, quality: 'FLAC · 24-bit · 96 kHz' },
    information: { year: '2026', genre: 'Electronic / Ambient', source: 'Local file', output: 'Windows shared mode', replayGain: '-5.2 dB' },
    signal: { bars: [0.18, 0.42, 0.68, 0.91, 0.74, 0.51, 0.83, 0.62, 0.35, 0.57, 0.77, 0.46] },
    lyrics: { available: true, lines: ['Streetlight in the signal rain', 'Every window keeps a name', 'Carry the relay home again'] },
  });

  const SHAPES = Object.freeze({
    panel: Object.freeze({ minInline: 180, minBlock: 120, maxInline: 1800, maxBlock: 1200, targetInline: 360, targetBlock: 320, resizeAxes: ['inline', 'block'], scrollPolicy: 'block' }),
    stage: Object.freeze({ minInline: 320, minBlock: 220, maxInline: 2200, maxBlock: 1400, targetInline: 760, targetBlock: 480, resizeAxes: ['inline', 'block'], scrollPolicy: 'block' }),
    strip: Object.freeze({ minInline: 160, minBlock: 52, maxInline: 1800, maxBlock: 280, targetInline: 560, targetBlock: 96, resizeAxes: ['inline'], scrollPolicy: 'none' }),
    tile: Object.freeze({ minInline: 160, minBlock: 120, maxInline: 1200, maxBlock: 900, targetInline: 320, targetBlock: 220, resizeAxes: ['inline', 'block'], scrollPolicy: 'none' }),
    ambient: Object.freeze({ minInline: 180, minBlock: 100, maxInline: 2200, maxBlock: 720, targetInline: 720, targetBlock: 180, resizeAxes: ['inline', 'block'], scrollPolicy: 'none' }),
    mini: Object.freeze({ minInline: 160, minBlock: 42, maxInline: 720, maxBlock: 180, targetInline: 320, targetBlock: 64, resizeAxes: ['inline'], scrollPolicy: 'none' }),
  });

  const SPECIMENS = Object.freeze([
    Object.freeze({ key: 'library.browser', family: 'family.library', label: 'Library', kicker: 'LOCAL ARCHIVE', jobs: ['library-access'], reads: ['library.summary'], commands: ['library.select'], shapes: ['panel'], defaultShape: 'panel', kind: 'library' }),
    Object.freeze({ key: 'tracks.browser', family: 'family.tracks', label: 'Track browser', kicker: 'COLLECTION / 03', jobs: ['track-browsing'], reads: ['tracks.list'], commands: ['playback.play-track'], shapes: ['panel', 'stage'], defaultShape: 'stage', kind: 'tracks' }),
    Object.freeze({ key: 'queue.view', family: 'family.queue', label: 'Queue', kicker: 'UP NEXT', jobs: ['queue-access'], reads: ['queue.snapshot'], commands: ['queue.remove'], shapes: ['panel'], defaultShape: 'panel', kind: 'queue' }),
    Object.freeze({ key: 'track.information', family: 'family.information', label: 'Track information', kicker: 'SOURCE TRUTH', jobs: ['track-information'], reads: ['track.information'], commands: [], shapes: ['panel'], defaultShape: 'panel', kind: 'information' }),
    Object.freeze({ key: 'audio.visualizer', family: 'family.signal', label: 'Signal field', kicker: 'DECORATIVE SIGNAL', jobs: ['decorative-signal-view'], reads: ['signal.frame'], commands: [], shapes: ['tile', 'ambient'], defaultShape: 'ambient', kind: 'signal', instancePolicy: 'multiple', cost: 'medium', scheduler: 'shared' }),
    Object.freeze({ key: 'transport.controls', family: 'family.transport', label: 'Transport', kicker: 'PLAYBACK CONTROL', jobs: ['playback-transport'], reads: ['playback.snapshot'], commands: ['playback.previous', 'playback.toggle', 'playback.next'], shapes: ['strip', 'mini'], defaultShape: 'strip', kind: 'transport' }),
    Object.freeze({ key: 'now-playing', family: 'family.playback', label: 'Now playing', kicker: 'CURRENT TRACK', jobs: ['current-track-identity'], reads: ['playback.snapshot'], commands: [], shapes: ['strip', 'mini'], defaultShape: 'strip', kind: 'now-playing' }),
  ]);

  const OPTIONAL_SPECIMENS = Object.freeze([
    Object.freeze({ key: 'artwork.stage', family: 'family.artwork', label: 'Artwork stage', kicker: 'OPTIONAL CATALOG MODULE', jobs: ['artwork-view'], reads: ['playback.snapshot'], commands: [], shapes: ['tile', 'panel', 'stage'], defaultShape: 'tile', kind: 'artwork' }),
    Object.freeze({ key: 'lyrics.view', family: 'family.lyrics', label: 'Lyrics', kicker: 'OPTIONAL CATALOG MODULE', jobs: ['lyrics-view'], reads: ['lyrics.snapshot'], commands: [], shapes: ['panel', 'stage'], defaultShape: 'panel', kind: 'lyrics' }),
    Object.freeze({ key: 'workspace.route-navigator', family: 'family.navigation', label: 'Route navigator', kicker: 'OPTIONAL CATALOG MODULE', jobs: ['workspace-navigation'], reads: ['library.summary', 'queue.summary', 'playback.summary'], commands: ['library.open', 'tracks.open', 'queue.open', 'track-information.open', 'settings.open'], shapes: ['panel', 'strip'], defaultShape: 'panel', kind: 'navigation' }),
  ]);
  const CATALOG_SPECIMENS = Object.freeze([...SPECIMENS, ...OPTIONAL_SPECIMENS]);

  const GRAPH = composition.deepFreeze({
    type: 'root',
    id: 'workspace-root',
    schemaVersion: 1,
    children: [{
      type: 'split',
      id: 'workspace-split',
      axis: 'horizontal',
      weights: [0.78, 0.22],
      children: [{
        type: 'grid',
        id: 'workspace-grid',
        columns: 12,
        rowPolicy: 'flow',
        children: [
          { type: 'module', id: 'library-module', moduleKey: 'library.browser', shape: 'panel', configuration: {}, placement: { columnSpan: 3, rowSpan: 2 } },
          { type: 'module', id: 'tracks-module', moduleKey: 'tracks.browser', shape: 'stage', configuration: {}, placement: { columnSpan: 6, rowSpan: 2 } },
          { type: 'module', id: 'queue-module', moduleKey: 'queue.view', shape: 'panel', configuration: {}, placement: { columnSpan: 3, rowSpan: 1 } },
          { type: 'module', id: 'information-module', moduleKey: 'track.information', shape: 'panel', configuration: {}, placement: { columnSpan: 3, rowSpan: 1 } },
          {
            type: 'overlay', id: 'signal-overlay', anchor: 'fill', boundsPolicy: 'contained', placement: { columnSpan: 12, rowSpan: 1 }, children: [
              { type: 'module', id: 'signal-module', moduleKey: 'audio.visualizer', shape: 'ambient', configuration: { palette: 'neutral' } },
            ],
          },
        ],
      }, {
        type: 'dock',
        id: 'playback-dock',
        edge: 'right',
        sizePolicy: 'fraction',
        size: 0.22,
        children: [{
          type: 'stack',
          id: 'playback-stack',
          activeChildId: 'transport-module',
          children: [
            { type: 'module', id: 'transport-module', moduleKey: 'transport.controls', shape: 'strip', configuration: {} },
            { type: 'module', id: 'now-playing-module', moduleKey: 'now-playing', shape: 'strip', configuration: {} },
          ],
        }],
      }],
    }],
  });

  const PLACEMENTS = composition.deepFreeze({
    wide: {
      'library-module': { columnStart: 1, columnSpan: 3, rowStart: 1, rowSpan: 2 },
      'tracks-module': { columnStart: 4, columnSpan: 6, rowStart: 1, rowSpan: 2 },
      'queue-module': { columnStart: 10, columnSpan: 3, rowStart: 1, rowSpan: 1 },
      'information-module': { columnStart: 10, columnSpan: 3, rowStart: 2, rowSpan: 1 },
      'signal-overlay': { columnStart: 1, columnSpan: 12, rowStart: 3, rowSpan: 1 },
    },
    intermediate: {
      'library-module': { columnStart: 1, columnSpan: 3, rowStart: 1, rowSpan: 1 },
      'tracks-module': { columnStart: 4, columnSpan: 5, rowStart: 1, rowSpan: 2 },
      'queue-module': { columnStart: 1, columnSpan: 3, rowStart: 2, rowSpan: 1 },
      'information-module': { columnStart: 1, columnSpan: 3, rowStart: 3, rowSpan: 1 },
      'signal-overlay': { columnStart: 4, columnSpan: 5, rowStart: 3, rowSpan: 1 },
    },
    narrow: {
      'library-module': { columnStart: 1, columnSpan: 1, rowStart: 1, rowSpan: 1 },
      'tracks-module': { columnStart: 1, columnSpan: 1, rowStart: 2, rowSpan: 1 },
      'queue-module': { columnStart: 1, columnSpan: 1, rowStart: 3, rowSpan: 1 },
      'information-module': { columnStart: 1, columnSpan: 1, rowStart: 4, rowSpan: 1 },
      'signal-overlay': { columnStart: 1, columnSpan: 1, rowStart: 5, rowSpan: 1 },
    },
  });

  const SLOT_TEMPLATES = composition.deepFreeze({
    wide: Object.values(PLACEMENTS.wide),
    intermediate: Object.values(PLACEMENTS.intermediate),
    narrow: Object.values(PLACEMENTS.narrow),
  });

  function tierForWidth(width) {
    const value = Number(width);
    if (!Number.isFinite(value) || value < 0) throw Object.assign(new Error('Viewport width must be a non-negative finite number.'), { code: 'LAB_WIDTH_INVALID' });
    if (value >= 1000) return 'wide';
    if (value >= 680) return 'intermediate';
    return 'narrow';
  }

  function hashText(value) {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function placementsForGraph(graph, tier, columns) {
    const grid = composition.findNode(graph, 'workspace-grid')?.node;
    const result = Object.create(null);
    if (!grid || grid.type !== 'grid') return result;
    const templates = SLOT_TEMPLATES[tier];
    grid.children.forEach((child, index) => {
      if (templates[index]) result[child.id] = templates[index];
      else result[child.id] = { columnStart: 1, columnSpan: columns, rowStart: index + 1, rowSpan: 1 };
    });
    return result;
  }

  function deriveProjection(graph, width) {
    const tier = tierForWidth(width);
    const columns = tier === 'wide' ? 12 : tier === 'intermediate' ? 8 : 1;
    const shapes = Object.create(null);
    composition.walkGraph(graph, (node) => {
      if (node.type !== 'module') return;
      let shape = node.shape;
      if (tier === 'intermediate' && shape === 'stage') shape = 'panel';
      if (tier === 'intermediate' && shape === 'ambient') shape = 'tile';
      if (tier === 'narrow') {
        if (node.moduleKey === 'audio.visualizer') shape = 'tile';
        else shape = ['strip', 'mini'].includes(node.shape) ? 'mini' : 'panel';
      }
      shapes[node.id] = shape;
    });
    return composition.deepFreeze({
      tier,
      columns,
      splitAxis: tier === 'wide' ? 'horizontal' : 'vertical',
      dockEdge: tier === 'wide' ? 'right' : 'bottom',
      placements: placementsForGraph(graph, tier, columns),
      shapes,
      focusOrder: composition.deriveFocusOrder(graph),
    });
  }

  function validateProjection(projection) {
    const errors = [];
    const occupied = new Set();
    Object.entries(projection.placements).forEach(([id, placement]) => {
      if (placement.columnStart < 1 || placement.columnStart + placement.columnSpan - 1 > projection.columns) errors.push(`${id} exceeds ${projection.columns} columns.`);
      for (let row = placement.rowStart; row < placement.rowStart + placement.rowSpan; row += 1) {
        for (let column = placement.columnStart; column < placement.columnStart + placement.columnSpan; column += 1) {
          const cell = `${row}:${column}`;
          if (occupied.has(cell)) errors.push(`${id} overlaps grid cell ${cell}.`);
          occupied.add(cell);
        }
      }
    });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }

  function shapeMap(keys) {
    const result = Object.create(null);
    keys.forEach((key) => { result[key] = SHAPES[key]; });
    return result;
  }

  function descriptorFor(specimen, create, fallback = false) {
    return {
      contractVersion: 1,
      key: fallback ? `fallback.${specimen.key}` : specimen.key,
      version: '1.0.0',
      family: specimen.family,
      productJobs: specimen.jobs,
      reads: fallback ? [] : [...specimen.reads, 'lab.failure'],
      commands: fallback ? [] : specimen.commands,
      shapes: shapeMap(specimen.shapes),
      defaultShape: specimen.defaultShape,
      instancePolicy: specimen.instancePolicy || 'single',
      performance: { cost: fallback ? 'low' : specimen.cost || 'low', scheduler: fallback ? 'none' : specimen.scheduler || 'none', pausesWhenHidden: true, conserveFps: specimen.scheduler === 'shared' && !fallback ? 12 : 0 },
      motionOff: specimen.kind === 'signal' ? 'static' : 'unchanged',
      accessibility: { name: fallback ? `${specimen.label} fallback` : specimen.label, focusPolicy: specimen.commands.length && !fallback ? 'entry' : 'none', status: 'polite', nonDragActions: true },
      miniRelationship: specimen.shapes.includes('mini') ? 'shared-configuration' : 'main-only',
      configurationSchemaVersion: 1,
      defaultConfiguration: {},
      fallbackKey: fallback ? '' : `fallback.${specimen.key}`,
      fallbackDescription: `Use the product-owned neutral ${specimen.label.toLowerCase()} specimen.`,
      isFallback: fallback,
      create,
    };
  }

  function createRegistry(options = {}) {
    const registry = moduleRegistry.createRegistry();
    CATALOG_SPECIMENS.forEach((specimen) => {
      registry.register(descriptorFor(specimen, () => options.createFallbackLifecycle(specimen), true), { origin: 'product' });
      registry.register(descriptorFor(specimen, (context) => {
        const injected = context.read('lab.failure');
        if (injected?.moduleKey === specimen.key) throw new Error(`Deliberate ${specimen.key} factory failure.`);
        return options.createLifecycle(specimen, context);
      }, false), { origin: 'product' });
    });
    registry.seal();
    return registry;
  }

  return Object.freeze({ TIERS, REQUIRED_JOBS, FIXTURE, SHAPES, SPECIMENS, OPTIONAL_SPECIMENS, CATALOG_SPECIMENS, GRAPH, PLACEMENTS, tierForWidth, hashText, deriveProjection, validateProjection, descriptorFor, createRegistry });
}));
