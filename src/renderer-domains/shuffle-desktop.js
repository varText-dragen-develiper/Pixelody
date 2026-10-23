(function pixelodyDesktopShuffleFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyDesktopShuffle = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDesktopShuffleApi() {
  'use strict';

  // Windows drives the shared two-queue shuffle core through this bridge. The
  // renderer keeps its own queue (state.queue) and hands it over as entries;
  // this bridge keeps the controller's scope, mode and repeat in step with it.
  const STYLES = Object.freeze(['off', 'balanced', 'flow']);
  const UNKNOWN_ARTISTS = new Set(['', 'unknown artist', 'unknown']);

  // Old saved styles: Standard (random) shuffle is gone and continues as Balanced.
  function normalizeStyle(style, shuffle = true) {
    if (style === 'standard' || style === 'random') return 'balanced';
    if (STYLES.includes(style)) return style;
    return shuffle ? 'flow' : 'off';
  }

  function scopeIdFor(sourceId) {
    const value = typeof sourceId === 'string' && sourceId ? sourceId : 'all';
    if (value === 'all') return 'local-library';
    if (/^(album|artist|smart|playlist):/.test(value)) return value;
    return `playlist:${value}`;
  }

  function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function entryFor(track, sourceKey = null) {
    const artist = text(track.artist);
    const bpm = Number(track.bpm);
    const rawEnergy = track.energyLevel;
    const energy = rawEnergy === null || rawEnergy === undefined || rawEnergy === '' ? NaN : Number(rawEnergy);
    const features = {};
    if (Number.isFinite(bpm) && bpm > 0) features.tempo = { value: bpm, provenance: 'tagged' };
    if (Number.isFinite(energy) && energy >= 0 && energy <= 100) features.energy = { value: energy / 100, provenance: 'manual' };
    if (text(track.musicalKey)) features.key = { value: track.musicalKey.trim(), provenance: 'tagged' };
    return {
      entryId: track.id, trackId: track.id,
      artist: artist && !UNKNOWN_ARTISTS.has(artist.toLowerCase()) ? artist : null,
      albumArtist: text(track.albumArtist), album: text(track.album), genre: text(track.genre),
      ...(text(track.isrc) ? { isrc: track.isrc } : {}),
      discNumber: Number.isSafeInteger(Number(track.discNumber)) ? Number(track.discNumber) : null,
      trackNumber: Number.isSafeInteger(Number(track.trackNumber)) ? Number(track.trackNumber) : null,
      contextTags: Array.isArray(track.contextTags) ? track.contextTags.filter((tag) => typeof tag === 'string') : [],
      available: track.missing !== true,
      ...(sourceKey ? { sourceKey } : {}),
      features,
    };
  }

  function createDesktopShuffle(input = {}) {
    const { controllerApi, core, learning, scopes } = input;
    if (typeof controllerApi?.createController !== 'function') throw new TypeError('Desktop shuffle requires the shuffle controller');
    const nowMs = typeof input.nowMs === 'function' ? input.nowMs : () => Date.now();
    let serial = 0;
    const newId = typeof input.newId === 'function' ? input.newId : (kind) => `${kind}-${nowMs().toString(36)}-${(serial += 1).toString(36)}`;
    const onChange = typeof input.onChange === 'function' ? input.onChange : () => {};
    const onRecovery = typeof input.onRecovery === 'function' ? input.onRecovery : () => {};
    let controller = null;
    let signature = '';
    const diagnostics = [];

    function build(view, sessionSnapshot, ledgerSnapshot) {
      return controllerApi.createController({
        core, learning, scopes, nowMs, newId, onChange,
        adapterPoints: input.adapterPoints,
        sessionSnapshot, ledgerSnapshot,
        scopeId: view.scopeId, entries: view.entries, mode: view.mode, repeat: view.repeat, options: view.options,
        ...(sessionSnapshot == null && input.legacy ? { legacy: input.legacy } : {}),
      });
    }

    function create(view) {
      controller = build(view, input.sessionSnapshot ?? null, input.ledgerSnapshot ?? null);
      const status = controller.status();
      if (!status.readOnly) return;
      // A snapshot this build can't read is kept aside for recovery, never
      // overwritten, and shuffle carries on with a fresh session.
      diagnostics.push(...status.diagnostics);
      onRecovery({ session: input.sessionSnapshot ?? null, ledger: input.ledgerSnapshot ?? null, diagnostics: status.diagnostics });
      const ledgerBad = status.diagnostics.some((reason) => String(reason).startsWith('ledger-'));
      controller = build(view, null, ledgerBad ? null : input.ledgerSnapshot ?? null);
      if (controller.status().readOnly) controller = build(view, null, null);
    }

    function viewOf(view = {}) {
      const excluded = new Set(Array.isArray(view.excludedIds) ? view.excludedIds : []);
      const tracks = (Array.isArray(view.tracks) ? view.tracks : []).filter((track) => track?.id && !excluded.has(track.id));
      const style = normalizeStyle(view.style, view.shuffle !== false);
      const mode = view.shuffle === false ? 'off' : style;
      // A session made of several lists tags each song with the list it came from.
      const sources = view.sourceKeys && typeof view.sourceKeys === 'object' ? view.sourceKeys : null;
      const sourceKeyOf = (track) => sources && typeof sources[track.id] === 'string' ? scopeIdFor(sources[track.id]) : null;
      return {
        scopeId: scopeIdFor(view.sourceId), tracks, mode, sourceKeyOf,
        repeat: ['off', 'all', 'one'].includes(view.repeat) ? view.repeat : 'off',
        options: { preset: typeof view.preset === 'string' ? view.preset : 'flow', airtime: view.airtime === 'even' ? 'even' : 'size' },
      };
    }

    // Brings the controller in line with the renderer's queue. Cheap when
    // nothing changed: the queue is compared by a signature before any
    // entry is rebuilt.
    function sync(view) {
      const next = viewOf(view);
      const key = [next.scopeId, next.tracks.map((track) => `${track.id}${track.missing === true ? '!' : ''}${next.sourceKeyOf(track) || ''}`).join('\u0001')].join('\u0000');
      const entries = () => next.tracks.map((track) => entryFor(track, next.sourceKeyOf(track)));
      if (!controller) {
        create({ ...next, entries: entries() });
        signature = '';
      }
      const status = controller.status();
      if (status.activeScopeId !== next.scopeId) {
        controller.selectScope({ scopeId: next.scopeId, entries: entries(), mode: next.mode, repeat: next.repeat, options: next.options });
      } else if (key !== signature) {
        controller.reconcile(entries());
      }
      signature = key;
      const active = controller.summary();
      if (active && (active.mode !== next.mode || active.options.preset !== next.options.preset || active.options.airtime !== next.options.airtime)) {
        controller.setMode(next.mode, { ...active.options, ...next.options });
      }
      if (active && active.repeat !== next.repeat) controller.setRepeat(next.repeat);
      return controller.status();
    }

    function staged(result) {
      if (!result?.ok) return null;
      return { trackId: result.trackId, entryId: result.entryId, reservation: result.reservation, receipt: result.receipt };
    }

    // A natural end plays the base queue and a personal Next the live queue.
    // An entryId plays that song next (Play Next, a moved row).
    function next(request = {}) {
      if (!controller) return null;
      return staged(controller.stage({
        direction: 'next',
        ...(typeof request.naturalEnd === 'boolean' ? { naturalEnd: request.naturalEnd } : {}),
        ...(Number.isSafeInteger(request.heardMs) ? { heardMs: request.heardMs } : {}),
        ...(Number.isSafeInteger(request.coveragePermille) ? { coveragePermille: request.coveragePermille } : {}),
        ...(request.entryId ? { entryId: request.entryId } : {}),
        // Windows never retries a failed song on its own, so every request is
        // its own advance: a song that failed once can be picked again.
        advanceId: request.advanceId || newId('desktop-advance'),
        personal: request.personal !== false,
        source: request.source || null,
        durationMs: Number.isSafeInteger(request.durationMs) ? request.durationMs : null,
      }));
    }

    // A list's Shuffle button: carry on with that list's session, or start
    // a fresh cycle once every song in it has played.
    function start(request = {}) {
      if (!controller) return null;
      const first = next({ naturalEnd: true, personal: false, ...request });
      if (first) return first;
      controller.newCycle();
      return next({ naturalEnd: true, personal: false, ...request });
    }

    function previous(request = {}) {
      if (!controller) return null;
      return staged(controller.stage({ direction: 'previous', personal: request.personal !== false, source: request.source || null }));
    }

    function confirm(reservation, details = {}) {
      return controller && reservation ? controller.confirm(reservation, details) : { ok: false, status: 'no-reservation' };
    }

    function fail(reservation, reason) {
      return controller && reservation ? controller.fail(reservation, reason) : { ok: false, status: 'no-reservation' };
    }

    // A song started outside shuffle (a click, linear Next) still becomes the
    // current song, so Previous, the live queue and learning stay truthful.
    function align(trackId, details = {}) {
      if (!controller || !trackId) return { ok: false, status: 'unavailable' };
      if (controller.current()?.trackId === trackId) return { ok: true, status: 'unchanged' };
      const result = controller.stage({ direction: 'next', entryId: trackId, personal: false, source: details.source || null, durationMs: details.durationMs ?? null });
      if (!result.ok) return result;
      // No session mark for a song picked by hand, but it still teaches
      // learning unless it came from a remote or restored session.
      return controller.confirm(result.reservation, { personal: details.personal !== false, source: details.source || null, durationMs: details.durationMs ?? null });
    }

    // The queue drawer and track list ask for this on every paint, so one
    // projection is kept per session revision and caller-supplied context key.
    let projected = { key: null, trackIds: [] };
    function upcoming(horizon = 16, contextKey = '') {
      if (!controller) return [];
      const bounded = Math.max(1, Math.min(32, horizon));
      const key = `${controller.status().revision}\u0000${bounded}\u0000${contextKey}`;
      if (projected.key === key) return projected.trackIds.slice();
      const projection = controller.project({ horizon: bounded });
      projected = { key, trackIds: Array.isArray(projection.decisions) ? projection.decisions.map((decision) => decision.trackId) : [] };
      return projected.trackIds.slice();
    }

    function history() {
      return controller ? controller.historyTrackIds() : [];
    }

    // What each queue would play next, kept per session revision like upcoming().
    const previewed = new Map();
    function preview(lane, heard = {}, contextKey = '') {
      if (!controller) return null;
      const key = `${controller.status().revision}\u0000${JSON.stringify(heard)}\u0000${contextKey}`;
      const cached = previewed.get(lane);
      if (cached?.key === key) return cached.value;
      const value = controller.preview({ lane, ...heard });
      previewed.set(lane, { key, value });
      return value;
    }

    // Listening evidence is only taught against the song the controller
    // activated; its own occurrence identity replaces the renderer's.
    function forward(kind, event) {
      if (!controller || !event?.trackId || controller.current()?.trackId !== event.trackId) return { ok: false, status: 'not-current' };
      const { occurrenceId, ...rest } = event;
      return controller[kind](rest);
    }

    function snapshot() {
      return controller ? controller.snapshot() : { session: input.sessionSnapshot ?? null, ledger: input.ledgerSnapshot ?? null };
    }

    return Object.freeze({
      sync, next, start, previous, confirm, fail, align, upcoming, history, preview, snapshot,
      interval: (event) => forward('interval', event),
      outcome: (event) => forward('outcome', event),
      current: () => controller?.current() || null,
      summary: () => controller?.summary() || null,
      status: () => controller ? { ...controller.status(), diagnostics: [...new Set([...diagnostics, ...controller.status().diagnostics])] } : null,
      controller: () => controller,
    });
  }

  return Object.freeze({ STYLES, normalizeStyle, scopeIdFor, entryFor, createDesktopShuffle });
}));
