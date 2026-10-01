const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../src/theme-runtime/information/contract');
const registry = require('../src/theme-runtime/information/registry');
require('../src/theme-runtime/information/bundles');
const runtimeDomain = require('../src/theme-runtime/information/runtime');
const { profile } = require('../src/theme-runtime/information/profiles/counterform-choir');
const { profile: aftergardenProfile } = require('../src/theme-runtime/information/profiles/aftergarden');
const { profile: vesperfoldProfile } = require('../src/theme-runtime/information/profiles/vesperfold');
const { extractThemeInformationProfiles } = require('./lib/theme-information-map');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8');

assert.equal(contract.INFORMATION_CONTRACT_VERSION, 1);
assert.deepEqual(registry.listBundles().map((entry) => entry.key).sort(), [
  'artwork.summary',
  'collection.summary',
  'output.route',
  'playback.neighborhood',
  'playback.technical',
  'queue.summary',
]);
assert.equal(registry.hasProfile('counterform-choir'), true);
assert.equal(registry.hasProfile('aftergarden'), true);
assert.equal(registry.hasProfile('vesperfold'), true);
assert.equal(contract.validateProfile(profile).valid, true);
assert.equal(contract.validateProfile(aftergardenProfile).valid, true);
assert.equal(contract.validateProfile(vesperfoldProfile).valid, true);
assert.equal(contract.validateProfile({ ...profile, regions: [{ slot: 'hero.overlay', markup: '<button onclick="bad()">x</button>' }] }).valid, false, 'profiles must reject executable markup');

const tracks = [
  { id: 'a', title: 'Before', artist: 'One', format: 'flac', artworkPath: 'a.jpg' },
  { id: 'b', title: 'Current <Unicode> 夜', artist: 'Two', format: 'wav' },
  { id: 'c', title: 'After', artist: 'Three', format: 'mp3', artworkPath: 'c.jpg' },
];
const snapshot = {
  collection: { id: 'all', name: 'All Music', type: 'Playlist' },
  tracks: { display: tracks, collection: tracks, all: tracks },
  playback: { currentId: 'b', phase: 'playing' },
  output: { label: 'System Default', active: true },
  queue: { items: ['a', 'b', 'c'] },
};
const neighborhood = registry.resolveBundle('playback.neighborhood', snapshot);
assert.equal(neighborhood.previous.title, 'Before');
assert.equal(neighborhood.current.title, 'Current <Unicode> 夜');
assert.equal(neighborhood.next.title, 'After');
assert.equal(neighborhood.currentIndex, 1);
assert.equal(neighborhood.total, 3);
assert.equal(neighborhood.phase, 'playing');
assert.ok(Object.isFrozen(neighborhood) && Object.isFrozen(neighborhood.current), 'bundle projections must be immutable');
assert.deepEqual(registry.resolveBundle('artwork.summary', snapshot), { total: 3, missing: 1 });

const projected = profile.project({ 'playback.neighborhood': neighborhood });
assert.equal(projected.fields.voiceCount, '03');
assert.equal(projected.fields.currentPosition, '02 / 03');
assert.equal(projected.fields.playbackState, 'CONFIRMED PLAYING');
assert.equal(projected.fields.current, 'CURRENT / Current <Unicode> 夜');

class FakeField { constructor() { this.textContent = ''; } }
class FakeRoot {
  constructor(markup = '') {
    this.dataset = {};
    this.parent = null;
    this.fields = new Map();
    for (const match of markup.matchAll(/data-theme-info-field="([^"]+)"/g)) {
      if (!this.fields.has(match[1])) this.fields.set(match[1], []);
      this.fields.get(match[1]).push(new FakeField());
    }
  }
  querySelectorAll(selector) {
    const match = selector.match(/data-theme-info-field="([^"]+)"/);
    return match ? this.fields.get(match[1]) || [] : [];
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}
class FakeWrapper {
  set innerHTML(value) { this.firstElementChild = new FakeRoot(value); }
}
class FakeTarget {
  constructor() { this.children = []; }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  append(node) { node.parent = this; this.children.push(node); }
}
const heroTarget = new FakeTarget();
const playerTarget = new FakeTarget();
const fakeDocument = {
  querySelector: (selector) => selector === '#playlistHero' ? heroTarget : selector === '.player' ? playerTarget : null,
  createElement: () => new FakeWrapper(),
};
const runtime = runtimeDomain.createRuntime({ document: fakeDocument });
assert.equal(runtime.setProfile('counterform-choir'), true);
runtime.update(snapshot);
assert.equal(heroTarget.children.length, 1);
assert.equal(playerTarget.children.length, 1);
assert.equal(heroTarget.children[0].fields.get('playbackState')[0].textContent, 'CONFIRMED PLAYING');
assert.equal(playerTarget.children[0].fields.get('current')[0].textContent, 'CURRENT / Current <Unicode> 夜');
runtime.setProfile(null);
assert.equal(heroTarget.children.length, 0, 'switching to a theme without a profile must remove prior theme roots');
assert.equal(playerTarget.children.length, 0, 'profile teardown must cover every mounted region');
const incompleteHero = new FakeTarget();
const incompleteRuntime = runtimeDomain.createRuntime({
  document: {
    querySelector: (selector) => selector === '#playlistHero' ? incompleteHero : null,
    createElement: () => new FakeWrapper(),
  },
});
assert.equal(incompleteRuntime.setProfile('counterform-choir'), false, 'a missing product slot must fail closed');
assert.equal(incompleteHero.children.length, 0, 'a failed profile mount must remove partial presentation');
assert.equal(incompleteRuntime.getActiveProfile(), null, 'failed mounting must return to the neutral fallback profile');

const runtimeMap = extractThemeInformationProfiles(renderer);
assert.deepEqual(runtimeMap, { 'counterform-choir': 'counterform-choir', aftergarden: 'aftergarden', vesperfold: 'vesperfold' });
assert.ok(!index.includes('id="cfHeroCount"'), 'theme-only Counterform data must not remain prepackaged in shared index.html');
assert.ok(!index.includes('id="cfPlayerCurrent"'), 'theme-only player HUD must mount from the profile');
const scriptOrder = [
  'theme-runtime/information/contract.js',
  'theme-runtime/information/registry.js',
  'theme-runtime/information/bundles.js',
  'theme-runtime/information/runtime.js',
  'theme-runtime/information/profiles/counterform-choir.js',
  'theme-runtime/information/profiles/aftergarden.js',
  'theme-runtime/information/profiles/vesperfold.js',
  'renderer.js',
];
let previous = -1;
for (const script of scriptOrder) {
  const position = index.indexOf(`src="${script}"`);
  assert.ok(position > previous, `${script} must load after its information dependency and before renderer.js`);
  previous = position;
}

console.log('Theme information audit passed: standard truth bundles are immutable, profile markup is bounded, Counterform mounts per-theme across hero/player, and teardown removes all theme-only roots.');
