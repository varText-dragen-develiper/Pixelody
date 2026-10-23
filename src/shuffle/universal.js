(function universalShuffleFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyUniversalShuffle = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUniversalShuffle() {
  'use strict';

  const VERSION = 3;
  const POLICY_VERSION = 'universal-shuffle-v2.2';
  const PRIOR_POLICY_VERSION = 'universal-shuffle-v2.1';
  const CONFIG = Object.freeze({ version: 2, horizon: 10, maxHorizon: 32, maxFailures: 64,
    artistWindow: 3, albumWindow: 2, recordingWindow: 1, explorationPermille: 100,
    baseWeight: 64, minWeight: 16, maxWeight: 128, maxTaste: 12, maxNovelty: 12,
    freshnessMs: 86400000, maxFreshnessPenalty: 12, maxTempoPoints: 8,
    maxEnergyPoints: 8, maxKeyPoints: 4, maxContextPoints: 4, maxPresetPoints: 8,
    // Two-queue session steering. The base queue is what a natural end plays;
    // the live queue is what a personal Next plays. Skip timing reuses the
    // learning contract's early-skip window so both systems agree on meaning.
    pinnedBase: 3, liveSteer: 24, baseSteer: 8, maxMarks: 8, markMaxSongs: 8, markMaxAgeMs: 7200000,
    flickMs: 3000, earlySkipMaxMs: 30000, earlySkipCoveragePermille: 250, lateSkipCoveragePermille: 800,
    earlyMark: -1000, midMark: -400, lateMark: 200, finishMark: 600, pruneSimilarity: 600,
    flickExplorationPermille: 250, flickStormExplorationPermille: 400, flowLetGoAfter: 3, liveExclusionMinimum: 3,
    maxAirtimePoints: 12, similarityArtist: 350, similarityAlbum: 250, similarityGenre: 150,
    similarityTempoClose: 100, similarityTempoNear: 50, similarityEnergy: 100, similarityKey: 50, similaritySource: 200 });
  const MODES = Object.freeze(['off', 'balanced', 'flow', 'album']);
  const LANES = Object.freeze(['base', 'live']);
  const SKIPS = Object.freeze(['flick', 'early', 'mid', 'late', 'finish', 'unknown']);
  const PRESETS = Object.freeze(['flow', 'discovery', 'comfort', 'energy', 'genre-weave', 'deep-library']);
  const PROVENANCE = Object.freeze(['manual', 'tagged', 'measured', 'derived', 'unknown']);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const integer = (value, min, max, fallback = min) => Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const unique = (values) => [...new Set(values)];
  function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort(ordinal).map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function id(value, name = 'id') {
    if (typeof value !== 'string' || value.length < 1 || value.length > 1024 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new TypeError(`Invalid ${name}`);
    return value;
  }
  const optionalId = (value) => value == null || value === '' ? null : id(value);
  // Only ASCII case folding is intentional: portable, locale independent and no
  // accidental collapse of non-Latin identities. Explicit catalog IDs win.
  const textIdentity = (value) => typeof value === 'string' ? value.normalize('NFC').replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/\s+/gu, ' ').trim() || null : null;
  function normalizeMode(value) {
    // Random shuffle was removed in v2.2. Balanced keeps its once-per-cycle promise.
    const aliases = { random: 'balanced', standard: 'balanced', Standard: 'balanced', PureRandom: 'balanced', SmartFlow: 'flow', Flow: 'flow', AlbumPreserving: 'album' };
    return MODES.includes(value) ? value : Object.hasOwn(aliases, value) ? aliases[value] : 'balanced';
  }
  function hashSeed(value) {
    const seed = String(value);
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    return hash >>> 0;
  }
  function createRng(seed) {
    if (typeof seed !== 'string') throw new TypeError('Seed must be explicitly injected');
    const seedHash = hashSeed(seed);
    return { algorithm: 'fnv1a-utf16-mulberry32-fy-v1', state: seedHash || 0x6d2b79f5, draws: 0, seedHash };
  }
  function draw(rng) {
    const state = (rng.state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return { value: (value ^ (value >>> 14)) >>> 0, rng: { ...rng, state, draws: rng.draws + 1 } };
  }
  // Split the uint32 product so all intermediate integers stay below 2^53.
  // Equivalent to an exact unsigned 64-bit multiply/divide on Kotlin. Random
  // Fisher-Yates bounds <=1,000,000 also reproduce the v1 float mapping exactly.
  function bounded(rng, bound) {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 128000000) throw new RangeError('Invalid draw bound');
    const next = draw(rng);
    const highProduct = (next.value >>> 16) * bound;
    const lowProduct = (next.value & 65535) * bound;
    return { value: Math.floor(highProduct / 65536) + Math.floor(((highProduct % 65536) * 65536 + lowProduct) / 4294967296), rng: next.rng };
  }
  function permutation(values, rng) {
    const order = values.slice();
    let current = rng;
    for (let i = order.length - 1; i > 0; i -= 1) {
      const next = bounded(current, i + 1); current = next.rng;
      [order[i], order[next.value]] = [order[next.value], order[i]];
    }
    return { order, rng: current };
  }
  function parseKey(value) {
    if (value && typeof value === 'object' && Number.isInteger(value.pitchClass) && value.pitchClass >= 0 && value.pitchClass < 12 && ['major', 'minor'].includes(value.mode)) return { pitchClass: value.pitchClass, mode: value.mode };
    if (typeof value !== 'string') return null;
    const raw = value.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    const camelot = /^(1[0-2]|[1-9])([AB])$/i.exec(raw);
    if (camelot) return { pitchClass: (camelot[2].toUpperCase() === 'A' ? [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1] : [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4])[Number(camelot[1]) - 1], mode: camelot[2].toUpperCase() === 'A' ? 'minor' : 'major' };
    const match = /^([A-Ga-g])([#b]?)(?:\s*(major|maj|minor|min|m))?$/i.exec(raw);
    if (!match) return null;
    const pitch = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
    return { pitchClass: (pitch + (match[2] === '#' ? 1 : match[2].toLowerCase() === 'b' ? -1 : 0) + 12) % 12, mode: match[3] !== 'M' && ['minor', 'min', 'm'].includes((match[3] || '').toLowerCase()) ? 'minor' : 'major' };
  }
  function feature(raw, kind) {
    const item = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value') ? raw : { value: raw, provenance: 'unknown' };
    const provenance = PROVENANCE.includes(item.provenance) ? item.provenance : 'unknown';
    let value = null;
    if (provenance !== 'unknown' && item.value != null) {
      if (kind === 'key') value = parseKey(item.value);
      else if (typeof item.value === 'number' && Number.isFinite(item.value)) {
        const quantized = Math.floor(item.value * (item.unit === (kind === 'tempo' ? 'milli-bpm' : 'permille') ? 1 : 1000) + 0.5);
        if (kind === 'tempo' && quantized >= 20000 && quantized <= 400000) value = quantized;
        if (kind === 'energy' && quantized >= 0 && quantized <= 1000) value = quantized;
      }
    }
    return { value, provenance: value == null ? 'unknown' : provenance, version: integer(item.version, 1, 100000, 1), confidencePermille: value == null ? null : integer(item.confidencePermille, 0, 1000, provenance === 'manual' || provenance === 'tagged' ? 1000 : 500), unit: kind === 'key' ? 'pitch-class-mode' : kind === 'tempo' ? 'milli-bpm' : 'permille' };
  }
  function normalizeEntry(raw, index = 0) {
    if (!raw || typeof raw !== 'object') throw new TypeError('Entry must be an object');
    const artistId = optionalId(raw.artistId) || textIdentity(raw.artist);
    const albumArtistId = optionalId(raw.albumArtistId) || textIdentity(raw.albumArtist);
    const albumName = textIdentity(raw.album);
    const albumId = optionalId(raw.albumId) || (albumName ? JSON.stringify([albumArtistId || artistId, albumName]) : null);
    const isrc = typeof raw.isrc === 'string' ? raw.isrc.replace(/[-\s]/g, '').toUpperCase() : '';
    const recordingId = optionalId(raw.recordingId) || (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? `isrc:${isrc}` : null);
    const features = raw.features || {};
    return { entryId: id(raw.entryId, 'entryId'), trackId: id(raw.trackId, 'trackId'), recordingId,
      artistId, albumArtistId, albumId, sourceKey: optionalId(raw.sourceKey), sourceIndex: index, discNumber: integer(raw.discNumber, 1, 10000, null), trackNumber: integer(raw.trackNumber, 1, 100000, null), available: raw.available !== false,
      genreId: optionalId(raw.genreId) || textIdentity(raw.genre), contextTags: unique((Array.isArray(raw.contextTags) ? raw.contextTags : []).map(textIdentity).filter(Boolean)).sort(ordinal),
      features: { tempo: feature(features.tempo ?? features.bpm, 'tempo'), energy: feature(features.energy, 'energy'), key: feature(features.key, 'key') } };
  }
  function normalizeEntries(entries) {
    if (!Array.isArray(entries) || entries.length > 1000000) throw new TypeError('Entries must be an array of at most 1,000,000 occurrences');
    const normalized = entries.map(normalizeEntry);
    if (new Set(normalized.map((e) => e.entryId)).size !== normalized.length) throw new TypeError('Duplicate entryId');
    return normalized;
  }
  function normalizeOptions(options = {}) {
    return { preset: PRESETS.includes(options.preset) ? options.preset : 'flow', shape: ['steady', 'rise', 'wave', 'wind-down', 'auto'].includes(options.shape) ? options.shape : 'auto', preserveAlbumRuns: options.preserveAlbumRuns === true, contextTag: textIdentity(options.contextTag), airtime: options.airtime === 'even' ? 'even' : 'size' };
  }
  function emptyLanes() {
    return { marks: [], flicks: 0, earlyRun: 0, anchorEntryId: null, lastEarlyAlbumId: null, pinned: [] };
  }
  function createSession(input) {
    const entries = normalizeEntries(input.entries || []);
    return { schemaVersion: VERSION, policyVersion: POLICY_VERSION, configVersion: CONFIG.version,
      sessionId: id(input.sessionId, 'sessionId'), scopeId: id(input.scopeId, 'scopeId'), authorityId: id(input.authorityId, 'authorityId'), authorityEpoch: integer(input.authorityEpoch, 0, Number.MAX_SAFE_INTEGER, 0),
      revision: 0, membershipRevision: integer(input.membershipRevision, 0, Number.MAX_SAFE_INTEGER, 0), mode: normalizeMode(input.mode), repeat: ['off', 'all', 'one'].includes(input.repeat) ? input.repeat : 'off', options: normalizeOptions(input.options),
      cycle: { generation: 0, cycleId: JSON.stringify([input.scopeId, 0]) }, rng: createRng(input.seed), entries,
      remaining: entries.map((e) => e.entryId), history: [], cursor: -1, occurrenceSequence: 0,
      generatedFuture: [], manual: [], exclusions: [], albumLock: null, pending: null, lastConfirmedPositionMs: 0, eventSequences: [],
      quarantine: { advanceId: null, entryIds: [] }, undo: null, paused: true, diagnostics: [], imported: false, lanes: emptyLanes() };
  }
  function requireState(state) {
    if (!state || state.schemaVersion !== VERSION || state.policyVersion !== POLICY_VERSION || state.configVersion !== CONFIG.version) throw new TypeError('Unsupported session version; preserve snapshot without overwriting it');
    return state;
  }
  const currentOccurrence = (state) => state.cursor >= 0 ? state.history[state.cursor] || null : null;
  function albumOrder(entries) {
    // If any numbering is absent, preserve the complete source order rather
    // than guessing a partial disc/track sequence.
    const known = entries.every((e) => e.discNumber != null && e.trackNumber != null);
    return { entries: entries.slice().sort(known ? (a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber || a.sourceIndex - b.sourceIndex || ordinal(a.entryId, b.entryId) : (a, b) => a.sourceIndex - b.sourceIndex), ordering: known ? 'disc-track' : 'source-order-missing-numbers' };
  }
  function shapeTarget(shape, generationPosition, base) {
    const step = generationPosition % 10;
    if (shape === 'rise') return Math.min(1000, base + step * 30);
    if (shape === 'wind-down') return Math.max(0, base - step * 30);
    if (shape === 'wave') return Math.max(0, Math.min(1000, base + [0, 60, 120, 180, 120, 60, 0, -60, -120, -60][step]));
    return base;
  }
  function keyPoints(a, b) {
    const difference = (b.pitchClass - a.pitchClass + 12) % 12;
    return difference === 0 && a.mode === b.mode ? 4 : [5, 7].includes(difference) && a.mode === b.mode || (a.mode === 'major' && b.mode === 'minor' && difference === 9) || (a.mode === 'minor' && b.mode === 'major' && difference === 3) ? 2 : -2;
  }
  // Session closeness 0..1000 from metadata already read. Unknown traits add nothing.
  function similarity(a, b, multiSource) {
    if (!a || !b) return 0;
    let points = 0;
    if (a.artistId && a.artistId === b.artistId) points += CONFIG.similarityArtist;
    if (a.albumId && a.albumId === b.albumId) points += CONFIG.similarityAlbum;
    if (a.genreId && a.genreId === b.genreId) points += CONFIG.similarityGenre;
    if (a.features.tempo.value != null && b.features.tempo.value != null) {
      const distance = Math.abs(a.features.tempo.value - b.features.tempo.value);
      points += distance <= 5000 ? CONFIG.similarityTempoClose : distance <= 10000 ? CONFIG.similarityTempoNear : 0;
    }
    if (a.features.energy.value != null && b.features.energy.value != null && Math.abs(a.features.energy.value - b.features.energy.value) <= 100) points += CONFIG.similarityEnergy;
    if (a.features.key.value != null && b.features.key.value != null && keyPoints(a.features.key.value, b.features.key.value) > 0) points += CONFIG.similarityKey;
    if (multiSource && a.sourceKey && a.sourceKey === b.sourceKey) points += CONFIG.similaritySource;
    return Math.min(1000, points);
  }
  // A mark keeps full strength for two songs, then halves every two songs.
  function steerPoints(entry, steering, byId) {
    if (!steering.gain || !steering.marks.length) return 0;
    let sum = 0;
    for (const mark of steering.marks) {
      const marked = byId.get(mark.entryId);
      const age = mark.songs + steering.ageOffset;
      if (!marked || age >= CONFIG.markMaxSongs) continue;
      sum += Math.trunc(mark.mark * similarity(entry, marked, steering.multiSource) / 2 ** Math.floor(age / 2));
    }
    return Math.max(-steering.gain, Math.min(steering.gain, Math.trunc(steering.gain * sum / 1000000))) || 0;
  }
  // Even turns lifts linked members behind their share of this cycle and lowers those ahead.
  function airtimePoints(entry, airtime) {
    if (!airtime || !entry.sourceKey) return 0;
    const played = airtime.played.get(entry.sourceKey) || 0;
    return Math.max(-CONFIG.maxAirtimePoints, Math.min(CONFIG.maxAirtimePoints, Math.trunc((airtime.totalPlayed - airtime.sources * played) * CONFIG.maxAirtimePoints / Math.max(airtime.sources, airtime.totalPlayed)))) || 0;
  }
  function airtimeContext(state, consumed) {
    if (state.options.airtime !== 'even') return null;
    const played = new Map(), sources = new Set();
    let totalPlayed = 0;
    for (const entry of state.entries) {
      if (!entry.sourceKey) continue;
      sources.add(entry.sourceKey);
      if (consumed(entry.entryId)) { played.set(entry.sourceKey, (played.get(entry.sourceKey) || 0) + 1); totalPlayed += 1; }
    }
    return sources.size < 2 ? null : { sources: sources.size, played, totalPlayed };
  }
  function selection(state, eligible, context, current, byId, steering = { gain: 0, marks: [], ageOffset: 0, explorationPermille: CONFIG.explorationPermille, airtime: null, multiSource: false }) {
    let rng = state.rng;
    const recent = state.history.slice(Math.max(0, state.cursor - CONFIG.artistWindow + 1), state.cursor + 1).map((h) => byId.get(h.entryId) || h);
    const windows = { artist: recent.slice(-CONFIG.artistWindow).map((e) => e.artistId).filter(Boolean), album: recent.slice(-CONFIG.albumWindow).map((e) => e.albumId).filter(Boolean), recording: recent.slice(-CONFIG.recordingWindow).map((e) => e.recordingId).filter(Boolean) };
    const relaxed = [];
    function feasible() { return eligible.filter((e) => (relaxed.includes('artist') || !e.artistId || !windows.artist.includes(e.artistId)) && (relaxed.includes('album') || !e.albumId || !windows.album.includes(e.albumId)) && (relaxed.includes('recording') || !e.recordingId || !windows.recording.includes(e.recordingId))); }
    let candidates = feasible();
    for (const kind of ['album', 'artist', 'recording']) { if (candidates.length) break; relaxed.push(kind); candidates = feasible(); }
    candidates.sort((a, b) => ordinal(a.entryId, b.entryId));
    const signals = new Map((context.signals || []).map((s) => [s.trackId, s]));
    const now = integer(context.nowMs, 0, Number.MAX_SAFE_INTEGER, 0);
    const rows = candidates.map((entry) => {
      const signal = signals.get(entry.trackId) || {};
      const parts = { taste: integer(signal.tastePoints, -12, 12, 0), novelty: integer(signal.noveltyPoints, 0, 12, 12), freshness: 0, tempo: 0, energy: 0, key: 0, context: 0, preset: 0, steer: steerPoints(entry, steering, byId), airtime: airtimePoints(entry, steering.airtime), adapter: integer(signal.adapterPoints, -12, 12, 0) };
      if (Number.isSafeInteger(signal.lastHeardAtMs) && signal.lastHeardAtMs >= 0) { const penalty = Math.floor(CONFIG.maxFreshnessPenalty * Math.max(0, CONFIG.freshnessMs - Math.max(0, now - signal.lastHeardAtMs)) / CONFIG.freshnessMs); parts.freshness = penalty ? -penalty : 0; }
      const coverage = [];
      if (Number.isSafeInteger(signal.tastePoints) && (signal.tastePoints !== 0 || signal.confidencePermille > 0)) coverage.push('taste');
      if (Number.isSafeInteger(signal.noveltyPoints)) coverage.push('novelty');
      if (Number.isSafeInteger(signal.lastHeardAtMs) && signal.lastHeardAtMs >= 0) coverage.push('freshness');
      if (state.mode === 'flow') {
        const from = current?.features;
        const to = entry.features;
        if (from?.tempo.value != null && to.tempo.value != null) { parts.tempo = Math.max(-8, 8 - Math.floor(Math.abs(from.tempo.value - to.tempo.value) / 5000)); coverage.push('tempo'); }
        if (from?.energy.value != null && to.energy.value != null) { const target = shapeTarget(state.options.shape, state.history.length, from.energy.value); parts.energy = Math.max(-8, 8 - Math.floor(Math.abs(target - to.energy.value) / 50)); coverage.push('energy'); }
        if (from?.key.value != null && to.key.value != null) { parts.key = keyPoints(from.key.value, to.key.value); coverage.push('key'); }
        if (state.options.contextTag && entry.contextTags.includes(state.options.contextTag)) { parts.context = 4; coverage.push('context'); }
        const preset = state.options.preset;
        if (preset === 'discovery' || preset === 'deep-library') parts.preset = Math.floor(parts.novelty * 8 / 12);
        if (preset === 'comfort') { const penalty = Math.floor(parts.novelty * 5 / 12); parts.preset = penalty ? -penalty : 0; }
        if (preset === 'energy' && to.energy.value != null) { parts.preset = Math.floor(to.energy.value * 8 / 1000); if (!coverage.includes('energy')) coverage.push('energy'); }
        if (preset === 'genre-weave' && current?.genreId && entry.genreId) { parts.preset = current.genreId === entry.genreId ? -4 : 4; coverage.push('genre'); }
      }
      if (parts.steer) coverage.push('steer');
      if (parts.airtime) coverage.push('airtime');
      if (parts.adapter) coverage.push('adapter');
      const weight = Math.max(CONFIG.minWeight, Math.min(CONFIG.maxWeight, CONFIG.baseWeight + parts.taste + parts.novelty + parts.freshness + parts.tempo + parts.energy + parts.key + parts.context + parts.preset + parts.steer + parts.airtime + parts.adapter));
      return { entry, parts, coverage, weight };
    });
    const exploration = bounded(rng, 1000); rng = exploration.rng;
    const explore = exploration.value < steering.explorationPermille;
    // Exploration favors the least exposed feasible opportunity, randomly
    // breaking all ties; no low-ID shortlist and no permanent taste exclusion.
    let pool = rows;
    if (explore) { const least = rows.reduce((min, r) => Math.min(min, integer(signals.get(r.entry.trackId)?.exposure, 0, Number.MAX_SAFE_INTEGER, 0)), Number.MAX_SAFE_INTEGER); pool = rows.filter((r) => integer(signals.get(r.entry.trackId)?.exposure, 0, Number.MAX_SAFE_INTEGER, 0) === least); }
    const total = pool.reduce((sum, row) => sum + (explore ? 1 : row.weight), 0);
    const roll = bounded(rng, total); rng = roll.rng;
    let cursor = roll.value;
    const picked = pool.find((row) => { cursor -= explore ? 1 : row.weight; return cursor < 0; });
    return { entry: picked.entry, rng, reason: { strategy: explore ? 'exploration' : 'weighted', exploration: explore, candidateCount: candidates.length, relaxations: relaxed, signalCoverage: explore ? ['exposure'] : picked.coverage, scoreParts: explore ? null : picked.parts, weight: explore ? 1 : picked.weight, albumOrdering: null } };
  }
  function skipBucket(request) {
    const heard = Number.isSafeInteger(request.heardMs) && request.heardMs >= 0 ? request.heardMs : null;
    const coverage = Number.isSafeInteger(request.coveragePermille) && request.coveragePermille >= 0 ? Math.min(1000, request.coveragePermille) : null;
    if (heard == null && coverage == null) return 'unknown';
    if (heard != null && heard < CONFIG.flickMs) return 'flick';
    if (coverage != null && coverage >= CONFIG.lateSkipCoveragePermille) return 'late';
    if (heard != null && heard < CONFIG.earlySkipMaxMs && (coverage == null || coverage < CONFIG.earlySkipCoveragePermille)) return 'early';
    return 'mid';
  }
  // Session marks for the song being left. Only personal advances leave marks;
  // navigation, Play Now and remote or preview actions never do.
  function nextLanes(state, current, skip, appends, nowMs) {
    const lanes = state.lanes;
    let marks = appends ? lanes.marks.map((mark) => ({ ...mark, songs: mark.songs + 1 })) : lanes.marks.slice();
    marks = marks.filter((mark) => mark.songs < CONFIG.markMaxSongs && (nowMs == null || mark.atMs + CONFIG.markMaxAgeMs >= nowMs));
    if (!skip || !current) return { ...lanes, marks };
    const value = { early: CONFIG.earlyMark, mid: CONFIG.midMark, late: CONFIG.lateMark, finish: CONFIG.finishMark }[skip];
    if (value != null) marks = [...marks, { entryId: current.entryId, mark: value, songs: 0, atMs: nowMs ?? 0 }].slice(-CONFIG.maxMarks);
    const kept = skip === 'finish' || skip === 'late';
    return { ...lanes, marks,
      flicks: skip === 'flick' ? lanes.flicks + 1 : skip === 'unknown' ? lanes.flicks : 0,
      earlyRun: skip === 'early' ? lanes.earlyRun + 1 : skip === 'flick' || skip === 'unknown' ? lanes.earlyRun : 0,
      anchorEntryId: kept ? current.entryId : lanes.anchorEntryId,
      lastEarlyAlbumId: skip === 'early' ? current.albumId : skip === 'flick' || skip === 'unknown' ? lanes.lastEarlyAlbumId : null };
  }
  function stage(state, request = {}, context = {}) {
    requireState(state);
    const attemptId = id(request.attemptId, 'attemptId');
    const advanceId = optionalId(request.advanceId) || attemptId;
    if (state.pending && state.pending.attemptId === attemptId) return state;
    const next = { ...state, pending: null, quarantine: state.quarantine.advanceId === advanceId ? state.quarantine : { advanceId, entryIds: [] } };
    if (next.quarantine.entryIds.length >= CONFIG.maxFailures) return { ...next, diagnostics: unique([...next.diagnostics, 'retry-budget-exhausted']), paused: true };
    const byId = new Map(state.entries.map((e) => [e.entryId, e]));
    const allowed = (entryId, explicit = false) => { const e = byId.get(entryId); return Boolean(e && e.available && (explicit || !state.exclusions.includes(entryId)) && !next.quarantine.entryIds.includes(entryId)); };
    const currentHistory = currentOccurrence(state);
    const current = currentHistory ? byId.get(currentHistory.entryId) : null;
    const nowMs = Number.isSafeInteger(context.nowMs) && context.nowMs >= 0 ? context.nowMs : null;
    // Natural end plays the base queue; a personal Next plays the live queue.
    // A failed candidate's retry keeps the lane of the advance that staged it.
    let lane = LANES.includes(request.lane) ? request.lane : state.quarantine.advanceId === advanceId && LANES.includes(state.quarantine.lane) ? state.quarantine.lane : request.naturalEnd === false ? 'live' : 'base';
    if (!current || request.direction === 'previous' || request.entryId != null) lane = 'base';
    const advancing = request.direction !== 'previous' && request.entryId == null && current != null && state.mode !== 'off';
    const retrying = state.quarantine.advanceId === advanceId && Object.hasOwn(state.quarantine, 'skip') && request.heardMs == null && request.coveragePermille == null;
    const skip = !advancing || request.personal === false ? null : retrying ? state.quarantine.skip : lane === 'live' ? skipBucket(request) : request.naturalEnd === true ? 'finish' : null;
    const multiSource = new Set(state.entries.map((e) => e.sourceKey).filter(Boolean)).size > 1;
    let entry = null, kind = 'automatic', historyIndex = null, newCycle = false, rngAfter = state.rng, futureAfter = state.generatedFuture, albumLockAfter = state.albumLock, manualIndex = null;
    let lanesAfter = state.lanes, pinnedAfter = state.lanes.pinned;
    let reason = { strategy: state.mode, exploration: false, candidateCount: 0, relaxations: [], signalCoverage: [], scoreParts: null, weight: null, albumOrdering: null };
    if (request.direction === 'previous') {
      for (let i = state.cursor - 1; i >= 0; i -= 1) if (allowed(state.history[i].entryId, true)) { historyIndex = i; break; }
      if (historyIndex != null) { entry = byId.get(state.history[historyIndex].entryId); kind = 'previous'; }
    } else {
      if (request.entryId != null) {
        id(request.entryId, 'entryId');
        if (!allowed(request.entryId, true)) return { ...next, paused: true };
        entry = byId.get(request.entryId); kind = 'play-now';
      }
      if (!entry) { manualIndex = state.manual.findIndex((item) => item.position === 0 && allowed(item.entryId, true)); if (manualIndex >= 0) { entry = byId.get(state.manual[manualIndex].entryId); kind = 'manual'; } }
      if (!entry && request.naturalEnd === true && state.repeat === 'one' && current && allowed(current.entryId, true)) { entry = current; kind = 'repeat-one'; }
      if (!entry && state.cursor + 1 < state.history.length) { for (let i = state.cursor + 1; i < state.history.length; i += 1) if (allowed(state.history[i].entryId, true) && !state.manual.some((item) => item.entryId === state.history[i].entryId)) { historyIndex = i; entry = byId.get(state.history[i].entryId); kind = 'forward'; break; } }
      if (!entry) {
        const reserved = new Set(state.manual.filter((item) => item.position > 0 && allowed(item.entryId, true)).map((item) => item.entryId));
        let remaining = state.remaining.filter((entryId) => allowed(entryId) && !reserved.has(entryId));
        // If the future has fewer offers than an explicit target position,
        // append the user's moved entry rather than stranding it forever.
        if (!remaining.length && reserved.size) {
          manualIndex = state.manual.findIndex((item) => allowed(item.entryId, true));
          entry = byId.get(state.manual[manualIndex].entryId); kind = 'manual';
        }
        // Inaccessible or excluded entitlements remain recoverable and block
        // automatic cycle rollover, even when there is presently no offer.
        if (!remaining.length && !state.remaining.length && state.repeat === 'all' && state.entries.length) { remaining = state.entries.filter((e) => allowed(e.entryId)).map((e) => e.entryId); newCycle = remaining.length > 0; }
        const eligible = remaining.map((entryId) => byId.get(entryId));
        reason.candidateCount = eligible.length;
        if (!entry && eligible.length) {
          const allowedSet = new Set(remaining);
          if (state.mode === 'album' || state.mode === 'flow' && state.options.preserveAlbumRuns) {
            // One early skip moves to the next track; a second early skip on the
            // same album leaves it for another album when one remains.
            const leaveAlbum = lane === 'live' && skip === 'early' && current?.albumId != null && state.lanes.lastEarlyAlbumId === current.albumId;
            const locked = leaveAlbum ? null : state.albumLock?.entryIds.find((entryId) => allowedSet.has(entryId));
            if (locked && !newCycle) { entry = byId.get(locked); kind = 'album-continuation'; reason.albumOrdering = state.albumLock.ordering; }
            else {
              const groups = new Map();
              for (const e of eligible) { const key = e.albumId == null ? JSON.stringify(['entry', e.entryId]) : JSON.stringify(['album', e.albumId]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); }
              let keys = [...groups.keys()].sort(ordinal);
              if (leaveAlbum && keys.length > 1) keys = keys.filter((key) => key !== JSON.stringify(['album', current.albumId]));
              const choice = bounded(state.rng, keys.length); rngAfter = choice.rng;
              const ordered = albumOrder(groups.get(keys[choice.value]));
              entry = ordered.entries[0]; albumLockAfter = { albumId: entry.albumId, entryIds: ordered.entries.map((e) => e.entryId), ordering: ordered.ordering }; reason.albumOrdering = ordered.ordering;
            }
            albumLockAfter = albumLockAfter ? { ...albumLockAfter, entryIds: albumLockAfter.entryIds.filter((entryId) => entryId !== entry.entryId) } : null;
            if (albumLockAfter && !albumLockAfter.entryIds.length) albumLockAfter = null;
          } else if (state.mode === 'off') { const retained = state.generatedFuture.filter((entryId) => allowedSet.has(entryId)); entry = retained.length ? byId.get(retained[0]) : eligible.slice().sort((a, b) => a.sourceIndex - b.sourceIndex)[0]; futureAfter = retained.slice(1); }
          else {
            lanesAfter = nextLanes(state, current, skip, true, nowMs);
            const pinned = newCycle ? [] : state.lanes.pinned.filter((item) => allowedSet.has(item.entryId));
            if (lane === 'base' && pinned.length) { entry = byId.get(pinned[0].entryId); reason = { ...pinned[0].reason }; }
            else {
              // The live queue never offers the base queue's next song while a
              // real alternative remains, and bridges from the last kept song.
              const pool = lane === 'live' && pinned.length && eligible.length >= CONFIG.liveExclusionMinimum ? eligible.filter((e) => e.entryId !== pinned[0].entryId) : eligible;
              const anchor = lane === 'base' ? current : state.mode === 'flow' && lanesAfter.earlyRun >= CONFIG.flowLetGoAfter ? null : byId.get(lanesAfter.anchorEntryId) || null;
              const exploration = lane === 'live' && lanesAfter.flicks >= 2 ? CONFIG.flickStormExplorationPermille : lane === 'live' && lanesAfter.flicks === 1 ? CONFIG.flickExplorationPermille : CONFIG.explorationPermille;
              const consumed = newCycle ? () => false : (entryId) => !state.remaining.includes(entryId);
              const pick = selection(state, pool, context, anchor, byId, { gain: lane === 'live' ? CONFIG.liveSteer : CONFIG.baseSteer, marks: lanesAfter.marks, ageOffset: 0, explorationPermille: exploration, airtime: airtimeContext(state, consumed), multiSource });
              entry = pick.entry; rngAfter = pick.rng; reason = pick.reason;
            }
            let rest = pinned.filter((item) => item.entryId !== entry.entryId);
            if (skip === 'early') rest = rest.filter((item) => similarity(byId.get(item.entryId), current, multiSource) < CONFIG.pruneSimilarity);
            // Refill the pinned base window as successive natural ends would pick it.
            const chain = [entry, ...rest.map((item) => byId.get(item.entryId))];
            const taken = new Set(chain.map((e) => e.entryId));
            const consumedAfter = (entryId) => taken.has(entryId) || (newCycle ? false : !state.remaining.includes(entryId));
            let available = eligible.filter((e) => !taken.has(e.entryId));
            let rng = rngAfter;
            while (rest.length < CONFIG.pinnedBase && available.length) {
              const history = [...state.history.slice(0, state.cursor + 1), ...chain.map((e) => ({ entryId: e.entryId, artistId: e.artistId, albumId: e.albumId, recordingId: e.recordingId }))];
              const preview = { ...state, rng, history, cursor: history.length - 1 };
              const pick = selection(preview, available, context, chain[chain.length - 1], byId, { gain: CONFIG.baseSteer, marks: lanesAfter.marks, ageOffset: chain.length, explorationPermille: CONFIG.explorationPermille, airtime: airtimeContext(state, consumedAfter), multiSource });
              rng = pick.rng;
              rest = [...rest, { entryId: pick.entry.entryId, reason: { ...pick.reason, lane: 'base', skip: null } }];
              chain.push(pick.entry); taken.add(pick.entry.entryId);
              available = available.filter((e) => e.entryId !== pick.entry.entryId);
            }
            rngAfter = rng; pinnedAfter = rest; futureAfter = [];
          }
        }
      }
    }
    if (!entry) return { ...next, paused: true };
    if (['manual', 'play-now', 'previous', 'forward', 'repeat-one', 'album-continuation'].includes(kind)) reason.strategy = kind;
    if (['manual', 'play-now'].includes(kind)) {
      futureAfter = []; albumLockAfter = null;
      if ((state.mode === 'album' || state.mode === 'flow' && state.options.preserveAlbumRuns) && entry.albumId != null) {
        const siblings = albumOrder(state.entries.filter((e) => e.albumId === entry.albumId));
        const index = siblings.entries.findIndex((e) => e.entryId === entry.entryId);
        const later = siblings.entries.slice(index + 1).filter((e) => state.remaining.includes(e.entryId) && allowed(e.entryId)).map((e) => e.entryId);
        if (later.length) albumLockAfter = { albumId: entry.albumId, entryIds: later, ordering: siblings.ordering };
        reason.albumOrdering = siblings.ordering;
      }
    }
    if (lanesAfter === state.lanes && kind !== 'previous' && kind !== 'forward') lanesAfter = nextLanes(state, current, ['manual', 'repeat-one', 'album-continuation', 'automatic'].includes(kind) ? skip : null, true, nowMs);
    if (pinnedAfter === state.lanes.pinned) pinnedAfter = state.lanes.pinned.filter((item) => item.entryId !== entry.entryId);
    lanesAfter = { ...lanesAfter, pinned: pinnedAfter };
    const decisionId = JSON.stringify([state.sessionId, state.revision, state.membershipRevision, state.authorityEpoch, entry.entryId, kind]);
    const receipt = { version: VERSION, policyVersion: POLICY_VERSION, configVersion: CONFIG.version, decisionId, scopeId: state.scopeId, cycleId: newCycle ? JSON.stringify([state.scopeId, state.cycle.generation + 1]) : state.cycle.cycleId,
      mode: state.mode, preset: state.options.preset, kind, entryId: entry.entryId, trackId: entry.trackId,
      originEntryId: currentHistory?.entryId || null, originOccurrenceId: currentHistory?.occurrenceId || null,
      explicitException: ['play-now', 'manual', 'repeat-one', 'previous', 'forward'].includes(kind), intentionalDuplicate: state.entries.some((e) => e.trackId === entry.trackId && e.entryId !== entry.entryId), ...reason, lane, skip };
    return { ...next, pending: { version: VERSION, attemptId, advanceId, decisionId, revision: state.revision, membershipRevision: state.membershipRevision, authorityId: state.authorityId, authorityEpoch: state.authorityEpoch,
      entryId: entry.entryId, trackId: entry.trackId, kind, lane, historyIndex, newCycle, rngAfter, futureAfter, albumLockAfter, lanesAfter, manualIndex, receipt } };
  }
  // What each queue would play now, without reserving or consuming anything.
  function preview(state, request = {}, context = {}) {
    const staged = stage({ ...state, pending: null }, { attemptId: JSON.stringify(['lane-preview', state.revision, request.lane || 'base']), personal: false, ...request }, context);
    return staged.pending ? staged.pending.receipt : null;
  }
  function matches(state, activation) {
    const p = state.pending;
    return Boolean(p && activation.attemptId === p.attemptId && activation.decisionId === p.decisionId && activation.authorityId === p.authorityId && activation.authorityEpoch === p.authorityEpoch && state.authorityId === p.authorityId && state.authorityEpoch === p.authorityEpoch && state.revision === p.revision && state.membershipRevision === p.membershipRevision);
  }
  function commit(state, activation) {
    requireState(state);
    if (!matches(state, activation)) return state;
    const p = state.pending;
    const entry = state.entries.find((e) => e.entryId === p.entryId);
    if (!entry || !entry.available) return state;
    const navigation = p.historyIndex != null;
    const sequence = navigation ? state.occurrenceSequence : state.occurrenceSequence + 1;
    const occurrence = { occurrenceId: JSON.stringify([state.sessionId, sequence]), entryId: entry.entryId, trackId: entry.trackId, artistId: entry.artistId, albumId: entry.albumId, recordingId: entry.recordingId,
      decisionId: p.decisionId, kind: p.kind, tombstone: false, receipt: p.receipt };
    const history = navigation ? state.history : [...state.history.slice(0, state.cursor + 1), occurrence];
    const consumeLegacyForward = navigation && p.kind === 'forward' && state.history[p.historyIndex].kind === 'legacy-import';
    const consume = !navigation && p.kind !== 'repeat-one' || consumeLegacyForward;
    const remaining = p.newCycle ? state.entries.map((e) => e.entryId) : state.remaining;
    return { ...state, revision: state.revision + 1, cycle: p.newCycle ? { generation: state.cycle.generation + 1, cycleId: JSON.stringify([state.scopeId, state.cycle.generation + 1]) } : state.cycle,
      rng: p.rngAfter, remaining: consume ? remaining.filter((entryId) => entryId !== entry.entryId) : remaining,
      history, cursor: navigation ? p.historyIndex : history.length - 1, occurrenceSequence: sequence,
      generatedFuture: p.futureAfter, albumLock: p.albumLockAfter, lanes: p.lanesAfter,
      manual: state.manual.filter((_, index) => !(p.kind === 'manual' && index === p.manualIndex)).map((item) => ({ ...item, position: p.kind === 'previous' || p.kind === 'repeat-one' ? item.position : Math.max(0, item.position - 1) })),
      pending: null, quarantine: { advanceId: null, entryIds: [] }, undo: null, paused: false, lastConfirmedPositionMs: integer(activation.positionMs, 0, Number.MAX_SAFE_INTEGER, 0) };
  }
  function abort(state, activation = {}) {
    requireState(state);
    if (!matches(state, activation)) return state;
    const p = state.pending;
    return { ...state, revision: state.revision + 1, pending: null, paused: true, quarantine: { advanceId: p.advanceId, entryIds: unique([...state.quarantine.entryIds, p.entryId]), lane: p.lane, skip: p.receipt.skip }, diagnostics: unique([...state.diagnostics, 'activation-failed']) };
  }
  function invalidate(state, changes) { return { ...state, ...changes, revision: state.revision + 1, pending: null }; }
  function mutate(state, action) {
    requireState(state);
    const snapshot = () => ({ entries: state.entries, remaining: state.remaining, manual: state.manual, exclusions: state.exclusions, generatedFuture: state.generatedFuture, albumLock: state.albumLock, membershipRevision: state.membershipRevision });
    if (action.type === 'undo') return state.undo ? invalidate(state, { ...state.undo, lanes: { ...state.lanes, pinned: [], marks: state.lanes.marks.filter((mark) => state.undo.entries.some((e) => e.entryId === mark.entryId)) }, membershipRevision: state.membershipRevision + 1, undo: null, history: state.history.map((h) => ({ ...h, tombstone: !state.undo.entries.some((e) => e.entryId === h.entryId) })) }) : state;
    if (action.type === 'priority' || action.type === 'move') {
      id(action.entryId, 'entryId');
      if (!state.entries.some((e) => e.entryId === action.entryId)) return state;
      const rest = state.manual.filter((item) => item.entryId !== action.entryId).map((item) => ({ ...item }));
      const index = action.type === 'priority' ? 0 : integer(action.index, 0, state.entries.length, state.entries.length);
      const item = { entryId: action.entryId, kind: action.type, intentId: id(action.intentId, 'intentId'), position: index };
      for (const prior of rest) if (prior.position >= index) prior.position += 1;
      rest.push(item); rest.sort((a, b) => a.position - b.position);
      return invalidate(state, { manual: rest, generatedFuture: [], albumLock: null, lanes: { ...state.lanes, pinned: [] }, undo: snapshot() });
    }
    if (action.type === 'exclude' || action.type === 'include') {
      id(action.entryId, 'entryId');
      if (!state.entries.some((entry) => entry.entryId === action.entryId)) return state;
      const exclusions = action.type === 'exclude' ? unique([...state.exclusions, id(action.entryId)]) : state.exclusions.filter((entryId) => entryId !== action.entryId);
      return invalidate(state, { exclusions, lanes: { ...state.lanes, pinned: state.lanes.pinned.filter((item) => !exclusions.includes(item.entryId)) }, undo: snapshot() });
    }
    if (action.type === 'clear') return reconcile(state, [], { membershipRevision: state.membershipRevision + 1 });
    if (action.type === 'remove') return reconcile(state, state.entries.filter((e) => e.entryId !== action.entryId), { membershipRevision: state.membershipRevision + 1 });
    if (action.type === 'insert') {
      const entries = state.entries.slice(); entries.splice(integer(action.index, 0, entries.length, entries.length), 0, action.entry);
      return reconcile(state, entries, { membershipRevision: state.membershipRevision + 1 });
    }
    throw new TypeError('Unknown mutation');
  }
  function reconcile(state, rawEntries, options = {}) {
    requireState(state);
    const entries = normalizeEntries(rawEntries), ids = new Set(entries.map((e) => e.entryId)), previous = new Set(state.entries.map((e) => e.entryId));
    const before = { entries: state.entries, remaining: state.remaining, manual: state.manual, exclusions: state.exclusions, generatedFuture: state.generatedFuture, albumLock: state.albumLock, membershipRevision: state.membershipRevision };
    // An entryId cannot silently be rebound to a different catalog item.
    const prior = new Map([...state.history, ...state.entries].map((e) => [e.entryId, e.trackId]));
    for (const entry of entries) if (prior.has(entry.entryId) && prior.get(entry.entryId) !== entry.trackId) throw new TypeError('entryId trackId rebinding');
    return invalidate(state, { entries, remaining: [...state.remaining.filter((entryId) => ids.has(entryId)), ...entries.filter((e) => !previous.has(e.entryId)).map((e) => e.entryId)],
      membershipRevision: integer(options.membershipRevision, state.membershipRevision + 1, Number.MAX_SAFE_INTEGER, state.membershipRevision + 1),
      history: state.history.map((h) => ({ ...h, tombstone: !ids.has(h.entryId) })), manual: state.manual.filter((item) => ids.has(item.entryId)), exclusions: state.exclusions.filter((entryId) => ids.has(entryId)), generatedFuture: [],
      albumLock: state.albumLock ? { ...state.albumLock, entryIds: state.albumLock.entryIds.filter((entryId) => ids.has(entryId)) } : null, quarantine: { advanceId: null, entryIds: [] }, undo: before,
      lanes: { ...state.lanes, pinned: [], marks: state.lanes.marks.filter((mark) => ids.has(mark.entryId)), anchorEntryId: ids.has(state.lanes.anchorEntryId) ? state.lanes.anchorEntryId : null } });
  }
  function setMode(state, mode, options, context = {}) {
    requireState(state);
    const normalized = normalizeMode(mode);
    const future = normalized === 'off' ? project(state, { horizon: Math.min(CONFIG.maxHorizon, state.remaining.length), context }).entryIds : [];
    // Off freezes the previewed future in its shown order; the remaining source
    // tail stays eligible. No entitlement or current/history reset. Session
    // marks survive a mode change; the pinned base window is drawn again.
    const frozen = normalized === 'off' ? unique([...future, ...state.generatedFuture, ...state.remaining]) : [];
    return invalidate(state, { mode: normalized, options: options ? normalizeOptions(options) : state.options, generatedFuture: frozen, albumLock: null, lanes: { ...state.lanes, pinned: [] } });
  }
  function newCycle(state) {
    requireState(state);
    return invalidate(state, { cycle: { generation: state.cycle.generation + 1, cycleId: JSON.stringify([state.scopeId, state.cycle.generation + 1]) }, remaining: state.entries.map((e) => e.entryId), generatedFuture: [], exclusions: [], albumLock: null, quarantine: { advanceId: null, entryIds: [] }, lanes: { ...state.lanes, pinned: [] } });
  }
  // v2.1 sessions keep their history, entitlement and cycle. Random becomes
  // Balanced, and the two queues start empty.
  function upgradeV21(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 2 || snapshot.policyVersion !== PRIOR_POLICY_VERSION || snapshot.configVersion !== 1) return null;
    const random = snapshot.mode === 'random';
    return { ...clone(snapshot), schemaVersion: VERSION, policyVersion: POLICY_VERSION, configVersion: CONFIG.version, mode: normalizeMode(snapshot.mode),
      entries: normalizeEntries(snapshot.entries || []), options: normalizeOptions(snapshot.options || {}), generatedFuture: random ? [] : snapshot.generatedFuture, lanes: emptyLanes(), pending: null };
  }
  function restore(snapshot) {
    let upgraded = null;
    try { upgraded = upgradeV21(snapshot); if (upgraded) validateState(upgraded); } catch (error) { return { status: 'corrupt', state: null, preserved: clone(snapshot), diagnostics: [error.message] }; }
    if (upgraded) {
      return { status: 'restored', state: { ...upgraded, paused: true, undo: null, quarantine: { advanceId: null, entryIds: [] } }, preserved: null, diagnostics: ['upgraded-from-v2.1', ...(snapshot.pending ? ['unconfirmed-activation-aborted'] : [])] };
    }
    if (!snapshot || snapshot.schemaVersion !== VERSION || snapshot.policyVersion !== POLICY_VERSION || snapshot.configVersion !== CONFIG.version) return { status: 'unsupported', state: null, preserved: clone(snapshot ?? null), diagnostics: ['unsupported-schema-policy-or-config'] };
    try {
      validateState(snapshot);
      return { status: 'restored', state: { ...clone(snapshot), pending: null, paused: true, undo: null, quarantine: { advanceId: null, entryIds: [] } }, preserved: null, diagnostics: snapshot.pending ? ['unconfirmed-activation-aborted'] : [] };
    } catch (error) { return { status: 'corrupt', state: null, preserved: clone(snapshot), diagnostics: [error.message] }; }
  }
  function validateState(state) {
    requireState(state); id(state.sessionId); id(state.scopeId); id(state.authorityId);
    const entries = normalizeEntries(state.entries), ids = new Set(entries.map((e) => e.entryId)), tracksByEntry = new Map(entries.map((e) => [e.entryId, e.trackId]));
    if (canonicalJson(entries) !== canonicalJson(state.entries)) throw new TypeError('Noncanonical or corrupt entries');
    if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.membershipRevision) || state.membershipRevision < 0 || !Number.isSafeInteger(state.authorityEpoch) || state.authorityEpoch < 0) throw new TypeError('Invalid state revisions');
    if (!Array.isArray(state.remaining) || state.remaining.some((entryId) => !ids.has(entryId)) || new Set(state.remaining).size !== state.remaining.length) throw new TypeError('Invalid remaining entitlement');
    if (!Array.isArray(state.history) || !Number.isInteger(state.cursor) || state.cursor < -1 || state.cursor >= state.history.length) throw new TypeError('Invalid history cursor');
    for (const h of state.history) {
      if (typeof h.occurrenceId !== 'string' || h.occurrenceId.length < 1 || h.occurrenceId.length > 16384) throw new TypeError('Invalid occurrenceId');
      id(h.entryId); id(h.trackId);
      if (typeof h.tombstone !== 'boolean' || typeof h.kind !== 'string' || tracksByEntry.has(h.entryId) && tracksByEntry.get(h.entryId) !== h.trackId) throw new TypeError('Corrupt history identity');
    }
    if (new Set(state.history.map((h) => h.occurrenceId)).size !== state.history.length) throw new TypeError('Duplicate occurrenceId');
    if (state.rng?.algorithm !== 'fnv1a-utf16-mulberry32-fy-v1' || !Number.isInteger(state.rng.state) || state.rng.state < 0 || state.rng.state > 4294967295 || !Number.isSafeInteger(state.rng.draws) || state.rng.draws < 0) throw new TypeError('Invalid RNG');
    for (const field of ['manual', 'exclusions', 'generatedFuture', 'eventSequences', 'diagnostics']) if (!Array.isArray(state[field])) throw new TypeError(`Invalid ${field}`);
    for (const field of ['exclusions', 'generatedFuture']) if (state[field].some((entryId) => !ids.has(entryId)) || new Set(state[field]).size !== state[field].length) throw new TypeError(`Corrupt ${field}`);
    for (const item of state.manual) { id(item.entryId); id(item.intentId); if (!ids.has(item.entryId) || !['priority', 'move'].includes(item.kind) || !Number.isSafeInteger(item.position) || item.position < 0) throw new TypeError('Corrupt manual intent'); }
    if (new Set(state.manual.map((item) => item.entryId)).size !== state.manual.length) throw new TypeError('Duplicate manual entry');
    if (!state.options || canonicalJson(state.options) !== canonicalJson(normalizeOptions(state.options))) throw new TypeError('Corrupt options');
    if (!state.quarantine || !Array.isArray(state.quarantine.entryIds) || state.quarantine.entryIds.some((entryId) => !ids.has(entryId))) throw new TypeError('Corrupt quarantine');
    if (state.albumLock && (!Array.isArray(state.albumLock.entryIds) || state.albumLock.entryIds.some((entryId) => !ids.has(entryId)) || !['disc-track', 'source-order-missing-numbers'].includes(state.albumLock.ordering))) throw new TypeError('Corrupt album lock');
    if (!Number.isSafeInteger(state.lastConfirmedPositionMs) || state.lastConfirmedPositionMs < 0 || !Number.isSafeInteger(state.occurrenceSequence) || state.occurrenceSequence < state.history.length || typeof state.paused !== 'boolean') throw new TypeError('Corrupt playback position/sequence');
    for (const row of state.eventSequences) { id(row.producerId); id(row.eventId); if (!Number.isSafeInteger(row.sequence) || row.sequence < 1) throw new TypeError('Corrupt producer sequence'); }
    if (state.eventSequences.length > 64 || new Set(state.eventSequences.map((row) => row.producerId)).size !== state.eventSequences.length) throw new TypeError('Corrupt producer table');
    if (state.pending && (!matches(state, state.pending) || !ids.has(state.pending.entryId) || !state.pending.receipt || state.pending.receipt.entryId !== state.pending.entryId)) throw new TypeError('Corrupt pending reservation');
    if (!MODES.includes(state.mode) || !['off', 'all', 'one'].includes(state.repeat) || !Number.isSafeInteger(state.cycle?.generation) || state.cycle.generation < 0) throw new TypeError('Invalid mode/repeat/cycle');
    const lanes = state.lanes, count = (value) => Number.isSafeInteger(value) && value >= 0;
    if (!lanes || !Array.isArray(lanes.marks) || !Array.isArray(lanes.pinned) || !count(lanes.flicks) || !count(lanes.earlyRun) || lanes.marks.length > CONFIG.maxMarks || lanes.pinned.length > CONFIG.pinnedBase) throw new TypeError('Corrupt lanes');
    const markValues = [CONFIG.earlyMark, CONFIG.midMark, CONFIG.lateMark, CONFIG.finishMark];
    for (const mark of lanes.marks) if (!ids.has(mark.entryId) || !markValues.includes(mark.mark) || !count(mark.songs) || mark.songs >= CONFIG.markMaxSongs || !count(mark.atMs)) throw new TypeError('Corrupt session mark');
    if (lanes.pinned.some((item) => !ids.has(item.entryId) || !item.reason || typeof item.reason !== 'object') || new Set(lanes.pinned.map((item) => item.entryId)).size !== lanes.pinned.length) throw new TypeError('Corrupt pinned base queue');
    if (lanes.anchorEntryId != null && !ids.has(lanes.anchorEntryId) || lanes.lastEarlyAlbumId != null && typeof lanes.lastEarlyAlbumId !== 'string') throw new TypeError('Corrupt lane anchors');
    return true;
  }
  function createProjection(state, options = {}) {
    requireState(state);
    return { originRevision: state.revision, originGeneration: state.cycle.generation, horizon: integer(options.horizon, 0, CONFIG.maxHorizon, CONFIG.horizon), state, decisions: [], done: false };
  }
  function advanceProjection(batch, context = {}) {
    if (batch.done || batch.decisions.length >= batch.horizon || context.cancelled === true) return { ...batch, done: true };
    const staged = batch.state.pending ? batch.state : stage(batch.state, { attemptId: JSON.stringify(['preview', batch.originRevision, batch.decisions.length]), advanceId: 'preview' }, context);
    if (!staged.pending) return { ...batch, done: true };
    const state = commit(staged, staged.pending), decisions = [...batch.decisions, staged.pending.receipt];
    return { ...batch, state, decisions, done: decisions.length >= batch.horizon || state.cycle.generation !== batch.originGeneration };
  }
  function project(state, options = {}) {
    let batch = createProjection(state, options);
    while (!batch.done) batch = advanceProjection(batch, options.context || {});
    return { revision: state.revision, entryIds: batch.decisions.map((d) => d.entryId), decisions: batch.decisions };
  }
  function publicSnapshot(state, mapIds, context) {
    requireState(state);
    if (!mapIds || typeof mapIds !== 'object' || !context || typeof context !== 'object') throw new TypeError('Explicit public identity mappers and authority scoring context required');
    const mapped = (kind, value) => {
      if (value == null) return null;
      if (typeof mapIds[kind] !== 'function') throw new TypeError(`Public ${kind} mapper required`);
      const result = mapIds[kind](value);
      if (result == null) return null;
      if (typeof result !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(result)) throw new TypeError(`Unsafe public ${kind}`);
      return result;
    };
    const current = currentOccurrence(state);
    return { version: VERSION, policyVersion: POLICY_VERSION, authorityId: mapped('authorityId', state.authorityId), authorityEpoch: state.authorityEpoch, revision: state.revision, mode: state.mode, repeat: state.repeat, paused: state.paused,
      current: current && mapped('trackId', current.trackId) ? { occurrenceId: mapped('occurrenceId', current.occurrenceId), entryId: mapped('entryId', current.entryId), trackId: mapped('trackId', current.trackId) } : null,
      future: project(state, { context }).decisions.map((d) => ({ decisionId: mapped('decisionId', d.decisionId), entryId: mapped('entryId', d.entryId), trackId: mapped('trackId', d.trackId), kind: d.kind })).filter((d) => d.trackId != null && d.entryId != null) };
  }
  function migrateLegacy(legacy, input) {
    const state = createSession({ ...input, mode: input.mode ?? (legacy.plan?.style === 'standard' ? 'balanced' : legacy.mode === 'AlbumPreserving' ? 'album' : 'flow'), seed: input.seed ?? legacy.plan?.seed });
    const byTrack = new Map(); for (const entry of state.entries) if (!byTrack.has(entry.trackId)) byTrack.set(entry.trackId, entry);
    const order = Array.isArray(legacy.plan?.order) ? legacy.plan.order : Array.isArray(legacy.history) ? legacy.history : [];
    const history = order.map((trackId, index) => { const entry = byTrack.get(trackId); return { occurrenceId: JSON.stringify([state.sessionId, index + 1]), entryId: entry?.entryId || JSON.stringify(['legacy-tombstone', index]), trackId: id(String(trackId)), artistId: entry?.artistId || null, albumId: entry?.albumId || null, recordingId: entry?.recordingId || null, decisionId: null, kind: 'legacy-import', tombstone: !entry, receipt: null }; });
    const cursor = integer(legacy.plan?.cursor, -1, history.length - 1, history.length - 1);
    const consumed = new Set(history.slice(0, cursor + 1).map((h) => h.entryId));
    return { ...state, history, cursor, occurrenceSequence: history.length, remaining: state.remaining.filter((entryId) => !consumed.has(entryId)), generatedFuture: history.slice(cursor + 1).filter((h) => !h.tombstone).map((h) => h.entryId), imported: true, diagnostics: ['legacy-traversal-only-no-listening-evidence'] };
  }
  function applyEvent(state, event, context = {}) {
    requireState(state);
    switch (event.type) {
      case 'stage': return stage(state, event, context);
      case 'activate-success': return commit(state, event);
      case 'activate-failure': return abort(state, event);
      case 'mutation': return mutate(state, event.action);
      case 'mode-change': return setMode(state, event.mode, event.options, context);
      case 'repeat-change': return invalidate(state, { repeat: ['off', 'all', 'one'].includes(event.repeat) ? event.repeat : 'off' });
      case 'explicit-new-cycle': return newCycle(state);
      case 'reshuffle-remaining': return invalidate(state, { generatedFuture: [], albumLock: null, lanes: { ...state.lanes, pinned: [] } });
      case 'membership-change': return reconcile(state, event.entries, event);
      case 'session-change': return invalidate(state, { sessionId: id(event.sessionId), exclusions: [], pending: null, paused: true, quarantine: { advanceId: null, entryIds: [] }, lanes: emptyLanes() });
      case 'position-checkpoint': return currentOccurrence(state)?.occurrenceId === event.occurrenceId ? { ...state, lastConfirmedPositionMs: integer(event.positionMs, 0, Number.MAX_SAFE_INTEGER, state.lastConfirmedPositionMs) } : state;
      case 'restore': return restore(state).state;
      case 'authority-change': {
        if (!Number.isSafeInteger(event.authorityEpoch) || event.authorityEpoch <= state.authorityEpoch) return state;
        return invalidate(state, { authorityId: id(event.authorityId), authorityEpoch: event.authorityEpoch, paused: true });
      }
      default: throw new TypeError('Unknown session event');
    }
  }
  function reduce(state, event, context = {}) {
    requireState(state);
    if (event.eventId == null) return applyEvent(state, event, context);
    id(event.eventId, 'eventId'); id(event.producerId, 'producerId');
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new TypeError('Versioned event requires positive producer sequence');
    const prior = state.eventSequences.find((row) => row.producerId === event.producerId);
    if (prior && event.sequence <= prior.sequence) return state;
    if (event.sequence !== (prior?.sequence || 0) + 1) throw new TypeError('Producer sequence gap; replay missing commands in order');
    if (!prior && state.eventSequences.length >= 64) throw new RangeError('Producer capacity exceeded; compact authority checkpoint required');
    const changed = applyEvent(state, event, context);
    return { ...changed, eventSequences: [...state.eventSequences.filter((row) => row.producerId !== event.producerId), { producerId: event.producerId, sequence: event.sequence, eventId: event.eventId }].sort((a, b) => ordinal(a.producerId, b.producerId)) };
  }
  return Object.freeze({ VERSION, POLICY_VERSION, PRIOR_POLICY_VERSION, CONFIG, MODES, LANES, SKIPS, similarity, preview, PRESETS, PROVENANCE, ordinal, canonicalJson, textIdentity, normalizeMode, normalizeEntry, normalizeEntries, parseKey, hashSeed, createRng, draw, bounded, permutation,
    createSession, stage, commit, abort, mutate, reconcile, setMode, newCycle, currentOccurrence, validateState, restore, createProjection, advanceProjection, project, publicSnapshot, migrateLegacy, reduce });
}));
