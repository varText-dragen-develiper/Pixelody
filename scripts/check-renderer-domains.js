const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stateApi = require('../src/renderer-domains/state-controller');
const library = require('../src/renderer-domains/library-controller');
const navigation = require('../src/renderer-domains/navigation-controller');
const playback = require('../src/renderer-domains/playback-controller');
const diagnostics = require('../src/renderer-domains/diagnostics-controller');
const jam = require('../src/renderer-domains/jam-controller');
const appearance = require('../src/renderer-domains/appearance-controller');
const audio = require('../src/renderer-domains/audio-controller');

async function run() {
  assert.equal(library.parseDuration('1:02:03'), 3723);
  assert.equal(library.parseDuration(125000), 125);
  assert.deepEqual(library.parseCsvPlaylist('Title,Artist,Album\n"One, Two",Artist,Album')[0], {
    title: 'One, Two', artist: 'Artist', album: 'Album', path: '', duration: null, isrc: '', sourceUrl: '',
  });
  assert.equal(library.parseM3uPlaylist('#EXTM3U\n#EXTINF:42,Artist - Song\n..\\Song.flac', 'C:\\Music', (value) => value).at(0).path, 'C:\\Music\\..\\Song.flac');
  assert.equal(library.parseM3uPlaylist('#EXTM3U\n#EXTINF:42,Artist - Song\n../Song.flac', '/home/user/Music', (value) => value).at(0).path, '/home/user/Music/../Song.flac');
  assert.equal(library.flattenJsonTracks({ items: [{ track: { name: 'Nested', artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration_ms: 90000 } }] })[0].duration, 90);
  const localTrack = { id: 'private-id', path: 'C:\\Private\\Song.flac', title: 'Song', artist: 'Artist', album: 'Album', duration: 42, format: 'FLAC' };
  assert.equal(library.matchImportedTrack({ path: localTrack.path }, [localTrack]).confidence, 100);
  assert.equal(library.uniquePlaylistName('Mix', [{ name: 'Mix' }, { name: 'Mix 2' }]), 'Mix 3');

  assert.deepEqual(playback.buildQueue([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b'), ['b', 'c', 'a']);
  assert.deepEqual(playback.activeQueue(['b', 'gone', 'a'], [{ id: 'a' }, { id: 'b' }]).map((track) => track.id), ['b', 'a']);
  assert.equal(playback.linearAdjacent([{ id: 'a' }, { id: 'b' }], 'b', 1, { fromEnded: true, repeat: 'off' }), null);
  assert.deepEqual(playback.normalizeSession({ id: 'a', time: -3, volume: 4 }, ['a']), { id: 'a', time: 0, volume: 1 });

  let current = { view: 'library', settings: false };
  const restored = [];
  const navigationStates = [];
  const nav = navigation.createNavigationController({ capture: () => ({ ...current }), restore: (snapshot) => restored.push(snapshot), closeCurrent: () => { current.settings = false; }, notify: (value) => navigationStates.push(value) });
  nav.push();
  current.settings = true;
  nav.back();
  assert.deepEqual(restored[0], { view: 'library', settings: false });
  assert.equal(navigation.hasSurface(current), true);
  assert.equal(navigationStates.at(-1), true);

  assert.equal(diagnostics.average([1, '2', 'bad', 3]), 2);
  assert.equal(diagnostics.median([4, 1, 3, 2]), 2.5);
  assert.equal(diagnostics.standardDeviation([2, 2]), 0);
  assert.equal(diagnostics.formatBytes(1048576), '1.0 MB');
  assert.equal(diagnostics.gainRisk(true, 11, 3).label, 'High');
  let renderedSnapshot = null;
  const diagnosticsController = diagnostics.createDiagnosticsController({ buildSnapshot: () => ({ ok: true }), renderSnapshot: (value) => { renderedSnapshot = value; } });
  assert.deepEqual(diagnosticsController.render(), { ok: true });
  assert.deepEqual(renderedSnapshot, { ok: true });

  assert.equal(audio.clampNumber('14', -12, 12), 12);
  assert.equal(audio.optionalFiniteNumber(''), null);
  assert.ok(Math.abs(audio.decibelsToGain(6) - 1.995262) < 0.00001);
  assert.equal(audio.normalizeParametricBand({ frequency: 30000, q: 0, gain: -20 }, 1000, 0).frequency, 20000);
  const connected = [];
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const node = (kind) => ({ kind, connect(target) { connected.push([kind, target.kind || 'destination']); }, gain: parameter(), frequency: parameter(), Q: parameter(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() });
  const fakeContext = { destination: { kind: 'destination' }, createMediaElementSource: () => node('source'), createBiquadFilter: () => node('filter'), createGain: () => node('gain'), createChannelSplitter: () => node('splitter'), createChannelMerger: () => node('merger'), createDynamicsCompressor: () => node('limiter') };
  const graph = audio.buildAudioGraph(fakeContext, {}, [{ id: 'bass', type: 'lowshelf', frequency: 100 }], audio.parametricDefaults([60, 1000], 2));
  assert.equal(graph.eqNodes.length, 1);
  assert.equal(graph.parametricNodes.track.length, 2);
  assert.ok(connected.some(([from, to]) => from === 'limiter' && to === 'destination'));

  assert.equal(appearance.normalizeInterfaceSounds({ mode: 'invalid', volume: 3 }, { mode: 'subtle', volume: 0.2 }).mode, 'subtle');
  assert.equal(appearance.isLightColor('#ffffff'), true);
  assert.equal(appearance.isLightColor('#000000'), false);

  const snapshot = jam.buildSnapshot({ state: { tracks: [localTrack], playlists: [{ id: 'all', name: 'All Music', trackIds: [] }], favorites: ['private-id'], queue: ['private-id'], shuffle: false, repeat: 'off' }, currentTrack: localTrack, playback: { paused: false, currentTime: 10, duration: 42, volume: 0.7 }, platform: 'win32', now: 10000, audioProfiles: { speakerSystemDiagnostics: { state: 'ready', prototype: { unsafe: true }, nested: { constructor: 'blocked', keep: true } } } });
  assert.equal(snapshot.tracks[0].path, localTrack.path, 'private path must remain available to the main-process stream sanitizer');
  assert.deepEqual(snapshot.audioProfiles, { speakerSystemDiagnostics: { state: 'ready', nested: { keep: true } } }, 'network snapshots must omit prototype-pollution keys without dropping safe diagnostics');
  assert.deepEqual(jam.baseUrlCandidates({ remoteBaseUrl: 'http://host/', baseUrl: 'http://host', localBaseUrl: 'http://local/' }), ['http://host', 'http://local']);
  assert.equal(jam.activePairing({ expiresAt: '2020-01-01T00:00:00.000Z' }, Date.now()), null);

  const writes = [];
  const migrations = [];
  let scheduled = null;
  const controller = stateApi.createStateController({
    desktop: {
      saveStateSnapshot: async (values, options) => { writes.push({ values, options }); return { ok: true, status: 'committed', state: { revision: 2 } }; },
      migrateLegacyState: async (values, malformed) => { migrations.push({ values, malformed }); return { ok: true, status: 'committed', state: { revision: 1 } }; },
    },
    initialLoad: { status: 'fresh', needsLegacyMigration: true, readOnly: false },
    getValues: () => ({ queue: ['a'] }),
    malformedLegacyKeys: ['bad'],
    clock: (() => { let value = 0; return () => ++value; })(),
    now: () => new Date('2026-07-20T00:00:00.000Z'),
    timers: { setTimeout: (callback) => { scheduled = callback; return 1; }, clearTimeout: () => {} },
  });
  await controller.initialize();
  assert.deepEqual(migrations[0].malformed, ['bad']);
  controller.schedule(10, 'test-write');
  scheduled();
  await controller.flush();
  assert.equal(writes.at(-1).options.reason, 'flush-persist');
  assert.equal(controller.runtime.revision, 2);

  {
    // Bursts collapse: while a snapshot is in flight, any number of requests
    // produce exactly one follow-up snapshot carrying the newest values.
    const sent = [];
    const resolvers = [];
    let version = 0;
    const coalescing = stateApi.createStateController({
      desktop: { saveStateSnapshot: (values, options) => { sent.push({ values, reason: options.reason }); return new Promise((resolve) => resolvers.push(() => resolve({ ok: true, status: 'committed', state: { revision: sent.length } }))); } },
      initialLoad: { status: 'ready', readOnly: false },
      getValues: () => ({ version }),
      timers: { setTimeout: () => 1, clearTimeout: () => {} },
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    version = 1;
    const first = coalescing.enqueue('first');
    await settle();
    assert.equal(sent.length, 1, 'an idle controller sends immediately');
    const burst = [];
    for (let index = 2; index <= 6; index += 1) { version = index; burst.push(coalescing.enqueue(`burst-${index}`)); }
    assert.equal(new Set(burst).size, 1, 'requests during an in-flight write share one follow-up');
    assert.equal(coalescing.pending(), true, 'a queued follow-up counts as pending work for unload flushing');
    assert.equal(coalescing.runtime.coalescedWrites, 4);
    resolvers.shift()();
    await first;
    await settle();
    assert.equal(sent.length, 2, 'exactly one follow-up snapshot is sent for the burst');
    assert.deepEqual(sent[1].values, { version: 6 }, 'the follow-up captures the newest state when it starts');
    assert.equal(sent[1].reason, 'coalesced-persist', 'requests with different reasons combine under a reason that covers all of them');
    resolvers.shift()();
    assert.equal((await burst[0]).ok, true);
    assert.equal(coalescing.runtime.revision, 2);

    // flush() must not wait behind an in-flight write: queued work would not
    // survive window unload. It also retires any queued follow-up.
    version = 7;
    coalescing.enqueue('before-close');
    await settle();
    version = 8;
    const orphan = coalescing.enqueue('queued');
    version = 9;
    const closing = coalescing.flush('flush-persist');
    await settle();
    assert.equal(sent.length, 4, 'flush sends its snapshot while the earlier write is still in flight');
    assert.deepEqual(sent[3].values, { version: 9 });
    resolvers.shift()();
    resolvers.shift()();
    await Promise.all([closing, orphan]);
    await settle();
    assert.equal(sent.length, 4, 'a follow-up superseded by flush is not sent again');

    // suspend() stops everything, including a queued follow-up.
    coalescing.enqueue('in-flight');
    await settle();
    coalescing.enqueue('would-overwrite-restore');
    coalescing.suspend();
    coalescing.schedule(0, 'after-suspend');
    resolvers.shift()();
    await settle();
    await settle();
    assert.equal(sent.length, 5, 'no snapshot is sent after suspend');
    assert.equal(coalescing.flush('flush-persist') instanceof Promise, true);
    await settle();
    assert.equal(sent.length, 5, 'flush after suspend is a no-op');
  }

  {
    // getValues(reason) may trim frequent saves. Whenever requests are
    // combined (a re-scheduled timer, a coalesced follow-up, a flush), the
    // write must still carry everything the widest request needed.
    const trimmedReasons = new Set(['playback-session-position', 'settings-change']);
    const sent = [];
    const resolvers = [];
    let scheduledCallback = null;
    const merging = stateApi.createStateController({
      desktop: { saveStateSnapshot: (values, options) => { sent.push({ keys: Object.keys(values), reason: options.reason }); return new Promise((resolve) => resolvers.push(() => resolve({ ok: true, status: 'committed', state: { revision: sent.length } }))); } },
      initialLoad: { status: 'ready', readOnly: false },
      getValues: (reason) => (trimmedReasons.has(reason) ? { session: 1 } : { library: [1, 2], session: 1 }),
      mergeReasons: (pending, next) => (!pending || pending === next ? next : trimmedReasons.has(next) && !trimmedReasons.has(pending) ? pending : next),
      timers: { setTimeout: (callback) => { scheduledCallback = callback; return 1; }, clearTimeout: () => {} },
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    merging.schedule(0, 'core-state-persist');
    merging.schedule(180, 'playback-session-position');
    scheduledCallback();
    await settle();
    assert.deepEqual(sent[0], { keys: ['library', 'session'], reason: 'core-state-persist' }, 'a trimmed re-schedule must not replace a pending full save');
    assert.equal(merging.runtime.lastWriteReason, 'core-state-persist');
    assert.equal(merging.runtime.lastWriteBytes, JSON.stringify({ library: [1, 2], session: 1 }).length * 2, 'write size diagnostics match a full serialization');
    assert.equal(merging.runtime.lastWriteLargestKey, 'library');

    merging.enqueue('core-state-persist');
    merging.enqueue('settings-change');
    resolvers.shift()();
    await settle();
    await settle();
    assert.deepEqual(sent[1].keys, ['library', 'session'], 'a coalesced follow-up keeps the full payload a queued library save needs');

    merging.schedule(0, 'settings-change');
    merging.schedule(0, 'playback-session-position');
    scheduledCallback();
    await settle();
    assert.equal(sent.length, 2, 'queued behind the in-flight write');
    const closing = merging.flush('flush-persist');
    await settle();
    assert.deepEqual(sent[2].keys, ['library', 'session'], 'flush sends a full snapshot');
    resolvers.splice(0).forEach((resolve) => resolve());
    await closing;

    const defaults = stateApi.createStateController({
      desktop: { saveStateSnapshot: (values, options) => { sent.push({ keys: Object.keys(values), reason: options.reason }); return Promise.resolve({ ok: true }); } },
      initialLoad: { status: 'ready', readOnly: false },
      getValues: (reason) => (trimmedReasons.has(reason) ? { session: 1 } : { library: [1, 2], session: 1 }),
      timers: { setTimeout: (callback) => { scheduledCallback = callback; return 1; }, clearTimeout: () => {} },
    });
    defaults.schedule(0, 'core-state-persist');
    defaults.schedule(0, 'playback-session-position');
    scheduledCallback();
    await settle();
    assert.deepEqual(sent.at(-1).keys, ['library', 'session'], 'without a merge rule, differing reasons combine into a full snapshot');
  }


  {
    // resume() undoes suspend() when the guarded operation did not happen, so a
    // refused restore does not leave the window silently unable to save.
    const sent = [];
    const resumable = stateApi.createStateController({
      desktop: { saveStateSnapshot: (values, options) => { sent.push(options.reason); return Promise.resolve({ ok: true }); } },
      initialLoad: { status: 'ready', readOnly: false },
      getValues: () => ({ version: 1 }),
      timers: { setTimeout: () => 1, clearTimeout: () => {} },
    });
    resumable.suspend();
    await resumable.enqueue('while-suspended');
    assert.deepEqual(sent, [], 'nothing is sent while suspended');
    resumable.resume();
    await resumable.enqueue('after-resume');
    assert.deepEqual(sent, ['after-resume'], 'saving works again after resume');
  }

  const nativeSetTimeout = global.setTimeout;
  const nativeClearTimeout = global.clearTimeout;
  let defaultScheduled = null;
  try {
    global.setTimeout = function receiverSensitiveSetTimeout(callback) {
      if (this && this !== global) throw new TypeError('Illegal invocation');
      defaultScheduled = callback;
      return 7;
    };
    global.clearTimeout = function receiverSensitiveClearTimeout() {
      if (this && this !== global) throw new TypeError('Illegal invocation');
    };
    const browserTimerController = stateApi.createStateController({
      initialLoad: { status: 'fresh', readOnly: false },
    });
    browserTimerController.schedule(10, 'browser-timer-contract');
    assert.equal(typeof defaultScheduled, 'function', 'default timers must remain callable with browser receiver rules');
  } finally {
    global.setTimeout = nativeSetTimeout;
    global.clearTimeout = nativeClearTimeout;
  }

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  for (const name of ['state', 'library', 'navigation', 'playback', 'diagnostics', 'jam', 'appearance', 'audio']) assert.ok(indexSource.includes(`renderer-domains/${name}-controller.js`), `${name} controller is not loaded`);
  for (const globalName of ['PixelodyStateController', 'PixelodyLibraryController', 'PixelodyNavigationController', 'PixelodyPlaybackController', 'PixelodyDiagnosticsController', 'PixelodyJamController', 'PixelodyAppearanceController', 'PixelodyAudioController']) assert.ok(rendererSource.includes(globalName), `${globalName} is not wired into renderer composition`);
  assert.ok(!rendererSource.includes('function qrGaloisTables'), 'unused hand-written QR implementation returned');
  console.log('Renderer domain audit passed: state, library, navigation, playback, diagnostics, J.A.M., appearance, and audio contracts are deterministic and loaded before composition.');
}

let completed = false;
// A never-settling promise drains the event loop and would otherwise exit 0.
process.on('exit', () => {
  if (!completed && !process.exitCode) {
    console.error('Renderer domain audit did not complete: an awaited promise never settled.');
    process.exitCode = 1;
  }
});
run().then(() => { completed = true; }, (error) => { console.error(error); process.exitCode = 1; });
