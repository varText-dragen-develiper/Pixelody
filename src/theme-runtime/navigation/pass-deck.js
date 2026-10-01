(function pixelodyPassDeckMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyPassDeckMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPassDeckMechanicModule() {
  'use strict';

  // Pass Deck turns a track collection into a row of collectible information
  // objects: the confirmed track is a complete two-zone pass, while neighbors
  // compress into diagonal apertures. Interaction deliberately follows the
  // single-position lesson in contract.md. A click or key only requests
  // activation; the deck recenters only after update() returns a confirmed
  // activeId from the host.
  const MAX_VISUAL_DISTANCE = 4;

  function createPassDeckMechanic(host) {
    if (!host?.format) throw new Error('createPassDeckMechanic requires a host format adapter.');

    let mountedContainer = null;
    let stageEl = null;
    let statusEl = null;
    let listeners = null;
    let currentTracks = [];
    let currentActiveId = null;
    let hasFocusWithin = false;

    function centerIndexFor(tracks, activeId) {
      if (!tracks.length) return -1;
      if (!activeId) return 0;
      const index = tracks.findIndex((track) => track.id === activeId);
      return index >= 0 ? index : 0;
    }

    function passHtml(track, index, offset, isPlaying, isCentered) {
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      const artStyle = artUrl ? `style="background-image:url('${host.format.escapeHtml(artUrl)}')"` : '';
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      const artist = host.format.escapeHtml(track.artist || 'Unknown artist');
      const album = host.format.escapeHtml(track.album || 'Local collection');
      const duration = host.format.durationText(track.duration);
      const state = isPlaying ? 'LIVE' : 'READY';
      const classNames = ['pass-deck-card'];
      if (isCentered) classNames.push('is-centered');
      if (isPlaying) classNames.push('is-playing');
      return `<div class="${classNames.join(' ')}" style="--pass-offset:${offset};--pass-distance:${distance}" tabindex="0" role="button" aria-selected="${isCentered}" data-id="${encodeURIComponent(track.id)}" data-index="${index}"><div class="pass-deck-shell"><div class="pass-deck-art" ${artStyle}><span>${String(index + 1).padStart(2, '0')}</span></div><div class="pass-deck-copy"><small>MEMORY PASS / ${String(index + 1).padStart(2, '0')}</small><strong>${host.format.escapeHtml(track.title)}</strong><span>${artist} &middot; ${album}</span></div><div class="pass-deck-stub"><small>${state}</small><b>${duration}</b><i aria-hidden="true"></i></div></div></div>`;
    }

    function statusHtml(tracks, activeId) {
      if (!tracks.length) return '<span>NO PASSES</span><b>IMPORT LOCAL MUSIC</b>';
      const index = centerIndexFor(tracks, activeId);
      const track = tracks[index];
      const state = activeId && track?.id === activeId ? 'CONFIRMED' : 'READY';
      return `<span>PASS ${String(index + 1).padStart(2, '0')} / ${String(tracks.length).padStart(2, '0')}</span><b>${state} &middot; ${host.format.escapeHtml(track?.title || 'Choose a track')}</b>`;
    }

    function paint(tracks, activeId) {
      currentTracks = tracks;
      currentActiveId = activeId || null;
      if (!stageEl) return;
      const centerIndex = centerIndexFor(tracks, activeId);
      stageEl.innerHTML = tracks.map((track, index) => passHtml(
        track,
        index,
        index - centerIndex,
        Boolean(activeId && track.id === activeId),
        index === centerIndex,
      )).join('');
      if (statusEl) statusEl.innerHTML = statusHtml(tracks, activeId);
    }

    function tracksEqual(a, b) {
      if (a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) if (a[index].id !== b[index].id) return false;
      return true;
    }

    function focusCardAt(index) {
      stageEl?.querySelector(`.pass-deck-card[data-index="${index}"]`)?.focus();
    }

    function recenterOn(activeId) {
      currentActiveId = activeId || null;
      const centerIndex = centerIndexFor(currentTracks, activeId);
      stageEl.querySelectorAll('.pass-deck-card').forEach((card) => {
        const index = Number(card.dataset.index);
        const offset = index - centerIndex;
        card.style.setProperty('--pass-offset', String(offset));
        card.style.setProperty('--pass-distance', String(Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE)));
        const id = decodeURIComponent(card.dataset.id);
        const isCentered = index === centerIndex;
        const isPlaying = Boolean(activeId && id === activeId);
        card.classList.toggle('is-centered', isCentered);
        card.classList.toggle('is-playing', isPlaying);
        card.setAttribute('aria-selected', String(isCentered));
        const stateLabel = card.querySelector('.pass-deck-stub small');
        if (stateLabel) stateLabel.textContent = isPlaying ? 'LIVE' : 'READY';
      });
      if (statusEl) statusEl.innerHTML = statusHtml(currentTracks, activeId);
      if (hasFocusWithin && centerIndex >= 0) focusCardAt(centerIndex);
    }

    function handleClick(event, options) {
      const card = event.target.closest('.pass-deck-card');
      if (!card) return;
      card.focus();
      options.onActivate?.(decodeURIComponent(card.dataset.id));
    }

    function handleFocusIn(event, options) {
      hasFocusWithin = true;
      const card = event.target.closest?.('.pass-deck-card');
      if (card) options.onSelect?.(decodeURIComponent(card.dataset.id));
    }

    function handleFocusOut(event) {
      if (event.relatedTarget?.closest?.('.pass-deck-card')) return;
      hasFocusWithin = false;
    }

    function handleContextMenu(event, options) {
      const card = event.target.closest('.pass-deck-card');
      if (card) options.onContextMenu?.(decodeURIComponent(card.dataset.id), event);
    }

    function handleKeydown(event, options) {
      const card = event.target.closest('.pass-deck-card');
      if (!card) return;
      const centerIndex = centerIndexFor(currentTracks, currentActiveId);
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const target = currentTracks[centerIndex - 1];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        const target = currentTracks[centerIndex + 1];
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
      container.classList.add('pass-deck-mounted');
      container.innerHTML = '';
      stageEl = document.createElement('div');
      stageEl.className = 'pass-deck-stage';
      statusEl = document.createElement('div');
      statusEl.className = 'pass-deck-status';
      container.appendChild(stageEl);
      container.appendChild(statusEl);

      const onClick = (event) => handleClick(event, options);
      const onKeydown = (event) => handleKeydown(event, options);
      const onFocusIn = (event) => handleFocusIn(event, options);
      const onFocusOut = (event) => handleFocusOut(event);
      const onContextMenu = (event) => handleContextMenu(event, options);
      stageEl.addEventListener('click', onClick);
      stageEl.addEventListener('keydown', onKeydown);
      stageEl.addEventListener('focusin', onFocusIn);
      stageEl.addEventListener('focusout', onFocusOut);
      stageEl.addEventListener('contextmenu', onContextMenu);
      listeners = { onClick, onKeydown, onFocusIn, onFocusOut, onContextMenu };
      paint(tracks || [], options.activeId ?? null);
    }

    function update(tracks, activeId) {
      if (!mountedContainer) return;
      if (tracksEqual(currentTracks, tracks)) {
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
        mountedContainer.classList.remove('pass-deck-mounted');
        mountedContainer.innerHTML = '';
      }
      mountedContainer = null;
      stageEl = null;
      statusEl = null;
      listeners = null;
      currentTracks = [];
      currentActiveId = null;
      hasFocusWithin = false;
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Pass Deck' },
      __test__: { passHtml, statusHtml, tracksEqual, centerIndexFor },
    });
  }

  return Object.freeze({ createPassDeckMechanic });
}));
