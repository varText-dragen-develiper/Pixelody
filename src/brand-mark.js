// Pixelody logo colours. The mark's geometry is fixed (docs/brand); only its
// colour changes. On base Pixelody (Studio) the user picks from the purple
// range below. Any other theme may recolour the in-app mark with its own
// accent unless the user turns that off. The window/taskbar and Android
// launcher icons use the purple range; the running desktop window icon can
// follow a validated theme accent through an in-memory tint.
//
// Keep LOGO_COLORS in step with tools/brand/logo-colors.json and
// android .../ui/brand/PixelodyLogoColor.kt; `npm run check` compares them.
(function pixelodyBrandMarkFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyBrandMark = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createBrandMarkApi() {
  'use strict';
  const LOGO_COLORS = Object.freeze([
    Object.freeze({ key: 'ultraviolet', name: 'Ultraviolet', hex: '#6a3dff' }),
    Object.freeze({ key: 'electric', name: 'Electric', hex: '#7c5cff' }),
    Object.freeze({ key: 'indigo', name: 'Indigo', hex: '#5b5bff' }),
    Object.freeze({ key: 'grape', name: 'Grape', hex: '#8a3cf0' }),
    Object.freeze({ key: 'lavender', name: 'Lavender', hex: '#a98cff' }),
  ]);
  const DEFAULT_LOGO_COLOR = LOGO_COLORS[0].key;
  const LOGO_COLOR_KEYS = Object.freeze(LOGO_COLORS.map((color) => color.key));

  function normalizeLogoColor(key) {
    return LOGO_COLOR_KEYS.includes(key) ? key : DEFAULT_LOGO_COLOR;
  }

  function logoColorHex(key) {
    return LOGO_COLORS.find((color) => color.key === normalizeLogoColor(key)).hex;
  }

  // themeAccent is the active theme's primary accent, or '' on base Pixelody.
  function resolveMarkColor({ logoColor, logoFollowsTheme = true, themeAccent = '' } = {}) {
    const validAccent = /^#[0-9a-f]{6}$/i.test(String(themeAccent || ''));
    if (logoFollowsTheme !== false && validAccent) return { hex: themeAccent.toLowerCase(), source: 'theme' };
    return { hex: logoColorHex(logoColor), source: 'logo-color' };
  }

  return Object.freeze({ DEFAULT_LOGO_COLOR, LOGO_COLORS, LOGO_COLOR_KEYS, logoColorHex, normalizeLogoColor, resolveMarkColor });
}));
