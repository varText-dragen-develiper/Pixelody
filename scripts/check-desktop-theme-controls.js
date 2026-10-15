const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const controls = require('../src/desktop-theme-controls');
const appearance = {};
assert.equal(controls.imageLayout(appearance, 'all', 'cartridge-quest', ''), 'fit');
assert.equal(controls.imageLayout(appearance, 'all', 'obsession', ''), 'fill');
assert.equal(controls.saveImageLayout(appearance, 'all', 'cartridge-quest', '', 'tile'), true);
assert.equal(controls.imageLayout(appearance, 'all', 'cartridge-quest', ''), 'tile');
assert.equal(controls.imageLayout(appearance, 'all', 'cartridge-quest', 'C:/photo.png'), 'fit', 'Choosing an image must not inherit the stock image tiling.');
controls.saveImageLayout(appearance, 'all', 'cartridge-quest', 'C:/photo.png', 'stretch');
const restarted = JSON.parse(JSON.stringify(appearance));
assert.equal(controls.imageLayout(restarted, 'all', 'cartridge-quest', 'C:/photo.png'), 'stretch');
assert.equal(controls.imageLayout(restarted, 'favorites', 'cartridge-quest', 'C:/photo.png'), 'fit');
assert.equal(controls.imageLayout(restarted, 'all', 'obsession', 'C:/photo.png'), 'fill');
assert.equal(controls.imageLayout(restarted, 'all', 'cartridge-quest', ''), 'tile', 'Restoring stock art also restores its saved layout.');
assert.equal(controls.saveImageLayout(appearance, 'all', 'studio', '', 'constructor'), false);
assert.equal(controls.layouts.fit.repeat, 'no-repeat');
assert.equal(controls.layouts.stretch.repeat, 'no-repeat');
const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
assert.match(renderer, /if \(mode === 'smart'\) return \[dailyCuratedCollection\(\), \.\.\.smartCollections\(\)\]/);
for (const name of ['renderPlaylists', 'activeCollectionIndex']) {
  const start = renderer.indexOf(`function ${name}(`);
  const end = renderer.indexOf('] : groupedLibraryCollections', start);
  assert.ok(end > start);
  assert.doesNotMatch(renderer.slice(start, end), /dailyCuratedCollection\(\)/, "Today's Listen must not remain in Playlists.");
}
assert.match(renderer, /scheduleDurableStatePersist\(0, 'settings-change'\)/);
console.log('Desktop theme controls passed: per-image layout defaults, durable round trips, collection/theme isolation, invalid-value rejection, and Smart navigation.');
