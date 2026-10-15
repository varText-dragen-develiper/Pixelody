'use strict';

// This suite drives the production reducers. It deliberately keeps offers,
// activations, and actual listening separate; no musical-quality claim follows
// from deterministic policy correctness or a Node selection benchmark.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const U = require('../src/shuffle/universal.js');
const L = require('../src/shuffle/learning.js');
const S = require('../src/shuffle/scopes.js');
const Legacy = require('../src/flow-shuffle-engine.js');

const ROOT = path.resolve(__dirname, '..');
const RECEIPTS = path.join(ROOT, '.artifacts/shuffle-universal/core');
const FIXED_NOW = 1791676800000;
const DAY = 86400000;
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fileHash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const results = [];
const failures = [];
let attemptSequence = 0;
let restoreComparisons = 0;
let confirmedDecisions = 0;
let intervalSequence = 0;
let learningSequence = 0;
let invariantChecks = 0;
const violations = { automaticEntitlement: 0, explicitIntent: 0, restoreMismatch: 0, contamination: 0, projectionMismatch: 0, staleOrDuplicateCommit: 0 };

function check(condition, message, category) {
  invariantChecks += 1;
  if (!condition && category) violations[category] += 1;
  assert.ok(condition, message);
}

function equal(actual, expected, message, category) {
  invariantChecks += 1;
  try { assert.deepEqual(actual, expected, message); }
  catch (error) { if (category) violations[category] += 1; throw error; }
}

function fixture(count, options = {}) {
  const labels = ['東京', 'e\u0301', 'é', 'a|b:c', '𝄞', 'العربية'];
  return Array.from({ length: count }, (_, i) => ({
    entryId: JSON.stringify([options.scope || 'library', 'entry', i, labels[i % labels.length]]),
    trackId: JSON.stringify(['track', i, labels[i % labels.length]]),
    artistId: options.sparse ? null : options.skew && i < Math.floor(count * 0.9) ? 'dominant' : `artist:${i % 100}`,
    albumArtistId: options.sparse ? null : `album-artist:${Math.floor(i / 10)}`,
    albumId: options.sparse ? null : `album:${Math.floor(i / 10)}`,
    recordingId: options.sparse ? null : `recording:${i}`,
    discNumber: options.sparse ? null : Math.floor((i % 10) / 5) + 1,
    trackNumber: options.sparse ? null : (i % 5) + 1,
    genreId: options.sparse ? null : `genre:${i % 7}`,
    contextTags: options.sparse ? [] : [i % 2 ? 'night' : 'day'],
    features: options.sparse ? {} : {
      tempo: { value: 80 + (i % 81), provenance: 'tagged' },
      energy: { value: (i % 101) / 100, provenance: 'measured', confidencePermille: 700 },
      key: { value: `${i % 12 + 1}${i % 2 ? 'A' : 'B'}`, provenance: 'tagged' },
    },
  }));
}

function session(entries, mode, extra = {}) {
  return U.createSession({ entries, mode, repeat: 'off', sessionId: `simulation:${mode}`,
    scopeId: `scope:${mode}`, authorityId: 'local:simulation', seed: `simulation-v2:${mode}`, ...extra });
}

function advance(state, request = {}, context = {}) {
  const attemptId = JSON.stringify(['simulation-attempt', ++attemptSequence]);
  const event = { type: 'stage', attemptId, advanceId: attemptId, ...request };
  const staged = U.reduce(state, event, context);
  if (!staged.pending) return { state: staged, decision: null };
  equal(U.stage(staged, event, context), staged, 'same stage retry must be idempotent', 'staleOrDuplicateCommit');
  equal(staged.remaining, state.remaining, 'staging consumes no entitlement', 'automaticEntitlement');
  equal(staged.rng, state.rng, 'staging does not commit RNG');
  equal(staged.history, state.history, 'staging does not fabricate history');
  const committed = U.reduce(staged, { type: 'activate-success', ...staged.pending });
  equal(U.commit(committed, staged.pending), committed, 'duplicate activation cannot advance', 'staleOrDuplicateCommit');
  confirmedDecisions += 1;
  return { state: committed, decision: staged.pending.receipt };
}

function coldRestore(state, context = {}) {
  const saved = JSON.stringify(state);
  const restored = U.restore(JSON.parse(saved));
  equal(restored.status, 'restored', 'valid checkpoint restores', 'restoreMismatch');
  check(restored.state.paused === true, 'cold restoration is paused', 'restoreMismatch');
  for (const field of ['entries', 'remaining', 'rng', 'cycle', 'history', 'cursor', 'occurrenceSequence', 'generatedFuture', 'manual', 'exclusions', 'albumLock', 'scopeId', 'membershipRevision'])
    equal(restored.state[field], state[field], `restore preserves ${field}`, 'restoreMismatch');
  const before = U.project(state, { horizon: 3, context });
  const after = U.project(restored.state, { horizon: 3, context });
  equal(after, before, 'cold restart preserves decision projection byte for byte', 'restoreMismatch');
  equal(JSON.stringify(state), saved, 'projection and restore do not mutate source');
  restoreComparisons += 1;
  return restored.state;
}

function droughts(sequence, identities) {
  const seen = new Map();
  const gaps = [];
  for (let i = 0; i < sequence.length; i += 1) {
    const identity = identities(sequence[i]);
    if (identity == null) continue;
    if (seen.has(identity)) gaps.push(i - seen.get(identity) - 1);
    seen.set(identity, i);
  }
  const sorted = gaps.slice().sort((a, b) => a - b);
  return { measuredBetweenAppearances: gaps.length, maximumOpportunities: gaps.length ? sorted[sorted.length - 1] : null,
    p95Opportunities: gaps.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    observedIdentities: seen.size, note: 'Only closed gaps are measured; one-cycle track gaps are censored, not zero.' };
}

function sequenceMetrics(sequence, entries, prefixes = []) {
  const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
  const prefixKeys = prefixes.map((prefix) => JSON.stringify(prefix.slice(0, 3)));
  const repeatPrefixes = prefixKeys.length - new Set(prefixKeys).size;
  const relaxationCounts = {};
  for (const decision of sequence) for (const relaxation of decision.relaxations) relaxationCounts[relaxation] = (relaxationCounts[relaxation] || 0) + 1;
  return { opportunities: sequence.length, activatedOccurrences: sequence.length, completedListening: 0,
    uniqueEntriesActivated: new Set(sequence.map((decision) => decision.entryId)).size,
    uniqueTracksActivated: new Set(sequence.map((decision) => decision.trackId)).size,
    repeatedPrefix: { prefixLength: 3, sessions: prefixKeys.length, repeatedSessions: repeatPrefixes, rate: prefixKeys.length ? repeatPrefixes / prefixKeys.length : 0 },
    droughts: { track: droughts(sequence, (d) => d.trackId), artist: droughts(sequence, (d) => byId.get(d.entryId)?.artistId), album: droughts(sequence, (d) => byId.get(d.entryId)?.albumId) },
    relaxationCounts, explorationDecisions: sequence.filter((decision) => decision.exploration).length,
    note: 'Activation coverage is not evidence of audible or completed listening.' };
}

function learningEvent(ledger, type, details = {}, nowMs = ledger.clockFloorMs) {
  const producer = ledger.producers.find((p) => p.producerId === 'simulation:service');
  const sequence = producer ? Math.max(producer.through, ...producer.pending) + 1 : 1;
  const event = { schemaVersion: L.VERSION, eventId: `simulation:event:${++learningSequence}`, producerId: 'simulation:service', sequence, timestampMs: nowMs, type, ...details };
  const next = L.reduce(ledger, event, { nowMs });
  equal(L.reduce(next, event, { nowMs }), next, 'learning event retry is idempotent', 'contamination');
  return next;
}

function listen(ledger, trackId, occurrenceId, nowMs, options = {}) {
  const durationMs = options.durationMs || 200000;
  ledger = learningEvent(ledger, 'activated', { trackId, occurrenceId, durationMs, replay: options.replay === true }, nowMs);
  const heardMs = options.heardMs === undefined ? durationMs : options.heardMs;
  for (let position = 0; position < heardMs; position += 60000) {
    const end = Math.min(heardMs, position + 60000);
    ledger = learningEvent(ledger, 'interval', { trackId, occurrenceId, monotonicClockId: `clock:${++intervalSequence}`,
      monotonicStartMs: position, monotonicEndMs: end, mediaStartMs: position, mediaEndMs: end,
      playing: true, speedPermille: 1000 }, nowMs + end);
  }
  return learningEvent(ledger, 'outcome', { trackId, occurrenceId, outcome: options.outcome || 'natural-end', userInitiated: options.outcome === 'deliberate-skip' || options.replay === true }, nowMs + heardMs);
}

function test(name, callback) {
  const start = performance.now();
  try {
    const metrics = callback();
    const result = { name, passed: true, elapsedMs: Number((performance.now() - start).toFixed(3)), metrics };
    results.push(result);
    console.log(`PASS ${name} (${result.elapsedMs} ms)`);
  } catch (error) {
    const result = { name, passed: false, elapsedMs: Number((performance.now() - start).toFixed(3)), error: error.message, stack: error.stack };
    results.push(result); failures.push(result);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

test('v1 UTF-16 FNV / Mulberry32 / Fisher-Yates compatibility', () => {
  equal(U.hashSeed('hello'), 1335831723, 'pinned FNV-1a hello vector');
  const seeds = ['', 'seed', 'hello', '東京', 'e\u0301', 'é', '𝄞|:', '0', '4294967295'];
  let drawsCompared = 0;
  let permutationsCompared = 0;
  for (const seed of seeds) {
    let rng = U.createRng(seed);
    const old = Legacy.createSeededRandom(seed);
    for (let i = 0; i < 256; i += 1) {
      const next = U.draw(rng);
      equal(next.value, Math.floor(old() * 4294967296), `v1 draw ${seed}/${i}`);
      rng = next.rng; drawsCompared += 1;
    }
    for (const count of [0, 1, 2, 17, 257, 1000]) {
      const values = Array.from({ length: count }, (_, i) => `value:${i}`);
      equal(U.permutation(values, U.createRng(seed)).order, Legacy.shuffledIds(values, Legacy.createSeededRandom(seed)), `v1 permutation ${seed}/${count}`);
      permutationsCompared += 1;
    }
  }
  return { seeds, drawsCompared, permutationsCompared, algorithm: U.createRng('seed').algorithm,
    limitation: 'A finite 32-bit PRNG and floor mapping have finite-state/bounded-draw bias; this is compatibility, not cryptographic randomness or proof of uniform permutations.' };
});

test('Random finite-PRNG distribution sanity across 4096 independent seeds', () => {
  const count = 10, seedCount = 4096;
  const counts = Array.from({ length: count }, () => Array(count).fill(0));
  for (let seed = 0; seed < seedCount; seed += 1) {
    const order = U.permutation(Array.from({ length: count }, (_, i) => i), U.createRng(`distribution-v2:${seed}`)).order;
    check(new Set(order).size === count, 'random permutation contains every item');
    order.forEach((value, position) => { counts[position][value] += 1; });
  }
  const expected = seedCount / count;
  const chiSquares = counts.map((row) => row.reduce((sum, value) => sum + (value - expected) ** 2 / expected, 0));
  const extremes = counts.flat();
  check(chiSquares.every((value) => value < 60), 'position marginals fail gross distribution sanity');
  check(Math.max(...extremes) / Math.min(...extremes) < 1.6, 'gross position-frequency imbalance');
  return { count, seedCount, expectedPerCell: expected, chiSquares, minimumCell: Math.min(...extremes), maximumCell: Math.max(...extremes),
    threshold: { chiSquarePerPosition: 60, maxMinRatio: 1.6 },
    limitation: 'Fixed-seed regression sanity, not statistical proof of uniformity; Balanced and Flow are intentionally weighted.' };
});

for (const mode of U.MODES) test(`${mode}: 1000 items / 100 ten-item sessions with cold restarts`, () => {
  const entries = fixture(1000);
  let state = session(entries, mode);
  const sequence = [], prefixes = [];
  const consumed = new Set();
  for (let visit = 0; visit < 100; visit += 1) {
    state = coldRestore(state);
    state = U.reduce(state, { type: 'session-change', sessionId: `${mode}:visit:${visit}` });
    const prefix = [];
    for (let n = 0; n < 10; n += 1) {
      const expected = U.project(state, { horizon: 1 }).entryIds[0];
      const next = advance(state);
      check(next.decision != null, 'all unfinished entitlement remains available', 'automaticEntitlement');
      equal(next.decision.entryId, expected, 'projection equals activation candidate', 'projectionMismatch');
      check(!consumed.has(next.decision.entryId), 'automatic entry repeats within cycle', 'automaticEntitlement');
      consumed.add(next.decision.entryId);
      sequence.push(next.decision); prefix.push(next.decision.entryId); state = next.state;
    }
    prefixes.push(prefix);
    equal(state.remaining.length, 1000 - (visit + 1) * 10, 'short sessions retain unfinished entitlement', 'automaticEntitlement');
  }
  equal(consumed.size, 1000, 'all eligible source entries activated in 1000 opportunities', 'automaticEntitlement');
  equal(advance(state).decision, null, 'Repeat Off terminates');
  const originalCycle = state.cycle.generation;
  state = U.reduce(state, { type: 'repeat-change', repeat: 'all' });
  const next = advance(state);
  equal(next.state.cycle.generation, originalCycle + 1, 'Repeat All advances one cycle');
  equal(next.state.remaining.length, 999, 'exactly one next-cycle entitlement consumed');
  return { ...sequenceMetrics(sequence, entries, prefixes), restoredSessions: 100, fullCycleCoveragePermille: 1000,
    finalTraversalSha256: digest(sequence.map((decision) => decision.entryId)) };
});

for (const kind of ['skew', 'sparse']) for (const mode of ['random', 'balanced', 'flow', 'album']) test(`${mode}: full-cycle ${kind} metadata library`, () => {
  const entries = fixture(200, { [kind]: true });
  let state = session(entries, mode, { seed: `${mode}:${kind}` });
  const sequence = [];
  while (state.remaining.length) {
    const next = advance(state);
    check(next.decision !== null, 'soft constraints cannot delete remaining music', 'automaticEntitlement');
    if (kind === 'sparse') {
      equal(next.decision.signalCoverage.filter((signal) => ['tempo', 'energy', 'key'].includes(signal)), [], 'unknown metadata cannot invent acoustic evidence', 'contamination');
      if (next.decision.scoreParts) equal([next.decision.scoreParts.tempo, next.decision.scoreParts.energy, next.decision.scoreParts.key], [0, 0, 0], 'missing acoustic features contribute zero selection points', 'contamination');
      if (next.decision.scoreParts) for (const field of ['tempo', 'energy', 'key']) equal(next.decision.scoreParts[field], 0, 'unknown feature contribution is zero', 'contamination');
    }
    sequence.push(next.decision); state = next.state;
  }
  equal(new Set(sequence.map((d) => d.entryId)).size, 200, 'sparse/skew coverage is complete', 'automaticEntitlement');
  const metrics = sequenceMetrics(sequence, entries);
  if (kind === 'skew' && ['balanced', 'flow'].includes(mode)) check(metrics.relaxationCounts.artist > 0, 'impossible artist spacing must be reported');
  return metrics;
});

test('membership edits, imports, removals, unavailable sources, undo and mode changes', () => {
  let entries = fixture(80);
  let state = session(entries, 'random');
  for (let i = 0; i < 15; i += 1) state = advance(state).state;
  const history = clone(state.history);
  const consumed = new Set(history.map((h) => h.entryId));
  const removed = state.remaining.slice(5, 15);
  entries = entries.filter((e) => !removed.includes(e.entryId));
  const imported = fixture(10, { scope: 'imported' }).map((e, i) => ({ ...e, trackId: `imported-track:${i}` }));
  entries.push(...imported);
  state = U.reconcile(state, entries, { membershipRevision: 1 });
  equal(state.history, history, 'future removal preserves confirmed history');
  equal(state.remaining.length, 65, 'ten imports replace ten removed unfinished entries');
  for (const mode of ['flow', 'balanced', 'album', 'off', 'random']) {
    const before = clone(state.remaining);
    state = U.reduce(state, { type: 'mode-change', mode });
    equal(state.remaining, before, 'mode changes preserve entitlement', 'automaticEntitlement');
  }
  const projected = U.project(state, { horizon: 10 }).entryIds;
  state = U.setMode(state, 'off');
  equal(U.project(state, { horizon: 10 }).entryIds, projected, 'Off freezes projected traversal', 'projectionMismatch');
  const target = state.remaining[state.remaining.length - 1];
  state = U.mutate(state, { type: 'exclude', entryId: target });
  check(!U.project(state, { horizon: 32 }).entryIds.includes(target), 'excluded entry is absent from automatic future');
  state = U.mutate(state, { type: 'undo' });
  check(!state.exclusions.includes(target), 'undo restores exclusion');
  state = U.mutate(state, { type: 'priority', entryId: target, intentId: 'priority:import-test' });
  const manual = advance(state);
  equal(manual.decision.entryId, target, 'priority overrides generated order', 'explicitIntent');
  check(manual.decision.explicitException, 'priority exception is labeled', 'explicitIntent');
  state = manual.state; consumed.add(manual.decision.entryId);
  while (state.remaining.length) {
    const next = advance(state);
    check(next.decision !== null, 'reconciled tail is selectable', 'automaticEntitlement');
    check(!consumed.has(next.decision.entryId), 'imports do not reopen old entitlement', 'automaticEntitlement');
    consumed.add(next.decision.entryId); state = next.state;
  }
  const victim = history[0].entryId;
  state = U.reconcile(state, entries.filter((e) => e.entryId !== victim), { membershipRevision: 2 });
  check(state.history.find((h) => h.entryId === victim).tombstone, 'played removal retains tombstone');
  let inaccessible = session(fixture(3).map((e) => ({ ...e, available: false })), 'flow', { repeat: 'all' });
  equal(advance(inaccessible).decision, null, 'unavailable pool stops');
  equal(inaccessible.remaining.length, 3, 'unavailable entitlements remain recoverable');
  const beforeCycle = inaccessible.cycle.generation;
  inaccessible = U.reconcile(inaccessible, fixture(3), { membershipRevision: 1 });
  const recovery = advance(inaccessible);
  equal(recovery.state.cycle.generation, beforeCycle, 'source recovery continues existing cycle');
  return { startingEntries: 80, initiallyActivated: 15, removedUnfinished: 10, importedEntries: 10,
    uniqueEntriesEventuallyActivated: consumed.size, preservedHistoryTombstones: 1, explicitIntentViolations: 0 };
});

test('bounded many-failure attempts, pending crash, stale authority and duplicate callbacks', () => {
  let state = session(fixture(80), 'random');
  const initialRemaining = clone(state.remaining), initialRng = clone(state.rng);
  const failed = [];
  for (let i = 0; i < U.CONFIG.maxFailures; i += 1) {
    const staged = U.stage(state, { attemptId: `decode:${i}`, advanceId: 'one-bounded-advance' });
    check(staged.pending != null, 'retry budget can offer another recoverable candidate');
    check(!failed.includes(staged.pending.entryId), 'active advance quarantines failed candidate');
    failed.push(staged.pending.entryId);
    const aborted = U.abort(staged, staged.pending);
    equal(U.abort(aborted, staged.pending), aborted, 'duplicate failure callback is inert');
    state = aborted;
    equal(state.remaining, initialRemaining, 'failure preserves entitlement', 'automaticEntitlement');
    equal(state.rng, initialRng, 'failure preserves committed RNG');
    equal(state.history.length, 0, 'failure creates no confirmed occurrence');
  }
  equal(U.stage(state, { attemptId: 'budget-stop', advanceId: 'one-bounded-advance' }).pending, null, 'retry budget stops');
  const staged = U.stage(state, { attemptId: 'retry-after-restart', advanceId: 'fresh-advance' });
  check(staged.pending != null, 'new advance can recover quarantined entries');
  const restored = U.restore(clone(staged));
  equal(restored.status, 'restored', 'pending activation checkpoint restores');
  equal(restored.state.pending, null, 'unconfirmed pending activation is aborted at cold restore');
  equal(restored.state.remaining, initialRemaining, 'crash does not retrospectively consume', 'automaticEntitlement');
  equal(restored.state.rng, initialRng, 'crash does not retrospectively advance RNG');
  equal(U.stage(restored.state, { attemptId: 'post-crash', advanceId: 'new' }).pending.entryId, staged.pending.entryId, 'restart repeats unconsumed random candidate');
  const transferred = U.reduce(staged, { type: 'authority-change', authorityId: 'new-authority', authorityEpoch: 1 });
  equal(U.commit(transferred, staged.pending), transferred, 'old authority callback rejected', 'staleOrDuplicateCommit');
  return { failedActivations: failed.length, uniqueQuarantined: new Set(failed).size, consumedAfterFailures: 0,
    pendingCrashConsumed: 0, staleAuthorityAdvances: 0, connectedHandoff: 'Reducer boundary only; root-owned connected protocol acceptance remains open.' };
});

test('bounded stable scope bank, explicit unfinished eviction and scheduler producer replay', () => {
  let bank = S.createBank();
  const scopes = [];
  for (let i = 0; i < S.MAX_SCOPES; i += 1) {
    const scopeId = `retained-scope:${i}`;
    let state = session(fixture(10), 'balanced', { scopeId, sessionId: `scope-visit:${i}`, seed: `bank:${i}` });
    state = advance(state).state;
    const saved = S.save(bank, state, { nowMs: FIXED_NOW + i });
    equal(saved.status, 'saved', 'stable scope is persistable');
    bank = saved.bank; scopes.push(scopeId);
    const restored = S.restore(JSON.parse(JSON.stringify(bank)), scopeId);
    equal(restored.status, 'restored', 'scope bank restores by durable identity');
    equal(restored.state.remaining, state.remaining, 'scope bank retains unfinished entitlement', 'restoreMismatch');
    equal(restored.state.rng, state.rng, 'scope bank retains RNG', 'restoreMismatch');
    check(restored.state.paused, 'scope bank cold-restores paused');
  }
  const overflow = session(fixture(10), 'balanced', { scopeId: 'bank:overflow' });
  const refused = S.save(bank, overflow, { nowMs: FIXED_NOW });
  equal(refused.status, 'capacity-requires-explicit-eviction', 'full bank refuses silent scope eviction');
  equal(refused.bank, bank, 'capacity refusal preserves full saved bank');
  equal(refused.unfinished.length, S.MAX_SCOPES, 'unfinished scopes are disclosed');
  const removed = S.evict(bank, scopes[0], { nowMs: FIXED_NOW + DAY });
  equal(removed.status, 'evicted', 'explicit eviction is supported');
  equal(removed.diagnostic.completed, false, 'unfinished eviction never claims completion');
  equal(removed.diagnostic.unfinishedEntitlements, 9, 'eviction reports discarded unfinished count');
  equal(S.restore(removed.bank, scopes[0]).status, 'explicitly-evicted', 'later restore explains explicit eviction');
  bank = S.save(removed.bank, overflow, { nowMs: FIXED_NOW + DAY }).bank;
  for (let i = 0; i < S.MAX_EVICTION_DIAGNOSTICS + 10; i += 1) {
    const scopeId = bank.scopes[0].scopeId;
    bank = S.evict(bank, scopeId, { nowMs: FIXED_NOW + DAY + i }).bank;
    bank = S.save(bank, session(fixture(1), 'random', { scopeId: `rotation:${i}` }), { nowMs: FIXED_NOW + DAY + i }).bank;
  }
  equal(bank.scopes.length, S.MAX_SCOPES, 'scope retention remains bounded');
  equal(bank.evictions.length, S.MAX_EVICTION_DIAGNOSTICS, 'eviction diagnostics remain bounded');
  let state = session(fixture(4), 'balanced');
  const command = { type: 'explicit-new-cycle', eventId: 'producer:event:1', producerId: 'producer:transport', sequence: 1 };
  state = U.reduce(state, command);
  const generation = state.cycle.generation;
  equal(U.reduce(state, command), state, 'duplicate destructive scheduler event is idempotent');
  state = U.restore(JSON.parse(JSON.stringify(state))).state;
  equal(U.reduce(state, command), state, 'scheduler producer watermark survives restart');
  equal(state.cycle.generation, generation, 'duplicate new-cycle command does not reset entitlement again');
  assert.throws(() => U.reduce(state, { ...command, eventId: 'producer:event:3', sequence: 3 }), /gap/i, 'producer gaps are explicit');
  return { retainedScopes: bank.scopes.length, retainedEvictionDiagnostics: bank.evictions.length,
    silentUnfinishedEvictions: 0, firstExplicitEvictionUnfinishedEntitlements: 9,
    schedulerReplayedNewCycles: 0, serializedBankBytes: Buffer.byteLength(JSON.stringify(bank)) };
});

test('intentional duplicate entries, Previous/forward, Play Next, Play Now and Repeat One', () => {
  const entries = fixture(8);
  entries[1].trackId = entries[0].trackId;
  let state = session(entries, 'off');
  const first = advance(state); state = first.state;
  const second = advance(state); state = second.state;
  equal(first.decision.trackId, second.decision.trackId, 'intentional same-track entries remain separate');
  check(first.decision.entryId !== second.decision.entryId, 'duplicate track entries retain distinct identities');
  const occurrences = state.history.map((h) => h.occurrenceId);
  state = advance(state).state;
  const thirdOccurrence = U.currentOccurrence(state).occurrenceId;
  const previous = advance(state, { direction: 'previous' }); state = previous.state;
  equal(U.currentOccurrence(state).occurrenceId, occurrences[1], 'Previous traverses confirmed occurrence');
  const forward = advance(state); state = forward.state;
  equal(U.currentOccurrence(state).occurrenceId, thirdOccurrence, 'Next follows retained occurrence');
  state = advance(state, { direction: 'previous' }).state;
  state = U.mutate(state, { type: 'priority', entryId: entries[6].entryId, intentId: 'intent:new-next' });
  const manual = advance(state); state = manual.state;
  equal(manual.decision.entryId, entries[6].entryId, 'new priority supersedes retained forward history', 'explicitIntent');
  equal(state.history.length, 3, 'new intent forks retained forward history');
  const replay = advance(state, { entryId: entries[0].entryId }); state = replay.state;
  equal(replay.decision.kind, 'play-now', 'explicit replay receipt is honest', 'explicitIntent');
  check(!occurrences.includes(U.currentOccurrence(state).occurrenceId), 'explicit replay creates genuine new occurrence');
  const remaining = clone(state.remaining), generation = state.cycle.generation;
  state = U.reduce(state, { type: 'repeat-change', repeat: 'one' });
  const beforeOccurrence = U.currentOccurrence(state).occurrenceId;
  const repeated = advance(state, { naturalEnd: true }); state = repeated.state;
  equal(repeated.decision.kind, 'repeat-one', 'natural end honors Repeat One');
  check(U.currentOccurrence(state).occurrenceId !== beforeOccurrence, 'Repeat One creates genuine new occurrence');
  equal(state.remaining, remaining, 'Repeat One preserves other entitlement');
  equal(state.cycle.generation, generation, 'Repeat One does not invent generation');
  check(advance(state).decision.entryId !== repeated.decision.entryId, 'manual Next bypasses Repeat One');
  let unavailable = session(entries.map((e, i) => ({ ...e, available: i !== 7 })), 'off');
  equal(advance(unavailable, { entryId: entries[7].entryId }).decision, null, 'unavailable explicit intent must not silently substitute', 'explicitIntent');
  return { intentionalEntriesPreserved: 2, distinctPlaybackOccurrences: new Set(state.history.map((h) => h.occurrenceId)).size,
    explicitReplays: 1, repeatOneReplays: 1, explicitIntentViolations: 0 };
});

test('long multidisc compilation album across bounded horizons, restarts and explicit overrides', () => {
  const entries = fixture(60).map((e, i) => ({ ...e, albumId: 'compilation:one', albumArtistId: 'Various Artists', artistId: `performer:${i}`,
    discNumber: Math.floor(i / 20) + 1, trackNumber: i % 20 + 1 }));
  let state = session(entries, 'album');
  const sequence = [];
  for (let i = 0; i < entries.length; i += 1) {
    if (i % 7 === 0) state = coldRestore(state);
    const projected = U.project(state, { horizon: 3 }).entryIds[0];
    const next = advance(state);
    equal(next.decision.entryId, entries[i].entryId, 'multidisc compilation order survives horizon/restart');
    equal(next.decision.entryId, projected, 'album projection matches actual transport', 'projectionMismatch');
    sequence.push(next.decision); state = next.state;
  }
  let midway = session(entries, 'album');
  midway = advance(midway, { entryId: entries[35].entryId }).state;
  const removed = entries[40].entryId;
  midway = U.mutate(midway, { type: 'remove', entryId: removed });
  midway = coldRestore(midway);
  for (let i = 36; i < entries.length; i += 1) {
    if (i === 40) continue;
    const next = advance(midway);
    equal(next.decision.entryId, entries[i].entryId, 'manual midpoint continues only remaining later siblings');
    midway = next.state;
  }
  equal(midway.remaining.length, 35, 'earlier unplayed album siblings remain owed', 'automaticEntitlement');
  check(!midway.remaining.includes(removed), 'lock does not recreate removed sibling');
  midway = U.setMode(midway, 'random');
  equal(midway.albumLock, null, 'leaving album releases continuation lock');
  const missing = entries.slice(0, 20).map((e, i) => ({ ...e, discNumber: i === 7 ? null : e.discNumber }));
  let fallback = session(missing.slice().reverse(), 'album');
  const fallbackOrder = [];
  while (fallback.remaining.length) {
    const next = advance(fallback); fallbackOrder.push(next.decision.entryId);
    equal(next.decision.albumOrdering, 'source-order-missing-numbers', 'metadata gap limitation is reported');
    fallback = next.state;
  }
  equal(fallbackOrder, missing.slice().reverse().map((e) => e.entryId), 'partial numbering keeps source order');
  return { compilationTracks: 60, discs: 3, maximumPreviewHorizonUsed: 3, coldRestarts: 10,
    manualMidpoint: 35, preservedEarlierEntitlements: 35, removedSiblingRecreated: 0, missingNumberSourceFallback: 20,
    traversalSha256: digest(sequence.map((d) => d.entryId)) };
});

test('six weeks of twenty-minute sessions, stable scopes, global exposure and preference reversal', () => {
  const entries = fixture(300);
  const priorHeard = new Map(entries.map((entry, i) => [entry.trackId, i < 120 ? Math.floor(i / 12) : 0]));
  let ledger = L.createLedger({ nowMs: FIXED_NOW });
  for (let i = 0; i < 120; i += 1) for (let n = 0; n < priorHeard.get(entries[i].trackId); n += 1)
    ledger = listen(ledger, entries[i].trackId, `prior:${i}:${n}`, FIXED_NOW + i * 1000000 + n * 60000, { durationMs: 60000 });
  let nowMs = ledger.clockFloorMs + DAY;
  const bank = new Map([
    ['library', session(entries, 'flow', { scopeId: 'durable-library', seed: 'weeks:library' })],
    ['playlist', session(entries.slice(0, 120), 'flow', { scopeId: 'durable-playlist', seed: 'weeks:playlist' })],
    ['queue', session(entries.slice(60, 120), 'flow', { scopeId: 'durable-custom-queue', seed: 'weeks:queue', repeat: 'all' })],
  ]);
  let scopeBank = S.createBank();
  for (const state of bank.values()) scopeBank = S.save(scopeBank, state, { nowMs }).bank;
  const scopes = [...bank.keys()], sequence = [], prefixes = [];
  const selectedByDecile = Array(10).fill(0);
  const scopedSeen = new Map(scopes.map((scope) => [scope, new Map()]));
  const heardBefore = L.summarize(ledger).heardOccurrences;
  const wallBefore = L.summarize(ledger).heardWallMs;
  const reversalTrack = entries[12].trackId;
  ledger = learningEvent(ledger, 'preference', { trackId: reversalTrack, value: 1 }, nowMs);
  const positive = L.trackSignals(ledger, reversalTrack, { nowMs }).tastePoints;
  let reversed = null;
  for (let day = 0; day < 42; day += 1) {
    const scope = scopes[day % scopes.length];
    const scopeRestore = S.restore(scopeBank, bank.get(scope).scopeId);
    equal(scopeRestore.status, 'restored', 'week session restores stable scope through production scope bank');
    let state = scopeRestore.state;
    const context = () => ({ nowMs, signals: entries.map((entry) => ({ trackId: entry.trackId, ...L.trackSignals(ledger, entry.trackId, { nowMs }) })) });
    state = coldRestore(state, context());
    state = U.reduce(state, { type: 'session-change', sessionId: `weeks:${scope}:${day}` });
    const prefix = [];
    if (day === 21) {
      ledger = learningEvent(ledger, 'preference', { trackId: reversalTrack, value: -1 }, nowMs);
      reversed = L.trackSignals(ledger, reversalTrack, { nowMs }).tastePoints;
    }
    for (let i = 0; i < 6; i += 1) {
      const next = advance(state, {}, context());
      check(next.decision !== null, 'week session retains active scope entitlement', 'automaticEntitlement');
      const current = U.currentOccurrence(next.state);
      const key = `${next.state.cycle.generation}`;
      const seenCycles = scopedSeen.get(scope);
      if (!seenCycles.has(key)) seenCycles.set(key, new Set());
      check(!seenCycles.get(key).has(next.decision.entryId), 'scope cycle does not repeat automatic entitlement', 'automaticEntitlement');
      seenCycles.get(key).add(next.decision.entryId);
      ledger = learningEvent(ledger, 'offered', { trackId: next.decision.trackId }, nowMs);
      ledger = listen(ledger, next.decision.trackId, current.occurrenceId, nowMs);
      selectedByDecile[priorHeard.get(next.decision.trackId)] += 1;
      sequence.push(next.decision); prefix.push(next.decision.entryId); state = next.state;
      nowMs += 200000;
    }
    prefixes.push(prefix); bank.set(scope, state);
    const savedScope = S.save(scopeBank, state, { nowMs });
    equal(savedScope.status, 'saved', 'ordinary session saves existing scope');
    scopeBank = JSON.parse(JSON.stringify(savedScope.bank)); nowMs += DAY - 1200000;
    const imported = L.importLedger(L.exportLedger(ledger, { includePrivate: true }));
    check(imported.ok, 'private ledger survives serializable restart'); ledger = imported.ledger;
  }
  check(positive > 0 && reversed < 0, 'explicit preference reversal changes sign conservatively');
  const totals = L.summarize(ledger);
  equal(totals.heardOccurrences - heardBefore, 252, 'real heard occurrences are counted separately from offers', 'contamination');
  equal(totals.heardWallMs - wallBefore, 42 * 1200000, 'six weeks contain actual twenty-minute sessions', 'contamination');
  for (const signal of entries.map((entry) => L.trackSignals(ledger, entry.trackId, { nowMs }))) check(Math.abs(signal.tastePoints) <= L.CONFIG.tasteLimit, 'personal taste is bounded');
  const metrics = sequenceMetrics(sequence, entries, prefixes);
  metrics.completedListening = 252;
  const afterExtendedDecay = L.trackSignals(ledger, reversalTrack, { nowMs: nowMs + 8 * L.CONFIG.decayPeriodMs }).tastePoints;
  equal(afterExtendedDecay, -L.CONFIG.explicitPoints, 'explicit reversed preference persists after implicit evidence decays');
  return { ...metrics, weeks: 6, sessions: 42, minutesPerSession: 20, actualHeardWallMs: totals.heardWallMs - wallBefore,
    offeredEvents: 252, actualHeardOccurrences: totals.heardOccurrences - heardBefore,
    exposureByPriorHeardDecile: selectedByDecile.map((activations, decile) => ({ decile, priorHeardPerTrack: decile,
      eligibleTracks: entries.filter((entry) => priorHeard.get(entry.trackId) === decile).length, subsequentActivations: activations })),
    scopeRemainders: [...bank].map(([scope, state]) => ({ scope, durableScopeId: state.scopeId, remaining: state.remaining.length, generation: state.cycle.generation })),
    explicitPreferenceReversal: { before: positive, after: reversed, afterExtendedDecay },
    journalRetained: ledger.journal.length, occurrencesRetained: ledger.occurrences.length,
    ledgerBytes: Buffer.byteLength(JSON.stringify(ledger)), retainedScopes: scopeBank.scopes.length,
    note: 'Scope-local fairness and global exposure share one local ledger. Short sessions here do not imply disconnected-device global no-repeat.' };
});

test('bounded learning retention, compacted-event replay and negative-taste exploration', () => {
  let ledger = L.createLedger({ nowMs: FIXED_NOW });
  const first = { schemaVersion: L.VERSION, eventId: 'retention:1', producerId: 'retention:producer', sequence: 1,
    type: 'offered', trackId: 'retention:track', timestampMs: FIXED_NOW };
  ledger = L.reduce(ledger, first, { nowMs: FIXED_NOW });
  for (let sequence = 2; sequence <= L.CONFIG.maxEventIds + 100; sequence += 1)
    ledger = L.reduce(ledger, { ...first, eventId: `retention:${sequence}`, sequence }, { nowMs: FIXED_NOW });
  equal(ledger.journal.length, L.CONFIG.maxJournal, 'journal retention is bounded');
  equal(ledger.seenEventIds.length, L.CONFIG.maxEventIds, 'event ID retention is bounded');
  check(!ledger.seenEventIds.includes(first.eventId), 'first event was compacted from retained event IDs');
  equal(L.reduce(ledger, first, { nowMs: FIXED_NOW }), ledger, 'producer checkpoint rejects replay after event-ID eviction', 'contamination');
  equal(ledger.tracks[0].offered, L.CONFIG.maxEventIds + 100, 'compact exposure count survives event pruning');
  const restored = L.importLedger(JSON.stringify(L.exportLedger(ledger, { includePrivate: true })));
  check(restored.ok, 'compacted private ledger imports');
  equal(L.reduce(restored.ledger, first, { nowMs: FIXED_NOW }), restored.ledger, 'compacted replay remains idempotent after restart', 'contamination');
  const entries = fixture(120);
  const signals = entries.map((entry, i) => ({ trackId: entry.trackId, tastePoints: i < 100 ? -12 : 12,
    exposure: i < 100 ? 0 : 100, noveltyPoints: i < 100 ? 12 : 0, lastHeardAtMs: i < 100 ? null : FIXED_NOW }));
  let state = session(entries, 'flow', { seed: 'negative-preference-cannot-delete-music' });
  const sequence = [];
  while (state.remaining.length) {
    const next = advance(state, {}, { nowMs: FIXED_NOW, signals });
    check(next.decision !== null, 'negative taste never excludes owed music', 'automaticEntitlement');
    if (!next.decision.exploration) check(next.decision.weight >= U.CONFIG.minWeight && next.decision.weight <= U.CONFIG.maxWeight, 'weighted selection has bounded influence');
    sequence.push(next.decision); state = next.state;
  }
  equal(new Set(sequence.map((d) => d.entryId)).size, 120, 'strong negative taste still covers complete cycle', 'automaticEntitlement');
  check(sequence.some((d) => d.exploration), 'fixed seed exercises bounded exploration');
  return { offeredEvents: ledger.tracks[0].offered, retainedJournal: ledger.journal.length,
    retainedEventIds: ledger.seenEventIds.length, duplicateAfterCompactionApplied: false,
    initiallyNegativeTracks: 100, negativeTracksEventuallyActivated: 100,
    explorationDecisions: sequence.filter((d) => d.exploration).length,
    ledgerBytes: Buffer.byteLength(JSON.stringify(ledger)) };
});

test('seek-heavy, infrastructure, nonpersonal, repeated-section and outcome contamination resistance', () => {
  let ledger = L.createLedger({ nowMs: FIXED_NOW });
  let nowMs = FIXED_NOW;
  let suppressedCases = 0;
  for (const reason of L.IGNORED_REASONS) {
    const trackId = `infrastructure:${reason}`, occurrenceId = `infra-occurrence:${reason}`;
    ledger = learningEvent(ledger, 'activated', { trackId, occurrenceId, durationMs: 200000 }, nowMs);
    ledger = learningEvent(ledger, 'interval', { trackId, occurrenceId, monotonicClockId: `infra-clock:${reason}`,
      monotonicStartMs: 0, monotonicEndMs: 10000, mediaStartMs: 0, mediaEndMs: 10000, playing: true, reason }, nowMs + 10000);
    ledger = learningEvent(ledger, 'outcome', { trackId, occurrenceId, outcome: 'deliberate-skip', userInitiated: true, reason }, nowMs + 10000);
    const row = ledger.tracks.find((t) => t.trackId === trackId);
    check(row.negativeUnits === 0 && row.positiveUnits === 0 && row.heardWallMs === 0, `${reason} cannot contaminate taste or heard time`, 'contamination');
    nowMs += 20000; suppressedCases += 1;
  }
  for (const source of ['remote', 'session', 'preview']) {
    const trackId = `nonpersonal:${source}`, occurrenceId = `nonpersonal-occurrence:${source}`;
    ledger = learningEvent(ledger, 'activated', { trackId, occurrenceId, durationMs: 200000, source }, nowMs);
    ledger = learningEvent(ledger, 'outcome', { trackId, occurrenceId, outcome: 'deliberate-skip', userInitiated: true, source }, nowMs);
    check(!ledger.tracks.some((t) => t.trackId === trackId), 'nonpersonal session action cannot create personal track evidence', 'contamination');
    suppressedCases += 1;
  }
  for (let i = 0; i < 100; i += 1) {
    const trackId = `seek:${i}`, occurrenceId = `seek-occurrence:${i}`;
    ledger = learningEvent(ledger, 'activated', { trackId, occurrenceId, durationMs: 200000 }, nowMs);
    ledger = learningEvent(ledger, 'interval', { trackId, occurrenceId, monotonicClockId: `seek-clock:${i}`,
      monotonicStartMs: 0, monotonicEndMs: 5000, mediaStartMs: 0, mediaEndMs: 200000, playing: true, discontinuity: i % 2 === 0 }, nowMs + 5000);
    ledger = learningEvent(ledger, 'outcome', { trackId, occurrenceId, outcome: 'natural-end' }, nowMs + 5000);
    const row = ledger.tracks.find((t) => t.trackId === trackId);
    check(row.positiveUnits === 0 && row.heardWallMs === 0, 'seek to end cannot manufacture completion evidence', 'contamination');
    nowMs += 6000;
  }
  const trackId = 'repeated-sections', occurrenceId = 'repeated-sections:occurrence';
  ledger = learningEvent(ledger, 'activated', { trackId, occurrenceId, durationMs: 200000 }, nowMs);
  for (let i = 0; i < 10; i += 1) ledger = learningEvent(ledger, 'interval', { trackId, occurrenceId,
    monotonicClockId: 'repeated:clock', monotonicStartMs: i * 20000, monotonicEndMs: (i + 1) * 20000,
    mediaStartMs: 0, mediaEndMs: 20000, playing: true }, nowMs + (i + 1) * 20000);
  ledger = learningEvent(ledger, 'outcome', { trackId, occurrenceId, outcome: 'natural-end' }, nowMs + 200000);
  const repeatedRow = ledger.tracks.find((t) => t.trackId === trackId);
  equal(repeatedRow.heardWallMs, 200000, 'repeated sections retain actual elapsed heard time');
  equal(repeatedRow.positiveUnits, 0, 'repeated same section does not manufacture media coverage', 'contamination');
  const heard = ledger.occurrences.find((o) => o.occurrenceId === occurrenceId);
  equal(L.coverageMs(heard), 20000, 'overlapping sections are unioned');
  const before = ledger;
  const futureEvent = { schemaVersion: L.VERSION, eventId: 'future:corrupt', type: 'preference', trackId, value: -1, timestampMs: before.clockFloorMs + L.CONFIG.maxFutureSkewMs + 1 };
  equal(L.reduce(ledger, futureEvent, { nowMs: ledger.clockFloorMs }), before, 'corrupt future event rejected');
  const rollback = L.reduce(ledger, { schemaVersion: L.VERSION, eventId: 'clock:rollback', type: 'offered', trackId, timestampMs: ledger.clockFloorMs }, { nowMs: ledger.clockFloorMs - DAY });
  check(rollback.diagnostics.clockRollbacks > 0, 'clock rollback is explicit');
  equal(rollback.clockFloorMs, ledger.clockFloorMs, 'clock rollback cannot reverse decay clock');
  return { ignoredInfrastructureCases: suppressedCases, seekToEndCases: 100, contaminatedOutcomes: 0,
    repeatedSectionWallMs: repeatedRow.heardWallMs, repeatedSectionCoverageMs: L.coverageMs(heard), falsePositiveCompletions: 0 };
});

test('ten-thousand-item production selection latency and memory', () => {
  const entries = fixture(10000);
  const signals = entries.map((entry, i) => ({ trackId: entry.trackId, tastePoints: i % 25 - 12, exposure: i % 10,
    noveltyPoints: i % 13, lastHeardAtMs: FIXED_NOW - i * 1000 }));
  const byMode = [];
  const memoryBefore = process.memoryUsage();
  for (const mode of ['random', 'balanced', 'flow', 'album']) {
    let state = session(entries, mode, { seed: `performance:${mode}` });
    for (let warm = 0; warm < 5; warm += 1) {
      const staged = U.stage(state, { attemptId: `warm:${mode}:${warm}` }, { nowMs: FIXED_NOW, signals });
      state = U.commit(staged, staged.pending);
    }
    const cpuBefore = process.cpuUsage(), times = [], firstTimes = [];
    // Fresh sessions cover initial full permutation/album selection costs;
    // continuing selections also cover retained traversal and live history.
    for (let i = 0; i < 80; i += 1) {
      const start = performance.now();
      const staged = U.stage(state, { attemptId: `perf:${mode}:${i}` }, { nowMs: FIXED_NOW, signals });
      state = U.commit(staged, staged.pending); times.push(performance.now() - start);
    }
    for (let i = 0; i < 20; i += 1) {
      const fresh = session(entries, mode, { seed: `performance:first:${mode}:${i}` });
      const start = performance.now();
      U.stage(fresh, { attemptId: `first:${i}` }, { nowMs: FIXED_NOW, signals }); firstTimes.push(performance.now() - start);
    }
    const sorted = times.slice().sort((a, b) => a - b), firstSorted = firstTimes.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1], firstP95 = firstSorted[Math.ceil(firstSorted.length * 0.95) - 1];
    const cpu = process.cpuUsage(cpuBefore);
    byMode.push({ mode, continuingSamples: times.length, firstSamples: firstTimes.length,
      continuingP50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], continuingP95Ms: p95, continuingMaximumMs: Math.max(...times),
      firstP95Ms: firstP95, firstMaximumMs: Math.max(...firstTimes), p95Within50Ms: p95 <= 50 && firstP95 <= 50,
      measuredNodeCallsOver100Ms: [...times, ...firstTimes].filter((ms) => ms > 100).length,
      cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, retainedSessionBytes: Buffer.byteLength(JSON.stringify(state)) });
  }
  const memoryAfter = process.memoryUsage();
  return { entries: 10000, byMode, initialTargetMs: 50, allMeasuredP95WithinTarget: byMode.every((m) => m.p95Within50Ms),
    hardware: { platform: process.platform, release: os.release(), architecture: process.arch,
      cpuModel: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, cpuReportedMHz: os.cpus()[0]?.speed,
      totalMemoryBytes: os.totalmem(), node: process.version },
    memory: { before: memoryBefore, after: memoryAfter, heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
      processPeakRssBytes: process.resourceUsage().maxRSS * 1024 },
    limitation: 'Measured Node production stage/commit calls, with injected signals. This does not prove renderer main-thread, cancellation, GPU, audible playback, or physical-device acceptance. Concurrent work and GC may affect timings.' };
});

let head = null;
try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(); } catch (_) { /* receipt still records exact source hashes */ }
const performanceResult = results.find((result) => result.name.startsWith('ten-thousand'));
const receipt = {
  receiptVersion: 1, suite: 'production-universal-shuffle-longitudinal-v2', generatedAt: new Date().toISOString(),
  source: { workspace: ROOT, head, policyVersion: U.POLICY_VERSION, schedulerConfigVersion: U.CONFIG.version,
    files: ['src/shuffle/universal.js', 'src/shuffle/learning.js', 'src/shuffle/scopes.js', 'src/flow-shuffle-engine.js', 'scripts/check-shuffle-universal-simulations.js'].map((file) => ({ file, sha256: fileHash(file) })) },
  fixedClockStartMs: FIXED_NOW, status: failures.length ? 'failed' : 'passed',
  invariantChecks, confirmedDecisions, restoreComparisons, learningEventsIssued: learningSequence,
  violations, failures: failures.map(({ name, error }) => ({ name, error })),
  performanceTargetMet: performanceResult?.passed === true && performanceResult.metrics.allMeasuredP95WithinTarget,
  results,
  openAcceptanceGates: ['JS/Kotlin parity and real platform adapters', 'Renderer main-thread and bounded cancellation evidence',
    'Connected root-owned host handoff protocol', 'Painted UI, audible listening, physical devices and human preference assessment'],
};
fs.mkdirSync(RECEIPTS, { recursive: true });
fs.writeFileSync(path.join(RECEIPTS, 'simulation-longitudinal.json'), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(RECEIPTS, 'simulation-summary.md'), `# Universal shuffle simulation receipt\n\nStatus: ${receipt.status}. ${results.filter((r) => r.passed).length}/${results.length} production-reducer scenarios passed; ${invariantChecks} invariant assertions, ${confirmedDecisions} confirmed decisions and ${restoreComparisons} cold-restore comparisons.\n\nSource HEAD: \`${head}\`. Policy: \`${U.POLICY_VERSION}\`; config: ${U.CONFIG.version}. See simulation-longitudinal.json for exact current-file hashes, deterministic trace hashes, scope/coverage/exposure metrics, failures and hardware-qualified timing.\n\nThe five canonical modes each receive a 1000-entry, 100-session restart continuation run. Coverage and offered/activated opportunities are separate from actual heard time. Actual twenty-minute listening is exercised for forty-two sessions across six simulated weeks and three stable scopes. Random distribution checks are finite-PRNG sanity tests. Weighted modes are intentionally biased.\n\n10,000-item measured p95 target: ${receipt.performanceTargetMet ? 'met in this Node run' : 'open or exceeded in this Node run; inspect per-mode measurements'}. Node timings do not close renderer, cancellation, audio, physical-device, Kotlin parity or connected-handoff acceptance gates.\n${failures.length ? `\nFailures:\n\n${failures.map((failure) => `- ${failure.name}: ${failure.error}`).join('\n')}\n` : ''}`);
console.log(`Universal shuffle simulations: ${receipt.status}; ${results.filter((r) => r.passed).length}/${results.length} scenarios; receipt ${path.join(RECEIPTS, 'simulation-longitudinal.json')}`);
if (failures.length) process.exitCode = 1;
