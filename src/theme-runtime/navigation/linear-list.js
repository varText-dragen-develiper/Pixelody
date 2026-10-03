(function pixelodyLinearListMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyLinearListMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLinearListMechanicModule() {
  'use strict';

  // The reference navigation mechanic: today's only track-browsing layout,
  // extracted from what used to be renderTracks()/trackRowHtml() in
  // renderer.js. This file is the regression baseline every later mechanic
  // (carousel, etc.) is measured against -- see
  // docs/themes/THEME_RUNTIME_ARCHITECTURE.md, Phase 1.
  //
  // These two constants were previously TRACK_RENDER_IMMEDIATE_LIMIT and
  // TRACK_RENDER_CHUNK_SIZE at module scope in renderer.js. They only ever
  // governed this mechanic's chunked-streaming paint strategy for large
  // libraries, so they moved here unchanged (90 / 120).
  const IMMEDIATE_LIMIT = 90;
  const CHUNK_SIZE = 120;
  // In a browser, rows are materialized only up to AHEAD_PX below the
  // viewport. Keeping every row of a large library in the DOM made each
  // body-level state change (is-playing on play/pause, theme, motion,
  // performance mode) restyle all of them: ~0.5 s per play/pause at 10,000
  // rows. Where there is no layout to measure (the Node fakes in
  // scripts/check-linear-list.js) the idle-time append of the whole list is
  // kept. The #trackRows::after spacer (playback-performance.css) stands in
  // for rows not yet materialized so the scrollbar spans the whole list.
  const AHEAD_PX = 1400;
  const FRAME_BUDGET_MS = 8;
  // HTML insertion is cheap compared with its subsequent style/layout/paint.
  // Limit the browser batch even when JS still appears within its budget;
  // otherwise one 120-row append creates a 60-100 ms compositor gap.
  const BROWSER_CHUNK_SIZE = 24;
  // The current list represents an ordered prefix, not a sliding window.
  // Preserve direct scrollbar catch-up rather than leaving a deep jump blank
  // for hundreds of frames. Bounding that case needs windowed virtualization.
  const CATCH_UP_ROWS = 600;
  const DEFAULT_ROW_PITCH = 58;

  // host carries every external dependency this mechanic needs, matching the
  // dependency-injection convention already used by
  // src/renderer-domains/state-controller.js. Nothing in this file reaches
  // out to a global `state`, `window.desktop`, or renderer.js-scoped
  // variable directly -- see the `linearListMechanic = ...createLinearListMechanic({...})`
  // call in renderer.js for what's actually supplied.
  function createLinearListMechanic(host) {
    if (!host) throw new Error('createLinearListMechanic requires a host adapter object.');

    let mountedContainer = null;
    let listeners = null;
    let renderSerial = 0;
    let appendTimer = 0;
    // This is deliberately a browsing/focus state, never a playback state.
    // `activeId` remains the only confirmed-playback input from the host; the
    // list keeps its own selected id solely so a keyboard user can inspect a
    // different row before explicitly requesting activation with Enter.
    let selectedId = null;
    // Multi-selection is a separate, additive state: Ctrl/Cmd+click toggles a
    // row, Shift+click or Shift+Arrow extends from the anchor, Space toggles
    // the focused row, Ctrl/Cmd+A selects every listed track. It never starts
    // playback and never changes the focused (selectedId) row on its own.
    const multiSelected = new Set();
    let multiAnchorId = null;
    let mountOptions = {};
    let draggedIds = null;
    let dropMarker = null;
    let currentTracks = [];
    // Rows in the DOM, in order: each row's markup without its playing and
    // selection state (so a repaint can replace only rows whose content
    // changed) and their track ids.
    let painted = { html: [], ids: [] };
    let paintedActiveId = null;
    // id -> materialized row, so selection touches two rows instead of every
    // row that has been materialized (all of them after a scroll to the end).
    const renderedRows = new Map();

    function indexRenderedRows(container, start = 0) {
      const elements = container.children;
      for (let index = start; index < painted.ids.length && index < elements.length; index += 1) renderedRows.set(painted.ids[index], elements[index]);
    }

    function syncRowSelection(row, selected) {
      if (!row) return;
      row.classList.toggle('is-selected', selected);
      const ariaSelected = String(selected || row.classList.contains('is-multi-selected'));
      if (row.getAttribute('aria-selected') !== ariaSelected) row.setAttribute('aria-selected', ariaSelected);
      const tabIndex = selected ? 0 : -1;
      if (row.tabIndex !== tabIndex) row.tabIndex = tabIndex;
    }

    // Rows are compared on their content: a play/pause or a selection move
    // keeps every row element (and keyboard focus) and toggles state on the
    // rows it concerns, while a favorite, metadata edit or move replaces the
    // row. Only the playing and selected rows differ from their content.
    function rowContent(track, index) {
      return trackRowHtml(track, index, null, null);
    }

    function rowMarkup(track, index, content, activeId) {
      return track.id === activeId || track.id === selectedId || multiSelected.has(track.id) ? trackRowHtml(track, index, activeId, selectedId, multiSelected.has(track.id)) : content;
    }
    // Indices of rows a refresh left unchecked because they were far from the
    // viewport, and the rows near it as last measured (null: not measured
    // since the last scroll or resize).
    const staleRows = new Set();
    let nearRows = null;
    let paintStartedAt = 0;
    let fillFrame = 0;
    let rowPitch = DEFAULT_ROW_PITCH;
    let viewportListeners = null;

    // Verbatim from the old questTrackLootTags()/questTrackLootMarkup() in
    // renderer.js (13824-13837) -- moved here unchanged because trackRowHtml
    // was their only caller. host.format.isHiRes/isLossless/escapeHtml stand
    // in for the direct function calls the original had in scope.
    function questTrackLootTags(track, tuned = false, favorite = false) {
      const tags = [];
      if (favorite) tags.push({ label: 'FAV ITEM', kind: 'fav' });
      if (host.format.isHiRes(track)) tags.push({ label: 'HI-RES DROP', kind: 'hires' });
      else if (host.format.isLossless(track)) tags.push({ label: 'LOSSLESS LOOT', kind: 'lossless' });
      if (tuned) tags.push({ label: 'TUNED GEAR', kind: 'tuned' });
      const addedAt = Number(track.dateAdded) || 0;
      if (addedAt && Date.now() - addedAt < 1000 * 60 * 60 * 24 * 7) tags.push({ label: 'NEW CART', kind: 'new' });
      return tags.slice(0, 3);
    }
    function questTrackLootMarkup(tags = []) {
      if (!tags.length) return '';
      return `<span class="quest-loot-tags" aria-hidden="true">${tags.map((tag) => `<i data-quest-loot="${host.format.escapeHtml(tag.kind)}">${host.format.escapeHtml(tag.label)}</i>`).join('')}</span>`;
    }

    // Verbatim from the old trackRowHtml() (renderer.js 13838-13847). The
    // `.track-row` class name, column <span> structure, and data-id
    // attribute format are load-bearing: every theme's CSS across
    // src/*.css targets `.track-row` directly, so this markup shape cannot
    // change without touching all 20 themes' stylesheets. activeId replaces
    // the original's per-row `currentTrack()?.id` call -- the host resolves
    // that once per paint() instead of once per row, which is not
    // observably different since state.index cannot change mid-loop in
    // single-threaded JS.
    function trackRowHtml(track, index, activeId, focusedId, multiSelectedRow = false) {
      const tuned = host.tuning.hasChanges(host.tuning.forTrack(track.id) || host.tuning.default());
      const quality = track.sampleRate ? `${track.bitDepth || '--'}-bit / ${(track.sampleRate / 1000).toFixed(1)} kHz` : (host.format.isLossless(track) ? 'Lossless' : 'Compressed');
      const art = track.artworkPath ? `style="background-image:url('${host.format.escapeHtml(host.format.fileUrl(track.artworkPath))}')"` : '';
      const glyph = host.glyph?.describe?.(`${track.id}|${track.title}|${track.artist}`) || { variant: 0, rotation: 0, edition: 0 };
      const glyphAttributes = `data-theme-glyph="${glyph.variant}" data-theme-rotation="${glyph.rotation}" data-theme-edition="${glyph.edition}"`;
      const favorite = host.isFavorite(track.id);
      const gaps = host.metadataGaps(track);
      const cleanupBadge = gaps.length ? `<em class="discovery-badge">${track.missing ? 'Find file' : 'Fill info'}</em>` : '';
      const lootTags = questTrackLootMarkup(questTrackLootTags(track, tuned, favorite));
      const selected = focusedId === track.id;
      return `<div class="track-row ${activeId === track.id ? 'playing' : ''} ${selected ? 'is-selected' : ''}${multiSelectedRow ? ' is-multi-selected' : ''} ${track.missing ? 'missing' : ''} ${gaps.length ? 'needs-discovery' : ''}" role="option" aria-selected="${selected || multiSelectedRow}" tabindex="${selected ? '0' : '-1'}" style="--row-index:${index}" data-id="${encodeURIComponent(track.id)}" draggable="true"><i class="signal-edge-ring" aria-hidden="true"></i><span>${String(index + 1).padStart(2, '0')}</span><span class="track-title"><span class="track-art" ${glyphAttributes} ${art}></span><strong>${host.format.escapeHtml(track.title)}${track.missing ? ' [Missing]' : ''}${cleanupBadge}</strong><span>${host.format.escapeHtml(track.artist)}${track.album ? ` &middot; ${host.format.escapeHtml(track.album)}` : ''}</span>${lootTags}</span><span class="format">${track.format}</span><span class="quality">${quality}</span><span class="${tuned ? 'tuned' : ''}">${tuned ? 'Custom' : 'Flat'}</span><span>${host.format.durationText(track.duration)}</span><span class="track-actions"><button class="favorite ${favorite ? 'active' : ''}" title="Favorite"><span class="public-icon icon-heart"></span></button>${gaps.length ? '<button class="find-track" title="Find metadata or buy this track"><span class="public-icon icon-search"></span></button>' : ''}<button class="edit-track" title="Edit local details"><span class="public-icon icon-edit"></span></button></span></div>`;
    }

    function measurable(container) {
      const view = container?.ownerDocument?.defaultView;
      return Boolean(view && typeof view.requestAnimationFrame === 'function' && typeof container.getBoundingClientRect === 'function');
    }

    function appendRows(container, endIndex) {
      const start = painted.ids.length;
      if (endIndex <= start) return;
      const tracks = currentTracks.slice(start, endIndex);
      const content = tracks.map((track, offset) => rowContent(track, start + offset));
      container.insertAdjacentHTML('beforeend', content.map((html, offset) => rowMarkup(tracks[offset], start + offset, html, paintedActiveId)).join(''));
      painted.html.push(...content);
      painted.ids.push(...tracks.map((track) => track.id));
      indexRenderedRows(container, start);
      nearRows = null;
    }

    function syncPendingSpace(container) {
      const pending = currentTracks.length - painted.ids.length;
      host.onTrackTableStreaming?.(pending > 0);
      if (!container.style?.setProperty) return;
      if (pending > 0) container.style.setProperty('--track-rows-pending-height', `${Math.round(pending * rowPitch)}px`);
      else container.style.removeProperty('--track-rows-pending-height');
    }

    function scheduleFill() {
      const container = mountedContainer;
      if (fillFrame || !container || (painted.ids.length >= currentTracks.length && !staleRows.size) || !measurable(container)) return;
      fillFrame = container.ownerDocument.defaultView.requestAnimationFrame(() => {
        fillFrame = 0;
        fill(container);
      });
    }

    // Appends rows while the end of the materialized list is within AHEAD_PX
    // of the viewport, within one frame budget per frame. Driven by scroll,
    // resize and size changes (see mount()); idle otherwise.
    function fill(container) {
      if (container !== mountedContainer) return;
      nearRows = null;
      refreshStaleRows(container, rowsNearViewport(container));
      const deadline = performance.now() + FRAME_BUDGET_MS;
      const limit = container.ownerDocument.defaultView.innerHeight + AHEAD_PX;
      const startedWith = painted.ids.length;
      if (painted.ids.length < currentTracks.length) {
        const last = container.lastElementChild;
        const lastRect = last?.getBoundingClientRect();
        // A hidden list (another view is open) has no geometry; the
        // ResizeObserver resumes filling when it is shown again.
        if (!lastRect || (!lastRect.width && !lastRect.height)) return;
        // Row pitch (top to top) includes any gap between rows. It is taken
        // from the last two rows, which lie beyond the viewport: rows use
        // content-visibility:auto, so a row that has never been shown lays
        // out at its intrinsic size and one that has at its real size, and
        // rows not yet materialized will first lay out like the last ones.
        // An average over every row would swing with the scroll position.
        const count = painted.ids.length;
        const previous = last.previousElementSibling;
        const pitch = previous ? lastRect.top - previous.getBoundingClientRect().top : lastRect.height;
        if (pitch > 0) rowPitch = Math.max(8, pitch);
        if (lastRect.bottom < limit) {
          if (performance.now() < deadline) {
            const needed = Math.max(1, Math.ceil((limit - lastRect.bottom) / rowPitch));
            appendRows(container, Math.min(currentTracks.length, count + (needed > CATCH_UP_ROWS ? needed : Math.min(needed, BROWSER_CHUNK_SIZE))));
          }
          // Do not read geometry again after insertion. The next frame sees
          // the painted pitch and continues; pending space preserves scroll.
          scheduleFill();
        }
      }
      syncPendingSpace(container);
      if (painted.ids.length === startedWith) return;
      host.recordRenderStats({ rows: painted.ids.length, total: currentTracks.length, ms: performance.now() - paintStartedAt });
      if (painted.ids.length >= currentTracks.length) host.onStreamComplete?.();
    }

    // The range of row indices within AHEAD_PX of the viewport: every row
    // without layout, none while the list is hidden. Rows differ in height
    // (shown and never-shown rows lay out differently), so the range is found
    // by position; rows are in order, so a binary search needs a few reads.
    function rowsNearViewport(container) {
      if (!measurable(container)) return { first: 0, last: painted.ids.length - 1 };
      if (nearRows) return nearRows;
      const elements = container.children;
      const rect = elements[0]?.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return { first: 0, last: -1 };
      const indexReaching = (y) => {
        let low = 0;
        let high = elements.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (elements[middle].getBoundingClientRect().bottom < y) low = middle + 1;
          else high = middle;
        }
        return low;
      };
      nearRows = { first: indexReaching(-AHEAD_PX), last: indexReaching(container.ownerDocument.defaultView.innerHeight + AHEAD_PX) };
      return nearRows;
    }

    function replaceRow(elements, index, content, activeId) {
      const row = elements[index];
      row.insertAdjacentHTML('afterend', rowMarkup(currentTracks[index], index, content, activeId));
      row.remove();
      if (renderedRows.get(painted.ids[index]) === row) renderedRows.delete(painted.ids[index]);
      renderedRows.set(currentTracks[index].id, elements[index]);
      painted.html[index] = content;
      painted.ids[index] = currentTracks[index].id;
      staleRows.delete(index);
    }

    // Brings rows a refresh skipped up to date once they are near the
    // viewport (fill() runs before the frame that would show them) or
    // selected.
    function refreshStaleRows(container, { first, last }) {
      if (!staleRows.size) return;
      const elements = container.children;
      const doc = container.ownerDocument;
      for (let index = first; index <= Math.min(last, painted.ids.length - 1); index += 1) {
        if (!staleRows.delete(index)) continue;
        const content = rowContent(currentTracks[index], index);
        if (content === painted.html[index]) continue;
        const hadFocus = Boolean(doc?.activeElement && elements[index].contains(doc.activeElement));
        replaceRow(elements, index, content, paintedActiveId);
        if (hadFocus) elements[index].focus({ preventScroll: true });
      }
    }

    // Keyboard selection can target a row that is not materialized yet
    // (ArrowDown past the last row, End in a large library).
    function ensureRendered(index) {
      const container = mountedContainer;
      if (container && staleRows.has(index)) refreshStaleRows(container, { first: index, last: index });
      if (!container || index < painted.ids.length) return;
      appendRows(container, Math.min(currentTracks.length, index + 1 + CHUNK_SIZE));
      if (measurable(container)) {
        syncPendingSpace(container);
        scheduleFill();
      }
    }

    // Most repaints change a few rows (track change, favorite, metadata edit,
    // an Alt+Up/Down move). Rows whose track moved are replaced, and rows
    // near the viewport are re-rendered and replaced if their content
    // changed, giving the same DOM as a full repaint while every other row
    // keeps its element, hover state and running animation; keyboard focus on
    // a replaced row is restored. Rows far from the viewport are checked when
    // they come near it, so a refresh after scrolling deep into a large
    // library costs a viewport's rows, not every row materialized. When many
    // rows change (a new sort or filter), a full repaint is cheaper.
    const REFRESH_MAX_CHANGED_ROWS = 200;
    function refreshInPlace(container, activeId, previousSelectedId) {
      const elements = container.children;
      const count = painted.ids.length;
      if (!count || !elements || elements.length !== count || painted.html.length !== count) return false;
      const keep = Math.min(count, currentTracks.length);
      let changed = count - keep;
      for (let index = 0; index < keep; index += 1) {
        if (painted.ids[index] !== currentTracks[index].id && (changed += 1) > REFRESH_MAX_CHANGED_ROWS) return false;
      }
      const near = rowsNearViewport(container);
      const replacements = new Map();
      for (let index = 0; index < keep; index += 1) {
        const moved = painted.ids[index] !== currentTracks[index].id;
        if (!moved && (index < near.first || index > near.last)) { staleRows.add(index); continue; }
        const content = rowContent(currentTracks[index], index);
        if (moved || content !== painted.html[index]) replacements.set(index, content);
        else staleRows.delete(index);
      }
      if (replacements.size + count - keep > REFRESH_MAX_CHANGED_ROWS) return false;
      const doc = container.ownerDocument;
      for (let index = count - 1; index >= keep; index -= 1) {
        if (renderedRows.get(painted.ids[index]) === elements[index]) renderedRows.delete(painted.ids[index]);
        elements[index].remove();
        staleRows.delete(index);
      }
      painted.html.length = keep;
      painted.ids.length = keep;
      let refocus = null;
      for (const [index, content] of replacements) {
        if (doc?.activeElement && elements[index].contains(doc.activeElement)) refocus = { id: painted.ids[index], index };
        replaceRow(elements, index, content, activeId);
      }
      // Rows kept in place only need their state brought up to date, and
      // only the rows whose state can have changed are touched.
      for (const id of new Set([paintedActiveId, activeId, previousSelectedId, selectedId])) {
        const row = renderedRows.get(id);
        if (!row) continue;
        row.classList.toggle('playing', id === activeId);
        syncRowSelection(row, id === selectedId);
      }
      paintedActiveId = activeId;
      // Focus stays on the track it was on, which an Alt+Up/Down move puts in
      // another row, or else on the row that took its place.
      if (refocus) (renderedRows.get(refocus.id) || elements[refocus.index])?.focus({ preventScroll: true });
      return true;
    }

    // Without layout (the Node fakes) there is nothing to measure, so the
    // rest of the list is appended in idle-time chunks of CHUNK_SIZE.
    function streamRemaining(container, serial, renderStartedAt) {
      host.onTrackTableStreaming?.(painted.ids.length < currentTracks.length);
      const appendChunk = () => {
        if (serial !== renderSerial) return;
        appendRows(container, Math.min(currentTracks.length, painted.ids.length + CHUNK_SIZE));
        host.recordRenderStats({ rows: painted.ids.length, total: currentTracks.length, ms: performance.now() - renderStartedAt });
        if (painted.ids.length < currentTracks.length) {
          appendTimer = host.scheduleIdleWork(appendChunk, 600);
        } else {
          appendTimer = 0;
          host.onTrackTableStreaming?.(false);
          host.onStreamComplete?.();
        }
      };
      if (painted.ids.length < currentTracks.length) appendTimer = host.scheduleIdleWork(appendChunk, 500);
    }

    // Originally the DOM-painting body of renderTracks() (renderer.js
    // 13849-13893): immediate paint up to IMMEDIATE_LIMIT rows, then the rest
    // on demand (browser) or in idle-time chunks of CHUNK_SIZE (no layout).
    // The serial guard keeps a superseded paint's chunks from landing after
    // a newer one started; any activeId change triggers a fresh paint().
    function paint(container, tracks, activeId, options = {}) {
      currentTracks = Array.isArray(tracks) ? tracks.slice() : [];
      const previousSelectedId = selectedId;
      if (!currentTracks.some((track) => track.id === selectedId)) selectedId = activeId || currentTracks[0]?.id || null;
      // A refresh (removal, filter, another collection) drops selected rows
      // that are no longer listed.
      if (multiSelected.size) {
        const listed = new Set(currentTracks.map((track) => track.id));
        const kept = [...multiSelected].filter((id) => listed.has(id));
        if (kept.length !== multiSelected.size) {
          multiSelected.clear();
          kept.forEach((id) => multiSelected.add(id));
          if (!kept.length) multiAnchorId = null;
          mountOptions.onMultiSelectionChange?.(orderedSelection());
        }
      }
      const renderStartedAt = performance.now();
      paintStartedAt = renderStartedAt;
      const serial = ++renderSerial;
      const animateRows = Boolean(options.animateRows);
      clearTimeout(host.getArriveTimer());
      host.cancelIdleWork(appendTimer);
      appendTimer = 0;
      container.classList.remove('rows-arriving');
      container.setAttribute?.('role', 'listbox');
      container.setAttribute?.('aria-label', 'Tracks');
      if (!animateRows && !options.forceFull && refreshInPlace(container, activeId, previousSelectedId)) {
        host.recordRenderStats({ rows: painted.ids.length, total: currentTracks.length, ms: performance.now() - renderStartedAt });
      } else {
        const immediateLimit = options.forceFull ? currentTracks.length : Math.min(currentTracks.length, measurable(container) ? BROWSER_CHUNK_SIZE : IMMEDIATE_LIMIT);
        paintedActiveId = activeId;
        const immediate = currentTracks.slice(0, immediateLimit);
        const content = immediate.map((track, index) => rowContent(track, index));
        painted = { html: content, ids: immediate.map((track) => track.id) };
        container.innerHTML = content.map((html, index) => rowMarkup(immediate[index], index, html, activeId)).join('');
        renderedRows.clear();
        staleRows.clear();
        indexRenderedRows(container);
        host.recordRenderStats({ rows: immediateLimit, total: currentTracks.length, ms: performance.now() - renderStartedAt });
      }
      if (measurable(container)) {
        syncPendingSpace(container);
        scheduleFill();
      } else {
        streamRemaining(container, serial, renderStartedAt);
      }
      if (animateRows && currentTracks.length) {
        void container.offsetWidth;
        container.classList.add('rows-arriving');
        host.setArriveTimer(setTimeout(() => container.classList.remove('rows-arriving'), 620));
      }
    }

    // ---- Multi-selection -------------------------------------------------
    function orderedSelection() {
      return currentTracks.filter((track) => multiSelected.has(track.id)).map((track) => track.id);
    }

    function setMultiRow(id, on) {
      const row = renderedRows.get(id);
      if (!row) return;
      row.classList.toggle('is-multi-selected', on);
      const ariaSelected = String(on || id === selectedId);
      if (row.getAttribute('aria-selected') !== ariaSelected) row.setAttribute('aria-selected', ariaSelected);
    }

    // Replaces the selection with `ids`, touching only rows whose state
    // changed (rows not yet materialized pick the state up from rowMarkup).
    function commitMulti(ids, anchorId, options) {
      const next = new Set(ids);
      let changed = next.size !== multiSelected.size;
      for (const id of multiSelected) {
        if (!next.has(id)) { setMultiRow(id, false); changed = true; }
      }
      for (const id of next) {
        if (!multiSelected.has(id)) { setMultiRow(id, true); changed = true; }
      }
      multiSelected.clear();
      next.forEach((id) => multiSelected.add(id));
      multiAnchorId = next.size ? (anchorId ?? multiAnchorId) : null;
      mountedContainer?.setAttribute?.('aria-multiselectable', 'true');
      if (changed) options?.onMultiSelectionChange?.(orderedSelection());
      return changed;
    }

    function rangeIds(fromId, toId) {
      const from = currentTracks.findIndex((track) => track.id === fromId);
      const to = currentTracks.findIndex((track) => track.id === toId);
      if (from < 0 || to < 0) return toId ? [toId] : [];
      const [low, high] = from <= to ? [from, to] : [to, from];
      return currentTracks.slice(low, high + 1).map((track) => track.id);
    }

    function toggleMulti(id, options) {
      const ids = new Set(multiSelected);
      if (ids.has(id)) ids.delete(id); else ids.add(id);
      commitMulti(ids, id, options);
    }

    function extendMulti(toId, options, { additive = false } = {}) {
      const anchor = multiAnchorId && currentTracks.some((track) => track.id === multiAnchorId) ? multiAnchorId : (selectedId || toId);
      const ids = additive ? new Set(multiSelected) : new Set();
      rangeIds(anchor, toId).forEach((id) => ids.add(id));
      commitMulti(ids, anchor, options);
    }

    function clearMulti(options) {
      return commitMulti([], null, options);
    }

    // Verbatim from the old standalone `$('#trackRows').onclick = ...` /
    // `.oncontextmenu = ...` assignments (renderer.js ~15244-15252), now
    // owned by the mechanic instead of living as loose top-level statements
    // in renderer.js. Delegation on the container means these listeners
    // keep working across every future paint()/update() without
    // re-attaching, exactly like the original.
    function handleClick(event, options) {
      const row = event.target.closest('.track-row');
      if (!row) return;
      const id = decodeURIComponent(row.dataset.id);
      if (event.target.closest('.favorite')) { options.onRowAction?.('favorite', id); return; }
      if (event.target.closest('.find-track')) { options.onRowAction?.('find', id); return; }
      if (event.target.closest('.edit-track')) { options.onRowAction?.('edit', id); return; }
      if (event.ctrlKey || event.metaKey) {
        select(id, options);
        toggleMulti(id, options);
        return;
      }
      if (event.shiftKey) {
        select(id, options);
        extendMulti(id, options);
        return;
      }
      // A plain click means "play this one": the selection has done its job.
      if (multiSelected.size) clearMulti(options);
      select(id, options);
      options.onActivate?.(id);
    }
    function handleContextMenu(event, options) {
      const row = event.target.closest('.track-row');
      if (row) {
        const id = decodeURIComponent(row.dataset.id);
        select(id, options);
        options.onContextMenu?.(id, event);
      }
    }

    function select(id, options, { moveFocus = false } = {}) {
      const index = currentTracks.findIndex((track) => track.id === id);
      if (index < 0) return;
      ensureRendered(index);
      const changed = id !== selectedId;
      const previousRow = renderedRows.get(selectedId);
      selectedId = id;
      const nextRow = renderedRows.get(id);
      if (changed) {
        syncRowSelection(previousRow, false);
        syncRowSelection(nextRow, true);
      }
      // focus() synchronously emits focusin. The nested selection sees the
      // same id and must not repeat a library-wide update or notify twice.
      if (moveFocus) nextRow?.focus({ preventScroll: true });
      if (changed) options.onSelect?.(id);
    }

    function handleFocusIn(event, options) {
      const row = event.target.closest?.('.track-row');
      if (row) select(decodeURIComponent(row.dataset.id), options);
    }

    function handleKeyDown(event, options) {
      const row = event.target.closest?.('.track-row');
      if (!row) return;
      const id = decodeURIComponent(row.dataset.id);
      const index = currentTracks.findIndex((track) => track.id === id);
      const key = event.key;
      if (key === 'Enter') {
        event.preventDefault();
        options.onActivate?.(id);
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // Escape first drops a multi-selection; only then does it go back.
        if (multiSelected.size) clearMulti(options);
        else options.onEscape?.();
        return;
      }
      if ((key === ' ' || key === 'Spacebar') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        toggleMulti(id, options);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && String(key).toLowerCase() === 'a') {
        event.preventDefault();
        commitMulti(currentTracks.map((track) => track.id), id, options);
        return;
      }
      if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        options.onContextMenu?.(id, event);
        return;
      }
      let nextIndex = -1;
      if (key === 'ArrowDown') nextIndex = Math.min(currentTracks.length - 1, index + 1);
      if (key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = currentTracks.length - 1;
      if (nextIndex >= 0) {
        event.preventDefault();
        const nextId = currentTracks[nextIndex].id;
        if (event.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp')) {
          if (!multiAnchorId || !multiSelected.size) multiAnchorId = id;
          select(nextId, options, { moveFocus: true });
          extendMulti(nextId, options);
        } else {
          select(nextId, options, { moveFocus: true });
        }
      }
    }

    // ---- Drag and drop ---------------------------------------------------
    // The mechanic owns the gesture; the host decides what a drop means.
    // Dragging a row inside the selection carries the whole selection.
    function clearDropMarker() {
      if (!dropMarker) return;
      dropMarker.row.classList.remove('drop-before', 'drop-after');
      dropMarker = null;
    }

    function handleDragStart(event, options) {
      const row = event.target.closest?.('.track-row');
      if (!row || !event.dataTransfer) return;
      const id = decodeURIComponent(row.dataset.id);
      const selection = orderedSelection();
      draggedIds = selection.length > 1 && selection.includes(id) ? selection : [id];
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('application/x-pixelody-tracks', JSON.stringify(draggedIds));
      event.dataTransfer.setData('text/plain', `${draggedIds.length} Pixelody track${draggedIds.length === 1 ? '' : 's'}`);
      options.onDragStart?.(draggedIds.slice(), event);
    }

    function handleDragEnd(event, options) {
      clearDropMarker();
      if (!draggedIds) return;
      draggedIds = null;
      options.onDragEnd?.(event);
    }

    function dropPosition(event, row) {
      const rect = row.getBoundingClientRect?.();
      if (!rect || !rect.height || typeof event.clientY !== 'number') return 'before';
      return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
    }

    function handleDragOver(event, options) {
      if (!draggedIds || !options.canReorder?.(draggedIds)) return;
      const row = event.target.closest?.('.track-row');
      if (!row) return;
      const id = decodeURIComponent(row.dataset.id);
      if (draggedIds.includes(id)) { clearDropMarker(); return; }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const position = dropPosition(event, row);
      if (dropMarker && dropMarker.row === row && dropMarker.position === position) return;
      clearDropMarker();
      row.classList.add(position === 'after' ? 'drop-after' : 'drop-before');
      dropMarker = { row, position };
    }

    function handleDrop(event, options) {
      if (!draggedIds || !options.canReorder?.(draggedIds)) return;
      const row = event.target.closest?.('.track-row');
      if (!row) return;
      const id = decodeURIComponent(row.dataset.id);
      const position = dropPosition(event, row);
      const ids = draggedIds.slice();
      event.preventDefault();
      clearDropMarker();
      if (!ids.includes(id)) options.onReorderDrop?.(ids, id, position);
    }

    function mount(container, tracks, options = {}) {
      mountedContainer = container;
      mountOptions = options;
      selectedId = options.activeId || tracks?.[0]?.id || null;
      const onClick = (event) => handleClick(event, options);
      const onContextMenu = (event) => handleContextMenu(event, options);
      const onFocusIn = (event) => handleFocusIn(event, options);
      const onKeyDown = (event) => handleKeyDown(event, options);
      const onDragStart = (event) => handleDragStart(event, options);
      const onDragEnd = (event) => handleDragEnd(event, options);
      const onDragOver = (event) => handleDragOver(event, options);
      const onDrop = (event) => handleDrop(event, options);
      const onDragLeave = (event) => { if (!event.relatedTarget || !container.contains?.(event.relatedTarget)) clearDropMarker(); };
      container.addEventListener('click', onClick);
      container.addEventListener('dragstart', onDragStart);
      container.addEventListener('dragend', onDragEnd);
      container.addEventListener('dragover', onDragOver);
      container.addEventListener('drop', onDrop);
      container.addEventListener('dragleave', onDragLeave);
      container.addEventListener('contextmenu', onContextMenu);
      container.addEventListener('focusin', onFocusIn);
      container.addEventListener('keydown', onKeyDown);
      listeners = { onClick, onContextMenu, onFocusIn, onKeyDown, onDragStart, onDragEnd, onDragOver, onDrop, onDragLeave };
      if (measurable(container)) {
        // Themes differ in which element scrolls the list, so scrolls are
        // observed anywhere; filling is frame-coalesced and idle otherwise.
        const view = container.ownerDocument.defaultView;
        const onViewportChange = () => { nearRows = null; scheduleFill(); };
        container.ownerDocument.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
        view.addEventListener('resize', onViewportChange);
        const resizeObserver = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(onViewportChange) : null;
        resizeObserver?.observe(container);
        viewportListeners = { view, onViewportChange, resizeObserver };
      }
      if (tracks && tracks.length) paint(container, tracks, options.activeId ?? null, { animateRows: false, forceFull: true });
    }

    function update(tracks, activeId, options = {}) {
      if (!mountedContainer) return;
      paint(mountedContainer, tracks, activeId, options);
    }

    function destroy() {
      if (mountedContainer && listeners) {
        mountedContainer.removeEventListener('click', listeners.onClick);
        mountedContainer.removeEventListener('contextmenu', listeners.onContextMenu);
        mountedContainer.removeEventListener('focusin', listeners.onFocusIn);
        mountedContainer.removeEventListener('keydown', listeners.onKeyDown);
        mountedContainer.removeEventListener('dragstart', listeners.onDragStart);
        mountedContainer.removeEventListener('dragend', listeners.onDragEnd);
        mountedContainer.removeEventListener('dragover', listeners.onDragOver);
        mountedContainer.removeEventListener('drop', listeners.onDrop);
        mountedContainer.removeEventListener('dragleave', listeners.onDragLeave);
      }
      host.cancelIdleWork(appendTimer);
      appendTimer = 0;
      // Another mechanic is taking over this container: the host's selection
      // bar must not keep describing rows that no longer exist.
      const hadSelection = multiSelected.size > 0;
      const notifySelection = mountOptions.onMultiSelectionChange;
      const notifyDragEnd = draggedIds ? mountOptions.onDragEnd : null;
      if (viewportListeners) {
        const { view, onViewportChange, resizeObserver } = viewportListeners;
        view.document.removeEventListener('scroll', onViewportChange, { capture: true });
        view.removeEventListener('resize', onViewportChange);
        resizeObserver?.disconnect();
        if (fillFrame) view.cancelAnimationFrame(fillFrame);
        viewportListeners = null;
      }
      fillFrame = 0;
      // The next mechanic mounts into the same container.
      if (mountedContainer && painted.ids.length < currentTracks.length) {
        mountedContainer.style?.removeProperty?.('--track-rows-pending-height');
        host.onTrackTableStreaming?.(false);
      }
      mountedContainer = null;
      listeners = null;
      selectedId = null;
      multiSelected.clear();
      multiAnchorId = null;
      mountOptions = {};
      draggedIds = null;
      dropMarker = null;
      currentTracks = [];
      painted = { html: [], ids: [] };
      paintedActiveId = null;
      renderedRows.clear();
      staleRows.clear();
      nearRows = null;
      if (hadSelection) notifySelection?.([]);
      notifyDragEnd?.({});
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Linear List' },
      getSelection: () => orderedSelection(),
      setSelection: (ids) => commitMulti((ids || []).filter((id) => currentTracks.some((track) => track.id === id)), null, mountOptions),
      clearSelection: () => clearMulti(mountOptions),
      // Exposed for unit testing (scripts/check-linear-list.js) without a
      // real DOM -- both are pure functions of their arguments plus `host`.
      __test__: { trackRowHtml, questTrackLootTags, questTrackLootMarkup },
    });
  }

  return Object.freeze({ createLinearListMechanic });
}));
