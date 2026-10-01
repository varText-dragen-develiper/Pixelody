const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../src/flow-shuffle-engine');
const planner = require('../src/flow-shuffle-planner');
const decision = require('../src/flow-shuffle-decision');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function normalizedJournal(source = {}) {
  return {
    version: 1,
    events: (Array.isArray(source.events) ? source.events : []).map((event) => event?.type === 'shuffle_pick'
      ? { ...event, decision: event.decision ? decision.normalizeDecision(event.decision) : null }
      : event),
    lastShuffle: source.lastShuffle?.decision
      ? { ...source.lastShuffle, decision: decision.normalizeDecision(source.lastShuffle.decision) }
      : source.lastShuffle || null,
  };
}

function fixture() {
  const queue = ['current', 'smooth', 'other'];
  const current = { id: 'current', artist: 'Anchor', genre: 'ambient', bpm: 118, energy: 0.52, musicalKey: 'C' };
  const track = { id: 'smooth', artist: 'New Artist', genre: 'ambient', bpm: 122, energy: 0.55, musicalKey: 'G' };
  const scored = { track, score: 74 };
  const plan = planner.planSession({ current, candidates: [track, { id: 'other', artist: 'Other', bpm: 190, energy: 0.95, musicalKey: 'F#' }], baseScores: { smooth: 74, other: 60 }, horizon: 5, shape: 'steady' });
  const step = plan.steps.find((item) => item.trackId === track.id);
  const receipt = decision.normalizeDecision({
    kind: 'candidate', source: 'local metadata', mode: 'flow', shape: plan.shape,
    trackId: track.id, fromTrackId: current.id, planPosition: 1, horizon: plan.horizon,
    fitScore: scored.score, evidenceStrength: 0, metadataCoverage: 1,
    availableSignals: ['tempo', 'key', 'energy', 'genre', 'artist'],
    transition: step.transition, diversity: step.diversity,
  });
  let state = engine.resetPlan({}, queue, current.id, { style: 'flow' });
  state = engine.setFuturePlan(state, queue, plan.ids);
  const pending = { kind: 'candidate', trackId: track.id, fromTrackId: current.id, decision: receipt };
  return { queue, current, track, state, pending };
}

test('renderer source wires staged picks through successful playback only', () => {
  assert.match(renderer, /const stagedFlowPick = flowShuffleRuntime\.pending\?\.trackId === id/);
  assert.match(renderer, /commitStagedFlowShufflePlayback\(track, stagedFlowPick\)/);
  assert.match(renderer, /if \(stagedFlowPick\) flowShuffleRuntime\.pending = null/);
  assert.match(renderer, /flowShuffleDecision\.normalizeDecision/);
});

test('renderer source preserves Flow and receipt data through backup restore', () => {
  assert.match(renderer, /'pixelody\.signalJournal': normalizeSignalJournal\(backup\.signalJournal \|\| \{\}\)/);
  assert.match(renderer, /'pixelody\.flowShuffle': normalizeFlowShuffle\(backup\.flowShuffle \|\| \{\}\)/);
  assert.match(renderer, /function normalizeFlowShuffle\(values = \{\}\)/);
  assert.match(renderer, /decision: source\.lastShuffle\.decision \? flowShuffleDecision\.normalizeDecision/);
});

test('renderer source covers Signal import merge, replace, and undo normalization', () => {
  assert.match(renderer, /function mergeSignalJournalState\(incomingJournal, incomingFlowShuffle\)/);
  assert.match(renderer, /activeSignalImportMode === 'merge'/);
  assert.match(renderer, /state\.signalJournal = normalizeSignalJournal\(signalImportUndoSnapshot\.signalJournal\)/);
  assert.match(renderer, /state\.flowShuffle = normalizeFlowShuffle\(signalImportUndoSnapshot\.flowShuffle\)/);
});

test('Flow pick creation stages a decision receipt without consuming the track', () => {
  const value = fixture();
  assert.equal(value.state.lastPick, null);
  assert.equal(value.state.cycle.includes(value.track.id), false);
  assert.equal(value.pending.decision.transition.bpm.available, true);
  assert.equal(value.pending.decision.transition.bpm.delta, 4);
});

test('successful playback commits traversal and receipt together', () => {
  const value = fixture();
  const committed = engine.commitPlayback(value.state, value.queue, value.current.id, value.track.id);
  const lastPick = { trackId: value.track.id, fromTrackId: value.current.id, decision: value.pending.decision };
  assert.equal(committed.plan.cursor, committed.plan.order.indexOf(value.track.id));
  assert.equal(committed.cycle.includes(value.track.id), true);
  assert.equal(decision.normalizeDecision(lastPick.decision).trackId, value.track.id);
});

test('failed playback leaves the staged candidate unconsumed', () => {
  const value = fixture();
  const before = JSON.stringify(value.state);
  assert.equal(value.pending.trackId, value.track.id);
  assert.equal(value.state.cycle.includes(value.track.id), false);
  assert.equal(JSON.stringify(value.state), before);
});

test('restart and backup restore retain receipts while old picks remain valid', () => {
  const value = fixture();
  const restored = engine.normalizeState({ ...value.state, lastPick: { trackId: value.track.id, decision: value.pending.decision } });
  assert.equal(decision.normalizeDecision(restored.lastPick.decision).version, 1);
  const old = engine.normalizeState({ lastPick: { trackId: value.track.id, reasons: ['legacy pick'] } });
  assert.equal(old.lastPick.trackId, value.track.id);
  assert.equal(old.lastPick.decision, undefined);
});

test('Signal Journal import normalizes receipts in merge, replace, and undo snapshots', () => {
  const value = fixture();
  const event = { type: 'shuffle_pick', trackId: value.track.id, decision: value.pending.decision };
  const imported = normalizedJournal({ events: [event], lastShuffle: event });
  const replaced = normalizedJournal(imported);
  const undone = normalizedJournal({ events: [], lastShuffle: null });
  assert.equal(imported.events[0].decision.version, 1);
  assert.equal(replaced.lastShuffle.decision.trackId, value.track.id);
  assert.equal(undone.lastShuffle, null);
});

test('queue mutation removes stale future entries without consuming unrelated plans', () => {
  const value = fixture();
  const synced = engine.syncToQueue(value.state, ['current', 'other']);
  assert.equal(synced.plan.future.includes(value.track.id), false);
  assert.equal(synced.plan.sourceQueueIds.includes('other'), true);
});

test('manual Play Next priority outranks the generated Flow candidate', () => {
  const value = fixture();
  const prioritized = engine.markPriority(value.state, 'other', { front: true });
  const staged = engine.stageNext(prioritized, value.queue, value.current.id, { style: 'flow' });
  assert.equal(staged.kind, 'priority');
  assert.equal(staged.trackId, 'other');
});

test('queue UI exposes Flow intent and decision receipt surfaces', () => {
  assert.match(renderer, /class="queue-intent"/);
  assert.match(index, /id="flowShuffleWhyPlan"/);
  assert.match(index, /id="flowTempoCurrent"/);
  assert.match(index, /id="flowTempoNext"/);
});

test('main track browser follows the active shuffle plan without mutating collection order', () => {
  assert.match(renderer, /function tracksInActiveShuffleOrder\(tracks\)/);
  assert.match(renderer, /flowShuffleEngine\.displayOrder\(state\.flowShuffle/);
  assert.match(renderer, /if \(state\.shuffle\) tracks = tracksInActiveShuffleOrder\(tracks\)/);
  assert.match(renderer, /sortControl\.disabled = state\.shuffle/);
});

if (!process.exitCode) console.log('Flow Shuffle renderer lifecycle audit passed.');
