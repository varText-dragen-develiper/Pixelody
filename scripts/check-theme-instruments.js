'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registryApi = require('../src/theme-instruments/registry.js');
const fixtures = require('../src/theme-instruments/fixtures.js');
const instruments = require('../src/theme-instruments/instruments.js');

const registry = registryApi.createRegistry();
assert.equal(instruments.registerAll(registry), 12, 'The first foundry slice must register twelve instruments.');
assert.equal(registry.list().length, 12);
assert.equal(new Set(registry.list().map((entry) => entry.id)).size, 12, 'Instrument ids must be unique.');
assert.equal(registryApi.CATEGORY_DEFINITIONS.length, 6, 'The catalog must remain divided into six families.');

registryApi.CATEGORY_DEFINITIONS.forEach((category) => {
  assert.equal(registry.listByCategory(category.id).length, 2, `${category.label} must have exactly two working specimens.`);
});

const representedRoles = new Set();
registry.list().forEach((descriptor) => {
  const validation = registryApi.validateDescriptor(descriptor);
  assert.equal(validation.valid, true, `${descriptor.id}: ${validation.errors.join('; ')}`);
  representedRoles.add(descriptor.role);
  assert.ok(descriptor.contractVersion === registryApi.CONTRACT_VERSION);
  assert.ok(descriptor.placements.length > 0);
  assert.ok(descriptor.fallback.length > 10);
  assert.ok(descriptor.accessibility.length > 10);
  const instance = registry.create(descriptor.id);
  assert.equal(registryApi.validateLifecycle(instance).valid, true);
  instance.destroy();
});
assert.deepEqual([...representedRoles].sort(), ['aesthetic', 'functional', 'hybrid', 'platform']);
assert.throws(() => registry.register(instruments.DEFINITIONS[0]), /already registered/);
assert.throws(() => registryApi.createRegistry().register({ id: 'unsafe', create() {} }), /Invalid theme instrument/);
assert.equal(registry.create('missing-instrument'), null, 'Unknown keys must fail safely without inventing a renderer.');

const initial = fixtures.createFixtureState();
const paused = fixtures.reduceFixture(initial, { type: 'TOGGLE_PLAY' });
assert.equal(paused.playback.phase, 'paused');
assert.equal(initial.playback.phase, 'playing', 'Fixture reducers must not mutate their input.');
assert.equal(fixtures.reduceFixture(initial, { type: 'SEEK', position: 9999 }).playback.position, initial.playback.duration, 'Seek must clamp to the truthful duration.');
assert.equal(fixtures.reduceFixture(initial, { type: 'NEXT_TRACK' }).trackIndex, 1);
assert.equal(fixtures.reduceFixture(initial, { type: 'PREVIOUS_TRACK' }).trackIndex, initial.tracks.length - 1);
assert.equal(fixtures.reduceFixture(initial, { type: 'CYCLE_REPEAT' }).modes.repeat, 'all');
assert.equal(fixtures.reduceFixture(initial, { type: 'SET_CABINET', open: true }).cabinetOpen, true);
assert.deepEqual(fixtures.createFixtureState(), fixtures.createFixtureState(), 'Foundry fixtures must be deterministic.');
assert.equal(fixtures.hashString('Night Transit Archive'), fixtures.hashString('Night Transit Archive'));

const root = path.join(__dirname, '..');
const packageSource = ['registry.js', 'fixtures.js', 'instruments.js'].map((file) => fs.readFileSync(path.join(root, 'src', 'theme-instruments', file), 'utf8')).join('\n');
assert.doesNotMatch(packageSource, /createMediaElementSource|new\s+AudioContext|webkitAudioContext/, 'Theme instruments must not own the playback graph.');
assert.doesNotMatch(packageSource, /data-theme|built-in-themes|themeNavigationMechanics/, 'Foundry instruments must remain unassigned to themes.');
assert.doesNotMatch(packageSource, /https?:\/\//, 'The first foundry slice must use local product-owned material only.');

const html = fs.readFileSync(path.join(root, 'src', 'theme-instrument-foundry.html'), 'utf8');
const foundrySource = fs.readFileSync(path.join(root, 'src', 'theme-instrument-foundry.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'theme-instrument-foundry.css'), 'utf8');
assert.match(html, /Deterministic local fixture/);
assert.match(html, /Theme status[\s\S]*Unassigned/);
assert.match(html, /Foundry evidence only/);
assert.match(html, /id="motion-control"/);
assert.match(html, /id="performance-control"/);
assert.match(foundrySource, /registerAll\(registry\)/);
assert.match(foundrySource, /fixtures\.reduceFixture/);
assert.match(foundrySource, /registry\.listByCategory/);
assert.match(foundrySource, /instance\.mount/);
assert.match(css, /body\[data-motion="off"\]/);
assert.match(css, /body\[data-performance="conserve"\]/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /:focus-visible/);
['ti-material-board', 'ti-atmosphere-scene', 'ti-artwork-workbench', 'ti-sigil-layout', 'ti-timeline', 'ti-truth-bank', 'ti-transport', 'ti-cabinet', 'ti-choreo', 'ti-receipt', 'ti-slot-composer', 'ti-companion'].forEach((className) => assert.match(css, new RegExp(`\\.${className}\\b`), `${className} needs a foundry treatment.`));

console.log('Theme Instrument Foundry audit passed: 12 registered instruments, two in each of six families, deterministic truth fixtures, lifecycle validation, and explicit motion/performance/fallback boundaries.');
