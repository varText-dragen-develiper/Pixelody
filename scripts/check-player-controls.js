'use strict';

// The player bar's small controls -- mini player, queue, mute, volume, format
// badge, audio systems -- move freely along the bar while composing, collide
// with what each theme actually draws, and keep their places outside
// Composition Mode.
//
// Runs the real app (unpacked Electron, throwaway profile) and drives it with
// real mouse and keyboard input through the DevTools protocol. For each port:
//   - pressing a control while composing picks it up instead of pressing it
//   - a control dropped in free space lands where it was dropped
//   - a control dropped on the transport buttons moves to the nearest clear
//     spot, touching nothing
//   - the arrow keys nudge a selected control
//   - after saving, every placed control is where its stored position says,
//     nothing overlaps, and the controls work again
//   - double-click puts a control back where its theme draws it

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Canvas Base is left out: it opens with the transport unplaced, so there is
// no player bar on its canvas until one is placed.
const PORTS = ['dev-lab', 'orbital', 'cartridge-quest', 'ghost-index'];
const WINDOW = { width: 1440, height: 920 };

async function until(test, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await test()) return;
    await delay(100);
  }
  throw new Error(`Timeout: ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let serial = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    call,
    close: () => socket.close(),
    evaluate: async (expression) => {
      const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result?.value;
    },
  };
}

// Everything the check compares, read the way the layout itself reads it.
const PROBE = `(() => {
  const api = window.PixelodyPlayerControls;
  const layout = api.createLayout({ document });
  const box = (rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  const barElement = document.querySelector('.cw-canvas .player');
  const bar = barElement ? box(barElement.getBoundingClientRect()) : null;
  const zoom = barElement && barElement.offsetWidth ? barElement.getBoundingClientRect().width / barElement.offsetWidth : 1;
  const lines = barElement ? (() => {
    const find = (selector) => barElement.querySelector(selector);
    const drawn = (element) => {
      if (!element) return null;
      const kids = [...element.children].filter((child) => { const s = getComputedStyle(child); const r = child.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; }).map((child) => child.getBoundingClientRect());
      const rects = kids.length ? kids : [element.getBoundingClientRect()];
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    };
    const out = { 'bar-left': bar.left, 'bar-center': (bar.left + bar.right) / 2, 'bar-right': bar.right };
    const identity = drawn(find('[data-cw-product-root="now-playing"]'));
    if (identity) Object.assign(out, { 'now-playing-left': identity.left, 'now-playing-right': identity.right });
    const buttons = drawn(find('.transport-buttons'));
    if (buttons) Object.assign(out, { 'transport-left': buttons.left, 'transport-center': (buttons.left + buttons.right) / 2, 'transport-right': buttons.right });
    return out;
  })() : {};
  return {
    mode: document.body.dataset.compositionMode || '',
    status: document.querySelector('.cw-studio-live-status')?.textContent || '',
    bar, zoom, lines,
    entries: layout.entries().map((entry) => ({ key: entry.control.key, ...box(entry.rect), placed: entry.element.dataset.cwControlPlaced === 'true', selected: entry.element.dataset.cwControlSelected === 'true' })),
    blockers: layout.blockers().map((blocker) => ({ label: blocker.label, frame: Boolean(blocker.frame), ...box(blocker.box) })),
  };
})()`;

const pickPort = (key) => `(async () => {
  const select = document.getElementById('canvasThemePortSelect');
  if (!select) return 'no port select';
  if (select.value === ${JSON.stringify(key)}) return select.value;
  select.value = ${JSON.stringify(key)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if ((document.body.dataset.canvasThemePort || '') === ${JSON.stringify(key)} && !select.disabled) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
  return document.body.dataset.canvasThemePort || '';
})()`;

const press = (label) => `(() => {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.closest('[hidden]') && !candidate.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`;

const TRANSPORT_CONFIGURATION = `(async () => {
  const loaded = await window.desktop.loadWorkspaceComposition();
  const find = (node) => node.moduleKey === 'transport.controls' ? node : (node.children || []).map(find).find(Boolean);
  return find(loaded.state.graph)?.configuration || {};
})()`;

const center = (entry) => ({ x: (entry.left + entry.right) / 2, y: (entry.top + entry.bottom) / 2 });
const overlaps = (a, b, slack = 1) => a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack;

function overlapsIn(state) {
  const found = [];
  state.entries.forEach((entry, index) => {
    state.entries.slice(index + 1).forEach((other) => { if (overlaps(entry, other)) found.push(`${entry.key} overlaps ${other.key}`); });
    state.blockers.filter((blocker) => !blocker.frame).forEach((blocker) => { if (overlaps(entry, blocker)) found.push(`${entry.key} overlaps ${blocker.label}`); });
    if (entry.left < state.bar.left - 1 || entry.right > state.bar.right + 1 || entry.top < state.bar.top - 1 || entry.bottom > state.bar.bottom + 1) found.push(`${entry.key} is outside the player bar`);
  });
  return found;
}

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelody-player-controls-'));
  const env = { ...process.env, PIXELODY_DEVELOPMENT_WINDOW_WIDTH: String(WINDOW.width), PIXELODY_DEVELOPMENT_WINDOW_HEIGHT: String(WINDOW.height) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', root,
    '--pixelody-canvas-foreground', `--pixelody-dev-user-data=${profile}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let processLog = '';
  child.stdout.on('data', (data) => { processLog += data; });
  child.stderr.on('data', (data) => { processLog += data; });
  let cdp;
  const failures = [];
  const fail = (message) => { failures.push(message); console.log(`  FAIL  ${message}`); };
  try {
    let port;
    await until(async () => {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; }
    }, 'debugger startup');
    let page;
    await until(async () => {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        page = pages.find((item) => item.type === 'page' && item.url.includes('index.html'));
        return Boolean(page);
      } catch {
        return false;
      }
    }, 'main page');
    cdp = await connect(page.webSocketDebuggerUrl);
    await until(() => cdp.evaluate(`Boolean(document.body?.dataset.compositionMode && !document.body.classList.contains('theme-loading') && document.getElementById('canvasThemePortSelect') && window.PixelodyPlayerControls)`), 'Canvas startup', 30000);
    await delay(1500);

    const mouse = async (type, x, y, extra = {}) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
    const drag = async (from, to) => {
      await mouse('mouseMoved', from.x, from.y, { button: 'none' });
      await mouse('mousePressed', from.x, from.y);
      for (let step = 1; step <= 14; step += 1) {
        await mouse('mouseMoved', from.x + ((to.x - from.x) * step) / 14, from.y + ((to.y - from.y) * step) / 14);
        await delay(25);
      }
      await delay(120);
      await mouse('mouseReleased', to.x, to.y);
      await delay(700);
    };
    const click = async (at, clickCount = 1) => {
      await mouse('mouseMoved', at.x, at.y, { button: 'none' });
      await mouse('mousePressed', at.x, at.y, { clickCount });
      await mouse('mouseReleased', at.x, at.y, { clickCount });
      await delay(clickCount > 1 ? 800 : 400);
    };
    const key = async (keyName, code, keyCode) => {
      await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode });
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode });
      await delay(350);
    };
    const probe = () => cdp.evaluate(PROBE);
    const entryOf = (state, name) => state.entries.find((entry) => entry.key === name);

    for (const key0 of PORTS) {
      const name = key0 || 'canvas-base';
      console.log(`== ${name}`);
      if ((await cdp.evaluate('document.body.dataset.compositionMode')) === 'edit') { await cdp.evaluate(press('Discard draft')); await delay(700); }
      assert.equal(await cdp.evaluate(pickPort(key0)), key0, `${name}: the port did not apply.`);
      if ((await cdp.evaluate('document.body.dataset.compositionMode')) === 'edit') { await cdp.evaluate(press('Discard draft')); await delay(700); }
      assert.ok(await cdp.evaluate(press('Edit canvas')), `${name}: no way into Composition Mode.`);
      await delay(1100);
      let state = await probe();
      if (!state.bar) { fail(`${name}: no player bar on the canvas`); continue; }
      const keys = state.entries.map((entry) => entry.key);
      if (!['queue', 'mute'].every((wanted) => keys.includes(wanted))) { fail(`${name}: queue and mute are not both on the bar (${keys.join(', ')})`); continue; }
      const buttons = state.blockers.find((blocker) => blocker.label === 'Transport buttons');
      if (!buttons) { fail(`${name}: the transport buttons were not found`); continue; }

      // Pressing a control while composing picks it up; it does not press it.
      const expanded = () => cdp.evaluate(`document.querySelector('#queueButton').getAttribute('aria-expanded')`);
      const before = await expanded();
      await click(center(entryOf(state, 'queue')));
      state = await probe();
      if ((await expanded()) !== before) fail(`${name}: clicking the queue button while composing opened the queue`);
      if (!entryOf(state, 'queue').selected) fail(`${name}: clicking the queue button while composing did not select it`);

      // Dropped in free space: lands where it was dropped.
      const queue = entryOf(state, 'queue');
      const aim = { x: buttons.left - (queue.right - queue.left) / 2 - 14, y: (buttons.top + buttons.bottom) / 2 };
      await drag(center(queue), aim);
      state = await probe();
      const placedQueue = entryOf(state, 'queue');
      if (!placedQueue.placed) fail(`${name}: the queue button was not placed (${state.status})`);
      else if (!/nearest/.test(state.status) && Math.hypot(center(placedQueue).x - aim.x, center(placedQueue).y - aim.y) > 6) fail(`${name}: the queue button landed ${Math.round(center(placedQueue).x - aim.x)},${Math.round(center(placedQueue).y - aim.y)}px from where it was dropped`);

      // Dropped on the transport buttons: moved clear, touching nothing.
      await drag(center(entryOf(state, 'mute')), { x: (buttons.left + buttons.right) / 2, y: (buttons.top + buttons.bottom) / 2 });
      state = await probe();
      if (!entryOf(state, 'mute').placed) fail(`${name}: the mute button was not placed (${state.status})`);
      overlapsIn(state).forEach((problem) => fail(`${name} (composing): ${problem}`));

      // The arrow keys nudge the selected control.
      await click(center(entryOf(state, 'queue')));
      const beforeNudge = center(entryOf(await probe(), 'queue'));
      await key('ArrowLeft', 'ArrowLeft', 37);
      await key('ArrowLeft', 'ArrowLeft', 37);
      const afterNudge = center(entryOf(await probe(), 'queue'));
      const moved = beforeNudge.x - afterNudge.x;
      if (Math.abs(moved - 4 * state.zoom) > 1.5) fail(`${name}: two left-arrow presses moved the queue button ${moved.toFixed(1)}px, not 4px`);

      // Saved and outside Composition Mode: where the stored point says.
      assert.ok(await cdp.evaluate(press('Save canvas')), `${name}: could not save.`);
      await delay(1300);
      state = await probe();
      if (state.mode !== 'use') fail(`${name}: saving did not leave Composition Mode`);
      const stored = (await cdp.evaluate(TRANSPORT_CONFIGURATION)).controls || {};
      for (const [control, point] of Object.entries(stored)) {
        const entry = entryOf(state, control);
        if (!entry) { fail(`${name}: stored ${control} is not on the bar`); continue; }
        const line = state.lines[point.ref];
        const expected = { x: Number.isFinite(line) ? line + point.x * state.zoom : state.bar.left + point.fx * (state.bar.right - state.bar.left), y: state.bar.top + point.y * (state.bar.bottom - state.bar.top) };
        const actual = center(entry);
        // The layout keeps a control inside the bar, so a stored point near an
        // edge may be pulled in; allow for that and for rounding.
        if (Math.abs(actual.x - expected.x) > 2.5 && entry.left > state.bar.left + 1 && entry.right < state.bar.right - 1) fail(`${name}: ${control} is ${Math.round(actual.x - expected.x)}px from its stored place outside Composition Mode`);
        if (Math.abs(actual.y - expected.y) > 2.5 && entry.top > state.bar.top + 1 && entry.bottom < state.bar.bottom - 1) fail(`${name}: ${control} is ${Math.round(actual.y - expected.y)}px from its stored height outside Composition Mode`);
      }
      overlapsIn(state).forEach((problem) => fail(`${name} (outside Composition Mode): ${problem}`));
      const mutedBefore = await cdp.evaluate(`document.querySelector('#muteButton').getAttribute('aria-pressed')`);
      await click(center(entryOf(state, 'mute')));
      const mutedAfter = await cdp.evaluate(`document.querySelector('#muteButton').getAttribute('aria-pressed')`);
      if (mutedBefore === mutedAfter) fail(`${name}: the moved mute button does not work outside Composition Mode`);
      if (mutedAfter !== mutedBefore) await click(center(entryOf(state, 'mute')));

      // Double-click puts it back.
      assert.ok(await cdp.evaluate(press('Edit canvas')), `${name}: no way back into Composition Mode.`);
      await delay(1100);
      state = await probe();
      await click(center(entryOf(state, 'queue')), 2);
      state = await probe();
      if (entryOf(state, 'queue').placed) fail(`${name}: double-click did not put the queue button back`);
      await cdp.evaluate(press('Discard draft'));
      await delay(700);
      console.log(`  queue ${stored.queue ? `${stored.queue.ref} ${stored.queue.x}px` : 'unplaced'}, mute ${stored.mute ? `${stored.mute.ref} ${stored.mute.x}px` : 'unplaced'}`);
    }
  } finally {
    try { await cdp?.call('Browser.close'); } catch {}
    cdp?.close();
    await until(async () => child.exitCode !== null, 'owned Electron exit', 7000).catch(async () => {
      if (process.platform === 'win32') {
        // PID comes from this script's own child, never an enumerated user app.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        await new Promise((resolve) => killer.once('exit', resolve));
      } else {
        child.kill('SIGKILL');
      }
    });
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  if (failures.length) {
    if (process.env.PIXELODY_CHECK_VERBOSE) console.error(processLog.slice(-4000));
    console.error(`${failures.length} player-control check(s) failed.`);
    process.exit(1);
  }
  console.log('Player controls move, collide with what each theme draws, keep their places, and still work.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
