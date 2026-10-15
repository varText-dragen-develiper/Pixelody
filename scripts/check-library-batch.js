const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const batch = require('../src/library-batch');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// What the editor shows across a selection.
const tracks = [
  { id: 'a', artist: 'Band', album: 'One', genre: 'Rock', year: 1999, userTags: ['focus'] },
  { id: 'b', artist: 'Band', album: 'Two', genre: 'Rock', year: null, userTags: [] },
];
assert.deepEqual(batch.commonValue(tracks, 'artist'), { mixed: false, value: 'Band' }, 'agreeing tracks show the shared value');
assert.equal(batch.commonValue(tracks, 'album').mixed, true, 'differing tracks are mixed');
assert.equal(batch.commonValue(tracks, 'year').mixed, true, 'a blank year differs from a set year');
assert.deepEqual(batch.commonValue([], 'artist'), { mixed: false, value: '' });

// Planning: only dirty fields, validated.
const helpers = { normalizeTags: (value) => String(value).split(',').map((tag) => tag.trim()).filter(Boolean), normalizeRole: (value) => (['anchor', 'peak'].includes(value) ? value : '') };
let plan = batch.planBatchEdit({ album: { dirty: false, value: 'ignored' }, genre: { dirty: true, value: '  Jazz ' } }, helpers);
assert.deepEqual(plan.fields, ['genre'], 'untouched fields are not applied');
assert.deepEqual(plan.patch.genre, { mode: 'set', value: 'Jazz' }, 'values are trimmed');
plan = batch.planBatchEdit({ artist: { dirty: true, value: '' }, album: { dirty: true, value: '' } }, helpers);
assert.equal(plan.patch.artist.value, 'Unknown artist', 'a cleared artist falls back like the single-track editor');
assert.equal(plan.patch.album.value, '', 'other cleared text fields empty out');
plan = batch.planBatchEdit({ year: { dirty: true, value: '19x9' }, energyLevel: { dirty: true, value: '140' } }, helpers);
assert.equal(plan.errors.length, 2, 'bad numbers are reported, not applied');
assert.deepEqual(plan.fields, [], 'errors leave no partial patch');
plan = batch.planBatchEdit({ year: { dirty: true, value: '1999.5' } }, helpers);
assert.equal(plan.errors.length, 1, 'a year must be a whole number');
plan = batch.planBatchEdit({ year: { dirty: true, value: '' }, energyLevel: { dirty: true, value: '40' } }, helpers);
assert.deepEqual([plan.patch.year.value, plan.patch.energyLevel.value], [null, 40], 'blank numbers clear, valid numbers apply');
plan = batch.planBatchEdit({ userTags: { dirty: true, value: 'Night, ' }, moodTags: { dirty: true, value: '' }, listeningRole: { dirty: true, value: 'peak' } }, helpers);
assert.deepEqual(plan.fields.sort(), ['listeningRole', 'userTags'], 'empty tag input adds nothing');
assert.equal(plan.patch.userTags.mode, 'add', 'tags only ever add');
assert.equal(batch.planBatchEdit({ title: { dirty: true, value: 'Nope' }, trackNumber: { dirty: true, value: '3' } }, helpers).fields.length, 0, 'per-track fields are not batch-editable');
assert.ok(!batch.BATCH_FIELDS.some((field) => ['title', 'trackNumber', 'discNumber', 'isrc'].includes(field.key)), 'title, track number, disc number and ISRC stay per-track');

// Applying.
const target = { id: 'a', genre: 'Rock', userTags: ['Focus'] };
plan = batch.planBatchEdit({ genre: { dirty: true, value: 'Jazz' }, userTags: { dirty: true, value: 'focus, night' } }, helpers);
assert.equal(batch.applyBatchEdit(target, plan), true, 'a real change is reported');
assert.equal(target.genre, 'Jazz');
assert.deepEqual(target.userTags, ['Focus', 'night'], 'added tags are de-duplicated case-insensitively');
assert.equal(target.localMetadataOverride, true, 'edited tracks are marked as locally overridden');
const untouched = { id: 'b', genre: 'Jazz', userTags: ['night', 'focus'] };
assert.equal(batch.applyBatchEdit(untouched, plan), false, 'applying the same plan twice changes nothing');
assert.equal(untouched.localMetadataOverride, undefined, 'unchanged tracks are not marked');

// Playlist drops copy, skip duplicates, and ignore unknown tracks.
assert.deepEqual(batch.planPlaylistAdd(['a', { id: 'b' }], ['a', 'c', 'c', 'b', 'd'], (id) => id !== 'd'), { added: ['c'], skipped: 3 }, 'tracks already present or repeated in the drag are skipped');
assert.deepEqual(batch.planPlaylistAdd(undefined, ['x']), { added: ['x'], skipped: 0 });

// Reordering keeps relative order and handles object entries.
const list = ['a', 'b', 'c', 'd', 'e'];
assert.deepEqual(batch.reorderPlaylistEntries(list, ['d', 'b'], 'a', 'before'), ['b', 'd', 'a', 'c', 'e'], 'moved tracks keep their list order');
assert.deepEqual(batch.reorderPlaylistEntries(list, ['a'], 'c', 'after'), ['b', 'c', 'a', 'd', 'e']);
assert.deepEqual(batch.reorderPlaylistEntries(list, ['e'], 'a', 'after'), ['a', 'e', 'b', 'c', 'd']);
assert.equal(batch.reorderPlaylistEntries(list, ['b'], 'c', 'before'), null, 'a drop that changes nothing is reported as such');
assert.equal(batch.reorderPlaylistEntries(list, ['b', 'c'], 'c', 'before'), null, 'dropping onto a moving track is refused');
assert.equal(batch.reorderPlaylistEntries(list, ['b'], 'zzz', 'before'), null, 'an unknown target is refused');
assert.equal(batch.reorderPlaylistEntries(list, ['zzz'], 'a', 'before'), null, 'unknown moving tracks are refused');
const objects = [{ id: 'a', note: 1 }, { id: 'b' }, { id: 'c' }];
const reordered = batch.reorderPlaylistEntries(objects, ['c'], 'a', 'before');
assert.deepEqual(reordered.map((entry) => entry.id), ['c', 'a', 'b']);
assert.equal(reordered[1], objects[0], 'entries move as the same objects');

// Drag payload.
assert.deepEqual(batch.draggedTrackIds('b', ['a', 'b', 'c']), ['a', 'b', 'c'], 'dragging inside a selection takes it all');
assert.deepEqual(batch.draggedTrackIds('z', ['a', 'b', 'c']), ['z'], 'dragging outside a selection takes one row');
assert.deepEqual(batch.draggedTrackIds('a', ['a']), ['a']);
assert.equal(batch.describeCount(1, 'track'), '1 track');
assert.equal(batch.describeCount(2, 'track'), '2 tracks');

// Wiring the renderer must keep.
const renderer = read('src/renderer.js');
const html = read('src/index.html');
const mechanic = read('src/theme-runtime/navigation/linear-list.js');
for (const id of ['selectionBar', 'selectionCount', 'batchEditorOverlay', 'batchEditorGrid', 'saveBatchEdit', 'metadataRepairOverlay', 'repairList', 'startRepairLookup', 'applyRepair']) {
  assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
}
for (const action of ['play-next', 'queue', 'playlist', 'edit', 'repair', 'remove-from-playlist', 'clear']) {
  assert.ok(html.includes(`data-selection-action="${action}"`), `selection bar is missing ${action}`);
}
assert.match(html, /data-track-action="repair"/, 'track menu must offer MusicBrainz repair');
for (const script of ['library-batch.js', 'musicbrainz.js', 'renderer-domains/library-workflow.js']) {
  assert.ok(html.includes(`<script src="${script}"></script>`), `${script} must load before renderer.js`);
  assert.ok(html.indexOf(`src="${script}"`) < html.indexOf('src="renderer.js"'), `${script} must load before renderer.js`);
}
assert.ok(html.includes('href="library-workflow.css"'), 'index.html must load library-workflow.css');
assert.match(renderer, /onMultiSelectionChange: \(ids\) => libraryWorkflow\.setSelection\(ids\)/, 'the track list must report selection changes to the workflow');
assert.match(renderer, /canReorder: \(\) => playlistReorderEnabled\(\)/, 'row reordering must follow the existing playlist-order rule');
assert.match(renderer, /'#batchEditorOverlay', '#metadataRepairOverlay'/, 'new dialogs must take part in the Tab focus trap');
assert.match(mechanic, /draggable="true"/, 'rows must be draggable');
assert.match(mechanic, /aria-multiselectable/, 'the list must announce multi-selection');
// Dropping on a playlist must only ever copy tracks in, never create or rename playlists.
assert.match(read('src/renderer-domains/library-workflow.js'), /host\.isDroppablePlaylist\(playlistId\)/, 'only real user playlists accept drops');
assert.match(renderer, /function playlistReorderEnabled\(\)/, 'playlistReorderEnabled must still gate reordering');

console.log('Library batch audit passed: batch edit rules, playlist drops, reordering, and renderer wiring are intact.');
