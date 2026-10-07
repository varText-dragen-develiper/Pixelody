// Measures how the real app feels under the interactions people use most:
// opening panels, switching collections, starting and skipping tracks, hover,
// press and scrolling. For each interaction it reports
//   firstFrameMs  input -> the first frame the page gets to run in
//   paintedMs     input -> the frame after the visible state change (event
//                 timing "duration": input delay + handlers + paint)
//   frames        longest frame gap, frames over 24 ms and over 50 ms
//   longTasks     main-thread tasks over 50 ms during the window
//   layouts/styles  layout and style recalculation counts
// Input is delivered as real pointer events through the DevTools protocol so
// the path under test is the one a mouse takes.
//   node scripts/measure-interactions.js [--tracks=2000] [--runs=7] [--label=name] [--out=file.json]
//     [--motion=expressive|calm|off] [--performance=balanced|conserve]
// Linux: wrap in xvfb-run. Numbers from software rendering (CI, no GPU) are
// pessimistic; compare labels from the same machine, not across machines.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PixelodyStateStore } = require('../src/state-store');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const count = Number(arg('tracks', '2000'));
const runs = Math.max(3, Number(arg('runs', '7')));
const label = arg('label', 'run');
const outFile = arg('out', '');
const motion = arg('motion', 'expressive');
const performanceMode = arg('performance', 'balanced');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, name, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await delay(100); }
  throw new Error(`Timeout waiting for ${name}`);
}

function wave(frequency, seconds = 30, rate = 8000) {
  const frames = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 0.12 * 32767), 44 + i * 2);
  return buffer;
}

function fixtureValues(file) {
  const base = { path: file, album: 'Generated Signals', format: 'WAV', codec: 'PCM', duration: 30, sampleRate: 8000, bitDepth: 16, bitrate: 128000, channels: 1, lossless: true, metadataVersion: 1, missing: false };
  const library = Array.from({ length: count }, (_, i) => ({ ...base, id: `spec-${i}`, title: `Synthetic ${String(i).padStart(5, '0')}`, artist: `Artist ${i % 40}`, album: `Album ${i % 100}`, dateAdded: count - i }));
  const ids = library.map((t) => t.id);
  return {
    'aurelia.library': library,
    'aurelia.playlists': [{ id: 'all', name: 'All Music', trackIds: ids, background: null }, { id: 'mix', name: 'Mix', trackIds: ids.slice(0, 20), background: null }],
    'aurelia.tunings': {}, 'aurelia.systems': {}, 'aurelia.activePlaylist': 'all',
    'pixelody.spatialProfiles': {}, 'pixelody.speakerSystems': [], 'pixelody.activeSpeakerSystemId': '',
    'pixelody.libraryMode': 'playlists', 'pixelody.collectionBackgrounds': {}, 'pixelody.favorites': [],
    'pixelody.history': [], 'pixelody.playCounts': {}, 'pixelody.signalJournal': {}, 'pixelody.signalSettings': {},
    'pixelody.migrationReports': [], 'pixelody.wantedTracks': [], 'pixelody.queue': ids.slice(0, 20),
    'pixelody.shuffle': false, 'pixelody.flowShuffle': {}, 'pixelody.repeat': 'off', 'pixelody.sort': 'added-desc',
    'pixelody.eqModes': { track: 'simple', system: 'simple' }, 'pixelody.systemTuningMode': {},
    'pixelody.speakerSystemPrototype': {},
    'pixelody.appearance': { theme: 'studio', palette: 'gold', detail: 'balanced', motion },
    'pixelody.motionEffects': {}, 'pixelody.interfaceSounds': { mode: 'off', volume: 0 }, 'pixelody.layout': {},
    'pixelody.profileImage': '', 'pixelody.cartridgeQuestStats': {}, 'pixelody.outputDeviceId': '',
    'pixelody.outputDeviceLabel': 'System Default', 'pixelody.volume': 0, 'pixelody.session': { id: 'spec-0', time: 0, volume: 0 },
    'pixelody.collapsedCards': {}, 'pixelody.collapsedSettingGroups': {}, 'pixelody.settingsTab': 'themes',
    'pixelody.signalOrbitRepair': 'visible-ring-v1',
  };
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
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Page script failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
    return result.result.value;
  };
  return { call, evaluate, close: () => socket.close() };
}

// Installed once in the page. From the moment an input event reaches the page
// it records the first frame callback, every later frame gap, long tasks and
// event-timing entries, until stop() is called.
const PROBE = `(() => {
  if (window.__probe) return true;
  const probe = { entries: [], longTasks: [], gaps: [], firstFrame: null, inputAt: null, active: false, raf: 0, last: 0 };
  const note = (e) => { if (!probe.active) return; if (probe.inputAt === null) { probe.inputAt = e.timeStamp; probe.firstFrame = null; } };
  for (const type of ['pointerdown', 'pointerup', 'click', 'mousedown', 'mouseover', 'pointermove', 'wheel', 'keydown']) addEventListener(type, note, { capture: true, passive: true });
  try { new PerformanceObserver((list) => { if (probe.active) for (const e of list.getEntries()) probe.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch {}
  try { new PerformanceObserver((list) => { if (probe.active) for (const e of list.getEntries()) probe.entries.push({ name: e.name, duration: e.duration }); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch {}
  const tick = (t) => {
    if (!probe.active) return;
    if (probe.inputAt !== null && probe.firstFrame === null) probe.firstFrame = t - probe.inputAt;
    if (probe.last) probe.gaps.push(t - probe.last);
    probe.last = t;
    probe.raf = requestAnimationFrame(tick);
  };
  probe.start = () => { Object.assign(probe, { entries: [], longTasks: [], gaps: [], firstFrame: null, inputAt: null, active: true, last: 0 }); probe.raf = requestAnimationFrame(tick); return true; };
  probe.stop = () => { probe.active = false; cancelAnimationFrame(probe.raf); return { firstFrame: probe.firstFrame, gaps: probe.gaps, longTasks: probe.longTasks, events: probe.entries }; };
  window.__probe = probe;
  return true;
})()`;

const centerOf = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;

const median = (list) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const round = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const FIELDS = ['firstFrameMs', 'paintedMs', 'settledMs', 'maxGapMs', 'over24', 'over50', 'longTasks', 'longTaskMs', 'layouts', 'styles', 'styleMs', 'layoutMs', 'scriptMs'];

async function main() {
  const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixelody-interactions-'));
  const profile = path.join(testRoot, 'profile');
  await fsp.mkdir(profile, { recursive: true });
  const media = path.join(testRoot, 'tone.wav');
  await fsp.writeFile(media, wave(330));
  const store = new PixelodyStateStore({ directory: path.join(profile, 'state'), backupIntervalMs: 0 });
  if (!store.commitSync(fixtureValues(media), { reason: 'interaction-fixture' })?.ok) throw new Error('Could not seed the generated profile.');

  const env = { ...process.env, PIXELODY_DEVELOPMENT_WINDOW_WIDTH: '1440', PIXELODY_DEVELOPMENT_WINDOW_HEIGHT: '900', PIXELODY_DEVELOPMENT_MAXIMIZED: '0' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PIXELODY_TEST_MODE', 'PIXELODY_TEST_LAUNCH', 'PIXELODY_CANVAS_PROFILE']) delete env[key];
  const args = ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--mute-audio'];
  // Same switches check-spec-budget uses: hosted Linux has no GPU and no setuid sandbox helper.
  if (process.platform === 'linux') args.push('--disable-gpu', '--disable-gpu-compositing', '--no-sandbox');
  args.push(root, `--pixelody-dev-user-data=${profile}`);
  const launchedAt = Date.now();
  const child = spawn(require('electron'), args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; }); child.stderr.on('data', (d) => { output += d; });
  let cdp;
  const report = { label, platform: `${process.platform}/${process.arch}`, cpus: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), tracks: count, runs, motion, performance: performanceMode, interactions: {} };
  try {
    let port;
    await until(() => { try { [port] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); return Boolean(port); } catch { return false; } }, 'debug port');
    let page;
    await until(async () => { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page' && p.url.includes('index.html')); return Boolean(page); }, 'main window');
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.call('Runtime.enable'); await cdp.call('Page.bringToFront'); await cdp.call('Performance.enable');
    await until(() => cdp.evaluate(`Boolean(document.body?.dataset.startupReveal==='normal'&&!document.body.classList.contains('theme-loading'))`), 'startup reveal');
    report.readyMs = Date.now() - launchedAt;
    report.bootLongTasks = await cdp.evaluate(`new Promise((resolve) => { const out = []; try { new PerformanceObserver((l) => { out.push(...l.getEntries().map((e) => Math.round(e.duration))); }).observe({ type: 'longtask', buffered: true }); } catch {} setTimeout(() => resolve(out), 400); })`);
    if (performanceMode !== 'balanced') await cdp.evaluate(`document.body.dataset.performance=${JSON.stringify(performanceMode)}, true`);
    await cdp.evaluate(PROBE);
    await delay(2500);

    const metrics = async () => Object.fromEntries((await cdp.call('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const mouse = (type, x, y, extra = {}) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, ...extra });
    const move = (x, y) => mouse('mouseMoved', x, y, { button: 'none', buttons: 0 });

    // One measured interaction: `act` sends the input, `settled` says when the
    // visible result is complete. The window runs until `settled` is true,
    // with a floor so trailing animation frames are counted too. The first
    // pass warms caches and is discarded.
    async function measure(name, act, settled, { floorMs = 700, reset } = {}) {
      const samples = [];
      for (let i = 0; i < runs + 1; i += 1) {
        await cdp.evaluate(`window.__probe.start()`);
        const before = await metrics();
        const startedAt = Date.now();
        await act();
        let settledMs = null;
        try { await until(async () => (await cdp.evaluate(settled)) === true, name, 4000); settledMs = Date.now() - startedAt; } catch { settledMs = null; }
        await delay(Math.max(0, floorMs - (Date.now() - startedAt)));
        const win = JSON.parse(await cdp.evaluate(`JSON.stringify(window.__probe.stop())`));
        const after = await metrics();
        if (i > 0) {
          const gaps = win.gaps.slice(1);
          samples.push({
            firstFrameMs: win.firstFrame,
            paintedMs: win.events.length ? Math.max(...win.events.map((e) => e.duration)) : null,
            settledMs,
            maxGapMs: gaps.length ? Math.max(...gaps) : null,
            over24: gaps.filter((g) => g > 24).length,
            over50: gaps.filter((g) => g > 50).length,
            longTasks: win.longTasks.length,
            longTaskMs: win.longTasks.reduce((a, b) => a + b, 0),
            layouts: after.LayoutCount - before.LayoutCount,
            styles: after.RecalcStyleCount - before.RecalcStyleCount,
            styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
            layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
            scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
          });
        }
        if (reset) { await reset(); await delay(300); }
      }
      const pick = (field) => round(median(samples.map((s) => s[field]).filter((v) => v !== null && v !== undefined)));
      report.interactions[name] = Object.fromEntries(FIELDS.map((f) => [f, pick(f)]));
      console.error(`${name}: first frame ${pick('firstFrameMs')} ms, painted ${pick('paintedMs')} ms, settled ${pick('settledMs')} ms, worst gap ${pick('maxGapMs')} ms, long tasks ${pick('longTasks')}`);
    }

    const click = (selector) => async () => {
      const at = await cdp.evaluate(centerOf(selector));
      if (!at) throw new Error(`No visible element for ${selector}`);
      await move(at.x, at.y);
      await mouse('mousePressed', at.x, at.y); await mouse('mouseReleased', at.x, at.y);
    };
    const visible = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el && el.offsetWidth > 0 && !el.closest('.hidden')); })()`;
    const hidden = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !el || el.classList.contains('hidden') || el.offsetWidth === 0; })()`;
    const escape = () => cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() => cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
    const reopenSettings = async () => { await cdp.evaluate(`document.querySelector('#settingsButton').click()`); await delay(600); };

    await measure('open-settings', click('#settingsButton'), visible('.settings-drawer'), { reset: escape });
    await reopenSettings();
    await measure('close-settings', click('#closeSettings'), hidden('#settingsOverlay'), { reset: reopenSettings });
    await escape(); await delay(400);
    await measure('open-queue', click('#queueButton'), visible('#queueDrawer'), { reset: escape });
    await measure('open-jams', click('#jamsButton'), visible('.jams-drawer'), { reset: escape });
    await measure('open-systems', click('#systemsButton'), visible('#systemsView'), { reset: () => cdp.evaluate(`navigateBack()`) });
    await measure('switch-collection', click('#playlistList .playlist-item:nth-child(2)'), `document.querySelector('#playlistList .playlist-item:nth-child(2)')?.classList.contains('active')===true&&document.querySelectorAll('#trackRows .track-row').length>0`, { reset: click('#playlistList .playlist-item:nth-child(1)') });
    await measure('start-track', click('#trackRows .track-row:nth-child(3)'), `document.querySelector('#trackRows .track-row:nth-child(3)')?.classList.contains('playing')===true`, { reset: () => cdp.evaluate(`playTrack('spec-1')`) });
    await cdp.evaluate(`window.__lastTitle=document.querySelector('#playerTitle').textContent`);
    await measure('skip-track', click('#nextButton'), `document.querySelector('#playerTitle').textContent!==window.__lastTitle`, { reset: () => cdp.evaluate(`(async()=>{await playTrack('spec-1');window.__lastTitle=document.querySelector('#playerTitle').textContent})()`) });
    await measure('pause-play', click('#playButton'), 'true', { floorMs: 500 });
    await measure('hover-row', async () => { const at = await cdp.evaluate(centerOf('#trackRows .track-row:nth-child(5)')); await move(at.x, at.y); }, 'true', { floorMs: 500, reset: () => move(5, 5) });
    await measure('press-button', async () => { const at = await cdp.evaluate(centerOf('#nextButton')); await move(at.x, at.y); await mouse('mousePressed', at.x, at.y); await delay(150); await mouse('mouseReleased', at.x, at.y); }, 'true', { floorMs: 600 });
    await measure('fast-scroll', async () => { const at = await cdp.evaluate(centerOf('#trackRows .track-row:nth-child(5)')); for (let i = 0; i < 30; i += 1) { await cdp.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 160 }); await delay(16); } }, 'true', { floorMs: 400, reset: () => cdp.evaluate(`document.querySelector('.main-stage').scrollTop=0`) });
  } catch (error) {
    error.message += `\nApp output:\n${output.slice(-1500)}`;
    throw error;
  } finally {
    cdp?.close();
    child.kill();
    await delay(500);
    await fsp.rm(testRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(report.interactions).map(([name, m]) => `| ${name} | ${m.firstFrameMs} | ${m.paintedMs ?? '-'} | ${m.settledMs ?? '-'} | ${m.maxGapMs} | ${m.over24} | ${m.longTasks} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Interaction feel (${label})\n\n| Interaction | First frame ms | Painted ms | Settled ms | Worst gap ms | Frames >24 ms | Long tasks |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
