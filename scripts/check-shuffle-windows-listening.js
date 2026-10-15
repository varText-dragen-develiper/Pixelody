'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const intervals = require('../src/renderer-domains/listening-intervals');
const learning = require('../src/shuffle/learning');
let passed = 0;
let failed = 0;

function test(name, run) {
  try { run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1; }
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message || 'value'}: expected ${expected}, got ${actual}`);
}

function fixture(options = {}, initial = {}) {
  let time = 0;
  const tracker = intervals.createTracker({ ...options, now: () => time });
  tracker.begin({ occurrenceId: 'occurrence:α|1', trackId: 'track:α|1', position: 0, duration: 100, rate: 1, playing: true, ...initial });
  return {
    tracker,
    tick(seconds, position, extra = {}) { time += seconds * 1000; return tracker.sample({ position, ...extra }); },
    setTime(value) { time = value; },
    advance(seconds) { time += seconds * 1000; },
  };
}

test('classic renderer and Node use the same independently loadable module', () => {
  const browser = { performance: { now: () => 0 } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src/renderer-domains/listening-intervals.js'), 'utf8'), browser);
  assert.equal(browser.PixelodyListeningIntervals.MEASUREMENT_VERSION, intervals.MEASUREMENT_VERSION);
  const value = browser.PixelodyListeningIntervals.createTracker();
  assert.equal(value.checkpoint(), null);
  assert.equal(value.begin({ occurrenceId: 'o', trackId: 't', position: 0 }).listenedWallSeconds, 0);
});

test('continuous playback measures wall time and observed unique media coverage', () => {
  const { tracker, tick } = fixture();
  for (let position = 1; position <= 20; position += 1) tick(1, position);
  const value = tracker.checkpoint();
  near(value.listenedWallSeconds, 20);
  near(value.mediaExposureSeconds, 20);
  near(value.coveredSeconds, 20);
  near(value.coverageRatio, 0.2);
  near(value.repeatedMediaSeconds, 0);
  assert.deepEqual(value.coverageRanges, [[0, 20]]);
});

test('checkpoints are detached and do not manufacture progress without audio observations', () => {
  const { tracker, tick, advance } = fixture();
  tick(1, 1);
  const value = tracker.checkpoint();
  value.coverageRanges[0][1] = 100;
  value.listenedWallSeconds = 100;
  advance(100);
  assert.equal(tracker.checkpoint().coveredSeconds, 1);
  assert.equal(tracker.checkpoint().listenedWallSeconds, 1);
});

test('pause closes its preceding interval while paused media-clock movement is excluded', () => {
  const { tracker, tick, advance } = fixture();
  tick(2, 2, { playing: false });
  tick(2, 4);
  near(tracker.checkpoint().listenedWallSeconds, 2);
  advance(10);
  tracker.resume({ position: 14 });
  tick(1, 15);
  near(tracker.checkpoint().listenedWallSeconds, 3);
  assert.deepEqual(tracker.checkpoint().coverageRanges, [[0, 2], [14, 15]]);
});

test('waiting, focus loss, route failure and recovery cannot backfill blocked intervals', () => {
  for (const reason of ['waiting', 'focus-loss', 'route-error', 'network-error', 'credential-loss']) {
    const { tracker, tick, advance } = fixture();
    advance(1);
    tracker.suspend({ position: 1 }, reason);
    tick(4, 5, { playing: true });
    near(tracker.checkpoint().listenedWallSeconds, 1, reason);
    advance(3);
    tracker.resume({ position: 8 });
    tick(1, 9);
    near(tracker.checkpoint().listenedWallSeconds, 2, reason);
    assert.deepEqual(tracker.checkpoint().coverageRanges, [[0, 1], [8, 9]], reason);
  }
});

test('explicit seeking excludes forward and backward jumps even within plausible elapsed time', () => {
  const { tracker, tick, advance } = fixture();
  tick(1, 1);
  advance(1);
  tracker.sample({ position: 2, seeking: true });
  tracker.resume({ position: 98 });
  tick(1, 99);
  tracker.sample({ position: 99, seeking: true });
  tracker.resume({ position: 0 });
  tick(1, 1);
  const value = tracker.checkpoint();
  near(value.listenedWallSeconds, 3);
  near(value.mediaExposureSeconds, 3);
  near(value.coveredSeconds, 2);
  near(value.repeatedMediaSeconds, 1);
  assert.deepEqual(value.coverageRanges, [[0, 1], [98, 99]]);
});

test('unreported large seeks are discontinuities rather than listening', () => {
  const { tracker, tick } = fixture();
  tick(1, 90);
  tick(1, 10);
  tick(1, 11);
  assert.equal(tracker.checkpoint().discontinuities, 2);
  near(tracker.checkpoint().listenedWallSeconds, 1);
  assert.deepEqual(tracker.checkpoint().coverageRanges, [[10, 11]]);
});

test('natural end after seek-to-end records the event without inventing completion or coverage', () => {
  const { tracker, tick } = fixture();
  tick(1, 1);
  tracker.sample({ position: 100, seeking: true });
  const value = tracker.finalize({ position: 100, playing: false, naturallyEnded: true, reason: 'ended' });
  assert.equal(value.naturalEndObserved, true);
  assert.equal(Object.prototype.hasOwnProperty.call(value, 'completed'), false);
  near(value.coverageRatio, 0.01);
  near(value.listenedWallSeconds, 1);
});

test('repeated segments add wall and exposure while unique union coverage stays fixed', () => {
  const { tracker, tick } = fixture({}, { duration: 10 });
  for (let repeat = 0; repeat < 3; repeat += 1) {
    if (repeat) { tracker.sample({ seeking: true }); tracker.resume({ position: 0 }); }
    for (let position = 1; position <= 10; position += 1) tick(1, position);
  }
  const value = tracker.finalize({ naturallyEnded: true });
  near(value.listenedWallSeconds, 30);
  near(value.mediaExposureSeconds, 30);
  near(value.coveredSeconds, 10);
  near(value.repeatedMediaSeconds, 20);
  near(value.coverageRatio, 1);
});

test('playback rate separates wall duration from media exposure at fast and slow speeds', () => {
  const fast = fixture({}, { rate: 2 });
  for (let step = 1; step <= 4; step += 1) fast.tick(1, step * 2);
  near(fast.tracker.checkpoint().listenedWallSeconds, 4);
  near(fast.tracker.checkpoint().coveredSeconds, 8);
  const slow = fixture({}, { rate: 0.5 });
  for (let step = 1; step <= 4; step += 1) slow.tick(1, step * 0.5);
  near(slow.tracker.checkpoint().listenedWallSeconds, 4);
  near(slow.tracker.checkpoint().coveredSeconds, 2);
});

test('ratechange observations close the preceding rate before starting the next interval', () => {
  const { tracker, tick } = fixture();
  tick(2, 2, { rate: 2 });
  tick(2, 6, { rate: 0.5 });
  tick(2, 7);
  near(tracker.checkpoint().listenedWallSeconds, 6);
  near(tracker.checkpoint().mediaExposureSeconds, 7);
});

test('stalls and partial progress cannot accrue the full elapsed clock duration', () => {
  const { tracker, tick } = fixture();
  tick(4, 0);
  tick(4, 1);
  near(tracker.checkpoint().listenedWallSeconds, 1);
  near(tracker.checkpoint().coveredSeconds, 1);
});

test('long unobserved gaps reanchor without backfilling and bounded drift cannot inflate wall time', () => {
  const { tracker, tick } = fixture();
  tick(60, 60);
  tick(1, 61.1);
  near(tracker.checkpoint().listenedWallSeconds, 1);
  near(tracker.checkpoint().coveredSeconds, 1);
  assert.equal(tracker.checkpoint().ignoredSampleGaps, 1);
});

test('clock rollback, invalid clock samples and recovery cannot add negative or phantom time', () => {
  const { tracker, tick, setTime } = fixture();
  tick(2, 2);
  setTime(1000);
  tracker.sample({ position: 3 });
  setTime(3000);
  tracker.sample({ position: 4 });
  near(tracker.checkpoint().listenedWallSeconds, 3);
  assert.equal(tracker.checkpoint().clockRollbacks, 1);
  setTime(NaN);
  tracker.sample({ position: 5 });
  setTime(5000);
  tracker.sample({ position: 6 });
  setTime(6000);
  tracker.sample({ position: 7 });
  near(tracker.checkpoint().listenedWallSeconds, 4);
  assert.equal(tracker.checkpoint().invalidClockSamples, 1);
});

test('null, zero, invalid positions, and unknown duration retain honest distinct meanings', () => {
  const { tracker, tick } = fixture({}, { duration: null });
  tick(1, 1);
  assert.equal(tracker.checkpoint().duration, null);
  assert.equal(tracker.checkpoint().coverageRatio, null);
  tick(1, null);
  tick(1, 3);
  tick(1, 4);
  near(tracker.checkpoint().coveredSeconds, 2);
  tracker.sample({ duration: 0, rate: 0 });
  tick(1, 5);
  near(tracker.checkpoint().listenedWallSeconds, 2);
  assert.equal(tracker.checkpoint().rate, null);
});

test('duplicate begin and finalization are idempotent, and stale occurrence callbacks are ignored', () => {
  const { tracker, tick, advance } = fixture();
  tick(1, 1);
  tracker.begin({ occurrenceId: 'occurrence:α|1', trackId: 'track:α|1', position: 0 });
  assert.throws(() => tracker.begin({ occurrenceId: 'new', trackId: 'new' }), /Finalize/);
  advance(1);
  tracker.sample({ occurrenceId: 'stale', position: 90 });
  tracker.suspend({ occurrenceId: 'stale', position: 90 });
  tracker.resume({ occurrenceId: 'stale', position: 90 });
  tracker.finalize({ occurrenceId: 'stale', position: 90 });
  const finished = tracker.finalize({ position: 2, reason: 'user-next' });
  assert.equal(finished.staleSamples, 4);
  near(finished.listenedWallSeconds, 2);
  advance(10);
  assert.deepEqual(tracker.finalize({ position: 100, naturallyEnded: true, reason: 'ended' }), finished);
  assert.deepEqual(tracker.begin({ occurrenceId: finished.occurrenceId, trackId: finished.trackId }), finished);
  assert.equal(tracker.begin({ occurrenceId: 'new', trackId: finished.trackId, position: 0 }).coveredSeconds, 0);
});

test('cold restore preserves observed evidence and remains paused until explicit resume', () => {
  const old = fixture();
  old.tick(2, 2);
  const saved = JSON.parse(JSON.stringify(old.tracker.checkpoint()));
  let time = 900000;
  const restored = intervals.createTracker({ now: () => time });
  const paused = restored.restore(saved);
  assert.equal(paused.playing, false);
  assert.equal(paused.blocked, true);
  time += 1000;
  restored.sample({ position: 3, playing: true });
  near(restored.checkpoint().listenedWallSeconds, 2);
  restored.resume({ position: 3 });
  time += 1000;
  restored.sample({ position: 4 });
  near(restored.checkpoint().listenedWallSeconds, 3);
  assert.deepEqual(restored.checkpoint().coverageRanges, [[0, 2], [3, 4]]);
  assert.equal(restored.checkpoint().occurrenceId, saved.occurrenceId);
});

test('future and corrupt checkpoints are rejected before changing active evidence', () => {
  const original = fixture().tracker.checkpoint();
  const target = intervals.createTracker({ now: () => 0 });
  assert.throws(() => target.restore({ ...original, schemaVersion: 900 }), /Unsupported/);
  assert.equal(target.checkpoint(), null);
  assert.throws(() => target.restore({ ...original, coverageRanges: [[0, 10]] }), /exceeds/);
  assert.equal(target.checkpoint(), null);
  assert.throws(() => target.restore({ ...original, coverageRanges: [[4, 2]] }), /range/);
  assert.equal(target.checkpoint(), null);
});

test('fragment retention has a conservative limit without filling gaps or claiming exact repeats', () => {
  const { tracker, tick } = fixture({ maxCoverageRanges: 2 });
  tick(1, 1);
  tracker.sample({ seeking: true });
  tracker.resume({ position: 10 });
  tick(1, 11);
  tracker.sample({ seeking: true });
  tracker.resume({ position: 20 });
  tick(1, 21);
  const value = tracker.checkpoint();
  near(value.mediaExposureSeconds, 3);
  near(value.coveredSeconds, 2);
  assert.equal(value.coverageTruncated, true);
  assert.equal(value.repeatedMediaSeconds, null);
  assert.deepEqual(value.coverageRanges, [[0, 1], [10, 11]]);
});

test('accepted observation callbacks preserve actual monotonic origin, media units, and playback rate', () => {
  const emitted = [];
  let time = 12000;
  const tracker = intervals.createTracker({ now: () => time, onInterval: (value) => emitted.push(value) });
  tracker.begin({ occurrenceId: 'o', trackId: 't', position: 4, duration: 100, rate: 2, playing: true });
  time = 13000;
  tracker.sample({ position: 6, rate: 0.5 });
  time = 15000;
  tracker.sample({ position: 7 });
  assert.deepEqual(emitted, [
    { occurrenceId: 'o', trackId: 't', monotonicStartMs: 12000, monotonicEndMs: 13000,
      mediaStartMs: 4000, mediaEndMs: 6000, speedPermille: 2000, playing: true, discontinuity: false },
    { occurrenceId: 'o', trackId: 't', monotonicStartMs: 13000, monotonicEndMs: 15000,
      mediaStartMs: 6000, mediaEndMs: 7000, speedPermille: 500, playing: true, discontinuity: false },
  ]);
  near(tracker.checkpoint().listenedWallSeconds, 3);
  near(tracker.checkpoint().coveredSeconds, 3);
});

test('interval callbacks exclude seeks, stalls, pauses, blocked samples, gaps and duplicate finalization', () => {
  const emitted = [];
  const { tracker, tick, advance } = fixture({ onInterval: (value) => emitted.push(value) });
  tick(1, 1);
  tick(1, 1); // stall
  tick(1, 50); // unreported seek
  tick(1, 51, { seeking: true });
  tracker.resume({ position: 0 });
  tick(1, 1, { playing: false }); // final eligible progress up to pause
  tick(1, 2);
  tracker.resume({ position: 2 });
  tick(1, 3, { blocked: true });
  tracker.resume({ position: 3 });
  tick(60, 63);
  const done = tracker.finalize({ position: 63 });
  advance(1);
  tracker.finalize({ position: 64 });
  assert.equal(emitted.length, 2);
  near(done.listenedWallSeconds, 2);
  near(emitted.reduce((sum, item) => sum + item.monotonicEndMs - item.monotonicStartMs, 0), 2000);
});

test('clipped progress callbacks do not turn drift or partial stalls into extra media or wall exposure', () => {
  const emitted = [];
  const { tracker, tick } = fixture({ onInterval: (value) => emitted.push(value) });
  tick(1, 1.1);
  tick(4, 2.1);
  assert.deepEqual(emitted.map(({ monotonicStartMs, monotonicEndMs, mediaStartMs, mediaEndMs }) =>
    [monotonicStartMs, monotonicEndMs, mediaStartMs, mediaEndMs]), [
    [0, 1000, 100, 1100], [4000, 5000, 1100, 2100],
  ]);
  near(tracker.checkpoint().listenedWallSeconds, 2);
  near(tracker.checkpoint().mediaExposureSeconds, 2);
});

test('callback exceptions are reported after updating evidence and cannot interrupt measurement', () => {
  let calls = 0;
  const { tracker, tick } = fixture({ onInterval: () => {
    calls += 1;
    near(tracker.checkpoint().listenedWallSeconds, calls);
    throw new Error('Injected ledger failure');
  } });
  assert.doesNotThrow(() => tick(1, 1));
  assert.doesNotThrow(() => tick(1, 2));
  assert.equal(calls, 2);
  assert.equal(tracker.checkpoint().intervalCallbackErrors, 2);
  near(tracker.checkpoint().coveredSeconds, 2);
});

test('restoring the same finalized occurrence replaces its media anchor without reopening it', () => {
  const { tracker, tick } = fixture();
  tick(1, 1);
  const saved = tracker.finalize({ reason: 'ended', naturallyEnded: true });
  tracker.restore({ ...saved, position: 5, duration: 80, rate: 2 });
  assert.equal(tracker.checkpoint().position, 5);
  assert.equal(tracker.checkpoint().duration, 80);
  assert.equal(tracker.checkpoint().rate, 2);
  assert.equal(tracker.checkpoint().finalized, true);
  near(tracker.checkpoint().listenedWallSeconds, 1);
});

test('observed callback intervals feed the actual learning reducer without seek-to-end contamination', () => {
  const occurrenceId = 'actual-occurrence';
  const trackId = 'actual-track';
  const nowMs = 100000;
  let ledger = learning.createLedger({ nowMs });
  let sequence = 0;
  function apply(type, values = {}) {
    sequence += 1;
    const event = { schemaVersion: learning.VERSION, eventId: `listening-test-${sequence}`, type,
      timestampMs: nowMs, producerId: 'listening-test', sequence, occurrenceId, trackId, ...values };
    assert.ok(learning.normalizeEvent(event, { nowMs }), 'actual callback must satisfy the production learning event schema');
    ledger = learning.reduce(ledger, event, { nowMs });
  }
  apply('activated', { durationMs: 100000 });
  let time = 12000;
  const tracker = intervals.createTracker({ now: () => time,
    onInterval: (value) => apply('interval', { ...value, monotonicClockId: 'primary-audio-test-clock' }) });
  tracker.begin({ occurrenceId, trackId, position: 0, duration: 100, rate: 2, playing: true });
  time = 13000;
  tracker.sample({ position: 2, rate: 0.5 });
  time = 15000;
  tracker.sample({ position: 3 });
  time = 16000;
  tracker.sample({ position: 3 }); // a stall must generate no interval
  tracker.sample({ position: 100, seeking: true });
  tracker.finalize({ position: 100, naturallyEnded: true });
  apply('outcome', { outcome: 'natural-end' });
  assert.equal(tracker.checkpoint().intervalCallbackErrors, 0);
  assert.equal(ledger.occurrences[0].wallMs, 3000);
  assert.equal(learning.coverageMs(ledger.occurrences[0]), 3000);
  assert.equal(ledger.tracks[0].heardOccurrences, 1);
  assert.equal(ledger.tracks[0].positiveUnits, 0);
  assert.equal(ledger.tracks[0].negativeUnits, 0);
  assert.equal(ledger.journal.length, 4); // activated, two observed intervals, natural end
});

test('duration corrections keep invalidated exposure distinct from exact repeated sections', () => {
  const { tracker, tick } = fixture();
  for (let position = 1; position <= 10; position += 1) tick(1, position);
  tracker.sample({ duration: 5 });
  near(tracker.checkpoint().mediaExposureSeconds, 10);
  near(tracker.checkpoint().coveredSeconds, 5);
  assert.equal(tracker.checkpoint().coverageTruncated, true);
  assert.equal(tracker.checkpoint().repeatedMediaSeconds, null);
});

console.log(`Windows listening interval checks: ${passed} passed, ${failed} failed.`);
