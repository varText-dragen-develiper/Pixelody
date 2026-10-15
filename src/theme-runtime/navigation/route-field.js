(function pixelodyRouteFieldMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyRouteFieldMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRouteFieldMechanicModule() {
  'use strict';

  function createRouteFieldMechanic(host) {
    if (!host?.format) throw new Error('createRouteFieldMechanic requires a format host.');
    const escapeHtml = host.format.escapeHtml;
    const durationText = host.format.durationText;
    const fileUrl = host.format.fileUrl;
    let mountedContainer = null;
    let root = null;
    let route = null;
    let focusReceipt = null;
    let playbackReceipt = null;
    let live = null;
    let currentTracks = [];
    let selectedId = null;
    let activeId = null;
    let currentOptions = {};
    let listeners = null;

    function trackFor(id) {
      return currentTracks.find((track) => track.id === id) || null;
    }

    function outputTrack() {
      return (currentOptions.authoritativeTracks || currentTracks).find((track) => track.id === activeId) || null;
    }

    function qualityText(track) {
      if (track.sampleRate) return `${track.bitDepth || '--'}-bit / ${(track.sampleRate / 1000).toFixed(1)} kHz`;
      return String(track.format || 'LOCAL').toUpperCase();
    }

    function artStyle(track) {
      if (!track?.artworkPath) return '';
      return ` style="background-image:url('${escapeHtml(fileUrl(track.artworkPath))}')"`;
    }

    function stopHtml(track, index) {
      const selected = track.id === selectedId;
      const playing = track.id === activeId;
      const paused = playing && currentOptions.playbackState === 'paused';
      const pending = track.id === currentOptions.activationPendingId && !playing;
      const failed = track.id === currentOptions.activationFailedId && !playing;
      const state = track.missing
        ? 'MISSING / UNAVAILABLE'
        : failed
          ? 'REQUEST FAILED / CURRENT RETAINED'
          : pending
            ? 'REQUESTED / AWAITING CONFIRMATION'
            : playing
              ? (paused ? 'PAUSED CURRENT' : 'CONFIRMED PLAYING')
              : selected
                ? 'FOCUSED / NOT PLAYING'
                : 'AVAILABLE';
      return `<button class="route-field-stop${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}${paused ? ' is-paused' : ''}${pending ? ' is-pending' : ''}${failed ? ' is-failed' : ''}${track.missing ? ' is-missing' : ''}" type="button" role="option" aria-selected="${selected}"${playing ? ' aria-current="true"' : ''} tabindex="${selected ? '0' : '-1'}" data-id="${encodeURIComponent(track.id)}" data-index="${index}" data-route-state="${escapeHtml(track.missing ? 'missing' : failed ? 'error' : pending ? 'pending' : paused ? 'paused' : playing ? 'playing' : selected ? 'focused' : 'available')}"><span class="route-field-joint" aria-hidden="true"></span><span class="route-field-stop-art" data-bf-asset-slot="track-stop-mark"${artStyle(track)} aria-hidden="true"></span><span class="route-field-stop-copy"><small>${String(index + 1).padStart(2, '0')} · ${escapeHtml(state)}</small><strong>${escapeHtml(track.title || 'Untitled track')}</strong><span>${escapeHtml(track.artist || 'Unknown artist')}${track.album ? ` · ${escapeHtml(track.album)}` : ''}</span></span><span class="route-field-stop-meta">${escapeHtml(qualityText(track))}<b>${escapeHtml(durationText(track.duration))}</b></span></button>`;
    }

    function focusHtml() {
      const track = trackFor(selectedId);
      if (!track) return '<div class="route-field-focus-empty"><small>FOCUS RECEIPT</small><strong>No local tracks</strong><span>Import music remains available through the Library bay.</span></div>';
      const index = currentTracks.indexOf(track);
      return `<div class="route-field-focus-art" data-bf-asset-slot="focused-track-art"${artStyle(track)} aria-hidden="true"></div><div class="route-field-focus-copy"><small>FOCUS ${String(index + 1).padStart(2, '0')} / ${String(currentTracks.length).padStart(2, '0')}</small><strong>${escapeHtml(track.title || 'Untitled track')}</strong><span>${escapeHtml(track.artist || 'Unknown artist')}</span><i>${escapeHtml(qualityText(track))} · ${escapeHtml(durationText(track.duration))}</i><button type="button" class="route-field-activate" data-id="${encodeURIComponent(track.id)}">Play focused track</button></div>`;
    }

    function playbackHtml() {
      const track = outputTrack();
      if (!track) return '<small>CONFIRMED OUTPUT</small><strong>Nothing playing</strong><span>Focus may move without changing playback.</span>';
      const phase = currentOptions.playbackState === 'paused' ? 'PAUSED CURRENT' : 'CONFIRMED PLAYING';
      const returnControl = trackFor(activeId) && selectedId && selectedId !== activeId
        ? `<button type="button" class="route-field-return-current" data-id="${encodeURIComponent(track.id)}">Return focus to current</button>`
        : '';
      return `<small>${escapeHtml(phase)}</small><strong>${escapeHtml(track.title || 'Untitled track')}</strong><span>${escapeHtml(track.artist || 'Unknown artist')} · ${escapeHtml(durationText(track.duration))}</span>${returnControl}`;
    }

    function syncStopElement(stop, track, index) {
      const selected = track.id === selectedId;
      const playing = track.id === activeId;
      const paused = playing && currentOptions.playbackState === 'paused';
      const pending = track.id === currentOptions.activationPendingId && !playing;
      const failed = track.id === currentOptions.activationFailedId && !playing;
      const state = track.missing
        ? 'MISSING / UNAVAILABLE'
        : failed
          ? 'REQUEST FAILED / CURRENT RETAINED'
          : pending
            ? 'REQUESTED / AWAITING CONFIRMATION'
            : playing
              ? (paused ? 'PAUSED CURRENT' : 'CONFIRMED PLAYING')
              : selected
                ? 'FOCUSED / NOT PLAYING'
                : 'AVAILABLE';
      stop.classList.toggle('is-selected', selected);
      stop.classList.toggle('is-playing', playing);
      stop.classList.toggle('is-paused', paused);
      stop.classList.toggle('is-pending', pending);
      stop.classList.toggle('is-failed', failed);
      stop.classList.toggle('is-missing', Boolean(track.missing));
      stop.setAttribute('aria-selected', String(selected));
      if (playing) stop.setAttribute('aria-current', 'true');
      else stop.removeAttribute('aria-current');
      stop.tabIndex = selected ? 0 : -1;
      const routeState = track.missing ? 'missing' : failed ? 'error' : pending ? 'pending' : paused ? 'paused' : playing ? 'playing' : selected ? 'focused' : 'available';
      if (stop.dataset.routeState !== routeState) stop.dataset.routeState = routeState;
      const copySmall = stop.querySelector('.route-field-stop-copy small');
      const expectedSmall = `${String(index + 1).padStart(2, '0')} · ${state}`;
      if (copySmall && copySmall.textContent !== expectedSmall) copySmall.textContent = expectedSmall;
      // Reconcile content as well as state without replacing the focused button.
      const title = stop.querySelector('.route-field-stop-copy strong');
      const byline = stop.querySelector('.route-field-stop-copy > span');
      const meta = stop.querySelector('.route-field-stop-meta');
      const art = stop.querySelector('.route-field-stop-art');
      if (title) title.textContent = track.title || 'Untitled track';
      if (byline) byline.textContent = `${track.artist || 'Unknown artist'}${track.album ? ` · ${track.album}` : ''}`;
      const nextMeta = `${escapeHtml(qualityText(track))}<b>${escapeHtml(durationText(track.duration))}</b>`;
      if (meta && meta.innerHTML !== nextMeta) meta.innerHTML = nextMeta;
      if (art) art.style.backgroundImage = track.artworkPath ? `url(${JSON.stringify(fileUrl(track.artworkPath))})` : '';
    }

    function paint({ preserveFocus = true } = {}) {
      if (!root) return;
      if (!trackFor(selectedId)) selectedId = trackFor(activeId)?.id || currentTracks[0]?.id || null;
      const existingStops = route.querySelectorAll('.route-field-stop');
      const canReconcile = existingStops.length === currentTracks.length && currentTracks.length > 0 &&
        Array.from(existingStops).every((stop, i) => decodeURIComponent(stop.dataset.id) === currentTracks[i].id);

      if (canReconcile) {
        existingStops.forEach((stop, i) => syncStopElement(stop, currentTracks[i], i));
      } else {
        const nextHtml = currentTracks.length ? currentTracks.map(stopHtml).join('') : '<div class="route-field-empty"><strong>Your route is empty.</strong><span>Use the Library bay to import or choose a collection.</span></div>';
        if (route.innerHTML !== nextHtml) route.innerHTML = nextHtml;
      }
      const nextFocus = focusHtml();
      if (focusReceipt.innerHTML !== nextFocus) focusReceipt.innerHTML = nextFocus;
      const nextPlayback = playbackHtml();
      if (playbackReceipt.innerHTML !== nextPlayback) playbackReceipt.innerHTML = nextPlayback;
      root.dataset.routeCount = String(currentTracks.length);
      root.dataset.hasPlayback = String(Boolean(outputTrack()));
      root.dataset.pendingId = currentOptions.activationPendingId || '';
      root.dataset.failedId = currentOptions.activationFailedId || '';
      if (preserveFocus && selectedId) route.querySelector(`[data-id="${CSS.escape(encodeURIComponent(selectedId))}"]`)?.focus?.({ preventScroll: true });
    }

    function announce(message) {
      if (live) live.textContent = String(message || '');
    }

    function select(id, { focus = false, announceSelection = true } = {}) {
      const track = trackFor(id);
      if (!track) return false;
      selectedId = id;
      route.querySelectorAll('.route-field-stop').forEach((stop, index) => {
        const selected = decodeURIComponent(stop.dataset.id) === id;
        syncStopElement(stop, currentTracks[index], index);
        if (selected && focus) {
          stop.focus({ preventScroll: true });
          stop.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        }
      });
      focusReceipt.innerHTML = focusHtml();
      playbackReceipt.innerHTML = playbackHtml();
      currentOptions.onSelect?.(id);
      if (announceSelection) announce(`${track.title || 'Untitled track'} focused. Playback unchanged.`);
      return true;
    }

    function activate(id) {
      const track = trackFor(id);
      if (!track) return;
      currentOptions.onActivate?.(id);
      announce(`Playback requested for ${track.title || 'Untitled track'}. Awaiting confirmation.`);
    }

    function moveSelection(delta, absolute = null) {
      if (!currentTracks.length) return;
      const currentIndex = Math.max(0, currentTracks.findIndex((track) => track.id === selectedId));
      const nextIndex = absolute === 'first' ? 0 : absolute === 'last' ? currentTracks.length - 1 : Math.max(0, Math.min(currentTracks.length - 1, currentIndex + delta));
      select(currentTracks[nextIndex].id, { focus: true });
    }

    function handleClick(event) {
      const returnCurrent = event.target.closest?.('.route-field-return-current');
      if (returnCurrent) {
        select(decodeURIComponent(returnCurrent.dataset.id), { focus: true });
        announce('Focus returned to the confirmed current track. Playback unchanged.');
        return;
      }
      const activation = event.target.closest?.('.route-field-activate');
      if (activation) {
        activate(decodeURIComponent(activation.dataset.id));
        return;
      }
      const stop = event.target.closest?.('.route-field-stop');
      if (stop) {
        const id = decodeURIComponent(stop.dataset.id);
        select(id, { focus: false });
        activate(id);
      }
    }

    function handleDoubleClick(event) {
      const stop = event.target.closest?.('.route-field-stop');
      if (stop) activate(decodeURIComponent(stop.dataset.id));
    }

    function handleContextMenu(event) {
      const stop = event.target.closest?.('.route-field-stop');
      if (!stop) return;
      const id = decodeURIComponent(stop.dataset.id);
      select(id, { announceSelection: false });
      currentOptions.onContextMenu?.(id, event);
    }

    function handleFocusIn(event) {
      const stop = event.target.closest?.('.route-field-stop');
      if (stop) select(decodeURIComponent(stop.dataset.id), { announceSelection: false });
    }

    function handleKeyDown(event) {
      const stop = event.target.closest?.('.route-field-stop');
      if (!stop) return;
      const id = decodeURIComponent(stop.dataset.id);
      if (event.key === 'Enter') {
        event.preventDefault();
        activate(id);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        currentOptions.onEscape?.();
        return;
      }
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        currentOptions.onContextMenu?.(id, event);
        return;
      }
      const forward = ['ArrowDown', 'ArrowRight'].includes(event.key);
      const backward = ['ArrowUp', 'ArrowLeft'].includes(event.key);
      if (forward || backward || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        moveSelection(forward ? 1 : backward ? -1 : 0, event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : null);
      }
    }

    function mount(container, tracks, options = {}) {
      mountedContainer = container;
      currentTracks = Array.isArray(tracks) ? tracks.slice() : [];
      activeId = options.activeId || null;
      selectedId = activeId || currentTracks[0]?.id || null;
      currentOptions = { ...options };
      container.classList.add('route-field-mounted');
      container.innerHTML = '<section class="route-field-shell" aria-label="Track route"><header class="route-field-heading"><span>TRACK ROUTE</span><small>Move focus freely · Enter confirms playback</small></header><section class="route-field-focus" data-bf-asset-slot="focus-receipt"></section><div class="route-field-list" role="listbox" aria-label="Tracks"></div><aside class="route-field-playback" data-bf-asset-slot="confirmed-playback-receipt" aria-label="Confirmed playback"></aside><output class="route-field-live" aria-live="polite"></output></section>';
      root = container.querySelector('.route-field-shell');
      route = container.querySelector('.route-field-list');
      focusReceipt = container.querySelector('.route-field-focus');
      playbackReceipt = container.querySelector('.route-field-playback');
      live = container.querySelector('.route-field-live');
      listeners = { handleClick, handleDoubleClick, handleContextMenu, handleFocusIn, handleKeyDown };
      container.addEventListener('click', handleClick);
      container.addEventListener('dblclick', handleDoubleClick);
      container.addEventListener('contextmenu', handleContextMenu);
      container.addEventListener('focusin', handleFocusIn);
      container.addEventListener('keydown', handleKeyDown);
      paint({ preserveFocus: false });
    }

    function update(tracks, nextActiveId, options = {}) {
      currentTracks = Array.isArray(tracks) ? tracks.slice() : [];
      activeId = nextActiveId || null;
      currentOptions = { ...currentOptions, ...options };
      paint({ preserveFocus: false });
    }

    function destroy() {
      if (mountedContainer && listeners) {
        mountedContainer.removeEventListener('click', listeners.handleClick);
        mountedContainer.removeEventListener('dblclick', listeners.handleDoubleClick);
        mountedContainer.removeEventListener('contextmenu', listeners.handleContextMenu);
        mountedContainer.removeEventListener('focusin', listeners.handleFocusIn);
        mountedContainer.removeEventListener('keydown', listeners.handleKeyDown);
        mountedContainer.classList.remove('route-field-mounted');
        mountedContainer.innerHTML = '';
      }
      mountedContainer = null;
      root = null;
      route = null;
      focusReceipt = null;
      playbackReceipt = null;
      live = null;
      currentTracks = [];
      selectedId = null;
      activeId = null;
      currentOptions = {};
      listeners = null;
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Route Field' },
      __test__: { qualityText },
    });
  }

  return Object.freeze({ createRouteFieldMechanic });
}));
