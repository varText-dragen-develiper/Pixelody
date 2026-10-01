const assert = require('node:assert/strict');

const { createCssLoader } = require('../src/theme-runtime/css-loader');

function createFakeLinks(fileNames) {
  const links = {};
  fileNames.forEach((fileName) => { links[fileName] = { disabled: true }; });
  return links;
}

function enabledFiles(links) {
  return Object.entries(links).filter(([, link]) => !link.disabled).map(([fileName]) => fileName).sort();
}

async function run() {
  const themeStylesheets = {
    orbital: ['retro-future-theme.css'],
    obsession: ['poster-themes.css'],
    crystal: ['poster-themes.css'],
    'cosmic-cinema': ['poster-themes.css', 'cosmic-observatory.css'],
    'cartridge-quest': ['cartridge-quest.css'],
  };
  const links = createFakeLinks([
    'retro-future-theme.css', 'poster-themes.css', 'cosmic-observatory.css', 'cartridge-quest.css',
  ]);
  const loader = createCssLoader({
    themeStylesheets,
    getStylesheetLink: (fileName) => links[fileName],
  });

  // studio (and any theme with no entry) needs none of the managed files --
  // matches themeNavigationMechanics' convention of omitting default keys.
  loader.applyTheme('studio');
  assert.deepEqual(enabledFiles(links), [], 'studio must not enable any per-theme file');

  loader.applyTheme('orbital');
  assert.deepEqual(enabledFiles(links), ['retro-future-theme.css']);

  // cosmic-cinema needs two files at once.
  loader.applyTheme('cosmic-cinema');
  assert.deepEqual(enabledFiles(links), ['cosmic-observatory.css', 'poster-themes.css']);

  // Switching to a different theme that shares one of those two files must
  // keep the shared file enabled and disable only what's no longer needed.
  loader.applyTheme('obsession');
  assert.deepEqual(enabledFiles(links), ['poster-themes.css'], 'poster-themes.css stays enabled across poster-family themes; cosmic-observatory.css must be disabled once cosmic-cinema is no longer active');

  // Switching between two themes that share a file must never toggle it
  // off then back on -- verify by checking the link object's identity/state
  // never flips to disabled mid-transition (applyTheme is a single pass, so
  // this really just confirms the shared file is never in the "disabled"
  // set for either theme).
  loader.applyTheme('crystal');
  assert.equal(links['poster-themes.css'].disabled, false, 'poster-themes.css must remain enabled moving between two poster-family themes');

  // A theme with an unmanaged/unknown key behaves like studio: nothing
  // enabled, no throw.
  assert.doesNotThrow(() => loader.applyTheme('some-future-theme'));
  loader.applyTheme('some-future-theme');
  assert.deepEqual(enabledFiles(links), [], 'an unrecognized theme key must disable every managed file rather than throw or leave stale state');

  // getStylesheetLink returning null/undefined for a managed file (e.g. the
  // <link> hasn't been added to this particular page) must not throw.
  const loaderWithGaps = createCssLoader({
    themeStylesheets: { orbital: ['retro-future-theme.css', 'missing-file.css'] },
    getStylesheetLink: (fileName) => (fileName === 'missing-file.css' ? null : links[fileName]),
  });
  assert.doesNotThrow(() => loaderWithGaps.applyTheme('orbital'));

  // cartridge-quest back on, to confirm a theme with a single exclusive
  // file still works correctly after all the shared-file cases above.
  loader.applyTheme('cartridge-quest');
  assert.deepEqual(enabledFiles(links), ['cartridge-quest.css']);

  console.log('CSS loader audit passed: per-theme file sets enable/disable correctly, including files shared across multiple themes.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
