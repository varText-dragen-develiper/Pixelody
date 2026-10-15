'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const policy = require('../src/shuffle/universal');
const scopes = require('../src/shuffle/scopes');
const learning = require('../src/shuffle/learning');
const directory = path.resolve(__dirname, '../docs/api-contract-fixtures/shuffle-universal-v2');
const receiptDirectory = path.resolve(__dirname, '../.artifacts/shuffle-universal/core');
const write = process.argv.includes('--write-fixtures');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
let checks = 0;
function test(name, run) { run(); checks += 1; console.log('PASS ' + name); }
const entry = (trackId, extra = {}) => ({ entryId: trackId, trackId, ...extra });
const base = (extra = {}) => ({ sessionId: 'session-1', scopeId: 'library-1', authorityId: 'device-1', seed: 'portable-🎵-seed', mode: 'balanced', entries: ['a', 'b', 'c', 'd'].map((s) => entry(s, { artist: 'Artist ' + s, album: 'Album ' + s })), ...extra });
const activate = (state, request = {}, context = {}) => { const staged = policy.stage(state, { attemptId: 'attempt-' + state.revision, ...request }, context); assert.ok(staged.pending, 'expected staged candidate'); return policy.commit(staged, staged.pending); };

test('pinned ordinal identities and honest features', () => {
  assert.equal(policy.normalizeEntry(entry('猫', { artist: '東京' })).artistId, '東京');
  assert.notEqual(policy.textIdentity('猫'), policy.textIdentity('犬'));
  assert.equal(policy.textIdentity('e\u0301'), policy.textIdentity('é'));
  assert.equal(policy.normalizeEntry(entry('a', { features: { energy: { value: null, provenance: 'measured' } } })).features.energy.value, null);
  assert.equal(policy.normalizeEntry(entry('a', { features: { energy: { value: 0, provenance: 'measured' } } })).features.energy.value, 0);
  assert.equal(policy.normalizeEntry(entry('a', { features: { energy: 0.7, tempo: 120 } })).features.energy.value, null);
  assert.equal(policy.normalizeEntry(entry('a')).recordingId, null);
  assert.deepEqual(policy.parseKey('D♭ minor'), { pitchClass: 1, mode: 'minor' });
  assert.deepEqual(policy.parseKey('8A'), { pitchClass: 9, mode: 'minor' });
  assert.equal(policy.parseKey('C nonsense'), null);
  assert.throws(() => policy.normalizeEntry(entry('\ud800')), /Invalid/);
  assert.throws(() => policy.createSession(base({ entries: [entry('x'), entry('x')] })), /Duplicate entryId/);
});
test('staging/painting/failure/crash preserve RNG and entitlement', () => {
  const state = policy.createSession(base({ mode: 'random' })), frozen = policy.canonicalJson(state);
  const staged = policy.stage(state, { attemptId: 'first', advanceId: 'next-1' });
  assert.deepEqual(staged.rng, state.rng); assert.deepEqual(staged.remaining, state.remaining); assert.deepEqual(staged.history, []);
  assert.equal(policy.stage(staged, { attemptId: 'first' }), staged);
  policy.project(staged); assert.equal(policy.canonicalJson(state), frozen);
  const failed = policy.abort(staged, staged.pending); assert.deepEqual(failed.remaining, state.remaining); assert.deepEqual(failed.rng, state.rng);
  const retried = policy.stage(failed, { attemptId: 'retry', advanceId: 'next-1' }); assert.notEqual(retried.pending.entryId, staged.pending.entryId);
  const restored = policy.restore(staged); assert.equal(restored.status, 'restored'); assert.equal(restored.state.paused, true); assert.equal(restored.state.pending, null); assert.deepEqual(restored.state.remaining, state.remaining);
  const committed = policy.commit(staged, staged.pending); assert.equal(policy.commit(committed, staged.pending), committed);
  assert.equal(policy.commit(staged, { ...staged.pending, authorityEpoch: 99 }), staged);
});
test('all modes offer every occurrence exactly once and repeat off stops', () => {
  for (const mode of policy.MODES) {
    let state = policy.createSession(base({ mode, entries: [entry('one', { trackId: 'same' }), entry('two', { trackId: 'same' }), entry('three')] }));
    for (let i = 0; i < 3; i += 1) state = activate(state);
    assert.equal(new Set(state.history.map((h) => h.entryId)).size, 3, mode);
    assert.equal(new Set(state.history.map((h) => h.occurrenceId)).size, 3);
    assert.equal(policy.stage(state, { attemptId: 'exhausted' }).pending, null);
    assert.equal(state.cycle.generation, 0);
    assert.ok(state.history.some((h) => h.receipt.intentionalDuplicate));
  }
});
test('singleton/empty Repeat One and All create genuine committed occurrences', () => {
  for (const repeat of ['off', 'one', 'all']) {
    let state = activate(policy.createSession(base({ entries: [entry('a')], repeat })));
    const next = policy.stage(state, { attemptId: 'next', naturalEnd: true });
    if (repeat === 'off') assert.equal(next.pending, null);
    else { state = policy.commit(next, next.pending); assert.equal(state.history.length, 2); assert.equal(state.cycle.generation, repeat === 'all' ? 1 : 0); }
  }
  assert.equal(policy.stage(policy.createSession(base({ entries: [], repeat: 'all' })), { attemptId: 'empty' }).pending, null);
});
test('actual A B A history, previous/forward, explicit fork and tombstones', () => {
  let state = policy.createSession(base({ mode: 'off' }));
  state = activate(state, { entryId: 'a' }); state = activate(state, { entryId: 'b' }); state = activate(state, { entryId: 'a' });
  assert.deepEqual(state.history.map((h) => h.entryId), ['a', 'b', 'a']);
  state = activate(state, { direction: 'previous' }); assert.equal(state.cursor, 1);
  state = activate(state); assert.equal(state.cursor, 2); assert.equal(state.history.length, 3);
  state = activate(state, { direction: 'previous' });
  const pendingFork = policy.stage(state, { attemptId: 'fork', entryId: 'd' }); assert.equal(pendingFork.history.length, 3);
  state = policy.commit(pendingFork, pendingFork.pending); assert.deepEqual(state.history.map((h) => h.entryId), ['a', 'b', 'd']);
  state = policy.mutate(state, { type: 'remove', entryId: 'b' }); assert.equal(state.history[1].tombstone, true); assert.equal(state.history.length, 3);
  state = policy.mutate(state, { type: 'undo' }); assert.equal(state.history[1].tombstone, false); assert.ok(state.entries.some((e) => e.entryId === 'b'));
});
test('priority and exact manual future positions override every mode', () => {
  for (const mode of policy.MODES) {
    let state = policy.createSession(base({ mode }));
    state = policy.mutate(state, { type: 'priority', entryId: 'd', intentId: 'intent-1' });
    assert.equal(policy.project(state).entryIds[0], 'd', mode);
    state = activate(state); assert.equal(state.history[0].entryId, 'd');
    state = policy.mutate(state, { type: 'move', entryId: 'c', index: 1, intentId: 'intent-2' });
    assert.equal(policy.project(state).entryIds[1], 'c', mode);
    assert.equal(state.manual[0].position, 1, 'projection must not mutate explicit intent');
  }
});
test('mode change/off freeze/reshuffle preserve unfinished scope entitlement', () => {
  let state = activate(policy.createSession(base({ mode: 'random' })));
  const future = policy.project(state).entryIds;
  const remaining = state.remaining.slice();
  state = policy.setMode(state, 'off'); assert.deepEqual(policy.project(state).entryIds, future); assert.deepEqual(state.remaining, remaining);
  state = policy.reduce(state, { type: 'reshuffle-remaining' }); assert.deepEqual(state.remaining, remaining);
  state = policy.reduce(state, { type: 'session-change', sessionId: 'session-2' }); assert.deepEqual(state.remaining, remaining);
  state = policy.restore(state).state; assert.deepEqual(state.remaining, remaining); assert.equal(state.paused, true);
});
test('album lock survives horizon/restart/compilation/manual middle/remove', () => {
  const entries = Array.from({ length: 40 }, (_, i) => entry('album-' + i, { artist: 'Performer ' + i, albumArtist: 'Various', album: 'Compilation', discNumber: i < 20 ? 1 : 2, trackNumber: i % 20 + 1 }));
  let state = activate(policy.createSession(base({ mode: 'album', entries })));
  assert.equal(state.albumLock.entryIds.length, 39);
  state = policy.restore(state).state; assert.equal(policy.project(state).entryIds[0], 'album-1');
  state = activate(state, { entryId: 'album-20' }); assert.equal(policy.project(state).entryIds[0], 'album-21'); assert.ok(state.remaining.includes('album-1'));
  state = policy.mutate(state, { type: 'remove', entryId: 'album-22' }); assert.ok(!policy.project(state).entryIds.includes('album-22'));
  state = policy.setMode(state, 'balanced'); assert.equal(state.albumLock, null);
  const gap = policy.createSession(base({ mode: 'album', entries: [entry('z', { albumId: 'gap' }), entry('a', { albumId: 'gap', discNumber: 1, trackNumber: 1 })] }));
  assert.equal(policy.stage(gap, { attemptId: 'gap' }).pending.receipt.albumOrdering, 'source-order-missing-numbers');
});
test('membership reconciles, unavailable media remains owed and no rebinding', () => {
  let state = activate(policy.createSession(base({ mode: 'off' })));
  state = policy.reconcile(state, [...state.entries.filter((e) => e.entryId !== 'b'), entry('new')]);
  assert.deepEqual(state.remaining, ['c', 'd', 'new']); assert.equal(state.history[0].entryId, 'a');
  assert.throws(() => policy.reconcile(state, [entry('a', { trackId: 'different' })]), /rebinding/);
  let unavailable = policy.createSession(base({ entries: [entry('a', { available: false })], repeat: 'all' }));
  unavailable = policy.stage(unavailable, { attemptId: 'bad' }); assert.equal(unavailable.pending, null); assert.deepEqual(unavailable.remaining, ['a']); assert.equal(unavailable.cycle.generation, 0);
});
test('migration and future/corrupt schema preserve original snapshots', () => {
  const legacy = { plan: { style: 'standard', seed: 'v1', order: ['a', 'b', 'a', 'removed'], cursor: 2 } };
  const original = json(legacy), migrated = policy.migrateLegacy(legacy, base());
  assert.equal(json(legacy), original); assert.deepEqual(migrated.history.map((h) => h.trackId), legacy.plan.order); assert.equal(migrated.history[3].tombstone, true); assert.equal(migrated.imported, true);
  assert.equal(policy.restore({ ...migrated, schemaVersion: 9 }).status, 'unsupported');
  assert.equal(policy.restore({ ...migrated, remaining: ['not-in-pool'] }).status, 'corrupt');
});
test('public projection has safe occurrence identities and real policy context', () => {
  const state = activate(policy.createSession(base({ mode: 'flow', entries: [entry('a', { trackId: 'C:/private/a.mp3' }), entry('b', { trackId: 'secret-token' }), entry('c')] })));
  const context = { nowMs: 100000, signals: [{ trackId: 'secret-token', tastePoints: -12, noveltyPoints: 0, exposure: 10, lastHeardAtMs: 99000 }] };
  const mapper = (s) => hash(s).slice(0, 24), mappers = Object.fromEntries(['trackId', 'entryId', 'occurrenceId', 'decisionId', 'authorityId'].map((k) => [k, mapper]));
  const publicState = policy.publicSnapshot(state, mappers, context), expected = policy.project(state, { context });
  assert.deepEqual(publicState.future.map((d) => d.entryId), expected.entryIds.map(mapper));
  assert.equal(publicState.current.occurrenceId, mapper(state.history[state.cursor].occurrenceId));
  assert.ok(!json(publicState).includes('private')); assert.ok(!json(publicState).includes('secret-token')); assert.ok(!json(publicState).includes('features'));
  assert.throws(() => policy.publicSnapshot(state, mappers), /context required/);
});
test('event sequencing rejects retry/gaps and authority epoch invalidates callbacks', () => {
  let state = policy.createSession(base());
  const event = { type: 'repeat-change', repeat: 'all', eventId: 'command-1', producerId: 'controller', sequence: 1 };
  state = policy.reduce(state, event); assert.equal(policy.reduce(state, event), state);
  assert.throws(() => policy.reduce(state, { ...event, sequence: 3 }), /gap/);
  const staged = policy.stage(state, { attemptId: 'old-authority' });
  state = policy.reduce(staged, { type: 'authority-change', authorityId: 'device-2', authorityEpoch: 1 });
  assert.equal(policy.commit(state, staged.pending), state); assert.equal(state.paused, true);
});
test('bounded scope bank requires explicit eviction without false completion', () => {
  let bank = scopes.createBank();
  for (let i = 0; i < scopes.MAX_SCOPES; i += 1) bank = scopes.save(bank, policy.createSession(base({ scopeId: 'scope-' + i })), { nowMs: i }).bank;
  assert.equal(scopes.save(bank, policy.createSession(base({ scopeId: 'overflow' }))).status, 'capacity-requires-explicit-eviction');
  const evicted = scopes.evict(bank, 'scope-0'); assert.equal(evicted.diagnostic.completed, false); assert.equal(scopes.restore(evicted.bank, 'scope-0').status, 'explicitly-evicted');
});
test('exact integer bounded draws and cancelable one-selection projection batches', () => {
  let rng = policy.createRng('integer-mapping');
  for (const bound of [1, 3, 1000, 1000000, 128000000]) {
    for (let i = 0; i < 100; i += 1) {
      const expected = policy.draw(rng), actual = policy.bounded(rng, bound);
      assert.equal(actual.value, Number(BigInt(expected.value) * BigInt(bound) / 4294967296n));
      rng = actual.rng;
    }
  }
  const state = policy.createSession(base({ mode: 'flow' }));
  const first = policy.advanceProjection(policy.createProjection(state), { nowMs: 1000 });
  assert.equal(first.decisions.length, 1); assert.deepEqual(state.history, []);
  const canceled = policy.advanceProjection(first, { cancelled: true });
  assert.equal(canceled.done, true); assert.equal(canceled.decisions.length, 1);
});
test('legacy future traversal consumes only its confirmed imported entitlement', () => {
  let state = policy.migrateLegacy({ plan: { style: 'standard', seed: 'old', order: ['a', 'c', 'b', 'd'], cursor: 0 } }, base({ mode: 'random' }));
  assert.deepEqual(state.remaining, ['b', 'c', 'd']);
  for (let i = 0; i < 3; i += 1) state = activate(state);
  assert.deepEqual(state.remaining, []);
  assert.equal(policy.stage(state, { attemptId: 'stop-imported' }).pending, null);
});
test('restore rejects malformed active structures without erasing the source', () => {
  const state = policy.createSession(base());
  for (const patch of [{ options: null }, { manual: [{ entryId: 'a' }] }, { eventSequences: null }, { albumLock: { entryIds: ['removed'] } }, { lastConfirmedPositionMs: -1 }, { occurrenceSequence: -1 }]) {
    const corrupt = { ...state, ...patch }, recovered = policy.restore(corrupt);
    assert.equal(recovered.status, 'corrupt'); assert.deepEqual(recovered.preserved, corrupt);
  }
});
test('exploration receipts exclude scores that did not decide the choice', () => {
  let seen = false;
  for (let i = 0; i < 100; i += 1) {
    const state = policy.createSession(base({ mode: 'flow', seed: 'receipt-' + i, options: { preset: 'comfort' } }));
    const staged = policy.stage(state, { attemptId: 'receipt' }, { nowMs: 100000000, signals: state.entries.map((e) => ({ trackId: e.trackId, noveltyPoints: 0, exposure: 4, tastePoints: -8, lastHeardAtMs: 0 })) });
    if (staged.pending.receipt.exploration) {
      assert.equal(staged.pending.receipt.scoreParts, null);
      assert.deepEqual(staged.pending.receipt.signalCoverage, ['exposure']); seen = true; break;
    }
  }
  assert.equal(seen, true);
});

// A small independent JSON-Schema interpreter validates the shipped schema's
// keywords, rather than relying on a dependency not installed by this project.
function validate(schema, value, root = schema, location = '$') {
  if (schema.$ref) return validate(root.$defs[schema.$ref.split('/').pop()], value, root, location);
  if (schema.allOf) for (const sub of schema.allOf) validate(sub, value, root, location);
  if (schema.if) { let matches = false; try { validate(schema.if, value, root, location); matches = true; } catch {} if (matches && schema.then) validate(schema.then, value, root, location); }
  if (schema.required && schema.type !== 'object') for (const key of schema.required) assert.ok(value && Object.hasOwn(value, key), location + '.' + key);
  if (schema.properties && schema.type !== 'object') for (const [key, sub] of Object.entries(schema.properties)) if (value && Object.hasOwn(value, key)) validate(sub, value[key], root, location + '.' + key);
  if (schema.anyOf) { assert.ok(schema.anyOf.some((s) => { try { validate(s, value, root, location); return true; } catch { return false; } }), location + ' anyOf'); return; }
  if (schema.enum) assert.ok(schema.enum.some((v) => policy.canonicalJson(v) === policy.canonicalJson(value)), location + ' enum');
  if ('const' in schema) assert.deepEqual(value, schema.const, location + ' const');
  if (schema.type === 'null') assert.equal(value, null, location);
  if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', location);
  if (schema.type === 'string') { assert.equal(typeof value, 'string', location); if (schema.minLength) assert.ok(value.length >= schema.minLength, location); if (schema.maxLength) assert.ok(value.length <= schema.maxLength, location); }
  if (schema.type === 'integer') { assert.ok(Number.isSafeInteger(value), location); if (schema.minimum != null) assert.ok(value >= schema.minimum, location); if (schema.maximum != null) assert.ok(value <= schema.maximum, location); }
  if (schema.type === 'array') { assert.ok(Array.isArray(value), location); if (schema.minItems != null) assert.ok(value.length >= schema.minItems, location); if (schema.maxItems != null) assert.ok(value.length <= schema.maxItems, location); if (schema.items) value.forEach((v, i) => validate(schema.items, v, root, location + '[' + i + ']')); }
  if (schema.type === 'object') { assert.ok(value && typeof value === 'object' && !Array.isArray(value), location); for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), location + '.' + key); for (const [key, v] of Object.entries(value)) { if (schema.properties?.[key]) validate(schema.properties[key], v, root, location + '.' + key); else if (schema.additionalProperties === false) assert.fail(location + ' unexpected ' + key); } }
}
const S = { type: 'string' }, I = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, ID = { type: 'string', minLength: 1, maxLength: 1024 }, B = { type: 'boolean' }, N = { type: 'null' };
const nullable = (s) => ({ anyOf: [N, s] }), list = (s) => ({ type: 'array', items: s }), ref = (name) => ({ $ref: '#/$defs/' + name });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const defs = {};
defs.key = object({ pitchClass: { type: 'integer', minimum: 0, maximum: 11 }, mode: { enum: ['major', 'minor'] } });
const featureSchema = (kind) => object({ value: nullable(kind === 'key' ? ref('key') : kind === 'energy' ? { type: 'integer', minimum: 0, maximum: 1000 } : { type: 'integer', minimum: 20000, maximum: 400000 }), provenance: { enum: policy.PROVENANCE }, version: { type: 'integer', minimum: 1, maximum: 100000 }, confidencePermille: nullable({ type: 'integer', minimum: 0, maximum: 1000 }), unit: { const: kind === 'key' ? 'pitch-class-mode' : kind === 'energy' ? 'permille' : 'milli-bpm' } });
defs.entry = object({ entryId: ID, trackId: ID, recordingId: nullable(ID), artistId: nullable(S), albumArtistId: nullable(S), albumId: nullable(S), sourceIndex: I, discNumber: nullable({ type: 'integer', minimum: 1, maximum: 10000 }), trackNumber: nullable({ type: 'integer', minimum: 1, maximum: 100000 }), available: B, genreId: nullable(S), contextTags: list(S), features: object({ tempo: featureSchema('tempo'), energy: featureSchema('energy'), key: featureSchema('key') }) });
defs.rng = object({ algorithm: { const: 'fnv1a-utf16-mulberry32-fy-v1' }, state: { type: 'integer', minimum: 0, maximum: 4294967295 }, draws: I, seedHash: { type: 'integer', minimum: 0, maximum: 4294967295 } });
defs.options = object({ preset: { enum: policy.PRESETS }, shape: { enum: ['auto', 'steady', 'rise', 'wave', 'wind-down'] }, preserveAlbumRuns: B, contextTag: nullable(S) });
defs.albumLock = object({ albumId: nullable(S), entryIds: list(ID), ordering: { enum: ['disc-track', 'source-order-missing-numbers'] } });
defs.manual = object({ entryId: ID, kind: { enum: ['priority', 'move'] }, intentId: ID, position: I });
defs.scoreParts = object(Object.fromEntries(['taste', 'novelty', 'freshness', 'tempo', 'energy', 'key', 'context', 'preset'].map((k) => [k, { type: 'integer', minimum: -12, maximum: 12 }])));
defs.decision = object({ version: { const: 2 }, policyVersion: { const: policy.POLICY_VERSION }, configVersion: { const: 1 }, decisionId: S, scopeId: ID, cycleId: S, mode: { enum: policy.MODES }, preset: { enum: policy.PRESETS }, kind: { enum: ['automatic', 'previous', 'forward', 'manual', 'play-now', 'repeat-one', 'album-continuation'] }, entryId: ID, trackId: ID, originEntryId: nullable(ID), originOccurrenceId: nullable(S), explicitException: B, intentionalDuplicate: B, strategy: { enum: [...policy.MODES, 'weighted', 'exploration'] }, exploration: B, candidateCount: I, relaxations: list({ enum: ['album', 'artist', 'recording'] }), signalCoverage: list({ enum: ['tempo', 'energy', 'key', 'context', 'genre'] }), scoreParts: nullable(ref('scoreParts')), weight: nullable(I), albumOrdering: nullable(S) });
defs.history = object({ occurrenceId: S, entryId: ID, trackId: ID, artistId: nullable(S), albumId: nullable(S), recordingId: nullable(ID), decisionId: nullable(S), kind: S, tombstone: B, receipt: nullable(ref('decision')) });
defs.pending = object({ version: { const: 2 }, attemptId: ID, advanceId: ID, decisionId: S, revision: I, membershipRevision: I, authorityId: ID, authorityEpoch: I, entryId: ID, trackId: ID, kind: S, historyIndex: nullable(I), newCycle: B, rngAfter: ref('rng'), futureAfter: list(ID), albumLockAfter: nullable(ref('albumLock')), manualIndex: nullable({ type: 'integer', minimum: -1 }), receipt: ref('decision') });
defs.undo = object({ entries: list(ref('entry')), remaining: list(ID), manual: list(ref('manual')), exclusions: list(ID), generatedFuture: list(ID), albumLock: nullable(ref('albumLock')), membershipRevision: I });
defs.state = object({ schemaVersion: { const: 2 }, policyVersion: { const: policy.POLICY_VERSION }, configVersion: { const: 1 }, sessionId: ID, scopeId: ID, authorityId: ID, authorityEpoch: I, revision: I, membershipRevision: I, mode: { enum: policy.MODES }, repeat: { enum: ['off', 'all', 'one'] }, options: ref('options'), cycle: object({ generation: I, cycleId: S }), rng: ref('rng'), entries: list(ref('entry')), remaining: list(ID), history: list(ref('history')), cursor: { type: 'integer', minimum: -1 }, occurrenceSequence: I, generatedFuture: list(ID), manual: list(ref('manual')), exclusions: list(ID), albumLock: nullable(ref('albumLock')), pending: nullable(ref('pending')), lastConfirmedPositionMs: I, eventSequences: list(object({ producerId: ID, sequence: { type: 'integer', minimum: 1 }, eventId: ID })), quarantine: object({ advanceId: nullable(ID), entryIds: list(ID) }), undo: nullable(ref('undo')), paused: B, diagnostics: list(S), imported: B });
defs.event = { type: 'object', required: ['type'], properties: { type: { enum: ['stage', 'activate-success', 'activate-failure', 'mutation', 'mode-change', 'repeat-change', 'explicit-new-cycle', 'reshuffle-remaining', 'membership-change', 'session-change', 'authority-change', 'position-checkpoint'] }, eventId: ID, producerId: ID, sequence: { type: 'integer', minimum: 1 }, attemptId: ID, advanceId: ID, decisionId: S, authorityId: ID, authorityEpoch: I, direction: { enum: ['next', 'previous'] }, entryId: ID, naturalEnd: B, repeat: { enum: ['off', 'one', 'all'] }, mode: S, options: ref('options'), entries: list(ref('entry')), sessionId: ID, membershipRevision: I, positionMs: I, action: { type: 'object', required: ['type'], properties: { type: { enum: ['priority', 'move', 'remove', 'insert', 'clear', 'exclude', 'include', 'undo'] }, entryId: ID, intentId: ID, index: I, entry: { type: 'object' } }, additionalProperties: false } }, additionalProperties: false };
defs.event.properties.type.enum.push('restore');
defs.decision.properties.strategy.enum.push('manual', 'play-now', 'previous', 'forward', 'repeat-one', 'album-continuation');
defs.decision.properties.signalCoverage.items.enum.push('taste', 'novelty', 'freshness', 'exposure');
const Counter = { type: 'integer', minimum: 0, maximum: learning.CONFIG.maxCounter };
const OccurrenceID = { type: 'string', minLength: 1, maxLength: 16384 };
defs.learningTrack = object({ trackId: ID, offered: Counter, activated: Counter, heardOccurrences: Counter, naturalEnds: Counter, deliberateSkips: Counter, replays: Counter, positiveUnits: { type: 'integer', minimum: 0, maximum: 120 }, negativeUnits: { type: 'integer', minimum: 0, maximum: 120 }, evidenceAtMs: nullable(I), lastHeardAtMs: nullable(I), explicitPreference: { enum: [-1, 0, 1] }, explicitPreferenceAtMs: nullable(I), opportunityDebt: { type: 'integer', minimum: 0, maximum: 12 }, heardWallMs: Counter });
defs.learningOccurrence = object({ occurrenceId: OccurrenceID, trackId: ID, activatedAtMs: I, durationMs: nullable({ type: 'integer', minimum: 1, maximum: 86400000 }), replay: B, wallMs: Counter, coverageRanges: list({ type: 'array', items: I, minItems: 2, maxItems: 2 }), clocks: list(object({ clockId: ID, throughMs: I })), heardCredited: B, ended: B });
defs.learningJournal = { type: 'object', required: ['eventId', 'type', 'timestampMs', 'applied'], properties: { eventId: ID, type: S, timestampMs: I, applied: B, trackId: ID, occurrenceId: OccurrenceID, outcome: S, suppressed: { enum: ['disabled', 'nonpersonal', 'infrastructure'] } }, additionalProperties: false };
defs.ledger = object({ schemaVersion: { const: 2 }, policyVersion: { const: policy.POLICY_VERSION }, enabled: B, learningEpoch: Counter, revision: Counter, clockFloorMs: I, resetAtMs: nullable(I), tracks: list(ref('learningTrack')), occurrences: list(ref('learningOccurrence')), producers: list(object({ producerId: ID, through: I, pending: list(I) })), seenEventIds: list(ID), journal: list(ref('learningJournal')), diagnostics: object({ clockRollbacks: Counter, futureClamps: Counter, coverageUnderflows: Counter, prunedOccurrences: Counter }) });
defs.learningEvent = { type: 'object', required: ['schemaVersion', 'eventId', 'type'], properties: { schemaVersion: { const: 2 }, eventId: ID, producerId: ID, sequence: { type: 'integer', minimum: 1 }, timestampMs: I, learningEpoch: Counter, type: { enum: ['offered', 'activated', 'interval', 'outcome', 'preference', 'learning-enabled', 'learning-reset', 'history-delete', 'track-delete'] }, trackId: ID, occurrenceId: OccurrenceID, personal: B, source: S, reason: S, durationMs: nullable({ type: 'integer', minimum: 1, maximum: 86400000 }), replay: B, monotonicClockId: ID, monotonicStartMs: I, monotonicEndMs: I, mediaStartMs: I, mediaEndMs: I, speedPermille: { type: 'integer', minimum: 250, maximum: 4000 }, playing: B, discontinuity: B, outcome: { enum: ['natural-end', 'deliberate-skip', 'replay', 'interrupted'] }, userInitiated: B, value: { enum: [-1, 0, 1] }, enabled: B }, additionalProperties: true };
const conditionalRequirements = (mapping) => Object.entries(mapping).map(([type, required]) => ({ if: { properties: { type: { const: type } } }, then: { required } }));
defs.event.properties.occurrenceId = OccurrenceID;
defs.event.allOf = conditionalRequirements({ stage: ['attemptId'], 'activate-success': ['attemptId', 'decisionId', 'authorityId', 'authorityEpoch'], 'activate-failure': ['attemptId', 'decisionId', 'authorityId', 'authorityEpoch'], mutation: ['action'], 'mode-change': ['mode'], 'repeat-change': ['repeat'], 'membership-change': ['entries'], 'session-change': ['sessionId'], 'authority-change': ['authorityId', 'authorityEpoch'], 'position-checkpoint': ['positionMs', 'occurrenceId'] });
defs.learningEvent.allOf = conditionalRequirements({ offered: ['trackId'], activated: ['trackId', 'occurrenceId'], interval: ['trackId', 'occurrenceId', 'monotonicClockId', 'monotonicStartMs', 'monotonicEndMs', 'mediaStartMs', 'mediaEndMs'], outcome: ['trackId', 'occurrenceId', 'outcome'], preference: ['trackId', 'value'], 'learning-enabled': ['enabled'], 'track-delete': ['trackId'] });
const schemas = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'pixelody:shuffle-universal-v2.1', $defs: defs, $ref: '#/$defs/state' };

function trace(name, input, actions) {
  let state = policy.createSession(input);
  const initialState = state;
  const steps = [];
  for (const action of actions) {
    const context = action.context || { nowMs: 100000 };
    let event = action.event;
    if (action.commitPending) event = { type: 'activate-success', attemptId: state.pending.attemptId, decisionId: state.pending.decisionId, authorityId: state.pending.authorityId, authorityEpoch: state.pending.authorityEpoch };
    if (action.abortPending) event = { type: 'activate-failure', attemptId: state.pending.attemptId, decisionId: state.pending.decisionId, authorityId: state.pending.authorityId, authorityEpoch: state.pending.authorityEpoch };
    if (action.restore) state = policy.restore(state).state;
    else state = policy.reduce(state, event, context);
    policy.validateState(state); validate({ ...schemas, $ref: '#/$defs/state' }, state); if (event) validate({ ...schemas, $ref: '#/$defs/event' }, event);
    steps.push({ event: event || { type: 'restore' }, context, expectedState: state, expectedDecision: state.pending?.receipt || null, canonicalStateSha256: hash(policy.canonicalJson(state)) });
  }
  return { name, input, initialState, steps };
}
const staged = (attemptId, extra = {}) => ({ event: { type: 'stage', attemptId, ...extra } });
const committed = () => ({ commitPending: true });
const cycleActions = (count) => Array.from({ length: count }, (_, i) => [staged('cycle-' + i), committed()]).flat();
const traces = [
  trace('random-full-cycle-repeat-off', base({ mode: 'random' }), [...cycleActions(4), staged('stop')]),
  trace('balanced-missing-and-unicode', base({ entries: [entry('a|b', { artist: '東京' }), entry('a', { artist: 'Björk' }), entry('b|c', { artist: 'e\u0301' }), entry('__proto__') ] }), cycleActions(4)),
  trace('stage-failure-retry-crash', base({ mode: 'flow' }), [staged('first', { advanceId: 'chain' }), { abortPending: true }, staged('second', { advanceId: 'chain' }), { restore: true }, staged('third'), committed()]),
  trace('duplicate-entry-replay-history', base({ mode: 'off', entries: [entry('a1', { trackId: 'same' }), entry('a2', { trackId: 'same' }), entry('b')] }), [staged('a1', { entryId: 'a1' }), committed(), staged('b', { entryId: 'b' }), committed(), staged('a-replay', { entryId: 'a1' }), committed(), staged('back', { direction: 'previous' }), committed(), staged('forward'), committed()]),
  trace('repeat-one-bypass-and-boundary', base({ repeat: 'one', entries: [entry('a'), entry('b')] }), [staged('start'), committed(), staged('one', { naturalEnd: true }), committed(), staged('manual-next'), committed(), { event: { type: 'repeat-change', repeat: 'all' } }, staged('new-cycle', { naturalEnd: true }), committed()]),
  trace('mode-priority-position-exclusion-undo', base({ mode: 'random' }), [staged('start'), committed(), { event: { type: 'mode-change', mode: 'flow' } }, { event: { type: 'mutation', action: { type: 'priority', entryId: 'd', intentId: 'intent' } } }, staged('priority'), committed(), { event: { type: 'mutation', action: { type: 'exclude', entryId: 'b' } } }, { event: { type: 'mutation', action: { type: 'undo' } } }, { event: { type: 'mode-change', mode: 'off' } }]),
  trace('album-compilation-multidisc-manual-middle', base({ mode: 'album', entries: Array.from({ length: 16 }, (_, i) => entry('album-' + i, { artist: 'Performer ' + i, albumArtist: 'Various', album: 'Mix', discNumber: i < 8 ? 1 : 2, trackNumber: i % 8 + 1 })) }), [staged('start'), committed(), { restore: true }, staged('middle', { entryId: 'album-8' }), committed(), staged('continuation'), committed(), { event: { type: 'mutation', action: { type: 'remove', entryId: 'album-10' } } }, staged('after-removal'), committed()]),
  trace('authority-epoch-stale-pending', base(), [staged('old'), { event: { type: 'authority-change', authorityId: 'new-device', authorityEpoch: 1 } }, staged('new'), committed()]),
  trace('known-flow-feature-evidence', base({ mode: 'flow', entries: [entry('a', { features: { tempo: { value: 120, provenance: 'tagged' }, energy: { value: 0, provenance: 'measured' }, key: { value: 'C', provenance: 'tagged' } } }), entry('b', { features: { tempo: { value: 122, provenance: 'tagged' }, energy: { value: 0.1, provenance: 'manual' }, key: { value: 'G', provenance: 'tagged' } } }), entry('c', { features: { key: { value: 'D♭ minor', provenance: 'tagged' } } })] }), [staged('start', { entryId: 'a' }), committed(), staged('features'), committed(), staged('sparse'), committed()]),
];
const machine = { contractVersion: 2, semanticRevision: 2, policyVersion: policy.POLICY_VERSION, configVersion: 1, status: 'executable-reference', entrypoints: { node: 'src/shuffle/index.js', scheduler: 'src/shuffle/universal.js', learning: 'src/shuffle/learning.js', scopes: 'src/shuffle/scopes.js' }, globals: ['PixelodyUniversalShuffle', 'PixelodyShuffleLearningV2', 'PixelodyShuffleScopesV2'], api: { scheduler: ['createSession(input)', 'stage(state,request,context)', 'commit(state,activation)', 'abort(state,activation)', 'reduce(state,event,context)', 'mutate(state,action)', 'reconcile(state,entries,options)', 'setMode(state,mode,options)', 'newCycle(state)', 'restore(snapshot)', 'project(state,{horizon,context})', 'publicSnapshot(state,identityMappers,authorityContext)', 'migrateLegacy(legacy,input)', 'validateState(state)', 'canonicalJson(value)'], learning: Object.keys(learning).filter((k) => typeof learning[k] === 'function'), scopes: ['createBank()', 'save(bank,session,{nowMs})', 'restore(bank,scopeId)', 'evict(bank,scopeId,{nowMs})'] }, modes: policy.MODES, presets: policy.PRESETS, constants: policy.CONFIG, learningConstants: learning.CONFIG, identity: { validation: 'Opaque nonempty well-formed UTF-16 string, <=1024 code units. No trimming or case folding of IDs. Array equality is structural, never delimiter joins.', metadata: 'NFC + ASCII-only lowercase + ECMAScript whitespace collapse. Non-Latin identities remain meaningful. Unknown=null. Explicit album/recording IDs win. ISRC requires two letters, three alphanumeric, seven digits.', ordering: 'Unsigned UTF-16 code-unit ordinal; source order for Random FY and Off; ordinal entryId for Balanced/Flow; ordinal JSON tuple album keys.', entryEntitlement: 'one source entryId per cycle; duplicate trackIds remain separate intentional entitlements', occurrence: 'JSON tuple [sessionId,monotonic occurrenceSequence]; navigation reuses history; genuine replay increments; retry never increments', decision: 'JSON tuple [sessionId,revision,membershipRevision,authorityEpoch,entryId,kind]; independent of attemptId', generatedIds: 'Generated JSON tuple IDs may exceed input ID bound when embedded private input IDs are long; never publish them raw' }, rng: { algorithm: 'fnv1a-utf16-mulberry32-fy-v1', hashInitial: 2166136261, fnvMultiplier: 16777619, increment: 1831565813, zeroHashFallback: 1831565813, boundedDraw: 'floor(uint32 * positiveBound / 4294967296)', boundMaximum: 128000000, shuffle: 'descending Fisher-Yates n-1..1, preserving source input order', randomDraws: 'n-1 on new remaining permutation; zero on retained permutation/Off/priority/navigation/album continuation', balancedFlowDraws: 'one bound1000 exploration draw then one weighted or least-exposure tie draw, even singleton', albumDraws: 'one integer album-unit draw when lock absent, including singleton; zero for continuation', limitations: 'Finite 32-bit mapping has tiny bound bias; finite seeded PRNG is pseudorandom, not cryptographic or an exact mathematical uniform sampler' }, selection: { spacing: 'Artist last3, album last2, verified recording last1 at actual cursor. Unknown identities unconstrained. Relax album then artist then recording only until feasible.', weight: 'clamp(64 + taste[-12..12] + novelty[0..12] + freshness[-12..0] + flow components,16,128)', freshness: '-floor(12*max(0,86400000-max(0,nowMs-lastHeardAtMs))/86400000); invalid date unavailable', tempo: 'max(-8,8-floor(abs(currentMilliBpm-candidateMilliBpm)/5000))', energy: 'max(-8,8-floor(abs(targetPermille-candidatePermille)/50))', key: '4 same key/mode; 2 same-mode fifth/fourth or relative major/minor; -2 other known pair; zero unavailable', context: '4 for explicit contextTag exact normalized match', shapes: 'step=history.length%10; rise+30*step, wind-down-30*step, wave+[0,60,120,180,120,60,0,-60,-120,-60]; clamp0..1000; auto/steady=current known energy', presets: 'discovery/deep-library floor(novelty*8/12), comfort -floor(novelty*5/12), energy floor(candidateEnergy*8/1000), genre-weave +/-4 known genre difference/equality', exploration: 'draw<100/1000, choose uniformly among least exposure feasible entries; all ties included, no low-ID cutoff', albumOrdering: 'All siblings with both disc and track numbers: disc,track,sourceIndex,entryId; otherwise whole album source order. Explicit manual middle locks only later still-owed siblings.', format: 'no audio quality/codec bias' }, lifecycle: { activation: 'Stage reserves only. Success requires attemptId,decisionId,authorityId,authorityEpoch and matching state+membership revisions. Commit applies proposed RNG exactly once and consumes only selected entitlement.', failure: 'Abort leaves entitlement/RNG untouched; quarantine bound64 per advanceId. New advanceId resets quarantine; unavailable candidates never become dislike.', repeat: 'Off stops at exhaustion. All increments generation once on successful next-cycle commit. Natural-end One appends replay occurrence; manual Next bypasses One.', history: 'Previous/Forward walk actual occurrence history; absent entries retain tombstones, navigation skips unavailable tombstones without deleting them. Explicit Play Now/Next forks only upon activation success.', manual: 'Priority position0; move absolute future position; positions decrement only on successful Next progression, reserve their entries from automatic choice; out-of-range past exhaustion appends. Explicit manual bypasses session exclusion, not availability.', off: 'Mode-change freezes existing bounded authority projection + retained generated permutation + remaining order; starting Off source uses source order.', restore: 'Validate version and structure; clear unconfirmed pending, undo and quarantine; preserve entitlement/RNG/current/history/position; paused=true. Preserve unknown/corrupt original snapshot for recovery.', scopes: { max: scopes.MAX_SCOPES, evictionDiagnostics: scopes.MAX_EVICTION_DIAGNOSTICS, policy: 'No automatic unfinished eviction. Capacity requires explicit eviction; diagnostic states unfinished entitlement count, never claims completion.' }, eventIdempotency: 'Versioned command envelope eventId+producerId+contiguous sequence; 64 producer watermarks; duplicates ignored and gaps rejected. Direct convenience methods rely on adapter serialization and reservation guards.' }, metadata: { features: 'Output fixed integer tempo milli-bpm20k..400k; energy permille0..1000; key pitchClass0..11 + major/minor. Input feature objects require known manual/tagged/measured/derived provenance; primitives unknown. No synthetic evidence.', quantization: 'floor(nonnegative numeric value*1000+0.5), unless normalized milli-bpm/permille unit already supplied', confidence: '0..1000 integer; default1000 tagged/manual,500 measured/derived; null unknown; provenance/version retained', albumIdentity: 'Explicit albumId or JSON tuple [normalized albumArtist/artist or null,normalized album]; unknown album null; unknown album entry treated singleton' }, privacy: { public: 'Required explicit safe identity mappers for authorityId,trackId,entryId,occurrenceId,decisionId; output only ASCII alphanumeric/_/colon/hyphen<=128. Required same real authority scoring context. Never export feature evidence, private scope/session IDs, journals or raw IDs.', personal: 'Private local learning export uses separate explicit flow. Public snapshots are projections only. Root connected handoff gate remains open.' }, canonicalJson: 'Recursively sort object keys by ordinal UTF16; retain array order; JSON UTF8 without whitespace; SHA256 recorded for each trace step', schemas: 'schemas.json#/$defs/{state,entry,decision,event,pending,rng}', fixtureNames: traces.map((t) => t.name), limitations: ['Platform adapter adoption, JS/Kotlin parity, normal builds and connected handoff are external gates.', 'Filesystem atomic write/last-valid recovery is adapter-owned.', 'No claim of human preference, audible playback, production signing or physical acceptance.'] };
machine.api.scheduler.push('createProjection(state,{horizon})', 'advanceProjection(batch,context={nowMs,signals,cancelled})');
machine.api.scheduler[machine.api.scheduler.indexOf('setMode(state,mode,options)')] = 'setMode(state,mode,options,authorityContext)';
machine.identity.generatedIds = 'Generated JSON tuple occurrenceId/decisionId/cycleId may exceed input ID bound; occurrenceId max16384 UTF16 code units in learning events and imports. Never publish them raw.';
machine.identity.metadataWhitespaceCodePoints = [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279];
machine.rng.boundedDraw = 'Exact floor(uint32*bound/4294967296), with split16-bit products in JS and signed64-bit product in Kotlin; all intermediates exact. Random/FY bounds<=1,000,000 match v1 float mapping.';
machine.lifecycle.planning = 'createProjection/advanceProjection emits at most one selection per batch; adapter yields between batches and cancels before next batch. project is synchronous convenience for bounded offline/worker use; avoid whole-horizon project on renderer foreground.';
machine.lifecycle.off = 'Mode-change uses supplied authority context to freeze existing bounded authority projection + retained generated permutation + remaining order. Adapters pass same real context used for queue projection; new Off source uses source order.';
machine.selection.receipts = 'Only selected weighted score parts and used metadata/learning coverage are reported. Exploration omits unused score parts and reports exposure only; explicit/navigation use their actual strategy kind. Intentional duplicate tracks are labeled.';
machine.lifecycle.position = 'position-checkpoint requires current actual occurrenceId and nonnegative integer positionMs; stale occurrence checkpoint is ignored. Position does not teach listening.';
machine.schemas = 'schemas.json#/$defs/{state,entry,decision,event,pending,rng,ledger,learningEvent,learningTrack,learningOccurrence}';
machine.learningContract = 'learning-contract.json';
machine.learningTraces = 'learning-traces.json';
machine.catalogFixtures = 'catalog-fixtures.json';
test('shipped schemas and byte-comparable golden traces', () => {
  fs.mkdirSync(directory, { recursive: true });
  const learningContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shuffle-learning-contract-input.json'), 'utf8'));
  const learningTraces = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shuffle-learning-vectors-input.json'), 'utf8'));
  assert.deepEqual(learningContract.config, learning.CONFIG);
  function learningVector(name, actions) {
    const initial = learning.createLedger({ nowMs: 100000 }), events = [], contexts = [], states = [], normalizedEvents = [];
    let state = initial;
    for (let i = 0; i < actions.length; i += 1) {
      const context = actions[i].context || { nowMs: 100000 };
      const event = { schemaVersion: 2, eventId: name + '-' + i, producerId: name, sequence: i + 1, ...actions[i].event };
      normalizedEvents.push(learning.normalizeEvent(event, { nowMs: Math.max(context.nowMs, state.clockFloorMs) }));
      state = learning.reduce(state, event, context);
      events.push(event); contexts.push(context); states.push(state);
      assert.equal(learning.importLedger(state).ok, true);
    }
    return { name, initial, nowMs: 100000, contexts, events, normalizedEvents, states, signals: learning.trackSignals(state, 'track', { nowMs: state.clockFloorMs }) };
  }
  const learned = (type, fields = {}, context) => ({ event: { type, trackId: 'track', ...fields }, context });
  learningTraces.vectors.push(
    learningVector('seek-infrastructure-nonpersonal', [
      learned('activated', { occurrenceId: 'heard-1', durationMs: 180000 }),
      learned('interval', { occurrenceId: 'heard-1', monotonicClockId: 'boot', monotonicStartMs: 0, monotonicEndMs: 3000, mediaStartMs: 177000, mediaEndMs: 180000, playing: true }),
      learned('outcome', { occurrenceId: 'heard-1', outcome: 'natural-end' }),
      learned('activated', { occurrenceId: 'heard-2', durationMs: 180000 }),
      learned('interval', { occurrenceId: 'heard-2', monotonicClockId: 'boot', monotonicStartMs: 3000, monotonicEndMs: 13000, mediaStartMs: 0, mediaEndMs: 10000, playing: true }),
      learned('outcome', { occurrenceId: 'heard-2', outcome: 'deliberate-skip', userInitiated: true, reason: 'route-failure' }),
      learned('preference', { value: -1, source: 'remote' }),
    ]),
    learningVector('decay-rollback-preference-reversal', [
      learned('activated', { occurrenceId: 'complete', durationMs: 100000 }),
      learned('interval', { occurrenceId: 'complete', monotonicClockId: 'boot', monotonicStartMs: 0, monotonicEndMs: 50000, mediaStartMs: 0, mediaEndMs: 50000, playing: true }),
      learned('interval', { occurrenceId: 'complete', monotonicClockId: 'boot', monotonicStartMs: 50000, monotonicEndMs: 100000, mediaStartMs: 50000, mediaEndMs: 100000, playing: true }),
      learned('outcome', { occurrenceId: 'complete', outcome: 'natural-end' }),
      learned('preference', { value: 1 }),
      learned('offered', {}, { nowMs: 100000 + learning.CONFIG.decayPeriodMs * 2 }),
      learned('preference', { value: -1 }, { nowMs: 100000 + learning.CONFIG.decayPeriodMs * 2 }),
      learned('offered', {}, { nowMs: 50000 }),
      learned('offered', { timestampMs: 100000 + learning.CONFIG.decayPeriodMs * 2 + 1000 }, { nowMs: 100000 + learning.CONFIG.decayPeriodMs * 2 }),
    ]),
    learningVector('out-of-order-durable-event-replay', [
      learned('offered', { eventId: 'seq-1', sequence: 1 }),
      learned('preference', { eventId: 'seq-3', sequence: 3, value: 1 }),
      learned('offered', { eventId: 'seq-2', sequence: 2 }),
      learned('preference', { eventId: 'seq-3', sequence: 3, value: -1 }),
    ]),
    learningVector('disable-reset-history-track-delete', [
      learned('offered'), learned('preference', { value: 1 }),
      learned('learning-enabled', { enabled: false }), learned('activated', { occurrenceId: 'disabled' }),
      learned('learning-enabled', { enabled: true }), learned('history-delete'),
      learned('learning-reset'), learned('offered', { learningEpoch: 0 }),
      learned('offered', { learningEpoch: 1 }), learned('track-delete', { learningEpoch: 1 }),
    ])
  );
  for (const vector of learningTraces.vectors) {
    validate({ ...schemas, $ref: '#/$defs/ledger' }, vector.initial);
    for (const event of vector.events) validate({ ...schemas, $ref: '#/$defs/learningEvent' }, event);
    for (const state of vector.states) validate({ ...schemas, $ref: '#/$defs/ledger' }, state);
  }
  const catalogInputs = [
    ['empty', base({ entries: [] })],
    ['singleton', base({ entries: [entry('singleton')] })],
    ['1001-skewed-sparse-unicode', base({ entries: Array.from({ length: 1001 }, (_, i) => entry('曲|' + i, { artist: i < 900 ? 'Heavy Artist' : i % 2 ? '東京' : undefined, album: i % 9 ? 'Album ' + Math.floor(i / 12) : undefined, albumArtist: i % 9 ? 'Compilation Artist' : undefined, discNumber: i % 7 ? Math.floor(i / 24) + 1 : undefined, trackNumber: i % 7 ? i % 24 + 1 : undefined, features: i % 3 ? {} : { tempo: { value: 80 + i % 100, provenance: 'tagged' }, energy: { value: (i % 11) / 10, provenance: 'measured', version: 1 }, key: { value: i % 2 ? 'D♭ minor' : '8B', provenance: 'tagged' } } })) })],
    ['alternate-recordings-and-intentional-duplicates', base({ entries: [entry('studio-1', { trackId: 'studio', recordingId: 'verified-studio', artist: 'Artist', album: 'Original' }), entry('studio-2', { trackId: 'studio', recordingId: 'verified-studio', artist: 'Artist', album: 'Original' }), entry('live', { recordingId: 'verified-live', artist: 'Artist', album: 'Live' }), entry('unknown-version', { artist: 'Artist', title: 'Same title' })] })],
    ['long-multidisc-compilation', base({ mode: 'album', entries: Array.from({ length: 70 }, (_, i) => entry('multi-' + i, { artist: 'Performer ' + i, albumArtist: 'Various', album: 'Collection', discNumber: Math.floor(i / 20) + 1, trackNumber: i % 20 + 1 })).reverse() })],
    ['album-missing-numbers', base({ mode: 'album', entries: [entry('z', { albumId: 'known-compilation', artist: '東京', discNumber: 1, trackNumber: 2 }), entry('a', { albumId: 'known-compilation', artist: 'Björk' }), entry('m', { albumId: 'known-compilation', discNumber: 1, trackNumber: 1 })] })],
    ['lost-source-grant', base({ entries: [entry('recoverable', { available: false }), entry('available')] })],
    ['null-zero-unknown-feature-evidence', base({ mode: 'flow', entries: [entry('null', { features: { energy: { value: null, provenance: 'measured' } } }), entry('zero', { features: { energy: { value: 0, provenance: 'measured' } } }), entry('unsupported', { features: { key: { value: 'invalid', provenance: 'tagged' }, tempo: { value: 0, provenance: 'tagged' } } }), entry('unknown', { features: { energy: 0.5, key: 'C', tempo: 120 } })] })],
  ];
  const catalogs = catalogInputs.map(([name, input]) => {
    const state = policy.createSession(input), context = { nowMs: 100000 }, staged = policy.stage(state, { attemptId: 'catalog-first' }, context);
    for (const normalized of state.entries) validate({ ...schemas, $ref: '#/$defs/entry' }, normalized);
    return { name, input, context, normalizedEntriesSha256: hash(policy.canonicalJson(state.entries)), firstDecision: staged.pending?.receipt || null, firstProjection: policy.project(state, { context }), remainingCountAfterCommit: staged.pending ? policy.commit(staged, staged.pending).remaining.length : state.remaining.length };
  });
  const recovery = [{ name: 'old-schema-preserved', input: { schemaVersion: 1, prior: 'keep' }, status: 'unsupported' }, { name: 'future-schema-preserved', input: { ...policy.createSession(base()), schemaVersion: 99, futureProperty: 'keep' }, status: 'unsupported' }, { name: 'corrupt-entitlement-preserved', input: { ...policy.createSession(base()), remaining: ['not-present'] }, status: 'corrupt' }];
  for (const item of recovery) { const result = policy.restore(item.input); assert.equal(result.status, item.status); assert.deepEqual(result.preserved, item.input); }
  const files = { 'machine-contract.json': machine, 'schemas.json': schemas, 'traces.json': { version: 2, policyVersion: policy.POLICY_VERSION, traces }, 'learning-contract.json': learningContract, 'learning-traces.json': learningTraces, 'catalog-fixtures.json': { version: 2, catalogs, recovery } };
  for (const [name, value] of Object.entries(files)) {
    const contents = json(value), target = path.join(directory, name);
    if (write) fs.writeFileSync(target, contents);
    else assert.equal(fs.readFileSync(target, 'utf8'), contents, 'Fixture drift: ' + name + '; change requires reviewed policy version/fixture regeneration');
  }
  const manifest = { version: 2, policyVersion: policy.POLICY_VERSION, files: Object.entries(files).map(([name, value]) => ({ name, sha256: hash(json(value)), bytes: Buffer.byteLength(json(value)) })) };
  if (write) fs.writeFileSync(path.join(directory, 'manifest.json'), json(manifest));
  else assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')), manifest);
});
fs.mkdirSync(receiptDirectory, { recursive: true });
fs.writeFileSync(path.join(receiptDirectory, 'reference-tests.json'), json({ policyVersion: policy.POLICY_VERSION, checks, passed: true, fixtureManifestSha256: hash(fs.readFileSync(path.join(directory, 'manifest.json'))), sourceSha256: hash(fs.readFileSync(path.resolve(__dirname, '../src/shuffle/universal.js'))) }));
console.log('Universal shuffle reference checks passed: ' + checks);
