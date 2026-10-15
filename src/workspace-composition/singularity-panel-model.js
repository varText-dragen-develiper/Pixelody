(function pixelodySingularityPanelModelFactory(root, factory) {
  const contract = typeof module === 'object' && module.exports ? require('./singularity-contract') : root.PixelodySingularityContract;
  const profile = typeof module === 'object' && module.exports ? require('./singularity-profile') : root.PixelodySingularityProfile;
  const api = factory(contract, profile);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySingularityPanelModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSingularityPanelModelApi(contract, profile) {
  'use strict';

  if (!contract || !profile) throw new Error('Singularity panel model requires its contract and profile.');
  const MODEL_ID = profile.MODEL_ID;
  const TIER_TOKENS = Object.freeze({
    wide: Object.freeze({ perspective: 480, sideTurn: 58, sideSkew: 10, sideShift: 30, sideTaper: 0.72, depthTurn: 52, depthSkew: 7, depthShift: 18, depthTaper: 0.78 }),
    narrow: Object.freeze({ perspective: 430, sideTurn: 56, sideSkew: 9, sideShift: 24, sideTaper: 0.74, depthTurn: 50, depthSkew: 6, depthShift: 16, depthTaper: 0.80 }),
    compact: Object.freeze({ perspective: 390, sideTurn: 48, sideSkew: 7, sideShift: 16, sideTaper: 0.80, depthTurn: 44, depthSkew: 5, depthShift: 12, depthTaper: 0.84 }),
  });

  function dormantTransform(side, tokens) {
    if (side === 'left') return `perspective(${tokens.perspective}px) translate3d(${tokens.sideShift}px,0,-42px) rotateY(${tokens.sideTurn}deg) skewY(-${tokens.sideSkew}deg) scale3d(.98,${tokens.sideTaper},1)`;
    if (side === 'right') return `perspective(${tokens.perspective}px) translate3d(-${tokens.sideShift}px,0,-42px) rotateY(-${tokens.sideTurn}deg) skewY(${tokens.sideSkew}deg) scale3d(.98,${tokens.sideTaper},1)`;
    if (side === 'top') return `perspective(${tokens.perspective}px) translate3d(0,${tokens.depthShift}px,-36px) rotateX(-${tokens.depthTurn}deg) skewX(-${tokens.depthSkew}deg) scale3d(${tokens.depthTaper},.98,1)`;
    return `perspective(${tokens.perspective}px) translate3d(0,-${tokens.depthShift}px,-36px) rotateX(${tokens.depthTurn}deg) skewX(${tokens.depthSkew}deg) scale3d(${tokens.depthTaper},.98,1)`;
  }

  function transformOrigin(side) {
    if (side === 'left') return '100% 50%';
    if (side === 'right') return '0% 50%';
    if (side === 'top') return '50% 100%';
    return '50% 0%';
  }

  function project(id, options = {}) {
    const panel = profile.panel(id);
    if (!panel) throw new Error(`Unknown singularity profile panel: ${id}`);
    const frame = contract.viewport(options.viewport);
    const presentation = options.presentation || contract.initialPresentationState();
    const state = presentation.openId === id ? 'rectified-open' : presentation.previewId === id ? 'rectified-preview' : 'dormant';
    const dormant = state === 'dormant';
    const tokens = TIER_TOKENS[frame.tier];
    return Object.freeze({
      modelId: MODEL_ID,
      profileId: profile.PROFILE_ID,
      panelId: id,
      side: panel.side,
      state,
      wholeSurface: true,
      clipsProductRoot: false,
      transformOrigin: transformOrigin(panel.side),
      transform: dormant ? dormantTransform(panel.side, tokens) : 'none',
      opacity: dormant ? 0.74 : 1,
      filter: dormant ? 'grayscale(.82) contrast(.88) brightness(1.04)' : 'none',
      interactive: state === 'rectified-open',
    });
  }

  return Object.freeze({ MODEL_ID, TIER_TOKENS, dormantTransform, transformOrigin, project });
}));
