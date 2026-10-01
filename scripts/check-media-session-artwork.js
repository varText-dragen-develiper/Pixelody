const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
function extract(pattern, label) {
  const match = renderer.match(pattern);
  assert.ok(match, `renderer.js no longer defines ${label}`);
  return match[0];
}

assert.equal((renderer.match(/new MediaMetadata\(/g) || []).length, 1, 'Media Session metadata must only be built by publishMediaSessionMetadata');
assert.match(renderer, /publishMediaSessionMetadata\(track, artworkUrl\);/, 'track start must publish Media Session metadata through the helper');

const source = [
  extract(/let mediaSessionArtworkSerial = 0;/, 'mediaSessionArtworkSerial'),
  extract(/let mediaSessionArtworkBlobUrl = '';/, 'mediaSessionArtworkBlobUrl'),
  extract(/function publishMediaSessionMetadata\(track, artworkUrl\) \{[\s\S]*?\n\}/, 'publishMediaSessionMetadata'),
].join('\n');

(async () => {
  const fetches = [];
  const revoked = [];
  let blobCount = 0;
  const context = {
    navigator: { mediaSession: { metadata: null } },
    MediaMetadata: class { constructor(init) { Object.assign(this, init); } },
    URL: { createObjectURL: () => `blob:pixelody/${++blobCount}`, revokeObjectURL: (url) => revoked.push(url) },
    fetch: (url) => new Promise((resolve) => fetches.push({ url, resolve })),
  };
  vm.createContext(context);
  vm.runInContext(`${source}; this.publish = publishMediaSessionMetadata;`, context);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const respond = (index, ok = true) => fetches[index].resolve({ ok, blob: async () => ({}) });
  const metadata = () => context.navigator.mediaSession.metadata;

  context.publish({ title: 'A', artist: 'X', album: '' }, 'file:///C:/art/a.png');
  assert.equal(metadata().title, 'A', 'title and artist publish immediately');
  assert.equal(metadata().album, 'Pixelody');
  assert.equal(metadata().artwork, undefined, 'a file: cover is never handed to Media Session');
  respond(0);
  await settle();
  assert.equal(metadata().artwork[0].src, 'blob:pixelody/1', 'a local cover is published as a blob URL');

  context.publish({ title: 'Slow', artist: 'X', album: 'B' }, 'file:///C:/art/slow.png');
  assert.deepEqual(revoked, ['blob:pixelody/1'], "the previous track's blob URL is released when the next track publishes");
  context.publish({ title: 'Now', artist: 'X', album: 'B' }, '');
  respond(1);
  await settle();
  assert.equal(metadata().title, 'Now', 'a late cover for an earlier track never replaces the current track');
  assert.equal(metadata().artwork, undefined);
  assert.equal(blobCount, 1, 'a discarded late cover does not allocate a blob URL');

  context.publish({ title: 'Web', artist: 'X', album: 'B' }, 'https://example.test/cover.jpg');
  assert.equal(metadata().artwork[0].src, 'https://example.test/cover.jpg', 'allowed schemes are published directly');
  assert.equal(fetches.length, 2, 'allowed schemes are not re-fetched');

  context.publish({ title: 'Broken', artist: 'X', album: 'B' }, 'file:///C:/art/missing.png');
  respond(2, false);
  await settle();
  assert.equal(metadata().title, 'Broken', 'unreadable artwork leaves the text metadata in place');
  assert.equal(metadata().artwork, undefined);

  console.log('Media Session artwork audit passed: local covers publish as blob URLs, late covers are discarded, and old blob URLs are released.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
