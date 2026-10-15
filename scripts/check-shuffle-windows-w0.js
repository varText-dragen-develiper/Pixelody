'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const engine = require('../src/flow-shuffle-engine');
const planner = require('../src/flow-shuffle-planner');
const decision = require('../src/flow-shuffle-decision');
const learning = require('../src/flow-shuffle-learning');
const acoustic = require('../src/flow-shuffle-acoustic');
const jamLearning = require('../src/jam-learning-contract');
const playback = require('../src/renderer-domains/playback-controller');
const audioDomain = require('../src/renderer-domains/audio-controller');
const confirmed = require('../src/renderer-domains/confirmed-output-transition');
const listening = require('../src/renderer-domains/listening-intervals');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src', 'renderer.js');
const renderer = fs.readFileSync(rendererPath, 'utf8').replace(/\r\n/g, '\n');
const copy = (value) => JSON.parse(JSON.stringify(value));

// Evaluate unchanged renderer declarations without its application bootstrap.
// Boundaries follow its top-level indentation. Assertions below observe executed
// behavior; matching source text never establishes correctness.
function declaration(name) {
  const start = renderer.search(new RegExp(`^(?:async )?function ${name}\\s*\\(`, 'm'));
  assert.ok(start >= 0, `Missing production renderer declaration: ${name}`);
  const lineEnd = renderer.indexOf('\n', start);
  if (renderer.slice(start, lineEnd).trimEnd().endsWith('}')) return renderer.slice(start, lineEnd);
  const close = /\n\}(?=\n|$)/g;
  close.lastIndex = start;
  const end = close.exec(renderer);
  assert.ok(end, `Missing closing boundary for renderer declaration: ${name}`);
  return renderer.slice(start, end.index + 2);
}
const declarations = [...renderer.matchAll(/^(?:async )?function ([\w$]+)\s*\(/gm)]
  .map((match) => declaration(match[1])).join('\n');

function productionConstant(name) {
  const start = renderer.indexOf(`const ${name} = `);
  const end = renderer.indexOf('\n};', start);
  assert.ok(start >= 0 && end >= 0, `Missing production renderer constant: ${name}`);
  return renderer.slice(start, end + 3);
}

function fixtureTracks(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${index}`, title: `Fixture ${index}`, artist: `Artist ${index}`,
    album: `Album ${index}`, albumArtist: `Artist ${index}`, genre: index % 2 ? 'Jazz' : 'Ambient',
    bpm: 110 + index * 4, energyLevel: 40 + index * 4, musicalKey: ['C', 'G', 'D', 'A', 'E'][index % 5],
    duration: 180, format: 'WAV', path: `/generated/fixture-${index}.wav`,
  }));
}

function createHarness(options = {}) {
  const tracks = copy(options.tracks || fixtureTracks(options.count || 5));
  const queue = options.queue || tracks.map((track) => track.id);
  const currentId = options.currentId || queue[0];
  const state = {
    tracks, queue: [...queue], index: tracks.findIndex((track) => track.id === currentId),
    shuffle: options.style !== 'off', shuffleStyle: options.style || 'standard', repeat: options.repeat || 'off',
    history: [], playCounts: {}, favorites: [],
    signalSettings: { enabled: true, useForShuffle: true, useSkipBehavior: true, useTimeOfDay: false },
    signalJournal: { version: 1, events: [], trackStats: {}, lastSignal: null, lastShuffle: null },
    flowShuffle: engine.resetPlan({}, queue, currentId, { style: options.style === 'flow' ? 'flow' : 'standard', seed: options.seed || 'windows-w0-five-track' }),
  };
  const nodes = new Map();
  let rows = [];
  function node(selector) {
    if (nodes.has(selector)) return nodes.get(selector);
    const classes = new Set();
    const attributes = new Map();
    const element = {
      style: {}, dataset: {}, textContent: '',
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); },
      },
      setAttribute(name, value) { attributes.set(name, value); }, removeAttribute(name) { attributes.delete(name); },
    };
    let html = '';
    Object.defineProperty(element, 'innerHTML', {
      get() { return html; },
      set(value) {
        html = String(value);
        if (selector === '#queueList') {
          rows = [...html.matchAll(/class="queue-item [^"]*"[^>]*data-id="([^"]+)"/g)].map((match, index) => {
            const item = node(`queue-row-${index}`);
            item.dataset.id = match[1];
            return item;
          });
        }
      },
    });
    nodes.set(selector, element);
    return element;
  }
  const persisted = new Map();
  const saves = [];
  const mediaListeners = new Map();
  const media = { available: true, contextAvailable: true, rejectPlay: false, playGate: null, playCalls: 0, monotonicMs: 1000, lastPlay: null };
  const audio = {
    src: '', currentSrc: '', paused: true, ended: false, playbackRate: 1, currentTime: 0, duration: 180,
    pause() { this.paused = true; }, load() { this.currentSrc = this.src; this.currentTime = 0; this.ended = false; },
    addEventListener(event, listener) {
      if (!mediaListeners.has(event)) mediaListeners.set(event, []);
      mediaListeners.get(event).push(listener);
    },
  };
  const context = vm.createContext({
    console, state, audio, audioDomain, Map, Set, URL, performance: { now: () => media.monotonicMs }, Date, Math,
    clampNumber: audioDomain.clampNumber, optionalFiniteNumber: audioDomain.optionalFiniteNumber,
    flowShuffleEngine: engine, flowShufflePlanner: planner, flowShuffleDecision: decision,
    flowShuffleLearning: learning, flowShuffleAcoustic: acoustic, jamLearningContract: jamLearning, playbackDomain: playback,
    flowShuffleRuntime: { pending: null, controlUndo: null },
    signalRuntime: { sessionId: 'windows-w0-session', currentPlay: null, pendingShufflePick: null },
    signalJournalPersistTimer: 0,
    signalListeningTracker: listening.createTracker({ now: () => media.monotonicMs }), universalShuffleController: null,
    SIGNAL_EVENT_LIMIT: 1500, QUEUE_RENDER_STEP: 200, QUEUE_RENDER_LEAD: 5, queueRenderLimit: 200,
    trackIndexSource: null, trackIndexLength: -1, trackIndexById: new Map(),
    trackPlayRequestSerial: 0, lastTrackPlayRequestAt: 0,
    trackBrowserActivationPendingId: null, trackBrowserActivationFailedId: null,
    calibrationState: { active: false }, diagnosticsState: {}, appearance: { theme: 'studio' },
    singularityLiveHost: null, questEncounterRareKey: '',
    window: { desktop: { fileUrl: (file) => `fixture:${file}`, exists: async () => media.available, optimizeArtwork: async (file) => file } },
    document: { querySelectorAll: (selector) => selector === '#queueList .queue-item' ? rows : [] },
    setTimeout, clearTimeout, $: node,
  });
  vm.runInContext(`${declarations}\n${productionConstant('flowShuffleModes')}\nconst currentTrack = () => state.tracks[state.index];`, context, { filename: rendererPath });

  // Peripheral boundaries only. Selection, receipt creation, confirmed-output
  // commit, signal event creation/normalization and queue drawing remain production.
  const peripherals = [
    'syncConfirmedPublishedFromMedia', 'observeConfirmedOutputTransition', 'restoreRetainedConfirmedMedia',
    'stopCalibrationPreview', 'resetQuestStreak', 'resetPlaybackTransition', 'clearSecondarySpeakerOutputElements',
    'syncLegacyPlaybackClass', 'startPlaybackMonitor', 'startQuestStatsTicker', 'syncInterfaceSoundEngine',
    'syncThemePreloader', 'updateFlowShuffleUi', 'updateSignalJournalUi', 'updateTrackIntelligenceFields',
    'triggerThemeAction', 'updateMemeCue', 'triggerCrystalRefractionFlash', 'syncPlayVisual',
    'syncQuestOutputModule', 'syncQuestRareCue', 'questEncounterToast', 'publishMediaSessionMetadata',
    'updateSignalMetadataFields', 'syncNavigationState', 'syncEqControls', 'applyEq', 'updateCalibrationUi',
    'renderTracks', 'setOutputStatus', 'broadcastPlayerState', 'showToast', 'updateDiagnostics', 'refreshMemeOnScreenUpdate',
    'stopPlaybackMonitor', 'syncTrackBrowserAuthoritativeState', 'stopQuestStatsTicker', 'setQuestBootMessage', 'scheduleSharingSnapshot',
    'mirrorPrimaryPlaybackStateToSecondaries', 'syncQuestBossBar', 'syncQuestMiniMap',
  ];
  for (const name of peripherals) context[name] = () => undefined;
  context.persist = () => saves.push(copy({ queue: state.queue, flowShuffle: state.flowShuffle, signalJournal: state.signalJournal }));
  context.setLocalStorageItem = (key, value) => { persisted.set(key, value); return true; };
  context.resumeAudioContext = async () => media.contextAvailable;
  context.abortActiveRigCalibration = async () => undefined;
  context.confirmedOutputUiSnapshot = () => ({});
  context.confirmedOutputTransitionRuntime = confirmed.createConfirmedOutputTransition({ activeId: currentId, now: () => 1000 });
  context.confirmedPublishedOutputSnapshot = () => ({ ...context.confirmedOutputTransitionRuntime.snapshot().published, track: state.tracks[state.index] });
  context.issueSharedPlaybackCommand = async (_action, _payload, run) => run?.();
  context.playPrimaryAudio = async () => {
    media.playCalls += 1;
    if (media.playGate) await media.playGate;
    if (media.rejectPlay) throw new Error('Generated decoder rejection');
    audio.paused = false;
  };
  context.syncCurrentTrackTechnicalReadout = () => 'WAV';
  context.questRareCueFor = () => null;
  context.isHiRes = () => false;
  context.isLossless = () => true;
  context.durationText = (seconds) => String(seconds);
  context.visibleTracks = () => [...tracks];
  context.libraryBatchDomain = { describeCount: (count) => `${count} tracks` };
  const productionPlayTrack = context.playTrack;
  context.playTrack = (...args) => { media.lastPlay = productionPlayTrack(...args); return media.lastPlay; };
  for (const name of ['onended', 'onpause', 'onplay', 'onseeked']) {
    const start = renderer.indexOf(`audio.${name} = `);
    const lineEnd = renderer.indexOf('\n', start);
    const end = renderer.slice(start, lineEnd).endsWith('};') ? lineEnd - 3 : renderer.indexOf('\n};', start);
    assert.ok(start >= 0 && end >= 0, `Missing production audio ${name} binding`);
    vm.runInContext(renderer.slice(start, end + 3), context, { filename: rendererPath });
  }
  const mediaBindingStart = renderer.indexOf("audio.addEventListener('seeking',");
  const mediaBindingEnd = renderer.indexOf('\nlet lastAudibleVolume', mediaBindingStart);
  assert.ok(mediaBindingStart >= 0 && mediaBindingEnd >= 0, 'Missing production listening media event bindings');
  vm.runInContext(renderer.slice(mediaBindingStart, mediaBindingEnd), context, { filename: rendererPath });
  const queueHandlerStart = renderer.indexOf("$('#queueList').onclick = (event) => {");
  assert.ok(queueHandlerStart >= 0, 'Missing production queue click binding');
  const queueHandlerEnd = renderer.indexOf('\n};', queueHandlerStart);
  vm.runInContext(renderer.slice(queueHandlerStart, queueHandlerEnd + 3), context, { filename: rendererPath });
  const trackHandlerStart = renderer.indexOf("$('#trackMenu').onclick = (event) => {");
  assert.ok(trackHandlerStart >= 0, 'Missing production track menu click binding');
  const trackHandlerEnd = renderer.indexOf('\n};', trackHandlerStart);
  vm.runInContext(renderer.slice(trackHandlerStart, trackHandlerEnd + 3), context, { filename: rendererPath });
  context.closeTrackMenu = () => undefined;

  function select(offset = 1, fromEnded = true) { return context.adjacentTrack(offset, fromEnded); }
  async function activate(track, playOptions = {}) {
    assert.ok(track, 'Activation requires a production selection');
    await context.playTrack(track.id, playOptions);
    return state.tracks[state.index]?.id;
  }
  async function advance(offset = 1, fromEnded = true) {
    if (offset > 0 && fromEnded) {
      media.lastPlay = null;
      audio.ended = true;
      audio.paused = true;
      await audio.onended();
      if (!media.lastPlay) return null;
      await media.lastPlay;
      return state.tracks[state.index]?.id;
    }
    const played = await context.requestPlaybackTraversal(offset < 0 ? 'previous' : 'next', { naturalEnd: fromEnded });
    return played ? state.tracks[state.index]?.id : null;
  }
  function queueOrder() {
    context.renderQueue();
    return rows.map((item) => decodeURIComponent(item.dataset.id));
  }
  function persistedJournal() {
    return context.normalizeSignalJournal(JSON.parse(persisted.get('pixelody.signalJournal') || '{}'));
  }
  function queueClick(id, action) {
    node('#queueList').onclick({ target: {
      dataset: { queueAction: action },
      closest: (selector) => selector === '.queue-item' ? { dataset: { id: encodeURIComponent(id) } } : null,
    } });
  }
  function dispatchMedia(event) {
    audio[`on${event}`]?.();
    for (const listener of mediaListeners.get(event) || []) listener();
  }
  function tick(seconds = 1, mediaSeconds = seconds * audio.playbackRate) {
    media.monotonicMs += seconds * 1000;
    audio.currentTime += mediaSeconds;
    return context.sampleSignalListening();
  }
  return { context, state, media, audio, nodes, saves, persisted, select, activate, advance, queueOrder, persistedJournal, queueClick, dispatchMedia, tick };
}

async function suite(name, tests, options = {}) {
  const results = [];
  for (const [testName, run] of tests) {
    try {
      const detail = await run();
      results.push({ name: testName, passed: true, detail: detail || null });
      console.log(`PASS ${testName}`);
    } catch (error) {
      results.push({ name: testName, passed: false, error: error.message, stack: error.stack });
      console.error(`FAIL ${testName}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  const files = ['src/renderer.js', 'src/flow-shuffle-engine.js', 'src/flow-shuffle-planner.js', 'src/flow-shuffle-decision.js', 'src/flow-shuffle-learning.js', 'src/jam-learning-contract.js', 'src/renderer-domains/audio-controller.js', 'src/renderer-domains/listening-intervals.js', 'src/renderer-domains/playback-controller.js', 'src/renderer-domains/confirmed-output-transition.js', 'scripts/check-shuffle-windows-w0.js', 'scripts/check-flow-shuffle-renderer.js'];
  const report = {
    schema: 'pixelody.shuffle.windows-w0-receipt', version: 1, suite: name,
    createdAt: new Date().toISOString(), cwd: process.cwd(), node: process.version,
    evidence: 'Production renderer declarations executed in VM with generated metadata and controlled media/DOM boundaries; no Electron, audible-output or installed-profile claim.',
    source: Object.fromEntries(files.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
    passed: results.every((result) => result.passed), results,
  };
  if (options.receipt) {
    const output = path.resolve(root, options.receipt);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`${name}: ${results.filter((result) => result.passed).length}/${results.length} passed.`);
  return report;
}

function assertProjection(harness) {
  const order = harness.queueOrder();
  const current = harness.state.tracks[harness.state.index].id;
  const next = harness.select(1, true);
  assert.equal(order[order.indexOf(current) + 1], next?.id, 'Queue row after current must be transport target');
  return order;
}

async function runW0(options = {}) {
  return suite('Windows W0 production regressions', [
    ['five-track Standard retains style and exhausts repeat off', async () => {
      const h = createHarness();
      const expected = copy(h.state.flowShuffle.plan.order);
      const heard = [h.state.tracks[h.state.index].id];
      while (heard.length < 5) {
        heard.push(await h.advance());
        assert.equal(h.state.flowShuffle.plan.style, 'standard', 'Successful activation must retain Standard');
      }
      assert.deepEqual(heard, expected);
      assert.equal(new Set(heard).size, 5);
      assert.equal(h.select(1, true), null);
      assert.equal(h.select(1, false), null, 'Manual Next respects repeat-off exhaustion');
      return { expected, heard, cycle: copy(h.state.flowShuffle.cycle) };
    }],
    ['Standard repeat all starts exactly one generation after exhaustion', async () => {
      const h = createHarness({ repeat: 'all' });
      const generation = h.state.flowShuffle.plan.generation;
      const heard = [h.state.tracks[h.state.index].id];
      for (let index = 0; index < 4; index += 1) {
        heard.push(await h.advance());
        assert.equal(h.state.flowShuffle.plan.generation, generation);
      }
      assert.equal(new Set(heard).size, 5);
      heard.push(await h.advance());
      assert.equal(h.state.flowShuffle.plan.generation, generation + 1);
      assert.notEqual(heard[4], heard[5]);
      return { heard, generation: h.state.flowShuffle.plan.generation };
    }],
    ['Standard Previous then Next follows retained successful history', async () => {
      const h = createHarness();
      const first = await h.advance();
      const second = await h.advance();
      const before = copy(h.state.flowShuffle.plan.order);
      assert.equal(await h.advance(-1, false), first);
      assert.equal(await h.advance(1, false), second);
      assert.deepEqual(copy(h.state.flowShuffle.plan.order), before);
      return { first, second, order: before };
    }],
    ['unresolved activation does not consume Standard selection', async () => {
      const h = createHarness();
      const track = h.select();
      const before = copy(h.state.flowShuffle);
      let release;
      h.media.playGate = new Promise((resolve) => { release = resolve; });
      const playing = h.activate(track);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(copy(h.state.flowShuffle), before);
      assert.equal(h.state.signalJournal.events.filter((event) => event.type === 'shuffle_pick').length, 0);
      release();
      await playing;
      assert.equal(h.state.tracks[h.state.index].id, track.id);
      assert.equal(h.state.flowShuffle.plan.cursor, 1);
    }],
    ...['missing', 'context', 'decode'].map((failure) => [`${failure} activation failure preserves Standard entitlement and journal`, async () => {
      const h = createHarness();
      await h.activate(h.state.tracks[h.state.index]);
      const activeOccurrence = h.context.signalRuntime.currentPlay.occurrenceId;
      const track = h.select();
      const before = copy(h.state.flowShuffle);
      const current = h.state.tracks[h.state.index].id;
      if (failure === 'missing') h.media.available = false;
      if (failure === 'context') h.media.contextAvailable = false;
      if (failure === 'decode') h.media.rejectPlay = true;
      await h.activate(track);
      assert.equal(h.state.tracks[h.state.index].id, current);
      assert.deepEqual(copy(h.state.flowShuffle), before);
      assert.equal(h.state.signalJournal.events.filter((event) => event.type === 'shuffle_pick').length, 0);
      assert.equal(h.state.signalJournal.events.filter((event) => event.type === 'track_skipped').length, 0);
      assert.equal(h.context.signalRuntime.currentPlay.occurrenceId, activeOccurrence);
      assert.equal(h.context.flowShuffleRuntime.pending, null);
      return { failure, retainedTrack: current, requestedTrack: track.id };
    }]),
    ['repeat-all failed activation cannot advance generation or lose the exhausted cycle', async () => {
      const h = createHarness({ repeat: 'all' });
      for (let index = 0; index < 4; index += 1) await h.advance();
      const before = copy(h.state.flowShuffle);
      const track = h.select();
      assert.deepEqual(copy(h.state.flowShuffle), before);
      h.media.rejectPlay = true;
      await h.activate(track);
      assert.deepEqual(copy(h.state.flowShuffle), before);
      return { generation: before.plan.generation, cycle: before.cycle, failedTrack: track.id };
    }],
    ['Standard actual journal retains origin occurrence and unweighted decision through persistence', async () => {
      const h = createHarness();
      const origin = h.state.tracks[h.state.index];
      await h.activate(origin);
      const originEvent = h.state.signalJournal.events.find((event) => event.type === 'track_started');
      const target = h.select();
      const pending = copy(h.context.flowShuffleRuntime.pending);
      assert.equal(pending.fromOccurrenceId, originEvent.occurrenceId);
      await h.activate(target);
      const event = h.persistedJournal().events.find((item) => item.type === 'shuffle_pick');
      assert.equal(event.fromTrackId, origin.id);
      assert.equal(event.fromTrackTitle, origin.title);
      assert.equal(event.fromOccurrenceId, originEvent.occurrenceId);
      assert.ok(event.occurrenceId);
      assert.notEqual(event.occurrenceId, originEvent.occurrenceId);
      assert.deepEqual(copy(event.decision), pending.decision);
      assert.deepEqual(copy(event.decision.availableSignals), []);
      assert.equal(event.style, 'standard');
      return { origin: event.fromTrackId, fromOccurrenceId: event.fromOccurrenceId, occurrenceId: event.occurrenceId, decision: event.decision };
    }],
    ['superseded delayed play callback cannot consume stale Standard reservation', async () => {
      const h = createHarness();
      const staleTrack = h.select();
      const stalePending = h.context.flowShuffleRuntime.pending;
      let release;
      h.media.playGate = new Promise((resolve) => { release = resolve; });
      const stalePlay = h.activate(staleTrack);
      await new Promise((resolve) => setImmediate(resolve));
      const intended = h.state.tracks.find((track) => track.id !== staleTrack.id && track.id !== h.state.tracks[h.state.index].id);
      h.context.handleRemoteQueueCommand({ action: 'addnext', trackId: intended.id });
      h.media.playGate = null;
      await h.activate(h.select());
      const committed = copy(h.state.flowShuffle);
      release();
      await stalePlay;
      h.context.commitStagedFlowShufflePlayback(staleTrack, stalePending);
      assert.equal(h.state.tracks[h.state.index].id, intended.id);
      assert.deepEqual(copy(h.state.flowShuffle), committed);
      assert.equal(h.state.flowShuffle.cycle.includes(staleTrack.id), false);
      assert.equal(h.state.signalJournal.events.filter((event) => event.type === 'shuffle_pick').length, 1);
      return { ignored: staleTrack.id, committed: intended.id };
    }],
    ['duplicate commit of a successful real reservation is idempotent', async () => {
      const h = createHarness();
      const track = h.select();
      const pending = h.context.flowShuffleRuntime.pending;
      await h.activate(track);
      const before = copy(h.state);
      h.context.commitStagedFlowShufflePlayback(track, pending);
      assert.deepEqual(copy(h.state), before);
    }],
    ['repeat one replays as a new heard occurrence and manual Next bypasses it', async () => {
      const h = createHarness({ repeat: 'one' });
      await h.activate(h.state.tracks[h.state.index]);
      const before = copy(h.state.flowShuffle);
      const original = h.context.signalRuntime.currentPlay.occurrenceId;
      const current = h.state.tracks[h.state.index].id;
      assert.equal(await h.advance(), current);
      assert.notEqual(h.context.signalRuntime.currentPlay.occurrenceId, original);
      assert.deepEqual(copy(h.state.flowShuffle), before);
      assert.notEqual(await h.advance(1, false), current);
    }],
    ...['standard', 'flow', 'off'].map((style) => [`${style} queue painting matches authoritative next traversal`, async () => {
      const h = createHarness({ style });
      if (style === 'flow') h.select();
      const order = assertProjection(h);
      const next = h.select();
      await h.activate(next);
      return { order, activated: next.id };
    }]),
    ...['standard', 'flow', 'off'].map((style) => [`${style} Play Next supersedes generated future and appears next`, async () => {
      const h = createHarness({ style });
      const generated = h.select();
      const intended = h.state.tracks.find((track) => track.id !== generated?.id && track.id !== h.state.tracks[h.state.index].id);
      assert.equal(h.context.handleRemoteQueueCommand({ action: 'addnext', trackId: intended.id }), true);
      assert.equal(h.select()?.id, intended.id);
      assertProjection(h);
      await h.activate(h.select());
      assert.equal(h.state.tracks[h.state.index].id, intended.id);
      return { replaced: generated?.id, intended: intended.id };
    }]),
    ...['standard', 'flow', 'off'].map((style) => [`${style} track menu Play Next repositions an already queued track`, async () => {
      const h = createHarness({ style });
      const generated = h.select();
      const intended = h.state.tracks.find((track) => track.id !== generated?.id && track.id !== h.state.tracks[h.state.index].id);
      h.state.menuTrackId = intended.id;
      h.nodes.get('#trackMenu').onclick({ target: { dataset: { trackAction: 'next' } } });
      assert.equal(h.select()?.id, intended.id);
      assertProjection(h);
      assert.equal(await h.advance(1, false), intended.id);
    }]),
    ...['standard', 'flow', 'off'].map((style) => [`${style} selection Play Next preserves selected order for queued tracks`, async () => {
      const h = createHarness({ style });
      h.select();
      const intended = h.state.tracks.slice(-2).map((track) => track.id).reverse();
      h.context.queueTracks(intended, { next: true });
      assert.equal(h.select()?.id, intended[0]);
      assertProjection(h);
      assert.equal(await h.advance(1, false), intended[0]);
      assert.equal(await h.advance(1, false), intended[1]);
    }]),
    ['remote session controls use the requested track and acknowledge valid actions', async () => {
      const h = createHarness({ style: 'flow' });
      const intended = h.state.tracks[3];
      assert.equal(await h.context.handleRemotePlaybackCommand({ action: 'not-session', trackId: intended.id }), true);
      assert.equal(h.state.flowShuffle.sessionExcludedIds.includes(intended.id), true);
      assert.equal(await h.context.handleRemotePlaybackCommand({ action: 'less-like', trackId: intended.id }), true);
      assert.equal(await h.context.handleRemotePlaybackCommand({ action: 'not-session', trackId: 'missing' }), false);
    }],
    ['remote direct playback reports failed activation without a new learning outcome', async () => {
      const h = createHarness();
      await h.activate(h.state.tracks[0]);
      h.tick();
      const before = copy(h.state.signalJournal);
      h.media.rejectPlay = true;
      assert.equal(await h.context.handleRemotePlaybackCommand({ action: 'playtrack', trackId: h.state.tracks[2].id }), false);
      assert.equal(h.state.index, 0);
      assert.deepEqual(copy(h.state.signalJournal), before);
    }],
    ...['standard', 'flow', 'off'].map((style) => [`${style} manual future move changes transport and rendered order`, async () => {
      const h = createHarness({ style });
      const generated = h.select();
      const intended = h.state.tracks.find((track) => track.id !== generated?.id && track.id !== h.state.tracks[h.state.index].id);
      assert.equal(h.context.handleRemoteQueueCommand({ action: 'movetrack', trackId: intended.id, toIndex: 1 }), true);
      assert.equal(h.select()?.id, intended.id);
      return { intended: intended.id, order: assertProjection(h) };
    }]),
    ...['standard', 'flow', 'off'].map((style) => [`${style} actual queue Move Up click changes the next transport target`, async () => {
      const h = createHarness({ style });
      if (style === 'flow') h.select();
      const order = h.queueOrder();
      const intended = order[2];
      h.queueClick(intended, 'up');
      assert.equal(h.select()?.id, intended);
      return { intended, order: assertProjection(h) };
    }]),
  ], options);
}

async function runFlow(options = {}) {
  return suite('Flow renderer production lifecycle', [
    ['Flow real planner stages a decision and successful play creates journal evidence', async () => {
      const h = createHarness({ style: 'flow' });
      const origin = h.state.tracks[h.state.index];
      const track = h.select();
      const pending = copy(h.context.flowShuffleRuntime.pending);
      assert.equal(h.state.signalJournal.events.length, 0);
      assert.equal(h.state.flowShuffle.cycle.includes(track.id), false);
      assert.equal(pending.decision.trackId, track.id);
      assert.equal(pending.decision.fromTrackId, origin.id);
      await h.activate(track);
      const event = h.state.signalJournal.events.find((item) => item.type === 'shuffle_pick');
      assert.ok(event, 'Successful production playback must record shuffle_pick');
      assert.equal(event.fromTrackId, origin.id);
      assert.equal(event.fromTrackTitle, origin.title);
      assert.deepEqual(copy(event.decision), pending.decision);
      assert.equal(event.trackId, track.id);
      assert.equal(h.state.flowShuffle.cycle.includes(track.id), true);
      assert.equal(h.state.flowShuffle.plan.cursor, h.state.flowShuffle.plan.order.indexOf(track.id));
      const start = h.state.signalJournal.events.find((item) => item.type === 'track_started');
      assert.equal(start.shufflePickId, event.pickId);
      assert.equal(start.shufflePickEventId, event.id);
      return { fromTrackId: event.fromTrackId, trackId: event.trackId, decision: event.decision, linkedStart: true };
    }],
    ['Flow failed decode creates no pick or learning event', async () => {
      const h = createHarness({ style: 'flow' });
      await h.activate(h.state.tracks[h.state.index]);
      const track = h.select();
      const before = copy(h.state.flowShuffle);
      const eventsBefore = copy(h.state.signalJournal.events);
      h.media.rejectPlay = true;
      await h.activate(track);
      assert.deepEqual(copy(h.state.flowShuffle), before);
      assert.deepEqual(copy(h.state.signalJournal.events), eventsBefore);
      assert.equal(h.context.flowShuffleRuntime.pending, null);
    }],
    ['Actual journal persistence and production normalization retain receipt provenance', async () => {
      const h = createHarness({ style: 'flow' });
      const origin = h.state.tracks[h.state.index].id;
      await h.advance();
      const event = h.state.signalJournal.events.find((item) => item.type === 'shuffle_pick');
      const restored = h.persistedJournal();
      const persistedEvent = restored.events.find((item) => item.id === event.id);
      assert.equal(persistedEvent.fromTrackId, origin);
      assert.deepEqual(copy(persistedEvent.decision), copy(event.decision));
      assert.equal(restored.lastShuffle.fromTrackId, origin);
      assert.deepEqual(copy(restored.lastShuffle.decision), copy(event.decision));
      const restoredFlow = h.context.normalizeFlowShuffle(copy(h.state.flowShuffle));
      assert.deepEqual(copy(restoredFlow.lastPick.decision), copy(event.decision));
      return { restoredPick: event.pickId, eventCount: restored.events.length };
    }],
    ['Flow Previous and Next preserve committed history and projected future', async () => {
      const h = createHarness({ style: 'flow' });
      const first = await h.advance();
      const second = await h.advance();
      const before = copy(h.state.flowShuffle.plan.order);
      assert.equal(await h.advance(-1, false), first);
      assert.equal(await h.advance(1, false), second);
      assert.deepEqual(copy(h.state.flowShuffle.plan.order), before);
      return { first, second, order: before };
    }],
    ['Journal disabled commits traversal without recording personal events', async () => {
      const h = createHarness({ style: 'flow' });
      h.state.signalSettings.enabled = false;
      const track = h.select();
      await h.activate(track);
      assert.equal(h.state.flowShuffle.cycle.includes(track.id), true);
      assert.equal(h.state.signalJournal.events.length, 0);
      assert.equal(h.context.signalRuntime.pendingShufflePick, null);
    }],
    ['seeking to natural end retains measured heard intervals without teaching completion', async () => {
      const h = createHarness({ style: 'flow' });
      const initial = h.state.tracks[h.state.index];
      await h.activate(initial);
      for (let second = 0; second < 12; second += 1) h.tick();
      h.dispatchMedia('seeking');
      h.audio.currentTime = 179.9;
      h.dispatchMedia('seeked');
      await h.advance();
      const outcome = h.state.signalJournal.events.find((event) => event.type === 'track_completed' && event.trackId === initial.id);
      assert.ok(outcome);
      assert.equal(outcome.listenedSeconds, 12);
      assert.equal(outcome.coveredSeconds, 12);
      assert.equal(outcome.percentCompleted, 12 / 180);
      assert.equal(outcome.outcomeClass, 'ignored');
      assert.equal(h.state.signalJournal.trackStats[initial.id].completions, 0);
      assert.equal(learning.behaviorEvidence(h.state.signalJournal.trackStats[initial.id]).successes, 0);
      return { listenedSeconds: outcome.listenedSeconds, coveredSeconds: outcome.coveredSeconds, percentCompleted: outcome.percentCompleted, outcomeClass: outcome.outcomeClass };
    }],
    ['pause and buffering media routes do not accrue heard time or coverage', async () => {
      const h = createHarness({ style: 'flow' });
      await h.activate(h.state.tracks[h.state.index]);
      for (let second = 0; second < 8; second += 1) h.tick();
      h.audio.paused = true;
      h.dispatchMedia('pause');
      h.tick(60, 0);
      h.audio.paused = false;
      h.dispatchMedia('play');
      h.dispatchMedia('playing');
      for (let second = 0; second < 3; second += 1) h.tick();
      h.dispatchMedia('waiting');
      h.tick(4, 4);
      h.dispatchMedia('playing');
      for (let second = 0; second < 2; second += 1) h.tick();
      const measured = h.context.signalListeningTracker.checkpoint();
      assert.equal(measured.listenedWallSeconds, 13);
      assert.equal(measured.coveredSeconds, 13);
      return { listenedWallSeconds: measured.listenedWallSeconds, coveredSeconds: measured.coveredSeconds, ranges: measured.coverageRanges };
    }],
    ['successful manual switch retains outgoing measured time before source reset', async () => {
      const h = createHarness({ style: 'flow' });
      const origin = h.state.tracks[h.state.index];
      await h.activate(origin);
      for (let second = 0; second < 10; second += 1) h.tick();
      await h.activate(h.select());
      assert.equal(h.audio.currentTime, 0);
      const outcome = h.state.signalJournal.events.find((event) => event.type === 'track_skipped' && event.trackId === origin.id);
      assert.ok(outcome);
      assert.equal(outcome.listenedSeconds, 10);
      assert.equal(outcome.coveredSeconds, 10);
      assert.equal(outcome.percentCompleted, 10 / 180);
      return { listenedSeconds: outcome.listenedSeconds, coveredSeconds: outcome.coveredSeconds, incomingPosition: h.audio.currentTime };
    }],
  ], options);
}

module.exports = { createHarness, runW0, runFlow };

if (require.main === module) {
  const receipt = process.argv.find((argument) => argument.startsWith('--receipt='))?.slice('--receipt='.length);
  const run = process.argv.includes('--flow') ? runFlow : runW0;
  run({ receipt }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
