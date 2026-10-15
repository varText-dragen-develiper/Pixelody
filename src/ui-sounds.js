(function () {
  const DEFAULT_SETTINGS = { mode: 'subtle', volume: 0.28 };
  const MODES = new Set(['off', 'subtle', 'expressive']);
  const INTERACTIVE_SELECTOR = [
    'button:not(:disabled)',
    '[role="button"]',
    'input',
    'select',
    '.playlist-item',
    '.track-row:not(.track-header)',
    '.queue-item',
    '.chip',
    '[data-theme-option]',
    '[data-settings-tab]',
    '[data-palette]',
    '.collapsible-card',
    '.setting-label',
    '.panel-resizer',
    '.panel-handle',
  ].join(',');
  const CLOSE_SELECTOR = [
    '#closeSettings',
    '#closeQueue',
    '#metadataClose',
    '#closeMini',
    '#closePlaylistCreator',
    '#cancelPlaylistCreator',
    '#closeTrackEditor',
    '#backToLibrary',
    '#closeInspector',
    '[data-close-settings]',
    '[data-close-track-editor]',
    '[data-close-playlist-creator]',
  ].join(',');
  const OPEN_SELECTOR = [
    '#settingsButton',
    '#queueButton',
    '#miniPlayerButton',
    '#createPlaylist',
    '#addToPlaylist',
    '#openSystems',
    '#systemsButton',
    '#metadataToggle',
    '#restoreMain',
    '.card-collapse',
  ].join(',');
  const SELECT_SELECTOR = [
    '.playlist-item',
    '.track-row:not(.track-header)',
    '.queue-item',
    '[data-settings-tab]',
    '[data-library-mode]',
    '[data-theme-option]',
    '[data-palette]',
    '.filter',
    '.preset',
  ].join(',');
  const HOVER_GROUP_SELECTORS = [
    ['tracks', '.track-row:not(.track-header)'],
    ['playlists', '.playlist-item'],
    ['queue', '.queue-item'],
    ['themes', '[data-theme-option]'],
    ['filters', '.chip, .filter, .preset'],
  ];
  const INTERVALS = { hover: 140, press: 38, select: 70, open: 140, close: 140, toggle: 80, adjust: 62, swipe: 180 };
  const HOVER_GOVERNOR = { dwell: 55, globalInterval: 180, groupedInterval: 280 };
  const THEME_PROFILES = {
    studio: { wave: 'triangle', pitch: 1, tone: 1, samples: 'soft-ui' },
    orbital: { wave: 'sine', pitch: 1.16, tone: 1.05, samples: 'signal-ui' },
    bulkhead: { wave: 'square', pitch: 0.86, tone: 0.9, samples: 'terminal-metal' },
    'graphite-loadout': { wave: 'sawtooth', pitch: 1.08, tone: 0.82, samples: 'tactical-clicks' },
    'cartridge-quest': { wave: 'square', pitch: 1.22, tone: 0.78, samples: 'retro-menu' },
    obsession: { wave: 'sawtooth', pitch: 0.74, tone: 0.7, samples: 'severe-clicks' },
    crystal: { wave: 'sine', pitch: 1.24, tone: 0.84, samples: 'glass-ui' },
    'neon-burst': { wave: 'square', pitch: 1.28, tone: 0.86, samples: 'arcade-pop' },
    monument: { wave: 'triangle', pitch: 0.78, tone: 0.74, samples: 'quiet-ui' },
    'analog-dossier': { wave: 'triangle', pitch: 0.82, tone: 0.76, samples: 'paper-dossier' },
    'cosmic-cinema': { wave: 'sine', pitch: 0.94, tone: 0.82, samples: 'orbital-archive' },
    'frosted-void': { wave: 'sine', pitch: 1.08, tone: 0.74, samples: 'cold-glass' },
    'dead-signal': { wave: 'sawtooth', pitch: 0.7, tone: 0.68, samples: 'damaged-relay' },
    'meme-machine': { wave: 'square', pitch: 1.05, tone: 0.8, samples: 'chat-pop' },
    'sakura-bloom': { wave: 'sine', pitch: 1.18, tone: 0.76, samples: 'petal-chimes' },
    'lo-fi-cafe': { wave: 'triangle', pitch: 0.86, tone: 0.72, samples: 'paper-dossier' },
    'poster-pop': { wave: 'triangle', pitch: 1.18, tone: 0.9, samples: 'poster-sticker' },
    'creator-layer': { wave: 'square', pitch: 1.12, tone: 0.76, samples: 'editor-tools' },
  };
  const SAMPLE_ROOT = 'assets/themes/ui-sounds/';
  const SAMPLES = {
    soft: `${SAMPLE_ROOT}little-robot-ui/click-soft-00.mp3`,
    soft2: `${SAMPLE_ROOT}little-robot-ui/click-soft-01.mp3`,
    soft3: `${SAMPLE_ROOT}little-robot-ui/click-soft-02.mp3`,
    standard: `${SAMPLE_ROOT}little-robot-ui/click-standard-00.mp3`,
    standard2: `${SAMPLE_ROOT}little-robot-ui/click-standard-01.mp3`,
    standard3: `${SAMPLE_ROOT}little-robot-ui/click-standard-02.mp3`,
    heavy: `${SAMPLE_ROOT}little-robot-ui/click-heavy-00.mp3`,
    electronic0: `${SAMPLE_ROOT}little-robot-ui/click-electronic-00.mp3`,
    electronic: `${SAMPLE_ROOT}little-robot-ui/click-electronic-03.mp3`,
    electronic4: `${SAMPLE_ROOT}little-robot-ui/click-electronic-04.mp3`,
    electronic2: `${SAMPLE_ROOT}little-robot-ui/click-electronic-07.mp3`,
    electronic10: `${SAMPLE_ROOT}little-robot-ui/click-electronic-10.mp3`,
    mechanical: `${SAMPLE_ROOT}little-robot-ui/click-mechanical-00.mp3`,
    mechanical2: `${SAMPLE_ROOT}little-robot-ui/click-mechanical-01.mp3`,
    slide: `${SAMPLE_ROOT}little-robot-ui/slide-electronic-00.mp3`,
    slide2: `${SAMPLE_ROOT}little-robot-ui/slide-electronic-01.mp3`,
    slide3: `${SAMPLE_ROOT}little-robot-ui/slide-electronic-02.mp3`,
    slideSharp: `${SAMPLE_ROOT}little-robot-ui/slide-sharp-00.mp3`,
    slideSoft: `${SAMPLE_ROOT}little-robot-ui/slide-soft-00.mp3`,
    retroMove: `${SAMPLE_ROOT}subspace-retro/menu-move-1.wav`,
    retroMove2: `${SAMPLE_ROOT}subspace-retro/menu-move-2.wav`,
    retroMove3: `${SAMPLE_ROOT}subspace-retro/menu-move-3.wav`,
    retroMove4: `${SAMPLE_ROOT}subspace-retro/menu-move-4.wav`,
    retroSelect: `${SAMPLE_ROOT}subspace-retro/menu-select-1.wav`,
    retroSelectB: `${SAMPLE_ROOT}subspace-retro/menu-select-2.wav`,
    retroSelect2: `${SAMPLE_ROOT}subspace-retro/menu-select-3.wav`,
    retroSelect4: `${SAMPLE_ROOT}subspace-retro/menu-select-4.wav`,
    retroButton1: `${SAMPLE_ROOT}subspace-retro/button-1.wav`,
    retroButton2: `${SAMPLE_ROOT}subspace-retro/button-2.wav`,
    retroButton: `${SAMPLE_ROOT}subspace-retro/button-4.wav`,
    retroButton8: `${SAMPLE_ROOT}subspace-retro/button-8.wav`,
    retroBlip1: `${SAMPLE_ROOT}subspace-retro/blip-1.wav`,
    retroBlip: `${SAMPLE_ROOT}subspace-retro/blip-4.wav`,
    retroBlip5: `${SAMPLE_ROOT}subspace-retro/blip-5.wav`,
    retroHigh1: `${SAMPLE_ROOT}subspace-retro/high-1.wav`,
    retroHigh: `${SAMPLE_ROOT}subspace-retro/high-3.wav`,
    retroHigh6: `${SAMPLE_ROOT}subspace-retro/high-6.wav`,
    retroNeutral1: `${SAMPLE_ROOT}subspace-retro/neutral-1.wav`,
    retroNeutral2: `${SAMPLE_ROOT}subspace-retro/neutral-2.wav`,
    retroPower1: `${SAMPLE_ROOT}subspace-retro/powerup-1.wav`,
    retroPower: `${SAMPLE_ROOT}subspace-retro/powerup-3.wav`,
    retroPower8: `${SAMPLE_ROOT}subspace-retro/powerup-8.wav`,
    retroPortal: `${SAMPLE_ROOT}subspace-retro/portal-2.wav`,
    retroPortal4: `${SAMPLE_ROOT}subspace-retro/portal-4.wav`,
    metal: `${SAMPLE_ROOT}kenney-rpg/metal-click.ogg`,
    latch: `${SAMPLE_ROOT}kenney-rpg/metal-latch.ogg`,
    metalPot: `${SAMPLE_ROOT}kenney-rpg/metal-pot-1.ogg`,
    beltHandle: `${SAMPLE_ROOT}kenney-rpg/belt-handle-1.ogg`,
    bookFlip: `${SAMPLE_ROOT}kenney-rpg/book-flip-1.ogg`,
    bookFlip2: `${SAMPLE_ROOT}kenney-rpg/book-flip-2.ogg`,
    bookFlip3: `${SAMPLE_ROOT}kenney-rpg/book-flip-3.ogg`,
    bookOpen: `${SAMPLE_ROOT}kenney-rpg/book-open.ogg`,
    bookClose: `${SAMPLE_ROOT}kenney-rpg/book-close.ogg`,
    cloth: `${SAMPLE_ROOT}kenney-rpg/cloth-1.ogg`,
    cloth2: `${SAMPLE_ROOT}kenney-rpg/cloth-2.ogg`,
    cloth3: `${SAMPLE_ROOT}kenney-rpg/cloth-3.ogg`,
    coins: `${SAMPLE_ROOT}kenney-rpg/coins.ogg`,
    coins2: `${SAMPLE_ROOT}kenney-rpg/coins-2.ogg`,
    doorOpen: `${SAMPLE_ROOT}kenney-rpg/door-open-1.ogg`,
    doorClose: `${SAMPLE_ROOT}kenney-rpg/door-close-1.ogg`,
    rpgInterface1: `${SAMPLE_ROOT}artisticdude-rpg/interface-1.wav`,
    rpgInterface2: `${SAMPLE_ROOT}artisticdude-rpg/interface-2.wav`,
    rpgInterface3: `${SAMPLE_ROOT}artisticdude-rpg/interface-3.wav`,
    rpgInterface4: `${SAMPLE_ROOT}artisticdude-rpg/interface-4.wav`,
    rpgInterface5: `${SAMPLE_ROOT}artisticdude-rpg/interface-5.wav`,
    rpgInterface6: `${SAMPLE_ROOT}artisticdude-rpg/interface-6.wav`,
    bubble: `${SAMPLE_ROOT}artisticdude-rpg/bubble-1.wav`,
    bubble2: `${SAMPLE_ROOT}artisticdude-rpg/bubble-2.wav`,
    rpgCoin: `${SAMPLE_ROOT}artisticdude-rpg/coin-1.wav`,
    smallMetal: `${SAMPLE_ROOT}artisticdude-rpg/metal-small-1.wav`,
    wood: `${SAMPLE_ROOT}artisticdude-rpg/wood-small.wav`,
  };
  const cue = (sample, gain = 0.45, options = {}) => ({ sample, gain, ...options });
  const variant = (samples, gain = 0.45, options = {}) => ({ samples, gain, ...options });
  const SAMPLE_PROFILES = {
    'soft-ui': {
      hover: [variant(['soft', 'soft2', 'soft3'], 0.18, { duration: 0.038 })],
      press: [variant(['standard', 'standard2', 'standard3'], 0.28, { duration: 0.065 })],
      select: [variant(['standard', 'standard2', 'standard3'], 0.24), variant(['soft', 'soft2', 'soft3'], 0.13, { delay: 0.028, rate: 1.18, duration: 0.044 })],
      open: [variant(['slideSoft', 'slide2'], 0.2, { duration: 0.16 })],
      close: [variant(['slideSoft', 'slide3'], 0.18, { rate: 0.86, duration: 0.13 })],
      toggle: [variant(['standard', 'standard2', 'mechanical'], 0.22, { rate: 1.08 })],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.12, { duration: 0.026, rate: 1.25 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.2, { duration: 0.18 })],
    },
    'quiet-ui': {
      hover: [variant(['soft', 'soft2', 'soft3'], 0.08, { duration: 0.032 })],
      press: [variant(['soft', 'soft2', 'soft3'], 0.15, { duration: 0.06, rate: 0.9 })],
      select: [variant(['soft', 'standard', 'standard2'], 0.16, { duration: 0.08 })],
      open: [variant(['slideSoft', 'slide2'], 0.11, { duration: 0.14, rate: 0.82 })],
      close: [variant(['slideSoft', 'slide3'], 0.1, { duration: 0.13, rate: 0.76 })],
      toggle: [variant(['soft', 'standard'], 0.12)],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.07, { duration: 0.022 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.11, { duration: 0.16 })],
    },
    'signal-ui': {
      hover: [variant(['electronic0', 'electronic', 'electronic4'], 0.16, { duration: 0.04, filter: 1800 })],
      press: [variant(['electronic2', 'electronic10', 'mechanical'], 0.25, { duration: 0.075, filter: 1400 })],
      select: [variant(['electronic2', 'electronic10', 'retroNeutral1'], 0.24, { rate: 1.08 }), variant(['retroHigh', 'retroHigh1', 'retroHigh6'], 0.09, { delay: 0.025, duration: 0.07 })],
      open: [variant(['slide', 'slide2', 'slide3'], 0.24, { duration: 0.18, filter: 1200 })],
      close: [variant(['slide', 'slide2', 'slide3'], 0.2, { rate: 0.82, duration: 0.15, filter: 900 })],
      toggle: [variant(['electronic', 'electronic4', 'electronic10'], 0.2, { rate: 0.94 })],
      adjust: [variant(['electronic0', 'electronic', 'electronic4'], 0.11, { duration: 0.028, rate: 1.2 })],
      swipe: [variant(['slide', 'slide2', 'slideSharp'], 0.24, { duration: 0.2 })],
    },
    'terminal-metal': {
      hover: [variant(['metal', 'smallMetal', 'beltHandle'], 0.12, { duration: 0.045, rate: 0.72, filter: 700 })],
      press: [variant(['metal', 'latch', 'metalPot'], 0.28, { rate: 0.78, filter: 620 })],
      select: [variant(['latch', 'smallMetal', 'beltHandle'], 0.24, { rate: 0.78, filter: 560 })],
      open: [variant(['latch', 'doorOpen'], 0.26, { rate: 0.72, filter: 520 })],
      close: [variant(['metal', 'doorClose'], 0.24, { rate: 0.64, filter: 460 })],
      toggle: [variant(['latch', 'metal', 'smallMetal'], 0.22, { rate: 0.82 })],
      adjust: [variant(['metal', 'smallMetal'], 0.11, { duration: 0.032, rate: 0.86 })],
      swipe: [variant(['latch', 'beltHandle'], 0.24, { rate: 0.7 })],
    },
    'tactical-clicks': {
      hover: [variant(['mechanical', 'mechanical2', 'electronic0'], 0.13, { duration: 0.036, rate: 1.12, filter: 1100 })],
      press: [variant(['mechanical', 'mechanical2', 'heavy'], 0.27, { duration: 0.075, filter: 900 })],
      select: [variant(['electronic', 'electronic4', 'electronic10'], 0.2, { duration: 0.07, rate: 0.96 }), variant(['mechanical', 'mechanical2'], 0.14, { delay: 0.018, duration: 0.055 })],
      open: [variant(['slide', 'slide2', 'slideSharp'], 0.22, { duration: 0.15, rate: 1.04 })],
      close: [variant(['slide', 'slide3', 'slideSharp'], 0.18, { duration: 0.14, rate: 0.88 })],
      toggle: [variant(['mechanical', 'mechanical2', 'standard'], 0.22, { rate: 1.08 })],
      adjust: [variant(['electronic0', 'electronic', 'electronic4'], 0.1, { duration: 0.026, rate: 1.18 })],
      swipe: [variant(['slide', 'slide2', 'slideSharp'], 0.22, { duration: 0.18 })],
    },
    'retro-menu': {
      hover: [variant(['retroMove', 'retroMove2', 'retroMove3', 'retroMove4'], 0.22, { duration: 0.035 })],
      press: [variant(['retroButton1', 'retroButton2', 'retroButton', 'retroButton8', 'rpgInterface1', 'rpgInterface2'], 0.28, { duration: 0.09 })],
      select: [variant(['retroSelect', 'retroSelectB', 'retroSelect2', 'retroSelect4', 'rpgInterface3'], 0.34, { duration: 0.13 })],
      open: [variant(['retroPortal', 'retroPortal4', 'rpgInterface6'], 0.2, { duration: 0.22 })],
      close: [variant(['retroSelect2', 'retroSelect4', 'rpgInterface4'], 0.26, { rate: 0.82, duration: 0.15 })],
      toggle: [variant(['retroBlip1', 'retroBlip', 'retroBlip5', 'rpgInterface5'], 0.26, { rate: 1.15 })],
      adjust: [variant(['retroMove2', 'retroMove3', 'retroMove4'], 0.16, { duration: 0.026 })],
      swipe: [variant(['retroPortal', 'retroPortal4'], 0.22, { duration: 0.24 })],
    },
    'arcade-pop': {
      hover: [variant(['retroBlip1', 'retroBlip', 'retroBlip5', 'electronic0'], 0.18, { duration: 0.03, rate: 1.18 })],
      press: [variant(['electronic2', 'electronic10', 'standard2'], 0.24, { duration: 0.065, rate: 1.16 }), variant(['retroButton1', 'retroButton', 'retroButton8'], 0.13, { delay: 0.02, duration: 0.07 })],
      select: [variant(['retroPower1', 'retroPower', 'retroPower8'], 0.26, { duration: 0.14, rate: 1.08 })],
      open: [variant(['slide', 'slide2', 'slideSharp'], 0.25, { duration: 0.17, rate: 1.12 })],
      close: [variant(['retroSelectB', 'retroSelect2', 'retroSelect4'], 0.21, { duration: 0.14, rate: 0.9 })],
      toggle: [variant(['electronic', 'electronic4', 'electronic10'], 0.22, { rate: 1.18 })],
      adjust: [variant(['retroMove', 'retroMove2', 'retroMove3'], 0.14, { duration: 0.025, rate: 1.2 })],
      swipe: [variant(['slide', 'slide2', 'slideSharp'], 0.24, { duration: 0.18, rate: 1.15 })],
    },
    'severe-clicks': {
      hover: [variant(['metal', 'smallMetal'], 0.08, { duration: 0.035, rate: 0.68, filter: 520 })],
      press: [variant(['metal', 'latch', 'smallMetal'], 0.2, { duration: 0.07, rate: 0.72, filter: 470 })],
      select: [variant(['latch', 'metalPot'], 0.18, { duration: 0.1, rate: 0.68, filter: 420 })],
      open: [variant(['latch', 'doorOpen'], 0.16, { duration: 0.13, rate: 0.64, filter: 380 })],
      close: [variant(['metal', 'doorClose'], 0.2, { duration: 0.085, rate: 0.58, filter: 360 })],
      toggle: [variant(['metal', 'smallMetal'], 0.17, { rate: 0.7 })],
      adjust: [variant(['metal', 'smallMetal'], 0.08, { duration: 0.028, rate: 0.74 })],
      swipe: [variant(['latch', 'beltHandle'], 0.14, { rate: 0.62 })],
    },
    'glass-ui': {
      hover: [variant(['soft', 'soft2', 'bubble'], 0.12, { duration: 0.035, rate: 1.28, filter: 2400 })],
      press: [variant(['electronic', 'electronic4', 'bubble2'], 0.18, { duration: 0.065, rate: 1.22, filter: 2100 })],
      select: [variant(['electronic2', 'electronic10', 'bubble'], 0.18, { duration: 0.08, rate: 1.26, filter: 2300 })],
      open: [variant(['slideSoft', 'slide2'], 0.18, { duration: 0.17, rate: 1.18, filter: 1800 })],
      close: [variant(['slideSoft', 'slide3'], 0.15, { duration: 0.14, rate: 0.98, filter: 1500 })],
      toggle: [variant(['soft', 'soft2', 'bubble2'], 0.16, { rate: 1.32 })],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.08, { duration: 0.024, rate: 1.36 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.18, { duration: 0.19, rate: 1.14 })],
    },
    'paper-dossier': {
      hover: [variant(['cloth', 'cloth2', 'cloth3'], 0.1, { duration: 0.055, rate: 1.05, filter: 900 })],
      press: [variant(['bookFlip', 'bookFlip2', 'bookFlip3', 'wood'], 0.22, { duration: 0.1, filter: 760 })],
      select: [variant(['bookFlip', 'bookFlip2', 'bookFlip3'], 0.2, { rate: 0.94, filter: 720 })],
      open: [variant(['bookOpen', 'doorOpen'], 0.24, { duration: 0.16, filter: 650 })],
      close: [variant(['bookClose', 'doorClose'], 0.24, { duration: 0.15, filter: 620 })],
      toggle: [variant(['coins', 'coins2', 'rpgCoin'], 0.16, { duration: 0.1, filter: 1100 })],
      adjust: [variant(['cloth', 'cloth2', 'cloth3'], 0.08, { duration: 0.03, rate: 1.1 })],
      swipe: [variant(['bookFlip', 'bookFlip2', 'bookFlip3'], 0.22, { duration: 0.14 })],
    },
    'orbital-archive': {
      hover: [variant(['electronic0', 'electronic', 'soft'], 0.1, { duration: 0.035, rate: 0.9, filter: 1600 })],
      press: [variant(['electronic2', 'electronic4', 'retroNeutral1'], 0.16, { duration: 0.075, rate: 0.86, filter: 1300 })],
      select: [variant(['retroHigh', 'retroHigh1', 'retroHigh6'], 0.12, { duration: 0.08, rate: 0.78, filter: 1200 })],
      open: [variant(['slide', 'slide2', 'slide3'], 0.18, { duration: 0.2, rate: 0.86, filter: 900 })],
      close: [variant(['slide', 'slide2', 'slide3'], 0.15, { duration: 0.16, rate: 0.74, filter: 800 })],
      toggle: [variant(['electronic', 'electronic4', 'soft'], 0.14, { rate: 0.88 })],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.08, { duration: 0.026, rate: 0.94 })],
      swipe: [variant(['slide', 'slide2', 'slide3'], 0.18, { duration: 0.2, rate: 0.82 })],
    },
    'cold-glass': {
      hover: [variant(['soft', 'soft2', 'bubble'], 0.09, { duration: 0.033, rate: 1.14, filter: 2500 })],
      press: [variant(['standard', 'standard2', 'electronic0'], 0.16, { duration: 0.065, rate: 1.06, filter: 1800 })],
      select: [variant(['electronic', 'electronic4', 'bubble2'], 0.15, { duration: 0.075, rate: 1.05, filter: 2100 })],
      open: [variant(['slideSoft', 'slide2'], 0.16, { duration: 0.18, rate: 0.98, filter: 1500 })],
      close: [variant(['slideSoft', 'slide3'], 0.14, { duration: 0.15, rate: 0.88, filter: 1300 })],
      toggle: [variant(['standard', 'standard2', 'soft'], 0.14, { rate: 1.04 })],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.07, { duration: 0.024, rate: 1.18 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.16, { duration: 0.19 })],
    },
    'damaged-relay': {
      hover: [variant(['metal', 'smallMetal', 'beltHandle'], 0.08, { duration: 0.035, rate: 0.58, filter: 430 })],
      press: [variant(['metal', 'latch', 'metalPot'], 0.17, { duration: 0.07, rate: 0.62, filter: 390 })],
      select: [variant(['latch', 'smallMetal'], 0.16, { duration: 0.1, rate: 0.56, filter: 360 })],
      open: [variant(['latch', 'doorOpen'], 0.16, { duration: 0.13, rate: 0.52, filter: 330 })],
      close: [variant(['metal', 'doorClose'], 0.16, { duration: 0.085, rate: 0.5, filter: 320 })],
      toggle: [variant(['metal', 'smallMetal'], 0.14, { rate: 0.6 })],
      adjust: [variant(['metal', 'smallMetal'], 0.07, { duration: 0.028, rate: 0.64 })],
      swipe: [variant(['latch', 'beltHandle'], 0.14, { rate: 0.54 })],
    },
    'chat-pop': {
      hover: [variant(['soft', 'soft2', 'retroBlip1'], 0.14, { duration: 0.035, rate: 1.16 })],
      press: [variant(['standard', 'standard2', 'retroButton1'], 0.22, { duration: 0.065, rate: 1.12 })],
      select: [variant(['coins', 'coins2', 'rpgCoin'], 0.15, { duration: 0.08, rate: 1.2 }), variant(['retroBlip1', 'retroBlip', 'retroBlip5'], 0.12, { delay: 0.018, duration: 0.04 })],
      open: [variant(['slideSoft', 'slide2'], 0.2, { duration: 0.16, rate: 1.08 })],
      close: [variant(['slideSoft', 'slide3'], 0.16, { duration: 0.13, rate: 0.92 })],
      toggle: [variant(['retroPower1', 'retroPower', 'retroPower8'], 0.14, { duration: 0.12, rate: 1.1 })],
      adjust: [variant(['retroMove', 'retroMove2', 'retroMove3'], 0.12, { duration: 0.026 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.2, { duration: 0.18 })],
    },
    'poster-sticker': {
      hover: [variant(['soft', 'soft2', 'soft3'], 0.16, { duration: 0.036, rate: 1.12 })],
      press: [variant(['standard', 'standard2', 'standard3'], 0.24, { duration: 0.07, rate: 1.08 })],
      select: [variant(['coins', 'coins2', 'rpgCoin'], 0.16, { duration: 0.1, rate: 1.14 })],
      open: [variant(['slideSoft', 'slide2'], 0.2, { duration: 0.16, rate: 1.05 })],
      close: [variant(['slideSoft', 'slide3'], 0.17, { duration: 0.13, rate: 0.94 })],
      toggle: [variant(['standard', 'standard2', 'standard3'], 0.2, { rate: 1.12 })],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.1, { duration: 0.024, rate: 1.2 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.2, { duration: 0.18 })],
    },
    'petal-chimes': {
      hover: [variant(['soft', 'soft2', 'bubble'], 0.09, { duration: 0.034, rate: 1.34, filter: 2600 })],
      press: [variant(['soft2', 'bubble2', 'standard'], 0.15, { duration: 0.07, rate: 1.22, filter: 2200 })],
      select: [variant(['bubble', 'bubble2', 'rpgCoin'], 0.15, { duration: 0.095, rate: 1.18, filter: 2400 }), variant(['soft', 'soft3'], 0.08, { delay: 0.028, duration: 0.05, rate: 1.42 })],
      open: [variant(['slideSoft', 'slide2'], 0.16, { duration: 0.19, rate: 1.08, filter: 1700 })],
      close: [variant(['slideSoft', 'slide3'], 0.13, { duration: 0.15, rate: 0.88, filter: 1400 })],
      toggle: [variant(['soft', 'bubble2', 'standard2'], 0.14, { rate: 1.24, filter: 2300 })],
      adjust: [variant(['soft', 'soft2', 'soft3'], 0.07, { duration: 0.024, rate: 1.3 })],
      swipe: [variant(['slideSoft', 'slide2'], 0.16, { duration: 0.2, rate: 1.04 })],
    },
    'editor-tools': {
      hover: [variant(['soft', 'soft2', 'electronic0'], 0.12, { duration: 0.033, rate: 1.18 })],
      press: [variant(['mechanical', 'mechanical2', 'standard'], 0.22, { duration: 0.07, rate: 1.08 })],
      select: [variant(['electronic', 'electronic4', 'electronic10'], 0.18, { duration: 0.07, rate: 1.1 })],
      open: [variant(['slide', 'slide2', 'slideSharp'], 0.2, { duration: 0.15, rate: 1.05 })],
      close: [variant(['slideSoft', 'slide3'], 0.16, { duration: 0.13, rate: 0.9 })],
      toggle: [variant(['mechanical', 'mechanical2', 'standard2'], 0.18, { rate: 1.12 })],
      adjust: [variant(['electronic0', 'electronic', 'electronic4'], 0.1, { duration: 0.024, rate: 1.18 })],
      swipe: [variant(['slide', 'slide2', 'slideSharp'], 0.2, { duration: 0.18 })],
    },
  };

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

  function normalizeSettings(settings = {}) {
    const mode = MODES.has(settings.mode) ? settings.mode : DEFAULT_SETTINGS.mode;
    return { mode, volume: clamp(settings.volume ?? DEFAULT_SETTINGS.volume, 0, 1) };
  }

  function cueLayers(type, mode) {
    const expressive = mode === 'expressive';
    const cues = {
      hover: [{ start: 760, end: 920, duration: 0.032, gain: 0.34 }],
      press: [{ start: 480, end: 220, duration: 0.045, gain: 0.5 }, { start: 1120, end: 760, duration: 0.022, gain: 0.22 }],
      select: [{ start: 460, end: 700, duration: 0.055, gain: 0.42 }, { start: 760, end: 1040, duration: 0.07, gain: 0.25, delay: 0.035 }],
      open: [{ start: 300, end: 620, duration: 0.09, gain: 0.42 }, { start: 620, end: 1080, duration: 0.13, gain: 0.22, delay: 0.035 }],
      close: [{ start: 660, end: 320, duration: 0.095, gain: 0.4 }, { start: 260, end: 190, duration: 0.09, gain: 0.2, delay: 0.035 }],
      toggle: [{ start: 360, end: 560, duration: 0.045, gain: 0.36 }, { start: 560, end: 360, duration: 0.045, gain: 0.24, delay: 0.04 }],
      adjust: [{ start: 520, end: 520, duration: 0.026, gain: 0.28 }],
      swipe: [{ start: 260, end: 740, duration: 0.12, gain: 0.28 }, { kind: 'noise', start: 900, end: 2400, duration: 0.105, gain: 0.13 }],
    };
    const layers = cues[type] || cues.press;
    if (!expressive || type === 'hover' || type === 'adjust') return layers;
    return [...layers, { start: 1320, end: type === 'close' ? 900 : 1680, duration: 0.052, gain: 0.12, delay: 0.018 }];
  }

  function defaultClassifier(target) {
    if (target.matches('input[type="range"], input[type="color"], .panel-resizer')) return 'adjust';
    if (target.matches('input[type="checkbox"], select')) return 'toggle';
    if (target.closest(CLOSE_SELECTOR)) return 'close';
    if (target.closest(OPEN_SELECTOR)) return 'open';
    if (target.closest(SELECT_SELECTOR)) return 'select';
    return 'press';
  }

  function createPixelodyUiSounds(initial = {}) {
    const state = {
      settings: normalizeSettings(initial.settings || initial),
      theme: initial.theme || 'studio',
      performanceMode: initial.performanceMode || 'full',
      outputId: initial.outputId || '',
      playing: Boolean(initial.playing),
      context: null,
      master: null,
      limiter: null,
      noiseBuffer: null,
      routedSinkId: null,
      lastByKey: new Map(),
      lastByType: new Map(),
      sampleBuffers: new Map(),
      sampleLoads: new Map(),
      hoverTimer: null,
      hoverTarget: null,
      hoverSerial: 0,
      lastCue: '',
      lastError: '',
    };

    function profile() {
      return THEME_PROFILES[state.theme] || THEME_PROFILES.studio;
    }

    function enabled() {
      return Boolean(state.settings.mode !== 'off' && state.settings.volume > 0);
    }

    function masterLevel() {
      const modeScale = state.settings.mode === 'expressive' ? 0.2 : 0.13;
      const playingScale = state.playing ? 0.72 : 1;
      const performanceScale = state.performanceMode === 'conserve' ? 0.7 : 1;
      return clamp(state.settings.volume, 0, 1) * modeScale * playingScale * performanceScale;
    }

    function ensureContext() {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        state.lastError = 'AudioContext unavailable';
        return null;
      }
      if (state.context) return state.context;
      const context = new AudioCtor({ latencyHint: 'interactive' });
      const master = context.createGain();
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 4;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;
      master.gain.value = masterLevel();
      master.connect(limiter);
      limiter.connect(context.destination);
      state.context = context;
      state.master = master;
      state.limiter = limiter;
      routeOutput();
      return context;
    }

    function updateMaster() {
      if (!state.context || !state.master) return;
      state.master.gain.setTargetAtTime(masterLevel(), state.context.currentTime, 0.008);
    }

    function routeOutput() {
      const context = state.context;
      if (!context || typeof context.setSinkId !== 'function') return;
      const sinkId = state.outputId || '';
      if (state.routedSinkId === sinkId) return;
      context.setSinkId(sinkId).then(() => {
        state.routedSinkId = sinkId;
        state.lastError = '';
      }).catch((error) => {
        state.lastError = error.message || String(error);
      });
    }

    function noiseBuffer(context) {
      if (state.noiseBuffer) return state.noiseBuffer;
      const length = Math.max(1, Math.floor(context.sampleRate * 0.16));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
      state.noiseBuffer = buffer;
      return buffer;
    }

    function envelope(context, time, duration, gain) {
      const node = context.createGain();
      node.gain.setValueAtTime(0.0001, time);
      node.gain.linearRampToValueAtTime(Math.max(0.0001, gain), time + Math.min(0.008, duration * 0.3));
      node.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      return node;
    }

    function scheduleTone(context, layer, time, profileSettings) {
      const duration = Math.max(0.015, layer.duration || 0.05);
      const start = Math.max(24, (layer.start || 440) * profileSettings.pitch);
      const end = Math.max(24, (layer.end || layer.start || 440) * profileSettings.pitch);
      const oscillator = context.createOscillator();
      const gain = envelope(context, time, duration, (layer.gain || 0.3) * profileSettings.tone);
      oscillator.type = layer.wave || profileSettings.wave;
      oscillator.frequency.setValueAtTime(start, time);
      if (Math.abs(start - end) > 1) oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
      oscillator.connect(gain);
      gain.connect(state.master);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.025);
    }

    function scheduleNoise(context, layer, time, profileSettings) {
      const duration = Math.max(0.025, layer.duration || 0.08);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = envelope(context, time, duration, (layer.gain || 0.1) * profileSettings.tone);
      source.buffer = noiseBuffer(context);
      filter.type = 'bandpass';
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(Math.max(80, layer.start || 800), time);
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, layer.end || 2000), time + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(state.master);
      source.start(time);
      source.stop(time + duration + 0.02);
    }

    function loadSample(context, name) {
      const source = SAMPLES[name];
      if (!source) return null;
      if (state.sampleBuffers.has(source)) return state.sampleBuffers.get(source);
      if (state.sampleLoads.has(source)) return null;
      const load = fetch(source)
        .then((response) => {
          if (!response.ok) throw new Error(`Unable to load ${source}`);
          return response.arrayBuffer();
        })
        .then((buffer) => context.decodeAudioData(buffer))
        .then((buffer) => {
          state.sampleBuffers.set(source, buffer);
          state.sampleLoads.delete(source);
          state.lastError = '';
          return buffer;
        })
        .catch((error) => {
          state.sampleLoads.delete(source);
          state.lastError = error.message || String(error);
          return null;
        });
      state.sampleLoads.set(source, load);
      return null;
    }

    function scheduleSample(context, sampleCue, time, profileSettings) {
      const sampleName = Array.isArray(sampleCue.samples) && sampleCue.samples.length
        ? sampleCue.samples[Math.floor(Math.random() * sampleCue.samples.length)]
        : sampleCue.sample;
      const buffer = loadSample(context, sampleName);
      if (!buffer) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      const duration = Math.min(buffer.duration, Math.max(0.015, sampleCue.duration || buffer.duration));
      const level = (sampleCue.gain || 0.2) * profileSettings.tone;
      const attack = Math.min(0.01, duration * 0.25);
      const releaseStart = Math.max(attack, duration - Math.min(0.035, duration * 0.45));
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(Math.max(0.2, sampleCue.rate || 1), time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, level), time + attack);
      gain.gain.setValueAtTime(Math.max(0.0001, level), time + releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      if (sampleCue.filter) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.max(80, sampleCue.filter), time);
        filter.Q.value = 0.7;
        source.connect(filter);
        filter.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(state.master);
      source.start(time, sampleCue.offset || 0, duration);
      source.stop(time + duration + 0.02);
    }

    function scheduleSamples(context, type, startTime, profileSettings) {
      const sampleProfile = SAMPLE_PROFILES[profileSettings.samples];
      const samples = sampleProfile?.[type];
      if (!samples || state.performanceMode === 'conserve') return;
      const modeScale = state.settings.mode === 'expressive' ? 1 : 0.72;
      samples.forEach((sampleCue) => {
        scheduleSample(context, { ...sampleCue, gain: sampleCue.gain * modeScale }, startTime + (sampleCue.delay || 0), profileSettings);
      });
    }

    function schedule(type) {
      const context = state.context;
      if (!context || !state.master) return;
      updateMaster();
      const profileSettings = profile();
      const startTime = context.currentTime + 0.006;
      scheduleSamples(context, type, startTime, profileSettings);
      cueLayers(type, state.settings.mode).forEach((layer) => {
        const time = startTime + (layer.delay || 0);
        if (layer.kind === 'noise') scheduleNoise(context, layer, time, profileSettings);
        else scheduleTone(context, layer, time, profileSettings);
      });
      state.lastCue = type;
    }

    function play(type = 'press', options = {}) {
      if (!enabled(options)) return false;
      const context = ensureContext();
      if (!context) return false;
      const key = options.key || type;
      const now = performance.now();
      const interval = options.minInterval ?? INTERVALS[type] ?? 60;
      if (!options.force && now - (state.lastByKey.get(key) || 0) < interval) return false;
      if (type === 'hover' && !options.force) {
        const globalInterval = options.globalInterval ?? HOVER_GOVERNOR.globalInterval;
        if (now - (state.lastByType.get(type) || 0) < globalInterval) return false;
        state.lastByType.set(type, now);
      }
      state.lastByKey.set(key, now);
      routeOutput();
      if (context.state === 'suspended') {
        context.resume().then(() => schedule(type)).catch((error) => {
          state.lastError = error.message || String(error);
        });
      } else {
        schedule(type);
      }
      return true;
    }

    function configure(next = {}) {
      if (next.settings) state.settings = normalizeSettings(next.settings);
      if (next.theme) state.theme = next.theme;
      if (next.performanceMode) state.performanceMode = next.performanceMode;
      if (Object.prototype.hasOwnProperty.call(next, 'outputId')) state.outputId = next.outputId || '';
      if (Object.prototype.hasOwnProperty.call(next, 'playing')) state.playing = Boolean(next.playing);
      updateMaster();
      routeOutput();
    }

    function targetFromEvent(event, selector) {
      const target = event.target?.closest?.(selector || INTERACTIVE_SELECTOR);
      if (!target || target.matches('[disabled], [aria-disabled="true"]') || target.closest('[disabled], [aria-disabled="true"]')) return null;
      if (target.closest('[data-ui-sound-control]')) return null;
      return target;
    }

    function hoverGroupFor(target) {
      if (target.dataset?.uiSoundHoverGroup) return target.dataset.uiSoundHoverGroup;
      const group = HOVER_GROUP_SELECTORS.find(([, groupSelector]) => target.closest(groupSelector));
      return group ? group[0] : '';
    }

    function clearHoverTimer() {
      if (state.hoverTimer) window.clearTimeout(state.hoverTimer);
      state.hoverTimer = null;
      state.hoverTarget = null;
    }

    function scheduleHover(target) {
      clearHoverTimer();
      const serial = state.hoverSerial + 1;
      const group = hoverGroupFor(target);
      state.hoverSerial = serial;
      state.hoverTarget = target;
      state.hoverTimer = window.setTimeout(() => {
        if (serial !== state.hoverSerial || state.hoverTarget !== target) return;
        clearHoverTimer();
        if (!target.isConnected || !target.matches(':hover')) return;
        play('hover', {
          key: group ? `hover-group:${group}` : target,
          minInterval: group ? HOVER_GOVERNOR.groupedInterval : INTERVALS.hover,
          globalInterval: HOVER_GOVERNOR.globalInterval,
        });
      }, HOVER_GOVERNOR.dwell);
    }

    function install(root = document, options = {}) {
      const selector = options.selector || INTERACTIVE_SELECTOR;
      const classify = options.classify || defaultClassifier;
      root.addEventListener('pointerover', (event) => {
        if (event.pointerType === 'touch') return;
        const target = targetFromEvent(event, selector);
        if (!target || target.contains(event.relatedTarget)) return;
        scheduleHover(target);
      }, true);
      root.addEventListener('pointerout', (event) => {
        if (event.pointerType === 'touch') return;
        const target = targetFromEvent(event, selector);
        if (!target || target !== state.hoverTarget || target.contains(event.relatedTarget)) return;
        clearHoverTimer();
      }, true);
      root.addEventListener('pointerdown', (event) => {
        if (event.button && event.button !== 0) return;
        const target = targetFromEvent(event, selector);
        if (!target) return;
        clearHoverTimer();
        play(classify(target, event), { key: target });
      }, true);
      root.addEventListener('input', (event) => {
        const target = targetFromEvent(event, selector);
        if (!target?.matches?.('input[type="range"], input[type="color"]')) return;
        play('adjust', { key: target, minInterval: INTERVALS.adjust });
      }, true);
      root.addEventListener('change', (event) => {
        const target = targetFromEvent(event, selector);
        if (!target?.matches?.('input[type="checkbox"], select')) return;
        play('toggle', { key: target, minInterval: INTERVALS.toggle });
      }, true);
      root.addEventListener('keydown', (event) => {
        if (event.repeat || !['Enter', ' '].includes(event.key)) return;
        const target = targetFromEvent(event, selector);
        if (!target) return;
        if (target.matches('input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="password"]')) return;
        play(classify(target, event), { key: target });
      }, true);
    }

    function status() {
      return {
        mode: state.settings.mode,
        volume: state.settings.volume,
        contextState: state.context?.state || 'uninitialized',
        outputId: state.outputId || 'default',
        outputRouting: state.context && typeof state.context.setSinkId === 'function' ? (state.routedSinkId || 'pending') : 'default-only',
        lastCue: state.lastCue || null,
        error: state.lastError || null,
      };
    }

    return { configure, install, play, routeOutput, status };
  }

  window.createPixelodyUiSounds = createPixelodyUiSounds;
  window.pixelodyUiSoundDefaults = DEFAULT_SETTINGS;
})();
