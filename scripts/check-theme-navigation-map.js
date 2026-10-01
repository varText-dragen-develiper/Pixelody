const assert = require('node:assert/strict');

const { extractThemeNavigationMechanics } = require('./lib/theme-navigation-map');

async function run() {
  // The actual shape shipped in renderer.js today: empty, single line.
  // (An earlier version of this regex required a newline before the
  // closing brace and silently failed to match this exact case -- this is
  // the regression test for that.)
  assert.deepEqual(extractThemeNavigationMechanics('const themeNavigationMechanics = {};'), {});

  // Populated, multi-line -- the shape Phase 3 will actually produce.
  const populated = `const themeNavigationMechanics = {
  'cartridge-quest': 'carousel',
  'sakura-bloom': 'carousel',
};`;
  assert.deepEqual(extractThemeNavigationMechanics(populated), { 'cartridge-quest': 'carousel', 'sakura-bloom': 'carousel' });

  // Unquoted keys must also be recognized (valid JS object-literal syntax).
  const unquoted = `const themeNavigationMechanics = {
  studio: 'linear-list',
};`;
  assert.deepEqual(extractThemeNavigationMechanics(unquoted), { studio: 'linear-list' });

  // A full, realistic renderer.js excerpt -- confirms the regex doesn't
  // over-match into surrounding code (e.g. the very next `const` statement).
  const excerpt = `const alternateThemes = ['orbital', 'bulkhead'];
const themeNavigationMechanics = {
  'cartridge-quest': 'carousel',
};
const somethingElseEntirely = { unrelated: 'value' };`;
  assert.deepEqual(extractThemeNavigationMechanics(excerpt), { 'cartridge-quest': 'carousel' });

  // Missing entirely -> null (distinct from "present but empty").
  assert.equal(extractThemeNavigationMechanics('const somethingElse = {};'), null);

  console.log('themeNavigationMechanics extraction audit passed: empty, populated, unquoted-key, and missing cases all resolve correctly.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
