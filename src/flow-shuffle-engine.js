(function flowShuffleEngineFactory(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./shuffle/universal.js') : root?.PixelodyUniversalShuffle);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffle = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleEngine(universalPolicy) {
  'use strict';

  const VERSION = 5;
  const MODES = Object.freeze(['flow', 'discovery', 'comfort', 'energy', 'genre-weave', 'deep-library']);

  function uniqueIds(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(String).filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  const occurrenceIds = (values) => (Array.isArray(values) ? values : []).filter((id) => typeof id === 'string' && id.length > 0);
  const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);

  function normalizeState(values = {}) {
    const source = values && typeof values === 'object' ? values : {};
    return {
      version: VERSION,
      mode: MODES.includes(source.mode) ? source.mode : 'flow',
      cycle: uniqueIds(source.cycle),
      history: (Array.isArray(source.history) ? source.history : []).map(String).filter(Boolean),
      lastPick: source.lastPick && typeof source.lastPick === 'object' ? source.lastPick : null,
      priorityIds: uniqueIds(source.priorityIds),
      sessionExcludedIds: uniqueIds(source.sessionExcludedIds),
      lessLikeArtistIds: uniqueIds(source.lessLikeArtistIds),
      session: {
        horizon: Math.max(5, Math.min(10, Math.round(Number(source.session?.horizon) || 6))),
        energyShape: ['auto', 'steady', 'rise', 'wave', 'wind-down'].includes(source.session?.energyShape) ? source.session.energyShape : 'auto',
        albumPolicy: source.session?.albumPolicy === 'album' ? 'album' : 'track',
        preserveAlbumRuns: Boolean(source.session?.preserveAlbumRuns),
      },
      plan: source.plan && typeof source.plan === 'object' ? {
        style: source.plan.style === 'standard' ? 'standard' : 'flow',
        seed: String(source.plan.seed || ''),
        generation: Math.max(0, Math.round(Number(source.plan.generation) || 0)),
        sourceQueueIds: uniqueIds(source.plan.sourceQueueIds),
        // order may contain real replays, e.g. A -> B -> A. Do not dedupe it.
        order: occurrenceIds(source.plan.order),
        future: uniqueIds(source.plan.future),
        cursor: Math.max(-1, Math.round(Number(source.plan.cursor) || 0)),
        committedLength: Math.max(0, Math.min(occurrenceIds(source.plan.order).length, Number.isInteger(source.plan.committedLength) ? source.plan.committedLength : source.plan.style === 'standard' ? Math.max(0, Math.round(Number(source.plan.cursor) || 0) + 1) : occurrenceIds(source.plan.order).length)),
        navigation: source.plan.navigation && typeof source.plan.navigation === 'object' ? {
          kind: ['forward', 'previous', 'priority', 'repeat', 'planned'].includes(source.plan.navigation.kind) ? source.plan.navigation.kind : '',
          fromId: String(source.plan.navigation.fromId || ''),
          trackId: String(source.plan.navigation.trackId || ''),
          fromCursor: Number.isInteger(source.plan.navigation.fromCursor) ? source.plan.navigation.fromCursor : -1,
          toCursor: Number.isInteger(source.plan.navigation.toCursor) ? source.plan.navigation.toCursor : -1,
        } : null,
        lastPlaybackAttemptId: String(source.plan.lastPlaybackAttemptId || ''),
        nextCycle: source.plan.nextCycle && typeof source.plan.nextCycle === 'object' ? {
          seed: String(source.plan.nextCycle.seed || ''),
          generation: Math.max(0, Math.round(Number(source.plan.nextCycle.generation) || 0)),
          order: uniqueIds(source.plan.nextCycle.order),
        } : null,
        albumContinuation: source.plan.albumContinuation && typeof source.plan.albumContinuation === 'object' ? {
          albumId: String(source.plan.albumContinuation.albumId || ''),
          ids: uniqueIds(source.plan.albumContinuation.ids),
          orderKnown: source.plan.albumContinuation.orderKnown === true,
        } : null,
      } : null,
    };
  }

  function planSeed(seed = '') {
    return String(seed || `flow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  function makePlan(queueIds, currentId, options = {}) {
    const ids = uniqueIds(queueIds);
    const current = String(currentId || '');
    const style = options.style === 'standard' ? 'standard' : 'flow';
    const seed = planSeed(options.seed);
    const generation = Math.max(0, Math.round(Number(options.generation) || 0));
    const available = ids.filter((id) => id !== current);
    const tail = style === 'standard' ? shuffledIds(available, createSeededRandom(seed)) : [];
    const order = current && ids.includes(current) ? [current].concat(tail) : tail;
    return { style, seed, generation, sourceQueueIds: ids, order, future: [], cursor: current && ids.includes(current) ? 0 : -1, committedLength: current && ids.includes(current) ? 1 : 0, navigation: null, lastPlaybackAttemptId: '', nextCycle: null, albumContinuation: null };
  }

  function syncToQueue(values, queueIds) {
    const state = normalizeState(values);
    const allowed = new Set(uniqueIds(queueIds));
    const sourceQueueIds = uniqueIds(queueIds);
    const queueChanged = state.plan && !sameIds(state.plan.sourceQueueIds, sourceQueueIds);
    const plan = state.plan ? {
      ...state.plan,
      sourceQueueIds,
      // Keep actual history, including unavailable tombstones and retained
      // forward history. Only an uncommitted Standard suffix can be removed.
      order: state.plan.order.filter((id, index) => index < state.plan.committedLength || allowed.has(id)),
      future: queueChanged ? [] : state.plan.future.filter((id) => allowed.has(id)),
      navigation: queueChanged ? null : state.plan.navigation,
      nextCycle: queueChanged ? null : state.plan.nextCycle,
      albumContinuation: state.plan.albumContinuation ? { ...state.plan.albumContinuation, ids: state.plan.albumContinuation.ids.filter((id) => allowed.has(id)) } : null,
    } : null;
    if (plan) plan.cursor = Math.min(plan.cursor, plan.order.length - 1);
    return {
      ...state,
      cycle: state.cycle.filter((id) => allowed.has(id)),
      history: state.history,
      priorityIds: state.priorityIds.filter((id) => allowed.has(id)),
      sessionExcludedIds: state.sessionExcludedIds.filter((id) => allowed.has(id)),
      plan,
    };
  }

  function ensurePlan(values, queueIds, currentId, options = {}) {
    const state = syncToQueue(values, queueIds);
    const current = String(currentId || '');
    if (!state.plan || (options.style && state.plan.style !== options.style)) {
      return { ...state, plan: makePlan(queueIds, current, options) };
    }
    const plan = { ...state.plan };
    let knownIndex = plan.order[plan.cursor] === current ? plan.cursor : -1;
    if (knownIndex < 0) {
      for (let index = 0; index < plan.order.length; index += 1) {
        if (plan.order[index] === current && (knownIndex < 0 || index <= plan.cursor)) knownIndex = index;
      }
    }
    if (knownIndex >= 0) plan.cursor = knownIndex;
    else if (current) {
      plan.order = plan.order.slice(0, Math.max(0, plan.cursor + 1)).concat(current);
      plan.cursor = plan.order.length - 1;
      plan.committedLength = plan.order.length;
    }
    return { ...state, plan };
  }

  function resetPlan(values, queueIds, currentId, options = {}) {
    const state = syncToQueue(values, queueIds);
    const previousGeneration = state.plan?.generation || 0;
    return {
      ...state,
      cycle: currentId ? [String(currentId)] : [],
      history: currentId ? [String(currentId)] : [],
      priorityIds: options.keepPriority ? state.priorityIds : [],
      sessionExcludedIds: options.keepSessionControls ? state.sessionExcludedIds : [],
      lessLikeArtistIds: options.keepSessionControls ? state.lessLikeArtistIds : [],
      plan: makePlan(queueIds, currentId, { ...options, generation: previousGeneration + 1 }),
    };
  }

  function markPriority(values, trackId, options = {}) {
    const state = normalizeState(values);
    const id = String(trackId || '');
    if (!id) return state;
    const priorityIds = state.priorityIds.filter((item) => item !== id);
    return { ...state, priorityIds: options.front ? [id].concat(priorityIds) : priorityIds.concat(id) };
  }

  function stageNext(values, queueIds, currentId, options = {}) {
    const ids = uniqueIds(queueIds);
    const current = String(currentId || '');
    let state = ensurePlan(values, ids, current, options);
    if (!current || !ids.length) return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
    const plan = state.plan;
    const reserve = (trackId, kind, toCursor = -1) => ({ state: { ...state, plan: { ...state.plan, navigation: { kind, fromId: current, trackId, fromCursor: state.plan.cursor, toCursor } } }, candidateIds: [], trackId, kind, stopped: false, reset: false });
    if (options.fromEnded && options.repeat === 'one' && ids.includes(current)) return reserve(current, 'repeat');
    const priorityId = state.priorityIds.find((id) => ids.includes(id) && !state.sessionExcludedIds.includes(id));
    if (priorityId) return reserve(priorityId, 'priority');
    for (let index = plan.cursor + 1; index < plan.order.length; index += 1) {
      const id = plan.order[index];
      if (ids.includes(id) && !state.sessionExcludedIds.includes(id)) return reserve(id, 'forward', index);
    }
    if (plan.style === 'standard') {
      if (options.repeat !== 'all') return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
      const nextCycle = plan.nextCycle || makePlan(ids, current, { style: 'standard', seed: `${plan.seed}:${plan.generation + 1}`, generation: plan.generation + 1 });
      const target = nextCycle.order.find((id) => id !== current && !state.sessionExcludedIds.includes(id));
      if (!target && state.sessionExcludedIds.includes(current)) return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
      state = { ...state, plan: { ...state.plan, nextCycle: { seed: nextCycle.seed, generation: nextCycle.generation, order: nextCycle.order } } };
      const staged = reserve(target || current, target ? 'forward' : 'repeat');
      return { ...staged, reset: true };
    }
    if (!state.cycle.includes(current)) state = { ...state, cycle: state.cycle.concat(current) };
    const futureId = state.plan.future.find((id) => ids.includes(id) && !state.sessionExcludedIds.includes(id));
    if (futureId) return reserve(futureId, 'planned');
    const albumId = state.plan.albumContinuation?.ids.find((id) => ids.includes(id) && !state.cycle.includes(id) && !state.sessionExcludedIds.includes(id));
    if (albumId) return reserve(albumId, 'planned');
    let candidateIds = ids.filter((id) => id !== current && !state.cycle.includes(id) && !state.sessionExcludedIds.includes(id));
    if (candidateIds.length) return { state, candidateIds, trackId: '', kind: 'candidate', stopped: false, reset: false };
    if (options.repeat !== 'all') return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
    state = { ...state, plan: { ...state.plan, nextCycle: plan.nextCycle || { seed: `${plan.seed}:${plan.generation + 1}`, generation: plan.generation + 1, order: [] } } };
    candidateIds = ids.filter((id) => id !== current && !state.sessionExcludedIds.includes(id));
    if (!candidateIds.length && ids.includes(current) && !state.sessionExcludedIds.includes(current)) return { ...reserve(current, 'repeat'), reset: true };
    return { state, candidateIds, trackId: '', kind: 'candidate', stopped: candidateIds.length === 0, reset: true };
  }

  function stagePrevious(values, queueIds, currentId) {
    const state = ensurePlan(values, queueIds, currentId);
    const plan = state.plan;
    if (!plan || plan.cursor <= 0) return { state, trackId: '', stopped: true };
    const available = new Set(uniqueIds(queueIds));
    const unavailableIds = [];
    for (let index = plan.cursor - 1; index >= 0; index -= 1) {
      const id = plan.order[index];
      if (available.has(id)) return { state: { ...state, plan: { ...plan, navigation: { kind: 'previous', fromId: String(currentId || ''), trackId: id, fromCursor: plan.cursor, toCursor: index } } }, trackId: id, stopped: false, unavailableIds };
      unavailableIds.push(id);
    }
    return { state, trackId: '', stopped: true, unavailableIds };
  }

  function commitPlayback(values, queueIds, fromId, trackId, options = {}) {
    const before = normalizeState(values);
    const playbackAttemptId = String(options.playbackAttemptId || '');
    if (playbackAttemptId && before.plan?.lastPlaybackAttemptId === playbackAttemptId) return before;
    let state = ensurePlan(values, queueIds, fromId, options);
    let plan = { ...state.plan };
    const target = String(trackId || '');
    if (!target || !plan.sourceQueueIds.includes(target)) return state;
    const current = String(fromId || '');
    if (plan.nextCycle && !state.priorityIds.includes(target) && plan.navigation?.kind !== 'previous') {
      const nextCycle = plan.nextCycle;
      if (plan.style === 'standard') {
        plan.order = plan.order.slice(0, plan.cursor + 1).concat(nextCycle.order.filter((id) => id !== current));
      }
      plan = { ...plan, seed: nextCycle.seed, generation: nextCycle.generation, nextCycle: null, future: [], albumContinuation: null };
      state = { ...state, cycle: [current] };
    }
    const nextIndex = plan.cursor + 1;
    const navigation = plan.navigation;
    const stagedNavigation = navigation && navigation.trackId === target && navigation.fromId === current && navigation.fromCursor === plan.cursor ? navigation : null;
    const explicit = options.kind === 'priority' || options.kind === 'replay' || options.kind === 'repeat' || state.priorityIds.includes(target) || ['priority', 'repeat'].includes(stagedNavigation?.kind);
    if (!explicit && stagedNavigation && stagedNavigation.toCursor >= 0 && plan.order[stagedNavigation.toCursor] === target) plan.cursor = stagedNavigation.toCursor;
    else if (!explicit && plan.order[nextIndex] === target) plan.cursor = nextIndex;
    else if (!explicit && plan.cursor > 0 && plan.order[plan.cursor - 1] === target) plan.cursor -= 1;
    else {
      // A new explicit action forks retained forward navigation. Standard's
      // untouched seeded suffix keeps its exact relative traversal order.
      const suffix = plan.style === 'standard' ? plan.order.slice(Math.max(nextIndex, plan.committedLength)).filter((id) => id !== target) : [];
      plan.order = plan.order.slice(0, Math.max(0, nextIndex)).concat(target, suffix);
      plan.cursor = plan.order.length - 1;
      if (suffix.length) plan.cursor -= suffix.length;
      plan.committedLength = plan.cursor + 1;
    }
    plan.committedLength = Math.max(plan.committedLength, plan.cursor + 1);
    const history = state.history.concat(target);
    const cycle = target && !state.cycle.includes(target) ? state.cycle.concat(target) : state.cycle;
    plan.future = plan.future.filter((id, index) => !(index === 0 && id === target)).filter((id) => id !== target);
    if (plan.albumContinuation) {
      const ids = plan.albumContinuation.ids.filter((id) => id !== target);
      plan.albumContinuation = ids.length ? { ...plan.albumContinuation, ids } : null;
    }
    plan.navigation = null;
    plan.lastPlaybackAttemptId = playbackAttemptId;
    return { ...state, plan, history, cycle, priorityIds: state.priorityIds.filter((id) => id !== target) };
  }

  function setFuturePlan(values, queueIds, futureIds, options = {}) {
    const state = syncToQueue(values, queueIds);
    if (!state.plan) return state;
    const known = new Set(state.plan.order.concat(state.cycle));
    const continuation = options.albumContinuation;
    const albumContinuation = continuation && typeof continuation === 'object' ? { albumId: String(continuation.albumId || ''), ids: uniqueIds([...(Array.isArray(continuation.prefixIds) ? continuation.prefixIds : []), ...(Array.isArray(continuation.ids) ? continuation.ids : [])]).filter((id) => state.plan.sourceQueueIds.includes(id) && !known.has(id)), orderKnown: continuation.orderKnown === true } : state.plan.albumContinuation;
    return { ...state, plan: { ...state.plan, future: uniqueIds(futureIds).filter((id) => state.plan.sourceQueueIds.includes(id) && !known.has(id)), albumContinuation } };
  }

  function excludeForSession(values, trackId) {
    const state = normalizeState(values);
    const id = String(trackId || '');
    if (!id) return state;
    return { ...state, priorityIds: state.priorityIds.filter((item) => item !== id), sessionExcludedIds: uniqueIds(state.sessionExcludedIds.concat(id)), plan: state.plan ? { ...state.plan, future: state.plan.future.filter((item) => item !== id), navigation: null } : null };
  }

  function setLessLikeArtist(values, artistId, enabled = true) {
    const state = normalizeState(values);
    const id = String(artistId || '');
    if (!id) return state;
    return { ...state, lessLikeArtistIds: enabled ? uniqueIds(state.lessLikeArtistIds.concat(id)) : state.lessLikeArtistIds.filter((item) => item !== id), plan: state.plan ? { ...state.plan, future: [] } : null };
  }

  function displayOrder(values, queueIds) {
    const ids = uniqueIds(queueIds);
    const state = normalizeState(values);
    const plan = state.plan;
    if (!plan) return ids;
    const allowed = new Set(ids);
    const committed = plan.order.slice(0, Math.max(0, plan.cursor + 1));
    const forward = plan.order.slice(Math.max(0, plan.cursor + 1));
    const priority = state.priorityIds;
    const future = plan.style === 'flow' ? plan.future.concat(plan.albumContinuation?.ids || []) : [];
    return uniqueIds(committed.concat(priority, forward, future, ids)).filter((id) => allowed.has(id));
  }

  function prepareNext(values, queueIds, currentId, options = {}) {
    const ids = uniqueIds(queueIds);
    const current = String(currentId || '');
    let state = syncToQueue(values, ids);
    if (!current || ids.length <= 1) return { state, candidateIds: [], stopped: true, reset: false };
    if (!state.cycle.includes(current)) state = { ...state, cycle: state.cycle.concat(current) };
    let candidateIds = ids.filter((id) => id !== current && !state.cycle.includes(id));
    if (candidateIds.length) return { state, candidateIds, stopped: false, reset: false };
    if (options.fromEnded && options.repeat === 'off') return { state, candidateIds: [], stopped: true, reset: false };
    state = { ...state, cycle: [current] };
    candidateIds = ids.filter((id) => id !== current);
    return { state, candidateIds, stopped: candidateIds.length === 0, reset: true };
  }

  function recordPick(values, fromId, pickedId) {
    const state = normalizeState(values);
    const from = String(fromId || '');
    const picked = String(pickedId || '');
    const history = picked ? (state.history.length ? state.history : from ? [from] : []).concat(picked) : state.history;
    const cycle = picked && !state.cycle.includes(picked) ? state.cycle.concat(picked) : state.cycle;
    return { ...state, history, cycle };
  }

  function hashSeed(value) {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seed) {
    let value = hashSeed(seed) || 0x6d2b79f5;
    return function seededRandom() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledIds(values, random = Math.random) {
    const result = uniqueIds(values);
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function weightedPick(scored, poolSize = 12, random = Math.random) {
    const eligible = (Array.isArray(scored) ? scored : [])
      .filter((item) => item && Number.isFinite(Number(item.score)))
      .slice()
      .sort((a, b) => Number(b.score) - Number(a.score));
    const size = Math.max(1, Math.min(Math.round(Number(poolSize) || 1), eligible.length));
    const pool = eligible.slice(0, size);
    if (!pool.length) return { pick: null, pool: [] };
    const weights = pool.map((item) => Math.max(0, Number(item.score) || 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return { pick: pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))], pool };
    let roll = random() * total;
    for (let index = 0; index < pool.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) return { pick: pool[index], pool };
    }
    return { pick: pool[pool.length - 1], pool };
  }

  return Object.freeze({
    // Active adapters use the entryId-based universal API. The trackId-only
    // functions below remain for non-destructive saved v1 traversal migration.
    universalPolicy,
    VERSION,
    MODES,
    commitPlayback,
    createSeededRandom,
    displayOrder,
    excludeForSession,
    ensurePlan,
    makePlan,
    markPriority,
    normalizeState,
    prepareNext,
    recordPick,
    resetPlan,
    setFuturePlan,
    setLessLikeArtist,
    shuffledIds,
    stageNext,
    stagePrevious,
    syncToQueue,
    weightedPick,
  });
}));
