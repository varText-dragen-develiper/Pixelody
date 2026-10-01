(function pixelodyTokensFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyTokens = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTokensModule() {
  'use strict';

  // Phase 4 of docs/themes/THEME_RUNTIME_ARCHITECTURE.md. Carried over from
  // docs/themes/THEME_RUNTIME_ARCHITECTURE.md's "tokens replaces gold/gold2/green/
  // hero/bg/surface*/line/edge with names that mean what they say" plan.
  //
  // This module is forward-looking infrastructure, not yet wired into the
  // live app: applyAppearance() in renderer.js still reads paletteDefinitions
  // entries by their legacy keys directly, and manifest tokens blocks (see
  // theme.schema.json's optional `tokens` property) are not read at runtime
  // for the same reason navigation.trackBrowser isn't (Phase 2's finding --
  // the running app has no runtime path to *.theme.json at all; see the
  // Phase 2 section of the plan doc). What exists here is the tested,
  // correct conversion between the two shapes so that whenever the manifest-
  // reading IPC work lands, this piece doesn't need to be invented then --
  // it can just be called.
  const LEGACY_TO_SEMANTIC = Object.freeze({
    gold: 'accentPrimary',
    gold2: 'accentSecondary',
    green: 'accentState',
    hero: 'heroTone',
    bg: 'canvas',
    surface: 'elevation1',
    surface2: 'elevation2',
    surface3: 'elevation3',
    line: 'divider',
    edge: 'frame',
    text: 'foreground',
    muted: 'foregroundMuted',
  });

  const SEMANTIC_TO_LEGACY = Object.freeze(
    Object.fromEntries(Object.entries(LEGACY_TO_SEMANTIC).map(([legacyKey, semanticKey]) => [semanticKey, legacyKey])),
  );

  // Unknown keys pass through unchanged in both directions rather than
  // being dropped -- a manifest or palette object with an extra/future key
  // shouldn't silently lose data going through this shim.
  function toSemanticTokens(legacyPalette) {
    if (!legacyPalette) return {};
    const semantic = {};
    Object.entries(legacyPalette).forEach(([key, value]) => {
      semantic[LEGACY_TO_SEMANTIC[key] || key] = value;
    });
    return semantic;
  }

  function toLegacyPalette(semanticTokens) {
    if (!semanticTokens) return {};
    const legacy = {};
    Object.entries(semanticTokens).forEach(([key, value]) => {
      legacy[SEMANTIC_TO_LEGACY[key] || key] = value;
    });
    return legacy;
  }

  return Object.freeze({ LEGACY_TO_SEMANTIC, SEMANTIC_TO_LEGACY, toSemanticTokens, toLegacyPalette });
}));
