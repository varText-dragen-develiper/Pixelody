(function pixelodyMemoryCascadeMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyMemoryCascadeMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMemoryCascadeMechanicModule() {
  'use strict';

  const MAX_VISUAL_DISTANCE = 5;

  function createMemoryCascadeMechanic(host) {
    if (!host?.format) throw new Error('createMemoryCascadeMechanic requires a host format adapter.');

    let mountedContainer = null;
    let stageEl = null;
    let statusEl = null;
    let listeners = null;
    let currentTracks = [];
    let currentActiveId = null;
    let focusedId = null;

    function centerIndexFor(tracks, activeId) {
      if (!tracks.length) return -1;
      const index = activeId ? tracks.findIndex((track) => track.id === activeId) : -1;
      return index >= 0 ? index : 0;
    }

    function cardHtml(track, index, offset, isPlaying, isCentered) {
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      const artStyle = artUrl ? `style="--memory-art:url('${host.format.escapeHtml(artUrl)}')"` : '';
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      const side = offset < 0 ? -1 : offset > 0 ? 1 : 0;
      const number = String(index + 1).padStart(2, '0');
      const title = host.format.escapeHtml(track.title || 'Untitled track');
      const artist = host.format.escapeHtml(track.artist || 'Unknown artist');
      const album = host.format.escapeHtml(track.album || 'Local collection');
      const format = host.format.escapeHtml(String(track.format || 'LOCAL').toUpperCase().slice(0, 10));
      const duration = host.format.durationText(track.duration);
      const state = isPlaying ? 'SIGNAL LIVE' : isCentered ? 'FOCUS READY' : 'LOCAL MEMORY';
      const classes = ['memory-cascade-card'];
      if (isCentered) classes.push('is-centered');
      if (isPlaying) classes.push('is-playing');
      return `<div class="${classes.join(' ')}" style="--memory-offset:${offset};--memory-distance:${distance};--memory-side:${side}" tabindex="0" role="option" aria-selected="${isCentered}" aria-label="${number}. ${title}, ${artist}" data-id="${encodeURIComponent(track.id)}" data-index="${index}"><div class="memory-cascade-cast" aria-hidden="true"></div><div class="memory-cascade-shell"><div class="memory-cascade-optic" ${artStyle}><span>${number}</span><i aria-hidden="true"></i></div><div class="memory-cascade-board" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b><b></b><b></b></div><div class="memory-cascade-copy"><small>LOCAL MEMORY / ${format}</small><strong>${title}</strong><span>${artist}</span><em>${album}</em></div><div class="memory-cascade-bus" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><div class="memory-cascade-stub"><small>${state}</small><b>${duration}</b><span>${number}</span></div><div class="memory-cascade-edge" aria-hidden="true"></div></div></div>`;
    }

    function statusHtml(tracks, activeId) {
      if (!tracks.length) return '<span>MEMORY CASCADE / EMPTY</span><b>IMPORT LOCAL MUSIC</b><i>00 / 00</i>';
      const index = centerIndexFor(tracks, activeId);
      const track = tracks[index];
      const state = activeId && track?.id === activeId ? 'CONFIRMED POSITION' : 'READY POSITION';
      return `<span>OPTICAL INDEX / LOCAL</span><b>${state} &middot; ${host.format.escapeHtml(track?.title || 'Choose a track')}</b><i>${String(index + 1).padStart(2, '0')} / ${String(tracks.length).padStart(2, '0')}</i>`;
    }

    function tracksEqual(a, b) {
      if (a.length !== b.length) return false;
      return a.every((track, index) => track.id === b[index].id
        && track.title === b[index].title
        && track.artist === b[index].artist
        && track.album === b[index].album
        && track.artworkPath === b[index].artworkPath);
    }

    function paint(tracks, activeId) {
      currentTracks = tracks;
      currentActiveId = activeId || null;
      if (!stageEl) return;
      const centerIndex = centerIndexFor(tracks, activeId);
      stageEl.innerHTML = tracks.map((track, index) => cardHtml(
        track, index, index - centerIndex,
        Boolean(activeId && track.id === activeId), index === centerIndex,
      )).join('');
      if (statusEl) statusEl.innerHTML = statusHtml(tracks, activeId);
    }

    function focusCardAt(index) {
      stageEl?.querySelector(`.memory-cascade-card[data-index="${index}"]`)?.focus();
    }

    function recenterOn(activeId) {
      currentActiveId = activeId || null;
      const centerIndex = centerIndexFor(currentTracks, activeId);
      stageEl?.querySelectorAll('.memory-cascade-card').forEach((card) => {
        const index = Number(card.dataset.index);
        const offset = index - centerIndex;
        const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
        const id = decodeURIComponent(card.dataset.id);
        const isCentered = index === centerIndex;
        const isPlaying = Boolean(activeId && id === activeId);
        card.style.setProperty('--memory-offset', String(offset));
        card.style.setProperty('--memory-distance', String(distance));
        card.style.setProperty('--memory-side', String(offset < 0 ? -1 : offset > 0 ? 1 : 0));
        card.classList.toggle('is-centered', isCentered);
        card.classList.toggle('is-playing', isPlaying);
        card.setAttribute('aria-selected', String(isCentered));
        const state = card.querySelector('.memory-cascade-stub small');
        if (state) state.textContent = isPlaying ? 'SIGNAL LIVE' : isCentered ? 'FOCUS READY' : 'LOCAL MEMORY';
      });
      if (statusEl) statusEl.innerHTML = statusHtml(currentTracks, activeId);
      if (focusedId) focusCardAt(centerIndex);
    }

    function cardFromEvent(event) { return event.target.closest?.('.memory-cascade-card'); }

    function handleClick(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      card.focus();
      options.onActivate?.(decodeURIComponent(card.dataset.id));
    }

    function handleFocusIn(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      focusedId = decodeURIComponent(card.dataset.id);
      options.onSelect?.(focusedId);
    }

    function handleFocusOut(event) {
      if (event.relatedTarget?.closest?.('.memory-cascade-card')) return;
      focusedId = null;
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
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options.onActivate?.(decodeURIComponent(card.dataset.id));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const target = event.key === 'Home' ? currentTracks[0] : currentTracks[currentTracks.length - 1];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'Escape') card.blur();
    }

    function mount(container, tracks, options = {}) {
      mountedContainer = container;
      container.classList.add('memory-cascade-mounted');
      container.innerHTML = '';
      stageEl = document.createElement('div');
      stageEl.className = 'memory-cascade-stage';
      stageEl.setAttribute('role', 'listbox');
      stageEl.setAttribute('aria-label', 'Track memory cascade');
      statusEl = document.createElement('div');
      statusEl.className = 'memory-cascade-status';
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
        mountedContainer.classList.remove('memory-cascade-mounted');
        mountedContainer.innerHTML = '';
      }
      mountedContainer = null;
      stageEl = null;
      statusEl = null;
      listeners = null;
      currentTracks = [];
      currentActiveId = null;
      focusedId = null;
    }

    return Object.freeze({
      mount, update, destroy,
      meta: { label: 'Memory Cascade' },
      __test__: { cardHtml, statusHtml, tracksEqual, centerIndexFor },
    });
  }

  return Object.freeze({ createMemoryCascadeMechanic });
}));
