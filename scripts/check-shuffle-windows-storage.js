'use strict';

// Exercise the production durable store, without launching Electron or opening
// a real profile. Session/ledger objects stay opaque here: the shared core and
// renderer controller own their schema, migrations and paused restoration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PixelodyStateStore, STORE_ID, CURRENT_SCHEMA_VERSION, OBJECT_VALUE_KEYS } = require('../src/state-store');

const SESSION_KEY = 'pixelody.shuffleSession';
const LEDGER_KEY = 'pixelody.shuffleLedger';
const roots = [];
const scenarios = [];
const completed = [];
const fixedClock = () => 1791748800000;

function root(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `pixelody-shuffle-storage-${label}-`));
  roots.push(directory);
  return directory;
}

function store(directory, options = {}) {
  return new PixelodyStateStore({ directory, backupIntervalMs: 0, now: fixedClock, ...options });
}

// Sentinels are intentionally not a second core schema. They prove that deep
// JSON, duplicate occurrence-shaped records, Unicode and unknown fields pass
// through the actual persistence API intact without fabricated normalization.
function checkpoint(marker = 'one') {
  return {
    [SESSION_KEY]: {
      storageSentinel: marker,
      opaqueTraversal: [{ entryId: 'a|b', trackId: 'a' }, { entryId: 'a\u0301', trackId: 'a' }],
      opaqueState: { untouchedTail: ['日本語', 'Beyoncé', 'Beyonce\u0301'], pending: { attemptId: 'try-1', consumed: false }, position: 42.5 },
      futureExtension: { nullValue: null, zeroValue: 0, enabled: false },
    },
    [LEDGER_KEY]: { storageSentinel: marker, opaqueEvents: [{ eventId: 'e1', value: 0 }], opaqueSummaries: { heard: 0, coverage: null } },
  };
}

function seed(directory) {
  const instance = store(directory);
  assert.equal(instance.commitSync({
    'aurelia.library': [{ id: 'a', path: 'C:\\Fixture music\\a.wav' }],
    'aurelia.playlists': [{ id: 'all', trackIds: ['a'] }],
    'aurelia.tunings': { a: { bass: 1 } },
    'pixelody.favorites': ['a'],
    ...checkpoint(),
  }).ok, true);
  return instance;
}

function reopen(directory) { return store(directory).loadSync(); }
function scenario(name, run) { scenarios.push({ name, run }); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

scenario('session and ledger are registered object values', () => {
  assert.equal(OBJECT_VALUE_KEYS.has(SESSION_KEY), true);
  assert.equal(OBJECT_VALUE_KEYS.has(LEDGER_KEY), true);
  const instance = seed(root('shape'));
  for (const key of [SESSION_KEY, LEDGER_KEY]) {
    for (const invalid of [false, 'overwrite', 1, []]) {
      const revision = instance.currentEnvelope().revision;
      assert.equal(instance.commitSync({ [key]: invalid }).status, 'validation-error');
      assert.equal(instance.currentEnvelope().revision, revision);
      assert.deepEqual(instance.currentEnvelope().values[key], checkpoint()[key]);
    }
  }
});

scenario('full opaque checkpoint survives cold reopen and partial settings commits', async () => {
  const directory = root('partial');
  const instance = seed(directory);
  await instance.commit({ 'pixelody.volume': 0.25 }, { includeState: false });
  await instance.commit({ 'pixelody.repeat': 'all' }, { includeState: false });
  const values = reopen(directory).state.values;
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(values[key], checkpoint()[key]);
  assert.deepEqual(values['aurelia.tunings'], { a: { bass: 1 } });
  assert.deepEqual(values['pixelody.favorites'], ['a']);
});

scenario('commit and load return defensive session and ledger copies', () => {
  const directory = root('defensive');
  const instance = store(directory);
  const supplied = checkpoint();
  const committed = instance.commitSync(supplied);
  supplied[SESSION_KEY].opaqueState.untouchedTail.length = 0;
  supplied[LEDGER_KEY].opaqueEvents.push({ eventId: 'never-committed' });
  committed.state.values[SESSION_KEY].opaqueState.position = 999;
  const loaded = instance.loadSync();
  loaded.state.values[LEDGER_KEY].opaqueEvents.length = 0;
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(reopen(directory).state.values[key], checkpoint()[key]);
});

scenario('older populated backup omission preserves universal values', async () => {
  const directory = root('legacy-restore');
  const instance = seed(directory);
  const imported = await instance.importBackupV1({ version: 1, tracks: [], playlists: [] });
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.state.values['aurelia.library'], []);
  assert.deepEqual(imported.state.values['pixelody.favorites'], []);
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(reopen(directory).state.values[key], checkpoint()[key]);
});

scenario('unknown future nested schema stays opaque across unrelated saves and old restores', async () => {
  const directory = root('nested-future');
  const instance = seed(directory);
  const future = checkpoint('unknown-nested-version');
  for (const key of [SESSION_KEY, LEDGER_KEY]) future[key].schemaVersion = 999;
  assert.equal(instance.commitSync(future).ok, true);
  await instance.commit({ 'pixelody.volume': 0.5 });
  await instance.importBackupV1({ version: 1, tracks: [], playlists: [] });
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(reopen(directory).state.values[key], future[key]);
});

scenario('legacy initialization retries cannot overwrite a committed checkpoint', async () => {
  const directory = root('legacy-retry');
  const instance = store(directory);
  assert.equal((await instance.migrateLegacy(checkpoint('first-migration'))).ok, true);
  assert.equal((await instance.migrateLegacy(checkpoint('retry-migration'))).status, 'already-migrated');
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(reopen(directory).state.values[key], checkpoint('first-migration')[key]);
});

scenario('explicit backup checkpoint imports both objects and validates shapes', async () => {
  const directory = root('explicit-restore');
  const instance = seed(directory);
  const replacement = checkpoint('explicit');
  const imported = await instance.importBackupV1({ version: 1, tracks: [], playlists: [], shuffleSession: replacement[SESSION_KEY], shuffleLedger: replacement[LEDGER_KEY] });
  assert.equal(imported.ok, true);
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(reopen(directory).state.values[key], replacement[key]);
  const invalid = await instance.importBackupV1({ version: 1, tracks: [], playlists: [], shuffleSession: [] });
  assert.equal(invalid.status, 'validation-error');
  assert.deepEqual(reopen(directory).state.values[SESSION_KEY], replacement[SESSION_KEY]);
});

scenario('queued session and ledger checkpoints remain one atomic pair', async () => {
  const directory = root('queue');
  const instance = seed(directory);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => instance.commit(checkpoint(`checkpoint-${i}`), { includeState: false })));
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(new Set(results.map((result) => result.state.revision)).size, 12);
  await instance.whenIdle();
  assert.equal(instance.hasPendingWrites(), false);
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(reopen(directory).state.values[key], checkpoint('checkpoint-11')[key]);
});

scenario('torn current and pending restore the last complete checkpoint pair', () => {
  const directory = root('previous');
  const instance = seed(directory);
  instance.commitSync(checkpoint('two'));
  fs.writeFileSync(instance.paths.current, '{"torn-current":');
  fs.writeFileSync(instance.paths.temporary, '{"torn-pending":');
  const load = reopen(directory);
  assert.equal(load.diagnostics.recoveredFrom, 'previous');
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(load.state.values[key], checkpoint()[key]);
  const preserved = fs.readdirSync(instance.paths.quarantine).map((name) => fs.readFileSync(path.join(instance.paths.quarantine, name), 'utf8'));
  assert.equal(preserved.includes('{"torn-current":'), true);
  assert.equal(preserved.includes('{"torn-pending":'), true);
});

scenario('actual rename interruption recovers the full pending checkpoint pair', async () => {
  const directory = root('interrupted');
  const instance = seed(directory);
  const originalRename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (from === instance.paths.temporary && to === instance.paths.current) throw Object.assign(new Error('Injected crash after current rename'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    await assert.rejects(instance.commit(checkpoint('pending')), /Injected crash/);
  } finally { fsp.rename = originalRename; }
  const load = reopen(directory);
  assert.equal(load.diagnostics.recoveredFrom, 'pending');
  for (const key of [SESSION_KEY, LEDGER_KEY]) assert.deepEqual(load.state.values[key], checkpoint('pending')[key]);
  assert.equal(load.state.values[SESSION_KEY].opaqueState.pending.consumed, false, 'Persistence cannot retrospectively activate a pending reservation.');
});

for (const candidate of ['current', 'pending', 'previous']) {
  for (const currentState of ['valid', 'corrupt']) {
    scenario(`future ${candidate} envelope with ${currentState} current stays byte-exact and read-only`, async () => {
      const directory = root(`future-${candidate}-${currentState}`);
      const instance = seed(directory);
      instance.commitSync(checkpoint('two'));
      if (currentState === 'corrupt') fs.writeFileSync(instance.paths.current, '{"damaged":');
      const candidatePath = candidate === 'pending' ? instance.paths.temporary : instance.paths[candidate];
      const future = JSON.stringify({ storeId: STORE_ID, schemaVersion: CURRENT_SCHEMA_VERSION + 20, revision: 90, values: checkpoint('future'), opaqueFutureEnvelope: { retain: true } });
      fs.writeFileSync(candidatePath, future);
      const before = Object.fromEntries([instance.paths.current, instance.paths.temporary, instance.paths.previous].filter(fs.existsSync).map((file) => [file, fs.readFileSync(file, 'utf8')]));
      const reopened = store(directory);
      const load = reopened.loadSync();
      assert.equal(load.status, 'unsupported-future-schema');
      assert.equal(load.readOnly, true);
      assert.equal(load.state, null);
      assert.equal(load.diagnostics.recoveredFrom, candidate);
      assert.equal(reopened.commitSync(checkpoint('defaults')).status, 'read-only');
      assert.equal((await reopened.commit({ 'pixelody.volume': 0.1 })).status, 'read-only');
      assert.equal((await reopened.migrateLegacy(checkpoint('legacy'))).status, 'read-only');
      assert.equal((await reopened.importBackupV1({ version: 1, tracks: [], playlists: [] })).status, 'read-only');
      for (const [file, bytes] of Object.entries(before)) assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.deepEqual(fs.readdirSync(instance.paths.quarantine), []);
    });
  }
}

scenario('all corrupt candidates are preserved in quarantine before defaults', () => {
  const directory = root('corrupt');
  const instance = seed(directory);
  for (const [label, file] of [['current', instance.paths.current], ['pending', instance.paths.temporary], ['previous', instance.paths.previous]]) fs.writeFileSync(file, `broken-${label}`);
  const load = reopen(directory);
  assert.equal(load.status, 'recovery-defaults');
  assert.equal(load.state, null);
  const bytes = fs.readdirSync(instance.paths.quarantine).map((file) => fs.readFileSync(path.join(instance.paths.quarantine, file), 'utf8'));
  assert.deepEqual(bytes.sort(), ['broken-current', 'broken-pending', 'broken-previous']);
});

async function main() {
  for (const { name, run } of scenarios) {
    await run();
    completed.push(name);
    console.log(`PASS ${name}`);
  }
  const receipt = {
    suite: 'windows-shuffle-storage',
    schema: 'opaque store boundary; core/controller semantic schema is separate',
    testedAt: new Date().toISOString(),
    scenarios: completed,
    passed: completed.length,
    sourceHashes: Object.fromEntries(['src/state-store.js', 'scripts/check-shuffle-windows-storage.js'].map((file) => [file, hash(path.resolve(__dirname, '..', file))])),
    profile: 'generated temporary directories only',
    openGates: ['Core schema migration and paused restoration are controller/core tests.', 'No Electron, painted UI, audible playback, installed profile, signing or release evidence.'],
  };
  const receiptFlag = process.argv.indexOf('--receipt');
  if (receiptFlag >= 0) {
    if (!process.argv[receiptFlag + 1]) throw new Error('--receipt requires an output path');
    const output = path.resolve(process.argv[receiptFlag + 1]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  console.log(`Windows shuffle storage audit passed: ${completed.length} production-store scenarios.`);
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  for (const directory of roots) {
    const resolved = path.resolve(directory);
    const temporary = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), temporary.toLowerCase(), 'Cleanup must stay directly inside the temporary directory.');
    assert.equal(path.basename(resolved).startsWith('pixelody-shuffle-storage-'), true);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
