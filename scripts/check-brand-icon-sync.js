'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const brandMark = require('../src/brand-mark');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const functionSource = (name) => {
  const match = renderer.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `renderer.js no longer defines ${name}`);
  return match[0];
};
const context = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(`${functionSource('createBrandIconSynchronizer')}; this.createSync = createBrandIconSynchronizer;`, context);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const calls = [], timers = new Map(), errors = [];
  let timerId = 0;
  const request = context.createSync({
    apply: (logoColor, accent) => new Promise((resolve, reject) => calls.push({ logoColor, accent, resolve, reject })),
    schedule: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    cancel: (id) => timers.delete(id),
    onError: (error) => errors.push(error),
  });
  const retry = () => {
    assert.equal(timers.size, 1, 'Only one retry may be scheduled.');
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.callback();
    return timer.delay;
  };
  return { request, calls, timers, errors, retry };
}

(async () => {
  const latest = harness();
  latest.request('ultraviolet', '#f11234');
  latest.request('ultraviolet', '#6435ff');
  latest.request('lavender', '');
  assert.equal(latest.calls.length, 1, 'Native icon updates must be serialized.');
  latest.calls[0].resolve({ ok: true, applied: true });
  await settle();
  assert.deepEqual(latest.calls.map(({ logoColor, accent }) => [logoColor, accent]), [['ultraviolet', '#f11234'], ['lavender', '']], 'An intermediate color is superseded by the latest choice.');
  latest.calls[1].resolve({ ok: true, applied: true });
  await settle();
  latest.request('lavender', '');
  assert.equal(latest.calls.length, 2, 'A successfully acknowledged current icon is cached.');

  for (const failStale of [false, true]) {
    const revert = harness();
    revert.request('lavender', '');
    revert.calls[0].resolve({ ok: true, applied: true });
    await settle();
    revert.request('ultraviolet', '#f11234');
    revert.request('lavender', '');
    if (failStale) revert.calls[1].reject(new Error('Partial native failure'));
    else revert.calls[1].resolve({ ok: true, applied: true });
    await settle();
    assert.equal(revert.calls.length, 3, 'Returning to the prior color must reapply it after an in-flight different color.');
    assert.equal(revert.calls[2].logoColor, 'lavender');
    assert.equal(revert.timers.size, 0, 'A stale failure must not retry the superseded color.');
    revert.calls[2].resolve({ ok: true, applied: true });
    await settle();
  }

  const recover = harness();
  recover.request('electric');
  recover.calls[0].resolve({ ok: true, applied: false });
  await settle();
  assert.equal(recover.retry(), 120, 'An unapplied acknowledgement must retry.');
  recover.calls[1].resolve({ ok: true, applied: true });
  await settle();
  recover.request('electric');
  assert.equal(recover.calls.length, 2);
  assert.equal(recover.errors.length, 1);

  const supersede = harness();
  supersede.request('grape');
  supersede.calls[0].reject(new Error('Native update unavailable'));
  await settle();
  supersede.request('indigo');
  assert.equal(supersede.timers.size, 0, 'A new choice cancels an old retry.');
  assert.equal(supersede.calls[1].logoColor, 'indigo');
  supersede.calls[1].resolve({ ok: true, applied: true });
  await settle();

  const bounded = harness();
  bounded.request('ultraviolet');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    bounded.calls[attempt].reject(new Error('Persistent native failure'));
    await settle();
    if (attempt < 3) bounded.retry();
  }
  assert.equal(bounded.calls.length, 4, 'Automatic retries must have a finite budget.');
  assert.equal(bounded.timers.size, 0);
  bounded.request('ultraviolet');
  assert.equal(bounded.calls.length, 5, 'Failure must not be cached as successful application.');
  bounded.calls[4].resolve({ ok: true, applied: true });
  await settle();

  const state = { logoColor: 'ultraviolet', logoFollowsTheme: true, canvasThemePort: 'obsession' };
  const persisted = [];
  let renderedMark;
  const settingsContext = vm.createContext({
    appearance: state,
    brandMarkDomain: brandMark,
    applyAppearance: () => { renderedMark = brandMark.resolveMarkColor({ ...state, themeAccent: '#f11234' }); },
    scheduleDurableStatePersist: (delay, reason) => persisted.push({ delay, reason, appearance: { ...state } }),
  });
  vm.runInContext(`${functionSource('selectLogoColor')}; selectLogoColor('lavender');`, settingsContext);
  assert.equal(renderedMark.hex, '#a98cff', 'A manual color overrides the current theme immediately.');
  assert.equal(persisted.length, 1, 'Swatch clicks must reach durable persistence without waiting for an unrelated form change.');
  assert.equal(persisted[0].delay, 0);
  assert.equal(persisted[0].reason, 'settings-change');
  assert.equal(persisted[0].appearance.logoColor, 'lavender');
  assert.equal(persisted[0].appearance.logoFollowsTheme, false);

  const themeSelections = [];
  let canvasActive = true, draftDirty = true, disabled = false;
  const themeContext = vm.createContext({
    appearance: state,
    developmentSessionIsolated: false,
    rememberCanvasThemeGraph: () => {},
    canvasOptIn: true,
    canvasLaunchDismissed: false,
    CANVAS_OPT_IN_KEY: 'pixelody.canvasStudioOptIn',
    canvasStageActive: () => canvasActive,
    productionWorkspaceHost: { snapshot: () => ({ session: { dirty: draftDirty } }) },
    showToast: () => {},
    setLocalStorageItem: () => {},
    disableCanvasStageStyles: () => { disabled = true; canvasActive = false; },
    $: () => null,
    selectTheme: async (theme) => themeSelections.push({ theme, follows: state.logoFollowsTheme }),
  });
  vm.runInContext(`${functionSource('selectThemeFromSettings')}; this.select = selectThemeFromSettings;`, themeContext);
  await themeContext.select('studio');
  assert.equal(themeSelections.length, 0, 'An unsaved composition blocks Studio without changing the logo choice.');
  assert.equal(state.logoFollowsTheme, false);
  draftDirty = false;
  await themeContext.select('studio');
  assert.deepEqual(themeSelections, [{ theme: 'studio', follows: true }]);
  assert.equal(disabled, true, 'Selecting Studio must leave Canvas before selecting the theme.');
  assert.equal(brandMark.resolveMarkColor({ ...state, themeAccent: '' }).hex, '#a98cff', 'Studio restores the chosen purple.');
  assert.doesNotMatch(functionSource('selectTheme'), /appearance\.logoFollowsTheme\s*=/, 'Internal/startup theme selection must preserve a saved manual logo choice.');

  const portMatch = renderer.match(/const applyPortSelection = async \(\) => \{([\s\S]*?)\n  \};\n  portSelect\.addEventListener/);
  assert.ok(portMatch, 'The Canvas port selection handler is missing.');
  let portOk = false;
  const portContext = vm.createContext({
    appearance: state,
    rememberCanvasThemeGraph: () => {},
    showThemeLoadScreen: () => false,
    nextThemeLoadDuration: () => 0,
    performance: { now: () => 0 },
    syncDesktopPresentationSelection: () => {},
    syncDesktopPresentationNavigation: () => {},
    portSelect: { value: 'cartridge-quest', disabled: false },
    canvasThemePortDomain: { normalizeKey: (key) => key, get: (key) => ({ key, name: key }), graphForPort: () => ({}) },
    canvasStageActive: () => true,
    syncProductionWorkspaceHost: async () => {},
    productionWorkspaceHost: { applyThemePreset: async () => ({ ok: portOk }) },
    paintPort: () => {},
    showToast: () => {},
    applyAppearance: () => { renderedMark = brandMark.resolveMarkColor({ ...state, themeAccent: '#6435ff' }); },
    navigationDispatcher: { setMechanic: () => false },
    activeTrackNavigationMechanic: () => 'linear-list',
    scheduleDurableStatePersist: (delay, reason) => persisted.push({ delay, reason, appearance: { ...state } }),
  });
  vm.runInContext(`this.selectPort = async () => {${portMatch[1]}\n};`, portContext);
  state.logoFollowsTheme = false;
  await portContext.selectPort();
  assert.equal(state.logoFollowsTheme, false, 'A rejected preset preserves the manual choice.');
  portOk = true;
  portContext.portSelect.value = 'cartridge-quest';
  await portContext.selectPort();
  assert.equal(renderedMark.hex, '#6435ff', 'A successful user theme selection resumes theme following.');
  assert.equal(persisted.at(-1).appearance.logoFollowsTheme, true);

  console.log('Brand icon synchronization passed: latest choice wins, failures retry, manual colors persist, and successful theme choices resume following.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
