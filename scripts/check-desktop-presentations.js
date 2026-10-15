const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const registry = require('../src/themes/built-in-themes.json');
const ports = require('../src/theme-runtime/canvas-theme-ports');
const contract = require('../src/workspace-composition/contract');
const packagePolicy = require('./windows-package-policy');

// Validate the shipping dependency closure, independently of the theme loader.
// A recipe that works from a development checkout must also survive packaging.
const inventory = new Set(packagePolicy.sourceInventory(root, false).filter(entry => entry.included).map(entry => entry.path));
assert.deepEqual(registry.compositionPresentations.map(entry => entry.runtimeKey), ports.RELEASE_KEYS);
for (const entry of registry.compositionPresentations) {
  assert(ports.get(entry.runtimeKey)?.experience, `${entry.runtimeKey} has no listening experience`);
  const validated = contract.validateGraph(ports.graphForPort(entry.runtimeKey));
  assert(validated.valid, JSON.stringify(validated.errors));
  for (const relative of [entry.recipe, ...entry.mainStyles, ...entry.miniStyles]) {
    const absolute = path.resolve(root, 'src/themes', relative);
    const file = path.relative(root, absolute).replaceAll('\\', '/');
    assert(inventory.has(file), `Production package omits ${file}`);
    if (!file.endsWith('.css')) continue;
    const css = fs.readFileSync(absolute, 'utf8');
    for (const match of css.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) {
      if (/^(?:data:|https?:|#)/.test(match[1])) continue;
      const asset = path.relative(root, path.resolve(path.dirname(absolute), match[1])).replaceAll('\\', '/');
      assert(inventory.has(asset), `Production package omits ${asset}, referenced by ${file}`);
    }
  }
}
console.log('Desktop presentation recipes, graph validity, and production assets passed.');
