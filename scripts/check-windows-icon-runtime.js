'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const { sourceInventory, inspectAppFile } = require('./windows-package-policy');
const root = path.join(__dirname, '..');
for (const record of sourceInventory(root).filter(r => r.included)) {
  assert.ok(!/windows-(live-icon|shell-icons)\./.test(record.path), 'Runtime workers must not ship.');
}
for (const file of ['windows-live-icon.ps1', 'windows-shell-icons.ps1']) {
  assert.throws(() => inspectAppFile(`src/${file}`, Buffer.from('fixture')), /Unclassified source/);
}
assert.doesNotMatch(main, /liveIconController|refreshWindowsShellIcons|setSkipTaskbar\(/, 'Icon updates must not launch workers or hide taskbar groups.');
const applySource = main.match(/async function applyBrandIcon\(win\) \{[\s\S]*?\n\}/)?.[0];
const handlerSource = main.slice(main.indexOf("registerHandle('app:set-brand-icon'"), main.indexOf("registerOn('mini:close'"));
assert.ok(applySource && handlerSource);
(async () => {
  let handler, failAnimation = false, failPublication = false, closed = false, blocker;
  const paints = [], publications = [];
  const win = id => ({ id, isDestroyed: () => closed, setIcon: image => paints.push({ id, image }) });
  const context = vm.createContext({
    process: { platform: 'win32' }, console: { warn() {} },
    brandMark: require('../src/brand-mark'), app: {}, shell: {}, releaseIdentity: {}, profileDirectoryPath: '',
    mainWindow: win(1), miniWindow: win(2),
    brandIconImage: () => ({ isEmpty: () => false }),
    applyWindowsTaskbarIcon: async ({ win, color }) => {
      if (failPublication) throw new Error('Shortcut write refused');
      publications.push({ id: win.id, color });
    },
    brandIconAnimator: { apply: async options => {
      if (blocker) await blocker;
      if (failAnimation) throw new Error('Image conversion unavailable');
      return options.isCurrent() ? { frames: 0, effect: 'none' } : { cancelled: true };
    } },
    registerHandle: (_channel, fn) => { handler = fn; },
  });
  vm.runInContext(`let activeLogoColor='ultraviolet', activeThemeMarkAccent='', brandIconGeneration=0, brandIconSequence=Promise.resolve();\n${applySource}\n${handlerSource}`, context);
  const manual = await handler({}, 'lavender', '', 'none');
  assert.equal(manual.ok, true); assert.equal(manual.applied, true);
  assert.deepEqual(publications.map(p => p.color), ['#a98cff', '#a98cff']);
  failAnimation = true;
  assert.equal((await handler({}, 'ultraviolet', '#f11234', 'sweep')).ok, true, 'Animation failure must still publish a functional final icon.');
  assert.equal(publications.at(-1).color, '#f11234');
  failAnimation = false; failPublication = true;
  await assert.rejects(handler({}, 'electric'), /Shortcut write refused/, 'Publication failure must not be acknowledged as applied.');
  failPublication = false;
  assert.equal((await handler({}, 'electric')).ok, true, 'A failed publication must leave the sequence usable.');
  let release; blocker = new Promise(resolve => { release = resolve; });
  const old = handler({}, 'grape', '', 'sweep');
  await new Promise(resolve => setImmediate(resolve));
  const latest = handler({}, 'indigo', '', 'none');
  blocker = null; release();
  assert.equal((await old).superseded, true);
  assert.equal((await latest).ok, true);
  assert.equal(publications.at(-1).color, '#5b5bff');
  closed = true;
  assert.equal((await handler({}, 'ultraviolet')).applied, false, 'Closed windows are skipped during shutdown.');
  assert.ok(paints.some(p => p.id === 1) && paints.some(p => p.id === 2));
  console.log('Electron icon runtime passed: both windows, final static fallback, failure recovery, cancellation, shutdown and worker/package exclusion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
