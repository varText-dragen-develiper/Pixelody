(function pixelodyThemeGlyphFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyThemeGlyph = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createThemeGlyphModule() {
  'use strict';

  const GLYPH_VARIANT_COUNT = 6;
  const GLYPH_ROTATION_COUNT = 4;
  const GLYPH_EDITION_COUNT = 6;

  function hashString(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= text.length;
    return hash >>> 0;
  }

  function describe(seed) {
    const primary = hashString(seed);
    const secondary = hashString(`${String(seed ?? '')}\u241fpixelody-proof`);
    return Object.freeze({
      variant: primary % GLYPH_VARIANT_COUNT,
      rotation: (primary >>> 9) % GLYPH_ROTATION_COUNT,
      edition: secondary % GLYPH_EDITION_COUNT,
    });
  }

  return Object.freeze({
    describe,
    hashString,
    counts: Object.freeze({
      variants: GLYPH_VARIANT_COUNT,
      rotations: GLYPH_ROTATION_COUNT,
      editions: GLYPH_EDITION_COUNT,
    }),
  });
}));
