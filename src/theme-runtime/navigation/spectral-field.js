(function pixelodySpectralFieldMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySpectralFieldMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSpectralFieldMechanicModule() {
  'use strict';

  // A perspective process corridor for themes that treat a track list as a
  // topology rather than a table. Like carousel/cover-flow, confirmed
  // activeId is the only position source of truth. Cards request playback;
  // they never move the corridor until update() confirms the new active id.
  const MAX_VISUAL_DISTANCE = 5;

  function createSpectralFieldMechanic(host) {
    if (!host) throw new Error('createSpectralFieldMechanic requires a host adapter object.');

    let mountedContainer = null;
    let stageEl = null;
    let captionEl = null;
    let listeners = null;
    let currentTracks = [];
    let hasFocusWithin = false;

    function centerIndexFor(tracks, activeId) {
      if (!tracks.length) return -1;
      const index = activeId ? tracks.findIndex((track) => track.id === activeId) : -1;
      return index >= 0 ? index : 0;
    }

    function cardHtml(track, index, offset, isPlaying, isCentered) {
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      const artStyle = artUrl ? `style="background-image:url('${host.format.escapeHtml(artUrl)}')"` : '';
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      const direction = Math.sign(offset);
      const permission = isPlaying ? 'r-x / LIVE' : isCentered ? 'r-- / READY' : 'r-- / INDEX';
      const number = String(index + 1).padStart(2, '0');
      return `<div class="spectral-field-card${isPlaying ? ' is-playing' : ''}${isCentered ? ' is-centered' : ''}" style="--field-offset:${offset};--field-distance:${distance};--field-direction:${direction}" tabindex="0" role="button" aria-selected="${isCentered}" data-id="${encodeURIComponent(track.id)}" data-index="${index}"><span class="spectral-field-index">${number}</span><div class="spectral-field-art${artUrl ? ' has-art' : ''}" ${artStyle}><b>${artUrl ? '' : 'GI'}</b><i aria-hidden="true"></i></div><div class="spectral-field-copy"><strong>${host.format.escapeHtml(track.title)}</strong><span>${host.format.escapeHtml(track.artist || 'Unknown artist')}</span></div><small class="spectral-field-permission">${permission}</small></div>`;
    }

    function captionHtml(track, index, total, isPlaying) {
      if (!track) return '<span class="spectral-field-empty">NO LOCAL EVENTS</span>';
      const format = String(track.format || track.extension || '--').toUpperCase();
      const quality = track.qualityLabel || track.quality || '--';
      return `<span class="spectral-field-caption-code">EVENT ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span><strong>${host.format.escapeHtml(track.title)}</strong><span>${host.format.escapeHtml(track.artist || 'Unknown artist')}</span><small>${host.format.escapeHtml(format)} &middot; ${host.format.escapeHtml(String(quality))} &middot; ${host.format.durationText(track.duration)} &middot; ${isPlaying ? 'r-x LIVE' : 'r-- READY'}</small>`;
    }

    function setCaption(tracks, activeId) {
      if (!captionEl) return;
      const centerIndex = centerIndexFor(tracks, activeId);
      const track = centerIndex >= 0 ? tracks[centerIndex] : null;
      captionEl.innerHTML = captionHtml(track, centerIndex, tracks.length, Boolean(track && track.id === activeId));
    }

    function paint(tracks, activeId) {
      currentTracks = tracks;
      if (!tracks.length) {
        stageEl.innerHTML = '';
        setCaption(tracks, activeId);
        return;
      }
      const centerIndex = centerIndexFor(tracks, activeId);
      stageEl.innerHTML = tracks.map((track, index) => cardHtml(track, index, index - centerIndex, track.id === activeId, index === centerIndex)).join('');
      setCaption(tracks, activeId);
    }

    function tracksEqual(a, b) {
      if (a.length !== b.length) return false;
      return a.every((track, index) => track.id === b[index].id);
    }

    function focusCardAt(index) {
      stageEl?.querySelector(`.spectral-field-card[data-index="${index}"]`)?.focus();
    }

    function recenterOn(activeId) {
      const centerIndex = centerIndexFor(currentTracks, activeId);
      stageEl.querySelectorAll('.spectral-field-card').forEach((card) => {
        const index = Number(card.dataset.index);
        const offset = index - centerIndex;
        const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
        card.style.setProperty('--field-offset', String(offset));
        card.style.setProperty('--field-distance', String(distance));
        card.style.setProperty('--field-direction', String(Math.sign(offset)));
        const isPlaying = decodeURIComponent(card.dataset.id) === activeId;
        const isCentered = index === centerIndex;
        card.classList.toggle('is-playing', isPlaying);
        card.classList.toggle('is-centered', isCentered);
        card.setAttribute('aria-selected', String(isCentered));
        const permission = card.querySelector?.('.spectral-field-permission');
        if (permission) permission.textContent = isPlaying ? 'r-x / LIVE' : isCentered ? 'r-- / READY' : 'r-- / INDEX';
      });
      setCaption(currentTracks, activeId);
      if (hasFocusWithin && centerIndex >= 0) focusCardAt(centerIndex);
    }

    function cardFromEvent(event) {
      return event.target.closest('.spectral-field-card');
    }

    function handleClick(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      card.focus();
      options.onActivate?.(decodeURIComponent(card.dataset.id));
    }

    function handleContextMenu(event, options) {
      const card = cardFromEvent(event);
      if (card) options.onContextMenu?.(decodeURIComponent(card.dataset.id), event);
    }

    function handleKeydown(event, options) {
      const card = cardFromEvent(event);
      if (!card) return;
      const index = Number(card.dataset.index);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const target = currentTracks[index - 1];
        if (target) options.onActivate?.(target.id);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
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
      container.classList.add('spectral-field-mounted');
      container.innerHTML = '';
      stageEl = document.createElement('div');
      stageEl.className = 'spectral-field-stage';
      captionEl = document.createElement('div');
      captionEl.className = 'spectral-field-caption';
      container.appendChild(stageEl);
      container.appendChild(captionEl);

      const onClick = (event) => handleClick(event, options);
      const onKeydown = (event) => handleKeydown(event, options);
      const onFocusIn = () => { hasFocusWithin = true; };
      const onFocusOut = () => { hasFocusWithin = false; };
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
      } else {
        paint(tracks, activeId);
      }
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
        mountedContainer.classList.remove('spectral-field-mounted');
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
      meta: { label: 'Spectral Field' },
      __test__: { cardHtml, captionHtml, centerIndexFor, tracksEqual },
    });
  }

  return Object.freeze({ createSpectralFieldMechanic });
}));
