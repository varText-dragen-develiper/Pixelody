const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PixelodyStateStore } = require('../src/state-store');

// A routine save re-serializes only the keys it supplies and reuses the text
// of the rest. This proves the shortcut changes nothing a person can observe:
// the bytes on disk match a store that re-serializes everything, callers never
// share objects with the store, and a failed commit leaves the cache valid.

const roots = [];
function temporaryRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pixelody-${label}-`));
  roots.push(root);
  return root;
}
const readState = (store) => fs.readFileSync(store.paths.current, 'utf8');

function track(index) {
  return { id: `t${index}`, path: `C:\Music\${index}.flac`, title: `Title ${index} \u00e9\u4e2d`, duration: 100 + index, userTags: ['a'] };
}

(async () => {
  // Same sequence, with and without the cache: identical bytes on disk.
  const sequence = [
    { 'aurelia.library': Array.from({ length: 40 }, (_, i) => track(i)), 'pixelody.volume': 0.5 },
    { 'pixelody.session': { id: 't1', time: 1, volume: 0.5 } },
    { 'pixelody.session': { id: 't2', time: 2, volume: 0.5 }, 'pixelody.favorites': ['t2'] },
    { 'aurelia.playlists': [{ id: 'all', name: 'All Music', trackIds: ['t1', 't2'] }] },
    { 'pixelody.session': { id: 't3', time: 3, volume: 0.9, note: 'quote " and \ and \n newline' } },
    { 'pixelody.queue': ['t1', 't2', 't3'], 'pixelody.shuffle': true },
  ];
  const cached = new PixelodyStateStore({ directory: temporaryRoot('frag-cached'), now: () => 1_700_000_000_000 });
  const plain = new PixelodyStateStore({ directory: temporaryRoot('frag-plain'), now: () => 1_700_000_000_000 });
  for (const [index, values] of sequence.entries()) {
    const a = await cached.commit(structuredClone(values), { includeState: false });
    plain.fragments = null;
    const b = await plain.commit(structuredClone(values), { includeState: false });
    assert.equal(a.ok && b.ok, true, `commit ${index} succeeds`);
    assert.equal(readState(cached), readState(plain), `commit ${index} writes the same bytes with and without reuse`);
    if (index > 0) assert.ok(cached.fragments instanceof Map && cached.fragmentsFor === cached.cachedEnvelope, 'the cache follows the committed envelope');
  }
  const reread = new PixelodyStateStore({ directory: cached.directory, now: () => 1_700_000_000_000 });
  const loaded = (reread.loadSync(), reread.loadResult()).state.values;
  const written = JSON.parse(readState(cached)).values;
  for (const key of Object.keys(written).filter((name) => !name.startsWith('pixelody.workspace'))) assert.deepEqual(loaded[key], written[key], `a fresh load sees ${key} exactly as written`);

  // Callers never share objects with the store, even when they mutate after commit.
  const store = new PixelodyStateStore({ directory: temporaryRoot('frag-alias'), now: () => 1_700_000_000_000 });
  const library = [track(1), track(2)];
  await store.commit({ 'aurelia.library': library }, { includeState: false });
  library[0].title = 'MUTATED AFTER COMMIT';
  library.push(track(3));
  await store.commit({ 'pixelody.volume': 0.2 }, { includeState: false });
  assert.equal(JSON.parse(readState(store)).values['aurelia.library'].length, 2, 'later commits reuse the committed library, not the caller\'s mutated array');
  assert.equal(JSON.parse(readState(store)).values['aurelia.library'][0].title, 'Title 1 \u00e9\u4e2d');

  // Supplying the same object again after mutating it in place still writes the change.
  library.length = 2;
  library[0].title = 'Edited in place';
  await store.commit({ 'aurelia.library': library }, { includeState: false });
  assert.equal(JSON.parse(readState(store)).values['aurelia.library'][0].title, 'Edited in place', 'an in-place edit passed back is saved');

  // A value that cannot be serialized is refused and leaves the store untouched and usable.
  const before = readState(store);
  const circular = {}; circular.self = circular;
  const refused = await store.commit({ 'pixelody.session': circular }, { includeState: false });
  assert.equal(refused.ok, false);
  assert.equal(readState(store), before, 'a refused commit writes nothing');
  const after = await store.commit({ 'pixelody.volume': 0.3 }, { includeState: false });
  assert.equal(after.ok, true, 'the next commit still succeeds');
  assert.equal(JSON.parse(readState(store)).values['pixelody.volume'], 0.3);
  assert.equal(JSON.parse(readState(store)).values['aurelia.library'][0].title, 'Edited in place');

  // A restore that replaces known keys still drops what the restore lacks.
  const restore = await store.commit({ 'pixelody.volume': 0.9 }, { includeState: false, replaceKnownValues: true });
  assert.equal(restore.ok, true);
  const restored = JSON.parse(readState(store)).values;
  assert.equal(restored['pixelody.volume'], 0.9);
  assert.equal(Object.hasOwn(restored, 'aurelia.library'), false, 'replaceKnownValues removes keys the restore omits');

  // Revisions stay monotonic across cached and uncached commits.
  const revisions = [];
  for (let i = 0; i < 5; i += 1) {
    if (i === 2) store.fragments = null;
    await store.commit({ 'pixelody.volume': i / 10 }, { includeState: false });
    revisions.push(JSON.parse(readState(store)).revision);
  }
  assert.deepEqual(revisions, revisions.slice().sort((x, y) => x - y));
  assert.equal(new Set(revisions).size, 5);

  // A routine save of a 10,000-track library is cheap; the library itself is not re-serialized.
  const big = new PixelodyStateStore({ directory: temporaryRoot('frag-big') });
  await big.commit({ 'aurelia.library': Array.from({ length: 10000 }, (_, i) => ({ ...track(i), artist: `Artist ${i % 500}`, album: `Album ${i % 900}` })) }, { includeState: false });
  const originalStringify = JSON.stringify;
  let serializedBytes = 0;
  JSON.stringify = function counted(...args) { const text = originalStringify.apply(this, args); serializedBytes += text ? text.length : 0; return text; };
  try {
    const prepared = big.prepareCommit({ 'pixelody.session': { id: 't1', time: 5 } }, {});
    assert.ok(prepared.envelope);
    assert.ok(serializedBytes < 4096, `a position tick serialized ${serializedBytes} characters instead of the library`);
  } finally { JSON.stringify = originalStringify; }

  console.log('State fragment audit passed: reuse is byte-identical to full serialization, callers share nothing with the store, failed commits change nothing, and a position tick no longer re-serializes the library.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
