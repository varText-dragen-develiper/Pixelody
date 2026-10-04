(function dailyCuratedFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyDailyCurated = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDailyCurated() {
  'use strict';

  const VERSION = 1;
  const REDISCOVERY_RECIPE = 'rediscovery';
  const COLLECTION_PREFIX = 'daily:';
  const MAX_STORED_MIXES = 8;
  const DEFAULT_TRACK_COUNT = 24;
  const normalizeId = (value) => String(value || '').trim();
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const uniqueIds = (values = []) => [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];
  const dayKey = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    const valid = Number.isFinite(date.getTime()) ? date : new Date();
    return `${valid.getFullYear()}-${String(valid.getMonth() + 1).padStart(2, '0')}-${String(valid.getDate()).padStart(2, '0')}`;
  };
  const hash = (value = '') => {
    let result = 2166136261;
    for (const character of String(value)) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  const seededValue = (seed, id) => Number.parseInt(hash(`${seed}|${id}`), 36) / 0xffffffff;
  const collectionId = (recipe = REDISCOVERY_RECIPE) => `${COLLECTION_PREFIX}${recipe}`;
  const isCollectionId = (value = '') => String(value || '').startsWith(COLLECTION_PREFIX);
  const recipeFromCollectionId = (value = '') => isCollectionId(value) ? String(value).slice(COLLECTION_PREFIX.length) : '';
  const trackDuration = (track = {}) => Number.isFinite(Number(track.duration)) && Number(track.duration) > 0 ? Number(track.duration) : 0;

  function normalizeMix(value = {}) {
    if (!value || typeof value !== 'object') return null;
    const recipeKey = normalizeId(value.recipeKey || value.recipe);
    const createdDate = normalizeId(value.dateKey);
    if (!recipeKey || !createdDate) return null;
    return {
      id: normalizeId(value.id) || `${collectionId(recipeKey)}:${createdDate}`,
      dateKey: createdDate,
      recipeKey,
      recipeVersion: Math.max(1, Number(value.recipeVersion) || VERSION),
      seed: normalizeId(value.seed) || hash(`${createdDate}|${recipeKey}`),
      libraryFingerprint: normalizeId(value.libraryFingerprint),
      trackIds: uniqueIds(value.trackIds),
      createdAt: normalizeId(value.createdAt),
      explanationReceipt: value.explanationReceipt && typeof value.explanationReceipt === 'object' ? value.explanationReceipt : {},
      artworkRecipe: value.artworkRecipe && typeof value.artworkRecipe === 'object' ? value.artworkRecipe : {},
      savedPlaylistId: normalizeId(value.savedPlaylistId),
    };
  }

  function normalizeState(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const mixes = Object.values(source.mixes && typeof source.mixes === 'object' ? source.mixes : {})
      .map(normalizeMix)
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt || right.dateKey).localeCompare(String(left.createdAt || left.dateKey)))
      .slice(0, MAX_STORED_MIXES);
    return {
      version: VERSION,
      mixes: Object.fromEntries(mixes.map((mix) => [`${mix.recipeKey}:${mix.dateKey}`, mix])),
    };
  }

  function libraryFingerprint(tracks = []) {
    const parts = (Array.isArray(tracks) ? tracks : [])
      .filter((track) => normalizeId(track?.id))
      .map((track) => [normalizeId(track.id), track.missing ? 'missing' : 'available', Math.round(trackDuration(track))].join(':'))
      .sort();
    return hash(parts.join('|'));
  }

  function lastPlayedByTrack(history = [], trackStats = {}) {
    const latest = new Map();
    (Array.isArray(history) ? history : []).forEach((entry) => {
      const id = normalizeId(entry?.id);
      const stamp = new Date(entry?.playedAt || 0).getTime();
      if (id && Number.isFinite(stamp) && (!latest.has(id) || latest.get(id) < stamp)) latest.set(id, stamp);
    });
    Object.entries(trackStats && typeof trackStats === 'object' ? trackStats : {}).forEach(([id, stats]) => {
      const stamp = new Date(stats?.lastPlayedAt || 0).getTime();
      if (normalizeId(id) && Number.isFinite(stamp) && (!latest.has(id) || latest.get(id) < stamp)) latest.set(id, stamp);
    });
    return latest;
  }

  function rediscoveryCandidates(options = {}) {
    const tracks = (Array.isArray(options.tracks) ? options.tracks : []).filter((track) => normalizeId(track?.id) && !track.missing);
    const favorites = new Set(uniqueIds(options.favorites));
    const lastPlayed = lastPlayedByTrack(options.history, options.trackStats);
    const now = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const seed = normalizeId(options.seed) || hash(`${dayKey(options.now)}|${REDISCOVERY_RECIPE}`);
    return tracks.map((track) => {
      const stamp = lastPlayed.get(track.id) || 0;
      const daysAway = stamp ? Math.max(0, (now - stamp) / 86400000) : 120;
      const familiarity = stamp ? 'returning' : 'unheard';
      // This score belongs only to the Daily Curated recipe. It is deliberately
      // separate from Flow Shuffle's learned weighting and persisted plan state.
      const score = Math.round(Math.min(72, daysAway) + (familiarity === 'unheard' ? 18 : 0) + (favorites.has(track.id) ? 5 : 0));
      return { track, score, familiarity, daysAway, tieBreak: seededValue(seed, track.id) };
    }).sort((left, right) => right.score - left.score || right.tieBreak - left.tieBreak || String(left.track.id).localeCompare(String(right.track.id)));
  }

  function receiptFor(trackIds = [], candidates = [], tracks = []) {
    const byId = new Map(candidates.map((candidate) => [candidate.track.id, candidate]));
    const selected = trackIds.map((id) => byId.get(id)).filter(Boolean);
    const totalDuration = trackIds.reduce((total, id) => total + trackDuration(tracks.find((track) => track.id === id)), 0);
    const unheard = selected.filter((candidate) => candidate.familiarity === 'unheard').length;
    const returning = selected.length - unheard;
    const metadataReady = selected.filter((candidate) => candidate.track.artist && candidate.track.title).length;
    return {
      source: 'local-library',
      summary: selected.length ? `Built from your local library: ${unheard} unplayed and ${returning} long-unheard return${returning === 1 ? '' : 's'}.` : 'No playable local tracks are available yet.',
      signals: ['Local listening history', 'Favorites', 'Flow transition and diversity planning'],
      trackCount: selected.length,
      totalDurationSeconds: totalDuration,
      metadataCoverage: selected.length ? Math.round((metadataReady / selected.length) * 100) : 0,
      unfamiliarCount: unheard,
      returningCount: returning,
      trackReasons: Object.fromEntries(selected.map((candidate) => [candidate.track.id, candidate.familiarity === 'unheard' ? 'Unplayed in your local library' : 'Long-unheard return'])),
    };
  }

  // The expensive, synchronous half of building a mix: library fingerprint,
  // seed and the ranked candidate list. Splitting it from the planner lets a
  // caller run the (much slower) planner in slices between frames.
  function prepareRediscovery(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const currentDay = dayKey(now);
    const fingerprint = libraryFingerprint(options.tracks);
    const seed = hash(`${currentDay}|${REDISCOVERY_RECIPE}|${fingerprint}`);
    const candidates = rediscoveryCandidates({ ...options, seed, now, nowMs: now.getTime() });
    const target = clamp(Math.round(Number(options.trackCount) || DEFAULT_TRACK_COUNT), 1, DEFAULT_TRACK_COUNT);
    return { currentDay, fingerprint, seed, candidates, target, count: Math.min(target, candidates.length), now };
  }

  // plannedIds are the planner's picks in order; ranked candidates fill the rest.
  function finishRediscovery(options = {}, prepared, plannedIds = []) {
    const { currentDay, fingerprint, seed, candidates, target, now } = prepared;
    const eligibleIds = new Set(candidates.map((candidate) => candidate.track.id));
    const planned = uniqueIds(plannedIds).filter((id) => eligibleIds.has(id));
    const rankedIds = candidates.map((candidate) => candidate.track.id);
    const trackIds = uniqueIds([...planned, ...rankedIds]).slice(0, Math.min(target, candidates.length));
    return {
      id: `${collectionId(REDISCOVERY_RECIPE)}:${currentDay}`,
      dateKey: currentDay,
      recipeKey: REDISCOVERY_RECIPE,
      recipeVersion: VERSION,
      seed,
      libraryFingerprint: fingerprint,
      trackIds,
      createdAt: now.toISOString(),
      explanationReceipt: receiptFor(trackIds, candidates, options.tracks),
      artworkRecipe: { kind: 'local-spectrum', seed: hash(`${seed}|artwork`), accentIndex: Number.parseInt(hash(seed), 36) % 7 },
      savedPlaylistId: '',
    };
  }

  function createRediscoveryMix(options = {}) {
    const prepared = prepareRediscovery(options);
    const planner = typeof options.plan === 'function' ? options.plan : null;
    const plannedIds = planner ? planner({ candidates: prepared.candidates, count: prepared.count, seed: prepared.seed }) : [];
    return finishRediscovery(options, prepared, plannedIds);
  }

  function todaysMix(state, options = {}) {
    const normalized = normalizeState(state);
    return normalized.mixes[`${REDISCOVERY_RECIPE}:${dayKey(options.now)}`] || null;
  }

  function storeMix(state, mix) {
    const normalized = normalizeState(state);
    const next = normalizeState({ mixes: { ...normalized.mixes, [`${mix.recipeKey}:${mix.dateKey}`]: mix } });
    return { state: next, mix: next.mixes[`${mix.recipeKey}:${mix.dateKey}`] };
  }

  function ensureToday(state, options = {}) {
    const existing = todaysMix(state, options);
    if (existing) return { state: normalizeState(state), mix: existing, created: false };
    const stored = storeMix(state, createRediscoveryMix(options));
    return { state: stored.state, mix: stored.mix, created: true };
  }

  function markSaved(state, mixId, playlistId) {
    const normalized = normalizeState(state);
    const key = Object.keys(normalized.mixes).find((candidate) => normalized.mixes[candidate].id === mixId);
    if (!key) return normalized;
    return normalizeState({ mixes: { ...normalized.mixes, [key]: { ...normalized.mixes[key], savedPlaylistId: normalizeId(playlistId) } } });
  }

  return Object.freeze({
    VERSION,
    REDISCOVERY_RECIPE,
    COLLECTION_PREFIX,
    collectionId,
    createRediscoveryMix,
    finishRediscovery,
    prepareRediscovery,
    storeMix,
    todaysMix,
    dayKey,
    ensureToday,
    isCollectionId,
    libraryFingerprint,
    markSaved,
    normalizeMix,
    normalizeState,
    recipeFromCollectionId,
    rediscoveryCandidates,
  });
}));
