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

// Exercise the real Settings coordinator: a refused/failed atomic port switch
// must leave the picker open instead of appearing to accept the selection.
const vm = require('node:vm');
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8');
const selectionFunctions = renderer.slice(renderer.indexOf('async function selectDesktopPresentation('), renderer.indexOf('function installDesktopPresentations('));
function pickerContext(apply) {
  const status = { textContent: '', hidden: true };
  const select = { value: 'obsession' };
  const context = {
    canvasThemePortDomain: ports, canvasRuntimeReady: () => true, canvasStageActive: () => true,
    desktopPresentationChanging: false, appearance: { canvasThemePort: 'obsession' },
    $: selector => selector === '#desktopThemeStatus' ? status : select,
    applyDesktopPortSelection: apply, syncDesktopPresentationNavigation: () => {},
    closeSettings: () => { context.closed++; }, showToast: message => { context.toast = message; }, closed: 0,
  };
  vm.createContext(context); vm.runInContext(selectionFunctions, context);
  return { context, status, select };
}
(async () => {
  const refused = pickerContext(async () => false);
  await refused.context.applyDesktopPresentationFromSettings('cartridge-quest');
  assert.equal(refused.context.closed, 0);
  assert.equal(refused.context.appearance.canvasThemePort, 'obsession');
  assert.equal(refused.context.desktopPresentationChanging, false);

  const failed = pickerContext(async () => { throw new Error('Workspace commit refused.'); });
  await failed.context.applyDesktopPresentationFromSettings('cartridge-quest');
  assert.equal(failed.context.closed, 0);
  assert.equal(failed.status.hidden, false);
  assert.equal(failed.status.textContent, 'Workspace commit refused.');
  assert.equal(failed.context.desktopPresentationChanging, false);

  let finish;
  const pending = pickerContext(() => new Promise(resolve => { finish = resolve; }));
  const first = pending.context.applyDesktopPresentationFromSettings('cartridge-quest');
  await pending.context.applyDesktopPresentationFromSettings('obsession');
  assert.equal(pending.context.closed, 0);
  finish(true); await first;
  assert.equal(pending.context.closed, 1);
  assert.equal(pending.context.desktopPresentationChanging, false);

  const unavailable = pickerContext(async () => true);
  unavailable.context.canvasRuntimeReady = () => false;
  await unavailable.context.applyDesktopPresentationFromSettings('cartridge-quest');
  assert.equal(unavailable.context.closed, 0);
  console.log('Desktop theme selection: rejection, commit failure, in-flight switching and unavailable authority passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
