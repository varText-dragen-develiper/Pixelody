const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const daily = require('../src/daily-curated');

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const tracks = Array.from({ length: 32 }, (_value, index) => ({
  id: `track-${String(index).padStart(2, '0')}`,
  title: `Track ${index + 1}`,
  artist: `Artist ${index % 6}`,
  album: `Album ${index % 4}`,
  duration: 160 + index,
}));
const now = new Date(2026, 7, 9, 9, 30, 0);

test('creates a deterministic same-day Rediscovery mix with unique local track IDs', () => {
  const first = daily.createRediscoveryMix({ tracks, now });
  const second = daily.createRediscoveryMix({ tracks, now });
  assert.deepEqual(first.trackIds, second.trackIds);
  assert.equal(first.trackIds.length, 24);
  assert.equal(new Set(first.trackIds).size, first.trackIds.length);
  assert.equal(first.explanationReceipt.source, 'local-library');
});

test('keeps an already generated mix stable when the library later changes', () => {
  const first = daily.ensureToday({}, { tracks, now });
  const changedTracks = [...tracks, { id: 'later-import', title: 'Later import', artist: 'New', duration: 200 }];
  const second = daily.ensureToday(first.state, { tracks: changedTracks, now });
  assert.equal(second.created, false);
  assert.deepEqual(second.mix.trackIds, first.mix.trackIds);
});

test('uses a supplied planning adapter without accepting duplicate or unknown output', () => {
  const result = daily.createRediscoveryMix({
    tracks: tracks.slice(0, 8),
    now,
    trackCount: 6,
    plan: ({ candidates }) => [candidates[3].track.id, candidates[3].track.id, 'not-in-library', candidates[0].track.id],
  });
  assert.equal(result.trackIds.length, 6);
  assert.equal(new Set(result.trackIds).size, 6);
  assert.ok(result.trackIds.every((id) => tracks.some((track) => track.id === id)));
});

test('normalizes saved state and records a permanent-playlist origin without changing the mix', () => {
  const generated = daily.ensureToday({}, { tracks, now });
  const saved = daily.markSaved(generated.state, generated.mix.id, 'playlist-1');
  const savedMix = Object.values(saved.mixes)[0];
  assert.equal(savedMix.savedPlaylistId, 'playlist-1');
  assert.deepEqual(savedMix.trackIds, generated.mix.trackIds);
});

test('building a mix in two steps matches building it at once, so the planner can run in slices', () => {
  const plan = ({ candidates, count }) => candidates.slice().reverse().slice(0, count).map((candidate) => candidate.track.id);
  const options = { tracks, now, history: [{ id: 'track-03', playedAt: '2026-07-01T00:00:00Z' }], favorites: ['track-05'] };
  const once = daily.createRediscoveryMix({ ...options, plan });
  const prepared = daily.prepareRediscovery(options);
  const stepped = daily.finishRediscovery(options, prepared, plan({ candidates: prepared.candidates, count: prepared.count }));
  assert.deepEqual(stepped, once);
  assert.equal(prepared.fingerprint, daily.libraryFingerprint(tracks));
  assert.equal(daily.todaysMix({}, { now }), null, 'no mix exists before one is stored');
  const stored = daily.storeMix({}, stepped);
  assert.deepEqual(daily.todaysMix(stored.state, { now }).trackIds, once.trackIds);
  assert.equal(daily.ensureToday(stored.state, { tracks, now }).created, false, 'a stored mix is reused, not regenerated');
});

test('the renderer builds a new day in idle slices and shows an honest pending state', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.match(renderer, /function\* dailyCuratedPlanSteps/, 'the planner must be resumable');
  assert.match(renderer, /await dailyMixQuietTurn()\(\)/, 'planning must wait for quiet idle moments');
  assert.match(renderer, /mix\.pending \? 'PREPARING'/, 'the panel must say the listen is being prepared');
  assert.ok(!/dailyCurated\.ensureToday\(state\.dailyMixes/.test(renderer), 'rendering must never build the mix synchronously');
});

test('renderer integration keeps the feature isolated, persistable, and theme-addressable', () => {
  const root = path.resolve(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'daily-curated.css'), 'utf8');
  assert.match(renderer, /pixelody\.dailyMixes/);
  assert.match(renderer, /dailyCuratedPlanAdapter/);
  assert.match(renderer, /saveDailyCuratedMix/);
  assert.match(renderer, /dailyCurated\.markSaved/);
  assert.doesNotMatch(renderer, /state\.flowShuffle\s*=\s*.*daily/i);
  assert.match(renderer, /if \(playlist\.dailyMix\) return playlist\.trackIds\.map\(trackById\)/, 'Daily Curated must display the same authored order that Play uses.');
  assert.match(renderer, /name: "Today's Listen"/, 'The collection identity must describe the daily listening job rather than another playlist.');
  assert.match(renderer, /No setup, no choices to configure, and no reshuffle until tomorrow/, 'The renderer must state the zero-configuration daily promise.');
  assert.match(html, /id="dailyCuratedPanel"/);
  assert.match(html, /ONE LISTEN, MADE FOR TODAY/);
  assert.match(html, /id="dailyCuratedLeadTitle"/);
  assert.match(html, /id="dailyCuratedReturning"/);
  assert.match(html, /id="dailyCuratedSequence"/);
  assert.match(html, /Keep this day/);
  assert.match(html, /src="daily-curated\.js"/);
  assert.match(html, /href="daily-curated\.css"/);
  assert.match(css, /--daily-curated-surface/);
  assert.match(css, /data-state/);
  assert.match(css, /daily-curated-entry-promise/);
  assert.match(css, /daily-curated-active \.collection-actions/);
  assert.match(css, /body\.daily-curated-view \.panel-handle/, 'Movable core panel handles must clear the daily promise card.');
  assert.match(renderer, /document\.body\.classList\.toggle\('daily-curated-view', isDailyMix\)/);
});
