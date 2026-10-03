const assert = require('node:assert/strict');

const batch = require('../src/library-batch');
const musicBrainz = require('../src/musicbrainz');
const { createLibraryWorkflow } = require('../src/renderer-domains/library-workflow');

// A DOM-less fake: every selector yields one stable element that records
// class, text, value and listeners, which is all the workflow touches.
function createFakeElement() {
  const classes = new Set(['hidden']);
  const handlers = {};
  const children = new Map();
  return {
    dataset: {}, textContent: '', innerHTML: '', value: '', disabled: false, isConnected: true, options: [{ textContent: '' }],
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
      toggle: (name, force) => { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
    },
    addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
    fire(type, event = {}) { (handlers[type] || []).forEach((handler) => handler({ preventDefault() {}, stopPropagation() {}, ...event })); },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, createFakeElement()); return children.get(selector); }, querySelectorAll: () => [], contains: () => false, focus() {}, setAttribute() {},
  };
}

function createHarness(overrides = {}) {
  const elements = new Map();
  const $ = (selector) => { if (!elements.has(selector)) elements.set(selector, createFakeElement()); return elements.get(selector); };
  const tracks = new Map([
    ['a', { id: 'a', title: 'Midnight City', artist: 'M83', album: '', genre: 'Rock', year: null, duration: 243 }],
    ['b', { id: 'b', title: 'Intro', artist: 'M83', album: '', genre: 'Pop', year: null, duration: 80 }],
    ['c', { id: 'c', title: 'Keep', artist: 'M83', album: 'Saved', genre: 'Rock', year: 2011, duration: 200 }],
  ]);
  const playlists = [
    { id: 'p1', name: 'Road', trackIds: ['a'] },
    { id: 'p2', name: 'Gym', trackIds: [] },
  ];
  const log = { queued: [], persisted: 0, toasts: [], changed: [], surfaces: [], removedFrom: [], searches: [], pickers: [], edits: [] };
  const state = { activePlaylistId: 'p1', reorderEnabled: true };
  const bodyClasses = new Set();
  const host = {
    document: { body: { classList: { toggle: (name, force) => { if (force) bodyClasses.add(name); else bodyClasses.delete(name); } } }, querySelector: (selector) => $(selector), querySelectorAll: () => [], activeElement: null },
    $,
    escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    batch,
    musicBrainz,
    trackById: (id) => tracks.get(id) || null,
    persist: () => { log.persisted += 1; },
    showToast: (message) => log.toasts.push(message),
    renderTracks: () => {},
    renderPlaylists: () => {},
    clearSelection: () => { log.cleared = true; },
    queueTracks: (ids, options) => log.queued.push([ids, options]),
    openPlaylistPickerForTracks: (ids) => log.pickers.push(ids),
    editTrackDetails: (id) => log.edits.push(id),
    addTracksToPlaylist: (playlistId, ids) => {
      const playlist = playlists.find((item) => item.id === playlistId);
      const plan = batch.planPlaylistAdd(playlist.trackIds, ids, (id) => tracks.has(id));
      playlist.trackIds.push(...plan.added);
      return { added: plan.added.length, skipped: plan.skipped };
    },
    toastPlaylistAdd: (playlist, result) => log.toasts.push(`playlist ${playlist.name} +${result.added} ~${result.skipped}`),
    playlistById: (id) => playlists.find((playlist) => playlist.id === id) || null,
    activeUserPlaylist: () => playlists.find((playlist) => playlist.id === state.activePlaylistId) || null,
    isDroppablePlaylist: (id) => playlists.some((playlist) => playlist.id === id),
    reorderEnabled: () => state.reorderEnabled,
    normalizeTags: (value) => String(value).split(',').map((tag) => tag.trim()).filter(Boolean),
    normalizeRole: (value) => value,
    metadataChanged: (ids) => log.changed.push(ids),
    canLookUp: () => true,
    musicBrainzSearch: async (query) => { log.searches.push(query); return overrides.search ? overrides.search(query) : { ok: true, candidates: [] }; },
    openSurface: (selector) => log.surfaces.push(['open', selector]),
    closeSurface: (selector) => log.surfaces.push(['close', selector]),
  };
  const workflow = createLibraryWorkflow(host);
  workflow.bind();
  return { workflow, $, tracks, playlists, log, state, bodyClasses };
}

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const barClick = (harness, action) => harness.$('#selectionBar').fire('click', { target: { closest: () => ({ dataset: { selectionAction: action } }) } });

(async () => {
  // Selection bar.
  {
    const h = createHarness();
    h.workflow.setSelection([]);
    assert.equal(h.$('#selectionBar').classList.contains('hidden'), true, 'no selection, no bar');
    h.workflow.setSelection(['a', 'b']);
    assert.equal(h.$('#selectionBar').classList.contains('hidden'), false, 'a selection shows the bar');
    assert.equal(h.$('#selectionCount').textContent, '2 selected');
    barClick(h, 'queue');
    barClick(h, 'play-next');
    assert.deepEqual(h.log.queued, [[['a', 'b'], { next: false }], [['a', 'b'], { next: true }]], 'queue actions pass the selection in list order');
    barClick(h, 'playlist');
    assert.deepEqual(h.log.pickers, [['a', 'b']]);
    barClick(h, 'clear');
    assert.equal(h.log.cleared, true);
    h.workflow.setSelection(['a', 'gone']);
    assert.equal(h.$('#selectionCount').textContent, '1 selected', 'tracks that no longer exist are not counted');
    barClick(h, 'edit');
    assert.deepEqual(h.log.edits, ['a'], 'a single selected track opens the normal editor');

    // Remove from playlist only touches the active user playlist and never the library.
    h.workflow.setSelection(['a']);
    barClick(h, 'remove-from-playlist');
    assert.deepEqual(h.playlists[0].trackIds, [], 'the track leaves the playlist');
    assert.ok(h.tracks.has('a'), 'the track stays in the library');
  }

  // Batch editor.
  {
    const h = createHarness();
    h.workflow.setSelection(['a', 'b']);
    barClick(h, 'edit');
    assert.deepEqual(h.log.surfaces.at(-1), ['open', '#batchEditorOverlay'], 'two selected tracks open the batch editor');
    assert.equal(h.$('#batchEditorTitle').textContent, 'Edit 2 tracks');
    const genre = h.$('#batchEdit-genre');
    assert.equal(genre.dataset.mixed, 'true', 'differing genres are marked mixed');
    assert.equal(h.$('#batchEdit-artist').value, 'M83', 'a shared artist is prefilled');
    h.$('#saveBatchEdit').fire('click');
    assert.match(h.$('#batchEditorError').textContent, /at least one field/, 'applying nothing is refused');
    assert.equal(h.log.changed.length, 0);

    h.$('#batchEdit-year').value = '2011';
    h.$('#batchEdit-userTags').value = 'night, drive';
    h.$('#saveBatchEdit').fire('click');
    assert.equal(h.tracks.get('a').year, 2011);
    assert.equal(h.tracks.get('b').year, 2011);
    assert.equal(h.tracks.get('a').genre, 'Rock', 'a mixed field left alone is untouched');
    assert.equal(h.tracks.get('b').genre, 'Pop');
    assert.deepEqual(h.tracks.get('b').userTags, ['night', 'drive']);
    assert.equal(h.tracks.get('c').year, 2011, 'tracks outside the selection are untouched');
    assert.deepEqual(h.log.changed, [['a', 'b']], 'the renderer is told which tracks changed');
    assert.deepEqual(h.log.surfaces.at(-1), ['close', '#batchEditorOverlay']);
    assert.match(h.log.toasts.at(-1), /Updated 2 tracks/);

    // An invalid value keeps the dialog open with the reason.
    barClick(h, 'edit');
    h.$('#batchEdit-year').value = '99999';
    h.$('#saveBatchEdit').fire('click');
    assert.match(h.$('#batchEditorError').textContent, /Year must be/);
    assert.equal(h.log.changed.length, 1, 'an invalid edit changes nothing');
  }

  // MusicBrainz repair: preview first, nothing written until applied.
  {
    const answer = (query) => (query.title === 'Midnight City'
      ? { ok: true, candidates: [{ mbid: 'r1', mbScore: 99, title: 'Midnight City', artist: 'M83', lengthMs: 243000, isrc: 'FR6V81109950', releases: [{ title: "Hurry Up, We're Dreaming", date: '2011-10-18', status: 'Official', albumArtist: 'M83', trackNumber: 2 }] }] }
      : { ok: true, candidates: [{ mbid: 'r2', mbScore: 30, title: 'Completely Other', artist: 'Someone', lengthMs: 999000, isrc: '', releases: [] }] });
    const h = createHarness({ search: answer });
    h.workflow.setSelection(['a', 'b']);
    barClick(h, 'repair');
    assert.deepEqual(h.log.surfaces.at(-1), ['open', '#metadataRepairOverlay']);
    assert.equal(h.log.searches.length, 0, 'opening the dialog sends nothing');
    assert.match(h.$('#repairSummary').textContent, /2 tracks ready/);
    h.$('#startRepairLookup').fire('click');
    await settle();
    assert.deepEqual(h.log.searches.map((query) => query.title), ['Midnight City', 'Intro'], 'lookups run one after another');
    assert.deepEqual(Object.keys(h.log.searches[0]).sort(), ['album', 'artist', 'duration', 'title'], 'only track text and duration leave the renderer');
    assert.equal(h.tracks.get('a').album, '', 'a lookup alone changes nothing');
    const list = h.$('#repairList').innerHTML;
    assert.match(list, /Strong match/, 'a good match is labelled');
    assert.match(list, /No match found/, 'a poor match is dropped, not offered');
    assert.match(list, /data-repair-field="album" checked/, 'blank fields are pre-ticked');
    assert.equal(h.$('#applyRepair').disabled, false);

    // Untick the album and apply: only the other ticked fields land.
    h.$('#repairList').fire('change', { target: { dataset: { repairRow: '0', repairField: 'album' }, checked: false } });
    h.$('#applyRepair').fire('click');
    const track = h.tracks.get('a');
    assert.equal(track.album, '', 'an unticked field is not applied');
    assert.equal(track.year, 2011);
    assert.equal(track.isrc, 'FR6V81109950');
    assert.equal(track.musicBrainzRecordingId, 'r1');
    assert.equal(h.tracks.get('b').album, '', 'an unmatched track is untouched');
    assert.deepEqual(h.log.changed, [['a']]);
    assert.deepEqual(h.log.surfaces.at(-1), ['close', '#metadataRepairOverlay']);
  }

  // A rate-limit answer stops the run instead of hammering the service.
  {
    const h = createHarness({ search: () => ({ ok: false, code: 'rate-limited' }) });
    h.workflow.openRepair(['a', 'b', 'c']);
    h.$('#startRepairLookup').fire('click');
    await settle();
    assert.equal(h.log.searches.length, 1, 'the run stops after a rate-limit response');
    assert.match(h.$('#repairList').innerHTML, /slow down/);
    assert.equal(h.$('#applyRepair').disabled, true, 'nothing to apply');
    assert.equal(h.$('#startRepairLookup').classList.contains('hidden'), false, 'the person can try the rest later');
  }

  // Closing mid-run abandons it without applying anything.
  {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = createHarness({ search: async () => { await gate; return { ok: true, candidates: [] }; } });
    h.workflow.openRepair(['a', 'b']);
    h.$('#startRepairLookup').fire('click');
    await settle();
    h.$('#closeMetadataRepair').fire('click');
    release();
    await settle();
    assert.equal(h.log.searches.length, 1, 'closing the dialog stops further lookups');
    assert.equal(h.workflow.isRepairOpen(), false);
    assert.equal(h.log.changed.length, 0);
  }

  // Drag and drop.
  {
    const h = createHarness();
    h.workflow.setDragIds(['b', 'c']);
    assert.equal(h.bodyClasses.has('is-dragging-tracks'), true, 'a drag marks the page so targets can show themselves');
    const item = (id) => ({ dataset: { playlist: id }, classList: { add() {}, remove() {} }, contains: () => false });
    const dropEvent = (id, extras = {}) => ({ target: { closest: (selector) => (selector.includes('playlist-item') ? item(id) : null) }, dataTransfer: { dropEffect: '' }, shiftKey: false, ...extras });
    const prevented = [];
    h.$('#playlistList').fire('dragover', dropEvent('p2', { preventDefault: () => prevented.push('over') }));
    assert.deepEqual(prevented, ['over'], 'user playlists accept a drag');
    h.$('#playlistList').fire('dragover', dropEvent('smart:cleanup', { preventDefault: () => prevented.push('bad') }));
    assert.deepEqual(prevented, ['over'], 'virtual collections do not accept a drag');
    h.$('#playlistList').fire('drop', dropEvent('p2'));
    assert.deepEqual(h.playlists[1].trackIds, ['b', 'c'], 'a drop copies the tracks in');
    assert.deepEqual(h.playlists[0].trackIds, ['a'], 'copying leaves the source playlist alone');
    assert.equal(h.bodyClasses.has('is-dragging-tracks'), false, 'the drag ends with the drop');
    h.$('#playlistList').fire('drop', dropEvent('p2'));
    assert.deepEqual(h.playlists[1].trackIds, ['b', 'c'], 'a drop with no active drag does nothing');

    h.workflow.setDragIds(['a']);
    h.$('#playlistList').fire('drop', dropEvent('p2', { shiftKey: true }));
    assert.deepEqual(h.playlists[1].trackIds, ['b', 'c', 'a'], 'Shift+drop adds to the target');
    assert.deepEqual(h.playlists[0].trackIds, [], 'Shift+drop also takes the track out of the playlist it came from');
    assert.ok(h.tracks.has('a'), 'moving never deletes from the library');

    h.workflow.setDragIds(['b']);
    h.$('#queueButton').fire('drop', { dataTransfer: {} });
    assert.deepEqual(h.log.queued.at(-1), [['b'], { next: false }], 'dropping on the queue button queues the tracks');

    // Reorder inside the active playlist.
    h.playlists[0].trackIds = ['a', 'b', 'c'];
    h.workflow.reorderDrop(['c'], 'a', 'before');
    assert.deepEqual(h.playlists[0].trackIds, ['c', 'a', 'b']);
    h.state.reorderEnabled = false;
    h.workflow.reorderDrop(['b'], 'c', 'before');
    assert.deepEqual(h.playlists[0].trackIds, ['c', 'a', 'b'], 'reordering is refused when the list is not in playlist order');
  }

  console.log('Library workflow audit passed: selection bar, batch editor, MusicBrainz repair review, and drag-and-drop behave as designed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
