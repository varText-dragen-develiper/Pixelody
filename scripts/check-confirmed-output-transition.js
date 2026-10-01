const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { createConfirmedOutputTransition } = require('../src/renderer-domains/confirmed-output-transition');

function run() {
  let clock = 1000;
  const transition = createConfirmedOutputTransition({
    activeId: 'track-a',
    published: { activeId: 'track-a', source: 'file:///track-a.wav', paused: false, currentTime: 12.5 },
    now: () => ++clock,
  });

  transition.begin('track-b', 1, { outputTitle: 'Track A' });
  let state = transition.snapshot();
  assert.equal(state.activeId, 'track-a', 'request must retain confirmed active ID');
  assert.equal(state.pending.requestedId, 'track-b');
  assert.deepEqual(state.published, { activeId: 'track-a', source: 'file:///track-a.wav', paused: true, currentTime: 12.5 });
  transition.syncPublished({ activeId: 'track-b', source: 'file:///track-b.wav', paused: false }, 'provisional-media-play');
  state = transition.snapshot();
  assert.equal(state.published.activeId, 'track-a', 'provisional media events must not publish the requested ID');
  assert.equal(state.published.source, 'file:///track-a.wav', 'provisional media events must not publish the requested source');
  assert.equal(state.published.paused, true, 'the retained output must remain visibly static during handoff');
  transition.note('media-pause', 1, { currentTrackId: 'track-a', outputTitle: 'Track A', miniTitle: 'Track A' });
  state = transition.snapshot();
  assert.equal(state.activeId, 'track-a', 'handoff pause must not migrate confirmed output');

  const rejected = transition.fail(1, { reason: 'decode rejected', outputTitle: 'Track A', miniTitle: 'Track A' });
  assert.equal(rejected.failed, true);
  assert.equal(rejected.activeId, 'track-a');
  assert.equal(rejected.failedId, 'track-b');
  assert.equal(transition.snapshot().pending, null);
  assert.deepEqual(transition.snapshot().published, { activeId: 'track-a', source: 'file:///track-a.wav', paused: true, currentTime: 12.5 });

  transition.begin('track-c', 2, { requestedSource: 'file:///track-c.wav' });
  const confirmed = transition.confirm(2, { playPromise: 'resolved', paused: false, currentTime: 0 });
  assert.equal(confirmed.committed, true);
  assert.equal(confirmed.activeId, 'track-c');
  assert.deepEqual(transition.snapshot().published, { activeId: 'track-c', source: 'file:///track-c.wav', paused: false, currentTime: 0 });
  assert.equal(transition.snapshot().failedId, null);

  transition.begin('track-d', 3);
  transition.begin('track-e', 4);
  const stale = transition.confirm(3, { playPromise: 'late resolve' });
  assert.equal(stale.committed, false, 'stale confirmation must not overwrite a newer request');
  assert.equal(transition.snapshot().activeId, 'track-c');
  assert.equal(transition.snapshot().pending.requestedId, 'track-e');
  transition.confirm(4);
  assert.equal(transition.snapshot().activeId, 'track-e');

  const events = transition.snapshot().events;
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence));
  assert.ok(events.some((event) => event.type === 'stale-confirmation-ignored'));
  assert.ok(events.some((event) => event.type === 'request-failed' && event.retainedActiveId === 'track-a'));

  const renderer = readFileSync(join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const playStart = renderer.indexOf('async function playTrack(id, options = {})');
  const playEnd = renderer.indexOf('\nfunction broadcastPlayerState()', playStart);
  assert.ok(playStart >= 0 && playEnd > playStart, 'playTrack integration boundary must exist');
  const playSource = renderer.slice(playStart, playEnd);
  const pauseIndex = playSource.indexOf('audio.pause()');
  const playPromiseIndex = playSource.indexOf("await issueSharedPlaybackCommand('play'");
  const confirmIndex = playSource.indexOf('confirmedOutputTransitionRuntime.confirm(requestSerial');
  const commitIndex = playSource.indexOf('state.index = index');
  assert.ok(pauseIndex >= 0 && playPromiseIndex > pauseIndex, 'source handoff must pause before requesting play');
  assert.ok(confirmIndex > playPromiseIndex, 'confirmation transaction must occur after the play promise');
  assert.ok(commitIndex > confirmIndex, 'state.index must remain prior output until transaction confirmation');
  assert.equal(playSource.slice(0, confirmIndex).includes('state.index = index'), false, 'no premature active publication is allowed');
  assert.ok(renderer.includes("confirmedOutputTransitionRuntime.note('media-pause'"), 'pause timing must be traced');
  assert.ok(renderer.includes("confirmedOutputTransitionRuntime.note('media-error'"), 'media failure timing must be traced');
  assert.ok(renderer.includes('window.__pixelodyConfirmedOutputTrace'), 'Electron trace hook must be present');
  assert.ok(renderer.includes('function confirmedPublishedOutputSnapshot()'), 'renderer must expose one published-output snapshot helper');
  assert.ok(renderer.includes('pending-media-play-withheld'), 'provisional media play must be explicitly withheld from publication');
  console.log('Confirmed-output transition audit passed: atomic ID/source/live publication, pending withholding, failure retention, timestamps, and stale-resolution guards are sound.');
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
