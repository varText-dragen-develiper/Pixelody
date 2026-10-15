const assert = require('node:assert/strict');
const { createMemoryCascadeMechanic } = require('../src/theme-runtime/navigation/memory-cascade');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const host = {
  format: {
    escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
    fileUrl: (path) => `file:///${path}`,
  },
};

const track = (id, overrides = {}) => ({ id, title: `Track ${id}`, artist: 'Artist', album: 'Album', format: 'FLAC', duration: 125, artworkPath: null, ...overrides });
const mechanic = createMemoryCascadeMechanic(host);
const validation = validateMechanic(mechanic);
assert.equal(validation.valid, true, validation.errors.join(', '));

const markup = mechanic.__test__.cardHtml(track('a', { title: 'A & B', artworkPath: 'art.jpg' }), 0, 0, true, true);
assert.match(markup, /memory-cascade-card is-centered is-playing/);
assert.match(markup, /role="option" aria-selected="true"/);
assert.match(markup, /A &amp; B/);
assert.match(markup, /--memory-art:url\('file:\/\/\/art.jpg'\)/);
assert.match(markup, /memory-cascade-cast/);
assert.match(markup, /memory-cascade-shell/);
assert.match(markup, /memory-cascade-board/);
assert.match(markup, /memory-cascade-bus/);
assert.match(markup, /memory-cascade-edge/);
assert.match(markup, /SIGNAL LIVE/);

const tracks = [track('a'), track('b'), track('c')];
assert.equal(mechanic.__test__.centerIndexFor(tracks, 'b'), 1);
assert.equal(mechanic.__test__.centerIndexFor(tracks, null), 0);
assert.equal(mechanic.__test__.centerIndexFor([], null), -1);
assert.equal(mechanic.__test__.tracksEqual(tracks, tracks.map((item) => ({ ...item }))), true);
assert.equal(mechanic.__test__.tracksEqual(tracks, [track('a'), track('c'), track('b')]), false);
assert.match(mechanic.__test__.statusHtml(tracks, 'b'), /02 \/ 03/);
assert.match(mechanic.__test__.statusHtml([], null), /MEMORY CASCADE \/ EMPTY/);

console.log('Memory Cascade audit passed: contract, semantic option markup, escaped content, layered construction, position state, and empty state are correct.');
