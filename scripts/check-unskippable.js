'use strict';

// Unskippable mixes: the shared generator (JS, mirrored in Kotlin) and the
// Windows wiring that keeps a mix from being skipped, seeked or re-queued.
// `--write-fixtures` regenerates the cross-platform cases Kotlin is held to.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mix = require('../src/unskippable/mix.js');
const desktop = require('../src/renderer-domains/unskippable-desktop.js');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'docs/api-contract-fixtures/unskippable-v1/cases.json');
const write = process.argv.includes('--write-fixtures');

// A small deterministic library: genres repeat, some songs are untagged,
// some carry two genres, and one is missing.
function library(size = 120) {
  const genres = ['Rock', 'Indie Rock', 'Jazz', 'Hip-Hop/Rap', 'Electronic', '', 'Rock; Blues', 'Ambient'];
  const items = [];
  for (let i = 0; i < size; i += 1) {
    const genre = genres[i % genres.length];
    items.push({
      entry: {
        entryId: `t${i}`, trackId: `t${i}`, artist: `Artist ${i % 13}`, album: `Album ${i % 29}`, genre: genre || null,
        available: i !== 7, features: i % 3 === 0 ? { tempo: { value: 80 + (i % 60), provenance: 'tagged' } } : {},
      },
      durationMs: i % 11 === 0 ? 0 : 150000 + (i % 9) * 15000,
    });
  }
  return items;
}

const cases = [
  { name: 'flow-60', recipe: { style: 'flow', targetMinutes: 60, seed: 'alpha' } },
  { name: 'flow-30-other-seed', recipe: { style: 'flow', targetMinutes: 30, seed: 'beta' } },
  { name: 'rigid-rock-60', recipe: { style: 'rigid', genre: 'Rock', targetMinutes: 60, seed: 'alpha' } },
  { name: 'rigid-jazz-120-short', recipe: { style: 'rigid', genre: 'jazz', targetMinutes: 120, seed: 'gamma' } },
  { name: 'rigid-ambient-with-untagged', recipe: { style: 'rigid', genre: 'Ambient', targetMinutes: 30, seed: 'delta', includedUntaggedIds: ['t5', 't13', 't21'] } },
  { name: 'rigid-unknown-genre', recipe: { style: 'rigid', genre: 'Polka', targetMinutes: 30, seed: 'alpha' } },
  { name: 'rigid-no-genre', recipe: { style: 'rigid', targetMinutes: 30, seed: 'alpha' } },
];

function run() {
  const items = library();
  const byId = new Map(items.map((item) => [item.entry.trackId, item]));
  const genresOf = (id) => mix.genresOf(byId.get(id).entry.genre).map((genre) => genre.genreId);

  // Genre parsing splits multi-genre tags and folds case.
  assert.deepEqual(mix.genresOf('Hip-Hop/Rap; hip-hop').map((g) => g.genreId), ['hip-hop', 'rap']);
  assert.deepEqual(mix.genresOf('  '), []);

  // The catalog counts untagged songs instead of hiding them.
  const catalog = mix.genreCatalog(items);
  assert.equal(catalog.untaggedCount, 15, 'every untagged, available song is counted');
  assert.ok(!catalog.untaggedTrackIds.includes('t7'), 'missing songs are not offered');
  assert.equal(catalog.genres[0].genreId, 'rock');

  // Same recipe and seed, same mix.
  for (const item of cases) assert.deepEqual(mix.generate(items, item.recipe), mix.generate(items, item.recipe), `${item.name} is deterministic`);

  const flow = mix.generate(items, cases[0].recipe);
  assert.equal(flow.status, 'ready');
  assert.ok(flow.durationMs >= 60 * 60000, 'a Flow mix fills the asked length');
  assert.equal(new Set(flow.trackIds).size, flow.trackIds.length, 'no repeats');
  assert.ok(!flow.trackIds.includes('t7'), 'missing songs never enter a mix');
  assert.ok(flow.trackIds.some((id) => !genresOf(id).length), 'Flow can use untagged songs');

  const rock = mix.generate(items, cases[2].recipe);
  assert.equal(rock.status, 'ready');
  const neighbours = new Set(rock.neighbourIds);
  for (const id of rock.trackIds) {
    if (neighbours.has(id)) assert.ok(!genresOf(id).includes('rock'), 'neighbours come from other genres');
    else assert.ok(genresOf(id).includes('rock'), 'every other song is in the genre');
  }
  assert.ok(rock.neighbourIds.length <= Math.floor((rock.trackIds.length - rock.neighbourIds.length) / mix.NEIGHBOUR_EVERY), 'neighbours stay within one in ten');
  assert.ok(rock.trackIds.every((id) => genresOf(id).length), 'untagged songs stay out unless added');

  const jazz = mix.generate(items, cases[3].recipe);
  assert.ok(jazz.shortfallMs > 0, 'a thin genre gives a shorter mix and says so');

  const ambient = mix.generate(items, cases[4].recipe);
  for (const id of ['t5', 't13', 't21']) assert.ok(ambient.trackIds.includes(id) || ambient.durationMs >= 30 * 60000, 'added untagged songs can be picked');
  assert.ok(ambient.trackIds.filter((id) => !genresOf(id).length).every((id) => ['t5', 't13', 't21'].includes(id)), 'only the untagged songs added by hand');

  assert.equal(mix.generate(items, cases[5].recipe).status, 'no-genre-songs');
  assert.equal(mix.generate(items, cases[6].recipe).status, 'needs-genre');
  assert.equal(mix.generate([], { style: 'flow' }).status, 'empty-library');

  // Swap keeps rigid mixes in their genre; remove drops one song.
  const swapped = mix.swap(items, rock, rock.trackIds.find((id) => !neighbours.has(id)));
  assert.ok(swapped && swapped.trackIds.length === rock.trackIds.length);
  assert.ok(swapped.trackIds.every((id) => neighbours.has(id) || genresOf(id).includes('rock')));
  assert.equal(new Set(swapped.trackIds).size, swapped.trackIds.length);
  assert.notDeepEqual(mix.swap(items, swapped, swapped.trackIds[0]).trackIds, swapped.trackIds, 'a second swap moves on');
  const removed = mix.remove(items, rock, rock.trackIds[0]);
  assert.equal(removed.trackIds.length, rock.trackIds.length - 1);
  assert.equal(mix.swap(items, rock, 'not-in-mix'), null);

  // Resume picks up the saved song and position, skipping songs now missing.
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(mix.resumePoint(ids, { trackId: 'b', positionMs: 4200 }), { index: 1, trackId: 'b', positionMs: 4200 });
  assert.deepEqual(mix.resumePoint(ids, null), { index: 0, trackId: 'a', positionMs: 0 });
  assert.deepEqual(mix.resumePoint(ids, { trackId: 'b', positionMs: 4200 }, (id) => id !== 'b'), { index: 2, trackId: 'c', positionMs: 0 });
  assert.equal(mix.resumePoint(ids, null, () => false), null);

  // Recipes are bounded.
  assert.equal(mix.normalizeRecipe({ targetMinutes: 5 }).targetMinutes, mix.MIN_MINUTES);
  assert.equal(mix.normalizeRecipe({ targetMinutes: 9999 }).targetMinutes, mix.MAX_MINUTES);
  assert.deepEqual(mix.normalizeRecipe({ style: 'flow', includedUntaggedIds: ['x'] }).includedUntaggedIds, []);

  assert.equal(desktop.formatDuration(65 * 60000), '1 hr 5 min');
  assert.equal(desktop.formatDuration(120 * 60000), '2 hr');
  assert.equal(desktop.recipeLine({ style: 'rigid', genre: 'Rock' }), 'One genre · Rock');

  // Cover display: the listener's pick wins; Theme default follows the theme,
  // and themes without a look of their own stack the details under the art.
  assert.equal(desktop.resolveCoverLayout('side', 'art'), 'side');
  assert.equal(desktop.resolveCoverLayout('theme', 'art'), 'art');
  assert.equal(desktop.resolveCoverLayout('theme', 'theme'), 'stacked');
  assert.equal(desktop.resolveCoverLayout(undefined, undefined), 'stacked');
  assert.equal(desktop.normalizeCoverLayout('sideways'), 'theme');
  // The three theme looks apply on Theme default only.
  assert.equal(desktop.themeCoverLook('theme', 'obsession'), 'obsession');
  assert.equal(desktop.themeCoverLook('side', 'obsession'), '');
  assert.equal(desktop.themeCoverLook('theme', 'studio'), '');
  assert.deepEqual(Object.keys(desktop.THEME_COVER_LOOKS).sort(), ['cartridge-quest', 'lo-fi-cafe', 'obsession']);

  // Cross-platform fixtures: Kotlin's UnskippableMix must give the same lists.
  const fixture = {
    version: mix.VERSION,
    items,
    cases: cases.map((item) => {
      const out = mix.generate(items, item.recipe);
      return { name: item.name, recipe: item.recipe, expected: { status: out.status, trackIds: out.trackIds, neighbourIds: out.neighbourIds, durationMs: out.durationMs, recipe: out.recipe } };
    }),
    swaps: [{ from: 'rigid-rock-60', trackId: rock.trackIds.find((id) => !neighbours.has(id)), expected: swapped.trackIds }],
  };
  const text = `${JSON.stringify(fixture, null, 2)}\n`;
  if (write) { fs.mkdirSync(path.dirname(fixturePath), { recursive: true }); fs.writeFileSync(fixturePath, text); }
  assert.equal(fs.readFileSync(fixturePath, 'utf8').replace(/\r\n/g, '\n'), text, 'unskippable fixtures are current (run node scripts/check-unskippable.js --write-fixtures)');

  // Windows wiring: every way to skip, seek or change the queue asks first.
  const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8').replace(/\r\n/g, '\n');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /src="unskippable\/mix\.js"/);
  assert.match(html, /src="renderer-domains\/unskippable-desktop\.js"/);
  assert.match(html, /href="unskippable\.css"/);
  assert.ok(html.indexOf('shuffle/universal.js') < html.indexOf('unskippable/mix.js'), 'the mix loads after the shuffle core');
  assert.match(html, /id="openUnskippableBuilder"/);
  assert.match(html, /data-action="remake-unskippable"/);
  const guarded = [
    [/async function requestPlaybackTraversal[\s\S]{0,200}unskippableController\?\.playing\(\)/, 'Next/Previous'],
    [/async function playTrack\(id, options = \{\}\) \{\n  if \(unskippableController\?\.playing\(\) && options\.unskippable !== true\)/, 'playing another song'],
    [/\$\('#seek'\)\.oninput[\s\S]{0,120}unskippableBlocks\('seek'\)/, 'the seek bar'],
    [/action === 'seek'\) \{\n    if \(unskippableBlocks\('seek'\)\)/, 'remote seek'],
    [/seekto: \(details\) => \{\n      if \([^\n]*unskippableBlocks\('seek'\)/, 'media key seek'],
    [/seekbackward: \(details\) => \{\n      if \(unskippableBlocks\('seek'\)\)/, 'seek back'],
    [/seekforward: \(details\) => \{\n      if \(unskippableBlocks\('seek'\)\)/, 'seek forward'],
    [/function enqueueQueueTracks[^\n]*\n  if \(unskippableBlocks\('queue'\)\)/, 'adding to the queue'],
    [/function moveQueueEntry[^\n]*\n  if \(unskippableBlocks\('queue'\)\)/, 'moving queue rows'],
    [/function handleRemoteQueueCommand[^\n]*\n  if \(unskippableBlocks\('queue'\)\)/, 'remote queue edits'],
    [/function handleRemoteShuffleCommand[^\n]*\n  if \(unskippableBlocks\('shuffle'\)\)/, 'remote shuffle'],
    [/function setShuffleStyle[^\n]*\n  if \(unskippableBlocks\('shuffle'\)\)/, 'shuffle style'],
    [/#repeatButton'\)\.onclick = \(\) => \{ if \(unskippableBlocks\('repeat'\)\)/, 'repeat'],
    [/function addCollectionToSession\(\) \{\n  if \(unskippableBlocks\('queue'\)/, 'Add to session'],
  ];
  for (const [pattern, label] of guarded) assert.match(renderer, pattern, `${label} is blocked during an unskippable mix`);
  assert.match(renderer, /if \(!next\) \{ unskippableController\.finished\(\); return false; \}/, 'the end of the mix is reported');
  assert.match(renderer, /function selectPlaylist\(id\) \{\n  if \(isUnskippablePlaylist\(id\) && unskippable\(\)\?\.openCover\(id\)\) return;/, 'opening a mix opens its cover');
  assert.match(renderer, /!p\.virtual && !p\.unskippable/, 'Add to playlist leaves unskippable mixes alone');
  assert.match(renderer, /coverLayout: \(\) => appearance\.unskippableCoverLayout/, 'the cover layout is remembered with Appearance');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.match(main, /allowedPermissions = new Set\(\[[^\]]*'fullscreen'/, 'the cover may go full screen');

  console.log('Unskippable checks passed.');
}

run();
