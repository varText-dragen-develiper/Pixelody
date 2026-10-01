const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = require('../src/purchase-bridge');
const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

const albumPlan = bridge.createPlan({
  title: 'A Track',
  artist: 'An Artist',
  album: 'An Album',
  path: 'C:\\private\\song.flac',
  artworkPath: 'C:\\private\\cover.jpg',
});

assert.equal(albumPlan.schemaVersion, 2);
assert.equal(albumPlan.release.kind, 'track');
assert.equal(albumPlan.release.title, 'A Track');
assert.equal(albumPlan.release.album, 'An Album');
assert.equal(albumPlan.truth.checkout, 'external');
assert.equal(albumPlan.truth.purchaseVerification, 'not-verified-by-pixelody');
assert.equal(albumPlan.truth.localOwnership, 'requires-local-import');
assert.equal(albumPlan.truth.searchMatch, 'candidate-not-verified-match');
assert.equal(albumPlan.offer.providerKey, 'bandcamp');
assert.ok(bridge.isAllowedOfferUrl(albumPlan.offer.url));
assert.match(albumPlan.offer.url, /^https:\/\/bandcamp\.com\/search\?q=/);
assert.doesNotMatch(albumPlan.offer.url, /private|song\.flac|cover\.jpg/i);
assert.equal(decodeURIComponent(new URL(albumPlan.offer.url).searchParams.get('q')), 'An Artist A Track');
assert.deepEqual(albumPlan.searches.map((search) => search.key), ['track', 'album', 'artist']);
assert.equal(albumPlan.searches[1].query, 'An Artist An Album');

const trackPlan = bridge.createPlan({ title: 'Only Track', artist: 'Solo Artist' });
assert.equal(trackPlan.release.kind, 'track');
assert.equal(trackPlan.release.title, 'Only Track');
assert.equal(decodeURIComponent(new URL(trackPlan.offer.url).searchParams.get('q')), 'Solo Artist Only Track');

const cluePlan = bridge.createPlan({ title: 'Tagged Song', artist: 'Tagged Artist', bpm: 128.4, isrc: 'AA-BBB-24-12345', year: 2024 });
assert.deepEqual(cluePlan.identity.clues.map((clue) => [clue.key, clue.value]), [
  ['isrc', 'AA-BBB-24-12345'],
  ['bpm', '128'],
  ['year', '2024'],
]);
assert.doesNotMatch(cluePlan.offer.url, /128|AA-BBB/);

const sparsePlan = bridge.createPlan({ title: 'Filename fallback' });
assert.equal(sparsePlan.offer.query, 'Filename fallback');
assert.equal(sparsePlan.searches[0].label, 'Title only');

const manualPlan = bridge.createPlan({});
assert.equal(manualPlan.release.kind, 'unknown');
assert.equal(manualPlan.offer.url, '');
assert.deepEqual(manualPlan.searches, []);
assert.equal(bridge.buildBandcampSearchUrl('  Listener typed song  '), 'https://bandcamp.com/search?q=Listener%20typed%20song');

assert.equal(bridge.isAllowedOfferUrl('http://bandcamp.com/search?q=test'), false);
assert.equal(bridge.isAllowedOfferUrl('https://bandcamp.com.attacker.invalid/search?q=test'), false);
assert.equal(bridge.isAllowedOfferUrl('https://bandcamp.com/artist/release'), false);
assert.equal(bridge.isAllowedOfferUrl('https://bandcamp.com/search?q='), false);
assert.equal(Object.isFrozen(albumPlan), true);
assert.equal(Object.isFrozen(albumPlan.truth), true);
assert.equal(Object.isFrozen(albumPlan.searches), true);
assert.equal(Object.isFrozen(albumPlan.identity.clues), true);

for (const id of [
  'supportOwnOverlay',
  'supportOwnTitle',
  'supportOwnReleaseTitle',
  'supportOwnArtist',
  'supportOwnLocalStatus',
  'supportOwnQuery',
  'supportOwnSuggestions',
  'supportOwnIdentity',
  'openSupportStore',
  'importSupportFiles',
  'scanSupportDownloads',
  'supportOwnStatus',
]) {
  assert.match(indexHtml, new RegExp(`id=["']${id}["']`), `Missing purchase bridge UI binding: ${id}`);
}

assert.match(indexHtml, /src=["']purchase-bridge\.js["']/);
assert.match(indexHtml, /href=["']purchase-bridge\.css["']/);
assert.match(renderer, /window\.PixelodyPurchaseBridge/);
assert.doesNotMatch(renderer, /https:\/\/bandcamp\.com\/search/);
assert.match(renderer, /importKind:\s*'purchase'/);
assert.match(renderer, /purchaseVerification/);
assert.match(renderer, /buildBandcampSearchUrl\(query\)/);
assert.match(renderer, /data-support-search-index/);
assert.match(renderer, /supportOwn:\s*!\$\('#supportOwnOverlay'\)/);

console.log('Purchase bridge pilot audit passed: editable track-first search, metadata candidates, identity clues, external checkout, and local import are wired.');
