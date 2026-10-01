const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('src/index.html');
const renderer = read('src/renderer.js');
const css = read('src/library-navigation.css');
const singularityCss = read('src/singularity-probe.css');
const singularityHost = read('src/workspace-composition/singularity-live-host.js');

// 1. DOM Markup Assertions
assert.match(
  html,
  /<button role="menuitem" data-track-action="favorite">Add to favorites<\/button>\s*<button role="menuitem" data-track-action="add-to-playlist">Add to playlist\.\.\.<\/button>\s*<button role="menuitem" data-track-action="next">Play next<\/button>/,
  'trackMenu must place add-to-playlist between favorite and next',
);

assert.match(
  html,
  /id="playlistPickerOverlay"[\s\S]*role="dialog" aria-modal="true" aria-labelledby="playlistPickerTitle"/,
  'playlistPickerOverlay must be a modal dialog with aria-labelledby',
);

assert.match(
  html,
  /id="playlistPickerList" role="group" aria-label="Available playlists"/,
  'playlistPickerList must expose group semantics with aria-label',
);

assert.match(
  html,
  /id="newPlaylistPickerName"[\s\S]*id="confirmPlaylistPickerNew"/,
  'playlistPicker must include input and confirm button for creating new playlist',
);

// 2. CSS Styling Assertions
assert.match(css, /\.playlist-picker-track-label\s*\{/, 'library-navigation.css must style playlist-picker-track-label');
assert.match(css, /\.playlist-picker-list\s*\{/, 'library-navigation.css must style playlist-picker-list');
assert.match(css, /\.playlist-picker-item\s*\{/, 'library-navigation.css must style playlist-picker-item');
assert.match(css, /\.playlist-picker-create-button\s*\{/, 'library-navigation.css must style playlist-picker-create-button');

// 3. Navigation & Controller Integration
assert.match(
  renderer,
  /playlistPicker:\s*!\$\('#playlistPickerOverlay'\)\.classList\.contains\('hidden'\)/,
  'captureNavigationState must capture playlistPicker state',
);

assert.match(
  renderer,
  /prepareSurfaceForOpen\('#playlistPickerOverlay'\)\?\.classList\.toggle\('hidden',\s*!snapshot\.playlistPicker\)/,
  'restoreNavigationState must restore playlistPicker surface',
);

assert.match(
  renderer,
  /else if \(current\.playlistPicker\) \$\('#playlistPickerOverlay'\)\.classList\.add\('hidden'\)/,
  'closeCurrent must dismiss playlistPickerOverlay',
);

assert.match(
  renderer,
  /closedKey = \[[^\]]*'playlistPicker'[^\]]*\]/,
  'navigateBack closedKey search must include playlistPicker',
);

assert.match(
  renderer,
  /topmostVisibleModal\(\)[\s\S]*'#playlistPickerOverlay'/,
  'topmostVisibleModal must include #playlistPickerOverlay for keyboard focus trap',
);

assert.match(
  renderer,
  /prewarmSurface\('#playlistPickerOverlay'\)/,
  'prewarmInteractiveSurfaces must prewarm #playlistPickerOverlay',
);

// 4. Thematic Language Assertions
assert.match(
  renderer,
  /'add-to-playlist': 'Add to save slot'/,
  'Cartridge Quest theme must use "Add to save slot" label',
);

assert.match(
  renderer,
  /'add-to-playlist': 'Add to playlist\.\.\.'/,
  'Default theme must use "Add to playlist..." label',
);

// 5. Singularity Probe / Host Consistency
assert.match(
  singularityCss,
  /#playlistPickerOverlay/,
  'singularity-probe.css must elevate #playlistPickerOverlay z-index',
);

assert.match(
  singularityHost,
  /'playlistPickerOverlay'/,
  'singularity-live-host.js must track playlistPickerOverlay in applicationSurfaceOpen',
);

console.log('Playlist picker verification audit passed: markup, styling, navigation, thematic vocabulary, and dialog lifecycle are fully wired.');
