const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  IPC_CONTRACTS,
  allowedExternalUrl,
  boundedJson,
  expectedDocumentUrl,
  sameDocumentUrl,
  validateIpcArguments,
} = require('../src/electron-security');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
const main = read('src/main.js');
const mainPreload = read('src/preload.js');
const miniPreload = read('src/mini-preload.js');
const index = read('src/index.html');
const mini = read('src/mini-player.html');
const packager = read('scripts/package-windows-smoke.js');

function channelMatches(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]).sort();
}

const registeredChannels = channelMatches(main, /register(?:Handle|On)\('([^']+)'/g);
const contractChannels = Object.keys(IPC_CONTRACTS).sort();
assert.deepEqual(registeredChannels, contractChannels, 'Every IPC channel must have exactly one authoritative contract and registration.');
assert.equal(new Set(registeredChannels).size, registeredChannels.length, 'IPC channels must not be registered more than once.');

const mainBridgeChannels = new Set([
  ...channelMatches(mainPreload, /ipcRenderer\.(?:invoke|send|sendSync)\('([^']+)'/g),
  ...channelMatches(mainPreload, /invokePaths?\('([^']+)'/g),
]);
const miniBridgeChannels = new Set(channelMatches(miniPreload, /ipcRenderer\.(?:invoke|send|sendSync)\('([^']+)'/g));
const intendedMini = new Set(['mini:close', 'mini:restore-main', 'mini:command', 'test:config', 'test:report']);
assert.deepEqual([...miniBridgeChannels].sort(), [...intendedMini].sort(), 'Mini preload has more than its five intended channels.');
for (const privileged of ['state:commit', 'music:choose-files', 'sharing:start', 'app:open-external', 'mini:open']) {
  assert.ok(!miniBridgeChannels.has(privileged), `Mini preload unexpectedly exposes ${privileged}.`);
}
for (const required of ['state:commit', 'state:workspace-load', 'state:workspace-commit', 'state:workspace-cancel', 'state:workspace-startup', 'music:choose-files', 'sharing:start', 'mini:open']) assert.ok(mainBridgeChannels.has(required), `Main preload is missing ${required}.`);
assert.doesNotMatch(mainPreload, /droppedPath\s*:/, 'Raw dropped-path conversion must not remain exposed.');
assert.match(mainPreload, /registerDroppedFiles/, 'OS-backed drop registration is missing.');
assert.match(mainPreload, /approvedPaths/, 'Main preload path-capability set is missing.');

for (const source of [index, mini]) {
  const csp = source.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  assert.match(csp, /default-src 'none'/, 'CSP must default deny.');
  assert.match(csp, /script-src 'self'/, 'CSP must allow only packaged scripts.');
  assert.doesNotMatch(csp, /unsafe-eval/, 'CSP must not permit eval.');
  assert.match(csp, /object-src 'none'/, 'CSP must block plugins.');
  assert.match(csp, /frame-src 'none'/, 'CSP must block frames.');
}
assert.match(main, /app\.enableSandbox\(\)/, 'Application-wide sandbox enforcement is missing.');
assert.match(main, /sandbox: true/, 'BrowserWindow sandbox preference is missing.');
assert.match(main, /contextIsolation: true/, 'Context isolation is missing.');
assert.match(main, /nodeIntegration: false/, 'Node integration must be disabled.');
assert.match(main, /setWindowOpenHandler/, 'Popup denial is missing.');
assert.match(main, /will-frame-navigate/, 'Frame navigation denial is missing.');
assert.match(main, /will-attach-webview/, 'Webview attachment denial is missing.');
assert.doesNotMatch(main, /executeJavaScript\s*\(/, 'Security automation must not add general renderer evaluation.');
assert.match(main, /mini-preload\.js/, 'Mini window is not using the least-privilege preload.');
assert.match(packager, /src\/mini-preload\.js/, 'Packaged smoke allowlist does not require the mini preload.');
assert.match(packager, /src\/electron-security\.js/, 'Packaged smoke allowlist does not require the security contract.');

const validSamples = {
  'modules:request': [{ op: 'state' }],
  'mini:command': ['toggle'],
  'app:set-brand-icon': ['ultraviolet'],
  'app:relaunch-development-profile': ['singularity-graph'],
  'player:state': [{}],
  'test:report': ['event', {}],
  'test:action': ['close-mini'],
  'test:capture-failure': ['failure'],
  'test:verify-sharing-privacy': [{}],
  'test:finish': [{}],
  'test:hostile-result': [{}],
  'state:migrate-legacy': [{}, []],
  'state:commit': [{}, { reason: 'audit' }],
  'state:import-backup-v1': [{}, {}],
  'state:workspace-commit': [{ type: 'root', id: 'workspace-root', schemaVersion: 1, children: [] }, { expectedRevision: 1, activeThemeId: 'pixelody-studio', reason: 'audit' }],
  'state:workspace-cancel': [{ expectedRevision: 1 }],
  'state:workspace-startup': ['begin', { watchdogMs: 1000 }],
  'app:wasapi-helper-diagnostics': [{}],
  'app:wasapi-helper-probe': [{}],
  'app:wasapi-helper-loopback-prototype': [{}],
  'app:native-mixer-clock-discipline-lab': [{ leaderEndpointId: 'a', followerEndpointId: 'b', durationMs: 500 }],
  'app:open-external': ['https://musicbrainz.org/search?query=fixture'],
  'theme:delete-package': [{ id: 'creator.fixture', version: '1.0.0', hash: 'a'.repeat(64) }],
  'sharing:update-snapshot': [{}],
  'sharing:start': [{}, { mode: 'localhost' }],
  'sharing:create-device': [{}],
  'sharing:revoke-device': ['device-1'],
  'sharing:delete-device': ['device-1'],
  'sharing:update-device-permissions': ['device-1', ['browse']],
  'sharing:refresh-devices': [{ scope: 'jam', reason: 'audit' }],
  'sharing:start-pairing': [{ deviceName: 'Fixture', permissions: ['browse'] }],
  'sharing:start-jam-session': [{ guestPolicy: { guestsCanView: true, guestsCanSuggest: true, guestsCanQueue: false, guestsCanEditQueue: false, guestsCanControlPlayback: false } }],
  'sharing:update-jam-policy': [{ guestPolicy: { guestsCanView: true } }],
  'sharing:approve-jam-participant': ['device-1', { approved: true, role: 'guest', permissions: ['view', 'suggest'] }],
  'sharing:remove-jam-participant': ['device-1'],
  'music:register-dropped-paths': [['C:\\fixture.wav']],
  'app:cache-profile-image': ['C:\\fixture.png'],
  'app:cache-track-image': ['C:\\fixture.png', 'track-1'],
  'app:optimize-artwork': ['C:\\fixture.png'],
  'music:exists': ['C:\\fixture.wav'],
  'app:set-text-scale': [1.3],
  'music:verify-integrity': [[{ path: 'C:\\fixture.wav', size: 10, mtimeMs: 1 }]],
  'app:export-backup': [{}],
  'app:export-tuning-profiles': [{}],
  'playlist:export-m3u': [{ name: 'Road Trip', entries: [{ path: 'C:\\Music\\a.flac', title: 'A', artist: 'B', duration: 212.4 }, { path: 'D:\\x.mp3', title: '', artist: '', duration: null }] }],
  'music:inspect': ['C:\\fixture.wav'],
  'library:add-watched-folder': ['C:\\fixture_dir'],
  'library:remove-watched-folder': ['C:\\fixture_dir'],
  'library:get-watched-folders': [],
  'library:sync-watched-folders': [['C:\\fixture_dir']],
  'library:rescan-watched-folders': [],
};
assert.equal(validateIpcArguments('app:set-brand-icon', ['ultraviolet', '#c91527']).ok, true);
assert.equal(validateIpcArguments('app:set-brand-icon', ['ultraviolet', '']).ok, true);
for (const hostile of [[], ['#6a3dff'], ['ultraviolet', 'extra'], [{ key: 'ultraviolet' }], ['../../icon'], ['twitch'], ['ultraviolet', 'red'], ['ultraviolet', '#fff'], ['ultraviolet', '#c91527', 'extra']]) {
  assert.equal(validateIpcArguments('app:set-brand-icon', hostile).ok, false, `Logo colour channel accepted a hostile payload: ${JSON.stringify(hostile)}`);
}
for (const profileId of ['studio', 'canvas-studio', 'singularity-graph', 'singularity-proxy']) {
  assert.equal(validateIpcArguments('app:relaunch-development-profile', [profileId]).ok, true, `Development restart rejected a listed profile: ${profileId}`);
}
for (const hostile of [[], [''], ['canvas-studio', 'extra'], [{ id: 'canvas-studio' }], ['--pixelody-canvas'], ['canvas-studio --no-sandbox'], ['../main'], ['foreground-stage'], ['__proto__']]) {
  assert.equal(validateIpcArguments('app:relaunch-development-profile', hostile).ok, false, `Development restart accepted a hostile payload: ${JSON.stringify(hostile)}`);
}
for (const channel of contractChannels) {
  const args = validSamples[channel] || [];
  assert.equal(validateIpcArguments(channel, args).ok, true, `Valid contract fixture failed for ${channel}.`);
}

for (const action of ['capture-singularity-main-rest', 'capture-singularity-main-playing', 'capture-singularity-main-failure', 'capture-singularity-main-intermediate', 'capture-singularity-main-narrow', 'capture-singularity-main-compact', 'capture-singularity-main-zoom-200', 'capture-singularity-main-restored-maximized', 'capture-singularity-mini-compact']) {
  assert.equal(validateIpcArguments('test:action', [action]).ok, true, `Bounded Singularity capture action was rejected: ${action}`);
}
for (const action of ['capture-singularity-proxy-main-rest', 'capture-singularity-proxy-main-playing', 'capture-singularity-proxy-main-failure', 'capture-singularity-proxy-main-intermediate', 'capture-singularity-proxy-main-narrow', 'capture-singularity-proxy-main-compact', 'capture-singularity-proxy-main-zoom-200', 'capture-singularity-proxy-main-restored-maximized', 'capture-singularity-proxy-mini-compact']) {
  assert.equal(validateIpcArguments('test:action', [action]).ok, true, `Bounded Singularity Proxy capture action was rejected: ${action}`);
}
assert.equal(validateIpcArguments('test:action', ['inspect-singularity-accessibility']).ok, true, 'Bounded Singularity accessibility inspection action was rejected.');
assert.equal(validateIpcArguments('test:action', ['set-singularity-zoom-200']).ok, true, 'Bounded Singularity 200% zoom action was rejected.');
assert.equal(validateIpcArguments('test:action', ['reset-singularity-zoom']).ok, true, 'Bounded Singularity zoom reset action was rejected.');
assert.equal(validateIpcArguments('test:action', ['resize-singularity-intermediate']).ok, true, 'Bounded Singularity intermediate viewport action was rejected.');
for (const action of ['singularity-keyboard-enter', 'singularity-keyboard-escape']) {
  assert.equal(validateIpcArguments('test:action', [action]).ok, true, `Bounded Singularity keyboard action was rejected: ${action}`);
}
for (const [action, point] of [
  ['singularity-pointer-preview-enter', { x: 120, y: 180, target: 'library' }],
  ['singularity-pointer-preview-leave', { x: 2, y: 2, target: 'outside' }],
  ['singularity-pointer-activate', { x: 300, y: 220, target: 'secondary' }],
]) assert.equal(validateIpcArguments('test:action', [action, point]).ok, true, `Bounded Singularity pointer action was rejected: ${action}`);
assert.equal(validateIpcArguments('test:action', ['singularity-wheel-scroll', { x: 320, y: 240, target: 'tracks', deltaY: -612 }]).ok, true, 'Bounded Singularity wheel action was rejected.');
for (const action of ['capture-singularity-main-arbitrary', 'capture-singularity-other-rest', 'capture-singularity-mini-wide', 'capture-singularity-mini-zoom-200', 'capture-singularity-main-rest-extra', 'capture-singularity-proxy-other-rest', 'capture-singularity-proxy-main-wide', 'capture-singularity-proxy-mini-zoom-200']) {
  assert.equal(validateIpcArguments('test:action', [action]).ok, false, `Unbounded Singularity capture action was accepted: ${action}`);
}
assert.equal(validateIpcArguments('test:action', ['inspect-singularity-accessibility-extra']).ok, false, 'Unbounded Singularity accessibility action was accepted.');
assert.equal(validateIpcArguments('test:action', ['set-singularity-zoom-300']).ok, false, 'Unbounded Singularity zoom action was accepted.');
assert.equal(validateIpcArguments('test:action', ['singularity-pointer-arbitrary']).ok, false, 'Unbounded Singularity pointer action was accepted.');
assert.equal(validateIpcArguments('test:action', ['singularity-keyboard-arbitrary']).ok, false, 'Unbounded Singularity keyboard action was accepted.');
assert.equal(validateIpcArguments('test:action', ['singularity-pointer-activate']).ok, false, 'Singularity pointer action without a bounded point was accepted.');
assert.equal(validateIpcArguments('test:action', ['singularity-pointer-activate', { x: -1, y: 10, target: 'secondary' }]).ok, false, 'Singularity pointer action accepted an out-of-bounds point.');
assert.equal(validateIpcArguments('test:action', ['singularity-wheel-scroll']).ok, false, 'Singularity wheel action without a bounded event was accepted.');
assert.equal(validateIpcArguments('test:action', ['singularity-wheel-scroll', { x: 10, y: 10, target: 'library', deltaY: -612 }]).ok, false, 'Singularity wheel action accepted the wrong target.');
assert.equal(validateIpcArguments('test:action', ['singularity-wheel-scroll', { x: 10, y: 10, target: 'tracks', deltaY: 0 }]).ok, false, 'Singularity wheel action accepted a zero delta.');
assert.equal(validateIpcArguments('test:action', ['singularity-wheel-scroll', { x: 10, y: 10, target: 'tracks', deltaY: -1201 }]).ok, false, 'Singularity wheel action accepted an unbounded delta.');

assert.equal(validateIpcArguments('state:commit', ['bad', {}]).ok, false);
assert.equal(validateIpcArguments('state:workspace-commit', [{}, { expectedRevision: 0 }]).ok, false);
assert.equal(validateIpcArguments('state:workspace-startup', ['begin', { watchdogMs: 999 }]).ok, false);
assert.equal(validateIpcArguments('app:wasapi-helper-diagnostics', [{ unexpected: true }]).ok, false);
assert.equal(validateIpcArguments('theme:delete-package', [{ id: '../escape', version: '1.0.0', hash: 'short' }]).ok, false);
assert.equal(validateIpcArguments('sharing:start', [{}, { mode: 'internet' }]).ok, false);
for (const accessProfile of ['jam-guest', 'personal-device']) {
  assert.equal(validateIpcArguments('sharing:create-device', [{ name: 'Fixture', permissions: ['browse'], accessProfile }]).ok, true);
  assert.equal(validateIpcArguments('sharing:start-pairing', [{ deviceName: 'Fixture', permissions: ['browse'], accessProfile }]).ok, true);
  assert.equal(validateIpcArguments('sharing:update-device-permissions', ['device-1', ['browse'], accessProfile]).ok, true);
}
for (const accessProfile of ['owner', 'admin', '', {}, null]) {
  assert.equal(validateIpcArguments('sharing:create-device', [{ accessProfile }]).ok, false);
  assert.equal(validateIpcArguments('sharing:start-pairing', [{ deviceName: 'Fixture', permissions: ['browse'], accessProfile }]).ok, false);
  assert.equal(validateIpcArguments('sharing:update-device-permissions', ['device-1', ['browse'], accessProfile]).ok, false);
}
assert.equal(validateIpcArguments('sharing:update-jam-policy', [{ guestPolicy: { guestsCanView: 'yes' } }]).ok, false);
assert.equal(validateIpcArguments('sharing:approve-jam-participant', ['device-1', { permissions: ['owner'] }]).ok, false);
assert.equal(validateIpcArguments('music:inspect', ['..\\secret.txt']).ok, false);
const exportEntry = { path: 'C:\\Music\\a.flac', title: 'A', artist: 'B', duration: 1 };
assert.equal(validateIpcArguments('playlist:export-m3u', [{ name: 'P', entries: [{ ...exportEntry, path: 'Music\\a.flac' }] }]).ok, false, 'Playlist export must reject relative paths.');
assert.equal(validateIpcArguments('playlist:export-m3u', [{ name: 'P', entries: [{ ...exportEntry, path: 'C:\\Windows\\win.ini' }] }]).ok, false, 'Playlist export must reject non-audio paths.');
assert.equal(validateIpcArguments('playlist:export-m3u', [{ name: 'P', entries: [{ ...exportEntry, extra: true }] }]).ok, false, 'Playlist export entries must not carry extra fields.');
assert.equal(validateIpcArguments('playlist:export-m3u', [{ name: 'P', entries: [{ ...exportEntry, duration: -1 }] }]).ok, false, 'Playlist export durations must be non-negative.');
assert.equal(validateIpcArguments('playlist:export-m3u', [{ name: 'P', entries: [], target: 'C:\\x.m3u8' }]).ok, false, 'The renderer must not choose the export target.');
assert.equal(allowedExternalUrl('http://musicbrainz.org/'), '');
assert.equal(allowedExternalUrl('https://musicbrainz.org.attacker.invalid/'), '');
assert.ok(allowedExternalUrl('https://musicbrainz.org/search?query=fixture'));
assert.equal(boundedJson({ safe: true }, 1024), true);
assert.equal(boundedJson({ value: 'x'.repeat(2048) }, 1024), false);
const polluted = Object.create({ inherited: true });
polluted.safe = true;
assert.equal(boundedJson(polluted, 1024), false);
const circular = {};
circular.self = circular;
assert.equal(boundedJson(circular, 1024), false);

const expected = expectedDocumentUrl(path.join(root, 'src'), 'index.html');
assert.equal(sameDocumentUrl(`${expected}?cache=1`, expected), true);
assert.equal(sameDocumentUrl('https://example.com/', expected), false);

console.log(`Electron security audit passed: ${contractChannels.length} IPC contracts, least-privilege preloads, path grants, CSP, sandbox, navigation denial, and hostile payload policy are enforced.`);
