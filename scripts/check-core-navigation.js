const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('src/index.html');
const renderer = read('src/renderer.js');
const css = read('src/core-navigation.css');
const main = read('src/main.js');
const navigationController = read('src/renderer-domains/navigation-controller.js');

for (const id of ['search', 'settingsButton', 'systemsButton', 'playerSystemsButton', 'queueButton', 'muteButton', 'volume', 'compactLibraryButton', 'createPlaylist', 'importButton', 'trackActionsButton', 'trackMenu', 'queueDrawer', 'shortcutsOverlay']) {
  assert.match(html, new RegExp(`id="${id}"`), `core navigation control #${id} must exist`);
}

assert.match(html, /id="queueDrawer" role="dialog" aria-modal="false" aria-labelledby="queueTitle" tabindex="-1"/, 'Queue must be an explicitly named nonmodal dialog.');
assert.match(html, /id="queueButton"[^>]*aria-controls="queueDrawer"[^>]*aria-expanded="false"/, 'Queue trigger must expose its controlled surface and open state.');
assert.match(html, /id="trackMenu" role="menu" aria-label="Track actions"/, 'Track actions must use named menu semantics.');
assert.match(html, /data-track-action="play">Play now<\/button>[\s\S]*data-track-action="next">Play next<\/button>[\s\S]*data-track-action="queue">Add to queue<\/button>/, 'Play now, Play next, and Add to queue must remain distinct.');
assert.match(html, /id="profileButton"[^>]*Edit profile \(opens Personal settings\)/, 'Profile entry must promise the Personal route.');
assert.match(html, /id="settingsTitle">Settings<\/h2>/, 'The overall destination must be named Settings.');
assert.match(html, /class="jam-advanced-cabinet"/, 'J.A.M. advanced connection and diagnostic detail must use deliberate disclosure.');

assert.match(css, /@media\(max-width:980px\)[\s\S]*body \.top-quality\{display:grid!important/, 'Narrow layouts must preserve the top output route.');
assert.match(css, /body \.player>\.volume\{[^}]*display:grid!important/, 'Narrow layouts must preserve the listening-control dock.');
assert.match(css, /body \.player>\.volume :is\(#miniPlayerButton,#queueButton,#muteButton,#playerSystemsButton\)\{display:flex!important/, 'The narrow dock must retain Queue, mute, output, and Mini routes.');
assert.match(css, /body\.compact-library-open[\s\S]*\.create-button,[\s\S]*\.rail-import\)\{display:flex!important/, 'Compact Library must restore Create and Import in its expanded state.');
assert.match(css, /@media\(max-width:850px\)[\s\S]*grid-template-areas:"identity playback"!important/, 'The supported compact width must collapse theme footer grids without removing playback.');
assert.match(main, /minWidth:\s*800,/, 'The Windows host must make the audited 800px compact route reachable.');

assert.match(renderer, /function openSettings\(options = \{\}\)[\s\S]*requestedTab[\s\S]*activateSettingsTab\(requestedTab\)/, 'Settings must support an authoritative direct-tab route.');
assert.match(renderer, /async function selectThemeFromSettings\(theme\)[\s\S]*closeSettings\(\);[\s\S]*await waitForPaint\(\);[\s\S]*await selectTheme\(theme\);/, 'Theme selection must dismiss Settings before the transition starts.');
assert.match(renderer, /document\.querySelectorAll\('\[data-theme-option\]'\)[\s\S]*button\.onclick = \(\) => selectThemeFromSettings\(button\.dataset\.themeOption\)/, 'Built-in theme cards must use the dismiss-then-switch route.');
assert.doesNotMatch(renderer, /function openSettings\(options = \{\}\)[\s\S]*?triggerThemeAction\('settings', 'Configuration'\)[\s\S]*?\n\}/, 'Opening Settings must not be obscured by a theme action reaction.');
assert.match(renderer, /document\.body\.classList\.remove\('theme-switching'\);[\s\S]*?\}, revealMs\);/, 'Theme switching must release navigation when the cover clears.');
assert.doesNotMatch(renderer, /triggerThemeAction\('settings', themeOnlineLabel\)/, 'Theme switching must not reopen a Settings-themed reaction after the new theme arrives.');
assert.match(renderer, /#profileButton'\)\.onclick = \(\) => openSettings\(\{ tab: 'personal'/, 'Edit profile must route directly to Personal.');
assert.match(renderer, /function openQueue\(opener = document\.activeElement\)[\s\S]*rememberNavigationOpener\('queue'/, 'Queue open must retain its focus-return opener.');
assert.match(renderer, /function navigateBack\(\)[\s\S]*navigationOpeners\.get\(closedKey\)/, 'Shared back behavior must restore focus to the surface opener.');
assert.match(renderer, /\['\.settings-intro > span', 'textContent'/, 'Theme language updates must preserve the keyboard-shortcut control inside Settings.');
assert.match(navigationController, /'shortcuts',[\s\S]*'compactLibrary'/, 'Shared navigation state must include shortcuts and compact Library surfaces.');
assert.match(renderer, /keyboardTargetIsEditable\(event\.target\)\) return;/, 'Global shortcuts must be suppressed in editable fields.');
assert.match(renderer, /modifier && event\.shiftKey && key === 'q'/, 'Queue shortcut must avoid Ctrl+Q and use the documented modified route.');
assert.match(renderer, /modifier && event\.shiftKey && key === 'o'/, 'Audio systems must have a documented shortcut.');
assert.match(renderer, /modifier && event\.shiftKey && key === 'l'/, 'Compact Library must have a documented shortcut.');
assert.match(renderer, /if \(action === 'not-session'\) applyFlowControl\('not-session', trackById\(id\)\)/, 'Track menu must preserve Not this session intelligence behavior.');
assert.match(renderer, /if \(action === 'less-like'\) applyFlowControl\('less-like', trackById\(id\)\)/, 'Track menu must preserve Less like this intelligence behavior.');

console.log('Core navigation audit passed: P0 routes survive narrow layouts; compact Library, track actions, truthful Settings routing, shortcuts, semantics, and focus return are wired.');
