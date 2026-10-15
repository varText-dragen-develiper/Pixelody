(function pixelodyCurrentWeaveMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCurrentWeaveMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCurrentWeaveMechanicModule() {
  'use strict';

  const MAX_VISUAL_DISTANCE = 6;

  function createCurrentWeaveMechanic(host) {
    if (!host) throw new Error('createCurrentWeaveMechanic requires a host adapter object.');

    let mountedContainer = null;
    let stageEl = null;
    let captionEl = null;
    let listeners = null;
    let currentTracks = [];
    let selectedId = null;
    let currentActiveId = null;
    let currentOptions = {};
    let transitionTimer = null;
    let wheelAccumulator = 0;
    let wheelResetTimer = null;

    function selectedIndexFor(tracks, id, activeId) {
      if (!tracks.length) return -1;
      const selectedIndex = id ? tracks.findIndex((track) => track.id === id) : -1;
      if (selectedIndex >= 0) return selectedIndex;
      const activeIndex = activeId ? tracks.findIndex((track) => track.id === activeId) : -1;
      return activeIndex >= 0 ? activeIndex : 0;
    }

    function qualityText(track) {
      if (track.sampleRate) return `${track.bitDepth || '--'}-bit / ${(track.sampleRate / 1000).toFixed(1)} kHz`;
      return track.qualityLabel || track.quality || String(track.format || track.extension || '--').toUpperCase();
    }

    function cardHtml(track, index, selectedIndex, activeId, options = {}) {
      const offset = index - selectedIndex;
      const distance = Math.min(Math.abs(offset), MAX_VISUAL_DISTANCE);
      const lane = ((index % 3) + 3) % 3;
      const selected = index === selectedIndex;
      const current = track.id === activeId;
      const live = current && options.playbackState === 'playing';
      const pending = track.id === options.activationPendingId && !current;
      const failed = track.id === options.activationFailedId;
      const visible = Math.abs(offset) <= MAX_VISUAL_DISTANCE;
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      const artStyle = artUrl ? `style="background-image:url('${host.format.escapeHtml(artUrl)}')"` : '';
      const classes = [
        'current-weave-card',
        selected ? 'is-selected' : '',
        current ? 'is-current is-playing' : '',
        live ? 'is-live' : '',
        pending ? 'is-pending' : '',
        failed || track.missing ? 'is-failed' : '',
        visible ? 'is-visible' : 'is-far',
      ].filter(Boolean).join(' ');
      const geometry = `--weave-x:${offset * 146}px;--weave-y:${offset * 92}px;--weave-lane-wide:${(lane - 1) * 108}px;--weave-lane-narrow:${(lane - 1) * 72}px;--weave-rot:${offset * -1}deg;--weave-alpha:${Math.max(.4, 1 - (distance * .1))}`;
      const stateLabel = failed || track.missing
        ? 'SOURCE ERROR / CURRENT PRESERVED'
        : pending
          ? 'REQUEST / AWAITING CONFIRMATION'
          : current
            ? (options.playbackState === 'paused' ? 'CURRENT / PAUSED' : 'CONFIRMED / LIVE')
            : selected
              ? 'CLEARING / ENTER TO REQUEST'
              : 'LOCAL CURRENT';
      return `<div class="${classes}" role="option" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-id="${encodeURIComponent(track.id)}" data-index="${index}" data-state="${pending ? 'pending' : current ? options.playbackState || 'current' : failed ? 'failed' : selected ? 'selected' : 'local'}" style="${geometry}"><span class="current-weave-index">${String(index + 1).padStart(2, '0')}</span><span class="current-weave-art${artUrl ? ' has-art' : ''}" ${artStyle} aria-hidden="true"><i></i></span><span class="current-weave-copy"><strong>${host.format.escapeHtml(track.title || 'Untitled track')}${track.missing ? ' [Missing]' : ''}</strong><span>${host.format.escapeHtml(track.artist || 'Unknown artist')}${track.album ? ` &middot; ${host.format.escapeHtml(track.album)}` : ''}</span><small>${host.format.escapeHtml(qualityText(track))} &middot; ${host.format.durationText(track.duration)}</small></span><span class="current-weave-state">${stateLabel}</span></div>`;
    }

    function fieldHtml(options = {}) {
      const pending = Boolean(options.activationPendingId);
      const confirmed = Boolean(options.activeId);
      const selectedIsActive = confirmed && options.selectedId === options.activeId;
      const classes = [
        'current-weave-field',
        pending ? 'has-pending-route' : '',
        confirmed ? 'has-confirmed-output' : '',
        selectedIsActive ? 'has-confirmed-clearing' : '',
      ].filter(Boolean).join(' ');
      const particles = Array.from({ length: 30 }, (_, index) => `<i style="--particle:${index}"></i>`).join('');
      return `<div class="${classes}" aria-hidden="true"><i class="current-weave-plane plane-back"></i><i class="current-weave-plane plane-carrier"></i><i class="current-weave-plane plane-live"></i><span class="current-weave-docking"><i class="docking-depth"></i><i class="docking-carry"></i><i class="docking-throat"></i><i class="docking-ribs"></i></span><span class="current-weave-particles">${particles}</span></div>`;
    }

    function captionHtml(selectedTrack, activeTrack, selectedIndex, total, options = {}) {
      if (!selectedTrack) return '<span class="current-weave-empty">NO LOCAL TRACKS</span>';
      const activeCopy = activeTrack
        ? `${options.playbackState === 'paused' ? 'CURRENT / PAUSED' : 'CONFIRMED PLAYING'} — ${host.format.escapeHtml(activeTrack.title || 'Untitled track')}`
        : 'NO CONFIRMED PLAYBACK';
      return `<span class="current-weave-caption-code">CLEARING ${String(selectedIndex + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span><strong>${host.format.escapeHtml(selectedTrack.title || 'Untitled track')}</strong><span>${host.format.escapeHtml(selectedTrack.artist || 'Unknown artist')}</span><small>${activeCopy}</small>`;
    }

    function semanticTransitionKind(before, after) {
      if (!before || !after) return '';
      if (before.activeId !== after.activeId) return 'confirmation';
      if (before.selectedId !== after.selectedId) return 'selection';
      if (before.pendingId !== after.pendingId) return 'request';
      if (before.playbackState !== after.playbackState) return 'playback';
      return '';
    }

    function semanticSnapshot() {
      if (!stageEl?.dataset) return null;
      return {
        selectedId: stageEl.dataset.selectedId || '',
        activeId: stageEl.dataset.activeId || '',
        pendingId: stageEl.dataset.pendingId || '',
        playbackState: stageEl.dataset.playbackState || 'idle',
      };
    }

    function motionDocument() {
      return mountedContainer?.ownerDocument || stageEl?.ownerDocument || null;
    }

    function spatialMotionAllowed() {
      const doc = motionDocument();
      const body = doc?.body;
      if (!body) return false;
      if (body.dataset?.motion === 'off' || body.dataset?.performance === 'conserve') return false;
      return !doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    }

    function cardSnapshot() {
      if (!stageEl?.querySelectorAll || !spatialMotionAllowed()) return null;
      const doc = motionDocument();
      const view = doc?.defaultView;
      const cards = new Map();
      stageEl.querySelectorAll('.current-weave-card').forEach((card) => {
        if (!card.getBoundingClientRect) return;
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        let id = card.dataset?.id || '';
        try { id = decodeURIComponent(id); } catch (_error) { /* retain encoded identity */ }
        cards.set(id, {
          rect,
          opacity: Number.parseFloat(view?.getComputedStyle?.(card).opacity || '1'),
        });
      });
      return cards;
    }

    function clearSpatialTransition() {
      if (transitionTimer !== null) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
      }
      mountedContainer?.classList?.remove('is-spatial-transitioning');
      if (mountedContainer?.dataset) delete mountedContainer.dataset.spatialTransition;
      motionDocument()?.body?.classList?.remove('current-weave-output-arrival');
    }

    function animateSpatialTransition(beforeCards, beforeState, afterState) {
      const kind = semanticTransitionKind(beforeState, afterState);
      if (!kind || !beforeCards || !spatialMotionAllowed() || !stageEl?.querySelectorAll) return;
      const duration = kind === 'confirmation' ? 680 : kind === 'selection' ? 460 : 320;
      const easing = kind === 'confirmation'
        ? 'cubic-bezier(.18,.74,.18,1)'
        : 'cubic-bezier(.22,.68,.28,1)';
      const view = motionDocument()?.defaultView;
      let animated = 0;
      stageEl.querySelectorAll('.current-weave-card').forEach((card) => {
        if (!card.getBoundingClientRect) return;
        let id = card.dataset?.id || '';
        try { id = decodeURIComponent(id); } catch (_error) { /* retain encoded identity */ }
        const before = beforeCards.get(id);
        if (!before) return;
        const after = card.getBoundingClientRect();
        if (!after.width || !after.height) return;
        const deltaX = before.rect.left - after.left;
        const deltaY = before.rect.top - after.top;
        const scaleX = before.rect.width / after.width;
        const scaleY = before.rect.height / after.height;
        const afterOpacity = Number.parseFloat(view?.getComputedStyle?.(card).opacity || '1');
        const moved = Math.abs(deltaX) > .5 || Math.abs(deltaY) > .5;
        const resized = Math.abs(scaleX - 1) > .01 || Math.abs(scaleY - 1) > .01;
        if (!moved && !resized && Math.abs(before.opacity - afterOpacity) < .01) return;
        if (card.animate) {
          card.animate([
            { translate: `${deltaX}px ${deltaY}px`, scale: `${scaleX} ${scaleY}`, opacity: before.opacity },
            { translate: '0px 0px', scale: '1 1', opacity: afterOpacity },
          ], { duration, easing, fill: 'none' });
        } else if (card.style) {
          card.style.setProperty('transition', 'none');
          card.style.setProperty('translate', `${deltaX}px ${deltaY}px`);
          card.style.setProperty('scale', `${scaleX} ${scaleY}`);
          card.style.setProperty('opacity', String(before.opacity));
          card.getBoundingClientRect();
          const begin = () => {
            card.style.setProperty('transition', `translate ${duration}ms ${easing}, scale ${duration}ms ${easing}, opacity ${duration}ms ${easing}`);
            card.style.setProperty('translate', '0px 0px');
            card.style.setProperty('scale', '1 1');
            card.style.setProperty('opacity', String(afterOpacity));
            setTimeout(() => {
              card.style.removeProperty('transition');
              card.style.removeProperty('translate');
              card.style.removeProperty('scale');
              card.style.removeProperty('opacity');
            }, duration + 30);
          };
          if (view?.requestAnimationFrame) view.requestAnimationFrame(begin);
          else setTimeout(begin, 0);
        } else {
          return;
        }
        animated += 1;
      });
      if (!animated) return;
      clearSpatialTransition();
      mountedContainer.classList.add('is-spatial-transitioning');
      if (mountedContainer.dataset) mountedContainer.dataset.spatialTransition = kind;
      if (kind === 'confirmation') motionDocument()?.body?.classList?.add('current-weave-output-arrival');
      transitionTimer = setTimeout(clearSpatialTransition, duration + 40);
    }

    function paint(tracks, activeId, options = {}) {
      const beforeState = semanticSnapshot();
      const beforeCards = cardSnapshot();
      currentTracks = Array.isArray(tracks) ? tracks.slice() : [];
      currentActiveId = activeId || null;
      currentOptions = { ...currentOptions, ...options };
      const selectedIndex = selectedIndexFor(currentTracks, selectedId, currentActiveId);
      selectedId = selectedIndex >= 0 ? currentTracks[selectedIndex].id : null;
      if (stageEl) {
        stageEl.innerHTML = fieldHtml({ ...currentOptions, activeId: currentActiveId, selectedId }) + currentTracks.map((track, index) => cardHtml(track, index, selectedIndex, currentActiveId, currentOptions)).join('');
        if (stageEl.dataset) {
          stageEl.dataset.selectedId = selectedId || '';
          stageEl.dataset.activeId = currentActiveId || '';
          stageEl.dataset.pendingId = currentOptions.activationPendingId || '';
          stageEl.dataset.playbackState = currentOptions.playbackState || 'idle';
          stageEl.dataset.selectedIsActive = selectedId && selectedId === currentActiveId ? 'true' : 'false';
        }
      }
      if (captionEl) captionEl.innerHTML = captionHtml(currentTracks[selectedIndex], currentTracks.find((track) => track.id === currentActiveId), selectedIndex, currentTracks.length, currentOptions);
      mountedContainer?.style?.setProperty?.('--current-weave-count', String(currentTracks.length));
      animateSpatialTransition(beforeCards, beforeState, semanticSnapshot());
    }

    function cardFromEvent(event) {
      return event.target.closest?.('.current-weave-card');
    }

    function focusSelected() {
      stageEl?.querySelector?.('.current-weave-card.is-selected')?.focus?.({ preventScroll: true });
    }

    function selectIndex(index, { moveFocus = false } = {}) {
      const track = currentTracks[index];
      if (!track) return;
      selectedId = track.id;
      paint(currentTracks, currentActiveId, currentOptions);
      currentOptions.onSelect?.(track.id);
      if (moveFocus) focusSelected();
    }

    function handleClick(event) {
      const card = cardFromEvent(event);
      if (!card) return;
      const id = decodeURIComponent(card.dataset.id);
      if (id === selectedId) {
        currentOptions.onActivate?.(id);
      } else {
        selectIndex(Number(card.dataset.index), { moveFocus: true });
      }
    }

    function handleFocusIn(event) {
      const card = cardFromEvent(event);
      if (!card) return;
      const index = Number(card.dataset.index);
      const id = decodeURIComponent(card.dataset.id);
      if (id !== selectedId) selectIndex(index);
    }

    function handleContextMenu(event) {
      const card = cardFromEvent(event);
      if (!card) return;
      const index = Number(card.dataset.index);
      const id = decodeURIComponent(card.dataset.id);
      if (id !== selectedId) selectIndex(index);
      currentOptions.onContextMenu?.(id, event);
    }

    function handleKeyDown(event) {
      const card = cardFromEvent(event);
      if (!card) return;
      const index = Number(card.dataset.index);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        currentOptions.onActivate?.(decodeURIComponent(card.dataset.id));
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
        currentOptions.onContextMenu?.(decodeURIComponent(card.dataset.id), event);
        return;
      }
      let nextIndex = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = Math.min(currentTracks.length - 1, index + 1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = currentTracks.length - 1;
      if (nextIndex >= 0 && nextIndex !== index) {
        event.preventDefault();
        selectIndex(nextIndex, { moveFocus: true });
      }
    }

    function normalizedWheelDelta(event) {
      const horizontal = Number(event?.deltaX) || 0;
      const vertical = Number(event?.deltaY) || 0;
      const dominant = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
      const modeScale = event?.deltaMode === 1 ? 16 : event?.deltaMode === 2 ? 120 : 1;
      return dominant * modeScale;
    }

    function clearWheelAccumulator() {
      wheelAccumulator = 0;
      if (wheelResetTimer !== null) {
        clearTimeout(wheelResetTimer);
        wheelResetTimer = null;
      }
    }

    function handleWheel(event) {
      if (event.ctrlKey || currentTracks.length < 2) return;
      const delta = normalizedWheelDelta(event);
      if (!Number.isFinite(delta) || Math.abs(delta) < .5) return;
      const currentIndex = selectedIndexFor(currentTracks, selectedId, currentActiveId);
      const direction = Math.sign(delta);
      const canMove = direction > 0
        ? currentIndex < currentTracks.length - 1
        : currentIndex > 0;
      if (!canMove) {
        clearWheelAccumulator();
        return;
      }
      event.preventDefault();
      wheelAccumulator += delta;
      if (wheelResetTimer !== null) clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(clearWheelAccumulator, 140);
      if (Math.abs(wheelAccumulator) < 28) return;
      const nextIndex = Math.max(0, Math.min(currentTracks.length - 1, currentIndex + Math.sign(wheelAccumulator)));
      clearWheelAccumulator();
      selectIndex(nextIndex);
    }

    function mount(container, tracks, options = {}) {
      mountedContainer = container;
      currentOptions = { ...options };
      selectedId = options.selectedId || options.activeId || tracks?.[0]?.id || null;
      container.classList.add('current-weave-mounted');
      container.innerHTML = '';
      stageEl = document.createElement('div');
      stageEl.className = 'current-weave-stage';
      captionEl = document.createElement('div');
      captionEl.className = 'current-weave-caption';
      container.appendChild(stageEl);
      container.appendChild(captionEl);
      const onClick = (event) => handleClick(event);
      const onFocusIn = (event) => handleFocusIn(event);
      const onContextMenu = (event) => handleContextMenu(event);
      const onKeyDown = (event) => handleKeyDown(event);
      const onWheel = (event) => handleWheel(event);
      stageEl.addEventListener('click', onClick);
      stageEl.addEventListener('focusin', onFocusIn);
      stageEl.addEventListener('contextmenu', onContextMenu);
      stageEl.addEventListener('keydown', onKeyDown);
      stageEl.addEventListener('wheel', onWheel, { passive: false });
      listeners = { onClick, onFocusIn, onContextMenu, onKeyDown, onWheel };
      paint(tracks || [], options.activeId || null, options);
    }

    function update(tracks, activeId, options = {}) {
      if (!mountedContainer) return;
      paint(tracks, activeId, options);
    }

    function destroy() {
      clearSpatialTransition();
      clearWheelAccumulator();
      if (stageEl && listeners) {
        stageEl.removeEventListener('click', listeners.onClick);
        stageEl.removeEventListener('focusin', listeners.onFocusIn);
        stageEl.removeEventListener('contextmenu', listeners.onContextMenu);
        stageEl.removeEventListener('keydown', listeners.onKeyDown);
        stageEl.removeEventListener('wheel', listeners.onWheel);
      }
      if (mountedContainer) {
        mountedContainer.classList.remove('current-weave-mounted');
        mountedContainer.innerHTML = '';
        mountedContainer.style?.removeProperty?.('--current-weave-count');
      }
      mountedContainer = null;
      stageEl = null;
      captionEl = null;
      listeners = null;
      currentTracks = [];
      selectedId = null;
      currentActiveId = null;
      currentOptions = {};
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Current Weave' },
      __test__: { selectedIndexFor, cardHtml, captionHtml, fieldHtml, semanticTransitionKind, normalizedWheelDelta },
    });
  }

  return Object.freeze({ createCurrentWeaveMechanic });
}));
