(function pixelodyLibraryWorkflowFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyLibraryWorkflow = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLibraryWorkflowModule() {
  'use strict';

  // Library workflow: acting on several tracks at once. Owns the selection
  // bar, the batch metadata editor, the MusicBrainz repair review, and what a
  // track drag means when it lands on a playlist, the queue, or another row.
  // The track list itself (which rows are selected, the drag gesture) lives in
  // theme-runtime/navigation/linear-list.js; pure rules live in
  // src/library-batch.js and src/musicbrainz.js. Everything the renderer owns
  // arrives through `host`, as with the other renderer domains.

  const MAX_REPAIR_TRACKS = 100;
  const LOOKUP_ERRORS = Object.freeze({
    'rate-limited': 'MusicBrainz asked Pixelody to slow down. Try again in a minute.',
    timeout: 'MusicBrainz did not answer in time.',
    network: 'Could not reach MusicBrainz. Check your connection.',
    'http-error': 'MusicBrainz returned an error.',
    'bad-query': 'This track has no title to search for.',
    unauthorized: 'Lookup is not available here.',
  });

  function createLibraryWorkflow(host) {
    const batch = host.batch;
    const musicBrainz = host.musicBrainz;
    const $ = host.$;
    const escapeHtml = host.escapeHtml;
    const document = host.document;
    let selection = [];
    let dragIds = null;
    let batchIds = [];
    let batchOpener = null;
    let repair = null;

    // ---- Selection bar ---------------------------------------------------
    function syncBar() {
      const bar = $('#selectionBar');
      if (!bar) return;
      if (!selection.length) { if (!bar.classList.contains('hidden')) bar.classList.add('hidden'); return; }
      const live = selection.filter((id) => host.trackById(id));
      bar.classList.toggle('hidden', live.length === 0);
      if (!live.length) return;
      $('#selectionCount').textContent = `${live.length.toLocaleString()} selected`;
      bar.querySelector('[data-selection-action="remove-from-playlist"]')?.classList.toggle('hidden', !host.activeUserPlaylist());
      bar.querySelector('[data-selection-action="edit"]').textContent = live.length === 1 ? 'Edit details' : 'Edit details together';
    }

    function setSelection(ids) {
      selection = ids.slice();
      syncBar();
      host.announce?.(selection.length ? `${selection.length} track${selection.length === 1 ? '' : 's'} selected` : 'Selection cleared');
    }

    function handleBarAction(action, button) {
      const ids = selection.filter((id) => host.trackById(id));
      if (!ids.length && action !== 'clear') return;
      if (action === 'clear') host.clearSelection();
      else if (action === 'play-next') host.queueTracks(ids, { next: true });
      else if (action === 'queue') host.queueTracks(ids, { next: false });
      else if (action === 'playlist') host.openPlaylistPickerForTracks(ids, button);
      else if (action === 'edit') (ids.length === 1 ? host.editTrackDetails(ids[0]) : openBatchEditor(ids, button));
      else if (action === 'repair') openRepair(ids, button);
      else if (action === 'remove-from-playlist') removeFromActivePlaylist(ids);
    }

    function removeFromActivePlaylist(ids) {
      const playlist = host.activeUserPlaylist();
      if (!playlist || !Array.isArray(playlist.trackIds)) return;
      const doomed = new Set(ids);
      const before = playlist.trackIds.length;
      playlist.trackIds = playlist.trackIds.filter((entry) => !doomed.has(entry && typeof entry === 'object' ? entry.id : entry));
      const removed = before - playlist.trackIds.length;
      if (!removed) return;
      host.persist();
      host.renderPlaylists();
      host.renderTracks({ preserveOrder: true });
      host.showToast(`Removed ${batch.describeCount(removed, 'track')} from ${playlist.name}. They stay in your library.`);
    }

    // ---- Batch editor ----------------------------------------------------
    const fieldInputId = (key) => `batchEdit-${key}`;

    function buildBatchGrid() {
      const grid = $('#batchEditorGrid');
      if (!grid || grid.dataset.built) return;
      grid.dataset.built = 'true';
      grid.innerHTML = batch.BATCH_FIELDS.map((field) => {
        const id = fieldInputId(field.key);
        let control;
        if (field.type === 'role') {
          const options = $('#editTrackRole')?.innerHTML || '<option value="">Unassigned</option>';
          control = `<select id="${id}" data-batch-field="${field.key}"><option value="__keep">Keep current</option>${options}</select>`;
        } else if (field.type === 'number') {
          control = `<input id="${id}" data-batch-field="${field.key}" type="number" min="${field.min}" max="${field.max}">`;
        } else {
          control = `<input id="${id}" data-batch-field="${field.key}" type="text"${field.type === 'tags' ? ' placeholder="night drive, focus"' : ''}>`;
        }
        return `<label for="${id}">${escapeHtml(field.label)}${control}<small class="batch-field-note" id="${id}-note" aria-live="polite"></small></label>`;
      }).join('');
      grid.addEventListener('input', (event) => markDirty(event.target));
      grid.addEventListener('change', (event) => markDirty(event.target));
    }

    function fieldElement(key) { return $(`#${fieldInputId(key)}`); }

    // A text or number field is changed once it differs from what the editor
    // opened with. A field whose values are mixed starts blank and is left
    // alone until something is typed; a shared value that is emptied on
    // purpose clears the field.
    function isDirty(field, element) {
      if (field.type === 'role') return element.value !== '__keep';
      if (element.dataset.mixed) return element.value.trim() !== '';
      return element.value !== element.dataset.initial;
    }

    function markDirty(element) {
      const key = element?.dataset?.batchField;
      if (!key) return;
      element.dataset.dirty = isDirty(batch.FIELD_BY_KEY.get(key), element) ? 'true' : '';
      updateNote(key);
    }

    function updateNote(key) {
      const element = fieldElement(key);
      const field = batch.FIELD_BY_KEY.get(key);
      const note = $(`#${fieldInputId(key)}-note`);
      if (!element || !note) return;
      const dirty = element.dataset.dirty === 'true';
      let text = '';
      if (dirty) {
        text = field.type === 'tags' ? 'Will be added to every selected track' : (field.type === 'role' ? 'Will change' : (element.value.trim() === '' ? 'Will be cleared' : 'Will change'));
      } else if (element.dataset.mixed) text = 'Mixed values stay as they are';
      note.textContent = text;
      note.classList.toggle('is-active', dirty);
    }

    function openBatchEditor(ids, opener) {
      batchIds = ids.slice();
      batchOpener = opener || document.activeElement;
      buildBatchGrid();
      const tracks = batchIds.map(host.trackById).filter(Boolean);
      for (const field of batch.BATCH_FIELDS) {
        const element = fieldElement(field.key);
        if (!element) continue;
        element.dataset.dirty = '';
        element.dataset.mixed = '';
        element.dataset.initial = '';
        if (field.type === 'tags') { element.value = ''; element.placeholder = 'night drive, focus'; }
        else if (field.type === 'role') {
          const common = batch.commonValue(tracks, field.key);
          element.value = '__keep';
          element.dataset.mixed = common.mixed ? 'true' : '';
          element.options[0].textContent = common.mixed ? 'Mixed - keep current' : 'Keep current';
        } else {
          const common = batch.commonValue(tracks, field.key);
          element.value = common.mixed ? '' : String(common.value ?? '');
          element.dataset.initial = element.value;
          element.dataset.mixed = common.mixed ? 'true' : '';
          element.placeholder = common.mixed ? 'Mixed - leave blank to keep' : '';
        }
        updateNote(field.key);
      }
      const noun = batch.describeCount(tracks.length, 'track');
      $('#batchEditorTitle').textContent = `Edit ${noun}`;
      $('#saveBatchEdit').textContent = `Apply to ${noun}`;
      showError($('#batchEditorError'), '');
      host.openSurface('#batchEditorOverlay');
      setTimeout(() => $('#batchEditorGrid input, #batchEditorGrid select')?.focus(), 0);
    }

    function showError(element, message) {
      if (!element) return;
      element.textContent = message;
      element.classList.toggle('hidden', !message);
    }

    function readBatchForm() {
      const form = {};
      for (const field of batch.BATCH_FIELDS) {
        const element = fieldElement(field.key);
        if (!element) continue;
        form[field.key] = { dirty: isDirty(field, element), value: element.value };
      }
      return form;
    }

    function applyBatchEditor() {
      const tracks = batchIds.map(host.trackById).filter(Boolean);
      const plan = batch.planBatchEdit(readBatchForm(), { normalizeTags: host.normalizeTags, normalizeRole: host.normalizeRole });
      if (plan.errors.length) { showError($('#batchEditorError'), plan.errors.map((error) => error.message).join(' ')); return; }
      if (!plan.fields.length) { showError($('#batchEditorError'), 'Change at least one field first.'); return; }
      let changedTracks = 0;
      for (const track of tracks) if (batch.applyBatchEdit(track, plan)) changedTracks += 1;
      closeSurface('#batchEditorOverlay');
      if (changedTracks) host.metadataChanged(tracks.map((track) => track.id));
      host.showToast(changedTracks ? `Updated ${batch.describeCount(changedTracks, 'track')}. Original files are untouched.` : 'Those tracks already had these details.');
    }

    // ---- Overlay plumbing -------------------------------------------------
    function closeSurface(selector) {
      host.closeSurface(selector);
      const opener = selector === '#batchEditorOverlay' ? batchOpener : repair?.opener;
      if (opener?.isConnected) setTimeout(() => opener.focus?.({ preventScroll: true }), 0);
    }

    // ---- MusicBrainz repair ------------------------------------------------
    function openRepair(ids, opener) {
      const tracks = ids.map(host.trackById).filter(Boolean).slice(0, MAX_REPAIR_TRACKS);
      if (!tracks.length) return;
      if (!host.canLookUp()) { host.showToast('MusicBrainz lookup is not available in this build.'); return; }
      repair = {
        opener: opener || document.activeElement,
        running: false,
        cancelled: false,
        truncated: ids.length > tracks.length,
        rows: tracks.map((track) => ({ id: track.id, status: 'ready', message: '', candidates: [], chosen: 0, proposal: null })),
      };
      renderRepair();
      host.openSurface('#metadataRepairOverlay');
      setTimeout(() => $('#startRepairLookup')?.focus(), 0);
    }

    function selectedFieldCount() {
      let fields = 0;
      let tracks = 0;
      for (const row of repair?.rows || []) {
        const count = row.proposal ? row.proposal.fields.filter((field) => field.checked).length : 0;
        if (count) { fields += count; tracks += 1; }
      }
      return { fields, tracks };
    }

    function candidateLabel(candidate) {
      const release = (candidate.releases || [])[0];
      const detail = [release?.title, release?.date ? release.date.slice(0, 4) : ''].filter(Boolean).join(', ');
      return `${candidate.confidence}% - ${candidate.title} by ${candidate.artist || 'unknown artist'}${detail ? ` (${detail})` : ''}`;
    }

    function rowHtml(row, index) {
      const track = host.trackById(row.id);
      const head = `<div class="repair-track"><strong>${escapeHtml(track?.title || 'Track')}</strong><span>${escapeHtml(track?.artist || '')}${track?.album ? ` - ${escapeHtml(track.album)}` : ''}</span></div>`;
      let body = '';
      if (row.status === 'ready') body = '<p class="repair-status">Not looked up yet.</p>';
      else if (row.status === 'searching') body = '<p class="repair-status" aria-live="polite">Searching...</p>';
      else if (row.status === 'nomatch') body = '<p class="repair-status">No match found. Nothing will change.</p>';
      else if (row.status === 'error' || row.status === 'skipped') body = `<p class="repair-status is-error">${escapeHtml(row.message)}</p>`;
      else if (row.status === 'done') {
        const options = row.candidates.length > 1
          ? `<label class="repair-candidate">Match<select data-repair-candidate="${index}">${row.candidates.map((candidate, at) => `<option value="${at}"${at === row.chosen ? ' selected' : ''}>${escapeHtml(candidateLabel(candidate))}</option>`).join('')}</select></label>`
          : `<p class="repair-status">Match: ${escapeHtml(candidateLabel(row.candidates[0]))}</p>`;
        const proposal = row.proposal;
        const level = proposal.level;
        const levelNote = level === 'low' ? 'Low confidence - check carefully before applying.' : level === 'medium' ? 'Likely match.' : 'Strong match.';
        const fields = proposal.fields.length
          ? `<ul class="repair-fields">${proposal.fields.map((field) => `<li><label><input type="checkbox" data-repair-row="${index}" data-repair-field="${field.key}"${field.checked ? ' checked' : ''}> <span class="repair-field-name">${escapeHtml(field.label)}</span> <span class="repair-diff">${field.kind === 'fill' ? 'adds' : `${escapeHtml(String(field.current))} &rarr;`} <b>${escapeHtml(String(field.proposed))}</b></span></label></li>`).join('')}</ul>`
          : '<p class="repair-status">Already matches. Nothing to change.</p>';
        body = `${options}<p class="repair-level" data-level="${level}">${levelNote}</p>${fields}`;
      }
      return `<li class="repair-item" data-status="${row.status}">${head}${body}</li>`;
    }

    function renderRepair() {
      if (!repair) return;
      const total = repair.rows.length;
      const finished = repair.rows.filter((row) => !['ready', 'searching'].includes(row.status)).length;
      const { fields, tracks } = selectedFieldCount();
      $('#repairList').innerHTML = repair.rows.map(rowHtml).join('');
      $('#repairSummary').textContent = repair.running
        ? `Looking up ${finished + 1 > total ? total : finished + 1} of ${total}...`
        : finished === 0
          ? `${batch.describeCount(total, 'track')} ready to look up.${repair.truncated ? ` Only the first ${MAX_REPAIR_TRACKS} were taken.` : ''}`
          : `Looked up ${finished} of ${total}. ${fields ? `${batch.describeCount(fields, 'change')} ticked on ${batch.describeCount(tracks, 'track')}.` : 'Nothing ticked yet.'}`;
      $('#startRepairLookup').classList.toggle('hidden', repair.running || finished === total);
      $('#startRepairLookup').textContent = finished ? 'Look up the rest' : `Look up ${batch.describeCount(total, 'track')}`;
      $('#cancelRepairLookup').classList.toggle('hidden', !repair.running);
      $('#applyRepair').disabled = repair.running || fields === 0;
      $('#applyRepair').textContent = fields ? `Apply ${batch.describeCount(fields, 'change')}` : 'Apply ticked changes';
    }

    function rebuildProposal(row) {
      const track = host.trackById(row.id);
      const candidate = row.candidates[row.chosen];
      if (!track || !candidate) { row.proposal = null; return; }
      row.proposal = musicBrainz.buildProposal(track, candidate);
      // A weak match never pre-ticks anything: the person has to opt in.
      if (row.proposal.level === 'low') row.proposal.fields.forEach((field) => { field.checked = false; });
    }

    async function runRepairLookups() {
      if (!repair || repair.running) return;
      repair.running = true;
      repair.cancelled = false;
      const run = repair;
      renderRepair();
      for (const row of run.rows) {
        if (run.cancelled) break;
        if (row.status === 'done' || row.status === 'nomatch') continue;
        const track = host.trackById(row.id);
        if (!track || !String(track.title || '').trim()) { row.status = 'skipped'; row.message = 'This track needs a title before it can be looked up.'; renderRepair(); continue; }
        row.status = 'searching';
        renderRepair();
        let result;
        try {
          result = await host.musicBrainzSearch({ title: track.title, artist: track.artist || '', album: track.album || '', duration: Number(track.duration) > 0 ? Number(track.duration) : null });
        } catch {
          result = { ok: false, code: 'network' };
        }
        if (run !== repair) return;
        if (!result?.ok) {
          row.status = 'error';
          row.message = LOOKUP_ERRORS[result?.code] || 'Lookup failed.';
          renderRepair();
          // Rate limiting or being offline will not fix itself mid-run.
          if (['rate-limited', 'network', 'timeout'].includes(result?.code)) break;
          continue;
        }
        row.candidates = musicBrainz.rankCandidates(track, result.candidates).filter((candidate) => candidate.confidence >= 40).slice(0, 3);
        if (!row.candidates.length) row.status = 'nomatch';
        else { row.status = 'done'; row.chosen = 0; rebuildProposal(row); }
        renderRepair();
      }
      run.running = false;
      for (const row of run.rows) if (row.status === 'searching') row.status = 'ready';
      renderRepair();
    }

    function applyRepair() {
      if (!repair || repair.running) return;
      const changed = [];
      let fieldCount = 0;
      for (const row of repair.rows) {
        if (!row.proposal) continue;
        const track = host.trackById(row.id);
        if (!track) continue;
        const keys = row.proposal.fields.filter((field) => field.checked).map((field) => field.key);
        const applied = musicBrainz.applyProposal(track, row.proposal, keys);
        if (applied.length) { changed.push(track.id); fieldCount += applied.length; }
      }
      closeSurface('#metadataRepairOverlay');
      repair = null;
      if (changed.length) host.metadataChanged(changed);
      host.showToast(changed.length ? `Applied ${batch.describeCount(fieldCount, 'change')} to ${batch.describeCount(changed.length, 'track')}. Original files are untouched.` : 'No changes were ticked.');
    }

    function closeRepair() {
      if (!repair) return;
      repair.cancelled = true;
      const opener = repair.opener;
      repair = null;
      host.closeSurface('#metadataRepairOverlay');
      if (opener?.isConnected) setTimeout(() => opener.focus?.({ preventScroll: true }), 0);
    }

    // ---- Drag and drop -----------------------------------------------------
    function setDragIds(ids) {
      dragIds = ids && ids.length ? ids.slice() : null;
      document.body.classList.toggle('is-dragging-tracks', Boolean(dragIds));
      if (!dragIds) document.querySelectorAll('.drop-target').forEach((element) => element.classList.remove('drop-target'));
    }

    function reorderDrop(ids, targetId, position) {
      const playlist = host.activeUserPlaylist();
      if (!playlist || !host.reorderEnabled()) return;
      const next = batch.reorderPlaylistEntries(playlist.trackIds, ids, targetId, position);
      if (!next) return;
      playlist.trackIds = next;
      host.persist();
      host.renderTracks({ preserveOrder: false });
      host.showToast(`Moved ${batch.describeCount(ids.length, 'track')} in ${playlist.name}.`);
    }

    function dropEffectFor(event, playlistId) {
      const source = host.activeUserPlaylist();
      return event.shiftKey && source && source.id !== playlistId ? 'move' : 'copy';
    }

    function bindDropTargets() {
      const list = $('#playlistList');
      list?.addEventListener('dragover', (event) => {
        if (!dragIds) return;
        const item = event.target.closest?.('.playlist-item[data-playlist]');
        const playlistId = item?.dataset.playlist;
        if (!item || !host.isDroppablePlaylist(playlistId)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = dropEffectFor(event, playlistId);
        list.querySelectorAll('.drop-target').forEach((element) => { if (element !== item) element.classList.remove('drop-target'); });
        item.classList.add('drop-target');
      });
      list?.addEventListener('dragleave', (event) => {
        const item = event.target.closest?.('.playlist-item');
        if (item && !item.contains(event.relatedTarget)) item.classList.remove('drop-target');
      });
      list?.addEventListener('drop', (event) => {
        if (!dragIds) return;
        const item = event.target.closest?.('.playlist-item[data-playlist]');
        const playlistId = item?.dataset.playlist;
        if (!item || !host.isDroppablePlaylist(playlistId)) return;
        event.preventDefault();
        const ids = dragIds.slice();
        const effect = dropEffectFor(event, playlistId);
        const source = host.activeUserPlaylist();
        const playlist = host.playlistById(playlistId);
        const result = host.addTracksToPlaylist(playlistId, ids);
        setDragIds(null);
        host.toastPlaylistAdd(playlist, result);
        if (effect === 'move' && source) {
          // Move = copy, then take the tracks out of the playlist they came from.
          removeFromActivePlaylist(ids);
        }
      });
      for (const selector of ['#queueButton', '#queueDrawer']) {
        const target = $(selector);
        target?.addEventListener('dragover', (event) => {
          if (!dragIds) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          target.classList.add('drop-target');
        });
        target?.addEventListener('dragleave', (event) => { if (!target.contains(event.relatedTarget)) target.classList.remove('drop-target'); });
        target?.addEventListener('drop', (event) => {
          if (!dragIds) return;
          event.preventDefault();
          const ids = dragIds.slice();
          setDragIds(null);
          host.queueTracks(ids, { next: false });
        });
      }
    }

    // ---- Wiring ------------------------------------------------------------
    function bind() {
      $('#selectionBar')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-selection-action]');
        if (button) handleBarAction(button.dataset.selectionAction, button);
      });
      $('#saveBatchEdit')?.addEventListener('click', applyBatchEditor);
      $('#closeBatchEditor')?.addEventListener('click', () => closeSurface('#batchEditorOverlay'));
      document.querySelector('[data-close-batch-editor]')?.addEventListener('click', () => closeSurface('#batchEditorOverlay'));
      $('#startRepairLookup')?.addEventListener('click', runRepairLookups);
      $('#cancelRepairLookup')?.addEventListener('click', () => { if (repair) repair.cancelled = true; });
      $('#applyRepair')?.addEventListener('click', applyRepair);
      $('#closeMetadataRepair')?.addEventListener('click', closeRepair);
      document.querySelector('[data-close-metadata-repair]')?.addEventListener('click', closeRepair);
      $('#repairList')?.addEventListener('change', (event) => {
        const target = event.target;
        if (target.dataset.repairCandidate !== undefined) {
          const row = repair?.rows[Number(target.dataset.repairCandidate)];
          if (row) { row.chosen = Number(target.value) || 0; rebuildProposal(row); renderRepair(); }
        } else if (target.dataset.repairField) {
          const row = repair?.rows[Number(target.dataset.repairRow)];
          const field = row?.proposal?.fields.find((item) => item.key === target.dataset.repairField);
          if (field) { field.checked = target.checked; renderRepairSummaryOnly(); }
        }
      });
      for (const [selector, close] of [['#batchEditorOverlay', () => closeSurface('#batchEditorOverlay')], ['#metadataRepairOverlay', closeRepair]]) {
        $(selector)?.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          close();
        });
      }
      bindDropTargets();
    }

    // Ticking a box must not rebuild the list (it would drop keyboard focus).
    function renderRepairSummaryOnly() {
      if (!repair) return;
      const { fields, tracks } = selectedFieldCount();
      const total = repair.rows.length;
      const finished = repair.rows.filter((row) => !['ready', 'searching'].includes(row.status)).length;
      $('#repairSummary').textContent = `Looked up ${finished} of ${total}. ${fields ? `${batch.describeCount(fields, 'change')} ticked on ${batch.describeCount(tracks, 'track')}.` : 'Nothing ticked yet.'}`;
      $('#applyRepair').disabled = fields === 0;
      $('#applyRepair').textContent = fields ? `Apply ${batch.describeCount(fields, 'change')}` : 'Apply ticked changes';
    }

    return Object.freeze({
      bind,
      syncBar,
      setSelection,
      setDragIds,
      reorderDrop,
      openBatchEditor,
      openRepair,
      isRepairOpen: () => Boolean(repair),
    });
  }

  return Object.freeze({ createLibraryWorkflow, MAX_REPAIR_TRACKS });
}));
