(function pixelodyGraftlineMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyGraftlineMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createGraftlineMechanicApi() {
  'use strict';

  // Aftergarden intentionally keeps a browse cursor distinct from host-confirmed
  // playback. selectedId owns exactly one aria-selected cutting; activeId is a
  // read-only confirmation input and alone owns the crossed/bloom state.
  function createGraftlineMechanic(host = {}) {
    let container = null;
    let currentTracks = [];
    let currentActiveId = null;
    let selectedId = null;
    let currentOptions = {};
    let callbacks = {};

    const escapeHtml = host.format?.escapeHtml || ((value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])));
    const durationText = host.format?.durationText || ((value) => `${Math.max(0, Math.round(Number(value) || 0))}s`);

    function findTrack(id) { return currentTracks.find((track) => track.id === id) || null; }
    function stateFor(track) {
      if (track.id === currentActiveId) return currentOptions.playbackState === 'paused' ? 'CURRENT / PAUSED' : 'CROSSED / CONFIRMED';
      if (track.id === currentOptions.activationPendingId) return 'REQUESTED / AWAITING CONFIRMATION';
      if (track.id === currentOptions.activationFailedId) return 'REQUEST FAILED / CURRENT RETAINED';
      if (track.id === selectedId) return 'FOCUS / NOT PLAYING';
      return track.missing ? 'MISSING / RECOVERABLE' : 'AVAILABLE';
    }
    function cuttingHtml(track, index) {
      const selected = track.id === selectedId;
      const playing = track.id === currentActiveId;
      const pending = track.id === currentOptions.activationPendingId;
      const failed = track.id === currentOptions.activationFailedId;
      const quality = [track.bitDepth ? `${track.bitDepth}-BIT` : '', track.sampleRate ? `${Math.round(track.sampleRate / 1000)} KHZ` : ''].filter(Boolean).join(' / ');
      return `<button class="graftline-cutting${selected ? ' is-focused' : ''}${playing ? ' is-playing' : ''}${pending ? ' is-pending' : ''}${failed ? ' is-failed' : ''}${track.missing ? ' is-missing' : ''}" role="option" aria-selected="${selected}" aria-label="${escapeHtml(`${track.title}, ${track.artist || 'Unknown artist'}, ${stateFor(track)}`)}" tabindex="${selected ? '0' : '-1'}" data-id="${encodeURIComponent(track.id)}" style="--graft-index:${index};--graft-column:${index % 4};--graft-row:${Math.floor(index / 4)}"><em>${String(index + 1).padStart(2, '0')}</em><span><strong>${escapeHtml(track.title || 'Untitled track')}</strong><small>${escapeHtml(track.artist || 'Unknown artist')}${track.album ? ` · ${escapeHtml(track.album)}` : ''}</small></span><i>${escapeHtml(String(track.format || 'LOCAL').toUpperCase())}${quality ? ` · ${escapeHtml(quality)}` : ''} · ${escapeHtml(durationText(track.duration))}</i><b class="graftline-state">${escapeHtml(stateFor(track))}</b>${playing ? '<span class="graftline-bloom" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><b></b></span>' : ''}</button>`;
    }
    function confirmedHtml() {
      const track = findTrack(currentActiveId);
      if (!track) return '<div class="graftline-confirmed is-idle" aria-hidden="true"><small>AFTERFIELD / CONFIRMED</small><strong>NO CONFIRMED OUTPUT</strong><span>Choose a cutting, then commit playback.</span></div>';
      return `<div class="graftline-confirmed" aria-hidden="true"><small>AFTERFIELD / CONFIRMED</small><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist || 'Unknown artist')} · ${currentOptions.playbackState === 'paused' ? 'CURRENT / PAUSED' : 'CONFIRMED PLAYING'}</span></div>`;
    }
    function stageHtml() {
      const phase = currentOptions.playbackState || 'idle';
      const pending = currentOptions.activationPendingId ? ' has-pending' : '';
      return `<section class="graftline-passage${pending}" data-playback-phase="${escapeHtml(phase)}"><div class="graftline-field-label">POSSIBILITY / BROWSE <span>${String(currentTracks.length).padStart(2, '0')} LOCAL TRACKS</span></div><div class="graftline-list" role="listbox" aria-label="Aftergarden track passage">${currentTracks.map(cuttingHtml).join('')}</div><svg class="graftline-threshold" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 360 C190 300 365 352 535 258 S810 172 1020 126"/><path d="M-20 378 C190 318 365 370 535 276 S810 190 1020 144"/></svg><div class="graftline-afterfield" aria-hidden="true"></div>${confirmedHtml()}<output class="graftline-live" aria-live="polite">${escapeHtml(findTrack(currentOptions.activationFailedId) ? `Playback request failed for ${findTrack(currentOptions.activationFailedId).title}. Current playback retained.` : findTrack(currentOptions.activationPendingId) ? `Playback requested for ${findTrack(currentOptions.activationPendingId).title}. Awaiting confirmation.` : '')}</output></section>`;
    }
    function paint() {
      if (!container) return;
      if (!currentTracks.length) {
        container.innerHTML = '<section class="graftline-empty"><small>POSSIBILITY / EMPTY</small><strong>Bring music into the passage.</strong><span>The shared import controls remain available.</span></section>';
        return;
      }
      if (!findTrack(selectedId)) selectedId = findTrack(currentActiveId)?.id || currentTracks[0].id;
      container.innerHTML = stageHtml();
    }
    function focusSelected() { container?.querySelector(`[data-id="${encodeURIComponent(selectedId || '')}"]`)?.focus(); }
    function select(id, shouldFocus = true) {
      if (!findTrack(id)) return;
      selectedId = id;
      callbacks.onSelect?.(id);
      paint();
      if (shouldFocus) focusSelected();
    }
    function request(id) { if (findTrack(id)) callbacks.onActivate?.(id); }
    function idFromTarget(target) {
      const cutting = target?.closest?.('.graftline-cutting');
      return cutting ? decodeURIComponent(cutting.dataset.id) : null;
    }
    function onClick(event) {
      const id = idFromTarget(event.target); if (!id) return;
      if (selectedId !== id) select(id);
      else if (id === currentActiveId && callbacks.onToggleCurrent) callbacks.onToggleCurrent(id);
      else request(id);
    }
    function onDoubleClick(event) { const id = idFromTarget(event.target); if (id) request(id); }
    function onContextMenu(event) { const id = idFromTarget(event.target); if (id) callbacks.onContextMenu?.(id, event); }
    function onKeyDown(event) {
      const id = idFromTarget(event.target); if (!id) return;
      const index = currentTracks.findIndex((track) => track.id === id);
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % currentTracks.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + currentTracks.length) % currentTracks.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = currentTracks.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); request(id); return; }
      else if (event.key === 'Escape') { event.preventDefault(); callbacks.onEscape?.(); return; }
      else return;
      event.preventDefault(); select(currentTracks[next].id);
    }
    function bind() {
      container.addEventListener('click', onClick);
      container.addEventListener('dblclick', onDoubleClick);
      container.addEventListener('contextmenu', onContextMenu);
      container.addEventListener('keydown', onKeyDown);
    }
    function unbind() {
      container?.removeEventListener('click', onClick);
      container?.removeEventListener('dblclick', onDoubleClick);
      container?.removeEventListener('contextmenu', onContextMenu);
      container?.removeEventListener('keydown', onKeyDown);
    }
    function mount(target, tracks = [], options = {}) {
      if (!target) throw new Error('Graftline mechanic requires a container.');
      if (container) destroy();
      container = target; callbacks = options; currentTracks = tracks.slice(); currentActiveId = options.activeId || null; currentOptions = { ...options }; selectedId = options.selectedId || currentActiveId || currentTracks[0]?.id || null; bind(); paint();
    }
    function update(tracks = [], activeId = null, options = {}) {
      currentTracks = tracks.slice(); currentActiveId = activeId || null; currentOptions = { ...currentOptions, ...options, activeId: currentActiveId }; paint();
    }
    function destroy() { unbind(); if (container) container.innerHTML = ''; container = null; currentTracks = []; currentActiveId = null; selectedId = null; currentOptions = {}; callbacks = {}; }

    return { mount, update, destroy, meta: { label: 'Graftline', contractVersion: 1 }, __test__: { cuttingHtml, stateFor, getState: () => ({ selectedId, activeId: currentActiveId, options: { ...currentOptions } }) } };
  }
  return Object.freeze({ createGraftlineMechanic });
}));
