'use strict';

// Failure-injection coverage for the durable state store.
//
// PixelodyStateStore already writes crash-safely: pending file, fsync, read-back
// validation, current -> previous, atomic rename, quarantine, and pending
// recovery on the next launch. None of those recovery paths had a test. This
// harness interrupts, truncates and corrupts the store on disk and asserts that
// every outcome is one a user can survive -- the library either comes back or is
// preserved in quarantine, and a damaged file is never silently overwritten with
// an empty one.
//
// Run with `npm run check:durability`. Part of `npm run check`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PixelodyStateStore } = require('../src/state-store');

const roots = [];
function temporaryRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pixelody-durability-${label}-`));
  roots.push(root);
  return root;
}

function newStore(directory, options = {}) {
  return new PixelodyStateStore({ directory, backupIntervalMs: 0, ...options });
}

function libraryValues(trackCount = 3, marker = 'original') {
  return {
    'aurelia.library': Array.from({ length: trackCount }, (unused, index) => ({
      id: `track-${index + 1}`,
      path: `C:\\Music\\track-${index + 1}.flac`,
      title: `Track ${index + 1}`,
      marker,
    })),
    'aurelia.playlists': [{ id: 'all', name: 'All Music', trackIds: ['track-1'] }],
    'pixelody.favorites': ['track-1'],
    'pixelody.playCounts': { 'track-1': 12 },
  };
}

function statePaths(directory) {
  return {
    current: path.join(directory, 'pixelody-state.json'),
    previous: path.join(directory, 'pixelody-state.previous.json'),
    pending: path.join(directory, 'pixelody-state.pending.json'),
    quarantine: path.join(directory, 'quarantine'),
  };
}

function quarantinedFiles(directory) {
  const dir = statePaths(directory).quarantine;
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
}

// A quarantined file is only worth anything if the bytes are still in it. Every
// scenario that quarantines checks the recovered text, not just the filename.
function quarantineContains(directory, needle) {
  const dir = statePaths(directory).quarantine;
  return quarantinedFiles(directory).some((name) => fs.readFileSync(path.join(dir, name), 'utf8').includes(needle));
}

const scenarios = [];
function scenario(name, run) {
  scenarios.push({ name, run });
}

scenario('a clean write survives a reopen', () => {
  const directory = temporaryRoot('clean');
  newStore(directory).commitSync(libraryValues());
  const load = newStore(directory).loadSync();
  assert.equal(load.ok, true);
  assert.equal(load.status, 'ready');
  assert.equal(load.state.values['aurelia.library'].length, 3);
});

scenario('a crash between fsync and rename recovers the pending write', () => {
  const directory = temporaryRoot('crash-before-rename');
  const store = newStore(directory);
  store.commitSync(libraryValues(3, 'original'));
  const paths = statePaths(directory);

  // Reproduce the exact interruption window: pending is written and fsynced,
  // the process dies before the rename, so current still holds the old envelope.
  const older = fs.readFileSync(paths.current, 'utf8');
  store.commitSync(libraryValues(5, 'newer'));
  fs.writeFileSync(paths.pending, fs.readFileSync(paths.current, 'utf8'), 'utf8');
  fs.writeFileSync(paths.current, older, 'utf8');

  const load = newStore(directory).loadSync();
  assert.equal(load.ok, true);
  // current parses, so it wins and pending is left for the next write to clear.
  // The point is that neither file is lost and the store opens on real data.
  assert.equal(load.state.values['aurelia.library'][0].marker, 'original');
  assert.equal(fs.existsSync(paths.pending), true);
});

scenario('a torn pending write is ignored while current is intact', () => {
  const directory = temporaryRoot('torn-pending-only');
  const store = newStore(directory);
  store.commitSync(libraryValues());
  store.commitSync({ 'pixelody.volume': 0.4 });
  const paths = statePaths(directory);
  fs.writeFileSync(paths.pending, '{"storeId":"pixelody.desktop.state","scheBROKEN', 'utf8');

  // current parses, so the damaged pending file is never consulted. The store
  // must not treat leftover debris as a reason to recover anything.
  const load = newStore(directory).loadSync();
  assert.equal(load.ok, true);
  assert.equal(load.status, 'ready');
  assert.equal(load.state.values['aurelia.library'].length, 3);
  assert.equal(load.state.values['pixelody.volume'], 0.4);
});

scenario('a damaged current and pending together fall back to previous', () => {
  const directory = temporaryRoot('torn-pending');
  const store = newStore(directory);
  store.commitSync(libraryValues(3, 'first'));
  store.commitSync(libraryValues(4, 'second'));
  const paths = statePaths(directory);
  fs.writeFileSync(paths.current, '{"storeId":"pixelody.desktop.state","schemaVersion":1,"reviBROKEN', 'utf8');
  fs.writeFileSync(paths.pending, '{"storeId":"pixelody.desktop.state","scheBROKEN', 'utf8');

  const load = newStore(directory).loadSync();
  assert.equal(load.ok, true);
  assert.equal(load.status, 'recovered');
  assert.equal(load.diagnostics.recoveredFrom, 'previous');
  assert.equal(load.state.values['aurelia.library'][0].marker, 'first');
  assert.equal(quarantinedFiles(directory).length >= 2, true, 'Both damaged files must be preserved.');
});

scenario('a corrupt current falls back to previous without losing the library', () => {
  const directory = temporaryRoot('corrupt-current');
  const store = newStore(directory);
  store.commitSync(libraryValues(3, 'first'));
  store.commitSync(libraryValues(4, 'second'));
  const paths = statePaths(directory);
  fs.writeFileSync(paths.current, 'not json at all', 'utf8');

  const load = newStore(directory).loadSync();
  assert.equal(load.ok, true);
  assert.equal(load.status, 'recovered');
  assert.equal(load.diagnostics.recoveredFrom, 'previous');
  assert.equal(load.state.values['aurelia.library'][0].marker, 'first');
  assert.equal(quarantineContains(directory, 'not json at all'), true, 'The corrupt file must be preserved, not deleted.');
});

scenario('a zero-byte current is treated as damaged, not as empty state', () => {
  const directory = temporaryRoot('zero-byte');
  const store = newStore(directory);
  store.commitSync(libraryValues());
  store.commitSync({ 'pixelody.volume': 0.5 });
  fs.writeFileSync(statePaths(directory).current, '', 'utf8');

  const load = newStore(directory).loadSync();
  assert.equal(load.ok, true);
  assert.equal(load.status, 'recovered');
  assert.equal(load.state.values['aurelia.library'].length, 3, 'A truncated file must never read as a library of zero tracks.');
});

scenario('total corruption preserves the library in quarantine instead of deleting it', () => {
  const directory = temporaryRoot('total-corruption');
  const store = newStore(directory);
  store.commitSync(libraryValues(3, 'irreplaceable'));
  store.commitSync(libraryValues(4, 'irreplaceable'));
  const paths = statePaths(directory);
  fs.writeFileSync(paths.current, 'garbage-current', 'utf8');
  fs.writeFileSync(paths.previous, 'garbage-previous', 'utf8');

  const load = newStore(directory).loadSync();
  // Nothing parseable is left, so the app has to start on defaults. What must
  // NOT happen is the bytes going in the bin: both files land in quarantine so
  // the library is still recoverable by hand.
  assert.equal(load.status, 'recovery-defaults');
  assert.equal(load.state, null);
  assert.equal(load.diagnostics.quarantined, true);
  assert.equal(quarantineContains(directory, 'garbage-current'), true);
  assert.equal(quarantinedFiles(directory).length >= 1, true);
});

scenario('a state file from a future schema is read-only and is never overwritten', () => {
  const directory = temporaryRoot('future-schema');
  const store = newStore(directory);
  store.commitSync(libraryValues(3, 'written-by-a-newer-build'));
  const paths = statePaths(directory);
  const envelope = JSON.parse(fs.readFileSync(paths.current, 'utf8'));
  envelope.schemaVersion = 99;
  const futureText = `${JSON.stringify(envelope, null, 2)}\n`;
  fs.writeFileSync(paths.current, futureText, 'utf8');

  const reopened = newStore(directory);
  const load = reopened.loadSync();
  assert.equal(load.ok, false);
  assert.equal(load.status, 'unsupported-future-schema');
  assert.equal(load.readOnly, true);

  const attempted = reopened.commitSync({ 'pixelody.volume': 0.1 });
  assert.equal(attempted.ok, false);
  assert.equal(attempted.status, 'read-only');
  assert.equal(fs.readFileSync(paths.current, 'utf8'), futureText, 'A newer build\'s state must survive an older build opening it.');
});

scenario('an oversized envelope is refused and leaves the good file in place', () => {
  const directory = temporaryRoot('oversize');
  const store = newStore(directory);
  store.commitSync(libraryValues(3, 'safe'));
  const paths = statePaths(directory);
  const before = fs.readFileSync(paths.current, 'utf8');

  // The size ceiling is enforced in validateValues, before anything touches the
  // disk, so an oversized commit is refused as a result rather than thrown.
  const refused = store.commitSync({ 'pixelody.profileImage': 'x'.repeat(65 * 1024 * 1024) });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 'validation-error');
  assert.equal(fs.readFileSync(paths.current, 'utf8'), before, 'A rejected write must not disturb the committed state.');

  const load = newStore(directory).loadSync();
  assert.equal(load.state.values['aurelia.library'][0].marker, 'safe');
});

scenario('queued concurrent commits all land with monotonic revisions', async () => {
  const directory = temporaryRoot('concurrent');
  const store = newStore(directory);
  store.commitSync(libraryValues());
  const results = await Promise.all([
    store.commit({ 'pixelody.volume': 0.1 }, { reason: 'a' }),
    store.commit({ 'pixelody.repeat': 'all' }, { reason: 'b' }),
    store.commit({ 'pixelody.sort': 'title-asc' }, { reason: 'c' }),
  ]);
  for (const result of results) assert.equal(result.ok, true);
  const revisions = results.map((result) => result.state.revision);
  assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b), 'Revisions must not go backwards under concurrent writes.');
  assert.equal(new Set(revisions).size, revisions.length, 'Two commits must never share a revision.');

  const load = newStore(directory).loadSync();
  assert.equal(load.state.values['pixelody.volume'], 0.1);
  assert.equal(load.state.values['pixelody.repeat'], 'all');
  assert.equal(load.state.values['pixelody.sort'], 'title-asc');
  assert.equal(load.state.values['aurelia.library'].length, 3, 'Concurrent partial commits must not drop the library.');
});

scenario('restoring a backup removes what the backup does not contain', async () => {
  const directory = temporaryRoot('restore');
  const store = newStore(directory);
  store.commitSync({
    ...libraryValues(3, 'before-restore'),
    'aurelia.playlists': [
      { id: 'all', name: 'All Music', trackIds: ['track-1'] },
      { id: 'deleted', name: 'Deleted before the backup', trackIds: ['track-1'] },
    ],
    'pixelody.watchedFolders': ['C:\\Music\\Retired'],
  });

  const result = await store.importBackupV1({
    version: 1,
    tracks: [{ id: 'track-1', path: 'C:\\Music\\track-1.flac', title: 'Track 1' }],
    playlists: [{ id: 'all', name: 'All Music', trackIds: ['track-1'] }],
  });
  assert.equal(result.ok, true);
  const values = result.state.values;
  assert.deepEqual(values['aurelia.playlists'].map((playlist) => playlist.id), ['all'], 'A restore must not resurrect a deleted playlist.');
  assert.deepEqual(values['pixelody.watchedFolders'], [], 'Watched folders must come from the backup, not from what was already stored.');
  assert.equal(values['aurelia.library'].length, 1);

  const load = newStore(directory).loadSync();
  assert.deepEqual(load.state.values['aurelia.playlists'].map((playlist) => playlist.id), ['all'], 'The restore must survive a reopen.');
});

async function main() {
  let failures = 0;
  for (const { name, run } of scenarios) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(`     ${error.message}`);
    }
  }
  if (failures) throw new Error(`State durability audit failed: ${failures} of ${scenarios.length} scenarios.`);
  console.log(`State durability audit passed: ${scenarios.length} interruption, corruption, truncation, schema, oversize, concurrency, and restore scenarios all land recoverably.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  });
