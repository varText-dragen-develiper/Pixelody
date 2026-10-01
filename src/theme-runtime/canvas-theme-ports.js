(function pixelodyCanvasThemePortsFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCanvasThemePorts = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasThemePortsApi() {
  'use strict';

  // Canvas remains the topology owner. Most ports are archive-faithful
  // presentation baselines; an explicit experience record is reserved for a
  // port whose existing first-party mechanics are reactivated inside Canvas.
  const definitions = [
    ['dev-lab', 'Dev Lab', 'core', ['original', 'quiet'], 'Internal testing sandbox with Studio geometry and an unmistakable swapped accent pair.', 'studio', 'pixel', 'pixel-cut', 'pixel', 'signal', 'calm', 'linear-list'],
    ['orbital', 'Orbital Retro-Future', 'core', ['original', 'kinetic'], 'Bold spacecraft HUD language inspired by classic retro-futurist interfaces.', 'cinematic', 'technical', 'framed', 'technical', 'signal', 'expressive', 'linear-list'],
    ['bulkhead', 'Bulkhead Terminal', 'core', ['original'], 'Heavy industrial science-fiction terminal and shooter-HUD language.', 'arcade', 'technical', 'framed', 'technical', 'mechanical', 'expressive', 'linear-list'],
    ['graphite-loadout', 'Graphite Loadout', 'core', ['original', 'kinetic'], 'Graphite tactical audio lab with equipment-panel material language.', 'cinematic', 'equipment', 'clipped', 'technical-editorial', 'drift', 'expressive', 'linear-list'],
    ['obsession', 'Obsession Mode', 'poster', ['poster', 'kinetic'], 'Restrained psychological-thriller poster language with crimson state ownership.', 'cinematic', 'minimal', 'pixel-cut', 'display', 'pulse', 'expressive', 'linear-list'],
    ['crystal', 'Crystal Audio', 'poster', ['poster', 'quiet'], 'Aqueous prism hi-fi deck with caustic glass and calm waterlight.', 'studio', 'minimal', 'soft', 'editorial', 'drift', 'calm', 'cover-flow'],
    ['neon-burst', 'Neon Burst', 'poster', ['poster', 'kinetic'], 'Blacklight print-lab energy with overprint, phosphor, and pressure-glow states.', 'arcade', 'ornamental', 'pixel-cut', 'display', 'mechanical', 'expressive', 'linear-list'],
    ['monument', 'Monument', 'poster', ['poster', 'quiet'], 'Private listening museum with stone plinths and conservation-label restraint.', 'cinematic', 'minimal', 'square', 'editorial', 'none', 'off', 'carousel'],
    ['analog-dossier', 'Analog Dossier', 'poster', ['poster', 'quiet'], 'Personal audio case room built from catalog cards, ledgers, and lab reports.', 'compact', 'technical', 'square', 'editorial', 'mechanical', 'calm', 'linear-list'],
    ['cosmic-cinema', 'Cosmic Cinema', 'poster', ['poster', 'quiet'], 'Cosmic-minimal black-hole observatory with orbital controls and silver light.', 'cinematic', 'technical', 'framed', 'technical', 'orbital-gravity', 'calm', 'carousel'],
    ['frosted-void', 'Frosted Void', 'poster', ['poster', 'quiet'], 'Liquid glass and spectral bubble film suspended in absolute black.', 'cinematic', 'minimal', 'square', 'display', 'pulse', 'calm', 'linear-list'],
    ['obsidian-glass', 'Obsidian Glass', 'core', ['original', 'quiet'], 'Premium black-glass presentation with soft prism audio light.', 'cinematic', 'minimal', 'soft', 'display', 'drift', 'calm', 'linear-list'],
    ['dead-signal', 'Dead Signal', 'poster', ['poster', 'kinetic'], 'Haunted broadcast archive with bone instruments, cyan waves, and dried crimson lock.', 'cinematic', 'technical', 'square', 'display', 'signal', 'calm', 'linear-list'],
    ['meme-machine', 'Meme Machine', 'poster', ['poster', 'kinetic'], 'Readable dark social interface shaped like a chaotic music bot.', 'arcade', 'minimal', 'soft', 'display', 'pulse', 'expressive', 'linear-list'],
    ['cartridge-quest', 'Cartridge Quest', 'core', ['original', 'kinetic'], 'Original 8/16-bit console music adventure with cartridge and RPG state language.', 'arcade', 'pixel', 'pixel-cut', 'pixel', 'mechanical', 'responsive', 'carousel'],
    ['sakura-bloom', 'Sakura Bloom', 'core', ['original', 'quiet'], 'Calm hanami listening room with washi, lacquer, blossom, and sage signal language.', 'studio', 'ornamental', 'soft', 'editorial', 'drift', 'calm', 'linear-list'],
    ['lo-fi-cafe', 'Lo-Fi Café', 'core', ['original', 'quiet'], 'Rainy walnut listening nook with paper-soft surfaces and moss status accents.', 'studio', 'ornamental', 'soft', 'editorial', 'drift', 'calm', 'linear-list'],
    ['ascii-social', 'ASCII Social', 'core', ['original', 'kinetic'], 'AS2-era graphic desktop with tactile panels and sparse character identity.', 'arcade', 'ornamental', 'framed', 'display', 'pulse', 'expressive', 'linear-list'],
    ['poster-pop', 'Poster Pop', 'poster', ['poster', 'kinetic'], 'Listening-party flyer with sticker-sheet graphics and loud color blocking.', 'arcade', 'oversized', 'soft', 'display', 'pulse', 'expressive', 'linear-list'],
    ['creator-layer', 'Creator Layer', 'poster', ['poster', 'kinetic'], 'Dark voice-room media companion intended for dual-monitor community setups.', 'compact', 'minimal', 'soft', 'technical', 'pulse', 'calm', 'linear-list'],
    ['modular-signal', 'Modular Signal', 'poster', ['original', 'poster', 'quiet'], 'Lavender modular poster system with blush signal ribbons and black structural ink.', 'modular', 'graphic', 'square', 'technical', 'mechanical', 'calm', 'linear-list'],
    ['cut-sheet', 'Cut Sheet', 'poster', ['original', 'poster', 'quiet'], 'Vinyl-mastering cut sheet with circuit ink, terracotta routing, and lathe geometry.', 'modular', 'technical', 'square', 'technical', 'mechanical', 'calm', 'linear-list'],
    ['acid-transit', 'Acid Transit', 'poster', ['original', 'poster', 'kinetic'], 'Holographic night-route system with access tape and strict two-color state ownership.', 'modular', 'graphic', 'clipped', 'technical-editorial', 'mechanical', 'expressive', 'linear-list'],
    ['ghost-index', 'Ghost Index', 'poster', ['original', 'poster', 'kinetic'], 'Spectral systems archive of bone micrographics and rare green/coral depth.', 'compact', 'technical', 'square', 'editorial', 'signal', 'calm', 'spectral-field'],
    ['violet-violent', 'Violet//Violent', 'core', ['original', 'kinetic'], 'Layered optical-memory instrument with violet intent and cyan confirmed signal.', 'cinematic', 'technical', 'framed', 'display', 'mechanical', 'expressive', 'memory-cascade'],
    ['abyssal-press', 'Abyssal Press', 'poster', ['original', 'poster', 'kinetic'], 'Pressure-printed oceanographic record built from typographic strata and utility rails.', 'cinematic', 'technical', 'square', 'display', 'mechanical', 'expressive', 'pressure-stack'],
    ['harmonic-registry', 'Harmonic Registry', 'poster', ['original', 'poster', 'quiet'], 'Daylight local-sound specimen book with separated intent and playback truth.', 'cinematic', 'technical', 'square', 'display', 'mechanical', 'calm', 'linear-list'],
  ];

  // Archive-host baseline, measured from the detached 2026-08-25 runtime.
  // The original desktop shell was not 27 unrelated dashboards: it was a
  // persistent Library / Stage / Inspector frame. A 24-column translation
  // preserves the 290px / flexible / 292px proportions at the archive's
  // common desktop width far more closely than the former invented 12-column
  // layouts. Queue remains paired with Inspector (it was a right drawer), the
  // signal field remains inside Stage, and the complete player remains one
  // bottom dock.
  // The archive was measured on a 24-column grid with one row per pane. The
  // grid is now four times finer across and six times finer down, so these
  // stay the archive's own numbers and are multiplied on the way out. The
  // rendered frame is identical to the pixel; only the number of places a
  // pane can be put has changed.
  const COLUMN_DIVISIONS = 4;
  const ROW_DIVISIONS = 6;

  const archivePlacement = Object.freeze({
    library: Object.freeze([1, 1, 5, 1]),
    stage: Object.freeze([6, 1, 14, 1]),
    utility: Object.freeze([20, 1, 5, 1]),
    tracks: Object.freeze([1, 1, 24, 1]),
    signal: Object.freeze([1, 1, 24, 1]),
  });

  // Top plus bottom of a padding shorthand, in px. Every archived value is
  // either a px length or a bare zero, so anything else is treated as zero
  // rather than guessed at.
  function verticalPadding(shorthand) {
    const parts = String(shorthand || '0').trim().split(/\s+/);
    const at = (index) => {
      const raw = parts[index] ?? parts[index - 2] ?? parts[0];
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? value : 0;
    };
    return at(0) + (parts.length >= 3 ? at(2) : at(0));
  }

  function archiveComposition(sourceStyles, overrides = {}) {
    const base = {
      layoutKey: 'archive-host',
      sourceStyles,
      archiveWorkspaceColumns: '290px minmax(560px, 1fr) 292px',
      workspaceColumns: 24 * COLUMN_DIVISIONS,
      workspaceGap: 8,
      workspacePadding: '0 8px',
      workspaceHeight: 'calc(100vh - 146px)',
      playerHeight: 88,
      playerColumns: '310px minmax(0, 1fr) 310px',
      archivePlayerColumns: '310px 1fr 310px',
      playerPadding: '0 16px',
      playerMargin: '0',
      workWeight: 0.895,
    };
    const value = { ...base, ...overrides };
    // The archive workspace was one row tall: library, stage and utility sat
    // side by side and filled the whole band between the header and the
    // player. So the base row for these ports is that band, not a module
    // height -- and the band is a value the theme is entitled to state, where
    // how a grid divides it is not. Vertical padding comes off first because
    // it is inside the grid's box and the rows only get what is left.
    const rowBase = `calc(${value.workspaceHeight} - ${verticalPadding(value.workspacePadding)}px)`;
    return deepFreeze({
      ...value,
      rowBase,
      gap: value.workspaceGap,
      placements: Object.fromEntries(Object.entries(archivePlacement).map(([slot, tuple]) => [slot, placement(tuple)])),
    });
  }

  // Values below are archive measurements, not new art direction. Stylesheet
  // order follows the archived registry, so Graphite Loadout's later
  // acid-tech-terminal.css gap (7px) wins over its earlier 5px declaration.
  const compositionDefinitions = Object.freeze({
    'dev-lab': archiveComposition(['dev-lab.css']),
    orbital: archiveComposition(['retro-future-theme.css'], { workspaceGap: 3, workspacePadding: '4px 8px 0' }),
    bulkhead: archiveComposition(['bulkhead-terminal-theme.css'], { workspaceGap: 4, workspacePadding: '6px 8px 0' }),
    'graphite-loadout': archiveComposition(['graphite-loadout-theme.css', 'acid-tech-terminal.css'], { workspaceGap: 7, workspacePadding: '5px 8px 0' }),
    obsession: archiveComposition(['poster-themes.css']),
    crystal: archiveComposition(['poster-themes.css', 'crystal.css']),
    'neon-burst': archiveComposition(['poster-themes.css']),
    monument: archiveComposition(['poster-themes.css']),
    'analog-dossier': archiveComposition(['poster-themes.css']),
    'cosmic-cinema': archiveComposition(['poster-themes.css', 'cosmic-observatory.css'], { workspaceGap: 10, workspacePadding: '0 10px' }),
    'frosted-void': archiveComposition(['frosted-void.css'], { workspaceGap: 10, workspacePadding: '0 10px' }),
    // Its player is 100px with 18px of vertical margin, so the band above it is
    // the header's 58px and those 118px off the window. The shared 146px
    // assumes an 88px player: kept, the player ran 30px past the window while
    // composing and was drawn 20px over every pane that reached it outside.
    'obsidian-glass': archiveComposition(['obsidian-glass.css'], { workspaceGap: 12, workspacePadding: '0 12px', workspaceHeight: 'calc(100vh - 176px)', playerHeight: 100, playerMargin: '10px 12px 8px' }),
    'dead-signal': archiveComposition(['dead-signal.css'], { workspaceGap: 3, workspacePadding: '0 7px', playerPadding: '0 18px' }),
    'meme-machine': archiveComposition(['meme-machine.css']),
    'cartridge-quest': archiveComposition(['cartridge-quest.css'], {
      workspaceGap: 14,
      workspacePadding: '10px 12px 0',
      // The window less this theme's 64px header and the controller deck's
      // whole row: 12px of separation, the 128px deck and its 8px bottom
      // margin. It was 334px, sized to fit a workspace that was itself cut
      // 128px short for a player the Canvas docks inside it, so everything
      // ended 128px above the window's bottom in both modes.
      workspaceHeight: 'calc(100vh - 212px)',
      playerHeight: 128,
      playerColumns: 'minmax(260px, 27fr) minmax(440px, 46fr) minmax(300px, 27fr)',
      archivePlayerColumns: 'minmax(260px, 27fr) minmax(440px, 46fr) minmax(300px, 27fr)',
      playerPadding: '8px 18px 12px',
      playerMargin: '0 12px 8px',
    }),
    'sakura-bloom': archiveComposition(['sakura-bloom.css']),
    'lo-fi-cafe': archiveComposition(['lo-fi-cafe.css']),
    'ascii-social': archiveComposition(['ascii-social.css']),
    'poster-pop': archiveComposition(['poster-themes.css']),
    'creator-layer': archiveComposition(['poster-themes.css'], { workspaceGap: 0, workspacePadding: '0' }),
    'modular-signal': archiveComposition(['modular-signal.css']),
    'cut-sheet': archiveComposition(['cut-sheet.css']),
    'acid-transit': archiveComposition(['acid-transit.css']),
    'ghost-index': archiveComposition(['ghost-index.css'], {
      workspaceGap: 0,
      workspaceHeight: 'calc(100vh - 170px)',
      playerHeight: 112,
      playerColumns: 'minmax(230px, 27fr) minmax(360px, 34fr) minmax(230px, 20fr)',
      archivePlayerColumns: 'minmax(230px, 27fr) minmax(220px, 19fr) minmax(360px, 34fr) minmax(230px, 20fr)',
      playerPadding: '8px 14px',
    }),
    'violet-violent': archiveComposition(['violet-violent.css'], {
      workspaceGap: 3,
      workspacePadding: '10px 10px 0',
      workspaceHeight: 'calc(100vh - 184px)',
      playerHeight: 112,
      playerColumns: 'minmax(210px, 290px) minmax(310px, 1fr) minmax(210px, 285px)',
      archivePlayerColumns: 'minmax(210px, 290px) minmax(250px, 330px) minmax(310px, 1fr) minmax(210px, 285px)',
      playerPadding: '14px 17px',
    }),
    'abyssal-press': archiveComposition(['abyssal-press.css'], {
      workspaceGap: 0,
      workspacePadding: '8px 8px 0',
      workspaceHeight: 'calc(100vh - 174px)',
      playerHeight: 112,
      playerColumns: 'minmax(220px, 310px) minmax(330px, 1fr) minmax(270px, 340px)',
      archivePlayerColumns: 'minmax(220px, 310px) minmax(330px, 1fr) minmax(270px, 340px)',
      playerPadding: '14px 16px 12px 24px',
    }),
    'harmonic-registry': archiveComposition(['harmonic-registry.css'], { workspaceGap: 0 }),
  });

  const experienceDefinitions = Object.freeze({
    'cartridge-quest': deepFreeze({
      key: 'cartridge-quest',
      stylesheet: 'canvas-cartridge-quest.css',
      miniStylesheet: 'mini-canvas-cartridge-quest.css',
      mechanics: [
        'cartridge-library',
        'save-files',
        'stage-route',
        'achievement-case',
        'party-queue',
        'boss-progress',
        'listening-xp',
        'link-deck',
      ],
    }),
    obsession: deepFreeze({
      key: 'obsession',
      stylesheet: 'canvas-obsession.css',
      miniStylesheet: 'mini-canvas-obsession.css',
      mechanics: [
        'registration-mark',
        'typographic-pressure',
        'editorial-reframing',
        'static-tension',
      ],
    }),
    'neon-burst': deepFreeze({
      key: 'neon-burst',
      stylesheet: 'canvas-neon-burst.css',
      miniStylesheet: 'mini-canvas-neon-burst.css',
      mechanics: [
        'overprint-registration',
        'tempo-halftone',
        'pressure-print',
        'quiet-ink',
      ],
    }),
    'lo-fi-cafe': deepFreeze({
      key: 'lo-fi-cafe',
      stylesheet: 'canvas-lo-fi-cafe.css',
      miniStylesheet: 'mini-canvas-lo-fi-cafe.css',
      mechanics: [
        'keepsake-shelf',
        'paper-wear',
        'room-lamp',
        'order-tickets',
      ],
    }),
  });

  const moduleDetails = Object.freeze({
    tracks: Object.freeze({ id: 'canvas-tracks', moduleKey: 'tracks.browser', shape: 'stage' }),
    library: Object.freeze({ id: 'canvas-library', moduleKey: 'library.browser', shape: 'panel' }),
    queue: Object.freeze({ id: 'canvas-queue', moduleKey: 'queue.view', shape: 'panel' }),
    information: Object.freeze({ id: 'canvas-information', moduleKey: 'track.information', shape: 'panel' }),
    signal: Object.freeze({ id: 'canvas-signal', moduleKey: 'audio.visualizer', shape: 'ambient' }),
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function placement(tuple) {
    return Object.freeze({
      columnStart: ((tuple[0] - 1) * COLUMN_DIVISIONS) + 1,
      rowStart: ((tuple[1] - 1) * ROW_DIVISIONS) + 1,
      columnSpan: tuple[2] * COLUMN_DIVISIONS,
      rowSpan: tuple[3] * ROW_DIVISIONS,
    });
  }

  function compositionFor(key) {
    return compositionDefinitions[key];
  }

  const PORTS = Object.freeze(definitions.map(([key, name, category, tags, summary, layout, controls, corners, typography, motion, intensity, navigation]) => Object.freeze({
    key,
    name,
    category,
    tags: Object.freeze([...tags]),
    summary,
    sourceManifest: `${key === 'orbital' ? 'orbital-retro' : key === 'bulkhead' ? 'bulkhead-terminal' : key === 'graphite-loadout' ? 'graphite-loadout' : key}.theme.json`,
    hud: Object.freeze({ layout, controls, corners }),
    typography: Object.freeze({ profile: typography }),
    motion: Object.freeze({ profile: motion, intensity }),
    navigation: Object.freeze({ trackBrowser: navigation }),
    composition: compositionFor(key),
    experience: experienceDefinitions[key] || null,
  })));
  const byKey = new Map(PORTS.map((port) => [port.key, port]));

  function get(key) {
    return byKey.get(String(key || '')) || null;
  }

  function normalizeKey(key) {
    return get(key)?.key || '';
  }

  function moduleNode(slot, coordinates, configuration = {}) {
    const detail = moduleDetails[slot];
    return {
      type: 'module',
      id: detail.id,
      moduleKey: detail.moduleKey,
      shape: detail.shape,
      configuration,
      placement: { ...coordinates },
    };
  }

  function graphForPort(key) {
    const port = get(key);
    if (!port) return null;
    const composition = port.composition;
    const moduleConfiguration = (slot) => {
      if (port.key !== 'cartridge-quest') return {};
      if (slot === 'tracks') return { effects: { animation: 'scan', particles: 'pixels', trigger: 'playback', intensity: 'subtle', speed: 'slow' } };
      return {};
    };
    return {
      type: 'root',
      id: `canvas-port-${port.key}-root`,
      schemaVersion: 1,
      children: [{
        type: 'split',
        id: `canvas-port-${port.key}-frame`,
        axis: 'vertical',
        weights: [composition.workWeight, Number((1 - composition.workWeight).toFixed(2))],
        children: [{
          type: 'grid',
          id: 'canvas-field',
          columns: composition.workspaceColumns,
          rowPolicy: 'dense',
          children: [{
            type: 'grid',
            id: `canvas-port-${port.key}-stage`,
            // The Stage's own grid is divided the same way as the work field.
            // Left at 24 while its children were multiplied to span 96, every
            // drag inside the Stage was refused by the packer in all ported
            // themes; Chromium hid the mismatch by giving the 72 extra tracks
            // no width, so it could not be seen, only felt.
            columns: 24 * COLUMN_DIVISIONS,
            rowPolicy: 'dense',
            placement: { ...composition.placements.stage },
            children: [
              moduleNode('tracks', composition.placements.tracks, moduleConfiguration('tracks')),
              {
                type: 'overlay',
                id: `canvas-port-${port.key}-signal-overlay`,
                anchor: 'fill',
                boundsPolicy: 'contained',
                placement: { ...composition.placements.signal },
                children: [moduleNode('signal')],
              },
            ],
          },
          moduleNode('library', composition.placements.library),
          {
            type: 'stack',
            id: `canvas-port-${port.key}-utility-stack`,
            activeChildId: moduleDetails.information.id,
            placement: { ...composition.placements.utility },
            children: [moduleNode('information'), moduleNode('queue')],
          }],
        }, {
          type: 'dock',
          id: 'playback-bottom-dock',
          edge: 'bottom',
          sizePolicy: 'content',
          children: [{
            type: 'split',
            id: 'playback-theme-split',
            axis: 'horizontal',
            weights: [0.34, 0.66],
            children: [
              { type: 'module', id: 'now-playing-module', moduleKey: 'now-playing', shape: 'strip', configuration: {} },
              { type: 'module', id: 'transport-module', moduleKey: 'transport.controls', shape: 'strip', configuration: {} },
            ],
          }],
        }],
      }],
    };
  }

  return Object.freeze({ PORTS, KEYS: Object.freeze(PORTS.map((port) => port.key)), get, normalizeKey, graphForPort });
}));
