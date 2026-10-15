const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('src/index.html');
const miniHtml = read('src/mini-player.html');
const renderer = read('src/renderer.js');
const css = read('src/axis-break.css');
const miniCss = read('src/mini-axis-break.css');
const manifest = JSON.parse(read('src/themes/axis-break.theme.json'));
const fixture = JSON.parse(read('scripts/fixtures/axis-break-stress-library.json'));

assert.equal(manifest.id, 'pixelody.axis-break');
assert.equal(manifest.navigation.trackBrowser, 'linear-list');
assert.match(html, /class="axis-break-hud" aria-hidden="true"><i><\/i><i><\/i><i><\/i>/);
assert.match(html, /class="axis-cutaway-mask" aria-hidden="true">/);
assert.match(miniHtml, /class="axis-mini-mask" aria-hidden="true">/);
assert.match(miniHtml, /class="axis-mini-breakline" aria-hidden="true"><i><\/i><i><\/i><i><\/i>/);
assert.match(renderer, /'axis-break': \{ gold: '#d83e2a'/);
assert.match(renderer, /'axis-break': 'linear-list'/);
assert.match(renderer, /'axis-break': \['axis-break\.css'\]/);

assert.match(css, /body\[data-theme="axis-break"\]\.is-playing \.track-row\.playing::after/);
assert.match(css, /content: "SIGNAL LIVE"/);
assert.match(css, /content: "CURRENT \/ PAUSED"/);
assert.match(css, /\.track-row\.is-selected:not\(\.playing\)/);
assert.match(css, /body\[data-theme="axis-break"\]\.is-playing \.collection-body::before/);
assert.match(miniCss, /body\[data-theme="axis-break"\]\.playing \.axis-mini-breakline i:nth-child\(3\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /data-performance="conserve"/);
assert.doesNotMatch(css + miniCss, /url\(\s*["']?(?:https?:|file:)/i);

assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.tracks.length, 8);
assert.deepEqual(new Set(fixture.tracks.map((track) => track.artRole)), new Set(['bright','dark','near-black','high-key','neutral','missing','graphic','low-contrast']));
assert.ok(fixture.collection.title.length >= 70);
assert.match(fixture.collection.title, /[^\x00-\x7F]/);
assert.equal(fixture.states.selectedTrackId, 'ab-track-02');
assert.equal(fixture.states.currentTrackId, 'ab-track-03');
assert.equal(fixture.states.confirmedPlayingTrackId, 'ab-track-03');
assert.notEqual(fixture.states.selectedTrackId, fixture.states.currentTrackId);
assert.deepEqual(Object.keys(fixture.systemStates).sort(), ['empty','error','loading']);

console.log('Axis Break C3 checks passed: scoped slots, linear-list contract, state-gated breakline, hostile fixture, motion fallbacks, and provenance boundary are present.');
