const assert = require('node:assert/strict');
const { createPressureStackMechanic } = require('../src/theme-runtime/navigation/pressure-stack');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const host = { format: {
  escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
  fileUrl: (value) => `file:///${value}`,
} };
const track = (id, overrides = {}) => ({ id, title: `Track ${id}`, artist: 'Artist', album: 'Album', format: 'FLAC', duration: 125, artworkPath: null, ...overrides });
const mechanic = createPressureStackMechanic(host);

const validation = validateMechanic(mechanic);
assert.equal(validation.valid, true, validation.errors.join(', '));
const markup = mechanic.__test__.plateHtml(track('a', { title: 'A & B / 深度', artworkPath: 'art.jpg' }), 0, 0, true, true);
assert.match(markup, /pressure-stack-card is-centered is-playing/);
assert.match(markup, /role="option" aria-selected="true"/);
assert.match(markup, /A &amp; B \/ 深度/);
assert.match(markup, /--pressure-art:url\('file:\/\/\/art.jpg'\)/);
assert.match(markup, /pressure-stack-rail/);
assert.match(markup, /pressure-stack-aperture/);
assert.match(markup, /LIVE DEPTH/);
assert.match(markup, /CONFIRMED/);

const tracks = [track('a'), track('b'), track('c')];
assert.equal(mechanic.__test__.centerIndexFor(tracks, 'b'), 1);
assert.equal(mechanic.__test__.centerIndexFor(tracks, null), 0);
assert.equal(mechanic.__test__.centerIndexFor([], null), -1);
assert.deepEqual(mechanic.__test__.visualProps(-8), { distance: 5, side: -1 });
assert.deepEqual(mechanic.__test__.visualProps(2), { distance: 2, side: 1 });
assert.equal(mechanic.__test__.tracksEqual(tracks, tracks.map((item) => ({ ...item }))), true);
assert.equal(mechanic.__test__.tracksEqual(tracks, [track('a'), track('c'), track('b')]), false);
assert.match(mechanic.__test__.statusHtml(tracks, 'b'), /02 \/ 03/);
assert.match(mechanic.__test__.statusHtml([], null), /PRESSURE STACK \/ EMPTY/);

// The single-position invariant is structural: generated offsets are derived
// from the confirmed activeId only. A requested target cannot become centered
// until the host supplies it to a later update/paint cycle.
const before = tracks.map((item, index) => mechanic.__test__.plateHtml(item, index, index - mechanic.__test__.centerIndexFor(tracks, 'b'), item.id === 'b', index === 1)).join('');
assert.equal((before.match(/aria-selected="true"/g) || []).length, 1);
assert.match(before, /data-id="b"[^>]+aria-selected="true"|aria-selected="true"[^>]+data-id="b"/);
const after = tracks.map((item, index) => mechanic.__test__.plateHtml(item, index, index - mechanic.__test__.centerIndexFor(tracks, 'c'), item.id === 'c', index === 2)).join('');
assert.equal((after.match(/aria-selected="true"/g) || []).length, 1);
assert.match(after, /data-id="c"[^>]+aria-selected="true"|aria-selected="true"[^>]+data-id="c"/);

console.log('Pressure Stack audit passed: contract, escaping, Unicode, layered plate anatomy, one confirmed position, clamped depth, state, and empty fallback are correct.');
