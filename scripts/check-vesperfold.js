const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSharedStrataMechanic } = require('../src/theme-runtime/navigation/shared-strata');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');
const informationRegistry = require('../src/theme-runtime/information/registry');
require('../src/theme-runtime/information/bundles');
const { profile } = require('../src/theme-runtime/information/profiles/vesperfold');
const informationContract = require('../src/theme-runtime/information/contract');

const mechanic = createSharedStrataMechanic({ format: { escapeHtml: (value) => String(value), durationText: () => '2:05', fileUrl: (value) => value } });
assert.equal(validateMechanic(mechanic).valid, true);
assert.equal(informationContract.validateProfile(profile).valid, true);
assert.equal(informationRegistry.hasProfile('vesperfold'), true);

const tracks = [
  { id: 'a', title: 'Selected', artist: 'One', duration: 125, format: 'flac' },
  { id: 'b', title: 'Confirmed', artist: 'Two', duration: 180, format: 'wav', bitDepth: 24, sampleRate: 96000 },
  { id: 'c', title: 'Pending', artist: 'Three', duration: 210, format: 'mp3' },
];
const snapshot = { collection: { id: 'all', name: 'Hostile Collection', type: 'Playlist' }, tracks: { display: tracks, collection: tracks, all: tracks }, playback: { currentId: 'b', phase: 'playing' }, output: { label: 'Desk Rig', active: true }, queue: { items: ['b', 'c'] } };
const resolved = Object.fromEntries(profile.bundles.map((key) => [key, informationRegistry.resolveBundle(key, snapshot)]));
const projection = profile.project(resolved);
assert.equal(projection.fields.playbackState, 'PLAYING / SUTURE LIVE');
assert.equal(projection.fields.currentTitle, 'Confirmed');
assert.equal(projection.fields.route, 'Desk Rig');
assert.equal(projection.fields.queue, '02');
assert.equal(projection.fields.technical, 'WAV · 24-BIT / 96 KHZ');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const mini = fs.readFileSync(path.join(root, 'src/mini-player.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/vesperfold.css'), 'utf8');
const miniCss = fs.readFileSync(path.join(root, 'src/mini-vesperfold.css'), 'utf8');
['vesperfold.css', 'theme-runtime/navigation/shared-strata.js', 'theme-runtime/information/profiles/vesperfold.js', 'data-theme-option="vesperfold"'].forEach((needle) => assert.ok(index.includes(needle), `${needle} must be wired`));
assert.ok(mini.includes('mini-vesperfold.css'));
assert.ok(renderer.includes("vesperfold: 'shared-strata'"));
assert.ok(renderer.includes("vesperfold: 'vesperfold'"));
assert.ok(renderer.includes("registerMechanic('shared-strata'"));
assert.ok(renderer.includes('authoritativeTracks: state.tracks'), 'Shared Strata must receive host-owned playback truth independently from search and collection presentation');
assert.ok(css.includes('body[data-theme="vesperfold"]'));
assert.match(css, /body\[data-theme="vesperfold"\]\{[^}]*overflow-x:hidden/, 'Vesperfold must contain its off-canvas folio without creating document-level horizontal overflow');
assert.match(css, /body\[data-theme="vesperfold"\] \.workspace\{[^}]*overflow:clip/, 'Vesperfold workspace must clip the translated folio at its authored reveal edge');
assert.ok(css.includes('clip-path:inset(0 0 0 calc(100% - 30px))'), 'The closed folio must stay in-bounds and expose only its authored 30px reveal edge');
assert.ok(css.includes('.playlist-hero:not(.track-info-open) .hero-track-info{display:none}'), 'Closed track information must not create invisible document overflow');
assert.ok(css.includes('.shared-stratum.is-pending'));
assert.ok(css.includes('.shared-stratum.is-confirmed'));
assert.ok(css.includes('[data-motion="off"]'));
assert.ok(css.includes('@media(max-width:940px)'), 'Vesperfold narrow composition must engage above the 900px production minimum');
assert.ok(css.includes('.hero-copy h1') && css.includes('color:var(--vf-ink)'), 'Bright artwork must retain an ink-color title treatment');
assert.ok(css.includes('.volume{display:flex;gap:4px;min-width:0}'), 'Narrow output controls must retain Mini and Queue');
assert.ok(css.includes('.global-search input{min-height:32px'), 'Vesperfold search must retain a measured 32px pointer target');
assert.ok(css.includes('.rail-import button{min-height:32px'), 'Vesperfold import must retain a measured 32px pointer target');
assert.ok(css.includes('.transport-buttons button{width:34px!important;height:34px!important'), 'Vesperfold transport neighbors must override the 30px base target floor');
assert.ok(css.includes('#miniPlayerButton{min-width:44px;min-height:32px}'), 'Vesperfold Mini must retain a measured 32px target floor');
assert.ok(css.includes('#settingsButton{right:225px}') && css.includes('#settingsButton{right:18px}'), 'Vesperfold Settings and output targets must not overlap at wide or narrow widths');
assert.ok(miniCss.includes('body[data-theme="vesperfold"]'));
assert.doesNotMatch(css, /url\s*\(/i, 'Vesperfold must not bundle or reference source imagery');
console.log('Vesperfold vertical-slice audit passed: shared-strata truth, read-only profile, main/mini wiring, motion-off, and no-source-asset boundary are present.');
