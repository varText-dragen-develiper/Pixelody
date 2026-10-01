const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { IPC_CONTRACTS, validateIpcArguments } = require('../src/electron-security');
const { PixelodyStateStore, ARRAY_VALUE_KEYS, backupV1ToValues } = require('../src/state-store');

const tempRoots = [];
function makeTempDir(prefix = 'pixelody-watch-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function runAllTests() {
  console.log('Running Automatic Folder Watching validation...');

  // 1. Electron Security IPC Contracts & Validators
  {
    const requiredChannels = [
      'library:add-watched-folder',
      'library:remove-watched-folder',
      'library:get-watched-folders',
      'library:sync-watched-folders',
      'library:rescan-watched-folders',
    ];

    for (const channel of requiredChannels) {
      assert.ok(IPC_CONTRACTS[channel], `Missing IPC contract for ${channel}`);
    }

    // add-watched-folder accepts empty args (dialog) or 1 absolute path string
    assert.equal(validateIpcArguments('library:add-watched-folder', []).ok, true);
    assert.equal(validateIpcArguments('library:add-watched-folder', ['C:\\Music']).ok, true);
    assert.equal(validateIpcArguments('library:add-watched-folder', ['relative/path']).ok, false);
    assert.equal(validateIpcArguments('library:add-watched-folder', [123]).ok, false);
    assert.equal(validateIpcArguments('library:add-watched-folder', ['C:\\Music', 'extra']).ok, false);

    // remove-watched-folder requires 1 absolute path string
    assert.equal(validateIpcArguments('library:remove-watched-folder', ['C:\\Music']).ok, true);
    assert.equal(validateIpcArguments('library:remove-watched-folder', []).ok, false);
    assert.equal(validateIpcArguments('library:remove-watched-folder', ['relative/path']).ok, false);

    // get-watched-folders and rescan-watched-folders accept no arguments
    assert.equal(validateIpcArguments('library:get-watched-folders', []).ok, true);
    assert.equal(validateIpcArguments('library:get-watched-folders', ['extra']).ok, false);
    assert.equal(validateIpcArguments('library:rescan-watched-folders', []).ok, true);
    assert.equal(validateIpcArguments('library:rescan-watched-folders', ['extra']).ok, false);

    // sync-watched-folders requires array of <=256 absolute paths
    assert.equal(validateIpcArguments('library:sync-watched-folders', [['C:\\Music', 'D:\\Audio']]).ok, true);
    assert.equal(validateIpcArguments('library:sync-watched-folders', [[]]).ok, true);
    assert.equal(validateIpcArguments('library:sync-watched-folders', [['not-absolute']]).ok, false);
    assert.equal(validateIpcArguments('library:sync-watched-folders', ['C:\\Music']).ok, false);
    console.log('✓ IPC contracts and validation rules verified.');
  }

  // 2. State Store Persistence
  {
    assert.ok(ARRAY_VALUE_KEYS.has('pixelody.watchedFolders'), 'pixelody.watchedFolders must be in ARRAY_VALUE_KEYS');

    const storeRoot = makeTempDir('pixelody-store-test-');
    const store = new PixelodyStateStore({ directory: storeRoot });
    const initial = store.loadSync();
    assert.ok(initial.ok);

    // Roundtrip persistence test
    const testFolders = ['C:\\Music\\Lossless', 'D:\\Bandcamp'];
    const commit = store.commitSync({
      'pixelody.watchedFolders': testFolders,
    }, {
      reason: 'test-folder-watch',
    });
    assert.ok(commit.ok);

    const reloaded = store.loadSync();
    assert.ok(reloaded.ok);
    assert.deepEqual(reloaded.state.values['pixelody.watchedFolders'], testFolders);

    // Backup mapping test
    const backupValues = backupV1ToValues({
      version: 1,
      tracks: [],
      playlists: [],
      watchedFolders: ['C:\\Restored\\Music'],
    });
    assert.ok(backupValues.ok);
    assert.deepEqual(backupValues.values['pixelody.watchedFolders'], ['C:\\Restored\\Music']);
    console.log('✓ State Store persistence and backup mapping verified.');
  }

  // 3. Main Process WatchedFolderManager Unit Test
  {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

    // Extract WatchedFolderManager class definition from main.js
    const start = mainSource.indexOf('class WatchedFolderManager');
    const end = mainSource.indexOf('const watchedFolderManager = new WatchedFolderManager');
    assert.ok(start !== -1 && end !== -1, 'WatchedFolderManager class definition bounds not found in main.js');
    const classCode = mainSource.slice(start, end);

    const AUDIO_FILTERS = [{ extensions: ['flac', 'wav', 'wave', 'aif', 'aiff', 'mp3', 'm4a', 'aac', 'ogg', 'opus'] }];
    const MAX_FOLDER_IMPORT_FILES = 5000;
    const granted = new Set();
    const grantPath = (p) => granted.add(p);
    const normalizedPathKey = (p) => path.resolve(p).toLowerCase();

    const sandbox = {
      AUDIO_FILTERS,
      MAX_FOLDER_IMPORT_FILES,
      grantPath,
      normalizedPathKey,
      fs: fs.promises,
      nodeFs: fs,
      path,
      console,
      setTimeout,
      clearTimeout,
      Date,
      Set,
      Map,
      Array,
    };
    vm.createContext(sandbox);
    vm.runInContext(`${classCode}; this.WatchedFolderManager = WatchedFolderManager;`, sandbox);

    const WatchedFolderManager = sandbox.WatchedFolderManager;
    let changeEvents = [];
    const mockWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel, payload) => {
          changeEvents.push({ channel, payload });
        },
      },
    };

    const manager = new WatchedFolderManager({
      getMainWindow: () => mockWin,
      debounceMs: 50,
    });

    // Create a real directory structure with audio and non-audio files
    const watchDir = makeTempDir('watched-media-');
    const subDir = path.join(watchDir, 'SubAlbum');
    fs.mkdirSync(subDir, { recursive: true });

    const track1 = path.join(watchDir, 'song1.flac');
    const track2 = path.join(watchDir, 'song2.mp3');
    const track3 = path.join(subDir, 'nested_track.wav');
    const nonAudio = path.join(watchDir, 'cover.jpg');
    const ignoredTxt = path.join(subDir, 'notes.txt');

    fs.writeFileSync(track1, 'RIFF-TEST-AUDIO');
    fs.writeFileSync(track2, 'ID3-TEST-AUDIO');
    fs.writeFileSync(track3, 'WAVE-TEST-AUDIO');
    fs.writeFileSync(nonAudio, 'JPEG-IMAGE');
    fs.writeFileSync(ignoredTxt, 'TEXT-NOTES');

    // Add folder
    const addResult = await manager.addWatchedFolder(watchDir);
    assert.ok(addResult.ok);
    assert.equal(addResult.trackCount, 3);
    assert.equal(addResult.tracks.length, 3);
    assert.ok(granted.has(track1));
    assert.ok(granted.has(track2));
    assert.ok(granted.has(track3));

    // Duplicate add returns existing state
    const duplicateAdd = await manager.addWatchedFolder(watchDir);
    assert.ok(duplicateAdd.ok);
    assert.equal(duplicateAdd.alreadyWatching, true);

    // List watched folders
    const listResult = manager.getWatchedFolders();
    assert.ok(Array.isArray(listResult));
    assert.equal(listResult.length, 1);
    assert.equal(listResult[0].path, path.resolve(watchDir));

    // Rescan all
    const rescanResult = await manager.rescanAll();
    assert.equal(rescanResult.length, 1);
    assert.ok(rescanResult[0].ok);
    assert.equal(rescanResult[0].trackCount, 3);

    // Sync folders (remove existing and watch empty directory)
    const emptyWatchDir = makeTempDir('empty-watch-');
    const syncResult = await manager.syncWatchedFolders([emptyWatchDir]);
    assert.ok(syncResult.ok);
    assert.equal(syncResult.folders.length, 1);

    const afterSyncList = manager.getWatchedFolders();
    assert.ok(Array.isArray(afterSyncList));
    assert.equal(afterSyncList.length, 1);
    assert.equal(afterSyncList[0].path, path.resolve(emptyWatchDir));

    // Clean up watchers
    manager.removeWatchedFolder(emptyWatchDir);
    assert.equal(manager.getWatchedFolders().length, 0);

    console.log('✓ WatchedFolderManager scan, watcher, and sync behavior verified.');
  }

  // 4. Preload and Renderer Surface Check
  {
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    for (const method of ['addWatchedFolder', 'removeWatchedFolder', 'getWatchedFolders', 'syncWatchedFolders', 'rescanWatchedFolders', 'onWatchedFolderChange']) {
      assert.ok(preloadSource.includes(method), `preload.js missing ${method}`);
    }

    const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    for (const id of ['watchedFoldersSection', 'watchedFoldersList', 'watchedFoldersEmpty', 'addWatchedFolderButton', 'rescanWatchedFolders']) {
      assert.ok(htmlSource.includes(`id="${id}"`), `index.html missing element #${id}`);
    }

    const cssSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'library-features.css'), 'utf8');
    assert.ok(cssSource.includes('.watched-folders-section'), 'library-features.css missing .watched-folders-section');
    assert.ok(cssSource.includes('.watched-folder-item'), 'library-features.css missing .watched-folder-item');

    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    assert.ok(rendererSource.includes("watchedFolders: readPersistedJson('pixelody.watchedFolders', []),"), 'renderer.js missing state.watchedFolders initialization');
    assert.ok(rendererSource.includes("'pixelody.watchedFolders': state.watchedFolders,"), 'renderer.js missing buildDurableStateValues key');
    assert.ok(rendererSource.includes('renderWatchedFoldersUi'), 'renderer.js missing renderWatchedFoldersUi');
    assert.ok(rendererSource.includes('addWatchedFolderButton'), 'renderer.js missing addWatchedFolderButton handler');
    assert.ok(rendererSource.includes('onWatchedFolderChange'), 'renderer.js missing onWatchedFolderChange listener');

    console.log('✓ Preload, HTML markup, CSS styling, and Renderer wiring verified.');
    console.log('\nAll Automatic Folder Watching verification checks passed cleanly (0 errors).');
  }
}

runAllTests()
  .catch((err) => {
    console.error('Folder watching check failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const root of tempRoots) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });
