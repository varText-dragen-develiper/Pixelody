const fs = require('fs');
const path = require('path');
const navigationRegistry = require('../src/theme-runtime/navigation/registry');
const { createLinearListMechanic } = require('../src/theme-runtime/navigation/linear-list');
const { createCarouselMechanic } = require('../src/theme-runtime/navigation/carousel');
const { createCoverFlowMechanic } = require('../src/theme-runtime/navigation/cover-flow');
const { createPassDeckMechanic } = require('../src/theme-runtime/navigation/pass-deck');
const { createMemoryCascadeMechanic } = require('../src/theme-runtime/navigation/memory-cascade');
const { createSpectralFieldMechanic } = require('../src/theme-runtime/navigation/spectral-field');
const { createPressureStackMechanic } = require('../src/theme-runtime/navigation/pressure-stack');
const { createCurrentWeaveMechanic } = require('../src/theme-runtime/navigation/current-weave');
const { createChorusFoldMechanic } = require('../src/theme-runtime/navigation/chorus-fold');
const { createGraftlineMechanic } = require('../src/theme-runtime/navigation/graftline');
const { createSharedStrataMechanic } = require('../src/theme-runtime/navigation/shared-strata');
const { extractThemeNavigationMechanics } = require('./lib/theme-navigation-map');
const { extractThemeStylesheetMap } = require('./lib/theme-stylesheet-map');
const { extractThemeInformationProfiles } = require('./lib/theme-information-map');
const informationRegistry = require('../src/theme-runtime/information/registry');
require('../src/theme-runtime/information/bundles');
require('../src/theme-runtime/information/profiles/counterform-choir');
require('../src/theme-runtime/information/profiles/aftergarden');
require('../src/theme-runtime/information/profiles/vesperfold');

// Mirrors what renderer.js registers at app startup (see the
// trackBrowserMechanic/carouselMechanic wiring in src/renderer.js). This
// script never executes renderer.js, so without this the registry would
// look empty and every manifest declaring navigation.trackBrowser would
// fail even for a mechanic that actually exists and is registered.
navigationRegistry.registerMechanic('linear-list', createLinearListMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', isLossless: () => false, isHiRes: () => false, fileUrl: (p) => p },
  tuning: { hasChanges: () => false, default: () => ({}), forTrack: () => undefined },
  isFavorite: () => false,
  metadataGaps: () => [],
  scheduleIdleWork: () => 0,
  cancelIdleWork: () => {},
  recordRenderStats: () => {},
  onTrackTableStreaming: () => {},
  onStreamComplete: () => {},
  getArriveTimer: () => 0,
  setArriveTimer: () => {},
}), { label: 'Linear List' });
navigationRegistry.registerMechanic('carousel', createCarouselMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Carousel' });
navigationRegistry.registerMechanic('cover-flow', createCoverFlowMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Cover Flow' });
navigationRegistry.registerMechanic('pass-deck', createPassDeckMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Pass Deck' });
navigationRegistry.registerMechanic('memory-cascade', createMemoryCascadeMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Memory Cascade' });
navigationRegistry.registerMechanic('spectral-field', createSpectralFieldMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Spectral Field' });
navigationRegistry.registerMechanic('pressure-stack', createPressureStackMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Pressure Stack' });
navigationRegistry.registerMechanic('current-weave', createCurrentWeaveMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Current Weave' });
navigationRegistry.registerMechanic('chorus-fold', createChorusFoldMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Chorus Fold' });
navigationRegistry.registerMechanic('graftline', createGraftlineMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Graftline' });
navigationRegistry.registerMechanic('shared-strata', createSharedStrataMechanic({
  format: { escapeHtml: (v) => String(v), durationText: () => '', fileUrl: (p) => p },
}), { label: 'Shared Strata' });

const root = path.resolve(__dirname, '..');
const themeDir = path.join(root, 'src', 'themes');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
const fail = (message) => errors.push(message);
const exists = (relative) => fs.existsSync(path.resolve(themeDir, relative));
const hex = /^#[0-9a-f]{6}$/i;

let registry;
try {
  registry = readJson(path.join(themeDir, 'built-in-themes.json'));
} catch (error) {
  console.error(`Theme registry could not be read: ${error.message}`);
  process.exit(1);
}

const index = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const miniIndex = fs.readFileSync(path.join(root, 'src', 'mini-player.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const schema = readJson(path.join(themeDir, 'theme.schema.json'));
try { new RegExp(schema.$defs.assetPath.pattern); } catch (error) { fail(`Invalid assetPath schema pattern: ${error.message}`); }

// themeNavigationMechanics in renderer.js is the Phase 2 runtime source of
// truth for mechanic selection (see docs/themes/THEME_RUNTIME_ARCHITECTURE.md
// -- the app has no runtime path to *.theme.json yet). extraction is a
// lightweight textual regex, not a real JS parse (renderer.js is a browser
// script that references `window`/`document` at load time and cannot be
// require()'d in Node) -- see scripts/lib/theme-navigation-map.js and its
// test (scripts/check-theme-navigation-map.js) for what it does and does
// not handle.
const themeNavigationMechanics = extractThemeNavigationMechanics(renderer);
if (!themeNavigationMechanics) fail('themeNavigationMechanics map not found in renderer.js (expected by the Phase 2 navigation dispatcher wiring)');
const themeInformationProfiles = extractThemeInformationProfiles(renderer);
if (!themeInformationProfiles) fail('themeInformationProfiles map not found in renderer.js (expected by the information bundle runtime)');

// themeStylesheets in renderer.js is the Phase 4 runtime source of truth
// for which per-theme <link> elements theme-runtime/css-loader.js enables
// (see docs/themes/THEME_RUNTIME_ARCHITECTURE.md's Phase 4 section) -- same
// "no runtime path to built-in-themes.json" gap as Phase 2, so it's a
// static map mirroring built-in-themes.json's mainStyles, checked here for
// real agreement rather than by hand.
const themeStylesheets = extractThemeStylesheetMap(renderer);
if (!themeStylesheets) fail('themeStylesheets map not found in renderer.js (expected by the Phase 4 CSS loader wiring)');

const runtimeKeys = new Set();
const manifestIds = new Set();
for (const theme of registry.themes || []) {
  const label = theme.name || theme.runtimeKey || 'unnamed theme';
  if (!theme.runtimeKey || runtimeKeys.has(theme.runtimeKey)) fail(`${label}: missing or duplicate runtimeKey`);
  runtimeKeys.add(theme.runtimeKey);

  const selectorCount = (index.match(new RegExp(`data-theme-option="${theme.runtimeKey}"`, 'g')) || []).length;
  if (selectorCount !== 1) fail(`${label}: expected one selector card, found ${selectorCount}`);
  if (!renderer.includes(theme.paletteKey)) fail(`${label}: paletteKey ${theme.paletteKey} not found in renderer.js`);
  if (theme.runtimeKey !== 'studio' && !renderer.includes(`'${theme.runtimeKey}'`)) fail(`${label}: runtime key is not registered in selectTheme()`);

  for (const file of [...(theme.mainStyles || []), ...(theme.miniStyles || [])]) {
    if (!exists(file)) fail(`${label}: implementation file does not exist: ${file}`);
  }
  for (const file of theme.mainStyles || []) {
    const name = path.basename(file);
    if (!index.includes(`href="${name}"`)) fail(`${label}: main stylesheet is not linked in index.html: ${name}`);
  }

  // themeStylesheets in renderer.js (currently unused reference data -- see
  // its comment in renderer.js and docs/themes/THEME_RUNTIME_ARCHITECTURE.md's
  // Phase 4 section for why the live cutover that used to read it was
  // reverted) must still exactly agree, as a set, with built-in-themes.json's
  // mainStyles for this theme, so it doesn't quietly go stale before
  // whatever eventually replaces it gets built. Studio is the one
  // deliberate exception: its mainStyles ARE the always-on shared files
  // (styles.css/precision-pixel.css), so it must have no entry here.
  if (theme.runtimeKey === 'studio') {
    if (themeStylesheets && themeStylesheets.studio) fail(`${label}: themeStylesheets must not have a "studio" entry -- studio needs no per-theme file beyond the shared baseline`);
  } else if (themeStylesheets) {
    const expected = (theme.mainStyles || []).map((file) => path.basename(file)).sort();
    const actual = (themeStylesheets[theme.runtimeKey] || []).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      fail(`${label}: renderer.js themeStylesheets["${theme.runtimeKey}"] is ${JSON.stringify(actual)} but built-in-themes.json mainStyles say ${JSON.stringify(expected)}`);
    }
  }
  for (const file of theme.miniStyles || []) {
    const name = path.basename(file);
    if (!miniIndex.includes(`href="${name}"`)) fail(`${label}: mini stylesheet is not linked in mini-player.html: ${name}`);
  }
  if (theme.runtimeKey !== 'studio') {
    const mainCss = (theme.mainStyles || []).filter(exists).map((file) => fs.readFileSync(path.resolve(themeDir, file), 'utf8')).join('\n');
    const miniCss = (theme.miniStyles || []).filter(exists).map((file) => fs.readFileSync(path.resolve(themeDir, file), 'utf8')).join('\n');
    if (!mainCss.includes(`data-theme="${theme.runtimeKey}"`)) fail(`${label}: main styles do not contain a scoped theme selector`);
    if (!miniCss.includes(`data-theme="${theme.runtimeKey}"`)) fail(`${label}: mini styles do not contain a scoped theme selector`);
  }
  if (!theme.manifest || !exists(theme.manifest)) { fail(`${label}: manifest does not exist: ${theme.manifest}`); continue; }

  let manifest;
  try { manifest = readJson(path.resolve(themeDir, theme.manifest)); } catch (error) { fail(`${label}: invalid manifest JSON: ${error.message}`); continue; }
  if (manifest.schemaVersion !== 1) fail(`${label}: schemaVersion must be 1`);
  if (manifest.name !== theme.name) fail(`${label}: registry and manifest names differ`);
  if (!manifest.id || manifestIds.has(manifest.id)) fail(`${label}: missing or duplicate manifest id`);
  manifestIds.add(manifest.id);
  for (const key of ['name', 'author', 'palette', 'assets', 'hud', 'typography', 'motion']) if (manifest[key] === undefined) fail(`${label}: manifest missing ${key}`);
  if (manifest.palette && !manifest.palette.builtIn) {
    for (const key of ['primary', 'secondary', 'base']) if (!hex.test(manifest.palette[key] || '')) fail(`${label}: palette.${key} must be a six-digit hex color`);
  }
  for (const [key, asset] of Object.entries(manifest.assets || {})) if (asset && !exists(asset)) fail(`${label}: assets.${key} does not exist: ${asset}`);
  if (manifest.typography?.font && !exists(manifest.typography.font)) fail(`${label}: typography font does not exist: ${manifest.typography.font}`);

  // Navigation mechanics (src/theme-runtime/navigation/) are validated
  // against the live registry, not a fixed schema enum -- the registry is
  // the authoritative list of what's actually built. The registrations
  // above mirror the browser startup registry so manifests fail here if
  // they reference a mechanic that cannot actually mount at runtime.
  if (manifest.navigation) {
    for (const slot of ['trackBrowser', 'playlistBrowser']) {
      const mechanicKey = manifest.navigation[slot];
      if (mechanicKey && !navigationRegistry.hasMechanic(mechanicKey)) {
        fail(`${label}: navigation.${slot} references unregistered mechanic "${mechanicKey}"`);
      }
    }
    // renderer.js's themeNavigationMechanics map (Phase 2's runtime stand-in
    // for manifest reads -- see the comment above it) only drives
    // trackBrowser today. If a manifest declares trackBrowser, the map must
    // agree, or the documented intent and the actual running behavior have
    // silently drifted apart.
    if (themeNavigationMechanics && manifest.navigation.trackBrowser) {
      const runtimeValue = themeNavigationMechanics[theme.runtimeKey];
      if (runtimeValue !== manifest.navigation.trackBrowser) {
        fail(`${label}: manifest declares navigation.trackBrowser "${manifest.navigation.trackBrowser}" but renderer.js's themeNavigationMechanics has "${runtimeValue || '(not set, defaults to linear-list)'}"`);
      }
    }
  }
  if (manifest.information?.profile) {
    const profileKey = manifest.information.profile;
    if (!informationRegistry.hasProfile(profileKey)) fail(`${label}: information.profile references unregistered profile "${profileKey}"`);
    if (themeInformationProfiles && themeInformationProfiles[theme.runtimeKey] !== profileKey) {
      fail(`${label}: manifest declares information.profile "${profileKey}" but renderer.js's themeInformationProfiles has "${themeInformationProfiles[theme.runtimeKey] || '(not set)'}"`);
    }
  } else if (themeInformationProfiles?.[theme.runtimeKey]) {
    fail(`${label}: renderer.js maps information profile "${themeInformationProfiles[theme.runtimeKey]}" but the manifest does not declare information.profile`);
  }
}

if (errors.length) {
  console.error(`Theme audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`Theme audit passed: ${registry.themes.length} built-in themes are fully mapped.`);
