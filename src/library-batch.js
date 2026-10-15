(function pixelodyLibraryBatchFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyLibraryBatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLibraryBatchModule() {
  'use strict';

  // Pure helpers for library-wide actions on several tracks at once: the
  // batch metadata editor and playlist drag-and-drop. Nothing here touches the
  // DOM, storage, or the network, so the rules are testable without a window.

  // Title, track number and disc number are per-track facts, so they are not
  // batch-editable. Tag fields only ever add: a bulk "replace" would silently
  // destroy tags the user cannot see on the other selected tracks.
  const BATCH_FIELDS = Object.freeze([
    { key: 'artist', label: 'Artist', type: 'text', clearsTo: 'Unknown artist', max: 240 },
    { key: 'albumArtist', label: 'Album artist', type: 'text', max: 240 },
    { key: 'album', label: 'Album', type: 'text', max: 240 },
    { key: 'genre', label: 'Genre', type: 'text', max: 120 },
    { key: 'year', label: 'Year', type: 'number', min: 0, max: 9999, integer: true },
    { key: 'composer', label: 'Composer', type: 'text', max: 240 },
    { key: 'label', label: 'Label', type: 'text', max: 240 },
    { key: 'energyLevel', label: 'Energy', type: 'number', min: 0, max: 100 },
    { key: 'listeningRole', label: 'Listening role', type: 'role' },
    { key: 'userTags', label: 'Add user tags', type: 'tags' },
    { key: 'moodTags', label: 'Add mood tags', type: 'tags' },
    { key: 'contextTags', label: 'Add context tags', type: 'tags' },
  ]);

  const FIELD_BY_KEY = new Map(BATCH_FIELDS.map((field) => [field.key, field]));

  function sameValue(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left || []) === JSON.stringify(right || []);
    return (left ?? '') === (right ?? '');
  }

  // What the editor should show for a field across the selection: the shared
  // value when every track agrees, otherwise "mixed" (shown as a placeholder,
  // and left alone unless the user types something).
  function commonValue(tracks, key) {
    if (!tracks.length) return { mixed: false, value: '' };
    const first = tracks[0][key];
    const mixed = tracks.some((track) => !sameValue(track[key], first));
    return { mixed, value: mixed ? '' : (first ?? '') };
  }

  // form: { [key]: { dirty: boolean, value: string } }. Only dirty fields are
  // applied; a dirty blank clears the field (artist falls back to the same
  // "Unknown artist" the single-track editor uses).
  function planBatchEdit(form = {}, helpers = {}) {
    const normalizeTags = helpers.normalizeTags || ((value) => String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean));
    const normalizeRole = helpers.normalizeRole || ((value) => String(value || ''));
    const patch = {};
    const errors = [];
    for (const field of BATCH_FIELDS) {
      const entry = form[field.key];
      if (!entry || !entry.dirty) continue;
      const raw = String(entry.value ?? '').trim();
      if (field.type === 'text') {
        patch[field.key] = { mode: 'set', value: raw ? raw.slice(0, field.max) : (field.clearsTo || '') };
      } else if (field.type === 'number') {
        if (!raw) { patch[field.key] = { mode: 'set', value: null }; continue; }
        const number = Number(raw);
        const valid = Number.isFinite(number) && number >= field.min && number <= field.max && (!field.integer || Number.isInteger(number));
        if (valid) patch[field.key] = { mode: 'set', value: number };
        else errors.push({ key: field.key, message: `${field.label} must be a ${field.integer ? 'whole ' : ''}number from ${field.min} to ${field.max}.` });
      } else if (field.type === 'role') {
        patch[field.key] = { mode: 'set', value: normalizeRole(raw) };
      } else if (field.type === 'tags') {
        const tags = normalizeTags(raw);
        if (tags.length) patch[field.key] = { mode: 'add', value: tags };
      }
    }
    return { patch, errors, fields: Object.keys(patch) };
  }

  // Applies a plan to one track in place and reports whether anything changed.
  function applyBatchEdit(track, plan) {
    let changed = false;
    for (const key of plan.fields) {
      const { mode, value } = plan.patch[key];
      if (mode === 'add') {
        const current = Array.isArray(track[key]) ? track[key] : [];
        const known = new Set(current.map((tag) => String(tag).toLowerCase()));
        const next = current.concat(value.filter((tag) => !known.has(String(tag).toLowerCase())));
        if (next.length !== current.length) { track[key] = next; changed = true; }
      } else if (!sameValue(track[key], value)) {
        track[key] = value;
        changed = true;
      }
    }
    if (changed) track.localMetadataOverride = true;
    return changed;
  }

  function entryId(entry) {
    return entry && typeof entry === 'object' ? entry.id : entry;
  }

  // Dropping tracks on a playlist copies them: tracks already present are
  // skipped, and a track dragged twice counts once.
  function planPlaylistAdd(playlistEntries, draggedIds, isKnownTrack = () => true) {
    const present = new Set((playlistEntries || []).map(entryId));
    const added = [];
    let skipped = 0;
    for (const id of draggedIds || []) {
      if (!isKnownTrack(id)) continue;
      if (present.has(id)) { skipped += 1; continue; }
      present.add(id);
      added.push(id);
    }
    return { added, skipped };
  }

  // Moves the dragged tracks (kept in their current relative order) to sit
  // before or after the target track. Playlist entries may be bare ids or
  // objects with an id; the entries themselves are what move. Returns null
  // when the drop would change nothing.
  function reorderPlaylistEntries(entries, movingIds, targetId, position = 'before') {
    const list = Array.isArray(entries) ? entries : [];
    const moving = new Set(movingIds || []);
    if (!moving.size || moving.has(targetId)) return null;
    if (!list.some((entry) => entryId(entry) === targetId)) return null;
    const moved = list.filter((entry) => moving.has(entryId(entry)));
    if (!moved.length) return null;
    const rest = list.filter((entry) => !moving.has(entryId(entry)));
    const at = rest.findIndex((entry) => entryId(entry) === targetId);
    const next = rest.slice();
    next.splice(position === 'after' ? at + 1 : at, 0, ...moved);
    return next.every((entry, index) => entry === list[index]) ? null : next;
  }

  // Dragging from inside a selection takes the whole selection; dragging an
  // unselected row takes just that row.
  function draggedTrackIds(rowId, selectedIds) {
    return selectedIds && selectedIds.length > 1 && selectedIds.includes(rowId) ? selectedIds.slice() : [rowId];
  }

  function describeCount(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  return Object.freeze({
    BATCH_FIELDS,
    FIELD_BY_KEY,
    applyBatchEdit,
    commonValue,
    describeCount,
    draggedTrackIds,
    planBatchEdit,
    planPlaylistAdd,
    reorderPlaylistEntries,
  });
}));
