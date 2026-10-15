const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PixelodyStateStore, WORKSPACE_STATE_KEY } = require('../src/state-store');

// Commits are what main.js runs for every renderer save. They must keep the
// same atomic, restartable result while doing their disk I/O off the Electron
// main thread, merge against memory instead of re-reading the file, and send
// routine saves back as a header rather than a full-library copy.

const roots = [];
function temporaryRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pixelody-${label}-`));
  roots.push(root);
  return root;
}

function sampleValues() {
  return {
    'aurelia.library': [{ id: 'track-1', path: 'C:\\Music\\one.flac', title: 'One' }],
    'aurelia.playlists': [{ id: 'all', name: 'All Music', trackIds: ['track-1'] }],
    'pixelody.favorites': ['track-1'],
    'pixelody.queue': ['track-1'],
    'pixelody.session': { id: 'track-1', time: 42, volume: 0.7 },
    'pixelody.shuffle': false,
    'pixelody.volume': 0.7,
  };
}

let completed = false;
// A never-settling promise drains the event loop and would otherwise exit 0.
process.on('exit', () => {
  if (!completed && !process.exitCode) {
    console.error('Async state-store audit did not complete: an awaited promise never settled.');
    process.exitCode = 1;
  }
});

(async () => {
  try {
    const root = temporaryRoot('async-commit');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0, maxBackups: 2 });
    store.loadSync();
    const first = await store.commit(sampleValues(), { reason: 'async-first' });
    assert.equal(first.ok, true);
    assert.deepEqual(first.state.values['pixelody.queue'], ['track-1'], 'migration and import callers still receive the full committed state');
    assert.ok(first.state.values[WORKSPACE_STATE_KEY], 'a commit still seeds the default workspace slot');

    // After a commit the store must merge against memory, never re-read the file.
    const originalLoadSync = store.loadSync.bind(store);
    let reloads = 0;
    store.loadSync = () => { reloads += 1; return originalLoadSync(); };
    let settled = false;
    const inFlight = store.commit({ ...sampleValues(), 'pixelody.repeat': 'all' }, { reason: 'playback-session-position', includeState: false });
    inFlight.finally(() => { settled = true; });
    assert.equal(store.hasPendingWrites(), true, 'queued commits are visible so shutdown can drain them');
    while (!settled && store.asyncWritesInFlight === 0) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.asyncWritesInFlight, 1, 'the commit should be writing asynchronously');
    const concurrentLoad = originalLoadSync();
    assert.equal(concurrentLoad.state.revision, 1, 'a load during an in-flight write returns the committed in-memory state instead of racing the rename');
    const slim = await inFlight;
    await store.whenIdle();
    assert.equal(store.hasPendingWrites(), false, 'a drained store reports no pending writes');
    assert.equal(reloads, 0, 'commits must not reload and re-validate the state file from disk');
    assert.equal(slim.ok, true);
    assert.equal(slim.state.revision, 2, 'slim results still carry the committed revision');
    assert.equal(slim.state.values, undefined, 'routine renderer saves must not receive a full-library copy over IPC');
    assert.equal(store.diagnosticsSnapshot().revision, 2);
    assert.equal(reloads, 0, 'diagnostics must not re-read the state file once loaded');
    store.loadSync = originalLoadSync;

    const text = fs.readFileSync(store.paths.current, 'utf8');
    assert.ok(!text.includes('\n  '), 'the state file is written as compact JSON');
    assert.equal(JSON.parse(text).values['pixelody.repeat'], 'all');
    assert.ok(fs.existsSync(store.paths.previous), 'the previous generation is retained for recovery');
    assert.ok(!fs.existsSync(store.paths.temporary), 'the pending file is promoted');
    assert.ok(fs.readdirSync(store.paths.backups).length <= 2, 'async backup rotation honours maxBackups');

    const partial = await store.commit({ 'pixelody.session': { id: 'track-1', time: 99, volume: 0.5 } }, { reason: 'partial', includeState: false });
    assert.equal(partial.ok, true);
    const reopened = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(reopened.status, 'ready');
    assert.equal(reopened.state.revision, 3);
    assert.deepEqual(reopened.state.values['aurelia.library'], sampleValues()['aurelia.library'], 'partial commits keep unrelated keys');
    assert.equal(reopened.state.values['pixelody.session'].time, 99);

    assert.equal((await store.commit({ 'pixelody.untypedFixture': { kept: true } }, { includeState: false })).ok, true);
    const undefinedKeepsStored = await store.commit({ 'pixelody.untypedFixture': undefined, 'pixelody.repeat': 'one', ['__proto__']: { polluted: true } }, { includeState: false });
    assert.equal(undefinedKeepsStored.ok, true);
    const afterUndefined = new PixelodyStateStore({ directory: root }).loadSync().state.values;
    assert.deepEqual(afterUndefined['pixelody.untypedFixture'], { kept: true }, 'an undefined value keeps the stored value instead of erasing it');
    assert.equal(afterUndefined['pixelody.repeat'], 'one');
    assert.equal({}.polluted, undefined, 'a __proto__ key must not pollute prototypes');
    const circular = { ...sampleValues() };
    circular['pixelody.layout'] = {};
    circular['pixelody.layout'].self = circular['pixelody.layout'];
    assert.equal((await store.commit(circular)).status, 'validation-error', 'unserializable state is rejected, not written');
    const oversized = await store.commit({ 'pixelody.wantedTracks': ['x'.repeat(33 * 1024 * 1024), 'y'.repeat(33 * 1024 * 1024)] });
    assert.equal(oversized.status, 'validation-error', 'state above the 64 MB limit is rejected');
    assert.equal((await store.commit({ 'pixelody.volume': 'loud' })).status, 'validation-error', 'typed keys are still shape-checked');
    assert.equal(new PixelodyStateStore({ directory: root }).loadSync().state.revision, 5, 'rejected commits leave the last good state untouched');

    // Restores still replace known keys; an ordinary commit still merges.
    const restored = await store.commit({ 'aurelia.library': [], 'aurelia.playlists': [{ id: 'all', name: 'All Music', trackIds: [] }] }, { reason: 'manual-backup-v1-import', replaceKnownValues: true });
    assert.equal(restored.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(restored.state.values, 'pixelody.favorites'), false, 'a restore removes known keys the backup omits');
    assert.deepEqual(restored.state.values['pixelody.untypedFixture'], { kept: true }, 'a restore keeps keys outside the known set');

    // Workspace commits share the queue and the async path.
    const beforeStartup = store.workspaceSnapshot().startup;
    const startup = await store.recordWorkspaceStartup('begin', { watchdogMs: 5000 });
    assert.equal(startup.ok, true, `workspace startup records commit through the async path: ${startup.error || ''}`);
    assert.equal(startup.storeRevision, restored.state.revision + 1, 'workspace startup records report the store revision they committed');
    assert.equal(store.workspaceSnapshot().startup.attempt, beforeStartup.attempt + 1, 'the startup record is what the store now holds');
    assert.equal(new PixelodyStateStore({ directory: root }).loadSync().state.values[WORKSPACE_STATE_KEY].startup.status, 'pending', 'the startup record reached disk');

    // Queued commits land in order and all of them survive.
    const burst = await Promise.all([1, 2, 3, 4].map((volume) => store.commit({ 'pixelody.volume': volume / 10 }, { includeState: false })));
    assert.deepEqual(burst.map((result) => result.state.revision), burst.map((_, index) => burst[0].state.revision + index), 'queued commits get consecutive revisions');
    assert.equal(new PixelodyStateStore({ directory: root }).loadSync().state.values['pixelody.volume'], 0.4, 'the last queued commit wins on disk');

    // Pretty-printed files from earlier versions remain readable.
    const current = new PixelodyStateStore({ directory: root }).loadSync().state;
    fs.writeFileSync(store.paths.current, `${JSON.stringify({ ...current, revision: current.revision + 5 }, null, 2)}\n`, 'utf8');
    assert.equal(new PixelodyStateStore({ directory: root }).loadSync().state.revision, current.revision + 5, 'pretty-printed state from earlier versions still loads');

    console.log('Async state-store audit passed: off-thread commits stay atomic and restartable, merge against memory without re-reading, return slim results, reject bad state, keep restores replacing, share one ordered queue, and still read pretty-printed files.');
    completed = true;
  } finally {
    roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
