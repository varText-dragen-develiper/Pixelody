(function pixelodyCarouselMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCarouselMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCarouselMechanicModule() {
  'use strict';

  // Second registered navigation mechanic (Phase 3 of
  // docs/themes/THEME_RUNTIME_ARCHITECTURE.md). See
  // theme-runtime/navigation/contract.md for the interface and the
  // common-thread requirements every mechanic must meet.
  //
  // Redesigned after two rounds of real-world bug reports (see the plan
  // doc's carousel section for the full history) that all traced back to
  // the same root cause: this used to track TWO independent positions --
  // `focusIndex` (where keyboard/click browsing currently sat) and
  // `activeId` (whichever track was actually playing) -- kept in sync by
  // hand at every call site. Every bug found (skip-next feeling like a
  // hard reset, skip-next appearing to play the previous track, clicks
  // that visually moved the carousel without changing playback, or that
  // changed playback without the carousel visually catching up) came from
  // those two positions drifting apart under one timing condition or
  // another.
  //
  // There is now exactly one position: whichever track is centered IS
  // whichever track is playing, always. Arrow keys don't browse a preview
  // anymore -- ArrowLeft/ArrowRight directly activate the neighboring
  // track, the same as clicking it (by design: the
  // carousel rotates based on which track is actually playing, nothing
  // else). Critically, the carousel never moves optimistically on
  // click/keydown alone -- it only moves once update() is called with a
  // confirmed new activeId. If a click's playTrack() call fails partway
  // (missing file, audio engine error, superseded by a faster second
  // click, etc.) the carousel correctly does not move either, so there is
  // no window where the visual position and actual playback can disagree.
  const MAX_VISUAL_DISTANCE = 5;

  function createCarouselMechanic(host) {
    if (!host) throw new Error('createCarouselMechanic requires a host adapter object.');

    let mountedContainer = null;
    let listeners = null;
    let currentTracks = [];
    // Whether DOM focus is currently somewhere inside this carousel,
    // tracked via focusin/focusout (not a global document read, so this
    // stays testable with a fake container the same way as everything
    // else here). An external activeId change (skip-next, natural
    // advance, a remote-control command) is only allowed to move DOM
    // focus to follow the new center when this is true -- it must never
    // steal focus from elsewhere in the app.
    let hasFocusWithin = false;

    function cardHtml(track, index, offset, isActive) {
      const art = track.artworkPath ? `style="background-image:url('${host.format.escapeHtml(host.format.fileUrl(track.artworkPath))}')"` : '';
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      return `<div class="carousel-card${isActive ? ' is-playing' : ''}" style="--card-offset:${offset};--card-distance:${distance}" tabindex="0" role="button" aria-selected="${isActive}" data-id="${encodeURIComponent(track.id)}" data-index="${index}"><div class="carousel-card-art" ${art}></div><div class="carousel-card-body"><strong class="carousel-card-title">${host.format.escapeHtml(track.title)}</strong><span class="carousel-card-meta">${host.format.escapeHtml(track.artist)}${track.album ? ` &middot; ${host.format.escapeHtml(track.album)}` : ''}</span><span class="carousel-card-duration">${host.format.durationText(track.duration)}</span></div></div>`;
    }

    // The single source of truth for where the carousel is centered: the
    // position of whichever track is actually playing. Falls back to the
    // first card only when nothing is playing (activeId null) or the
    // active track genuinely isn't in this list.
    function centerIndexFor(tracks, activeId) {
      if (!activeId) return 0;
      const index = tracks.findIndex((track) => track.id === activeId);
      return index >= 0 ? index : 0;
    }

    // Full repaint: rebuilds every card. Used on mount and whenever the
    // track list itself changes (update()). A same-list activeId change
    // goes through recenterOn() instead, which mutates the existing DOM
    // rather than rebuilding it, so any in-flight CSS transition on
    // --card-offset/--card-distance isn't interrupted.
    function paint(container, tracks, activeId) {
      currentTracks = tracks;
      if (!tracks.length) {
        container.innerHTML = '';
        return;
      }
      const centerIndex = centerIndexFor(tracks, activeId);
      container.innerHTML = tracks.map((track, index) => cardHtml(track, index, index - centerIndex, track.id === activeId)).join('');
    }

    // Moves the visual center and the is-playing marker to match a new,
    // confirmed activeId WITHOUT rebuilding any DOM nodes, so the existing
    // transform/opacity transition on .carousel-card actually animates the
    // slide (this is what makes skip-next/natural-advance feel like the
    // carousel moving to the next track instead of an instant hard reset).
    // Only valid when the track list itself hasn't changed -- see
    // update()'s tracksEqual() guard, which decides between this and a
    // full repaint.
    function recenterOn(container, activeId) {
      const centerIndex = centerIndexFor(currentTracks, activeId);
      container.querySelectorAll('.carousel-card').forEach((card) => {
        const index = Number(card.dataset.index);
        const offset = index - centerIndex;
        const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
        card.style.setProperty('--card-offset', String(offset));
        card.style.setProperty('--card-distance', String(distance));
        const isPlaying = decodeURIComponent(card.dataset.id) === activeId;
        card.classList.toggle('is-playing', isPlaying);
        card.setAttribute('aria-selected', String(isPlaying));
      });
      if (hasFocusWithin) focusCardAt(container, centerIndex);
    }

    function tracksEqual(a, b) {
      if (a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) if (a[index].id !== b[index].id) return false;
      return true;
    }

    function focusCardAt(container, index) {
      const card = container.querySelector(`.carousel-card[data-index="${index}"]`);
      card?.focus();
    }

    function handleFocusIn() {
      hasFocusWithin = true;
    }

    // focusout fires (and bubbles to the container) whenever a card loses
    // focus, including the transient moment focus moves from one card to
    // another -- but focusout always fires before the following focusin
    // (standard, spec-guaranteed ordering), so a move between two cards in
    // this carousel nets out to hasFocusWithin staying true, while a move
    // to something outside the carousel correctly leaves it false.
    function handleFocusOut() {
      hasFocusWithin = false;
    }

    // Click only ever requests activation -- it does not move anything
    // itself. The carousel visually catches up once (and only once)
    // update() is called back with the confirmed new activeId.
    function handleClick(event, options) {
      const card = event.target.closest('.carousel-card');
      if (!card) return;
      card.focus();
      options.onActivate?.(decodeURIComponent(card.dataset.id));
    }

    function handleContextMenu(event, options) {
      const card = event.target.closest('.carousel-card');
      if (card) options.onContextMenu?.(decodeURIComponent(card.dataset.id), event);
    }

    // Arrow keys directly activate the neighboring track -- there is no
    // "browse without playing" state to keep in sync with what's actually
    // playing anymore (see the module comment above for why that used to
    // be the bug). Enter/Space (re)activate whatever card currently holds
    // focus, for the case where the user tabbed into the carousel without
    // using arrow keys. Escape blurs, satisfying the contract's "Enter to
    // activate, Escape to back out" requirement for a non-modal widget
    // with nothing else to back out of.
    function handleKeydown(event, options) {
      const card = event.target.closest('.carousel-card');
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
      container.classList.add('carousel-mounted');
      const onClick = (event) => handleClick(event, options);
      const onKeydown = (event) => handleKeydown(event, options);
      const onFocusIn = () => handleFocusIn();
      const onFocusOut = () => handleFocusOut();
      const onContextMenu = (event) => handleContextMenu(event, options);
      container.addEventListener('click', onClick);
      container.addEventListener('keydown', onKeydown);
      container.addEventListener('focusin', onFocusIn);
      container.addEventListener('focusout', onFocusOut);
      container.addEventListener('contextmenu', onContextMenu);
      listeners = { onClick, onKeydown, onFocusIn, onFocusOut, onContextMenu };
      if (tracks && tracks.length) paint(container, tracks, options.activeId ?? null);
    }

    function update(tracks, activeId) {
      if (!mountedContainer) return;
      if (tracksEqual(currentTracks, tracks)) {
        // Same list (e.g. skip-next, manually choosing a track, or any
        // other re-render that doesn't change what's browsable) --
        // recenter in place instead of rebuilding every card.
        currentTracks = tracks;
        recenterOn(mountedContainer, activeId);
        return;
      }
      paint(mountedContainer, tracks, activeId);
    }

    function destroy() {
      if (mountedContainer && listeners) {
        mountedContainer.removeEventListener('click', listeners.onClick);
        mountedContainer.removeEventListener('keydown', listeners.onKeydown);
        mountedContainer.removeEventListener('focusin', listeners.onFocusIn);
        mountedContainer.removeEventListener('focusout', listeners.onFocusOut);
        mountedContainer.removeEventListener('contextmenu', listeners.onContextMenu);
        mountedContainer.classList.remove('carousel-mounted');
      }
      mountedContainer = null;
      listeners = null;
      currentTracks = [];
      hasFocusWithin = false;
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Carousel' },
      // Exposed for unit testing (scripts/check-carousel.js) without
      // needing to simulate every DOM event by hand.
      __test__: { cardHtml, tracksEqual, centerIndexFor },
    });
  }

  return Object.freeze({ createCarouselMechanic });
}));
