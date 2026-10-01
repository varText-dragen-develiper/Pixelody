(function pixelodyChorusFoldMechanicFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyChorusFoldMechanic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createChorusFoldMechanicModule() {
  'use strict';

  const MAX_DISTANCE = 6;
  // Long collections are rendered as readable score movements rather than
  // continually squeezing more labelled voices into the first collective.
  // Ten voices make two courses of five bands; subsequent movements preserve
  // DOM order and enter after a deliberate recovery gap.
  const VOICES_PER_MOVEMENT = 10;
  const MOVEMENT_FIELD_STEP = 820;
  const MOVEMENT_STACK_STEP = 740;
  // The cursor remains hidden only while the pointer is close enough to the
  // last hovered voice for the perimeter hue to remain an honest substitute.
  // This is a small buffer, never a capture or modal pointer mode.
  const HOVER_LOCK_EXIT_BUFFER = 34;

  function normalizedPlaybackState(value, activeId) {
    if (!activeId) return 'idle';
    return value === 'playing' ? 'playing' : 'paused';
  }

  function safeIndex(tracks, id, fallback = 0) {
    if (!tracks.length) return -1;
    const index = id ? tracks.findIndex((track) => track.id === id) : -1;
    return index >= 0 ? index : Math.max(0, Math.min(tracks.length - 1, fallback));
  }

  function geometryFor(index, activeIndex, total) {
    const group = Math.floor(index / VOICES_PER_MOVEMENT);
    const local = index % VOICES_PER_MOVEMENT;
    const curve = local % 2;
    const band = Math.floor(local / 2);
    const bands = Math.max(1, Math.ceil(Math.min(total - group * VOICES_PER_MOVEMENT, VOICES_PER_MOVEMENT) / 2));
    const progress = bands <= 1 ? 0.5 : band / (bands - 1);
    // Two opposing courses enter one throat and overlap into a collective
    // silhouette. Geometry remains presentation-only: semantic order and
    // playback truth are still owned by the mechanic below.
    const ease = Math.sin(progress * Math.PI * 0.5);
    // The two courses have a hard spatial ending: they do not continue through
    // the throat as decorative rails.  Bands zero and one remain an open field,
    // band two is the shared throat, and the final pair belongs to one body.
    const x = curve ? 72 - ease * 22 : 3 + ease * 45;
    const throatLift = band === 2 ? 14 : 0;
    let y = 154 + band * 132 + curve * Math.max(0, 24 - band * 8) - throatLift;
    y += group * MOVEMENT_FIELD_STEP;
    const offset = activeIndex >= 0 ? index - activeIndex : index;
    const stackX = curve ? 57 - ease * 9 : 4 + ease * 39;
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      angle: Number(((curve ? 7 : -7) + progress * (curve ? -13 : 13)).toFixed(2)),
      curve,
      band,
      group,
      stage: band < 2 ? 'course' : band === 2 ? 'throat' : 'collective',
      offset,
      side: offset < 0 ? -1 : offset > 0 ? 1 : 0,
      distance: Math.min(MAX_DISTANCE, Math.abs(offset)),
      stackY: 94 + group * MOVEMENT_STACK_STEP + band * 138 + curve * Math.round(Math.max(0, 18 - progress * 13)),
      stackX: Number(stackX.toFixed(2)),
    };
  }

  function projectionFor(tracks, activeId) {
    const activeIndex = safeIndex(tracks, activeId, 0);
    return {
      activeIndex,
      previous: activeIndex > 0 ? tracks[activeIndex - 1] : null,
      current: activeIndex >= 0 ? tracks[activeIndex] : null,
      next: activeIndex >= 0 && activeIndex < tracks.length - 1 ? tracks[activeIndex + 1] : null,
      total: tracks.length,
    };
  }

  function deterministicSeed(value) {
    let seed = 2166136261;
    for (const char of String(value || '')) {
      seed ^= char.codePointAt(0);
      seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
  }

  function createChorusFoldMechanic(host) {
    if (!host?.format) throw new Error('createChorusFoldMechanic requires a host format adapter.');

    let mountedContainer = null;
    let scoreEl = null;
    let coursesEl = null;
    let pressureFieldEl = null;
    let collectiveEl = null;
    let apertureEl = null;
    let statusEl = null;
    let listeners = null;
    let globalListeners = null;
    let options = {};
    let currentTracks = [];
    let currentActiveId = null;
    let selectedId = null;
    let requestedId = null;
    let failedId = null;
    let playbackState = 'idle';
    let hoverLockedVoice = null;
    let hoverPerimeterEl = null;

    function decodeId(element) {
      try { return decodeURIComponent(element?.dataset?.id || ''); } catch { return ''; }
    }

    function voiceFromEvent(event) { return event.target?.closest?.('.chorus-fold-voice') || null; }

    function voiceAtPointer(event) {
      const directVoice = voiceFromEvent(event);
      if (directVoice) return directVoice;
      if (!scoreEl || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null;
      // A clipped card can have transparent corners that do not become the
      // event target. Resolve the visible score geometry as a fallback so the
      // cue is available over every voice, not only its opaque sub-elements.
      return Array.from(scoreEl.querySelectorAll('.chorus-fold-voice'))
        .filter((voice) => {
          const bounds = voice.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0
            && event.clientX >= bounds.left && event.clientX <= bounds.right
            && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        })
        .sort((a, b) => (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0] || null;
    }

    function isMousePointer(event) { return event?.pointerType === 'mouse'; }

    function cssNumber(value, fallback = 0) {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function polygonPoints(clipPath, width, height) {
      const value = String(clipPath || '').trim();
      if (!value.startsWith('polygon(') || !value.endsWith(')')) return null;
      const source = value.slice('polygon('.length, -1).replace(/^evenodd\s*,\s*/i, '');
      const points = source.split(',').map((entry) => {
        const [rawX, rawY] = entry.trim().split(/\s+/);
        if (!rawX || !rawY) return null;
        const x = rawX.endsWith('%') ? cssNumber(rawX) * width / 100 : cssNumber(rawX, NaN);
        const y = rawY.endsWith('%') ? cssNumber(rawY) * height / 100 : cssNumber(rawY, NaN);
        return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
      });
      return points.length >= 3 && points.every(Boolean) ? points : null;
    }

    function fallbackPolygon(voice, width, height) {
      const material = String(voice?.dataset?.material || '0');
      const shapes = {
        '0': [[0, 13], [72, 0], [100, 27], [93, 82], [77, 100], [19, 92], [5, 72]],
        '1': [[3, 0], [80, 8], [100, 39], [88, 100], [23, 91], [0, 65]],
        '2': [[0, 24], [18, 4], [84, 0], [100, 58], [81, 92], [27, 100], [6, 76]],
        '3': [[5, 11], [66, 0], [96, 18], [100, 70], [72, 100], [14, 88], [0, 54]],
      };
      return (shapes[material] || shapes['0']).map(([x, y]) => [x * width / 100, y * height / 100]);
    }

    function perimeterPointsFor(voice, width, height) {
      const voiceStyle = getComputedStyle(voice);
      const direct = polygonPoints(voiceStyle.clipPath, width, height);
      if (direct) return direct;
      const beforeStyle = getComputedStyle(voice, '::before');
      const beforeLeft = cssNumber(beforeStyle.left);
      const beforeTop = cssNumber(beforeStyle.top);
      const beforeWidth = cssNumber(beforeStyle.width, Math.max(1, width - beforeLeft - cssNumber(beforeStyle.right)));
      const beforeHeight = cssNumber(beforeStyle.height, Math.max(1, height - beforeTop - cssNumber(beforeStyle.bottom)));
      const before = polygonPoints(beforeStyle.clipPath, beforeWidth, beforeHeight);
      if (before) return before.map(([x, y]) => [x + beforeLeft, y + beforeTop]);
      return fallbackPolygon(voice, width, height);
    }

    function ensureHoverPerimeter() {
      if (hoverPerimeterEl?.isConnected || !scoreEl) return hoverPerimeterEl;
      hoverPerimeterEl = document.createElement('div');
      hoverPerimeterEl.className = 'chorus-fold-hover-perimeter';
      hoverPerimeterEl.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('focusable', 'false');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      svg.appendChild(polygon);
      hoverPerimeterEl.appendChild(svg);
      scoreEl.appendChild(hoverPerimeterEl);
      return hoverPerimeterEl;
    }

    function positionHoverPerimeter(voice) {
      const perimeter = ensureHoverPerimeter();
      if (!perimeter || !voice?.isConnected) return;
      const width = Math.max(1, voice.offsetWidth);
      const height = Math.max(1, voice.offsetHeight);
      const voiceStyle = getComputedStyle(voice);
      const usesScoreCoordinates = voice.offsetParent === scoreEl;
      const scoreBounds = scoreEl.getBoundingClientRect();
      const voiceBounds = voice.getBoundingClientRect();
      const left = usesScoreCoordinates ? voice.offsetLeft : voiceBounds.left - scoreBounds.left + scoreEl.scrollLeft;
      const top = usesScoreCoordinates ? voice.offsetTop : voiceBounds.top - scoreBounds.top + scoreEl.scrollTop;
      const points = perimeterPointsFor(voice, width, height).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      const svg = perimeter.querySelector('svg');
      const polygon = perimeter.querySelector('polygon');
      perimeter.style.left = `${left}px`;
      perimeter.style.top = `${top}px`;
      perimeter.style.width = `${width}px`;
      perimeter.style.height = `${height}px`;
      perimeter.style.zIndex = String((Number.parseInt(voiceStyle.zIndex, 10) || 30) + 1);
      perimeter.style.transform = usesScoreCoordinates && voiceStyle.transform !== 'none' ? voiceStyle.transform : 'none';
      perimeter.style.transformOrigin = usesScoreCoordinates ? voiceStyle.transformOrigin : 'center';
      perimeter.classList.toggle('is-selected', voice.classList.contains('is-selected'));
      perimeter.classList.add('is-active');
      perimeter.dataset.voiceId = voice.dataset.id || '';
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      polygon.setAttribute('points', points);
    }

    function clearHoverPerimeter() {
      if (!hoverPerimeterEl) return;
      hoverPerimeterEl.classList.remove('is-active', 'is-selected');
      hoverPerimeterEl.removeAttribute('data-voice-id');
    }

    function clearHoverLock() {
      hoverLockedVoice?.classList.remove('is-hover-locked');
      hoverLockedVoice = null;
      clearHoverPerimeter();
      if (typeof document !== 'undefined') document.body?.classList.remove('counterform-hover-lock');
    }

    function setHoverLock(voice) {
      if (!voice) return;
      if (voice === hoverLockedVoice) {
        positionHoverPerimeter(voice);
        return;
      }
      clearHoverLock();
      hoverLockedVoice = voice;
      hoverLockedVoice.classList.add('is-hover-locked');
      positionHoverPerimeter(hoverLockedVoice);
      if (typeof document !== 'undefined') document.body?.classList.add('counterform-hover-lock');
    }

    function pointerIsNearHoverLock(event) {
      if (!hoverLockedVoice?.isConnected) return false;
      const bounds = hoverLockedVoice.getBoundingClientRect();
      return event.clientX >= bounds.left - HOVER_LOCK_EXIT_BUFFER
        && event.clientX <= bounds.right + HOVER_LOCK_EXIT_BUFFER
        && event.clientY >= bounds.top - HOVER_LOCK_EXIT_BUFFER
        && event.clientY <= bounds.bottom + HOVER_LOCK_EXIT_BUFFER;
    }

    function handlePointerOver(event) {
      if (!isMousePointer(event)) return;
      const voice = voiceAtPointer(event);
      if (voice) setHoverLock(voice);
    }

    function handleGlobalPointerMove(event) {
      if (!isMousePointer(event)) return;
      // Coordinate fallback is intentionally limited to pointer entry. During
      // ordinary movement it could select a distant overlapping voice simply
      // because its rectangular layout bounds happen to contain the pointer.
      // A real event target may still transfer the lock; otherwise the current
      // card owns the cue only through its bounded exit buffer.
      const nextVoice = voiceFromEvent(event);
      if (nextVoice) {
        setHoverLock(nextVoice);
        return;
      }
      if (hoverLockedVoice && !pointerIsNearHoverLock(event)) clearHoverLock();
    }

    function handleHoverGeometryChange() {
      if (hoverLockedVoice?.isConnected) positionHoverPerimeter(hoverLockedVoice);
    }

    function voiceState(id) {
      if (id === failedId) return 'ACTIVATION FAILED / CURRENT PRESERVED';
      if (id === requestedId && id !== currentActiveId) return 'REQUESTED / AWAITING HOST';
      if (id === currentActiveId && playbackState === 'playing') return 'CURRENT / PLAYING';
      if (id === currentActiveId) return 'CURRENT / PAUSED';
      if (id === selectedId) return 'SELECTED / NOT PLAYING';
      return 'AVAILABLE VOICE';
    }

    function voiceMarkup(track, index) {
      const number = String(index + 1).padStart(2, '0');
      const title = host.format.escapeHtml(track.title || 'Untitled track');
      const artist = host.format.escapeHtml(track.artist || 'Unknown artist');
      const album = host.format.escapeHtml(track.album || 'Local collection');
      const format = host.format.escapeHtml(String(track.format || 'LOCAL').toUpperCase().slice(0, 12));
      const duration = host.format.escapeHtml(host.format.durationText(track.duration));
      const cadence = ['◇', '··', '//', '×', ':'][index % 5];
      const pressure = '<span class="chorus-fold-pressure" aria-hidden="true">' + '<i></i>'.repeat(30) + '</span>';
      return `<span class="chorus-fold-number" aria-hidden="true">${number}</span><span class="chorus-fold-copy"><strong>${title}</strong><span>${artist}</span><small>${album}</small></span><span class="chorus-fold-proof" aria-hidden="true"><b>${format}</b><i>${duration}</i></span><span class="chorus-fold-cadence" aria-hidden="true">${cadence}</span><span class="chorus-fold-state"></span>${pressure}<span class="chorus-fold-face" aria-hidden="true"></span>`;
    }

    function createVoice(track, index) {
      const voice = document.createElement('button');
      voice.type = 'button';
      voice.className = 'chorus-fold-voice';
      voice.setAttribute('role', 'option');
      voice.dataset.id = encodeURIComponent(track.id);
      voice.innerHTML = voiceMarkup(track, index);
      return voice;
    }

    function updateVoiceContent(voice, track, index) {
      if (voice.dataset.contentKey === `${track.title}\u0000${track.artist}\u0000${track.album}\u0000${track.format}\u0000${track.duration}`) return;
      voice.dataset.contentKey = `${track.title}\u0000${track.artist}\u0000${track.album}\u0000${track.format}\u0000${track.duration}`;
      voice.innerHTML = voiceMarkup(track, index);
    }

    function updateVoiceState(voice, track, index, activeIndex) {
      const id = track.id;
      const geometry = geometryFor(index, activeIndex, currentTracks.length);
      const seed = deterministicSeed(id);
      const stateLabel = voiceState(id);
      voice.dataset.index = String(index);
      voice.dataset.curve = String(geometry.curve);
      voice.dataset.band = String(geometry.band);
      voice.dataset.movement = String(geometry.group + 1);
      voice.dataset.stage = geometry.stage;
      voice.dataset.distance = String(geometry.distance);
      voice.dataset.material = String(seed % 4);
      voice.dataset.side = String(geometry.side);
      voice.dataset.pressure = String(geometry.distance <= 1 ? 3 : geometry.distance <= 3 ? 2 : 1);
      voice.style.setProperty('--cf-x', `${geometry.x}%`);
      voice.style.setProperty('--cf-y', `${geometry.y}px`);
      voice.style.setProperty('--cf-angle', `${geometry.angle}deg`);
      voice.style.setProperty('--cf-side', String(geometry.side));
      voice.style.setProperty('--cf-distance', String(geometry.distance));
      voice.style.setProperty('--cf-stack-y', `${geometry.stackY}px`);
      voice.style.setProperty('--cf-stack-x', `${geometry.stackX}%`);
      voice.style.setProperty('--cf-dot-x', `${14 + (seed % 59)}%`);
      voice.style.setProperty('--cf-dot-y', `${20 + ((seed >>> 7) % 57)}%`);
      const dotSize = 3 + ((seed >>> 13) % 6);
      voice.style.setProperty('--cf-dot-size', `${dotSize}px`);
      voice.style.setProperty('--cf-dot-small', `${Math.max(2, Math.round(dotSize * .62))}px`);
      voice.style.setProperty('--cf-dot-tiny', `${Math.max(1, Math.round(dotSize * .42))}px`);
      voice.style.setProperty('--cf-pressure', String((0.28 + ((seed >>> 17) % 6) * 0.105).toFixed(3)));
      voice.style.setProperty('--cf-pressure-x', `${56 + ((seed >>> 21) % 31)}%`);
      voice.style.setProperty('--cf-pressure-y', `${18 + ((seed >>> 25) % 59)}%`);
      voice.style.setProperty('--cf-band', String(geometry.band));
      voice.querySelectorAll('.chorus-fold-pressure i').forEach((dot, dotIndex) => {
        const dotSeed = deterministicSeed(`${id}:${dotIndex}`);
        dot.dataset.tone = String(dotSeed % 4);
        // Density is a bounded pressure pocket, not a field-wide dot scatter.
        // The deterministic population crowds toward one advancing edge so
        // neighbor distance changes mass and occlusion behind the label.
        const rank = dotIndex / 29;
        dot.style.setProperty('--cf-particle-x', `${82 - rank * 56 + ((dotSeed % 17) - 8)}%`);
        dot.style.setProperty('--cf-particle-y', `${12 + ((dotSeed >>> 8) % 76)}%`);
        dot.style.setProperty('--cf-particle-size', `${4 + ((dotSeed >>> 15) % 15)}px`);
        dot.style.setProperty('--cf-particle-turn', `${(dotSeed >>> 22) % 46 - 23}deg`);
      });
      voice.classList.toggle('is-selected', id === selectedId);
      voice.classList.toggle('is-requested', id === requestedId && id !== currentActiveId);
      voice.classList.toggle('is-current', id === currentActiveId);
      voice.classList.toggle('is-playing', id === currentActiveId && playbackState === 'playing');
      voice.classList.toggle('is-paused', id === currentActiveId && playbackState !== 'playing');
      voice.classList.toggle('is-failed', id === failedId);
      voice.setAttribute('aria-selected', String(id === selectedId));
      if (id === currentActiveId) voice.setAttribute('aria-current', 'true');
      else voice.removeAttribute('aria-current');
      voice.tabIndex = id === selectedId ? 0 : -1;
      const title = track.title || 'Untitled track';
      const artist = track.artist || 'Unknown artist';
      voice.setAttribute('aria-label', `${String(index + 1).padStart(2, '0')}. ${title}, ${artist}. ${stateLabel}`);
      const state = voice.querySelector('.chorus-fold-state');
      if (state) state.textContent = stateLabel;
      const art = voice.querySelector('.chorus-fold-face');
      const artUrl = track.artworkPath ? host.format.fileUrl(track.artworkPath) : '';
      if (art) {
        art.style.backgroundImage = artUrl ? `url("${String(artUrl).replace(/["\\]/g, '\\$&')}")` : '';
        art.classList.toggle('has-image', Boolean(artUrl));
      }
    }

    function statusText() {
      if (!currentTracks.length) return 'Counterform score empty. Import local music to add voices.';
      const projection = projectionFor(currentTracks, currentActiveId);
      const current = projection.current?.title || 'No confirmed current track';
      if (failedId) {
        const failed = currentTracks.find((track) => track.id === failedId)?.title || 'Requested track';
        return `${failed} failed to activate. Current remains ${current}.`;
      }
      if (requestedId && requestedId !== currentActiveId) {
        const requested = currentTracks.find((track) => track.id === requestedId)?.title || 'Requested track';
        return `${requested} requested. Waiting for host confirmation. Current remains ${current}.`;
      }
      return `${current}. ${playbackState === 'playing' ? 'Confirmed playing.' : 'Current paused.'}`;
    }

    function syncProjection() {
      if (!mountedContainer || !scoreEl) return;
      const activeIndex = safeIndex(currentTracks, currentActiveId, 0);
      currentTracks.forEach((track, index) => {
        const voice = scoreEl.querySelector(`.chorus-fold-voice[data-id="${CSS.escape(encodeURIComponent(track.id))}"]`);
        if (voice) updateVoiceState(voice, track, index, activeIndex);
      });
      const groups = Math.max(1, Math.ceil(currentTracks.length / VOICES_PER_MOVEMENT));
      const finalMovementVoices = Math.max(1, currentTracks.length - (groups - 1) * VOICES_PER_MOVEMENT);
      const finalMovementBands = Math.max(1, Math.ceil(finalMovementVoices / 2));
      const activeGeometry = activeIndex >= 0 ? geometryFor(activeIndex, activeIndex, currentTracks.length) : null;
      const fieldHeight = Math.max(700, (groups - 1) * MOVEMENT_FIELD_STEP + 154 + (finalMovementBands - 1) * 132 + 144);
      const stackHeight = Math.max(954, (groups - 1) * MOVEMENT_STACK_STEP + 94 + (finalMovementBands - 1) * 138 + 218);
      mountedContainer.style.setProperty('--cf-field-height', `${fieldHeight}px`);
      mountedContainer.style.setProperty('--cf-stack-height', `${stackHeight}px`);
      mountedContainer.style.setProperty('--cf-aperture-shift', `${activeIndex < 0 ? 0 : ((activeIndex % 3) - 1) * 2.8}%`);
      mountedContainer.style.setProperty('--cf-aperture-turn', `${activeIndex < 0 ? -12 : -16 + (activeIndex % 5) * 3}deg`);
      mountedContainer.style.setProperty('--cf-aperture-x', `${activeIndex < 0 ? 52 : 49 + ((activeIndex % 3) - 1) * 3}%`);
      const localApertureY = activeGeometry ? activeGeometry.y - activeGeometry.group * MOVEMENT_FIELD_STEP : 0;
      mountedContainer.style.setProperty('--cf-aperture-y', `${activeGeometry ? activeGeometry.group * MOVEMENT_FIELD_STEP + Math.min(550, localApertureY + 176) : 434}px`);
      mountedContainer.style.setProperty('--cf-aperture-stack-y', `${activeGeometry ? 276 + activeGeometry.stackY : 434}px`);
      mountedContainer.dataset.playback = playbackState;
      mountedContainer.dataset.hasRequest = String(Boolean(requestedId && requestedId !== currentActiveId));
      mountedContainer.dataset.hasFailure = String(Boolean(failedId));
      if (statusEl) statusEl.textContent = statusText();
      if (apertureEl) apertureEl.dataset.current = currentActiveId ? encodeURIComponent(currentActiveId) : '';
      if (collectiveEl) collectiveEl.dataset.current = currentActiveId ? encodeURIComponent(currentActiveId) : '';
      if (pressureFieldEl) {
        const seedId = currentActiveId || currentTracks[0]?.id || 'counterform-empty';
        pressureFieldEl.dataset.current = currentActiveId ? encodeURIComponent(currentActiveId) : '';
        pressureFieldEl.dataset.playback = playbackState;
        pressureFieldEl.querySelectorAll('i').forEach((mark, index) => {
          const markSeed = deterministicSeed(`${seedId}:pressure-field:${index}`);
          const rank = index / 29;
          // 7 / 18 / 30 marks advance into one shared throat. The field is a
          // deterministic neighbor-pressure construction, never telemetry.
          mark.style.setProperty('--cf-field-x', `${Math.round(8 + rank * 78 + ((markSeed % 11) - 5))}%`);
          mark.style.setProperty('--cf-field-y', `${Math.round(17 + ((markSeed >>> 8) % 66))}%`);
          mark.style.setProperty('--cf-field-size', `${3 + ((markSeed >>> 15) % 9)}px`);
          mark.dataset.band = index < 7 ? '7' : index < 18 ? '18' : '30';
        });
      }
    }

    function reconcileTracks(tracks) {
      if (!scoreEl) return;
      const focusedVoice = document.activeElement?.closest?.('.chorus-fold-voice');
      const focusedId = decodeId(focusedVoice);
      const wanted = new Set(tracks.map((track) => encodeURIComponent(track.id)));
      scoreEl.querySelectorAll('.chorus-fold-voice').forEach((voice) => {
        if (!wanted.has(voice.dataset.id)) voice.remove();
      });
      tracks.forEach((track, index) => {
        const encoded = encodeURIComponent(track.id);
        let voice = scoreEl.querySelector(`.chorus-fold-voice[data-id="${CSS.escape(encoded)}"]`);
        if (!voice) voice = createVoice(track, index);
        updateVoiceContent(voice, track, index);
        const expected = scoreEl.children[index];
        if (expected !== voice) scoreEl.insertBefore(voice, expected || null);
      });
      currentTracks = tracks.slice();
      if (hoverLockedVoice && !scoreEl.contains(hoverLockedVoice)) clearHoverLock();
      if (!currentTracks.some((track) => track.id === selectedId)) {
        selectedId = currentTracks.some((track) => track.id === currentActiveId)
          ? currentActiveId : currentTracks[0]?.id || null;
      }
      if (!currentTracks.some((track) => track.id === requestedId)) requestedId = null;
      if (!currentTracks.some((track) => track.id === failedId)) failedId = null;
      syncProjection();
      if (focusedId) {
        const targetId = currentTracks.some((track) => track.id === focusedId) ? focusedId : selectedId;
        scoreEl.querySelector(`.chorus-fold-voice[data-id="${CSS.escape(encodeURIComponent(targetId || ''))}"]`)?.focus({ preventScroll: true });
      }
    }

    function select(id, shouldFocus = false) {
      if (!currentTracks.some((track) => track.id === id)) return;
      selectedId = id;
      failedId = null;
      syncProjection();
      options.onSelect?.(id);
      if (shouldFocus) scoreEl?.querySelector(`.chorus-fold-voice[data-id="${CSS.escape(encodeURIComponent(id))}"]`)?.focus({ preventScroll: true });
    }

    function requestActivation(id) {
      if (!currentTracks.some((track) => track.id === id)) return;
      selectedId = id;
      requestedId = id;
      failedId = null;
      syncProjection();
      options.onSelect?.(id);
      options.onActivate?.(id);
    }

    function activateOrToggleCurrent(id) {
      if (!currentTracks.some((track) => track.id === id)) return;
      select(id, true);
      // A second activation is a host-owned pause/resume request only after
      // activeId already confirms this exact voice. Selected/requested voices
      // that are not current continue through the ordinary activation path.
      if (id === currentActiveId && typeof options.onToggleCurrent === 'function') {
        Promise.resolve(options.onToggleCurrent(id)).catch(() => {});
        return;
      }
      requestActivation(id);
    }

    function handleClick(event) {
      const voice = voiceFromEvent(event);
      if (!voice) return;
      const id = decodeId(voice);
      activateOrToggleCurrent(id);
    }

    function handleFocusIn(event) {
      const voice = voiceFromEvent(event);
      if (voice) select(decodeId(voice), false);
    }

    function handleContextMenu(event) {
      const voice = voiceFromEvent(event);
      if (!voice) return;
      const id = decodeId(voice);
      select(id, false);
      options.onContextMenu?.(id, event);
    }

    function handleKeydown(event) {
      const voice = voiceFromEvent(event);
      if (!voice) return;
      const currentIndex = safeIndex(currentTracks, decodeId(voice), 0);
      let targetIndex = -1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = Math.max(0, currentIndex - 1);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = Math.min(currentTracks.length - 1, currentIndex + 1);
      if (event.key === 'Home') targetIndex = 0;
      if (event.key === 'End') targetIndex = currentTracks.length - 1;
      if (targetIndex >= 0) {
        event.preventDefault();
        select(currentTracks[targetIndex].id, true);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateOrToggleCurrent(decodeId(voice));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        voice.blur();
        options.onEscape?.();
      }
    }

    function mount(container, tracks, mountOptions = {}) {
      mountedContainer = container;
      options = mountOptions;
      currentActiveId = mountOptions.activeId || null;
      selectedId = currentActiveId || tracks?.[0]?.id || null;
      requestedId = null;
      failedId = null;
      playbackState = normalizedPlaybackState(mountOptions.playbackState, currentActiveId);
      container.classList.add('chorus-fold-mounted');
      container.innerHTML = '';
      scoreEl = document.createElement('div');
      scoreEl.className = 'chorus-fold-score';
      scoreEl.setAttribute('role', 'listbox');
      scoreEl.setAttribute('aria-label', 'Counterform Choir track voices');
      coursesEl = document.createElement('div');
      coursesEl.className = 'chorus-fold-courses';
      coursesEl.setAttribute('aria-hidden', 'true');
      coursesEl.innerHTML = '<svg viewBox="0 0 1000 700" preserveAspectRatio="none" focusable="false"><path class="cf-course-a" d="M-80 154 C126 126 278 194 400 318 C446 364 478 390 500 402"/><path class="cf-course-b" d="M1080 154 C874 126 722 194 600 318 C554 364 522 390 500 402"/><path class="cf-course-seam-a" d="M-80 154 C126 126 278 194 400 318 C446 364 478 390 500 402"/><path class="cf-course-seam-b" d="M1080 154 C874 126 722 194 600 318 C554 364 522 390 500 402"/><path class="cf-throat-mark" d="M450 374 L500 402 L550 374"/></svg>';
      apertureEl = document.createElement('div');
      apertureEl.className = 'chorus-fold-aperture';
      apertureEl.setAttribute('aria-hidden', 'true');
      apertureEl.innerHTML = '<i></i><i></i><b>CONFIRMED<br>APERTURE</b>';
      statusEl = document.createElement('div');
      statusEl.className = 'chorus-fold-status';
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
      scoreEl.appendChild(coursesEl);
      container.appendChild(scoreEl);
      container.appendChild(apertureEl);
      container.appendChild(statusEl);
      listeners = {
        click: handleClick,
        focusin: handleFocusIn,
        contextmenu: handleContextMenu,
        keydown: handleKeydown,
        pointerover: handlePointerOver,
      };
      Object.entries(listeners).forEach(([type, handler]) => scoreEl.addEventListener(type, handler));
      globalListeners = {
        pointermove: handleGlobalPointerMove,
        blur: clearHoverLock,
        resize: handleHoverGeometryChange,
        scroll: handleHoverGeometryChange,
      };
      document.addEventListener('pointermove', globalListeners.pointermove);
      window.addEventListener('blur', globalListeners.blur);
      window.addEventListener('resize', globalListeners.resize);
      document.addEventListener('scroll', globalListeners.scroll, true);
      reconcileTracks(tracks || []);
      collectiveEl = document.createElement('div');
      collectiveEl.className = 'chorus-fold-collective';
      collectiveEl.setAttribute('aria-hidden', 'true');
      collectiveEl.innerHTML = '<i class="cf-seam-one"></i><i class="cf-seam-two"></i><i class="cf-seam-three"></i><i class="cf-seam-four"></i><span class="cf-shared-throat"></span>';
      scoreEl.appendChild(collectiveEl);
      pressureFieldEl = document.createElement('div');
      pressureFieldEl.className = 'chorus-fold-pressure-field';
      pressureFieldEl.setAttribute('aria-hidden', 'true');
      pressureFieldEl.innerHTML = '<i></i>'.repeat(30);
      scoreEl.appendChild(pressureFieldEl);
      syncProjection();
    }

    function update(tracks, activeId, updateOptions = {}) {
      if (!mountedContainer) return;
      const previousActiveId = currentActiveId;
      currentActiveId = activeId || null;
      playbackState = normalizedPlaybackState(updateOptions.playbackState ?? playbackState, currentActiveId);
      if (updateOptions.activationFailedId && updateOptions.activationFailedId === requestedId) {
        failedId = requestedId;
        requestedId = null;
      } else if (requestedId && currentActiveId === requestedId) {
        requestedId = null;
        failedId = null;
      } else if (requestedId && previousActiveId !== currentActiveId) {
        failedId = requestedId;
        requestedId = null;
      }
      reconcileTracks(tracks || []);
    }

    function destroy() {
      if (scoreEl && listeners) Object.entries(listeners).forEach(([type, handler]) => scoreEl.removeEventListener(type, handler));
      if (globalListeners) {
        document.removeEventListener('pointermove', globalListeners.pointermove);
        window.removeEventListener('blur', globalListeners.blur);
        window.removeEventListener('resize', globalListeners.resize);
        document.removeEventListener('scroll', globalListeners.scroll, true);
      }
      clearHoverLock();
      if (mountedContainer) {
        mountedContainer.classList.remove('chorus-fold-mounted');
        mountedContainer.removeAttribute('data-playback');
        mountedContainer.removeAttribute('data-has-request');
        mountedContainer.removeAttribute('data-has-failure');
        mountedContainer.innerHTML = '';
      }
      mountedContainer = null;
      scoreEl = null;
      coursesEl = null;
      pressureFieldEl = null;
      collectiveEl = null;
      apertureEl = null;
      statusEl = null;
      hoverPerimeterEl = null;
      listeners = null;
      globalListeners = null;
      options = {};
      currentTracks = [];
      currentActiveId = null;
      selectedId = null;
      requestedId = null;
      failedId = null;
      playbackState = 'idle';
    }

    return Object.freeze({
      mount,
      update,
      destroy,
      meta: { label: 'Chorus Fold' },
      __test__: { geometryFor, normalizedPlaybackState, projectionFor, safeIndex, voiceMarkup },
    });
  }

  return Object.freeze({ createChorusFoldMechanic, geometryFor, normalizedPlaybackState, projectionFor, safeIndex });
}));
