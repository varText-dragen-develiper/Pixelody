(function pixelodyObliqueBindingMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyObliqueBindingMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createObliqueBindingMechanicApi() {
  'use strict';

  const PROJECTION_WINDOW = 7;
  const ANCHORS = Object.freeze([
    Object.freeze({ x: 3, y: 5, width: 43 }),
    Object.freeze({ x: 30, y: 18, width: 47 }),
    Object.freeze({ x: 8, y: 32, width: 51 }),
    Object.freeze({ x: 42, y: 46, width: 46 }),
    Object.freeze({ x: 16, y: 60, width: 53 }),
    Object.freeze({ x: 52, y: 74, width: 41 }),
    Object.freeze({ x: 30, y: 88, width: 44 }),
  ]);

  function createObliqueBindingMechanic(host = {}) {
    let container = null;
    let tracks = [];
    let authoritativeTracks = [];
    let activeId = null;
    let selectedId = null;
    let options = {};
    let callbacks = {};

    const escapeHtml = host.format?.escapeHtml || ((value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])));
    const durationText = host.format?.durationText || ((value) => {
      const seconds = Math.max(0, Math.round(Number(value) || 0));
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    });

    function sourceTracks() { return authoritativeTracks.length ? authoritativeTracks : tracks; }
    function findTrack(id, source = sourceTracks()) { return source.find((track) => track.id === id) || null; }
    function geometryMode() { return options.geometryMode === 'flow' ? 'flow' : 'projection'; }
    function projectionWindowSize() { return Math.max(3, Math.min(12, Math.round(Number(options.projectionWindow) || PROJECTION_WINDOW))); }

    function stateFor(track) {
      if (track.id === activeId) return options.playbackState === 'paused' ? 'CURRENT / PAUSED' : options.playbackState === 'buffering' ? 'CURRENT / BUFFERING' : 'CURRENT / PLAYING';
      if (track.id === options.activationPendingId) return 'REQUESTED / AWAITING CONFIRMATION';
      if (track.id === options.activationFailedId) return track.missing ? 'FAILED / LOCATE FILE' : 'REQUEST FAILED / CURRENT RETAINED';
      if (track.id === selectedId) return 'SELECTED / NOT PLAYING';
      return track.missing ? 'MISSING / LOCATE FILE' : 'READY';
    }

    function projectedTracks() {
      const windowSize = projectionWindowSize();
      if (geometryMode() === 'flow' || tracks.length <= windowSize) return tracks.map((track, index) => ({ track, index }));
      const selectedIndex = Math.max(0, tracks.findIndex((track) => track.id === selectedId));
      const half = Math.floor(windowSize / 2);
      const start = Math.max(0, Math.min(tracks.length - windowSize, selectedIndex - half));
      return tracks.slice(start, start + windowSize).map((track, slot) => ({ track, index: start + slot }));
    }

    function territoryHtml(entry, slot) {
      const { track, index } = entry;
      const selected = track.id === selectedId;
      const current = track.id === activeId;
      const pending = track.id === options.activationPendingId;
      const failed = track.id === options.activationFailedId;
      const side = index % 2 === 0 ? 'a' : 'b';
      const anchor = ANCHORS[slot % ANCHORS.length];
      const quality = [track.format ? String(track.format).toUpperCase() : 'LOCAL', track.bitDepth ? `${track.bitDepth}-bit` : '', track.sampleRate ? `${Math.round(track.sampleRate / 1000)} kHz` : ''].filter(Boolean).join(' · ');
      const classes = ['oblique-territory', `side-${side}`, selected ? 'is-selected' : '', current ? 'is-current' : '', pending ? 'is-pending' : '', failed ? 'is-failed' : '', track.missing ? 'is-missing' : ''].filter(Boolean).join(' ');
      return `<button class="${classes}" role="option" aria-selected="${selected}" aria-label="${escapeHtml(`${track.title || 'Untitled track'}, ${track.artist || 'Unknown artist'}, ${stateFor(track)}`)}" aria-posinset="${index + 1}" aria-setsize="${tracks.length}" tabindex="${selected ? '0' : '-1'}" data-id="${encodeURIComponent(track.id)}" data-side="${side}" style="--ob-slot:${slot};--ob-x:${anchor.x}%;--ob-y:${anchor.y}%;--ob-width:${anchor.width}%"><span class="oblique-ordinal">${String(index + 1).padStart(3, '0')}</span><span class="oblique-copy"><strong>${escapeHtml(track.title || 'Untitled track')}</strong><small>${escapeHtml(track.artist || 'Unknown artist')}${track.album ? ` · ${escapeHtml(track.album)}` : ''}</small></span><span class="oblique-meta">${escapeHtml(quality)} · ${escapeHtml(durationText(track.duration))}</span><span class="oblique-state">${escapeHtml(stateFor(track))}</span></button>`;
    }

    function confirmedReceiptHtml() {
      const track = findTrack(activeId);
      if (!track) return '<aside class="oblique-confirmed-receipt is-idle" aria-label="Confirmed playback"><small>CONFIRMED ENDPOINT</small><strong>NOTHING PLAYING</strong><span>Playback remains host-owned.</span></aside>';
      const state = options.playbackState === 'paused' ? 'CURRENT / PAUSED' : options.playbackState === 'buffering' ? 'CURRENT / BUFFERING' : 'CURRENT / PLAYING';
      return `<aside class="oblique-confirmed-receipt" aria-label="Confirmed playback"><small>CONFIRMED ENDPOINT</small><strong>${escapeHtml(track.title || 'Untitled track')}</strong><span>${escapeHtml(track.artist || 'Unknown artist')} · ${escapeHtml(state)}</span></aside>`;
    }

    function liveText() {
      const failed = findTrack(options.activationFailedId);
      if (failed) return `Playback request failed for ${failed.title || 'Untitled track'}. Current playback retained.`;
      const pending = findTrack(options.activationPendingId);
      if (pending) return `Playback requested for ${pending.title || 'Untitled track'}. Awaiting host confirmation.`;
      const selected = findTrack(selectedId, tracks);
      return selected ? `Selected ${selected.title || 'Untitled track'}. Not playing unless confirmed.` : '';
    }

    function stageHtml() {
      const projected = projectedTracks();
      const range = projected.length ? `${projected[0].index + 1}–${projected.at(-1).index + 1}` : '0–0';
      return `<section class="oblique-binding" data-geometry-mode="${geometryMode()}" data-playback-state="${escapeHtml(options.playbackState || 'idle')}"><div class="oblique-binding-label">ORDERED BINDING <span>${range} / ${tracks.length}</span></div><svg class="oblique-binding-map" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true"><path class="oblique-binding-edge" d="M74 90 C195 117 250 193 354 231 S517 304 592 373 S727 461 797 534 S864 622 936 665"/><path class="oblique-binding-void" d="M74 90 C195 117 250 193 354 231 S517 304 592 373 S727 461 797 534 S864 622 936 665"/></svg><div class="oblique-binding-list" role="listbox" aria-label="Ordered tracks along the Rupture Folio binding">${projected.map(territoryHtml).join('')}</div>${confirmedReceiptHtml()}<output class="oblique-binding-live" aria-live="polite">${escapeHtml(liveText())}</output></section>`;
    }

    function emptyHtml() {
      return `<section class="oblique-binding-empty"><small>ORDERED BINDING / EMPTY</small><strong>Import music to begin.</strong><span>${escapeHtml(liveText())}</span>${confirmedReceiptHtml()}</section>`;
    }

    function paint() {
      if (!container) return;
      if (!findTrack(selectedId, tracks)) selectedId = findTrack(activeId, tracks)?.id || tracks[0]?.id || null;
      container.innerHTML = tracks.length ? stageHtml() : emptyHtml();
    }

    function focusSelected() { container?.querySelector(`[data-id="${encodeURIComponent(selectedId || '')}"]`)?.focus(); }
    function select(id, shouldFocus = true) {
      if (!findTrack(id, tracks)) return;
      selectedId = id;
      callbacks.onSelect?.(id);
      paint();
      if (shouldFocus) focusSelected();
    }
    function request(id) { if (findTrack(id, tracks)) callbacks.onActivate?.(id); }
    function idFromTarget(target) {
      const territory = target?.closest?.('.oblique-territory');
      return territory ? decodeURIComponent(territory.dataset.id) : null;
    }
    function onClick(event) {
      const id = idFromTarget(event.target);
      if (!id) return;
      if (selectedId !== id) select(id);
      else if (id === activeId && callbacks.onToggleCurrent) callbacks.onToggleCurrent(id);
      else request(id);
    }
    function onDoubleClick(event) { const id = idFromTarget(event.target); if (id) request(id); }
    function onContextMenu(event) { const id = idFromTarget(event.target); if (id) callbacks.onContextMenu?.(id, event); }
    function onKeyDown(event) {
      const id = idFromTarget(event.target);
      if (!id) return;
      const index = tracks.findIndex((track) => track.id === id);
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tracks.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tracks.length) % tracks.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tracks.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); request(id); return; }
      else if (event.key === 'Escape') { event.preventDefault(); callbacks.onEscape?.(); return; }
      else return;
      event.preventDefault();
      select(tracks[next].id);
    }
    function bind() {
      container.addEventListener('click', onClick);
      container.addEventListener('dblclick', onDoubleClick);
      container.addEventListener('contextmenu', onContextMenu);
      container.addEventListener('keydown', onKeyDown);
      container.classList?.add('oblique-binding-mounted');
    }
    function unbind() {
      container?.removeEventListener('click', onClick);
      container?.removeEventListener('dblclick', onDoubleClick);
      container?.removeEventListener('contextmenu', onContextMenu);
      container?.removeEventListener('keydown', onKeyDown);
      container?.classList?.remove('oblique-binding-mounted');
    }

    function mount(target, nextTracks = [], nextOptions = {}) {
      if (!target) throw new Error('Oblique Binding mechanic requires a container.');
      if (container) destroy();
      container = target;
      tracks = nextTracks.slice();
      authoritativeTracks = (nextOptions.authoritativeTracks || nextTracks).slice();
      activeId = nextOptions.activeId || null;
      selectedId = nextOptions.selectedId || findTrack(activeId, tracks)?.id || tracks[0]?.id || null;
      options = { ...nextOptions, activeId };
      callbacks = nextOptions;
      bind();
      paint();
    }

    function update(nextTracks = [], nextActiveId = null, nextOptions = {}) {
      tracks = nextTracks.slice();
      authoritativeTracks = (nextOptions.authoritativeTracks || options.authoritativeTracks || nextTracks).slice();
      activeId = nextActiveId || null;
      if (Object.prototype.hasOwnProperty.call(nextOptions, 'selectedId')) selectedId = nextOptions.selectedId;
      options = { ...options, ...nextOptions, activeId };
      paint();
    }

    function destroy() {
      unbind();
      if (container) container.innerHTML = '';
      container = null;
      tracks = [];
      authoritativeTracks = [];
      activeId = null;
      selectedId = null;
      options = {};
      callbacks = {};
    }

    return {
      mount,
      update,
      destroy,
      meta: Object.freeze({ label: 'Oblique Binding', contractVersion: 1, fallbackKey: 'linear-list' }),
      __test__: Object.freeze({ stateFor, projectedTracks, getState: () => ({ selectedId, activeId, geometryMode: geometryMode(), options: { ...options } }) }),
    };
  }

  return Object.freeze({ PROJECTION_WINDOW, ANCHORS, createObliqueBindingMechanic });
}));
