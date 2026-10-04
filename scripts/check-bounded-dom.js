const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A library of any size must cost a bounded amount of DOM and a bounded amount
// of work per interaction. These guard the measured fixes: the Canvas
// navigation mechanics mount a window of cards (a 2,000-track library used to
// mount 63,000 elements and spend a second restyling them), the queue renders a
// window around the playing track (10,000 tracks used to block ~650 ms and mount
// ~100,000 nodes on every track change), and track lookup by id is O(1).

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const renderer = read('src/renderer.js');

// 1. Navigation mechanics mount a window, not the library.
for (const name of ['memory-cascade', 'pressure-stack', 'spectral-field', 'carousel', 'cover-flow']) {
  const source = read(`src/theme-runtime/navigation/${name}.js`);
  const radius = Number(/const WINDOW_RADIUS = (\d+);/.exec(source)?.[1]);
  const visible = Number(/const MAX_VISUAL_DISTANCE = (\d+);/.exec(source)?.[1]);
  assert.ok(radius > visible, `${name}: the mounted window (${radius}) must reach past the visible stack (${visible})`);
  assert.ok(radius <= 30, `${name}: the mounted window must stay small`);
  assert.match(source, /function syncWindow\(/, `${name} must slide its window on recenter`);
  assert.doesNotMatch(source, /tracks\.map\(\(track, index\) => (cardHtml|plateHtml|coverHtml)\(/, `${name} must not mount every track`);
  assert.match(source, /currentTracks\.length/, `${name} keeps the full list for status and keyboard`);
}

// 2. The queue renders a window and offers the rest in steps.
assert.match(renderer, /const QUEUE_RENDER_STEP = 200;/);
assert.match(renderer, /queue\.slice\(windowStart, windowEnd\)/, 'the queue list must render a window');
assert.match(renderer, /data-queue-more/, 'the rest of a long queue must be reachable');
assert.match(renderer, /queueRenderLimit = QUEUE_RENDER_STEP;/, 'a new queue starts from the first window');
assert.doesNotMatch(renderer, /priorityIds\.includes\(track\.id\)/, 'queue intent lookups must not scan per row');

// 3. trackById behaves exactly like find() while being indexed.
const match = /let trackIndexSource = null;[\s\S]*?\nfunction trackById\(id\) \{[\s\S]*?\n\}\n/.exec(renderer);
assert.ok(match, 'trackById must stay an indexed lookup');
const state = { tracks: [] };
const context = vm.createContext({ state });
vm.runInContext(`${match[0]}\nthis.trackById = trackById;`, context);
const lookup = (id) => context.trackById(id);
const reference = (id) => state.tracks.find((track) => track.id === id);

state.tracks = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, n: i }));
for (const id of ['t0', 't25', 't49', 'missing']) assert.equal(lookup(id), reference(id));
state.tracks.push({ id: 'late' });
assert.equal(lookup('late'), reference('late'), 'an appended track is found');
state.tracks.splice(3, 1);
for (const id of ['t2', 't3', 't4', 't49', 'late']) assert.equal(lookup(id), reference(id), `after a removal: ${id}`);
state.tracks.reverse();
for (const id of ['t0', 't10', 'late']) assert.equal(lookup(id), reference(id), `after an in-place reorder: ${id}`);
const replacement = { id: 't10', n: 'replaced' };
state.tracks[state.tracks.findIndex((track) => track.id === 't10')] = replacement;
assert.equal(lookup('t10'), replacement, 'a replaced object is returned, not the stale one');
state.tracks[0] = { id: 'swapped' };
assert.equal(lookup('swapped'), state.tracks[0], 'a new id at the same length is found');
assert.equal(lookup(state.tracks[1].id), state.tracks[1]);
state.tracks = [{ id: 'dup', n: 1 }, { id: 'dup', n: 2 }];
assert.equal(lookup('dup').n, 1, 'duplicate ids resolve to the first, like find()');
state.tracks = [];
assert.equal(lookup('anything'), undefined);

console.log('Bounded DOM audit passed: mechanics mount a window past their visible stack, the queue renders a window, and indexed track lookup matches find() through reorders, edits and removals.');
