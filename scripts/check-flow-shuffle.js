const assert = require('node:assert/strict');
const engine = require('../src/flow-shuffle-engine');
const learning = require('../src/flow-shuffle-learning');
const jamLearning = require('../src/jam-learning-contract');
const planner = require('../src/flow-shuffle-planner');
const contract = require('../src/flow-shuffle-contract');
const acoustic = require('../src/flow-shuffle-acoustic');
const decision = require('../src/flow-shuffle-decision');

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

test('migrates legacy state without truncating large cycles or history', () => {
  const cycle = Array.from({ length: 1000 }, (_, index) => `track-${index}`);
  const history = Array.from({ length: 600 }, (_, index) => `history-${index}`);
  const state = engine.normalizeState({ mode: 'comfort', cycle, history });
  assert.equal(state.version, 5);
  assert.equal(state.mode, 'comfort');
  assert.equal(state.cycle.length, 1000);
  assert.equal(state.history.length, 600);
});

test('seeded random order is reproducible and complete', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `track-${index}`);
  const first = engine.shuffledIds(ids, engine.createSeededRandom('fixture-seed'));
  const second = engine.shuffledIds(ids, engine.createSeededRandom('fixture-seed'));
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, ids.length);
  assert.notDeepEqual(first, ids);
});

test('weighted selection is deterministic and does not mutate candidates', () => {
  const candidates = [
    { track: { id: 'low' }, score: 10 },
    { track: { id: 'high' }, score: 90 },
    { track: { id: 'mid' }, score: 50 },
  ];
  const original = candidates.map((item) => item.track.id);
  const first = engine.weightedPick(candidates, 3, engine.createSeededRandom('weighted'));
  const second = engine.weightedPick(candidates, 3, engine.createSeededRandom('weighted'));
  assert.equal(first.pick.track.id, second.pick.track.id);
  assert.deepEqual(candidates.map((item) => item.track.id), original);
  assert.deepEqual(first.pool.map((item) => item.track.id), ['high', 'mid', 'low']);
});

test('repeat off visits a 1000-track queue exactly once before stopping', () => {
  const ids = Array.from({ length: 1000 }, (_, index) => `track-${index}`);
  const random = engine.createSeededRandom('large-library');
  let state = engine.normalizeState({ cycle: [ids[0]] });
  let current = ids[0];
  const visited = [current];
  while (true) {
    const prepared = engine.prepareNext(state, ids, current, { fromEnded: true, repeat: 'off' });
    state = prepared.state;
    if (prepared.stopped) break;
    const next = engine.shuffledIds(prepared.candidateIds, random)[0];
    state = engine.recordPick(state, current, next);
    current = next;
    visited.push(current);
  }
  assert.equal(visited.length, ids.length);
  assert.equal(new Set(visited).size, ids.length);
  assert.equal(state.cycle.length, ids.length);
});

test('repeat all starts a new cycle only after exhausting the first', () => {
  const ids = ['a', 'b', 'c'];
  let state = engine.normalizeState({ cycle: ids });
  const prepared = engine.prepareNext(state, ids, 'c', { fromEnded: true, repeat: 'all' });
  assert.equal(prepared.reset, true);
  assert.deepEqual(prepared.state.cycle, ['c']);
  assert.deepEqual(prepared.candidateIds, ['a', 'b']);
});

test('queue synchronization removes stale IDs from all engine state', () => {
  const state = engine.normalizeState({
    cycle: ['a', 'gone', 'b'],
    history: ['gone', 'a'],
    plan: { seed: 'x', generation: 1, sourceQueueIds: ['a', 'gone', 'b'], order: ['gone', 'b'], cursor: 0 },
  });
  const synced = engine.syncToQueue(state, ['a', 'b']);
  assert.deepEqual(synced.cycle, ['a', 'b']);
  assert.deepEqual(synced.history, ['a']);
  assert.deepEqual(synced.plan.sourceQueueIds, ['a', 'b']);
  assert.deepEqual(synced.plan.order, ['b']);
});

test('standard plans persist one complete seeded traversal', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const state = engine.resetPlan({}, ids, 'a', { style: 'standard', seed: 'standard-fixture' });
  assert.equal(state.plan.style, 'standard');
  assert.equal(state.plan.order[0], 'a');
  assert.equal(state.plan.order.length, ids.length);
  assert.equal(new Set(state.plan.order).size, ids.length);
  const restored = engine.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.plan, state.plan);
});

test('display order follows the durable standard traversal', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const state = engine.resetPlan({}, ids, 'a', { style: 'standard', seed: 'display-fixture' });
  assert.deepEqual(engine.displayOrder(state, ids), state.plan.order);
  assert.deepEqual(engine.displayOrder(state, ['a', 'c', 'e']), state.plan.order.filter((id) => ['a', 'c', 'e'].includes(id)));
});

test('Flow display order mirrors committed, priority, forward, and planned tracks', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  let state = engine.resetPlan({}, ids, 'a', { style: 'flow', seed: 'flow-display-fixture' });
  state = engine.commitPlayback(state, ids, 'a', 'b', { style: 'flow' });
  state = engine.commitPlayback(state, ids, 'b', 'c', { style: 'flow' });
  state = engine.commitPlayback(state, ids, 'c', 'b', { style: 'flow' });
  state = engine.markPriority(state, 'f', { front: true });
  state = engine.setFuturePlan(state, ids, ['d', 'e']);
  assert.deepEqual(engine.displayOrder(state, ids), ['a', 'b', 'f', 'c', 'd', 'e']);
});

test('staged Flow picks do not consume a candidate until playback commits', () => {
  const ids = ['a', 'b', 'c'];
  const initial = engine.resetPlan({}, ids, 'a', { style: 'flow', seed: 'flow-fixture' });
  const staged = engine.stageNext(initial, ids, 'a', { repeat: 'off', style: 'flow' });
  assert.deepEqual(staged.candidateIds, ['b', 'c']);
  assert.deepEqual(staged.state.plan.order, ['a']);
  assert.deepEqual(staged.state.cycle, ['a']);
  const committed = engine.commitPlayback(staged.state, ids, 'a', 'b', { style: 'flow' });
  assert.deepEqual(committed.plan.order, ['a', 'b']);
  assert.equal(committed.plan.cursor, 1);
  assert.deepEqual(committed.cycle, ['a', 'b']);
});

test('previous and next traverse an existing plan without destroying forward history', () => {
  const ids = ['a', 'b', 'c'];
  let state = engine.resetPlan({}, ids, 'a', { style: 'flow', seed: 'history-fixture' });
  state = engine.commitPlayback(state, ids, 'a', 'b', { style: 'flow' });
  state = engine.commitPlayback(state, ids, 'b', 'c', { style: 'flow' });
  const previous = engine.stagePrevious(state, ids, 'c');
  assert.equal(previous.trackId, 'b');
  state = engine.commitPlayback(previous.state, ids, 'c', 'b', { style: 'flow' });
  assert.deepEqual(state.plan.order, ['a', 'b', 'c']);
  assert.equal(state.plan.cursor, 1);
  const next = engine.stageNext(state, ids, 'b', { repeat: 'off', style: 'flow' });
  assert.equal(next.kind, 'forward');
  assert.equal(next.trackId, 'c');
});

test('queue mutations preserve traversal already committed and remove unavailable entries', () => {
  const ids = ['a', 'b', 'c', 'd'];
  let state = engine.resetPlan({}, ids, 'a', { style: 'flow', seed: 'mutation-fixture' });
  state = engine.commitPlayback(state, ids, 'a', 'b', { style: 'flow' });
  const moved = engine.syncToQueue(state, ['d', 'a', 'b', 'c']);
  assert.deepEqual(moved.plan.order, ['a', 'b']);
  assert.deepEqual(moved.plan.sourceQueueIds, ['d', 'a', 'b', 'c']);
  const removed = engine.syncToQueue(moved, ['d', 'a', 'c']);
  assert.deepEqual(removed.plan.order, ['a']);
  assert.equal(removed.plan.cursor, 0);
});

test('manual priority is selected before scored Flow candidates and cleared after commit', () => {
  const ids = ['a', 'b', 'c'];
  let state = engine.resetPlan({}, ids, 'a', { style: 'flow', seed: 'priority-fixture' });
  state = engine.markPriority(state, 'c');
  const staged = engine.stageNext(state, ids, 'a', { repeat: 'off', style: 'flow' });
  assert.equal(staged.kind, 'priority');
  assert.equal(staged.trackId, 'c');
  state = engine.commitPlayback(staged.state, ids, 'a', 'c', { style: 'flow' });
  assert.deepEqual(state.priorityIds, []);
});

test('planner pruning preserves tied-candidate order and independent remaining sets', () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({ id: `perf-${index}`, artist: `Artist ${index % 7}`, album: `Album ${index % 4}` }));
  const original = JSON.parse(JSON.stringify(candidates));
  const plan = planner.planSession({ candidates, horizon: 10, shape: 'wave' });
  // Frozen from the eager-copy planner before the allocation repair. These
  // overlapping beams must retain their own consumed units and stable ties.
  assert.deepEqual(plan.ids, ['perf-0', 'perf-1', 'perf-10', 'perf-11', 'perf-19', 'perf-16', 'perf-13', 'perf-14', 'perf-17', 'perf-15']);
  assert.equal(plan.score, -14);
  assert.deepEqual(plan.steps.map(step => step.diversityPoints), [0, 0, 0, 0, -7, 0, 0, 0, -7, 0]);
  assert.deepEqual(plan.steps.map(step => step.previousTrackId), ['', ...plan.ids.slice(0, -1)]);
  assert.deepEqual(candidates, original, 'Planning must not consume or mutate the input library');
});

test('rolling plans are deterministic, bounded, and consumed only after playback commits', () => {
  const candidates = ['b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => ({ id, artist: `artist-${index}`, album: `album-${index}`, energy: 0.45 + index * 0.05, bpm: 110 + index * 2 }));
  const options = { current: { id: 'a', energy: 0.45, bpm: 110, musicalKey: 'C' }, candidates, baseScores: Object.fromEntries(candidates.map((track) => [track.id, 50])), horizon: 6, shape: 'steady' };
  const first = planner.planSession(options);
  const second = planner.planSession(options);
  assert.deepEqual(first, second);
  assert.equal(first.ids.length, 6);
  assert.equal(new Set(first.ids).size, first.ids.length);
  let state = engine.resetPlan({}, ['a'].concat(first.ids), 'a', { style: 'flow', seed: 'rolling-fixture' });
  state = engine.setFuturePlan(state, ['a'].concat(first.ids), first.ids);
  const staged = engine.stageNext(state, ['a'].concat(first.ids), 'a', { repeat: 'off', style: 'flow' });
  assert.equal(staged.kind, 'planned');
  assert.equal(staged.trackId, first.ids[0]);
  assert.deepEqual(staged.state.plan.future, first.ids);
  const committed = engine.commitPlayback(staged.state, ['a'].concat(first.ids), 'a', staged.trackId, { style: 'flow' });
  assert.deepEqual(committed.plan.future, first.ids.slice(1));
});

test('shared contract versions snapshots and commands without exporting behavioral learning', () => {
  const snapshot = contract.publicSnapshot({ enabled: true, mode: 'flow', session: { horizon: 7, energyShape: 'rise' }, priorityIds: ['private-a'], plan: { seed: 'shared', generation: 2, cursor: 1, sourceQueueIds: ['private-a', 'private-b'], order: ['private-a'], future: ['private-b'] }, signalJournal: { events: ['must-not-leak'] } }, (id) => ({ 'private-a': 'public-a', 'private-b': 'public-b' })[id]);
  assert.equal(snapshot.version, contract.VERSION);
  assert.deepEqual(snapshot.plan.future, ['public-b']);
  assert.equal(JSON.stringify(snapshot).includes('must-not-leak'), false);
  assert.deepEqual(contract.commandPayload({ action: 'setsession', session: { horizon: 20, energyShape: 'wave', albumPolicy: 'album' } }), { version: 1, action: 'setsession', session: { horizon: 10, energyShape: 'wave', albumPolicy: 'album', preserveAlbumRuns: false } });
});

test('local acoustic prototype is deterministic, bounded, resumable, and has a no-analysis fallback', () => {
  const samples = Array.from({ length: 48000 }, (_, index) => Math.sin(index / 12) * 0.4);
  const first = acoustic.analyzePcm(samples, 48000, { maxSamples: 48000 });
  const second = acoustic.analyzePcm(samples, 48000, { maxSamples: 48000 });
  assert.deepEqual(first, second);
  assert.equal(acoustic.analyzePcm([], 48000), null);
  assert.equal(first.embedding.length, 8);
  assert.ok(first.tempo >= 40 && first.tempo <= 240);
  assert.ok(acoustic.similarity(first, second) > 0.99);
  assert.deepEqual(acoustic.normalizeJob({ status: 'running', nextIndex: 4, processed: 4, limit: 999 }), { version: 1, status: 'running', nextIndex: 4, processed: 4, limit: 500, cancelled: false });
});

test('session controls scope exclusions and artist suppression without touching persisted history', () => {
  let state = engine.resetPlan({ history: ['earlier'] }, ['a', 'b', 'c'], 'a', { style: 'flow', seed: 'control-fixture' });
  state = engine.excludeForSession(state, 'b');
  assert.deepEqual(state.sessionExcludedIds, ['b']);
  assert.deepEqual(state.history, ['a']);
  const staged = engine.stageNext(state, ['a', 'b', 'c'], 'a', { style: 'flow', repeat: 'off' });
  assert.deepEqual(staged.candidateIds, ['c']);
  state = engine.setLessLikeArtist(state, 'example artist');
  assert.deepEqual(state.lessLikeArtistIds, ['example artist']);
  assert.deepEqual(state.plan.future, []);
  state = engine.resetPlan(state, ['a', 'b', 'c'], 'a', { style: 'flow' });
  assert.deepEqual(state.sessionExcludedIds, []);
  assert.deepEqual(state.lessLikeArtistIds, []);
});

test('planner rewards smooth BPM, key, and energy transitions over a high individual score', () => {
  const plan = planner.planSession({
    current: { id: 'current', energy: 0.5, bpm: 120, musicalKey: 'C' },
    candidates: [
      { id: 'abrupt', energy: 1, bpm: 190, musicalKey: 'F#' },
      { id: 'smooth', energy: 0.52, bpm: 122, musicalKey: 'C' },
      { id: 'fill-1', energy: 0.54, bpm: 124, musicalKey: 'D' },
      { id: 'fill-2', energy: 0.48, bpm: 118, musicalKey: 'A' },
      { id: 'fill-3', energy: 0.5, bpm: 120, musicalKey: 'C' },
    ],
    baseScores: { abrupt: 54, smooth: 50, 'fill-1': 45, 'fill-2': 44, 'fill-3': 43 },
    horizon: 5,
    shape: 'steady',
  });
  assert.ok(planner.transitionScore({ energy: 0.5, bpm: 120, musicalKey: 'C' }, { energy: 0.52, bpm: 122, musicalKey: 'C' }, { shape: 'steady', horizon: 5 }) > planner.transitionScore({ energy: 0.5, bpm: 120, musicalKey: 'C' }, { energy: 1, bpm: 190, musicalKey: 'F#' }, { shape: 'steady', horizon: 5 }));
  assert.ok(plan.ids.indexOf('smooth') < plan.ids.indexOf('abrupt'));
});

test('planner returns display-ready transition breakdowns without changing the selected order', () => {
  const options = {
    current: { id: 'current', energy: 0.5, bpm: 120, musicalKey: 'C' },
    candidates: [
      { id: 'smooth', artist: 'A', genre: 'ambient', energy: 0.52, bpm: 122, musicalKey: 'C' },
      { id: 'rough', artist: 'B', genre: 'metal', energy: 0.92, bpm: 190, musicalKey: 'F#' },
    ],
    baseScores: { smooth: 50, rough: 50 },
    horizon: 5,
    shape: 'steady',
  };
  const first = planner.planSession(options);
  const second = planner.planSession(options);
  assert.deepEqual(first.ids, second.ids);
  assert.equal(first.steps.length, first.ids.length);
  const firstStep = first.steps[0];
  assert.equal(firstStep.trackId, first.ids[0]);
  assert.equal(firstStep.position, 1);
  assert.equal(firstStep.transition.bpm.available, true);
  assert.equal(firstStep.transition.bpm.current, 120);
  assert.equal(firstStep.transition.bpm.candidate, 122);
  assert.equal(typeof firstStep.transition.energy.points, 'number');
  assert.equal(typeof firstStep.transition.key.points, 'number');
  assert.equal(typeof firstStep.diversity.artist, 'string');
});

test('decision receipts normalize persistence-safe display evidence', () => {
  const receipt = decision.normalizeDecision({
    kind: 'candidate',
    source: 'local metadata and listening history',
    mode: 'flow',
    shape: 'rise',
    trackId: 'track-1',
    fromTrackId: 'track-0',
    planPosition: 2,
    horizon: 6,
    fitScore: 78,
    evidenceStrength: 0.42,
    metadataCoverage: 0.8,
    availableSignals: ['tempo', 'energy', 'invalid-signal'],
    transition: {
      bpm: { current: 118, candidate: 122, delta: 4, points: 4, available: true },
      energy: { current: 0.58, candidate: 0.61, target: 0.6, points: 9, available: true, direction: 'steady' },
      key: { current: 'C', candidate: 'G', points: 2, available: true },
      totalPoints: 15,
    },
    diversity: { artist: 'spaced', album: 'repeat', genre: 'available', points: -7 },
  });
  assert.equal(receipt.version, 1);
  assert.deepEqual(receipt.availableSignals, ['tempo', 'energy']);
  assert.equal(receipt.transition.bpm.delta, 4);
  assert.equal(receipt.transition.key.available, true);
  assert.equal(receipt.diversity.album, 'repeat');
  assert.equal(decision.normalizeDecision({ evidenceStrength: 12, metadataCoverage: -2 }).evidenceStrength, 1);
  assert.equal(decision.normalizeDecision({ evidenceStrength: 12, metadataCoverage: -2 }).metadataCoverage, 0);
});

test('planner energy shapes are explicit and album runs remain contiguous when requested', () => {
  assert.ok(planner.shapeTarget('rise', 4, 5, 0.35) > planner.shapeTarget('steady', 4, 5, 0.35));
  assert.ok(planner.shapeTarget('wind-down', 4, 5, 0.65) < planner.shapeTarget('steady', 4, 5, 0.65));
  const candidates = [
    { id: 'a1', artist: 'A', album: 'One', trackNumber: 1, energy: 0.5 },
    { id: 'a2', artist: 'A', album: 'One', trackNumber: 2, energy: 0.52 },
    { id: 'b1', artist: 'B', album: 'Two', trackNumber: 1, energy: 0.55 },
    { id: 'b2', artist: 'B', album: 'Two', trackNumber: 2, energy: 0.56 },
    { id: 'c1', artist: 'C', album: 'Three', trackNumber: 1, energy: 0.5 },
  ];
  const plan = planner.planSession({ current: { id: 'current', energy: 0.5 }, candidates, horizon: 5, albumPolicy: 'album', preserveAlbumRuns: true });
  const albumOrder = plan.ids.map((id) => candidates.find((track) => track.id === id).album);
  assert.equal(albumOrder.filter((album) => album === 'One').join('|'), 'One|One');
  assert.equal(albumOrder.filter((album) => album === 'Two').join('|'), 'Two|Two');
  assert.ok(Math.abs(albumOrder.indexOf('One') - albumOrder.lastIndexOf('One')) === 1);
  assert.ok(Math.abs(albumOrder.indexOf('Two') - albumOrder.lastIndexOf('Two')) === 1);
});

test('planner scales diversity while keeping incomplete metadata eligible and invalidates only an edited suffix', () => {
  const candidates = [
    { id: 'same-1', artist: 'Same', album: 'Same album', genre: 'rock', energy: 0.5 },
    { id: 'same-2', artist: 'Same', album: 'Same album', genre: 'rock', energy: 0.5 },
    { id: 'other-1', artist: 'Other', album: 'Other album', genre: 'jazz', energy: 0.5 },
    { id: 'other-2', artist: 'Third', album: 'Third album', genre: 'pop', energy: 0.5 },
    { id: 'unknown' },
  ];
  const plan = planner.planSession({ current: { id: 'current', energy: 0.5 }, candidates, baseScores: { 'same-1': 60, 'same-2': 59, 'other-1': 55, 'other-2': 54, unknown: 52 }, horizon: 5 });
  assert.ok(plan.ids.includes('unknown'));
  assert.ok(plan.ids.indexOf('same-2') > plan.ids.indexOf('other-1'));
  let state = engine.resetPlan({}, ['current'].concat(plan.ids), 'current', { style: 'flow', seed: 'suffix-fixture' });
  state = engine.setFuturePlan(state, ['current'].concat(plan.ids), plan.ids);
  const unchanged = engine.syncToQueue(state, ['current'].concat(plan.ids));
  assert.deepEqual(unchanged.plan.future, plan.ids);
  const edited = engine.syncToQueue(unchanged, ['current'].concat(plan.ids).reverse());
  assert.deepEqual(edited.plan.future, []);
});

test('Play Next priority keeps the newest explicit request at the front', () => {
  let state = engine.markPriority({}, 'b');
  state = engine.markPriority(state, 'c', { front: true });
  state = engine.markPriority(state, 'b', { front: true });
  assert.deepEqual(state.priorityIds, ['b', 'c']);
});

test('outcome classification protects errors and near-completions from early-skip treatment', () => {
  assert.equal(learning.classifyOutcome('skipped', 0.04, 'manual-switch').kind, 'early-skip');
  assert.equal(learning.classifyOutcome('skipped', 0.91, 'manual-switch').kind, 'near-completion');
  assert.equal(learning.classifyOutcome('skipped', 0.1, 'playback-error').kind, 'ignored');
  assert.equal(learning.classifyOutcome('skipped', 0.1, 'seek').kind, 'ignored');
  assert.equal(learning.classifyOutcome('completed', 0.7, 'natural-end').kind, 'completed');
  assert.equal(learning.classifyOutcome('skipped', 0.1, 'vpn-failure').kind, 'ignored');
  assert.equal(learning.classifyOutcome('skipped', 0.1, 'connection-lost').kind, 'ignored');
});

test('J.A.M. provenance keeps remote queue intent out of personal learning', () => {
  assert.deepEqual(jamLearning.eventContext({ eventType: 'track_queued', source: 'remote', actorDeviceId: 'friend-device' }), {
    learningScope: 'session',
    personalLearning: false,
    actorDeviceId: 'friend-device',
    actorRole: '',
    transport: '',
    ignored: false,
  });
  assert.deepEqual(jamLearning.eventContext({ eventType: 'track_completed', source: 'manual' }), {
    learningScope: 'personal',
    personalLearning: true,
    actorDeviceId: '',
    actorRole: '',
    transport: '',
    ignored: false,
  });
});

test('J.A.M. infrastructure failures never become taste evidence', () => {
  assert.deepEqual(jamLearning.eventContext({ eventType: 'track_skipped', source: 'remote', outcomeReason: 'vpn-failure' }), {
    learningScope: 'infrastructure',
    personalLearning: false,
    actorDeviceId: '',
    actorRole: '',
    transport: '',
    ignored: true,
  });
  assert.equal(jamLearning.isInfrastructureReason('permission-revoked'), true);
});

test('Bayesian evidence keeps one outcome close to neutral and gains influence with samples', () => {
  const sparse = learning.behaviorEvidence({ completions: 1, skips: 0 });
  const mature = learning.behaviorEvidence({ completions: 12, skips: 0 });
  const ignored = learning.behaviorEvidence({ completions: 0, skips: 1, ignoredOutcomes: 1 });
  assert.ok(sparse.rate < 0.7);
  assert.ok(sparse.confidence < mature.confidence);
  assert.ok(mature.signal > sparse.signal);
  assert.equal(ignored.evidence, 0);
});

test('identity normalization groups featured artists and ISRC recordings safely', () => {
  assert.equal(learning.artistIdentity({ artist: 'Example Artist feat. Guest' }), learning.artistIdentity({ artist: 'Example Artist' }));
  assert.equal(learning.recordingIdentity({ isrc: 'US-ABC-12-34567' }), 'isrc:us abc 12 34567');
  assert.equal(learning.albumIdentity({ artist: 'Example Artist', album: 'Great Album' }), 'example artist / great album');
});

test('freshness decays and context tags only match the current time window', () => {
  const now = new Date(2026, 6, 26, 8, 0, 0);
  assert.ok(learning.freshnessPressure(new Date(now.getTime() - 60 * 60 * 1000).toISOString(), now.getTime(), 24 * 60 * 60 * 1000) > 0.9);
  assert.equal(learning.freshnessPressure(new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(), now.getTime(), 24 * 60 * 60 * 1000), 0);
  assert.deepEqual(learning.matchingContextTags(['morning', 'night', 'focus'], now), ['morning']);
});

test('exploration and exposure remain bounded and measurable', () => {
  assert.ok(learning.explorationBoost({ starts: 0 }, 'discovery') > 0);
  assert.ok(learning.explorationBoost({ starts: 12 }, 'discovery') === 0);
  const exposure = learning.exposureMetrics({ a: { starts: 1 }, b: { starts: 0 } }, ['a', 'b', 'c']);
  assert.deepEqual(exposure, { eligible: 3, played: 1, neverPlayed: 2, coverage: 1 / 3, starts: 1 });
});

if (!process.exitCode) console.log('Flow Shuffle engine checks passed.');
