const assert = require('node:assert/strict');
const glyph = require('../src/theme-runtime/glyph');

const seeds = [
  '',
  'all|All Music',
  'night|Night Signals',
  'unicode|夜の信号 / éë',
  'arabic|مرحبا بالموجة الطويلة',
  'long|'.concat('A signal '.repeat(80)),
  ...Array.from({ length: 48 }, (_, index) => `fixture-${index}`),
];

for (const seed of seeds) {
  const first = glyph.describe(seed);
  const second = glyph.describe(seed);
  assert.deepEqual(first, second, `glyph descriptor must be deterministic for ${JSON.stringify(seed)}`);
  assert.ok(Object.isFrozen(first), 'glyph descriptors must be immutable');
  assert.ok(Number.isInteger(first.variant) && first.variant >= 0 && first.variant < glyph.counts.variants, 'variant must stay bounded');
  assert.ok(Number.isInteger(first.rotation) && first.rotation >= 0 && first.rotation < glyph.counts.rotations, 'rotation must stay bounded');
  assert.ok(Number.isInteger(first.edition) && first.edition >= 0 && first.edition < glyph.counts.editions, 'edition must stay bounded');
  if (seed) assert.equal(JSON.stringify(first).includes(seed), false, 'descriptor must never expose its source seed');
  assert.deepEqual(Object.keys(first).sort(), ['edition', 'rotation', 'variant'], 'descriptor must expose only presentation-safe fields');
}

const variants = new Set(seeds.map((seed) => glyph.describe(seed).variant));
const rotations = new Set(seeds.map((seed) => glyph.describe(seed).rotation));
const editions = new Set(seeds.map((seed) => glyph.describe(seed).edition));
assert.equal(variants.size, glyph.counts.variants, 'fixed fixture sample must exercise every glyph variant');
assert.equal(rotations.size, glyph.counts.rotations, 'fixed fixture sample must exercise every rotation');
assert.equal(editions.size, glyph.counts.editions, 'fixed fixture sample must exercise every edition mark');
assert.notDeepEqual(glyph.describe('track-a'), glyph.describe('track-b'), 'ordinary different seeds should not collapse to one descriptor');

console.log('Theme glyph audit passed: deterministic, Unicode-safe, bounded, seed-private, and distributed across every registered variant.');
