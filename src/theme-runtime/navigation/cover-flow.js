(function pixelodyCoverFlowMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCoverFlowMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCoverFlowMechanicModule() {
  'use strict';

  // Third registered navigation mechanic. See
  // theme-runtime/navigation/contract.md for the interface and the
  // common-thread requirements every mechanic must meet.
  //
  // This is deliberately built as a sibling of carousel.js rather than a
  // clean-room design: carousel.js already paid for the lesson documented in
  // contract.md's "don't give a mechanic two positions to keep in sync"
  // section, and cover flow has exactly the same shape of risk (a focused
  // item that fans neighbors out to either side). Re-deriving that the hard
  // way here would just reproduce the same three bug reports under a new
  // file name. So: exactly one position, wherever `activeId` (the
  // confirmed, actually-playing track) is, computed fresh via
  // centerIndexFor() -- never cached in a second variable. Clicking/keying a
  // card only ever calls onActivate(); the shelf does not move until
  // update() is called back with a genuinely new, confirmed activeId.
  //
  // What actually makes this a distinct mechanic rather than a carousel
  // clone is the rendering, not the interaction model: a steeper, more
  // classic "album shelf" perspective (fewer visible neighbors, sharper
  // rotation, a reflection under each cover), plus a single fixed caption
  // line below the shelf showing the centered track's title/artist/duration
  // -- carousel.js instead repeats that metadata under every card. Only the
  // centered card's info is shown at all here, matching the reference
  // Cover Flow behavior this mechanic is modeled on.
  const MAX_VISUAL_DISTANCE = 4;
  // Only cards near the centre are mounted. Cards past MAX_VISUAL_DISTANCE share
  // one visual position, so a library of any size costs a fixed number of
  // nodes; the full track list stays in currentTracks for status and keys.
  const WINDOW_RADIUS = 14;

  function createCoverFlowMechanic(host) {
    if (!host) throw new Error('createCoverFlowMechanic requires a host adapter object.');

    let mountedContainer = null;
    let stageEl = null;
    let captionEl = null;
    let listeners = null;
    let currentTracks = [];
    // Same focus-tracking convention as carousel.js: only allow an external
    // activeId change to move DOM focus to follow the new center when focus
    // is already somewhere inside this mechanic. Never steal focus from
    // elsewhere in the app.
    let hasFocusWithin = false;

    function coverHtml(track, index, offset, isActive) {
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      const artStyle = artUrl ? `style="background-image:url('${host.format.escapeHtml(artUrl)}')"` : '';
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      return `<div class="cover-flow-card${isActive ? ' is-playing' : ''}" style="--card-offset:${offset};--card-distance:${distance}" tabindex="0" role="button" aria-selected="${isActive}" data-id="${encodeURIComponent(track.id)}" data-index="${index}"><div class="cover-flow-art" ${artStyle}></div><div class="cover-flow-reflection" ${artStyle}></div></div>`;
    }

    // Single source of truth for shelf position: the index of whichever
    // track is actually playing. Falls back to the first cover only when
    // nothing is playing (activeId null) or the active track genuinely
    // isn't in this list.
    function centerIndexFor(tracks, activeId) {
      if (!activeId) return 0;
      const index = tracks.findIndex((track) => track.id === activeId);
      return index >= 0 ? index : 0;
    }

    function captionHtml(track) {
      if (!track) return '';
      const meta = track.album ? `${host.format.escapeHtml(track.artist)} &middot; ${host.format.escapeHtml(track.album)}` : host.format.escapeHtml(track.artist);
      return `<strong class="cover-flow-caption-title">${host.format.escapeHtml(track.title)}</strong><span class="cover-flow-caption-meta">${meta}</span><span class="cover-flow-caption-duration">${host.format.durationText(track.duration)}</span>`;
    }

    function setCaption(tracks, activeId) {
      if (!captionEl) return;
      const track = tracks.find((item) => item.id === activeId) || null;
      captionEl.innerHTML = captionHtml(track);
    }

    // Full repaint: rebuilds every cover. Used on mount and whenever the
    // track list itself changes (update()). A same-list activeId change
    // goes through recenterOn() instead, mutating existing DOM rather than
    // rebuilding it, so any in-flight CSS transition on
    // --card-offset/--card-distance isn't interrupted.
    function windowBounds(centerIndex, count) {
      if (centerIndex < 0 || count <= 0) return [0, -1];
      return [Math.max(0, centerIndex - WINDOW_RADIUS), Math.min(count - 1, centerIndex + WINDOW_RADIUS)];
    }

    function rangeHtml(first, last, centerIndex, activeId) {
      let html = '';
      for (let index = first; index <= last; index += 1) {
        const track = currentTracks[index];
        html += coverHtml(track, index, index - centerIndex, track.id === activeId);
      }
      return html;
    }

    // Slides the mounted window to the new centre, keeping the cards that stay
    // so their transitions still run. Cards entering or leaving sit past the
    // visible stack, so nothing pops.
    function syncWindow(stageEl, centerIndex, activeId) {
      const [first, last] = windowBounds(centerIndex, currentTracks.length);
      let keptFirst = Infinity;
      let keptLast = -1;
      stageEl.querySelectorAll('.cover-flow-card').forEach((card) => {
        const index = Number(card.dataset.index);
        if (index < first || index > last) { card.remove(); return; }
        keptFirst = Math.min(keptFirst, index);
        keptLast = Math.max(keptLast, index);
      });
      if (keptLast < 0) { stageEl.innerHTML = rangeHtml(first, last, centerIndex, activeId); return; }
      if (first < keptFirst) stageEl.insertAdjacentHTML('afterbegin', rangeHtml(first, keptFirst - 1, centerIndex, activeId));
      if (last > keptLast) stageEl.insertAdjacentHTML('beforeend', rangeHtml(keptLast + 1, last, centerIndex, activeId));
    }

    function paint(tracks, activeId) {
      currentTracks = tracks;
      if (!tracks.length) {
        stageEl.innerHTML = '';
        setCaption(tracks, activeId);
        return;
      }
      const centerIndex = centerIndexFor(tracks, activeId);
      const [first, last] = windowBounds(centerIndex, tracks.length);
      stageEl.innerHTML = rangeHtml(first, last, centerIndex, activeId);
      setCaption(tracks, activeId);
    }

    // Moves the visual center and is-playing marker to a new, confirmed
    // activeId WITHOUT rebuilding any DOM nodes, so the existing
    // transform/opacity transition on .cover-flow-card actually animates
    // the slide across the shelf. Only valid when the track list itself
    // hasn't changed -- see update()'s tracksEqual() guard.
    function recenterOn(activeId) {
      const centerIndex = centerIndexFor(currentTracks, activeId);
      if (currentTracks.length) syncWindow(stageEl, centerIndex, activeId);
      stageEl.querySelectorAll('.cover-flow-card').forEach((card) => {
        const index = Number(card.dataset.index);
        const offset = index - centerIndex;
        const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
        card.style.setProperty('--card-offset', String(offset));
        card.style.setProperty('--card-distance', String(distance));
        const isPlaying = decodeURIComponent(card.dataset.id) === activeId;
        card.classList.toggle('is-playing', isPlaying);
        card.setAttribute('aria-selected', String(isPlaying));
      });
      setCaption(currentTracks, activeId);
      if (hasFocusWithin) focusCardAt(centerIndex);
    }

    function tracksEqual(a, b) {
      if (a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) if (a[index].id !== b[index].id) return false;
      return true;
    }

    function focusCardAt(index) {
      const card = stageEl.querySelector(`.cover-flow-card[data-index="${index}"]`);
      card?.focus();
    }

    function handleFocusIn() {
      hasFocusWithin = true;
    }

    function handleFocusOut() {
      hasFocusWithin = false;
    }

    // Click only ever requests activation -- it does not move anything
    // itself. The shelf visually catches up once (and only once) update()
    // is called back with the confirmed new activeId.
    function handleClick(event, options) {
      const card = event.target.closest('.cover-flow-card');
      if (!card) return;
      card.focus();
      options.onActivate?.(decodeURIComponent(card.dataset.id));
    }

    function handleContextMenu(event, options) {
      const card = event.target.closest('.cover-flow-card');
      if (card) options.onContextMenu?.(decodeURIComponent(card.dataset.id), event);
    }

    // Arrow keys directly activate the neighboring cover -- there is no
    // "browse without playing" state to keep in sync with what's actually
    // playing (see the module comment above). Enter/Space (re)activate
    // whatever cover currently holds focus. Escape blurs, satisfying the
    // contract's "Enter to activate, Escape to back out" requirement.
    function handleKeydown(event, options) {
      const card = event.target.closest('.cover-flow-card');
      if (!card) return;
      const index = Number(card.dataset.index);
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const target = currentTracks[index - 1];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        const target = currentTracks[index + 1];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options.onActivate?.(decodeURIComponent(card.dataset.id));
      } else if (event.key === 'Escape') {
        card.blur();
      }
    }

    function mount(container, tracks, options = {}) {
      mountedContainer = container;
      container.classList.add('cover-flow-mounted');
      container.innerHTML = '';
      stageEl = document.createElement('div');
      stageEl.className = 'cover-flow-stage';
      captionEl = document.createElement('div');
      captionEl.className = 'cover-flow-caption';
      container.appendChild(stageEl);
      container.appendChild(captionEl);

      const onClick = (event) => handleClick(event, options);
      const onKeydown = (event) => handleKeydown(event, options);
      const onFocusIn = () => handleFocusIn();
      const onFocusOut = () => handleFocusOut();
      const onContextMenu = (event) => handleContextMenu(event, options);
      stageEl.addEventListener('click', onClick);
      stageEl.addEventListener('keydown', onKeydown);
      stageEl.addEventListener('focusin', onFocusIn);
      stageEl.addEventListener('focusout', onFocusOut);
      stageEl.addEventListener('contextmenu', onContextMenu);
      listeners = { onClick, onKeydown, onFocusIn, onFocusOut, onContextMenu };
      if (tracks && tracks.length) paint(tracks, options.activeId ?? null);
    }

    function update(tracks, activeId) {
      if (!mountedContainer) return;
      if (tracksEqual(currentTracks, tracks)) {
        // Same list (e.g. skip-next, manually choosing a track, or any
        // other re-render that doesn't change what's browsable) --
        // recenter in place instead of rebuilding every cover.
        currentTracks = tracks;
        recenterOn(activeId);
        return;
      }
      paint(tracks, activeId);
    }

    function destroy() {
      if (stageEl && listeners) {
        stageEl.removeEventListener('click', listeners.onClick);
        stageEl.removeEventListener('keydown', listeners.onKeydown);
        stageEl.removeEventListener('focusin', listeners.onFocusIn);
        stageEl.removeEventListener('focusout', listeners.onFocusOut);
        stageEl.removeEventListener('contextmenu', listeners.onContextMenu);
      }
      if (mountedContainer) {
        mountedContainer.classList.remove('cover-flow-mounted');
        mountedContainer.innerHTML = '';
      }
      mountedContainer = null;
      stageEl = null;
      captionEl = null;
      listeners = null;
      currentTracks = [];
      hasFocusWithin = false;
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Cover Flow' },
      // Exposed for unit testing (scripts/check-cover-flow.js) without
      // needing to simulate every DOM event by hand.
      __test__: { coverHtml, captionHtml, tracksEqual, centerIndexFor },
    });
  }

  return Object.freeze({ createCoverFlowMechanic });
}));
