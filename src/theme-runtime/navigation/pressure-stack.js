(function pixelodyPressureStackMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyPressureStackMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPressureStackMechanicModule() {
  'use strict';

  // Pressure Stack has one position: the track the host confirms through
  // activeId. Clicks and keys request activation but never move the visual
  // datum optimistically, so focus and playback truth cannot drift apart.
  const MAX_VISUAL_DISTANCE = 5;

  function createPressureStackMechanic(host) {
    if (!host?.format) throw new Error('createPressureStackMechanic requires a host format adapter.');

    let mountedContainer = null;
    let stageEl = null;
    let statusEl = null;
    let listeners = null;
    let currentTracks = [];
    let currentActiveId = null;
    let hasFocusWithin = false;

    function centerIndexFor(tracks, activeId) {
      if (!tracks.length) return -1;
      const index = activeId ? tracks.findIndex((track) => track.id === activeId) : -1;
      return index >= 0 ? index : 0;
    }

    function visualProps(offset) {
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      return { distance, side: offset < 0 ? -1 : offset > 0 ? 1 : 0 };
    }

    function plateHtml(track, index, offset, isPlaying, isCentered) {
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      const artStyle = artUrl ? `style="--pressure-art:url('${host.format.escapeHtml(artUrl)}')"` : '';
      const { distance, side } = visualProps(offset);
      const number = String(index + 1).padStart(2, '0');
      const title = host.format.escapeHtml(track.title || 'Untitled track');
      const artist = host.format.escapeHtml(track.artist || 'Unknown artist');
      const album = host.format.escapeHtml(track.album || 'Local collection');
      const format = host.format.escapeHtml(String(track.format || 'LOCAL').toUpperCase().slice(0, 12));
      const duration = host.format.durationText(track.duration);
      const state = isPlaying ? 'LIVE DEPTH' : isCentered ? 'READY DEPTH' : 'LOCAL STRATUM';
      const classes = ['pressure-stack-card'];
      if (isCentered) classes.push('is-centered');
      if (isPlaying) classes.push('is-playing');
      return `<div class="${classes.join(' ')}" style="--pressure-offset:${offset};--pressure-distance:${distance};--pressure-side:${side}" data-distance="${distance}" tabindex="0" role="option" aria-selected="${isCentered}" aria-label="${number}. ${title}, ${artist}" data-id="${encodeURIComponent(track.id)}" data-index="${index}"><div class="pressure-stack-cast" aria-hidden="true"></div><div class="pressure-stack-plate"><div class="pressure-stack-rail"><b>${number}</b><span>${format}</span><small>${duration}</small></div><div class="pressure-stack-copy"><small>${state}</small><strong>${title}</strong><span>${artist}</span><em>${album}</em></div><div class="pressure-stack-aperture" ${artStyle}><i aria-hidden="true"></i><b aria-hidden="true">${number}</b></div><div class="pressure-stack-meta"><span><small>SOURCE</small><b>${format}</b></span><span><small>TIME</small><b>${duration}</b></span><span><small>STATE</small><b>${isPlaying ? 'CONFIRMED' : 'READY'}</b></span></div><div class="pressure-stack-edge" aria-hidden="true"></div></div></div>`;
    }

    function statusHtml(tracks, activeId) {
      if (!tracks.length) return '<span>PRESSURE STACK / EMPTY</span><b>IMPORT LOCAL MUSIC</b><i>00 / 00</i>';
      const index = centerIndexFor(tracks, activeId);
      const track = tracks[index];
      const state = activeId && track?.id === activeId ? 'CONFIRMED DEPTH' : 'READY DEPTH';
      return `<span>LOCAL STRATA / ${state}</span><b>${host.format.escapeHtml(track?.title || 'Choose a track')}</b><i>${String(index + 1).padStart(2, '0')} / ${String(tracks.length).padStart(2, '0')}</i>`;
    }

    function tracksEqual(a, b) {
      if (a.length !== b.length) return false;
      return a.every((track, index) => {
        const other = b[index];
        return track.id === other.id && track.title === other.title && track.artist === other.artist
          && track.album === other.album && track.format === other.format
          && track.duration === other.duration && track.artworkPath === other.artworkPath;
      });
    }

    function paint(tracks, activeId) {
      currentTracks = tracks;
      currentActiveId = activeId || null;
      if (!stageEl) return;
      const centerIndex = centerIndexFor(tracks, activeId);
      stageEl.innerHTML = tracks.length ? tracks.map((track, index) => plateHtml(
        track, index, index - centerIndex,
        Boolean(activeId && track.id === activeId), index === centerIndex,
      )).join('') : '<div class="pressure-stack-empty"><b>NO LOCAL STRATA</b><span>Import music to build this pressure record.</span></div>';
      if (statusEl) statusEl.innerHTML = statusHtml(tracks, activeId);
    }

    function focusCardAt(index) {
      stageEl?.querySelector(`.pressure-stack-card[data-index="${index}"]`)?.focus();
    }

    function recenterOn(activeId) {
      currentActiveId = activeId || null;
      const centerIndex = centerIndexFor(currentTracks, activeId);
      stageEl?.querySelectorAll('.pressure-stack-card').forEach((card) => {
        const index = Number(card.dataset.index);
        const offset = index - centerIndex;
        const { distance, side } = visualProps(offset);
        const id = decodeURIComponent(card.dataset.id);
        const isCentered = index === centerIndex;
        const isPlaying = Boolean(activeId && id === activeId);
        card.style.setProperty('--pressure-offset', String(offset));
        card.style.setProperty('--pressure-distance', String(distance));
        card.style.setProperty('--pressure-side', String(side));
        card.dataset.distance = String(distance);
        card.classList.toggle('is-centered', isCentered);
        card.classList.toggle('is-playing', isPlaying);
        card.setAttribute('aria-selected', String(isCentered));
        const state = card.querySelector('.pressure-stack-copy small');
        if (state) state.textContent = isPlaying ? 'LIVE DEPTH' : isCentered ? 'READY DEPTH' : 'LOCAL STRATUM';
        const stateValue = card.querySelector('.pressure-stack-meta span:last-child b');
        if (stateValue) stateValue.textContent = isPlaying ? 'CONFIRMED' : 'READY';
      });
      if (statusEl) statusEl.innerHTML = statusHtml(currentTracks, activeId);
      if (hasFocusWithin && centerIndex >= 0) focusCardAt(centerIndex);
    }

    function cardFromEvent(event) { return event.target.closest?.('.pressure-stack-card'); }

    function handleClick(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      card.focus();
      options.onActivate?.(decodeURIComponent(card.dataset.id));
    }

    function handleFocusIn(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      hasFocusWithin = true;
      options.onSelect?.(decodeURIComponent(card.dataset.id));
    }

    function handleFocusOut(event) {
      if (event.relatedTarget?.closest?.('.pressure-stack-card')) return;
      hasFocusWithin = false;
    }

    function handleContextMenu(event, options) {
      const card = cardFromEvent(event);
      if (card) options.onContextMenu?.(decodeURIComponent(card.dataset.id), event);
    }

    function handleKeydown(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      const centerIndex = centerIndexFor(currentTracks, currentActiveId);
      const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0;
      if (delta) {
        event.preventDefault();
        const target = currentTracks[centerIndex + delta];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const target = event.key === 'Home' ? currentTracks[0] : currentTracks[currentTracks.length - 1];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options.onActivate?.(decodeURIComponent(card.dataset.id));
      } else if (event.key === 'Escape') card.blur();
    }

    function mount(container, tracks, options = {}) {
      mountedContainer = container;
      container.classList.add('pressure-stack-mounted');
      container.innerHTML = '';
      stageEl = document.createElement('div');
      stageEl.className = 'pressure-stack-stage';
      stageEl.setAttribute('role', 'listbox');
      stageEl.setAttribute('aria-label', 'Track pressure stack');
      statusEl = document.createElement('div');
      statusEl.className = 'pressure-stack-status';
      container.appendChild(stageEl);
      container.appendChild(statusEl);
      const handlers = {
        click: (event) => handleClick(event, options),
        keydown: (event) => handleKeydown(event, options),
        focusin: (event) => handleFocusIn(event, options),
        focusout: handleFocusOut,
        contextmenu: (event) => handleContextMenu(event, options),
      };
      Object.entries(handlers).forEach(([type, fn]) => stageEl.addEventListener(type, fn));
      listeners = handlers;
      paint(tracks || [], options.activeId ?? null);
    }

    function update(tracks, activeId) {
      if (!mountedContainer) return;
      if (tracksEqual(currentTracks, tracks)) {
        currentTracks = tracks;
        recenterOn(activeId);
      } else paint(tracks, activeId);
    }

    function destroy() {
      if (stageEl && listeners) Object.entries(listeners).forEach(([type, fn]) => stageEl.removeEventListener(type, fn));
      if (mountedContainer) {
        mountedContainer.classList.remove('pressure-stack-mounted');
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
      mount, update, destroy,
      meta: { label: 'Pressure Stack' },
      __test__: { plateHtml, statusHtml, tracksEqual, centerIndexFor, visualProps },
    });
  }

  return Object.freeze({ createPressureStackMechanic });
}));
