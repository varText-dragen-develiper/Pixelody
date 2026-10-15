'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const L = require('../src/shuffle/learning');
const baseNow = 1800000000000;
const cases = [];
const vectors = [];
let serial = 0;
const event = (type, fields = {}) => ({ schemaVersion: 2, eventId: `learning-test-${++serial}`, type, ...fields });
const apply = (ledger, type, fields, now = baseNow) => L.reduce(ledger, event(type, fields), { nowMs: now });
const initial = () => L.createLedger({ nowMs: baseNow });
const row = (ledger, trackId = 'track') => ledger.tracks.find((t) => t.trackId === trackId);
const active = (ledger = initial(), occurrenceId = 'occurrence', fields = {}) => apply(ledger, 'activated',
  { trackId: 'track', occurrenceId, durationMs: 180000, ...fields });
const interval = (ledger, start, end, mediaStart = start, mediaEnd = end, fields = {}, now = baseNow) => apply(ledger, 'interval',
  { trackId: 'track', occurrenceId: 'occurrence', monotonicClockId: 'service-boot-1',
    monotonicStartMs: start, monotonicEndMs: end, mediaStartMs: mediaStart, mediaEndMs: mediaEnd,
    playing: true, ...fields }, now);
const finish = (ledger, outcome = 'natural-end', fields = {}, now = baseNow) => apply(ledger, 'outcome',
  { trackId: 'track', occurrenceId: 'occurrence', outcome, ...fields }, now);
function test(name, run) { run(); cases.push(name); }
function fullyHeard(ledger = initial(), occurrenceId = 'occurrence', fields = {}, now = baseNow) {
  ledger = apply(ledger, 'activated', { trackId: 'track', occurrenceId, durationMs: 180000, ...fields }, now);
  for (let start = 0; start < 180000; start += 60000) ledger = interval(ledger, start, start + 60000, start, start + 60000, { occurrenceId }, now);
  return apply(ledger, 'outcome', { trackId: 'track', occurrenceId, outcome: 'natural-end' }, now);
}

test('UMD global and Node exports execute the same production module', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/shuffle/learning.js'), 'utf8'), sandbox);
  assert.equal(sandbox.PixelodyShuffleLearningV2.VERSION, 2);
  assert.equal(JSON.stringify(sandbox.PixelodyShuffleLearningV2.createLedger()), JSON.stringify(L.createLedger()));
  assert(Object.isFrozen(L.CONFIG));
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shuffle-learning-contract-input.json'), 'utf8'));
  assert.deepEqual(contract.config, L.CONFIG);
  assert.equal(contract.policyVersion, L.POLICY_VERSION);
});

test('pure reducer, injected clock, validation and allowlisted private journal', () => {
  const ledger = initial();
  const old = JSON.stringify(ledger);
  const input = event('offered', { trackId: 'track', path: 'C:/private/song.mp3', token: 'secret', title: 'private title', reason: 'C:/private/reason' });
  const next = L.reduce(ledger, input, { nowMs: baseNow });
  assert.equal(JSON.stringify(ledger), old);
  assert.equal(row(next).offered, 1);
  assert(!JSON.stringify(next).includes('private'));
  assert.equal(L.reduce(ledger, { ...input, schemaVersion: 3 }, { nowMs: baseNow }), ledger);
  assert.equal(L.reduce(ledger, { ...input, eventId: '' }, { nowMs: baseNow }), ledger);
  assert.equal(L.normalizeEvent(input), null);
  assert.equal(L.reduce(ledger, input, { nowMs: NaN }), ledger);
  assert.equal(L.reduce(ledger, { ...input, personal: 'false' }, { nowMs: baseNow }), ledger);
  assert.equal(L.reduce(ledger, { ...input, discontinuity: 'true' }, { nowMs: baseNow }), ledger);
  for (const trackId of ['x'.repeat(1025), '\ud800', '\udc00', 'x\ud800y'])
    assert.equal(L.reduce(ledger, { ...input, trackId }, { nowMs: baseNow }), ledger);
  assert.notEqual(L.reduce(ledger, { ...input, trackId: 'x'.repeat(1024) }, { nowMs: baseNow }), ledger);
  assert.equal(L.reduce(ledger, { ...input, timestampMs: baseNow + L.CONFIG.maxFutureSkewMs + 1 }, { nowMs: baseNow }), ledger);
});

test('offered, activated, heard and natural end remain separate evidence', () => {
  let ledger = apply(initial(), 'offered', { trackId: 'track' });
  assert.equal(row(ledger).activated, 0);
  assert.equal(L.trackSignals(ledger, 'track').exposure, 0);
  ledger = active(ledger);
  assert.equal(row(ledger).heardOccurrences, 0);
  ledger = interval(ledger, 0, 60000);
  assert.equal(row(ledger).heardOccurrences, 1);
  ledger = finish(ledger);
  assert.equal(row(ledger).naturalEnds, 1);
  assert.equal(row(ledger).positiveUnits, 0);
  assert.equal(row(ledger).negativeUnits, 0);
});

test('full actual coverage teaches bounded conservative positive evidence', () => {
  const ledger = fullyHeard();
  assert.equal(row(ledger).positiveUnits, 3);
  assert.equal(row(ledger).heardWallMs, 180000);
  assert.deepEqual(ledger.occurrences[0].coverageRanges, [[0, 180000]]);
  assert.deepEqual(L.trackSignals(ledger, 'track'), { tastePoints: 1, exposure: 1, noveltyPoints: 10,
    lastHeardAtMs: baseNow, confidencePermille: 111 });
  assert.deepEqual(L.importLedger(L.exportLedger(ledger, { includePrivate: true })).ledger, ledger);
});

test('seek to end and false completion percent cannot manufacture success', () => {
  let ledger = interval(active(), 0, 5000);
  ledger = interval(ledger, 5000, 6000, 179000, 180000, { discontinuity: true });
  ledger = finish(ledger, 'natural-end', { percentCompleted: 1 });
  assert.equal(row(ledger).positiveUnits, 0);
  assert.equal(row(ledger).heardWallMs, 5000);
  assert.equal(L.coverageMs(ledger.occurrences[0]), 5000);
});

test('missing seek boundary and zero media progress teach nothing', () => {
  let ledger = interval(active(), 0, 1000, 0, 180000);
  ledger = interval(ledger, 1000, 6000, 180000, 180000);
  ledger = finish(ledger);
  assert.equal(row(ledger).heardWallMs, 0);
  assert.equal(row(ledger).positiveUnits, 0);
});

test('repeated sections accumulate wall time once and unique coverage once', () => {
  let ledger = active();
  for (let i = 0; i < 4; i++) ledger = interval(ledger, i * 30000, (i + 1) * 30000, 0, 30000);
  ledger = finish(ledger);
  assert.equal(row(ledger).heardWallMs, 120000);
  assert.equal(L.coverageMs(ledger.occurrences[0]), 30000);
  assert.equal(row(ledger).positiveUnits, 0);
});

test('speed keeps wall-time separate from media coverage', () => {
  let fast = active();
  fast = interval(fast, 0, 45000, 0, 90000, { speedPermille: 2000 });
  fast = interval(fast, 45000, 90000, 90000, 180000, { speedPermille: 2000 });
  fast = finish(fast);
  assert.equal(row(fast).heardWallMs, 90000);
  assert.equal(L.coverageMs(fast.occurrences[0]), 180000);
  assert.equal(row(fast).positiveUnits, 3);
  let tooFast = active();
  tooFast = interval(tooFast, 0, 45000, 0, 180000, { speedPermille: 4000 });
  tooFast = finish(tooFast);
  assert.equal(row(tooFast).positiveUnits, 0, 'coverage alone does not bypass the actual wall-time threshold');
});

test('overlapping/retried intervals do not duplicate wall or coverage', () => {
  let ledger = interval(active(), 0, 10000);
  ledger = interval(ledger, 5000, 15000);
  ledger = interval(ledger, 0, 10000);
  assert.equal(row(ledger).heardWallMs, 15000);
  assert.equal(L.coverageMs(ledger.occurrences[0]), 15000);
  ledger = interval(ledger, 0, 10000, 15000, 25000, { monotonicClockId: 'service-boot-2' });
  assert.equal(row(ledger).heardWallMs, 25000, 'a new boot uses a distinct monotonic clock origin');
});

test('pause, buffering, focus/network/route/credential errors and nonpersonal actions cannot teach dislike', () => {
  for (const reason of L.IGNORED_REASONS) {
    let ledger = interval(active(), 0, 8000);
    ledger = finish(ledger, 'deliberate-skip', { userInitiated: true, reason });
    assert.equal(row(ledger).negativeUnits, 0, reason);
    assert.equal(row(ledger).deliberateSkips, 0, reason);
    assert(ledger.occurrences[0].ended, reason);
  }
  for (const source of ['remote', 'session', 'preview']) {
    let ledger = interval(active(), 0, 8000);
    ledger = finish(ledger, 'deliberate-skip', { source, userInitiated: true });
    assert.equal(row(ledger).negativeUnits, 0, source);
  }
  const unknownFailure = finish(interval(active(), 0, 8000), 'deliberate-skip', { userInitiated: true, reason: 'future-platform-error' });
  assert.equal(row(unknownFailure).negativeUnits, 0);
  const personalManual = finish(interval(active(), 0, 8000), 'deliberate-skip', { userInitiated: true, reason: 'manual-next' });
  assert.equal(row(personalManual).negativeUnits, 2);
  assert.equal(row(interval(active(), 0, 8000, 0, 8000, { playing: false })).heardWallMs, 0);
  assert.equal(row(interval(active(), 0, 8000, 0, 8000, { reason: 'focus-loss' })).heardWallMs, 0);
  assert.equal(apply(initial(), 'activated', { trackId: 'track', occurrenceId: 'remote', personal: false }).tracks.length, 0);
});

test('only deliberate personal early skips with actual evidence teach conservative dislike', () => {
  const skipped = finish(interval(active(), 0, 8000), 'deliberate-skip', { userInitiated: true });
  assert.equal(row(skipped).negativeUnits, 2);
  assert.equal(L.trackSignals(skipped, 'track').tastePoints, 0, 'prior protects against one skip');
  for (const [heard, userInitiated] of [[1000, true], [30000, true], [8000, false]]) {
    const ledger = finish(interval(active(), 0, heard), 'deliberate-skip', { userInitiated });
    assert.equal(row(ledger).negativeUnits, 0);
  }
  const unknown = finish(interval(active(initial(), 'occurrence', { durationMs: null }), 0, 8000), 'deliberate-skip', { userInitiated: true });
  assert.equal(row(unknown).negativeUnits, 0);
});

test('occurrence activation and outcome remain idempotent under distinct callbacks', () => {
  let ledger = fullyHeard();
  ledger = active(ledger);
  ledger = finish(ledger);
  assert.equal(row(ledger).activated, 1);
  assert.equal(row(ledger).positiveUnits, 3);
  ledger = fullyHeard(ledger, 'replay-occurrence', { replay: true });
  assert.equal(row(ledger).activated, 2);
  assert.equal(row(ledger).replays, 1);
  assert.equal(row(ledger).positiveUnits, 6);
});

test('arbitrary Unicode, combining characters, delimiters and prototype-shaped IDs are opaque', () => {
  let ledger = initial();
  const ids = ['__proto__', 'constructor', '東京/曲|A', 'é', 'e\u0301', 'x|y', 'x', '𝄞'];
  for (const trackId of ids) ledger = apply(ledger, 'preference', { trackId, value: 1 });
  assert.equal(ledger.tracks.length, ids.length);
  for (const trackId of ids) assert.equal(L.trackSignals(ledger, trackId).tastePoints, 8);
  assert.deepEqual(ledger.tracks.map((t) => t.trackId), ids.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
  const generatedOccurrence = JSON.stringify(['\u0000'.repeat(1024), 1]);
  assert(generatedOccurrence.length > 1024);
  const long = active(initial(), generatedOccurrence);
  assert.equal(row(long).activated, 1);
  assert(L.importLedger(long).ok);
  assert.equal(active(initial(), 'x'.repeat(16385)).tracks.length, 0);
});

test('event IDs and producer sequences deduplicate out-of-order durable events', () => {
  let ledger = initial();
  const events = [3, 1, 2].map((sequence) => event('offered', { trackId: 'track', producerId: 'service', sequence }));
  for (const next of events) ledger = L.reduce(ledger, next, { nowMs: baseNow });
  assert.deepEqual(ledger.producers, [{ producerId: 'service', through: 3, pending: [] }]);
  for (const next of events) assert.equal(L.reduce(ledger, next, { nowMs: baseNow }), ledger);
  assert.equal(L.reduce(ledger, { ...events[0], eventId: 'different-id' }, { nowMs: baseNow }), ledger);
  assert.equal(L.reduce(ledger, event('offered', { trackId: 'track', producerId: 'service', sequence: 2000 }), { nowMs: baseNow }), ledger);
  assert.equal(L.reduce(ledger, event('offered', { trackId: 'track', producerId: 'missing-sequence' }), { nowMs: baseNow }), ledger);
});

test('journal compaction preserves exposure, taste and sequence watermark indefinitely', () => {
  let ledger = fullyHeard();
  const first = event('offered', { trackId: 'track', producerId: 'durable-producer', sequence: 1 });
  ledger = L.reduce(ledger, first, { nowMs: baseNow });
  for (let sequence = 2; sequence <= L.CONFIG.maxEventIds + 2; sequence++) ledger = apply(ledger, 'offered',
    { trackId: 'track', producerId: 'durable-producer', sequence });
  assert.equal(ledger.journal.length, L.CONFIG.maxJournal);
  assert.equal(ledger.seenEventIds.length, L.CONFIG.maxEventIds);
  assert(!ledger.seenEventIds.includes(first.eventId));
  assert.equal(L.reduce(ledger, first, { nowMs: baseNow }), ledger);
  assert.equal(row(ledger).positiveUnits, 3);
  assert.equal(row(ledger).activated, 1);
  assert.equal(row(ledger).offered, L.CONFIG.maxEventIds + 2);
  assert.equal(ledger.producers[0].through, L.CONFIG.maxEventIds + 2);
});

test('future timestamps reject or clamp explicitly; rollback never reverses decay', () => {
  let ledger = fullyHeard();
  ledger = apply(ledger, 'offered', { trackId: 'track', timestampMs: baseNow + 1 });
  assert.equal(ledger.diagnostics.futureClamps, 1);
  const advanced = baseNow + L.CONFIG.decayPeriodMs;
  ledger = apply(ledger, 'offered', { trackId: 'track' }, advanced);
  const signals = L.trackSignals(ledger, 'track', { nowMs: advanced });
  assert.deepEqual(L.trackSignals(ledger, 'track', { nowMs: baseNow }), signals);
  ledger = apply(ledger, 'offered', { trackId: 'track' }, baseNow);
  assert.equal(ledger.clockFloorMs, advanced);
  assert.equal(ledger.diagnostics.clockRollbacks, 1);
});

test('frequent evidence cannot postpone half-life decay; old evidence decays before addition', () => {
  let ledger = initial();
  const day = 86400000;
  for (let d = 0; d < 29; d++) ledger = fullyHeard(ledger, `day-${d}`, {}, baseNow + d * day);
  assert.equal(row(ledger).positiveUnits, 45, '28 daily completions decay 84 to 42, then add 3');
  assert.equal(row(ledger).evidenceAtMs, baseNow + 28 * day);
  const decayed = L.trackSignals(ledger, 'track', { nowMs: baseNow + 400 * day });
  assert.equal(decayed.tastePoints, 0);
  assert.equal(decayed.confidencePermille, 0);
  let late = active();
  for (let start = 0; start < 180000; start += 60000) late = interval(late, start, start + 60000);
  late = finish(late, 'natural-end', { timestampMs: baseNow }, baseNow + 2 * L.CONFIG.decayPeriodMs);
  assert.equal(row(late).positiveUnits, 0, 'a late event does not gain fresh evidence');
});

test('explicit preference persists through decay and changes only with a newer explicit event', () => {
  let ledger = apply(fullyHeard(), 'preference', { trackId: 'track', value: -1 });
  assert.equal(L.trackSignals(ledger, 'track', { nowMs: baseNow + 99 * L.CONFIG.decayPeriodMs }).tastePoints, -8);
  ledger = apply(ledger, 'preference', { trackId: 'track', value: 1 }, baseNow + 1000);
  ledger = apply(ledger, 'preference', { trackId: 'track', value: -1, timestampMs: baseNow });
  assert.equal(row(ledger).explicitPreference, 1);
  ledger = apply(ledger, 'preference', { trackId: 'track', value: 0 }, baseNow + 1001);
  assert.equal(row(ledger).explicitPreference, 0);
});

test('taste, confidence, novelty and counters remain bounded through preference reversal', () => {
  let ledger = initial();
  for (let day = 0; day < 60; day++) {
    const now = baseNow + day * 86400000;
    if (day < 30) ledger = fullyHeard(ledger, `long-${day}`, {}, now);
    else {
      const occurrenceId = `long-${day}`;
      ledger = apply(ledger, 'activated', { trackId: 'track', occurrenceId, durationMs: 180000 }, now);
      ledger = interval(ledger, 0, 8000, 0, 8000, { occurrenceId }, now);
      ledger = apply(ledger, 'outcome', { trackId: 'track', occurrenceId, outcome: 'deliberate-skip', userInitiated: true }, now);
    }
    const signal = L.trackSignals(ledger, 'track', { nowMs: now });
    assert(Number.isInteger(signal.tastePoints) && Math.abs(signal.tastePoints) <= 12);
    assert(Number.isInteger(signal.noveltyPoints) && signal.noveltyPoints >= 0 && signal.noveltyPoints <= 12);
    assert(Number.isInteger(signal.confidencePermille) && signal.confidencePermille >= 0 && signal.confidencePermille <= 1000);
  }
  assert(L.trackSignals(ledger, 'track').tastePoints < 0);
  assert.equal(row(ledger).activated, 60);
  assert.equal(row(ledger).negativeUnits, 34);
  assert(L.importLedger(ledger).ok);
});

test('disable freezes personal evidence and ends open measurements without deleting aggregates', () => {
  let ledger = interval(active(), 0, 8000);
  assert.equal(L.setEnabled(ledger, false, { eventId: 'nonpersonal-disable', personal: false }, { nowMs: baseNow }), ledger);
  assert.equal(L.resetLearning(ledger, { eventId: 'remote-reset', source: 'remote' }, { nowMs: baseNow }), ledger);
  ledger = L.setEnabled(ledger, false, { eventId: 'disable' }, { nowMs: baseNow });
  const before = JSON.stringify(row(ledger));
  ledger = finish(ledger, 'deliberate-skip', { userInitiated: true });
  assert.equal(JSON.stringify(row(ledger)), before);
  assert.deepEqual(L.trackSignals(ledger, 'track'), { tastePoints: 0, exposure: 0, noveltyPoints: 0, lastHeardAtMs: null, confidencePermille: 0 });
  ledger = L.setEnabled(ledger, true, { eventId: 'enable' }, { nowMs: baseNow });
  ledger = interval(ledger, 8000, 16000);
  assert.equal(row(ledger).heardWallMs, 8000);
});

test('reset, detailed history deletion, track deletion and full deletion have separate scopes', () => {
  let ledger = fullyHeard();
  ledger = L.deleteHistory(ledger, { eventId: 'history-delete' }, { nowMs: baseNow });
  assert.equal(row(ledger).positiveUnits, 3);
  assert.equal(row(ledger).lastHeardAtMs, null);
  assert.equal(ledger.occurrences.length, 0);
  assert.equal(ledger.journal.length, 1);
  ledger = L.deleteTrack(ledger, 'track', { eventId: 'track-delete' }, { nowMs: baseNow });
  assert.equal(ledger.tracks.length, 0);
  assert(!ledger.journal.some((entry) => entry.trackId === 'track'));
  ledger = fullyHeard(ledger, 'new-occurrence');
  const beforeIds = ledger.seenEventIds.length;
  ledger = L.resetLearning(ledger, { eventId: 'reset' }, { nowMs: baseNow });
  assert.equal(ledger.tracks.length, 0);
  assert.equal(ledger.learningEpoch, 1);
  assert.equal(ledger.seenEventIds.length, beforeIds + 1);
  assert.equal(apply(ledger, 'offered', { trackId: 'track', learningEpoch: 0 }), ledger);
  const deleted = L.deleteLedger(ledger);
  assert.equal(deleted.enabled, false);
  assert.equal(deleted.learningEpoch, 2);
  assert.equal(deleted.seenEventIds.length, 0);
  assert.equal(deleted.journal.length, 0);
});

test('import preserves unknown future and malformed snapshots without resetting user data', () => {
  const future = { schemaVersion: 999, mystery: { local: ['untouched'] } };
  assert.deepEqual(L.importLedger(future), { ok: false, reason: 'unsupported-version', preserved: future });
  assert.equal(L.importLedger('{').reason, 'invalid-json');
  const broken = initial(); broken.tracks = [{ trackId: 'bad', positiveUnits: NaN }];
  assert.equal(L.importLedger(broken).ok, false);
  const valid = fullyHeard();
  const overlapping = L.exportLedger(valid, { includePrivate: true });
  overlapping.occurrences[0].coverageRanges = [[0, 10000], [5000, 180000]];
  assert.equal(L.importLedger(overlapping).ok, false);
  const unexpectedField = L.exportLedger(valid, { includePrivate: true });
  unexpectedField.journal[0].token = 'unexpected-private-field';
  assert.equal(L.importLedger(unexpectedField).ok, false);
  const invalidProducer = L.exportLedger(valid, { includePrivate: true });
  invalidProducer.producers = [{ producerId: 'bad', through: 0, pending: [1] }];
  assert.equal(L.importLedger(invalidProducer).ok, false);
  assert.throws(() => L.exportLedger(valid), /includePrivate/);
});

test('producer and boot-clock bounds preserve existing identities and reject excess retryably', () => {
  let ledger = initial();
  for (let i = 0; i < L.CONFIG.maxProducers; i++) ledger = apply(ledger, 'offered', { trackId: 'track', producerId: `p-${i}`, sequence: 1 });
  const tooMany = event('offered', { trackId: 'track', producerId: 'p-overflow', sequence: 1 });
  assert.equal(L.reduce(ledger, tooMany, { nowMs: baseNow }), ledger);
  assert.equal(ledger.producers.length, L.CONFIG.maxProducers);
  ledger = active();
  for (let i = 0; i < L.CONFIG.maxClocksPerOccurrence; i++) ledger = interval(ledger, 0, 1000, i * 1000, (i + 1) * 1000, { monotonicClockId: `boot-${i}` });
  ledger = interval(ledger, 0, 1000, 8000, 9000, { monotonicClockId: 'boot-overflow' });
  assert.equal(row(ledger).heardWallMs, 8000);
  assert.equal(ledger.occurrences[0].clocks.length, L.CONFIG.maxClocksPerOccurrence);
});

test('bounded disjoint coverage never fills unheard gaps', () => {
  let ledger = active();
  for (let i = 0; i < 65; i++) ledger = interval(ledger, i * 1000, i * 1000 + 500, i * 2000, i * 2000 + 500);
  assert.equal(ledger.occurrences[0].coverageRanges.length, 64);
  assert.equal(L.coverageMs(ledger.occurrences[0]), 32000);
  assert.equal(ledger.diagnostics.coverageUnderflows, 1);
  assert.equal(row(ledger).heardWallMs, 32500);
});

test('bounded occurrence retention preserves lifetime exposure and rejects excess open capacity retryably', () => {
  let ledger = initial();
  for (let i = 0; i < L.CONFIG.maxClosedOccurrences + 2; i++) {
    ledger = active(ledger, `closed-${i}`);
    ledger = finish(ledger, 'interrupted', { occurrenceId: `closed-${i}` });
  }
  assert.equal(ledger.occurrences.length, L.CONFIG.maxClosedOccurrences);
  assert.equal(row(ledger).activated, L.CONFIG.maxClosedOccurrences + 2);
  assert.equal(ledger.diagnostics.prunedOccurrences, 2);
  ledger = initial();
  for (let i = 0; i < L.CONFIG.maxOpenOccurrences; i++) ledger = active(ledger, `open-${i}`);
  const rejected = event('activated', { trackId: 'track', occurrenceId: 'overflow' });
  assert.equal(L.reduce(ledger, rejected, { nowMs: baseNow }), ledger);
  ledger = finish(ledger, 'interrupted', { occurrenceId: 'open-0' });
  assert.notEqual(L.reduce(ledger, rejected, { nowMs: baseNow }), ledger);
});

test('insights distinguish offered/activated/heard coverage without inventing listening', () => {
  let ledger = fullyHeard();
  ledger = apply(ledger, 'offered', { trackId: 'offered-only' });
  assert.deepEqual(L.exposureMetrics(ledger, ['track', 'offered-only', 'never-seen', 'track']), {
    eligible: 3, activated: 1, heard: 1, neverActivated: 2, activationCoveragePermille: 333, heardCoveragePermille: 333 });
  assert.equal(L.summarize(ledger).heardWallMs, 180000);
  assert.equal(L.trackSignals(ledger, 'never-seen').noveltyPoints, 12);
});

test('golden learning traces replay byte-equivalent normalized state and integer signals', () => {
  const events = [
    { type: 'offered', trackId: '曲|é' },
    { type: 'activated', trackId: '曲|é', occurrenceId: 'entry|one', durationMs: 100000 },
    { type: 'interval', trackId: '曲|é', occurrenceId: 'entry|one', monotonicClockId: 'boot-α', monotonicStartMs: 0, monotonicEndMs: 50000, mediaStartMs: 0, mediaEndMs: 50000, playing: true },
    { type: 'interval', trackId: '曲|é', occurrenceId: 'entry|one', monotonicClockId: 'boot-α', monotonicStartMs: 50000, monotonicEndMs: 100000, mediaStartMs: 50000, mediaEndMs: 100000, playing: true },
    { type: 'outcome', trackId: '曲|é', occurrenceId: 'entry|one', outcome: 'natural-end' },
    { type: 'preference', trackId: '曲|é', value: -1 },
  ].map((e, index) => ({ schemaVersion: 2, eventId: `golden-${index + 1}`, producerId: 'service|one', sequence: index + 1, timestampMs: baseNow, ...e }));
  let ledger = initial();
  const states = events.map((e) => { ledger = L.reduce(ledger, e, { nowMs: baseNow }); return ledger; });
  let replay = initial();
  for (let i = 0; i < events.length; i++) { replay = L.reduce(replay, events[i], { nowMs: baseNow }); assert.equal(JSON.stringify(replay), JSON.stringify(states[i])); }
  vectors.push({ name: 'heard-completion-explicit-preference-unicode', initial: initial(), nowMs: baseNow, events,
    normalizedEvents: events.map((e) => L.normalizeEvent(e, { nowMs: baseNow })), states,
    signals: L.trackSignals(ledger, '曲|é', { nowMs: baseNow }) });
});

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt = { schemaVersion: 1, policyVersion: L.POLICY_VERSION, result: 'passed', cases: cases.length,
  testNames: cases, productionSha256: hash(path.join(__dirname, '../src/shuffle/learning.js')),
  testSha256: hash(__filename), retention: { journal: L.CONFIG.maxJournal, arbitraryEventIds: L.CONFIG.maxEventIds,
    producerWatermarks: 'durable without expiry; bounded producer count and sequence gap reject retryably' },
  limits: ['Service/audio adapter must supply truthful playing/discontinuity and monotonic intervals.',
    'Arbitrary IDs alone deduplicate only within the retained ID window; use producerId/sequence for durable exactly once.',
    'More than 64 disjoint media ranges conservatively undercount unique coverage.',
    'This is pure-core evidence, not audible playback, platform lifecycle, device or human preference acceptance.'] };
if (process.argv.includes('--write-receipt')) {
  const target = path.join(__dirname, '../.artifacts/shuffle-universal/core');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'learning-tests.json'), JSON.stringify(receipt, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'learning-vectors.json'), JSON.stringify({ schemaVersion: 2, policyVersion: L.POLICY_VERSION, vectors }, null, 2) + '\n');
}
console.log(JSON.stringify({ result: receipt.result, cases: receipt.cases, productionSha256: receipt.productionSha256 }));
