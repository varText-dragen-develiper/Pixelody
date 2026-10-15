(function pixelodySharedStrataMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodySharedStrataMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSharedStrataMechanicModule() {
  'use strict';

  function createSharedStrataMechanic(host) {
    if (!host?.format) throw new Error('createSharedStrataMechanic requires a host format adapter.');

    let container = null;
    let currentTracks = [];
    let currentActiveId = null;
    let selectedId = null;
    let currentOptions = {};
    let callbacks = {};
    let transitionSerial = 0;

    const escapeHtml = (value) => host.format.escapeHtml(String(value ?? ''));
    const durationText = (value) => host.format.durationText(Number(value) || 0);
    const findTrack = (id) => currentTracks.find((track) => String(track.id) === String(id)) || null;
    const findAuthoritativeTrack = (id) => {
      const authoritativeTracks = Array.isArray(currentOptions.authoritativeTracks)
        ? currentOptions.authoritativeTracks
        : currentTracks;
      return authoritativeTracks.find((track) => String(track.id) === String(id)) || null;
    };

    function qualityText(track) {
      const format = String(track.format || track.extension || 'LOCAL').toUpperCase();
      if (track.sampleRate) return `${track.bitDepth || '--'}-BIT / ${Math.round(track.sampleRate / 1000)} KHZ`;
      return String(track.qualityLabel || track.quality || format).toUpperCase();
    }

    function stateFor(track) {
      const current = String(track.id) === String(currentActiveId);
      const pending = String(track.id) === String(currentOptions.activationPendingId) && !current;
      const failed = String(track.id) === String(currentOptions.activationFailedId) && !current;
      const selected = String(track.id) === String(selectedId);
      if (failed) return 'FAILED REQUEST / CURRENT PRESERVED';
      if (pending) return 'REQUESTED / AWAITING CONFIRMATION';
      if (current) return currentOptions.playbackState === 'paused' ? 'CONFIRMED / PAUSED' : 'CONFIRMED / PLAYING';
      if (selected) return 'SELECTED / ENTER TO REQUEST';
      return track.missing ? 'SOURCE MISSING' : 'READY';
    }

    function stratumHtml(track, index) {
      const id = String(track.id);
      const selected = id === String(selectedId);
      const current = id === String(currentActiveId);
      const pending = id === String(currentOptions.activationPendingId) && !current;
      const failed = id === String(currentOptions.activationFailedId) && !current;
      const state = stateFor(track);
      const classes = [
        'shared-stratum', selected ? 'is-selected' : '', current ? 'is-confirmed' : '',
        current && currentOptions.playbackState === 'playing' ? 'is-playing' : '',
        current && currentOptions.playbackState === 'paused' ? 'is-paused' : '',
        pending ? 'is-pending' : '', failed ? 'is-failed' : '', track.missing ? 'is-missing' : '',
      ].filter(Boolean).join(' ');
      const title = track.title || 'Untitled track';
      const artist = track.artist || 'Unknown artist';
      const details = `${qualityText(track)} · ${durationText(track.duration)}`;
      const label = `${title}, ${artist}, ${state}`;
      return `<button class="${classes}" role="option" aria-selected="${selected}" aria-label="${escapeHtml(label)}" tabindex="${selected ? '0' : '-1'}" data-id="${encodeURIComponent(id)}" data-index="${index}" data-state="${failed ? 'failed' : pending ? 'pending' : current ? currentOptions.playbackState || 'confirmed' : selected ? 'selected' : 'ready'}" style="--strata-index:${index};--strata-lane:${index % 5};--strata-count:${currentTracks.length}"><em>${String(index + 1).padStart(2, '0')}</em><span class="shared-stratum-copy"><strong>${escapeHtml(title)}${track.missing ? ' [Missing]' : ''}</strong><small>${escapeHtml(artist)}${track.album ? ` · ${escapeHtml(track.album)}` : ''}</small></span><span class="shared-stratum-detail">${escapeHtml(details)}</span><b class="shared-stratum-state">${escapeHtml(state)}</b><i class="shared-stratum-node" aria-hidden="true"></i></button>`;
    }

    function confirmedHtml() {
      const track = findAuthoritativeTrack(currentActiveId);
      if (!track) return '<div class="shared-strata-confirmed is-idle" aria-hidden="true"><small>CONFIRMED OUTPUT SUTURE</small><strong>NO CONFIRMED PLAYBACK</strong><span>Selection does not move output.</span></div>';
      const phase = currentOptions.playbackState === 'paused' ? 'PAUSED / SUTURE HELD' : 'PLAYING / SUTURE LIVE';
      return `<div class="shared-strata-confirmed" aria-hidden="true"><small>CONFIRMED OUTPUT SUTURE</small><strong>${escapeHtml(track.title || 'Untitled track')}</strong><span>${escapeHtml(track.artist || 'Unknown artist')} · ${phase}</span></div>`;
    }

    function liveMessage() {
      const failed = findAuthoritativeTrack(currentOptions.activationFailedId);
      if (failed) return `Playback request failed for ${failed.title || 'Untitled track'}. Current playback retained.`;
      const pending = findAuthoritativeTrack(currentOptions.activationPendingId);
      if (pending && String(pending.id) !== String(currentActiveId)) return `Playback requested for ${pending.title || 'Untitled track'}. Awaiting confirmation.`;
      return '';
    }

    function stageHtml() {
      if (!currentTracks.length) return `<section class="shared-strata-empty"><small>SHARED STRATA / EMPTY</small><strong>Bring music into the field.</strong><span>Import controls remain available above.</span></section>${confirmedHtml()}<output class="shared-strata-live" aria-live="polite">${escapeHtml(liveMessage())}</output>`;
      const phase = currentOptions.playbackState || 'idle';
      return `<section class="shared-strata-field" data-playback-phase="${escapeHtml(phase)}" data-focus-transit="${transitionSerial}"><div class="shared-strata-mass" aria-hidden="true"><i class="shared-strata-suture"></i><span class="shared-strata-work-guides"><i>QUEUE</i><i>OUTPUT</i><i>TUNING</i><i>META</i></span></div><div class="shared-strata-list" role="listbox" aria-label="Shared strata track browser">${currentTracks.map(stratumHtml).join('')}</div>${confirmedHtml()}<output class="shared-strata-live" aria-live="polite">${escapeHtml(liveMessage())}</output></section>`;
    }

    function paint() {
      if (!container) return;
      if (currentTracks.length && !findTrack(selectedId)) selectedId = findTrack(currentActiveId)?.id || currentTracks[0].id;
      container.innerHTML = stageHtml();
    }

    function focusSelected() {
      container?.querySelector(`[data-id="${encodeURIComponent(String(selectedId || ''))}"]`)?.focus({ preventScroll: true });
    }

    function select(id, shouldFocus = true) {
      const track = findTrack(id);
      if (!track) return;
      if (String(selectedId) !== String(track.id)) transitionSerial += 1;
      selectedId = track.id;
      callbacks.onSelect?.(track.id);
      paint();
      if (shouldFocus) focusSelected();
    }

    function activate(id) {
      const track = findTrack(id);
      if (track) callbacks.onActivate?.(track.id);
    }

    function idFromTarget(target) {
      const stratum = target?.closest?.('.shared-stratum');
      return stratum ? decodeURIComponent(stratum.dataset.id) : null;
    }

    function handleClick(event) {
      const id = idFromTarget(event.target);
      if (!id) return;
      if (String(selectedId) !== String(id)) select(id);
      else if (String(id) === String(currentActiveId) && callbacks.onToggleCurrent) callbacks.onToggleCurrent(id);
      else activate(id);
    }

    function handleDoubleClick(event) { const id = idFromTarget(event.target); if (id) activate(id); }
    function handleContextMenu(event) { const id = idFromTarget(event.target); if (id) callbacks.onContextMenu?.(id, event); }

    function handleKeydown(event) {
      const id = idFromTarget(event.target);
      if (!id) return;
      const index = currentTracks.findIndex((track) => String(track.id) === String(id));
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(currentTracks.length - 1, index + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = currentTracks.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(id); return; }
      else if (event.key === 'Escape') { event.preventDefault(); callbacks.onEscape?.(); return; }
      else return;
      event.preventDefault();
      if (next !== index) select(currentTracks[next].id);
    }

    function bind() {
      container.addEventListener('click', handleClick);
      container.addEventListener('dblclick', handleDoubleClick);
      container.addEventListener('contextmenu', handleContextMenu);
      container.addEventListener('keydown', handleKeydown);
    }

    function unbind() {
      container?.removeEventListener('click', handleClick);
      container?.removeEventListener('dblclick', handleDoubleClick);
      container?.removeEventListener('contextmenu', handleContextMenu);
      container?.removeEventListener('keydown', handleKeydown);
    }

    function mount(target, tracks = [], options = {}) {
      if (!target) throw new Error('Shared Strata mechanic requires a container.');
      if (container) destroy();
      container = target;
      callbacks = options;
      currentTracks = tracks.slice();
      currentActiveId = options.activeId || null;
      currentOptions = { ...options, activeId: currentActiveId };
      selectedId = options.selectedId || currentActiveId || currentTracks[0]?.id || null;
      transitionSerial = 0;
      container.classList?.add?.('shared-strata-mounted');
      bind();
      paint();
    }

    function update(tracks = [], activeId = null, options = {}) {
      currentTracks = tracks.slice();
      currentActiveId = activeId || null;
      currentOptions = { ...currentOptions, ...options, activeId: currentActiveId };
      paint();
    }

    function destroy() {
      unbind();
      if (container) {
        container.classList?.remove?.('shared-strata-mounted');
        container.innerHTML = '';
      }
      container = null;
      currentTracks = [];
      currentActiveId = null;
      selectedId = null;
      currentOptions = {};
      callbacks = {};
      transitionSerial = 0;
    }

    return Object.freeze({
      mount, update, destroy,
      meta: { label: 'Shared Strata', contractVersion: 1 },
      __test__: { stateFor, stratumHtml, stageHtml, getState: () => ({ selectedId, activeId: currentActiveId, options: { ...currentOptions }, transitionSerial }) },
    });
  }

  return Object.freeze({ createSharedStrataMechanic });
}));
