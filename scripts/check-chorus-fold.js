const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createChorusFoldMechanic, geometryFor, normalizedPlaybackState, projectionFor, safeIndex } = require('../src/theme-runtime/navigation/chorus-fold');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/theme-runtime/navigation/chorus-fold.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/chorus-fold-navigation.css'), 'utf8');
const mainCss = fs.readFileSync(path.join(root, 'src/counterform-choir.css'), 'utf8');
const miniCss = fs.readFileSync(path.join(root, 'src/mini-counterform-choir.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8');

const host = { format: {
  escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
  fileUrl: (value) => `file:///${value}`,
} };
const track = (id, overrides = {}) => ({ id, title: `Track ${id}`, artist: 'Artist', album: 'Album', format: 'FLAC', duration: 125, artworkPath: null, ...overrides });
const mechanic = createChorusFoldMechanic(host);
const validation = validateMechanic(mechanic);
assert.equal(validation.valid, true, validation.errors.join(', '));

const tracks = [track('a'), track('b'), track('c')];
assert.equal(safeIndex(tracks, 'b'), 1);
assert.equal(safeIndex(tracks, 'missing'), 0);
assert.equal(safeIndex([], 'a'), -1);
assert.equal(normalizedPlaybackState('playing', 'b'), 'playing');
assert.equal(normalizedPlaybackState('playing', null), 'idle');
assert.equal(normalizedPlaybackState('buffering', 'b'), 'paused');
assert.deepEqual(projectionFor(tracks, 'b'), { activeIndex: 1, previous: tracks[0], current: tracks[1], next: tracks[2], total: 3 });
assert.equal(projectionFor(tracks, 'a').previous, null);
assert.equal(projectionFor(tracks, 'c').next, null);

const geoA = geometryFor(0, 1, 8);
const geoB = geometryFor(1, 1, 8);
assert.equal(geoA.curve, 0);
assert.equal(geoB.curve, 1);
assert.equal(geoB.offset, 0);
assert.equal(geoB.distance, 0);
assert.ok(Number.isFinite(geoA.x) && Number.isFinite(geoA.y) && Number.isFinite(geoA.angle));
assert.equal(geometryFor(20, 0, 30).distance, 6, 'visual distance must clamp');
const entryGap = Math.abs(geometryFor(0, 3, 8).stackX - geometryFor(1, 3, 8).stackX);
const throatGap = Math.abs(geometryFor(4, 3, 8).stackX - geometryFor(5, 3, 8).stackX);
assert.ok(entryGap > 16 && throatGap < entryGap / 2, 'narrow counter-courses must visibly converge through one throat');
const endOfFirstMovement = geometryFor(9, 0, 30);
const startOfSecondMovement = geometryFor(10, 0, 30);
const startOfThirdMovement = geometryFor(20, 0, 30);
assert.equal(endOfFirstMovement.group, 0);
assert.equal(startOfSecondMovement.group, 1);
assert.equal(startOfThirdMovement.group, 2);
assert.ok(startOfSecondMovement.y - endOfFirstMovement.y >= 260, 'a long score must recover before the next movement begins');
assert.ok(startOfSecondMovement.stackY - endOfFirstMovement.stackY >= 170, 'narrow long-score voices must not stack into the preceding movement');

const markup = mechanic.__test__.voiceMarkup(track('a', { title: 'A & B / 기억', artist: 'Long <Artist>', album: '', format: 'wav', duration: 248 }), 0);
assert.match(markup, /A &amp; B \/ 기억/);
assert.match(markup, /Long &lt;Artist&gt;/);
assert.match(markup, /WAV/);
assert.match(markup, /4:08/);
assert.match(markup, /chorus-fold-state/);
assert.match(markup, /chorus-fold-face/);
assert.equal((markup.match(/<i><\/i>/g) || []).length, 30, 'voice pressure field lost its deterministic multiscale population');

for (const required of [
  'requestedId = id',
  "currentActiveId === requestedId",
  'activationFailedId',
  'insertBefore(voice, expected || null)',
  "setAttribute('aria-selected'",
  "setAttribute('aria-current'",
  "event.key === 'Enter'",
  "event.key === 'Escape'",
  'options.onContextMenu',
  'options.onToggleCurrent',
  'activateOrToggleCurrent',
  'VOICES_PER_MOVEMENT',
  'MOVEMENT_FIELD_STEP',
  'MOVEMENT_STACK_STEP',
  'HOVER_LOCK_EXIT_BUFFER',
  'counterform-hover-lock',
  'handleGlobalPointerMove',
  'voiceAtPointer',
  'positionHoverPerimeter',
  'chorus-fold-hover-perimeter',
]) assert.ok(source.includes(required), `missing Chorus Fold contract behavior: ${required}`);

assert.match(css, /\.chorus-fold-mounted/);
assert.match(css, /body\[data-theme="counterform-choir"\]/);
assert.match(css, /@media \(max-width:/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /chorus-fold-collective/);
assert.match(css, /data-pressure="3"/);
assert.match(css, /width: clamp\(188px, 17vw, 246px\)/);
assert.match(css, /border-radius: 50%/);
assert.match(css, /bounded mass behind each label/);
assert.match(css, /Third-repair score legibility/);
assert.match(css, /data-stage="collective"/);
assert.match(css, /compressing body/);
assert.match(css, /z-index: auto/);
assert.match(css, /cursor: none !important/);
assert.match(css, /chorus-fold-hover-perimeter/);
assert.match(css, /vector-effect: non-scaling-stroke/);
assert.match(mainCss, /body\[data-theme="counterform-choir"\]\.is-playing/);
assert.match(mainCss, /data-performance="conserve"/);
assert.match(miniCss, /body\[data-theme="counterform-choir"\]\.playing/);
assert.match(miniCss, /compact surface is one three-voice collective/);
assert.match(miniCss, /scaleY\(1\)/);
assert.match(miniCss, /Third-repair compact proof/);
assert.match(renderer, /'counterform-choir': 'chorus-fold'/);
assert.match(renderer, /activationFailedId/);
assert.match(renderer, /chorus: resolveThemeInformationBundle\('playback\.neighborhood'\)/);

console.log('Chorus Fold audit passed: contract, geometry, long-score movement recovery, Unicode escaping, selected/requested/current separation, failure reconciliation, keyed DOM ownership, responsive/motion fallbacks, and main/mini projection hooks are present.');
