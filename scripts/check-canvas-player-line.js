'use strict';

// Where a pane meets the player, in the real app, on both sides of
// Composition Mode.
//
// Every earlier check of this ran on a hand-built page with three of the
// app's stylesheets, and the thing that was wrong lived in the rest: in the
// development host the canvas keeps a launcher strip above the composition,
// and a ported theme states its band against the window as its archive
// measured it -- from under the header -- so band plus player ran past the
// window by the strip. In Composition Mode the player sat below the window;
// outside it the player was drawn over the bottom of every pane that met it.
// A pane stretched flush onto the player while composing ended up behind it.
//
// This launches unpacked Electron on a throwaway profile, picks each port,
// and compares the same panes against the same player in both modes, and
// checks the composition reaches the bottom of the window (Cartridge Quest
// used to end 128px short of it). It also
// opens Composition Mode a second time, because the artboard used to be
// measured mid-transition on re-entry and was then laid out under the rail.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PORTS = ['dev-lab', 'orbital', 'obsidian-glass', 'ghost-index', 'cartridge-quest'];
// A theme may keep a margin under its player, but not a band of empty window.
const BOTTOM_SLACK = 16;
const WINDOW = { width: 1440, height: 920 };
const TOLERANCE = 2;

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

// The composition's own panes, the player, and the rail, as the window has
// them.
const MEASURE = `(() => {
  const rect = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }; };
  const grid = document.querySelector('.cw-canvas > .cw-root > .cw-split > .cw-grid');
  const panes = [...(grid ? grid.children : [])].filter((node) => node.dataset.cwNodeId).map((node) => ({ id: node.dataset.cwNodeId, ...rect(node) }));
  const rail = [...document.querySelectorAll('.cw-studio-rail, [data-cw-studio-rail]')].find((element) => !element.hidden);
  return {
    mode: document.body.dataset.compositionMode || '',
    port: document.body.dataset.canvasThemePort || '',
    height: innerHeight,
    player: rect(document.querySelector('.cw-dock[data-cw-anchored=".player"] > .player')),
    panes,
    railRight: rail ? rail.getBoundingClientRect().right : 0,
  };
})()`;

const press = (label) => `(() => {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.closest('[hidden]') && !candidate.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`;

const pickPort = (key) => `(async () => {
  const select = document.getElementById('canvasThemePortSelect');
  if (!select) return 'no port select';
  select.value = ${JSON.stringify(key)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (document.body.dataset.canvasThemePort === ${JSON.stringify(key)} && !select.disabled) return document.body.dataset.canvasThemePort;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return document.body.dataset.canvasThemePort || '';
})()`;

// How far each pane's bottom sits above the player's top. Negative is under
// the player.
function gaps(state) {
  return Object.fromEntries(state.panes.map((pane) => [pane.id, Math.round(state.player.top - pane.bottom)]));
}

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelody-player-line-'));
  const env = {
    ...process.env,
    PIXELODY_DEVELOPMENT_WINDOW_WIDTH: String(WINDOW.width),
    PIXELODY_DEVELOPMENT_WINDOW_HEIGHT: String(WINDOW.height),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', root,
    '--pixelody-canvas-foreground', `--pixelody-dev-user-data=${profile}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let processLog = '';
  child.stdout.on('data', (data) => { processLog += data; });
  child.stderr.on('data', (data) => { processLog += data; });
  let cdp;
  const failures = [];
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
    await until(() => cdp.evaluate(`Boolean(document.body?.dataset.compositionMode && !document.body.classList.contains('theme-loading') && document.getElementById('canvasThemePortSelect'))`), 'Canvas startup', 30000);
    await delay(1500);

    for (const key of PORTS) {
      assert.equal(await cdp.evaluate(pickPort(key)), key, `${key}: the port did not apply.`);
      if ((await cdp.evaluate('document.body.dataset.compositionMode')) === 'edit') {
        await cdp.evaluate(press('Discard draft'));
        await delay(600);
      }
      await delay(800);
      const use = await cdp.evaluate(MEASURE);
      assert.equal(use.mode, 'use');
      assert.ok(await cdp.evaluate(press('Edit canvas')), `${key}: no way into Composition Mode.`);
      await delay(1200);
      const edit = await cdp.evaluate(MEASURE);
      assert.equal(edit.mode, 'edit');
      await cdp.evaluate(press('Discard draft'));
      await delay(800);
      assert.ok(await cdp.evaluate(press('Edit canvas')), `${key}: no way back into Composition Mode.`);
      await delay(1200);
      const again = await cdp.evaluate(MEASURE);
      await cdp.evaluate(press('Discard draft'));
      await delay(800);

      const useGaps = gaps(use);
      const editGaps = gaps(edit);
      const line = `${key}: player ${Math.round(use.player.top)}-${Math.round(use.player.bottom)} outside, ${Math.round(edit.player.top)}-${Math.round(edit.player.bottom)} composing; pane gaps outside ${JSON.stringify(useGaps)}, composing ${JSON.stringify(editGaps)}`;
      console.log(line);
      for (const [id, gap] of Object.entries(useGaps)) {
        if (gap < -TOLERANCE) failures.push(`${key}: ${id} runs ${-gap}px under the player outside Composition Mode.`);
        if (!(id in editGaps)) failures.push(`${key}: ${id} is not on the canvas while composing.`);
        else if (Math.abs(gap - editGaps[id]) > TOLERANCE) failures.push(`${key}: ${id} is ${editGaps[id]}px above the player while composing but ${gap}px outside.`);
      }
      if (edit.player.bottom > edit.height + TOLERANCE) failures.push(`${key}: the player runs ${Math.round(edit.player.bottom - edit.height)}px past the window while composing.`);
      if (use.player.bottom > use.height + TOLERANCE) failures.push(`${key}: the player runs ${Math.round(use.player.bottom - use.height)}px past the window outside Composition Mode.`);
      if (use.height - use.player.bottom > BOTTOM_SLACK) failures.push(`${key}: everything ends ${Math.round(use.height - use.player.bottom)}px above the bottom of the window outside Composition Mode.`);
      if (edit.height - edit.player.bottom > BOTTOM_SLACK) failures.push(`${key}: everything ends ${Math.round(edit.height - edit.player.bottom)}px above the bottom of the window while composing.`);
      const firstLeft = Math.min(...edit.panes.map((pane) => pane.left));
      const againLeft = Math.min(...again.panes.map((pane) => pane.left));
      if (Math.abs(firstLeft - againLeft) > TOLERANCE) failures.push(`${key}: reopening Composition Mode moved the artboard from ${Math.round(firstLeft)}px to ${Math.round(againLeft)}px.`);
      if (again.railRight && againLeft < again.railRight - TOLERANCE) failures.push(`${key}: reopened, the composition starts under the rail (${Math.round(againLeft)}px < ${Math.round(again.railRight)}px).`);
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
    console.error(failures.join('\n'));
    if (process.env.PIXELODY_CHECK_VERBOSE) console.error(processLog.slice(-4000));
    process.exit(1);
  }
  console.log('The player line holds: every pane meets the player on the same pixels in Composition Mode and outside it.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
