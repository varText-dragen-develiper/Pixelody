const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { PixelodyStateStore, STORE_ID, WORKSPACE_STATE_KEY, backupV1ToValues, workspaceStateKeyForProfile } = require('../src/state-store');
const workspaceOperations = require('../src/workspace-composition/operations');

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
    'aurelia.tunings': { 'track-1': { bass: 1, presence: 0, treble: -1 } },
    'aurelia.systems': { default: { bass: 0, presence: 0, treble: 0 } },
    'pixelody.favorites': ['track-1'],
    'pixelody.history': ['track-1'],
    'pixelody.playCounts': { 'track-1': 3 },
    'pixelody.queue': ['track-1'],
    'pixelody.session': { id: 'track-1', time: 42, volume: 0.7 },
    'pixelody.shuffle': false,
    'pixelody.volume': 0.7,
  };
}

try {
  {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const helperMatch = rendererSource.match(/function readPersistedJson\(key, fallback\) \{[\s\S]*?\n\}/);
    assert.ok(helperMatch, 'renderer durable/legacy JSON reader was not found');
    const context = {
      durableInitialValues: { 'pixelody.fromDurable': { source: 'durable' } },
      hasDurableValue: null,
      localStorage: {
        getItem(key) {
          if (key === 'pixelody.bad') return '{malformed';
          if (key === 'pixelody.fromDurable') return JSON.stringify({ source: 'legacy' });
          return null;
        },
      },
      malformedLegacyStateKeys: [],
    };
    context.hasDurableValue = (key) => Object.prototype.hasOwnProperty.call(context.durableInitialValues, key);
    vm.createContext(context);
    vm.runInContext(`${helperMatch[0]}; this.readPersistedJson = readPersistedJson;`, context);
    assert.deepEqual(context.readPersistedJson('pixelody.bad', { safe: true }), { safe: true });
    assert.deepEqual(context.malformedLegacyStateKeys, ['pixelody.bad']);
    assert.deepEqual(context.readPersistedJson('pixelody.bad', { safe: true }), { safe: true });
    assert.deepEqual(context.malformedLegacyStateKeys, ['pixelody.bad'], 'malformed key reporting should be deduplicated');
    assert.deepEqual(context.readPersistedJson('pixelody.fromDurable', null), { source: 'durable' }, 'durable state must take precedence after migration');

    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    for (const channel of ['state:load-sync', 'state:migrate-legacy', 'state:commit', 'state:import-backup-v1', 'state:diagnostics', 'state:workspace-load', 'state:workspace-commit', 'state:workspace-cancel', 'state:workspace-startup']) {
      assert.ok(mainSource.includes(channel), `main-process state channel missing: ${channel}`);
    }
    for (const bridgeMethod of ['loadStateSnapshot', 'migrateLegacyState', 'saveStateSnapshot', 'importBackupToState', 'getStateStoreDiagnostics', 'loadWorkspaceComposition', 'saveWorkspaceComposition', 'cancelWorkspaceComposition', 'reportWorkspaceStartup']) {
      assert.ok(preloadSource.includes(bridgeMethod), `preload state bridge missing: ${bridgeMethod}`);
    }
    const lockIndex = mainSource.indexOf('app.requestSingleInstanceLock()');
    assert.ok(lockIndex > 0, 'main process must hold a single-instance lock so two processes never commit to one durable store');
    assert.ok(lockIndex > mainSource.lastIndexOf("app.setPath('userData'"), 'single-instance lock must be requested after userData is resolved, because Electron keys the lock on that path');
    assert.match(mainSource, /app\.on\('second-instance', \(\) => revealMainWindow\(\)\)/, 'a second launch must reveal the running window');
    assert.match(mainSource, /app\.whenReady\(\)\.then\(async \(\) => \{\s*if \(!hasSingleInstanceLock\) return;/, 'a process without the lock must not open the store or create windows');
    assert.ok(rendererSource.includes('initializeDurableStateAuthority()'), 'renderer durable-state initialization is not wired');
    assert.ok(rendererSource.includes('scheduleDurableStatePersist'), 'renderer durable-state persistence is not wired');
    assert.doesNotMatch(rendererSource, /localStorage[^\n]*workspaceComposition|workspaceComposition[^\n]*localStorage/, 'Workspace authority must not gain a renderer localStorage mirror.');
    assert.match(mainSource, /WorkspaceStartupWatchdog/, 'Main-process workspace startup watchdog is not wired.');
  }

  {
    const store = new PixelodyStateStore({ directory: temporaryRoot('fresh'), backupIntervalMs: 0 });
    const fresh = store.loadSync();
    assert.equal(fresh.status, 'fresh');
    assert.equal(fresh.needsLegacyMigration, true);
    assert.equal(fresh.state, null);
  }

  {
    const root = temporaryRoot('migration');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    const migrated = store.commitSync(sampleValues(), { reason: 'legacy-local-storage-migration', migration: { legacyRecordsRetained: true, malformedLegacyKeys: ['pixelody.bad'] } });
    assert.equal(migrated.ok, true);
    const reopened = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(reopened.status, 'ready');
    assert.deepEqual(reopened.state.values['pixelody.queue'], ['track-1']);
    assert.deepEqual(reopened.state.migration.malformedLegacyKeys, ['pixelody.bad']);
    assert.equal(reopened.state.migration.legacyRecordsRetained, true);
  }

  {
    const root = temporaryRoot('partial');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    store.commitSync(sampleValues());
    const newer = { ...store.currentEnvelope(), revision: store.currentEnvelope().revision + 1, values: { ...sampleValues(), 'pixelody.repeat': 'all' } };
    fs.writeFileSync(store.paths.temporary, JSON.stringify(newer), 'utf8');
    fs.writeFileSync(store.paths.current, '{"truncated":', 'utf8');
    const recovered = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(recovered.status, 'recovered');
    assert.equal(recovered.diagnostics.recoveredFrom, 'pending');
    assert.equal(recovered.state.values['pixelody.repeat'], 'all');
    assert.equal(recovered.diagnostics.pathsHidden, true);
  }

  {
    const root = temporaryRoot('previous');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    store.commitSync(sampleValues());
    store.commitSync({ ...sampleValues(), 'pixelody.repeat': 'one' });
    fs.writeFileSync(store.paths.current, 'not-json', 'utf8');
    const recovered = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(recovered.status, 'recovered');
    assert.equal(recovered.diagnostics.recoveredFrom, 'previous');
    assert.deepEqual(recovered.state.values['aurelia.library'], sampleValues()['aurelia.library']);
  }

  {
    const root = temporaryRoot('schemas');
    const store = new PixelodyStateStore({ directory: root });
    store.ensureDirectories();
    fs.writeFileSync(store.paths.current, JSON.stringify({ storeId: STORE_ID, schemaVersion: 0, revision: 1, state: sampleValues() }), 'utf8');
    const upgraded = store.loadSync();
    assert.equal(upgraded.status, 'upgraded');
    assert.equal(upgraded.state.schemaVersion, 1);
    fs.writeFileSync(store.paths.current, JSON.stringify({ storeId: STORE_ID, schemaVersion: 99, revision: 2, values: sampleValues() }), 'utf8');
    const future = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(future.status, 'unsupported-future-schema');
    assert.equal(future.readOnly, true);
  }

  {
    const converted = backupV1ToValues({ version: 1, tracks: [{ id: 'one', artworkPath: 'private.jpg', missing: true }], playlists: [{ id: 'all', trackIds: ['one'] }], queue: ['one'], favorites: ['one'] });
    assert.equal(converted.ok, true);
    assert.equal(converted.values['aurelia.library'][0].artworkPath, null);
    assert.equal(converted.values['aurelia.library'][0].missing, false);
    assert.deepEqual(converted.values['pixelody.queue'], ['one']);
    assert.equal(backupV1ToValues({ version: 2, tracks: [], playlists: [] }).ok, false);
  }

  {
    const root = temporaryRoot('restart');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0, maxBackups: 3 });
    store.commitSync(sampleValues(), { reason: 'restart-fixture' });
    const second = new PixelodyStateStore({ directory: root });
    const loaded = second.loadSync();
    for (const key of ['aurelia.library', 'aurelia.playlists', 'aurelia.tunings', 'pixelody.favorites', 'pixelody.queue', 'pixelody.session']) {
      assert.deepEqual(loaded.state.values[key], sampleValues()[key], `${key} did not survive restart`);
    }
    assert.ok(fs.readdirSync(second.paths.backups).length >= 1, 'rotating automatic backup was not created');
  }

  {
    const root = temporaryRoot('workspace-profile-isolation');
    const defaultStore = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    defaultStore.commitSync(sampleValues(), { reason: 'default-workspace-seed' });
    const defaultInitial = defaultStore.workspaceSnapshot();
    const moved = workspaceOperations.applyOperation(defaultInitial.graph, { type: 'moveBefore', sourceId: 'queue-module', targetId: 'library-module' }, defaultStore.workspaceAuthority.validationOptions());
    assert.equal(moved.ok, true, moved.error?.message);
    const defaultCommit = defaultStore.commitWorkspaceCompositionSync(moved.graph, { expectedRevision: defaultInitial.revision });
    assert.equal(defaultCommit.ok, true);

    const profileKey = workspaceStateKeyForProfile('example-profile-r1');
    const profileStore = new PixelodyStateStore({ directory: root, backupIntervalMs: 0, workspaceStateKey: profileKey });
    const profileLoad = profileStore.loadSync();
    assert.equal(profileLoad.state.values[profileKey].graphSignature, profileLoad.state.values[profileKey].creatorSignature, 'A new profile must start from its own creator graph.');
    assert.equal(profileLoad.state.values[WORKSPACE_STATE_KEY].graphSignature, defaultCommit.state.graphSignature, 'Creating a profiled workspace must not overwrite the ordinary Canvas graph.');
    assert.deepEqual(profileLoad.state.values['aurelia.library'], sampleValues()['aurelia.library'], 'Workspace isolation must preserve shared library state.');
    assert.throws(() => workspaceStateKeyForProfile('../example'), { code: 'WORKSPACE_PROFILE_ID_INVALID' });
  }

  {
    const root = temporaryRoot('workspace-atomic');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    const seeded = store.commitSync(sampleValues(), { reason: 'workspace-seed' });
    assert.equal(seeded.ok, true);
    const initial = store.workspaceSnapshot();
    assert.equal(initial.revision, 1);
    assert.ok(initial.graphSignature);
    const moved = workspaceOperations.applyOperation(initial.graph, { type: 'moveBefore', sourceId: 'queue-module', targetId: 'library-module' }, store.workspaceAuthority.validationOptions());
    assert.equal(moved.ok, true, moved.error?.message);
    const committed = store.commitWorkspaceCompositionSync(moved.graph, { expectedRevision: 1, reason: 'workspace-test-commit' });
    assert.equal(committed.ok, true);
    assert.equal(committed.state.revision, 2);
    assert.notEqual(committed.state.graphSignature, initial.graphSignature);
    assert.equal(committed.state.lastKnownGoodSignature, initial.graphSignature);
    const currentText = fs.readFileSync(store.paths.current, 'utf8');
    const cancelled = store.workspaceAuthority.cancel(store.workspaceSnapshot(), { expectedRevision: 2 });
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.wrote, false);
    assert.equal(fs.readFileSync(store.paths.current, 'utf8'), currentText, 'Cancellation must not rewrite the durable envelope.');
    assert.equal(store.commitWorkspaceCompositionSync(initial.graph, { expectedRevision: 1 }).status, 'revision-conflict');

    const launchTwo = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(launchTwo.state.values[WORKSPACE_STATE_KEY].graphSignature, committed.state.graphSignature);
    assert.equal(launchTwo.state.values[WORKSPACE_STATE_KEY].revision, 2);
    const launchThree = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(launchThree.state.values[WORKSPACE_STATE_KEY].graphSignature, committed.state.graphSignature);
    assert.equal(launchThree.state.values[WORKSPACE_STATE_KEY].revision, 2);
  }

  {
    const root = temporaryRoot('workspace-domain-recovery');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    store.commitSync(sampleValues(), { reason: 'workspace-recovery-seed' });
    const envelope = JSON.parse(fs.readFileSync(store.paths.current, 'utf8'));
    const workspace = envelope.values[WORKSPACE_STATE_KEY];
    workspace.graph = { type: 'root', id: 'partial-only' };
    workspace.graphSignature = 'forged-partial-signature';
    fs.writeFileSync(store.paths.current, JSON.stringify(envelope), 'utf8');
    const recovered = new PixelodyStateStore({ directory: root }).loadSync();
    assert.deepEqual(recovered.state.values['aurelia.library'], sampleValues()['aurelia.library'], 'Workspace corruption must not quarantine playback/library state.');
    assert.equal(recovered.state.values[WORKSPACE_STATE_KEY].recovery.recoveredFrom, 'last-known-good');
    assert.notEqual(recovered.state.values[WORKSPACE_STATE_KEY].graphSignature, 'forged-partial-signature');
    assert.equal(recovered.state.values[WORKSPACE_STATE_KEY].substitutionReceipts.at(-1).type, 'graph-recovery');

    const futureEnvelope = JSON.parse(fs.readFileSync(store.paths.current, 'utf8'));
    futureEnvelope.values[WORKSPACE_STATE_KEY] = { schemaVersion: 99, graph: workspace.lastKnownGoodGraph };
    fs.writeFileSync(store.paths.current, JSON.stringify(futureEnvelope), 'utf8');
    const future = new PixelodyStateStore({ directory: root }).loadSync();
    assert.equal(future.ok, true, 'A future workspace schema must not make the entire player store read-only.');
    assert.equal(future.state.values[WORKSPACE_STATE_KEY].startup.safeMode, true);
    assert.deepEqual(future.state.values['pixelody.queue'], ['track-1']);
  }

  {
    const root = temporaryRoot('workspace-watchdog');
    const store = new PixelodyStateStore({ directory: root, backupIntervalMs: 0 });
    store.commitSync(sampleValues());
    store.recordWorkspaceStartupSync('failed', { errorCode: 'FIRST_PAINT_FAILURE' });
    store.recordWorkspaceStartupSync('failed', { errorCode: 'SECOND_PAINT_FAILURE' });
    const third = store.recordWorkspaceStartupSync('failed', { errorCode: 'THIRD_PAINT_FAILURE' });
    assert.equal(third.ok, true);
    assert.equal(third.state.startup.safeMode, true);
    assert.equal(third.state.graphSignature, third.state.creatorSignature);
    const healthy = store.recordWorkspaceStartupSync('healthy');
    assert.equal(healthy.state.startup.consecutiveFailures, 0);
    assert.equal(healthy.state.startup.safeMode, false);
  }

  {
    const authorityStore = new PixelodyStateStore({ directory: temporaryRoot('workspace-backup-source'), backupIntervalMs: 0 });
    authorityStore.commitSync(sampleValues());
    const initial = authorityStore.workspaceSnapshot();
    const moved = workspaceOperations.applyOperation(initial.graph, { type: 'moveAfter', sourceId: 'library-module', targetId: 'queue-module' }, authorityStore.workspaceAuthority.validationOptions());
    const committed = authorityStore.commitWorkspaceCompositionSync(moved.graph, { expectedRevision: 1 });
    const converted = backupV1ToValues({ version: 1, tracks: [], playlists: [], workspaceComposition: committed.state });
    assert.equal(converted.ok, true);
    assert.equal(converted.values[WORKSPACE_STATE_KEY].graphSignature, committed.state.graphSignature);
    const restoredStore = new PixelodyStateStore({ directory: temporaryRoot('workspace-backup-target'), backupIntervalMs: 0 });
    const restored = restoredStore.commitSync(converted.values, { reason: 'workspace-backup-restore' });
    assert.equal(restored.ok, true);
    assert.equal(restoredStore.workspaceSnapshot().graphSignature, committed.state.graphSignature);
  }

  {
    // Restore over a populated store. Until 2026-09-20 commitSync's
    // replaceKnownValues ternary had two identical arms, so the flag was
    // accepted and ignored and every restore merged: a playlist deleted before
    // the backup was taken came straight back, and favorites unioned instead of
    // replacing. The previous coverage restored into an empty directory, which
    // is the one case where merge and replace are indistinguishable.
    const store = new PixelodyStateStore({ directory: temporaryRoot('restore-over-populated'), backupIntervalMs: 0 });
    store.commitSync({
      ...sampleValues(),
      'aurelia.playlists': [
        { id: 'all', name: 'All Music', trackIds: ['track-1'] },
        { id: 'stale', name: 'Removed before the backup was taken', trackIds: ['track-1'] },
      ],
      'pixelody.favorites': ['track-1', 'track-removed'],
      'pixelody.watchedFolders': ['C:\\Music\\Retired'],
    });
    const initialWorkspace = store.workspaceSnapshot();
    const movedWorkspace = workspaceOperations.applyOperation(
      initialWorkspace.graph,
      { type: 'moveAfter', sourceId: 'library-module', targetId: 'queue-module' },
      store.workspaceAuthority.validationOptions(),
    );
    const committedWorkspace = store.commitWorkspaceCompositionSync(movedWorkspace.graph, { expectedRevision: 1 });
    assert.equal(committedWorkspace.ok, true);
    assert.notEqual(committedWorkspace.state.graphSignature, initialWorkspace.graphSignature);

    const restored = store.commitSync({
      'aurelia.library': [{ id: 'track-1', path: 'C:\\Music\\one.flac', title: 'One' }],
      'aurelia.playlists': [{ id: 'all', name: 'All Music', trackIds: ['track-1'] }],
      'pixelody.favorites': [],
    }, { reason: 'manual-backup-v1-import', replaceKnownValues: true });
    assert.equal(restored.ok, true);
    const restoredValues = restored.state.values;
    assert.deepEqual(restoredValues['aurelia.playlists'].map((playlist) => playlist.id), ['all'], 'A restore must not resurrect a playlist the backup does not contain.');
    assert.deepEqual(restoredValues['pixelody.favorites'], [], 'A restore must replace favorites rather than union them.');
    assert.equal(Object.prototype.hasOwnProperty.call(restoredValues, 'pixelody.watchedFolders'), false, 'A known key the backup omits must be removed by a restore, not retained.');
    assert.equal(Object.prototype.hasOwnProperty.call(restoredValues, 'pixelody.playCounts'), false, 'Play counts absent from the backup must not survive a restore.');
    assert.equal(store.workspaceSnapshot().graphSignature, committedWorkspace.state.graphSignature, 'A restore must not reset a Canvas workspace the backup says nothing about.');

    const merged = store.commitSync({ 'pixelody.volume': 0.3 }, { reason: 'renderer-persist' });
    assert.equal(merged.state.values['pixelody.volume'], 0.3);
    assert.deepEqual(merged.state.values['aurelia.playlists'].map((playlist) => playlist.id), ['all'], 'An ordinary commit must still merge, so a debounced tick cannot erase untouched keys.');
    assert.equal(merged.state.values['aurelia.library'].length, 1, 'An ordinary commit must leave the library alone.');
  }

  console.log('State-store audit passed: renderer integration, malformed legacy fallback, migration, validation, profile-isolated workspaces, atomic recovery, schema gates, C7 workspace revisions/recovery/watchdog, backup compatibility, restore replacement, rotation, and two-launch persistence are intact.');
} finally {
  roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
}
