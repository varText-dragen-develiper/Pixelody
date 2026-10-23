'use strict';

// These are production controller + production policy/learning + real store
// tests. No copied policy, fabricated confirmed callback, Electron profile or
// personal media is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const core = require('../src/shuffle/universal');
const learning = require('../src/shuffle/learning');
const scopes = require('../src/shuffle/scopes');
const adapter = require('../src/renderer-domains/shuffle-controller');
const { PixelodyStateStore } = require('../src/state-store');
const roots = [];
const tests = [];
const passed = [];
const test = (name, run) => tests.push({ name, run });
const clone = (value) => JSON.parse(JSON.stringify(value));
const entries = (count = 5) => Array.from({ length: count }, (_, index) => ({ entryId: `entry-${index}`, trackId: `track-${index}`, artist: `Artist ${index}`, album: `Album ${index}` }));
const active = (controller) => {
  const session = controller.snapshot().session;
  return session.scopes.find((scope) => scope.scopeId === session.activeScopeId).state;
};
function fixture(overrides = {}) {
  let sequence = 0;
  let now = 1791748800000;
  const changes = [];
  const input = { core, learning, scopes, entries: entries(), scopeId: 'library', sessionId: 'session-one', authorityId: 'desktop-one', seed: 'controller-fixture', mode: 'balanced', repeat: 'off',
    nowMs: () => now, newId: (kind) => JSON.stringify([kind, ++sequence]), onChange: (change) => changes.push(change), ...overrides };
  return { controller: adapter.createController(input), input, changes, advance: (milliseconds) => { now += milliseconds; } };
}
function activate(controller, request = {}, detail = {}) {
  const staged = controller.stage(request);
  assert.equal(staged.ok, true, `Expected a staged offer, got ${staged.status}`);
  const result = controller.confirm(staged, detail);
  assert.equal(result.ok, true);
  assert.equal(result.current.trackId, staged.trackId);
  return { staged, result };
}
function drain(controller) {
  const heard = [];
  for (let i = 0; i < 100; i += 1) {
    const staged = controller.stage();
    if (!staged.ok) return heard;
    assert.equal(controller.confirm(staged).ok, true);
    heard.push(staged.entryId);
  }
  throw new Error('Unexpected unbounded traversal');
}

test('UMD controller loads without importing another domain', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer-domains/shuffle-controller.js'), 'utf8'), context);
  assert.equal(typeof context.PixelodyShuffleController.createController, 'function');
});

for (const mode of core.MODES) test(`${mode} controller projects actual full repeat-off traversal without consumption on paint`, () => {
  const { controller } = fixture({ mode });
  const initial = active(controller);
  const projected = controller.project({ horizon: 5 });
  assert.deepEqual(active(controller), initial);
  assert.deepEqual(controller.project({ horizon: 5 }), projected);
  const confirmed = drain(controller);
  assert.deepEqual(confirmed, projected.entryIds);
  assert.equal(new Set(confirmed).size, 5);
  assert.equal(active(controller).remaining.length, 0);
  assert.equal(active(controller).cycle.generation, 0);
});

test('staging is idempotent; only successful activation consumes RNG and entitlement once', () => {
  const { controller } = fixture();
  const before = active(controller);
  const staged = controller.stage({ attemptId: 'idempotent-attempt' });
  const repeated = controller.stage({ attemptId: 'idempotent-attempt' });
  assert.deepEqual(repeated.reservation, staged.reservation);
  assert.deepEqual(active(controller).rng, before.rng);
  assert.deepEqual(active(controller).remaining, before.remaining);
  assert.equal(controller.snapshot().ledger.tracks.length, 0);
  assert.equal(controller.confirm(staged).ok, true);
  const committed = controller.snapshot();
  assert.equal(controller.confirm(staged).status, 'stale-or-duplicate');
  assert.deepEqual(controller.snapshot(), committed);
  assert.equal(active(controller).remaining.length, before.remaining.length - 1);
  assert.equal(controller.snapshot().ledger.tracks[0].activated, 1);
});

test('failed activation keeps entitlement and retries are bounded across all unavailable offers', () => {
  const { controller } = fixture();
  const before = active(controller);
  const failed = [];
  for (let i = 0; i < 6; i += 1) {
    const staged = controller.stage();
    if (!staged.ok) break;
    failed.push(staged.entryId);
    assert.equal(controller.fail(staged, 'decode-error').personalOutcomeRecorded, false);
  }
  assert.equal(new Set(failed).size, 5);
  assert.equal(controller.stage().status, 'exhausted');
  assert.deepEqual(active(controller).remaining, before.remaining);
  assert.deepEqual(active(controller).rng, before.rng);
  assert.equal(active(controller).history.length, 0);
  assert.equal(controller.snapshot().ledger.tracks.length, 0);
  assert.equal(activate(controller, { entryId: failed[0] }).result.ok, true, 'An explicit retry starts a fresh user attempt.');
});

test('membership, explicit edits and authority changes reject stale callbacks', () => {
  const { controller } = fixture();
  let staged = controller.stage();
  controller.reconcile(entries(6));
  assert.equal(controller.confirm(staged).ok, false);
  staged = controller.stage();
  controller.mutate({ type: 'priority', entryId: 'entry-5' });
  assert.equal(controller.confirm(staged).ok, false);
  staged = controller.stage();
  controller.setAuthority('desktop-two', 1);
  assert.equal(controller.confirm(staged).ok, false);
  const fresh = controller.stage();
  const forged = { ...fresh.reservation, revision: fresh.reservation.revision + 1 };
  assert.equal(controller.confirm(forged).ok, false);
  assert.equal(controller.confirm(fresh).ok, true);
});

test('repeat-all enters one new generation; repeat-one replay preserves entitlement', () => {
  const { controller } = fixture({ mode: 'off' });
  drain(controller);
  controller.setRepeat('all');
  activate(controller);
  assert.equal(active(controller).cycle.generation, 1);
  assert.equal(active(controller).remaining.length, 4);
  controller.setRepeat('one');
  const before = active(controller);
  const replay = activate(controller, { naturalEnd: true });
  assert.equal(replay.staged.receipt.kind, 'repeat-one');
  assert.notEqual(replay.result.current.occurrenceId, before.history[before.cursor].occurrenceId);
  assert.deepEqual(active(controller).remaining, before.remaining);
  assert.equal(active(controller).cycle.generation, 1);
  const next = activate(controller);
  assert.notEqual(next.staged.receipt.kind, 'repeat-one');
});

test('Previous/Next keeps occurrence history and learning identifies each actual activation', () => {
  const { controller } = fixture({ mode: 'off' });
  const a = activate(controller);
  controller.outcome({ outcome: 'interrupted', reason: 'shutdown' });
  const b = activate(controller);
  const c = activate(controller);
  const history = active(controller).history;
  const previous = activate(controller, { direction: 'previous' });
  assert.equal(previous.result.current.trackId, b.result.current.trackId);
  assert.deepEqual(active(controller).history, history);
  assert.notEqual(previous.result.learningOccurrenceId, b.result.learningOccurrenceId);
  const forward = activate(controller);
  assert.equal(forward.result.current.trackId, c.result.current.trackId);
  assert.deepEqual(active(controller).history, history);
  assert.notEqual(a.result.learningOccurrenceId, previous.result.learningOccurrenceId);
});

test('manual priority, movement, removal and undo match the authoritative projection', () => {
  for (const mode of core.MODES) {
    const { controller } = fixture({ mode });
    controller.mutate({ type: 'priority', entryId: 'entry-4' });
    controller.mutate({ type: 'move', entryId: 'entry-3', index: 1 });
    assert.deepEqual(controller.project({ horizon: 2 }).entryIds, ['entry-4', 'entry-3']);
    assert.equal(activate(controller).staged.entryId, 'entry-4');
    const original = controller.project({ horizon: 4 }).entryIds;
    controller.mutate({ type: 'remove', entryId: 'entry-3' });
    assert.equal(controller.project({ horizon: 4 }).entryIds.includes('entry-3'), false);
    controller.mutate({ type: 'undo' });
    assert.deepEqual(controller.project({ horizon: 4 }).entryIds, original);
  }
});

test('track-only play is rejected when an intentional duplicate requires entry identity', () => {
  const { controller } = fixture({ entries: [{ entryId: 'one', trackId: 'same' }, { entryId: 'two', trackId: 'same' }] });
  assert.equal(controller.stage({ trackId: 'same' }).status, 'ambiguous-track-occurrence');
  assert.equal(activate(controller, { entryId: 'two' }).staged.receipt.intentionalDuplicate, true);
  assert.equal(activate(controller, { entryId: 'one' }).staged.entryId, 'one');
});

test('scope switching and cold restore preserve unfinished independent entitlements', () => {
  const { controller, input } = fixture({ mode: 'off' });
  activate(controller);
  const library = active(controller);
  controller.selectScope({ scopeId: 'playlist-stable', entries: entries(3), sessionId: 'playlist-session' });
  activate(controller);
  const playlist = active(controller);
  controller.selectScope({ scopeId: 'library', entries: entries() });
  assert.deepEqual(active(controller).remaining, library.remaining);
  assert.deepEqual(active(controller).rng, library.rng);
  assert.deepEqual(active(controller).history, library.history);
  const saved = controller.snapshot();
  const restored = adapter.createController({ ...input, sessionSnapshot: saved.session, ledgerSnapshot: saved.ledger });
  assert.equal(active(restored).paused, true);
  restored.selectScope({ scopeId: 'playlist-stable', entries: entries(3) });
  assert.deepEqual(active(restored).remaining, playlist.remaining);
  assert.deepEqual(active(restored).history, playlist.history);
});

test('real durable checkpoint restores paused position and aborts unconfirmed activation', async () => {
  const { controller, input } = fixture();
  const confirmed = activate(controller);
  controller.checkpointPosition({ trackId: confirmed.staged.trackId, position: 21.25, volume: 0.6 });
  const before = active(controller);
  controller.stage({ attemptId: 'pending-crash' });
  const snapshot = controller.snapshot();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelody-shuffle-controller-'));
  roots.push(directory);
  const stateStore = new PixelodyStateStore({ directory });
  await stateStore.commit({ 'pixelody.shuffleSession': snapshot.session, 'pixelody.shuffleLedger': snapshot.ledger });
  const values = new PixelodyStateStore({ directory }).loadSync().state.values;
  const restored = adapter.createController({ ...input, sessionSnapshot: values['pixelody.shuffleSession'], ledgerSnapshot: values['pixelody.shuffleLedger'] });
  assert.equal(active(restored).paused, true);
  assert.equal(active(restored).pending, null);
  assert.deepEqual(active(restored).remaining, before.remaining);
  assert.deepEqual(active(restored).rng, before.rng);
  assert.equal(restored.current().position.position, 21.25);
  assert.equal(restored.current().position.volume, 0.6);
  assert.equal(restored.confirm({ attemptId: 'pending-crash' }).ok, false);
});

for (const corruption of ['future-wrapper', 'future-core', 'corrupt-core', 'future-ledger', 'corrupt-ledger']) test(`${corruption} preserves raw snapshots read-only`, () => {
  const { controller, input } = fixture();
  activate(controller);
  const original = controller.snapshot();
  if (corruption === 'future-wrapper') original.session.schemaVersion += 100;
  if (corruption === 'future-core') original.session.scopes[0].state.schemaVersion += 100;
  if (corruption === 'corrupt-core') original.session.scopes[0].state.remaining = ['missing'];
  if (corruption === 'future-ledger') original.ledger.schemaVersion += 100;
  if (corruption === 'corrupt-ledger') original.ledger.tracks = false;
  const restored = adapter.createController({ ...input, sessionSnapshot: original.session, ledgerSnapshot: original.ledger });
  assert.equal(restored.status().readOnly, true);
  for (const operation of [() => restored.stage(), () => restored.setMode('off'), () => restored.newCycle(), () => restored.control('learning-reset'),
    () => restored.reconcile([]), () => restored.selectScope({ scopeId: 'new' }), () => restored.importActiveSession(active(controller)), () => restored.importLedger(controller.exportLedger())]) {
    assert.equal(operation().status, 'read-only');
  }
  assert.deepEqual(restored.snapshot(), original);
});

test('actual monotonic heard intervals deduplicate, exclude pauses/seeks and cannot manufacture completion', () => {
  const { controller, advance } = fixture({ mode: 'off' });
  const confirmed = activate(controller, {}, { durationMs: 100000 });
  advance(10000);
  const interval = { eventId: 'heard-1', monotonicClockId: 'audio-clock', monotonicStartMs: 0, monotonicEndMs: 10000, mediaStartMs: 0, mediaEndMs: 10000, playing: true };
  assert.equal(controller.interval(interval).ok, true);
  const once = controller.snapshot().ledger;
  assert.equal(controller.interval(interval).ok, false);
  assert.deepEqual(controller.snapshot().ledger, once);
  controller.interval({ ...interval, eventId: 'paused', monotonicStartMs: 10000, monotonicEndMs: 20000, mediaStartMs: 10000, mediaEndMs: 20000, playing: false });
  controller.interval({ ...interval, eventId: 'seek', monotonicStartMs: 20000, monotonicEndMs: 21000, mediaStartMs: 10000, mediaEndMs: 100000, discontinuity: true });
  controller.outcome({ eventId: 'ended', outcome: 'natural-end' });
  const row = controller.snapshot().ledger.tracks.find((track) => track.trackId === confirmed.staged.trackId);
  assert.equal(row.heardWallMs, 10000);
  assert.equal(row.positiveUnits, 0);
  assert.equal(row.negativeUnits, 0);
});

test('infrastructure and nonpersonal playback teach no dislike; explicit local preference remains usable', () => {
  const { controller } = fixture({ mode: 'off' });
  const local = activate(controller, {}, { durationMs: 100000 });
  controller.interval({ monotonicClockId: 'clock', monotonicStartMs: 0, monotonicEndMs: 5000, mediaStartMs: 0, mediaEndMs: 5000, playing: true });
  controller.outcome({ outcome: 'deliberate-skip', userInitiated: true, reason: 'network-error' });
  assert.equal(controller.snapshot().ledger.tracks.find((row) => row.trackId === local.staged.trackId).negativeUnits, 0);
  const remote = activate(controller, { source: 'remote' }, { durationMs: 100000 });
  controller.interval({ monotonicClockId: 'clock', monotonicStartMs: 0, monotonicEndMs: 5000, mediaStartMs: 0, mediaEndMs: 5000, playing: true });
  controller.outcome({ outcome: 'deliberate-skip', userInitiated: true });
  assert.equal(controller.snapshot().ledger.tracks.some((row) => row.trackId === remote.staged.trackId), false);
  controller.preference(remote.staged.trackId, 1);
  assert.equal(controller.snapshot().ledger.tracks.find((row) => row.trackId === remote.staged.trackId).explicitPreference, 1);
});

test('learning reset/history/delete controls remain separate from the active queue', () => {
  const { controller } = fixture();
  activate(controller);
  const traversal = active(controller);
  controller.preference('track-0', 1);
  controller.control('history-delete');
  assert.equal(controller.snapshot().ledger.tracks.find((row) => row.trackId === 'track-0').explicitPreference, 1);
  controller.control('learning-enabled', { enabled: false });
  assert.equal(controller.snapshot().ledger.enabled, false);
  controller.control('learning-reset');
  assert.deepEqual(controller.snapshot().ledger.tracks, []);
  controller.control('ledger-delete');
  assert.deepEqual(active(controller), traversal);
});

test('portable Core session and private ledger import/export execute production validation', () => {
  const { controller } = fixture();
  activate(controller);
  const exported = controller.exportActiveSession();
  const privateLedger = controller.exportLedger();
  const { controller: target } = fixture({ scopeId: 'different' });
  assert.equal(target.importActiveSession(exported).ok, true);
  assert.equal(active(target).paused, true);
  assert.deepEqual(active(target).history, exported.history);
  assert.equal(target.importLedger(privateLedger).ok, true);
  const before = target.snapshot();
  assert.equal(target.importActiveSession({ ...exported, schemaVersion: 999 }).ok, false);
  assert.equal(target.importLedger({ ...privateLedger, schemaVersion: 999 }).ok, false);
  assert.deepEqual(target.snapshot(), before);
});

test('scope capacity requires explicit eviction and preserves unfinished entitlement through restart', () => {
  const { controller, input } = fixture();
  activate(controller);
  const libraryRemaining = active(controller).remaining;
  for (let index = 1; index < scopes.MAX_SCOPES; index += 1) {
    assert.equal(controller.selectScope({ scopeId: `scope-${index}`, entries: entries() }).ok, true);
  }
  const before = controller.snapshot();
  assert.equal(controller.selectScope({ scopeId: 'overflow', entries: entries() }).status, 'capacity-requires-explicit-eviction');
  assert.deepEqual(controller.snapshot(), before);
  assert.equal(controller.evictScope(controller.status().activeScopeId).status, 'active-scope-requires-switch');
  assert.equal(controller.evictScope('scope-1').ok, true);
  assert.equal(controller.selectScope({ scopeId: 'overflow', entries: entries() }).ok, true);
  assert.equal(controller.selectScope({ scopeId: 'library' }).ok, true);
  assert.deepEqual(active(controller).remaining, libraryRemaining);
  const snapshot = controller.snapshot();
  const restored = adapter.createController({ ...input, sessionSnapshot: snapshot.session, ledgerSnapshot: snapshot.ledger });
  assert.deepEqual(active(restored).remaining, libraryRemaining);
  assert.equal(restored.status().scopeCount, scopes.MAX_SCOPES);
  assert.equal(restored.status().evictions[0].scopeId, 'scope-1');
  assert.equal(restored.status().evictions[0].unfinishedEntitlements, entries().length);
  assert.equal(restored.status().evictions[0].completed, false);
});

test('oversized stored scope bank is preserved read-only rather than silently discarded', () => {
  const { controller, input } = fixture();
  const snapshot = controller.snapshot();
  const original = snapshot.session.scopes[0];
  snapshot.session.scopes = Array.from({ length: scopes.MAX_SCOPES + 1 }, (_, index) => ({ ...clone(original), scopeId: `scope-${index}`, state: { ...clone(original.state), scopeId: `scope-${index}` } }));
  snapshot.session.activeScopeId = 'scope-0';
  const restored = adapter.createController({ ...input, sessionSnapshot: snapshot.session, ledgerSnapshot: snapshot.ledger });
  assert.equal(restored.status().readOnly, true);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.stage().status, 'read-only');
});

test('legacy traversal migration preserves history but fabricates no learning evidence', () => {
  const { controller } = fixture({ legacy: { plan: { style: 'standard', order: ['track-0', 'track-1'], cursor: 0, seed: 'old' } } });
  assert.equal(active(controller).imported, true);
  assert.equal(active(controller).history.length, 2);
  assert.equal(controller.snapshot().ledger.tracks.length, 0);
  assert.equal(controller.snapshot().ledger.journal.length, 0);
});

async function main() {
  for (const { name, run } of tests) { await run(); passed.push(name); console.log(`PASS ${name}`); }
  const sources = ['src/renderer-domains/shuffle-controller.js', 'scripts/check-shuffle-windows-controller.js', 'src/shuffle/universal.js', 'src/shuffle/learning.js', 'src/shuffle/scopes.js'];
  const receipt = { suite: 'windows-shuffle-controller', passed: passed.length, tests: passed, testedAt: new Date().toISOString(), policyVersion: core.POLICY_VERSION,
    sourceHashes: Object.fromEntries(sources.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex')])),
    dependencyStatus: fixture().controller.status().dependencies,
    openGates: ['core-ready.json and stable machine contract are required before production adoption.', 'Renderer/audio/service transport wiring remains with Windows integrator.', 'No Electron, audible, painted UI, packaged or installed-profile evidence.'] };
  const receiptFlag = process.argv.indexOf('--receipt');
  if (receiptFlag >= 0) {
    if (!process.argv[receiptFlag + 1]) throw new Error('--receipt requires an output path');
    const destination = path.resolve(process.argv[receiptFlag + 1]); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  console.log(`Windows shuffle controller audit passed: ${passed.length} production controller/Core/learning/store scenarios.`);
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  for (const directory of roots) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.equal(path.basename(resolved).startsWith('pixelody-shuffle-controller-'), true);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
