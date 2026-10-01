const assert = require('node:assert/strict');

const { extractThemeStylesheetMap } = require('./lib/theme-stylesheet-map');

async function run() {
  assert.deepEqual(extractThemeStylesheetMap('const themeStylesheets = {};'), {}, 'empty single-line map must extract to an empty object, not null');

  const single = extractThemeStylesheetMap(`const themeStylesheets = {\n  orbital: ['retro-future-theme.css'],\n};`);
  assert.deepEqual(single, { orbital: ['retro-future-theme.css'] });

  const multi = extractThemeStylesheetMap(`const themeStylesheets = {
    orbital: ['retro-future-theme.css'],
    'cosmic-cinema': ['poster-themes.css', 'cosmic-observatory.css'],
    bulkhead: ["bulkhead-terminal-theme.css"],
  };`);
  assert.deepEqual(multi, {
    orbital: ['retro-future-theme.css'],
    'cosmic-cinema': ['poster-themes.css', 'cosmic-observatory.css'],
    bulkhead: ['bulkhead-terminal-theme.css'],
  });

  // Must not over-match into a subsequent unrelated const statement.
  const realistic = extractThemeStylesheetMap(`
const themeNavigationMechanics = {
  'cartridge-quest': 'carousel',
};
const themeStylesheets = {
  'cartridge-quest': ['cartridge-quest.css'],
  'cosmic-cinema': ['poster-themes.css', 'cosmic-observatory.css'],
};
const THEME_LOAD_FULL_MS = 2400;
`);
  assert.deepEqual(realistic, {
    'cartridge-quest': ['cartridge-quest.css'],
    'cosmic-cinema': ['poster-themes.css', 'cosmic-observatory.css'],
  });

  assert.equal(extractThemeStylesheetMap('const somethingElse = {};'), null, 'missing map entirely must return null, not an empty object, so callers can tell "not found" apart from "found but empty"');

  console.log('theme-stylesheet-map extractor audit passed: single/multi/quoted/adjacent-const/missing cases all handled correctly.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
