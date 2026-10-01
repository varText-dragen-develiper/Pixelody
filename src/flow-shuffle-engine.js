(function flowShuffleEngineFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffle = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleEngine() {
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
        order: uniqueIds(source.plan.order),
        future: uniqueIds(source.plan.future),
        cursor: Math.max(-1, Math.round(Number(source.plan.cursor) || 0)),
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
    return { style, seed, generation, sourceQueueIds: ids, order, future: [], cursor: current && ids.includes(current) ? 0 : -1 };
  }

  function syncToQueue(values, queueIds) {
    const state = normalizeState(values);
    const allowed = new Set(uniqueIds(queueIds));
    const sourceQueueIds = uniqueIds(queueIds);
    const queueChanged = state.plan && state.plan.sourceQueueIds.join('|') !== sourceQueueIds.join('|');
    const plan = state.plan ? {
      ...state.plan,
      sourceQueueIds,
      order: state.plan.order.filter((id) => allowed.has(id)),
      future: queueChanged ? [] : state.plan.future.filter((id) => allowed.has(id)),
    } : null;
    if (plan) plan.cursor = Math.min(plan.cursor, plan.order.length - 1);
    return {
      ...state,
      cycle: state.cycle.filter((id) => allowed.has(id)),
      history: state.history.filter((id) => allowed.has(id)),
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
    const knownIndex = plan.order.indexOf(current);
    if (knownIndex >= 0) plan.cursor = knownIndex;
    else if (current) {
      plan.order = plan.order.slice(0, Math.max(0, plan.cursor + 1)).concat(current);
      plan.cursor = plan.order.length - 1;
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
    if (!current || ids.length <= 1) return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
    const plan = state.plan;
    if (plan.style !== 'standard') {
      const priorityId = state.priorityIds.find((id) => id !== current && ids.includes(id) && !state.sessionExcludedIds.includes(id));
      if (priorityId) return { state: { ...state, plan: { ...state.plan, future: [] } }, candidateIds: [], trackId: priorityId, kind: 'priority', stopped: false, reset: false };
    }
    if (plan.cursor >= 0 && plan.cursor < plan.order.length - 1) {
      return { state, candidateIds: [], trackId: plan.order[plan.cursor + 1], kind: 'forward', stopped: false, reset: false };
    }
    if (plan.style === 'standard') {
      if (options.fromEnded && options.repeat === 'off') return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
      state = resetPlan(state, ids, current, { style: 'standard', seed: `${plan.seed}:${plan.generation + 1}`, keepPriority: true });
      return { state, candidateIds: [], trackId: state.plan.order[1] || '', kind: 'forward', stopped: !state.plan.order[1], reset: true };
    }
    if (!state.cycle.includes(current)) state = { ...state, cycle: state.cycle.concat(current) };
    if (state.plan.future.length) return { state, candidateIds: [], trackId: state.plan.future[0], kind: 'planned', stopped: false, reset: false };
    let candidateIds = ids.filter((id) => id !== current && !state.cycle.includes(id) && !state.sessionExcludedIds.includes(id));
    if (candidateIds.length) return { state, candidateIds, trackId: '', kind: 'candidate', stopped: false, reset: false };
    if (options.fromEnded && options.repeat === 'off') return { state, candidateIds: [], trackId: '', kind: 'stop', stopped: true, reset: false };
    state = resetPlan(state, ids, current, { style: 'flow', seed: `${plan.seed}:${plan.generation + 1}`, keepPriority: true, keepSessionControls: true });
    candidateIds = ids.filter((id) => id !== current && !state.sessionExcludedIds.includes(id));
    return { state, candidateIds, trackId: '', kind: 'candidate', stopped: candidateIds.length === 0, reset: true };
  }

  function stagePrevious(values, queueIds, currentId) {
    const state = ensurePlan(values, queueIds, currentId);
    const plan = state.plan;
    if (!plan || plan.cursor <= 0) return { state, trackId: '', stopped: true };
    return { state, trackId: plan.order[plan.cursor - 1] || '', stopped: !plan.order[plan.cursor - 1] };
  }

  function commitPlayback(values, queueIds, fromId, trackId, options = {}) {
    let state = ensurePlan(values, queueIds, fromId, options);
    const plan = { ...state.plan };
    const target = String(trackId || '');
    if (!target || !plan.sourceQueueIds.includes(target)) return state;
    const nextIndex = plan.cursor + 1;
    if (plan.order[nextIndex] === target) plan.cursor = nextIndex;
    else if (plan.order.includes(target)) plan.cursor = plan.order.indexOf(target);
    else {
      plan.order = plan.order.slice(0, Math.max(0, nextIndex)).concat(target);
      plan.cursor = plan.order.length - 1;
    }
    const current = String(fromId || '');
    const history = current ? state.history.filter((id) => id !== current).concat(current) : state.history;
    const cycle = target && !state.cycle.includes(target) ? state.cycle.concat(target) : state.cycle;
    plan.future = plan.future.filter((id, index) => !(index === 0 && id === target)).filter((id) => id !== target);
    return { ...state, plan, history, cycle, priorityIds: state.priorityIds.filter((id) => id !== target) };
  }

  function setFuturePlan(values, queueIds, futureIds) {
    const state = syncToQueue(values, queueIds);
    if (!state.plan) return state;
    const known = new Set(state.plan.order.concat(state.cycle));
    return { ...state, plan: { ...state.plan, future: uniqueIds(futureIds).filter((id) => state.plan.sourceQueueIds.includes(id) && !known.has(id)) } };
  }

  function excludeForSession(values, trackId) {
    const state = normalizeState(values);
    const id = String(trackId || '');
    if (!id) return state;
    return { ...state, priorityIds: state.priorityIds.filter((item) => item !== id), sessionExcludedIds: uniqueIds(state.sessionExcludedIds.concat(id)), plan: state.plan ? { ...state.plan, future: state.plan.future.filter((item) => item !== id) } : null };
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
    const priority = plan.style === 'flow' ? state.priorityIds : [];
    const future = plan.style === 'flow' ? plan.future : [];
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
    const history = from ? state.history.filter((id) => id !== from).concat(from) : state.history;
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
