// Measures the two moments that read as a 1%-low hitch: launching Pixelody and
// switching theme. Measurement only; nothing here changes the app.
//
//   node scripts/measure-transitions.js --what=launch|switch|all [--launches=5] [--rounds=4]
//     [--port-rounds=4] [--playing] [--tracks=2000] [--out=file.json]
//
// launch: spawn -> window -> cover (#themeLoadScreen) -> reveal -> reveal+3 s.
//   Per run: first paint, reveal time, frame gaps and long tasks with start
//   times relative to the reveal, and Long Animation Frame script attribution.
//   One extra run has the CPU profiler on (sliced into pre-reveal, 0-400 ms and
//   400-3000 ms after reveal) and one has a compositor trace (PipelineReporter
//   frame states) to say whether the cover's own animation drops frames.
// switch: real Settings controls. Studio palettes (no cover), Studio motion
//   levels, then (development) Canvas Studio open/close and every Canvas port
//   through its real <select>. Each switch is split into phases from page
//   events: click -> cover active -> swap -> cover leaving -> hidden -> +1 s.
// The page is driven with real mouse events through the DevTools protocol
// (the Canvas port <select> gets a value + change event; it has no pointer path
// in headless CDP). Machine must be idle. Windows/macOS use the GPU; Linux
// needs xvfb-run and numbers are pessimistic.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PixelodyStateStore } = require('../src/state-store');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const flag = (name) => process.argv.includes(`--${name}`);
const what = arg('what', 'all');
const launches = Math.max(1, Number(arg('launches', '5')));
const rounds = Math.max(1, Number(arg('rounds', '4')));
const portRounds = Math.max(1, Number(arg('port-rounds', String(rounds))));
const playing = flag('playing');
const count = Number(arg('tracks', '2000'));
const motion = 'expressive';
const outFile = arg('out', '');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, name, timeout = 60000, step = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await delay(step); }
  throw new Error(`Timeout waiting for ${name}`);
}

function wave(frequency, seconds = 30, rate = 8000) {
  const samples = rate * seconds; const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 9000), 44 + i * 2);
  return data;
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

// CDP client that also delivers events (the harness's other scripts drop them).
async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map(); const listeners = new Map();
  let serial = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${message.error.message} (${request.method})`)); else request.resolve(message.result);
    } else if (message.method) { for (const fn of listeners.get(message.method) || []) fn(message.params); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params })); });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Page script failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
    return result.result.value;
  };
  return { call, on, evaluate, close: () => socket.close() };
}

// In-page recorder. Everything is stamped with performance.now() (time origin =
// navigation start). `__phase(name)` is a Runtime binding, so Node learns about
// a phase change within a millisecond and can slice the CPU profile there.
const PROBE = `(() => {
  if (window.__tp) return true;
  const tp = { longTasks: [], loaf: [], gaps: [], events: [], rafLast: 0, rafOn: true, clickAt: null };
  window.__tp = tp;
  const ev = (name, extra) => { const t = performance.now(); tp.events.push({ name, t, ...(extra || {}) }); try { performance.mark(name); } catch {} return t; };
  tp.ev = ev;
  const sendPhase = (name) => { try { window.__phase(JSON.stringify({ name, t: performance.now() })); } catch {} };
  tp.sendPhase = sendPhase;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) tp.longTasks.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) tp.loaf.push({ start: e.startTime, dur: e.duration, blocking: e.blockingDuration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
    scripts: (e.scripts || []).map((s) => ({ invoker: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: String(s.sourceURL || '').split('/').slice(-2).join('/'), char: s.sourceCharPosition, dur: s.duration, forced: s.forcedStyleAndLayoutDuration })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
  const tick = (t) => { if (tp.rafLast) tp.gaps.push({ t, gap: t - tp.rafLast }); tp.rafLast = t; if (tp.rafOn) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  for (const type of ['pointerdown', 'click', 'change']) addEventListener(type, () => { ev(type); if (tp.clickAt === null) tp.clickAt = performance.now(); }, { capture: true, passive: true });
  let last = '';
  const snapshot = () => {
    const b = document.body; const s = document.getElementById('themeLoadScreen');
    if (!b) return;
    const cover = s ? (s.classList.contains('hidden') ? 'hidden' : s.classList.contains('leaving') ? 'leaving' : s.classList.contains('active') ? 'active' : 'idle') : 'none';
    const key = [b.dataset.startupReveal || '', b.dataset.theme || '', b.dataset.palette || '', b.dataset.canvasPortName || '', b.dataset.motion || '', cover, b.classList.contains('theme-loading') ? 'L' : '', b.classList.contains('theme-switching') ? 'S' : '', b.classList.contains('theme-assets-settling') ? 'A' : ''].join('|');
    if (key === last) return;
    const first = last === ''; const prev = last.split('|'); const cur = key.split('|'); last = key;
    if (cur[0] !== prev[0] && cur[0]) { ev('reveal:' + cur[0]); sendPhase('reveal'); }
    if (cur[5] !== prev[5]) { ev('cover:' + cur[5]); sendPhase('cover:' + cur[5]); }
    if (!first && (cur[1] !== prev[1] || cur[2] !== prev[2] || cur[3] !== prev[3] || cur[4] !== prev[4])) { ev('swap'); sendPhase('swap'); }
    if (cur[8] !== prev[8]) ev(cur[8] ? 'settling:on' : 'settling:off');
  };
  const watch = () => { new MutationObserver(snapshot).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'data-startup-reveal', 'data-theme', 'data-palette', 'data-canvas-port-name', 'data-motion'] }); snapshot(); };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
  return true;
})()`;

const centerOf = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;

const median = (list) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const r1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

// ---- profile helpers -------------------------------------------------------
const frameKey = (nd) => { const f = nd.callFrame; return `${f.functionName || '(anonymous)'} ${(f.url || '').split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; };
function addProfile(into, p) {
  const nodes = new Map(p.nodes.map((nd) => [nd.id, nd]));
  const selfT = new Map();
  p.samples.forEach((id, k) => selfT.set(id, (selfT.get(id) || 0) + (p.timeDeltas[k] || 0)));
  for (const [id, us] of selfT) {
    const nd = nodes.get(id);
    if (nd.callFrame.functionName === '(program)') { into.program = (into.program || 0) + us; continue; }
    if (['(idle)', '(root)'].includes(nd.callFrame.functionName)) continue;
    const k = frameKey(nd); into.self.set(k, (into.self.get(k) || 0) + us); into.total += us;
  }
}
const newBucket = () => ({ self: new Map(), total: 0, segments: 0 });
const topSelf = (bucket, n, divisor = 1) => [...bucket.self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => ({ fn: k, ms: r1(us / 1000 / divisor) }));

let VARIANT_SCRIPT = '';
async function launchApp({ profileCollect = false } = {}) {
  const REUSE_PROFILE = process.env.REUSE_PROFILE || '';
  const testRoot = REUSE_PROFILE || await fsp.mkdtemp(path.join(os.tmpdir(), 'pixelody-transitions-'));
  const profile = path.join(testRoot, 'profile');
  const reused = REUSE_PROFILE && fs.existsSync(path.join(profile, 'state'));
  await fsp.mkdir(profile, { recursive: true });
  const media = path.join(testRoot, 'tone.wav');
  await fsp.writeFile(media, wave(330));
  const store = new PixelodyStateStore({ directory: path.join(profile, 'state'), backupIntervalMs: 0 });
  if (!reused && !store.commitSync(fixtureValues(media), { reason: 'transition-fixture' })?.ok) throw new Error('Could not seed the generated profile.');
  const env = { ...process.env, PIXELODY_DEVELOPMENT_WINDOW_WIDTH: '1440', PIXELODY_DEVELOPMENT_WINDOW_HEIGHT: '900', PIXELODY_DEVELOPMENT_MAXIMIZED: '0' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PIXELODY_TEST_MODE', 'PIXELODY_TEST_LAUNCH', 'PIXELODY_CANVAS_PROFILE']) delete env[key];
  const args = ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--mute-audio'];
  if (process.platform === 'linux') args.push('--disable-gpu', '--disable-gpu-compositing', '--no-sandbox');
  if (process.env.EXTRA_ELECTRON_ARGS) args.push(...process.env.EXTRA_ELECTRON_ARGS.split(' ').filter(Boolean));
  args.push(root, `--pixelody-dev-user-data=${profile}`);
  const spawnedAt = Date.now();
  const child = spawn(require('electron'), args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; }); child.stderr.on('data', (d) => { output += d; });
  const cleanup = async (cdp) => {
    cdp?.close(); child.kill(); await delay(600);
    if (!REUSE_PROFILE) await fsp.rm(testRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
    else await fsp.rm(path.join(profile, 'DevToolsActivePort'), { force: true }).catch(() => {});
  };
  let port;
  await until(() => { try { [port] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); return Boolean(port); } catch { return false; } }, 'debug port', 60000, 5);
  let page;
  await until(async () => { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page' && p.url.includes('index.html')); } catch { page = null; } return Boolean(page); }, 'main window', 60000, 5);
  const cdp = await connect(page.webSocketDebuggerUrl);
  const attachedAt = Date.now();
  const phases = [];
  cdp.on('Runtime.bindingCalled', ({ name, payload }) => { if (name === '__phase') { try { phases.push({ ...JSON.parse(payload), nodeAt: Date.now() }); } catch {} } });
  await cdp.call('Runtime.enable');
  await cdp.call('Runtime.addBinding', { name: '__phase' });
  await cdp.evaluate(PROBE);
  if (VARIANT_SCRIPT) await cdp.evaluate(VARIANT_SCRIPT);
  return { cdp, child, spawnedAt, attachedAt, phases, output: () => output, cleanup, profileDir: profile };
}

// Runs a Profiler that is cut at every phase marker the page reports.
function profileSlicer(cdp, phases) {
  const buckets = new Map(); let current = null; let cutting = Promise.resolve();
  const start = async (name) => { current = name; await cdp.call('Profiler.start'); };
  const cut = (next) => { cutting = cutting.then(async () => {
    if (current) { const { profile: p } = await cdp.call('Profiler.stop'); if (!buckets.has(current)) buckets.set(current, newBucket()); const b = buckets.get(current); addProfile(b, p); b.segments += 1; current = null; }
    if (next) await start(next);
  }); return cutting; };
  return { buckets, start, cut, finish: () => cut(null) };
}

// ---------------------------------------------------------------- launch --
async function oneLaunch({ mode }) {
  const app = await launchApp();
  const { cdp } = app;
  const out = { mode };
  try {
    await cdp.call('Page.enable'); await cdp.call('Page.bringToFront'); await cdp.call('Performance.enable');
    let slicer = null; const traceEvents = [];
    if (mode === 'profile') {
      await cdp.call('Profiler.enable'); await cdp.call('Profiler.setSamplingInterval', { interval: 200 });
      slicer = profileSlicer(cdp, app.phases);
      await slicer.start('pre-reveal');
    }
    if (mode === 'trace') {
      cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
      await cdp.call('Tracing.start', { categories: 'benchmark,viz,cc,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' }).catch((e) => { out.traceError = e.message; });
    }
    // Wait for the reveal.
    let revealSeen = false;
    await until(async () => { const d = await cdp.evaluate(`document.body?.dataset.startupReveal||''`); if (d === 'normal' || d === 'failed-closed') { revealSeen = true; return true; } return false; }, 'startup reveal', 60000, 10);
    const nowAtReveal = Date.now();
    if (slicer) { await slicer.cut('reveal+0-400'); await delay(400); await slicer.cut('reveal+400-3000'); await delay(2600); await slicer.finish(); }
    else await delay(3000);
    const data = JSON.parse(await cdp.evaluate(`JSON.stringify((() => { const tp = window.__tp; const nav = performance.getEntriesByType('navigation')[0]; const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime])); return { events: tp.events, gaps: tp.gaps, longTasks: tp.longTasks, loaf: tp.loaf, paints, timeOrigin: performance.timeOrigin, domContentLoaded: nav?.domContentLoadedEventEnd, load: nav?.loadEventEnd, now: performance.now() }; })())`));
    const revealEv = data.events.find((e) => e.name.startsWith('reveal:'));
    const revealT = revealEv ? revealEv.t : null;
    out.revealed = revealEv?.name;
    out.spawnToWindowMs = r1(data.timeOrigin - app.spawnedAt);
    out.firstPaintMs = r1(data.paints['first-paint']); out.firstContentfulPaintMs = r1(data.paints['first-contentful-paint']);
    out.domContentLoadedMs = r1(data.domContentLoaded); out.loadMs = r1(data.load);
    out.revealMs = r1(revealT); out.spawnToRevealMs = r1(data.timeOrigin - app.spawnedAt + revealT);
    out.events = data.events.map((e) => ({ name: e.name, t: r1(e.t), rel: r1(revealT === null ? null : e.t - revealT) }));
    const rel = (t) => r1(t - revealT);
    out.longTasks = data.longTasks.map((l) => ({ relReveal: rel(l.start), dur: r1(l.dur) }));
    out.loaf = data.loaf.filter((l) => l.blocking > 0 || l.dur > 50).map((l) => ({ relReveal: rel(l.start), dur: r1(l.dur), blocking: r1(l.blocking), renderStart: r1(l.renderStart - l.start), styleLayoutStart: r1(l.styleAndLayoutStart - l.start),
      scripts: l.scripts.sort((a, b) => b.dur - a.dur).slice(0, 3).map((s) => `${r1(s.dur)}ms ${s.invoker || ''} ${s.fn || ''} ${s.url}:${s.char}${s.forced ? ` forcedStyleLayout=${r1(s.forced)}` : ''}`) }));
    const coverActive = data.events.find((e) => e.name === 'cover:active');
    const coverFrom = coverActive ? coverActive.t : 0;
    const coverGaps = data.gaps.filter((g) => g.t >= coverFrom && g.t <= (revealT ?? data.now));
    const afterGaps = data.gaps.filter((g) => revealT !== null && g.t > revealT && g.t <= revealT + 3000);
    const gapStats = (list) => ({ frames: list.length, max: r1(Math.max(0, ...list.map((g) => g.gap))), over24: list.filter((g) => g.gap > 24).length, over50: list.filter((g) => g.gap > 50).length, worst: list.filter((g) => g.gap > 24).slice(0, 12).map((g) => ({ relReveal: rel(g.t), gap: r1(g.gap) })) });
    out.coverGaps = gapStats(coverGaps); out.postRevealGaps = gapStats(afterGaps);
    out.longTasksPreReveal = out.longTasks.filter((l) => l.relReveal < 0).length;
    out.longTasksPost0to400 = out.longTasks.filter((l) => l.relReveal >= 0 && l.relReveal < 400).length;
    out.longTasksPost400to3000 = out.longTasks.filter((l) => l.relReveal >= 400 && l.relReveal <= 3000).length;
    if (slicer) out.profile = Object.fromEntries([...slicer.buckets].map(([k, b]) => [k, { jsAndNativeCpuMs: r1(b.total / 1000), programNativeMs: r1((b.program || 0) / 1000), top10: topSelf(b, 10) }]));
    if (mode === 'trace') {
      try { await cdp.call('Tracing.end'); await delay(1500); } catch (e) { out.traceError = e.message; }
      out.trace = summariseTrace(traceEvents, data, revealT, app);
    }
  } catch (error) { error.message += `\nApp output:\n${app.output().slice(-1200)}`; throw error; } finally { await app.cleanup(cdp); }
  return out;
}

// PipelineReporter async events carry the compositor's verdict per frame.
function summariseTrace(events, data, revealT, app) {
  const marks = events.filter((e) => e.cat?.includes('blink.user_timing') && /^(cover:active|reveal:)/.test(e.name));
  const frames = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b');
  const idOf = (e) => `${e.pid}:${e.id2?.local || e.id}`;
  const ends = new Map(events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'e').map((e) => [idOf(e), e]));
  const coverStart = marks.find((m) => m.name === 'cover:active')?.ts; const revealTs = marks.find((m) => m.name.startsWith('reveal:'))?.ts;
  const tally = (list) => {
    const states = {}; let slow = 0; const dropped = [];
    for (const f of list) {
      const r = f.args?.frame_reporter || {}; const st = r.state || 'unknown'; states[st] = (states[st] || 0) + 1;
      const end = ends.get(idOf(f)); const durMs = end ? (end.ts - f.ts) / 1000 : null;
      if (durMs !== null && durMs > 24) slow += 1;
      if (/DROPPED|PARTIAL/.test(st)) dropped.push({ relRevealMs: revealTs === undefined ? null : r1((f.ts - revealTs) / 1000), state: st, durMs: r1(durMs), smooth: r.affects_smoothness, compositorAnim: r.has_compositor_animation, mainAnim: r.has_main_animation });
    }
    return { frames: list.length, byState: states, pipelineOver24ms: slow, notFullyPresented: dropped.slice(0, 25) };
  };
  const inCover = frames.filter((f) => coverStart !== undefined && revealTs !== undefined && f.ts >= coverStart && f.ts <= revealTs);
  const postReveal = frames.filter((f) => revealTs !== undefined && f.ts > revealTs && f.ts <= revealTs + 3e6);
  const preCover = frames.filter((f) => coverStart !== undefined && f.ts < coverStart);
  const heavy = events.filter((e) => ['UpdateLayoutTree', 'Layout', 'RecalculateStyles', 'Paint', 'PrePaint', 'Layerize', 'Commit', 'UpdateLayer', 'RunTask'].includes(e.name) && e.ph === 'X' && e.dur > 20000 && revealTs !== undefined && Math.abs(e.ts - revealTs) < 3.2e6 && e.cat?.includes('devtools.timeline') !== false).sort((a, b) => a.ts - b.ts).slice(0, 60).map((e) => ({ name: e.name, relRevealMs: r1((e.ts - revealTs) / 1000), durMs: r1(e.dur / 1000), elementCount: e.args?.elementCount ?? e.args?.beginData?.elementCount, layoutObjects: e.args?.beginData?.dirtyObjects ?? e.args?.dirtyObjects, totalObjects: e.args?.beginData?.totalObjects ?? e.args?.totalObjects, reason: e.args?.beginData?.reason || e.args?.reason, stack: (e.args?.beginData?.stackTrace || []).slice(0, 3).map((f) => `${f.functionName} ${String(f.url).split('/').slice(-1)}:${f.lineNumber}`) }));
  return { heavyRendering: heavy, coverActiveToReveal: tally(inCover), postReveal3s: tally(postReveal), beforeCoverActive: tally(preCover), tracedEvents: events.length, pipelineReporterEvents: frames.length, markTs: marks.map((m) => [m.name, m.ts]), firstFrameTs: frames[0]?.ts, lastFrameTs: frames[frames.length - 1]?.ts };
}

// ---------------------------------------------------------------- switch --
async function runSwitches({ playingTrack }) {
  const app = await launchApp();
  const { cdp } = app;
  const result = { playing: playingTrack, groups: {} };
  try {
    await cdp.call('Page.enable'); await cdp.call('Page.bringToFront'); await cdp.call('Profiler.enable'); await cdp.call('Profiler.setSamplingInterval', { interval: 200 });
    await until(() => cdp.evaluate(`Boolean(document.body?.dataset.startupReveal==='normal'&&!document.body.classList.contains('theme-loading'))`), 'startup reveal', 60000, 50);
    await delay(3500);
    if (playingTrack) { await cdp.evaluate(`playTrack('spec-1')`); await delay(1200); result.playbackConfirmed = await cdp.evaluate(`!audio.paused`); }
    const mouse = (type, x, y) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    const clickSel = async (selector) => {
      const at = await cdp.evaluate(centerOf(selector)); if (!at) throw new Error(`No visible element for ${selector}`);
      await mouse('mouseMoved', at.x, at.y); await mouse('mousePressed', at.x, at.y); await mouse('mouseReleased', at.x, at.y);
    };
    // Real Settings > Themes. The Canvas row only exists in development.
    await cdp.evaluate(`document.querySelector('#settingsButton').click()`); await delay(800);
    await cdp.evaluate(`document.querySelector('[data-settings-tab="themes"]')?.click()`); await delay(600);
    const resetCapture = () => cdp.evaluate(`(() => { const tp = window.__tp; tp.longTasks = []; tp.loaf = []; tp.gaps = []; tp.events = []; tp.clickAt = null; return performance.now(); })()`);
    const COVER_MAX = 6000;

    // One measured switch. `act` triggers the real control. `settledWhen` is a page expression.
    async function switchOnce(label, act, { cover, profileSlices = false } = {}) {
      await cdp.evaluate(`window.__tp.rafOn = true`);
      await resetCapture();
      let slicer = null; const phasesBefore = app.phases.length;
      if (profileSlices) { slicer = profileSlicer(cdp, app.phases); await slicer.start('click->cover'); cdp.on('Runtime.bindingCalled', ({ name, payload }) => { if (name === '__phase' && slicer) { try { const n = JSON.parse(payload).name; slicer.cut({ 'cover:active': 'cover-in->swap', swap: 'swap->leaving', 'cover:leaving': 'leaving->hidden', 'cover:hidden': 'after-hidden' }[n] || null); } catch {} } }); }
      await act();
      if (cover) await until(async () => (await cdp.evaluate(`window.__tp.events.some(e => e.name === 'cover:hidden')`)) === true, `${label} cover hidden`, COVER_MAX, 50).catch(() => {});
      else await delay(600);
      await delay(1100);
      if (slicer) { await slicer.finish(); slicer.done = true; }
      const d = JSON.parse(await cdp.evaluate(`JSON.stringify({ events: window.__tp.events, gaps: window.__tp.gaps, longTasks: window.__tp.longTasks, loaf: window.__tp.loaf })`));
      const click = d.events.find((e) => e.name === 'click' || e.name === 'change');
      const t0 = click ? click.t : (d.events[0]?.t ?? 0);
      const at = (name) => { const e = d.events.find((x) => x.name === name); return e ? e.t - t0 : null; };
      const bounds = { clickToCover: at('cover:active'), swap: at('swap'), leaving: at('cover:leaving'), hidden: at('cover:hidden') };
      const marks = [['click->cover', 0, bounds.clickToCover ?? bounds.swap ?? 9e9], ['cover-in->swap', bounds.clickToCover, bounds.swap], ['swap->leaving', bounds.swap, bounds.leaving], ['leaving->hidden', bounds.leaving, bounds.hidden], ['after-hidden', bounds.hidden ?? bounds.swap ?? 0, (bounds.hidden ?? bounds.swap ?? 0) + 1100]].filter(([, a, b]) => a !== null && a !== undefined && b !== null && b !== undefined);
      const phaseOf = (rel) => (marks.find(([, a, b]) => rel >= a && rel < b) || ['other'])[0];
      const longTasks = d.longTasks.map((l) => ({ phase: phaseOf(l.start - t0), rel: r1(l.start - t0), dur: r1(l.dur) }));
      const gaps = d.gaps.filter((g) => g.t >= t0).map((g) => ({ phase: phaseOf(g.t - t0), rel: r1(g.t - t0), gap: g.gap }));
      const loaf = d.loaf.filter((l) => l.blocking > 0 || l.dur > 50).map((l) => ({ phase: phaseOf(l.start - t0), rel: r1(l.start - t0), dur: r1(l.dur), blocking: r1(l.blocking), scripts: l.scripts.sort((a, b) => b.dur - a.dur).slice(0, 2).map((s) => `${r1(s.dur)}ms ${s.invoker || ''} ${s.fn || ''} ${s.url}:${s.char}`) }));
      return { label, bounds: Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, r1(v)])), longTasks, loaf, maxGap: r1(Math.max(0, ...gaps.map((g) => g.gap))), over24: gaps.filter((g) => g.gap > 24).length, over50: gaps.filter((g) => g.gap > 50).length, gapsByPhase: gaps.filter((g) => g.gap > 24).map((g) => ({ phase: g.phase, rel: g.rel, gap: r1(g.gap) })), profile: slicer ? Object.fromEntries([...slicer.buckets].map(([k, b]) => [k, { jsAndNativeCpuMs: r1(b.total / 1000), programNativeMs: r1((b.program || 0) / 1000), top10: topSelf(b, 10) }])) : undefined };
    }

    const summarise = (name, list) => {
      const byPhase = {};
      for (const s of list) for (const l of s.longTasks) { (byPhase[l.phase] ||= []).push(l.dur); }
      result.groups[name] = {
        switches: list.length,
        maxGapMedian: r1(median(list.map((s) => s.maxGap))), maxGapWorst: r1(Math.max(...list.map((s) => s.maxGap))),
        over24Total: list.reduce((a, s) => a + s.over24, 0), over50Total: list.reduce((a, s) => a + s.over50, 0),
        switchesWithLongTask: list.filter((s) => s.longTasks.length).length,
        longTasksByPhase: Object.fromEntries(Object.entries(byPhase).map(([p, durs]) => [p, { count: durs.length, medianMs: r1(median(durs)), maxMs: r1(Math.max(...durs)) }])),
        clickToCoverMedian: r1(median(list.map((s) => s.bounds.clickToCover).filter((v) => v !== null))),
        coverTotalMedian: r1(median(list.map((s) => s.bounds.hidden).filter((v) => v !== null))),
        samples: list,
      };
      console.error(`${name}: ${list.length} switches, worst gap ${result.groups[name].maxGapWorst} ms, >24ms ${result.groups[name].over24Total}, >50ms ${result.groups[name].over50Total}, long-task phases ${JSON.stringify(result.groups[name].longTasksByPhase)}`);
    };

    // --- Studio palettes (no cover) and motion levels
    await clickSel('[data-settings-tab="style"]'); await delay(500);
    const palettes = await cdp.evaluate(`[...document.querySelectorAll('.palette-option[data-palette]')].map(b => b.dataset.palette)`);
    result.palettes = palettes;
    const paletteSwitches = [];
    for (let round = 0; round < rounds; round += 1) for (const p of palettes) {
      if ((await cdp.evaluate(`document.body.dataset.palette`)) === p) continue;
      paletteSwitches.push(await switchOnce(`palette ${p}`, () => clickSel(`.palette-option[data-palette="${p}"]`), { cover: false }));
    }
    summarise('studio-palette', paletteSwitches);
    await clickSel('[data-settings-tab="motion"]'); await delay(500);
    const motionSwitches = [];
    for (let round = 0; round < rounds; round += 1) for (const m of ['off', 'calm', 'expressive']) {
      if ((await cdp.evaluate(`document.body.dataset.motion`)) === m) continue;
      motionSwitches.push(await switchOnce(`motion ${m}`, () => clickSel(`#motionSetting [data-motion="${m}"]`), { cover: false }));
    }
    summarise('studio-motion', motionSwitches);
    await clickSel('#motionSetting [data-motion="expressive"]'); await clickSel('[data-settings-tab="style"]'); await delay(400); await clickSel('.palette-option[data-palette="gold"]'); await delay(600); await clickSel('[data-settings-tab="themes"]'); await delay(800);

    // --- Canvas Studio (development only) and its ports, with the real cover
    const hasCanvas = await cdp.evaluate(`Boolean([...document.querySelectorAll('button')].find(b => /Open Canvas Studio/.test(b.textContent)))`);
    result.canvasAvailable = hasCanvas;
    if (hasCanvas) {
      const canvasButton = `(() => [...document.querySelectorAll('button')].find(b => /(Open|Leave) Canvas Studio/.test(b.textContent)))()`;
      const clickCanvas = async () => { const at = await cdp.evaluate(`(() => { const b = ${canvasButton}; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); await mouse('mouseMoved', at.x, at.y); await mouse('mousePressed', at.x, at.y); await mouse('mouseReleased', at.x, at.y); };
      const openClose = [];
      for (let i = 0; i < rounds; i += 1) {
        openClose.push(await switchOnce('canvas open', clickCanvas, { cover: true }));
        await delay(4400);
        openClose.push(await switchOnce('canvas close', clickCanvas, { cover: true }));
        await delay(4400);
      }
      summarise('canvas-open-close', openClose);
      await clickCanvas(); await until(() => cdp.evaluate(`document.body.classList.contains('theme-loading') === false && document.getElementById('themeLoadScreen')?.classList.contains('hidden')`), 'canvas open', 15000, 100); await delay(4500);
      const keys = await cdp.evaluate(`[...document.querySelectorAll('select option')].filter(o => o.parentElement.disabled === false).map(o => o.value).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)`);
      const portSelect = `(() => [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /Canvas Base/.test(o.textContent))))()`;
      const setPort = (key) => async () => { await cdp.evaluate(`(() => { const s = ${portSelect}; s.scrollIntoView({ block: 'center' }); s.value = ${JSON.stringify(key)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); };
      const portKeys = await cdp.evaluate(`[...${portSelect}.options].map(o => o.value).filter(Boolean)`);
      result.portKeys = portKeys;
      const portSwitches = [];
      for (let round = 0; round < portRounds; round += 1) {
        const order = round % 2 ? [...portKeys].reverse() : portKeys;
        for (const key of order) {
          await delay(4400);
          portSwitches.push({ key, ...(await switchOnce(`port ${key}`, setPort(key), { cover: true })) });
        }
      }
      summarise('canvas-port', portSwitches);
      // One profiled switch per kind (profiler on, not part of the tables above).
      await delay(4400);
      result.profiledPortSwitch = await switchOnce('port profile', setPort(portKeys[1] === (await cdp.evaluate(`${portSelect}.value`)) ? portKeys[2] : portKeys[1]), { cover: true, profileSlices: true });
      await delay(4400);
      await clickCanvas(); await delay(6000);
    }
    await delay(500);
    await clickSel('[data-settings-tab="style"]'); await delay(500);
    result.profiledPaletteSwitch = await switchOnce('palette profile', () => clickSel('.palette-option[data-palette="aurora"]'), { cover: false, profileSlices: true });
  } catch (error) { error.message += `\nApp output:\n${app.output().slice(-1200)}`; throw error; } finally { await app.cleanup(cdp); }
  return result;
}

// ---------------------------------------------------------------- timeline --
// Native rendering work in a window, from a devtools.timeline trace with
// invalidation tracking and selector stats.
const TIMELINE_CATEGORIES = 'disabled-by-default-devtools.timeline.frame,benchmark,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-blink.debug';
const RENDER_NAMES = new Set(['UpdateLayoutTree', 'RecalculateStyles', 'Layout', 'UpdateLayerTree', 'Paint', 'PrePaint', 'Layerize', 'Commit', 'CompositeLayers']);

async function traceStart(cdp, events, categories = TIMELINE_CATEGORIES) {
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await cdp.call('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordContinuously', includedCategories: categories.split(',') } });
}
async function traceStop(cdp) {
  const done = new Promise((resolve) => cdp.on('Tracing.tracingComplete', resolve));
  await cdp.call('Tracing.end'); await Promise.race([done, delay(8000)]); await delay(300);
}

function summariseTimeline(events, fromTs, toTs) {
  const within = (e) => e.ts >= fromTs && e.ts <= toTs;
  const ms = (us) => r1(us / 1000);
  const render = [];
  const stack = new Map();
  for (const e of events) {
    if (!RENDER_NAMES.has(e.name)) continue;
    if (e.ph === 'X' && e.dur >= 2000 && within(e)) render.push(e);
    else if (e.ph === 'B') { const k = `${e.pid}:${e.tid}:${e.name}`; if (!stack.has(k)) stack.set(k, []); stack.get(k).push(e); }
    else if (e.ph === 'E') { const k = `${e.pid}:${e.tid}:${e.name}`; const b = stack.get(k)?.pop(); if (b && within(b) && e.ts - b.ts >= 2000) render.push({ ...b, dur: e.ts - b.ts, args: { ...(b.args || {}), end: e.args } }); }
  }
  render.sort((a, b) => a.ts - b.ts);
  const rows = render.map((e) => {
    const a = e.args || {}; const bd = a.beginData || {}; const ed = a.endData || a.end || {};
    const row = { name: e.name, startRelMs: ms(e.ts - fromTs), durMs: ms(e.dur) };
    if (a.elementCount !== undefined) row.elementCount = a.elementCount;
    if (bd.dirtyObjects !== undefined) { row.dirtyObjects = bd.dirtyObjects; row.totalObjects = bd.totalObjects; row.partialLayout = bd.partialLayout; }
    if (ed.root) row.root = String(ed.root).slice(0, 80);
    return row;
  });
  const byName = {};
  for (const r of rows) { const b = (byName[r.name] ||= { count: 0, totalMs: 0, maxMs: 0 }); b.count += 1; b.totalMs = r1(b.totalMs + r.durMs); b.maxMs = Math.max(b.maxMs, r.durMs); }
  const inv = new Map();
  const invNames = new Set(['StyleRecalcInvalidationTracking', 'StyleInvalidatorInvalidationTracking', 'ScheduleStyleInvalidationTracking', 'LayoutInvalidationTracking', 'LayerInvalidationTracking', 'ScheduleStyleRecalculation']);
  for (const e of events) {
    if (!invNames.has(e.name) || !within(e)) continue;
    const d = e.args?.data || {};
    const key = [e.name.replace('InvalidationTracking', ''), d.reason || '', d.changedClass ? `.${d.changedClass}` : '', d.changedAttribute ? `[${d.changedAttribute}]` : '', d.changedId ? `#${d.changedId}` : '', d.invalidatedSelectorId ? `sel:${d.invalidatedSelectorId}` : '', d.extraData || '', d.selectorPart || '', `on <${(d.nodeName || '').toString().slice(0, 60)}>`].filter(Boolean).join(' | ');
    inv.set(key, (inv.get(key) || 0) + 1);
  }
  const byNode = new Map();
  for (const e of events) { if (!['StyleRecalcInvalidationTracking', 'StyleInvalidatorInvalidationTracking'].includes(e.name) || !within(e)) continue; const d = e.args?.data || {}; const nn = String(d.nodeName || '').replace(/ id=.*$/, '').slice(0, 70); const k = `${e.name.startsWith('StyleRecalc') ? 'recalc' : 'invalidator'} ${d.reason || ''} ${nn}`; byNode.set(k, (byNode.get(k) || 0) + 1); }
  const invalidationsByNode = [...byNode].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([key, count]) => ({ count, key }));
  const invalidations = [...inv].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, count]) => ({ count, key }));
  const sel = new Map();
  let statsEvents = 0;
  for (const e of events) {
    const ss = e.args?.selector_stats || e.args?.end?.selector_stats || e.args?.endData?.selector_stats;
    if (!ss?.selector_timings || !within(e)) continue;
    statsEvents += 1;
    for (const t of ss.selector_timings) { const k = t.selector; const cur = sel.get(k) || { elapsedUs: 0, attempts: 0, matches: 0, fastReject: 0 }; cur.elapsedUs += (t['elapsed (us)'] ?? t.elapsed ?? 0); cur.attempts += t.match_attempts ?? 0; cur.matches += t.match_count ?? 0; cur.fastReject += t.fast_reject_count ?? 0; sel.set(k, cur); }
  }
  const selectors = [...sel].sort((a, b) => b[1].elapsedUs - a[1].elapsedUs).slice(0, 15).map(([k, v]) => ({ selector: String(k).slice(0, 140), ms: r1(v.elapsedUs / 1000), attempts: v.attempts, matches: v.matches, fastReject: v.fastReject }));
  return { windowMs: ms(toTs - fromTs), totalEvents: events.length, byName, rows: rows.slice(0, 60), invalidations, invalidationsByNode, invalidationEventsSeen: [...inv.values()].reduce((a, b) => a + b, 0), selectorStatsEvents: statsEvents, topSelectors: selectors };
}

function pipelineFlags(events, fromTs, toTs) {
  const mine = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.ts >= fromTs && e.ts <= toTs);
  const flags = { frames: mine.length, has_main_animation: 0, has_compositor_animation: 0, byState: {} };
  for (const f of mine) { const r = f.args?.frame_reporter || {}; if (r.has_main_animation) flags.has_main_animation += 1; if (r.has_compositor_animation) flags.has_compositor_animation += 1; flags.byState[r.state || 'unknown'] = (flags.byState[r.state || 'unknown'] || 0) + 1; }
  return flags;
}

const CENSUS = `(() => {
  const vh = innerHeight, vw = innerWidth;
  const stage = document.querySelector('.main-stage'); const sr = stage ? stage.getBoundingClientRect() : { top: 0, bottom: vh, left: 0, right: vw };
  const onScreen = (el) => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; return r.bottom > Math.max(0, sr.top) && r.top < Math.min(vh, sr.bottom) && r.right > 0 && r.left < vw; };
  const count = (sel) => { const all = [...document.querySelectorAll(sel)]; return { inDom: all.length, onScreen: all.filter(onScreen).length, insideTrackRow: all.filter((e) => e.closest('.track-row')).length }; };
  const anims = document.getAnimations();
  const by = {};
  for (const a of anims) {
    const t = a.effect && a.effect.target; if (!t || !t.tagName) continue;
    const key = t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') + ' [' + (a.animationName || a.transitionProperty || 'anim') + ']' + (a.playState === 'running' ? '' : ' ' + a.playState);
    const b = (by[key] = by[key] || { n: 0, onScreen: 0, inTrackRow: 0, iterations: String(a.effect.getComputedTiming().iterations) });
    b.n += 1; if (onScreen(t)) b.onScreen += 1; if (t.closest && t.closest('.track-row')) b.inTrackRow += 1;
  }
  const rows = [...document.querySelectorAll('.track-row')];
  return {
    t: performance.now(), reveal: document.body.dataset.startupReveal, readiness: document.body.dataset.readiness,
    trackRow: count('.track-row'), needsDiscovery: count('.track-row.needs-discovery'), discoveryBadge: count('.discovery-badge'), statusDot: count('.status-dot'),
    allElements: document.getElementsByTagName('*').length, trackRowDescendants: rows.reduce((a, r) => a + r.getElementsByTagName('*').length, 0),
    viewport: { w: vw, h: vh }, stageRect: { top: Math.round(sr.top), bottom: Math.round(sr.bottom) },
    totalAnimations: anims.length, runningAnimations: anims.filter((a) => a.playState === 'running').length,
    animationsByTarget: Object.fromEntries(Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 15)),
  };
})()`;

// Launch: the 100 ms before reveal through +400 ms, and +400..+1500 ms.
async function oneTimelineLaunch() {
  const app = await launchApp();
  const { cdp } = app; const events = []; const out = {};
  try {
    await cdp.call('Page.enable'); await cdp.call('Page.bringToFront');
    await traceStart(cdp, events);
    await until(async () => ['normal', 'failed-closed'].includes(await cdp.evaluate(`document.body?.dataset.startupReveal||''`)), 'startup reveal', 60000, 10);
    out.censusAtReveal = await cdp.evaluate(CENSUS);
    await delay(450);
    out.censusAt450 = await cdp.evaluate(CENSUS);
    await delay(2500);
    await traceStop(cdp);
    const mark = events.find((e) => e.name.startsWith('reveal:') && e.cat?.includes('blink.user_timing'));
    if (!mark) throw new Error('No reveal mark in trace');
    out.windows = {
      'reveal-100..reveal+400': summariseTimeline(events, mark.ts - 100000, mark.ts + 400000),
      'reveal+400..reveal+1500': summariseTimeline(events, mark.ts + 400000, mark.ts + 1500000),
    };
    out.coverFramesLast1sBeforeReveal = pipelineFlags(events, mark.ts - 1000000, mark.ts);
  } catch (error) { error.message += `\nApp output:\n${app.output().slice(-1200)}`; throw error; } finally { await app.cleanup(cdp); }
  return out;
}

// Port switch: swap mark -> cover:hidden mark. Open Canvas, settle on one port, then trace the switch.
async function portTimeline(targetKey, warmKey, repeats) {
  const app = await launchApp();
  const { cdp } = app; const out = { targetKey, runs: [] };
  try {
    await cdp.call('Page.enable'); await cdp.call('Page.bringToFront');
    await until(() => cdp.evaluate(`Boolean(document.body?.dataset.startupReveal==='normal'&&!document.body.classList.contains('theme-loading'))`), 'startup reveal', 60000, 50);
    await delay(3500);
    const mouse = (type, x, y) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    const clickAt = async (expr) => { const at = await cdp.evaluate(expr); await mouse('mouseMoved', at.x, at.y); await mouse('mousePressed', at.x, at.y); await mouse('mouseReleased', at.x, at.y); };
    await cdp.evaluate(`document.querySelector('#settingsButton').click()`); await delay(800);
    await cdp.evaluate(`document.querySelector('[data-settings-tab="themes"]')?.click()`); await delay(600);
    await clickAt(`(() => { const b = [...document.querySelectorAll('button')].find(b => /Open Canvas Studio/.test(b.textContent)); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await until(() => cdp.evaluate(`document.getElementById('themeLoadScreen')?.classList.contains('hidden')===true`), 'canvas open', 15000, 100); await delay(4500);
    const portSelect = `(() => [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /Canvas Base/.test(o.textContent))))()`;
    const setPort = (key) => cdp.evaluate(`(() => { const s = ${portSelect}; s.scrollIntoView({ block: 'center' }); s.value = ${JSON.stringify(key)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const hidden = () => until(() => cdp.evaluate(`document.getElementById('themeLoadScreen')?.classList.contains('hidden')===true`), 'cover hidden', 8000, 50);
    for (let i = 0; i < repeats; i += 1) {
      await setPort(warmKey); await delay(400); await hidden(); await delay(4500);
      const events = [];
      await traceStart(cdp, events);
      await setPort(targetKey);
      await delay(400); await hidden(); await delay(1500);
      await traceStop(cdp);
      const marks = (n) => events.filter((e) => e.name === n && e.cat?.includes('blink.user_timing'));
      const swap = marks('swap').pop(); const hiddenM = marks('cover:hidden').pop(); const active = marks('cover:active').pop(); const leaving = marks('cover:leaving').pop();
      if (!swap || !hiddenM) { out.runs.push({ error: 'missing marks', marks: events.filter((e) => e.cat?.includes('blink.user_timing')).map((e) => e.name).slice(0, 20) }); continue; }
      out.runs.push({
        coverActiveToSwapMs: r1(active ? (swap.ts - active.ts) / 1000 : null), swapToLeavingMs: r1(leaving ? (leaving.ts - swap.ts) / 1000 : null), swapToHiddenMs: r1((hiddenM.ts - swap.ts) / 1000),
        swapToHidden: summariseTimeline(events, swap.ts, hiddenM.ts), coverActiveToSwap: active ? summariseTimeline(events, active.ts, swap.ts) : null,
        pipelineSwapToHidden: pipelineFlags(events, swap.ts, hiddenM.ts),
      });
    }
  } catch (error) { error.message += `\nApp output:\n${app.output().slice(-1200)}`; throw error; } finally { await app.cleanup(cdp); }
  return out;
}

// Style-recalc probes. flush() forces style only (getComputedStyle), layout() forces layout too.
const PROBE_EXPR = `(() => {
  const now = () => performance.now();
  const flush = () => document.documentElement.offsetHeight;
  const time = (fn) => { flush(); const t = now(); fn(); flush(); return now() - t; };
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const rep = (n, fn) => { const out = []; for (let i = 0; i < n; i += 1) out.push(fn()); return { first: +out[0].toFixed(2), median: +med(out).toFixed(2), max: +Math.max(...out).toFixed(2) }; };
  const out = { t: now(), reveal: document.body.dataset.startupReveal, readiness: document.body.dataset.readiness };
  // (a) no-op readiness write + forced recalc, vs a forced recalc with nothing dirty
  out.a_forcedRecalcNothingDirty = rep(5, () => time(() => {}));
  out.a_readinessNoopWrite = rep(5, () => time(() => { document.body.dataset.readiness = document.body.dataset.readiness; }));
  out.a_bodyAttrChange = rep(5, () => { let v = 0; return time(() => { document.body.dataset.probeTick = String(Math.random()); }); });
  // (b) hide .workspace, restore
  const ws = document.querySelector('.workspace');
  out.b_workspaceDisplayNone = rep(5, () => time(() => { ws.style.display = 'none'; }));
  out.b_workspaceRestore = rep(1, () => time(() => { ws.style.display = ''; }));
  const hideRestore = [];
  for (let i = 0; i < 5; i += 1) { hideRestore.push(time(() => { ws.style.display = 'none'; })); hideRestore.push(time(() => { ws.style.display = ''; })); }
  out.b_workspaceHideRestorePairs = { hide: +med(hideRestore.filter((_, i) => i % 2 === 0)).toFixed(2), restore: +med(hideRestore.filter((_, i) => i % 2 === 1)).toFixed(2) };
  // Subtree restyle of the 31 rows, with and without contain:strict. Op: change a custom property on #trackRows read by every descendant.
  const host = document.getElementById('trackRows');
  const st = document.createElement('style'); st.id = 'probe-style';
  st.textContent = '#trackRows .track-row, #trackRows .track-row * { outline-color: var(--probe-v, transparent); }';
  document.head.append(st);
  const rowsCount = host.querySelectorAll('.track-row').length; const rowEls = host.querySelectorAll('.track-row, .track-row *').length;
  let n = 0; const bump = () => { n += 1; host.style.setProperty('--probe-v', n % 2 ? 'red' : 'blue'); };
  out.b_rowSubtreesRestyle_noContain = Object.assign({ rows: rowsCount, elements: rowEls }, rep(5, () => time(bump)));
  const st2 = document.createElement('style'); st2.id = 'probe-style-contain'; st2.textContent = '#trackRows .track-row { contain: strict; }';
  document.head.append(st2);
  out.b_rowSubtreesRestyle_containStrict = rep(5, () => time(bump));
  const st3 = document.createElement('style'); st3.id = 'probe-style-cv'; st3.textContent = '#trackRows .track-row { contain: style layout paint; content-visibility: auto; contain-intrinsic-size: auto 52px; }';
  st2.remove(); document.head.append(st3);
  out.b_rowSubtreesRestyle_contentVisibilityAuto = rep(5, () => time(bump));
  st3.remove(); st.remove(); host.style.removeProperty('--probe-v');
  // (c) stylesheet and rule counts
  const walk = (rules, acc) => { for (const r of rules) { acc.total += 1; acc.byType[r.constructor.name] = (acc.byType[r.constructor.name] || 0) + 1; if (r.selectorText) acc.selectors += r.selectorText.split(',').length; if (r.cssRules && r.cssRules.length) walk(r.cssRules, acc); } };
  const acc = { total: 0, selectors: 0, byType: {} }; let sheets = 0, disabled = 0, unreadable = 0; const big = [];
  for (const sh of document.styleSheets) { sheets += 1; if (sh.disabled) disabled += 1; let rules; try { rules = sh.cssRules; } catch { unreadable += 1; continue; } const local = { total: 0, selectors: 0, byType: {} }; walk(rules, local); acc.total += local.total; acc.selectors += local.selectors; for (const [k, v] of Object.entries(local.byType)) acc.byType[k] = (acc.byType[k] || 0) + v; big.push([(sh.href || 'inline').split('/').slice(-1)[0], local.total, sh.disabled ? 'disabled' : '']); }
  out.c_styleSheets = { sheets, disabled, unreadable, totalRules: acc.total, totalSelectors: acc.selectors, byType: acc.byType, largest: big.sort((a, b) => b[1] - a[1]).slice(0, 12) };
  out.domElements = document.getElementsByTagName('*').length;
  return out;
})()`;


// ----------------------------------------------------------- clean timeline --
const CLEAN_CATEGORIES = 'blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,cc,viz';
function argSummary(e) {
  const a = e.args || {}; const d = a.data || {}; const bd = a.beginData || {}; const parts = [];
  if (a.elementCount !== undefined) parts.push('elementCount=' + a.elementCount);
  if (bd.dirtyObjects !== undefined) parts.push('dirty=' + bd.dirtyObjects + '/' + bd.totalObjects);
  if (d.functionName) parts.push('fn=' + d.functionName);
  if (d.url) parts.push('url=' + String(d.url).split('/').slice(-2).join('/') + (d.lineNumber !== undefined ? ':' + d.lineNumber : ''));
  if (d.type) parts.push('type=' + d.type);
  if (d.id !== undefined) parts.push('id=' + d.id);
  if (d.imageUrl) parts.push('image=' + String(d.imageUrl).split('/').slice(-1)[0].slice(0, 50));
  if (a.data && a.data.frame) parts.push('frame');
  if (d.nodeName) parts.push('node=' + String(d.nodeName).slice(0, 50));
  return parts.join(' ');
}
function taskTree(events, task) {
  const end = task.ts + task.dur;
  const kids = events.filter((e) => e !== task && e.ph === 'X' && e.pid === task.pid && e.tid === task.tid && e.ts >= task.ts && e.ts + (e.dur || 0) <= end + 1 && e.dur >= 500 && !['RunTask'].includes(e.name));
  kids.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const lines = []; const stack = [];
  for (const e of kids) {
    while (stack.length && e.ts >= stack[stack.length - 1].ts + stack[stack.length - 1].dur) stack.pop();
    lines.push('  '.repeat(stack.length + 1) + e.name + ' ' + r1(e.dur / 1000) + 'ms +' + r1((e.ts - task.ts) / 1000) + ' ' + argSummary(e));
    stack.push(e);
  }
  const top = kids.filter((e) => !kids.some((p) => p !== e && p.ts <= e.ts && p.ts + p.dur >= e.ts + e.dur && (p.ts !== e.ts || p.dur > e.dur))).map((e) => e.name + ' ' + r1(e.dur / 1000));
  return { lines: lines.slice(0, 120), truncated: Math.max(0, lines.length - 120), topLevelChildren: top.slice(0, 20) };
}
async function cleanTraceLaunch() {
  const app = await launchApp();
  const { cdp } = app; const events = []; const out = {};
  try {
    await cdp.call('Page.enable'); await cdp.call('Page.bringToFront');
    await traceStart(cdp, events, CLEAN_CATEGORIES);
    await until(async () => ['normal', 'failed-closed'].includes(await cdp.evaluate('document.body?.dataset.startupReveal||""')), 'startup reveal', 60000, 10);
    await delay(3000);
    await traceStop(cdp);
    const mark = events.find((e) => e.name.startsWith('reveal:') && e.cat?.includes('blink.user_timing'));
    if (!mark) throw new Error('No reveal mark in trace');
    const tasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.dur > 30000 && e.ts >= mark.ts - 100000 && e.ts <= mark.ts + 400000);
    // main thread = thread that owns the reveal mark
    out.tasks = tasks.filter((t) => t.pid === mark.pid && t.tid === mark.tid).map((t) => ({ startRelRevealMs: r1((t.ts - mark.ts) / 1000), durMs: r1(t.dur / 1000), ...taskTree(events, t) }));
    out.otherThreadTasks = tasks.filter((t) => !(t.pid === mark.pid && t.tid === mark.tid)).map((t) => ({ startRelRevealMs: r1((t.ts - mark.ts) / 1000), durMs: r1(t.dur / 1000), pid: t.pid, tid: t.tid }));
    const tname = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [e.pid + ':' + e.tid, e.args?.name]));
    const pname = new Map(events.filter((e) => e.ph === 'M' && e.name === 'process_name').map((e) => [e.pid, e.args?.name]));
    const win = events.filter((e) => e.ph === 'X' && e.ts >= mark.ts - 50000 && e.ts <= mark.ts + 400000 && e.dur >= 3000 && !(e.pid === mark.pid && e.tid === mark.tid));
    const by = new Map();
    for (const e of win) { const k = (pname.get(e.pid) || e.pid) + '/' + (tname.get(e.pid + ':' + e.tid) || e.tid) + ' :: ' + e.name; const b = by.get(k) || { n: 0, totalMs: 0, maxMs: 0 }; b.n += 1; b.totalMs += e.dur / 1000; b.maxMs = Math.max(b.maxMs, e.dur / 1000); by.set(k, b); }
    out.otherThreads = [...by].map(([k, v]) => ({ k, n: v.n, totalMs: r1(v.totalMs), maxMs: r1(v.maxMs) })).sort((a, b) => b.maxMs - a.maxMs).slice(0, 25);
    out.otherThreadBig = win.filter((e) => e.dur >= 20000).sort((a, b) => a.ts - b.ts).slice(0, 25).map((e) => ({ thread: (pname.get(e.pid) || e.pid) + '/' + (tname.get(e.pid + ':' + e.tid) || e.tid), name: e.name, startRelRevealMs: r1((e.ts - mark.ts) / 1000), durMs: r1(e.dur / 1000), args: JSON.stringify(e.args || {}).slice(0, 160) }));
    out.rasterTimeline = events.filter((e) => e.name === 'RasterTask' && e.ph === 'X' && e.dur >= 8000 && e.ts >= mark.ts - 2500000 && e.ts <= mark.ts + 800000).sort((a, b) => a.ts - b.ts).map((e) => ({ layerId: e.args?.tileData?.layerId, startRelRevealMs: r1((e.ts - mark.ts) / 1000), durMs: r1(e.dur / 1000), res: e.args?.tileData?.tileResolution }));
    out.gpuTasks = events.filter((e) => e.name === 'GPUTask' && e.ph === 'X' && e.dur >= 20000 && e.ts >= mark.ts - 2500000 && e.ts <= mark.ts + 1200000).sort((a, b) => a.ts - b.ts).map((e) => ({ startRelRevealMs: r1((e.ts - mark.ts) / 1000), durMs: r1(e.dur / 1000) }));
    out.pipeline = pipelineFlags(events, mark.ts - 1000000, mark.ts);
    out.pipelineAfter = pipelineFlags(events, mark.ts, mark.ts + 1000000);
  } catch (error) { error.message += '\nApp output:\n' + app.output().slice(-1200); throw error; } finally { await app.cleanup(cdp); }
  return out;
}

// ----------------------------------------------------------- cover probes --
const COVER_PROBE = `(async () => {
  const cover = document.getElementById('themeLoadScreen');
  const raf = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const lts = []; let obs; try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) lts.push(e.duration); }); obs.observe({ type: 'longtask' }); } catch {}
  const st = document.createElement('style'); st.textContent = '#themeLoadScreen, #themeLoadScreen * { animation: none !important; transition: none !important; }'; document.head.append(st);
  const flush = () => document.documentElement.offsetHeight;
  const entrance = () => document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; return t && t.matches && t.matches('.topbar, .workspace, .player'); });
  const results = {};
  async function run(name, setup, hide, teardown) {
    const times = [];
    for (let i = 0; i < 4; i += 1) {
      cover.classList.remove('hidden', 'leaving'); cover.classList.add('active'); cover.style.display = ''; document.body.classList.add('theme-loading');
      flush(); await raf(); await raf(); await new Promise((r) => setTimeout(r, 400));
      if (setup) await setup();
      lts.length = 0;
      const t0 = performance.now(); hide(); flush(); const t1 = performance.now();
      const f1 = await raf(); const f2 = await raf();
      await new Promise((r) => setTimeout(r, 200));
      times.push({ syncFlushMs: +(t1 - t0).toFixed(1), toNextFrameMs: +(f1 - t0).toFixed(1), toSecondFrameMs: +(f2 - t0).toFixed(1), longTasks: lts.map((d) => +d.toFixed(0)) });
      if (teardown) teardown();
    }
    results[name] = times;
  }
  const hideClass = () => { cover.classList.remove('active'); cover.classList.add('hidden'); document.body.classList.remove('theme-loading'); };
  await run('classHidden', null, hideClass);
  await run('displayNone', null, () => { cover.style.display = 'none'; document.body.classList.remove('theme-loading'); }, () => { cover.style.display = ''; });
  await run('classHidden_bodyTransitionNone', () => { document.body.style.transition = 'none'; }, hideClass, () => { document.body.style.transition = ''; });
  await run('classHidden_readinessRewrite', () => { document.body.dataset.readiness = 'interactive'; flush(); }, () => { hideClass(); document.body.dataset.readiness = 'settled'; });
  // Cancel entrance animations: restart them first (they have finished by now) so there is something to cancel.
  const entranceCount = entrance().length;
  results.entranceAnimationsAliveWhenSettled = entranceCount;
  obs && obs.disconnect(); st.remove();
  return results;
})()`;

// ------------------------------------------------------ live launch variants --
const injectCss = (css) => `(() => { const add = () => { if (!document.documentElement) return setTimeout(add, 1); const st = document.createElement('style'); st.id = 'variant-css'; st.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).append(st); }; add(); })()`;
const SEL_F = "body[data-theme=\"studio\"] :is(.library-rail,.main-stage,.inspector)";
const BOOT = 'body[data-performance="balanced"][data-readiness="booting"]';
const BOOTINT = 'body[data-performance="balanced"]:is([data-readiness="booting"],[data-readiness="interactive"])';
const WB = 'body[data-performance="balanced"][data-readiness="booting"]';
const WBI = 'body[data-performance="balanced"]:is([data-readiness="booting"],[data-readiness="interactive"])';
const W_OPACITY = WB + ' .workspace{opacity:.01!important}';
const PSEL = ':is(.library-rail,.inspector,#inspectorPanel)';
const Y_PANELS = 'body[data-performance="balanced"].theme-assets-settling :is(.topbar,.library-rail,.main-stage,.inspector,.player)';
const Y_NOARRIVAL = Y_PANELS + '{animation:none!important;will-change:auto!important}';
const Y_NOFADE = 'body[data-performance="balanced"][data-readiness="interactive"] :is(.topbar,.workspace,.player), body[data-readiness="interactive"] :is(.topbar,.workspace,.player), body[data-readiness="settled"] :is(.topbar,.workspace,.player){transition:none!important}';
const VARIANT_SCRIPTS = {
  Y1_noArrivalNoWillChange: injectCss(Y_NOARRIVAL),
  Y2_Y1_plus_noOpacityFade: injectCss(Y_NOARRIVAL + Y_NOFADE),
  Y3_Y2_plus_workspaceOneFrameLate: `(() => { const add = () => { if (!document.documentElement) return setTimeout(add, 1); const st = document.createElement('style'); st.id = 'y3-css'; st.textContent = ${JSON.stringify(Y_NOARRIVAL + Y_NOFADE)} + 'body[data-readiness="interactive"] .workspace{opacity:0!important}'; (document.head || document.documentElement).append(st);
    new MutationObserver(() => { if (document.body && document.body.dataset.startupReveal === 'normal' && !window.__y3) { window.__y3 = true; requestAnimationFrame(() => requestAnimationFrame(() => { st.textContent = ${JSON.stringify(Y_NOARRIVAL + Y_NOFADE)}; })); } }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-startup-reveal'] }); }; add(); })()`,
  P1_noMask: injectCss(PSEL + ' *, ' + PSEL + '{mask-image:none!important;-webkit-mask:none!important;mask:none!important;-webkit-mask-image:none!important}'),
  P2_noClipPath: injectCss(PSEL + ' *, ' + PSEL + '{clip-path:none!important}'),
  P3_noRadiusOverflow: injectCss(PSEL + ' *, ' + PSEL + '{border-radius:0!important;overflow:visible!important}'),
  P4_noBackgroundImage: injectCss(PSEL + ' *{background-image:none!important}'),
  P5_noShadowFilter: injectCss(PSEL + ' *{box-shadow:none!important;filter:none!important;text-shadow:none!important}'),
  P6_imageRenderingAuto: injectCss(PSEL + ' *, ' + PSEL + '{image-rendering:auto!important}'),
  W1_hideMainStage: injectCss(W_OPACITY + WB + ' .main-stage{visibility:hidden!important}'),
  W2_W1_plus_willChange: injectCss(W_OPACITY + WB + ' .main-stage{visibility:hidden!important}' + WBI + ' :is(.library-rail,.inspector){will-change:transform!important}'),
  W3_W1_plus_hideRows: injectCss(W_OPACITY + WB + ' .main-stage{visibility:hidden!important}' + WB + ' .main-stage .track-rows, ' + WB + ' .main-stage #trackRows{visibility:hidden!important}'),
  W4_W1_railOnly: injectCss(W_OPACITY + WB + ' .main-stage{visibility:hidden!important}' + WB + ' .inspector{visibility:hidden!important}'),
  W5_W1_inspectorOnly: injectCss(W_OPACITY + WB + ' .main-stage{visibility:hidden!important}' + WB + ' .library-rail{visibility:hidden!important}'),
  V1_opacityOnly: injectCss(BOOT + ' .workspace{opacity:.01!important}'),
  V2_willChangeTransformOnly: injectCss(BOOTINT + ' :is(.library-rail,.inspector){will-change:transform!important}'),
  V3_opacity_willChangeOpacity: injectCss(BOOT + ' .workspace{opacity:.01!important}' + BOOTINT + ' :is(.library-rail,.inspector){will-change:opacity!important}'),
  V4_opacity_containPaint: injectCss(BOOT + ' .workspace{opacity:.01!important}' + BOOTINT + ' :is(.library-rail,.inspector){contain:paint!important}'),
  V5_opacityUntilFirstRaf: `(() => { const add = () => { if (!document.documentElement) return setTimeout(add, 1); const st = document.createElement('style'); st.id = 'v5-css'; st.textContent = '${BOOT} .workspace{opacity:.01!important}'; (document.head || document.documentElement).append(st);
    const watch = () => { const c = document.getElementById('themeLoadScreen'); if (!c) return setTimeout(watch, 2); const done = () => { if (c.dataset.loadPhase === 'animating' && !window.__v5done) { window.__v5done = true; requestAnimationFrame(() => requestAnimationFrame(() => st.remove())); } }; new MutationObserver(done).observe(c, { attributes: true, attributeFilter: ['data-load-phase', 'class'] }); done(); }; watch(); }; add(); })()`,
  X1_holdAtPointZeroOne: injectCss('html body[data-performance="balanced"][data-startup-hold="true"] .workspace{opacity:.01!important}'),
  X2_holdPointZeroOne_plusBooting: injectCss('html body[data-performance="balanced"][data-startup-hold="true"] .workspace{opacity:.01!important}' + 'html ' + BOOT + ' .workspace{opacity:.01!important}'),
  CONTROL: '',
  F1_shadowNone: injectCss(SEL_F + '{box-shadow:none!important}'),
  F2_smallShadow: injectCss(SEL_F + '{box-shadow:0 6px 16px #02030940,0 1px 0 #ffffff08 inset!important}'),
  F3_hairline: injectCss(SEL_F + '{box-shadow:0 0 0 1px #0203094d!important;border-color:var(--studio-hairline)}'),
  F4_willChangeRailInspector: injectCss('.library-rail,.inspector{will-change:transform}'),
  F5_smallShadow_plus_willChange: injectCss(SEL_F + '{box-shadow:0 6px 16px #02030940,0 1px 0 #ffffff08 inset!important}.library-rail,.inspector{will-change:transform}'),
  B_noArrivalOnRailInspector: injectCss('.library-rail, .inspector, #inspectorPanel { animation: none !important; }'),
  C_noArrivalNoWillChange: injectCss('.library-rail, .inspector, #inspectorPanel { animation: none !important; } .topbar, .library-rail, .main-stage, .inspector, #inspectorPanel, .player { will-change: auto !important; }'),
  D_translateZ_containPaint: injectCss('.library-rail, .inspector, #inspectorPanel { transform: translateZ(0); contain: paint; }'),
  E_extraCoverHold200: `(() => { const hook = () => { if (typeof hideThemeLoadScreen !== 'function') return setTimeout(hook, 1); const orig = hideThemeLoadScreen; let first = true; window.hideThemeLoadScreen = function (...a) { if (first) { first = false; setTimeout(() => orig.apply(this, a), 200); return 200; } return orig.apply(this, a); }; }; hook(); })()`,
  base: '',
  cancelEntrance: `(() => { new MutationObserver(() => { if (document.body.dataset.startupReveal !== 'normal' || window.__vDone) return; window.__vDone = true; for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; if (t && t.matches && t.matches('.topbar, .workspace, .player')) a.cancel(); } }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-startup-reveal'] }); })()`,
  cancelAllButCover: `(() => { new MutationObserver(() => { if (document.body.dataset.startupReveal !== 'normal' || window.__vDone) return; window.__vDone = true; for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; if (t && t.closest && t.closest('#themeLoadScreen')) continue; a.cancel(); } }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-startup-reveal'] }); })()`,
  bodyTransitionNone: `(() => { const iv = setInterval(() => { if (document.body) { document.body.style.transition = 'none'; clearInterval(iv); } }, 2); })()`,
  coverDisplayNoneAtReveal: `(() => { new MutationObserver(() => { if (document.body.dataset.startupReveal !== 'normal') return; const c = document.getElementById('themeLoadScreen'); if (c) c.style.display = 'none'; }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-startup-reveal'] }); })()`,
};

// ------------------------------------------------------------ animations list --
const ANIM_SNAPSHOT = `(() => {
  const sel = (t) => !t || !t.tagName ? '(none)' : t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (typeof t.className === 'string' && t.className.trim() ? '.' + t.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const snap = () => { const by = {}; for (const a of document.getAnimations({ subtree: true })) { const t = a.effect && a.effect.target; let props = []; try { props = [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))]; } catch {} let tm = {}; try { tm = a.effect.getComputedTiming(); } catch {} const key = sel(t) + ' | ' + (a.constructor.name) + ' ' + (a.animationName || a.transitionProperty || '') + ' | ' + props.join(',') + ' | ' + a.playState + (a.pending ? ' pending' : '') + ' dur=' + Math.round(tm.duration || 0) + ' iter=' + tm.iterations + ' delay=' + tm.delay; by[key] = (by[key] || 0) + 1; } return by; };
  window.__animSnaps = { frameBefore: null, atReveal: null, framesAfter: [] };
  const loop = () => { const b = document.body; if (!b) return requestAnimationFrame(loop); if (b.dataset.startupReveal === 'normal') { if (!window.__animSnaps.atReveal) window.__animSnaps.atReveal = { t: performance.now(), list: snap() }; window.__animSnaps.framesAfter.push({ t: performance.now(), list: snap() }); if (window.__animSnaps.framesAfter.length >= 2) return; } else { window.__animSnaps.frameBefore = { t: performance.now(), list: snap() }; } requestAnimationFrame(loop); };
  new MutationObserver(() => { if (document.body.dataset.startupReveal === 'normal' && !window.__animSnaps.atReveal) window.__animSnaps.atReveal = { t: performance.now(), list: snap() }; }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-startup-reveal'] });
  requestAnimationFrame(loop);
})()`;

async function main() {
  const report = { machine: { platform: `${process.platform}/${process.arch}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1) }, tracks: count, commit: require('node:child_process').execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() };
  const save = () => { if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2)); };
  if (what === 'paintops') {
    const app = await launchApp();
    try {
      const { cdp } = app; const trees = [];
      cdp.on('LayerTree.layerTreeDidChange', ({ layers }) => { if (layers) trees.push(layers); });
      await cdp.call('DOM.enable'); await cdp.call('LayerTree.enable');
      await until(async () => (await cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 5);
      await delay(250);
      const out = {};
      const wanted = {};
      for (let attempt = 0; attempt < 12 && Object.keys(wanted).length < 2; attempt += 1) {
        const layers = trees[trees.length - 1] || [];
        for (const l of layers.filter((x) => x.drawsContent && x.backendNodeId)) {
          let d; try { d = (await cdp.call('DOM.describeNode', { backendNodeId: l.backendNodeId })).node; } catch { continue; }
          const attrs = d.attributes || []; const cls = attrs[attrs.indexOf('class') + 1] || ''; const id = attrs[attrs.indexOf('id') + 1] || '';
          const name = /library-rail/.test(cls) ? 'library-rail' : /inspector/.test(cls + ' ' + id) ? 'inspector' : '';
          if (!name || wanted[name] || l.width * l.height > 900000) continue;
          try {
            const snap = await cdp.call('LayerTree.makeSnapshot', { layerId: l.layerId });
            const log = (await cdp.call('LayerTree.snapshotCommandLog', { snapshotId: snap.snapshotId })).commandLog || [];
            const prof = await cdp.call('LayerTree.profileSnapshot', { snapshotId: snap.snapshotId, minRepeatCount: 5, minDuration: 0.5 });
            const per = new Array(log.length).fill(0); let reps = 0;
            for (const run of prof.timings || []) { reps += 1; run.forEach((t, i) => { per[i] += t; }); }
            const by = {};
            log.forEach((c, i) => { const k = c.method; const bb = (by[k] ||= { count: 0, totalMs: 0, maxMs: 0 }); const ms = (per[i] / Math.max(1, reps)) * 1000; bb.count += 1; bb.totalMs += ms; bb.maxMs = Math.max(bb.maxMs, ms); });
            const ops = Object.entries(by).map(([k, v]) => ({ op: k, count: v.count, totalMs: r1(v.totalMs), maxMs: r1(v.maxMs) })).sort((x, y) => y.totalMs - x.totalMs).slice(0, 14);
            const costly = log.map((c, i) => ({ i, method: c.method, ms: r1((per[i] / Math.max(1, reps)) * 1000), params: JSON.stringify(c.params || {}).slice(0, 220) })).sort((x, y) => y.ms - x.ms).slice(0, 8);
            wanted[name] = true;
            (out[name] ||= []).push({ layerId: l.layerId, w: l.width, h: l.height, commands: log.length, replayMsTotal: r1(per.reduce((x, y) => x + y, 0) / Math.max(1, reps) * 1000), repeats: reps, topOps: ops, costliestCommands: costly });
          } catch (e) { out['err_' + name] = e.message; }
        }
        if (Object.keys(wanted).length < 2) await delay(300);
      }
      // CSS features inside each panel
      out.cssScan = await cdp.evaluate(`(() => {
        const scan = (root) => {
          const els = [root, ...root.querySelectorAll('*')]; const res = { elements: els.length, filter: {}, backdropFilter: {}, boxShadow: {}, gradient: {}, mixBlend: {}, textShadow: {}, mask: {}, opacityLt1: {}, willChange: {}, radius: {}, animation: {} };
          const key = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
          const bump = (m, k, extra) => { const b = (m[k] = m[k] || { n: 0, extra: extra }); b.n += 1; };
          for (const e of els) { const c = getComputedStyle(e); const k = key(e);
            if (c.filter !== 'none') bump(res.filter, k, c.filter.slice(0, 60));
            if (c.backdropFilter && c.backdropFilter !== 'none') bump(res.backdropFilter, k, c.backdropFilter.slice(0, 60));
            if (c.boxShadow !== 'none') bump(res.boxShadow, k, c.boxShadow.slice(0, 80));
            if (/gradient/.test(c.backgroundImage)) bump(res.gradient, k, c.backgroundImage.slice(0, 80));
            if (c.mixBlendMode !== 'normal') bump(res.mixBlend, k, c.mixBlendMode);
            if (c.textShadow !== 'none') bump(res.textShadow, k, c.textShadow.slice(0, 60));
            if (c.maskImage && c.maskImage !== 'none') bump(res.mask, k, c.maskImage.slice(0, 60));
            if (Number(c.opacity) < 1) bump(res.opacityLt1, k, c.opacity);
            if (c.willChange !== 'auto') bump(res.willChange, k, c.willChange);
            if (c.borderRadius !== '0px') bump(res.radius, k, c.borderRadius.slice(0, 30));
            if (c.animationName !== 'none') bump(res.animation, k, c.animationName);
          }
          for (const [m, v] of Object.entries(res)) if (typeof v === 'object') res[m] = Object.entries(v).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([k, x]) => k + ' x' + x.n + ' ' + x.extra);
          return res;
        };
        return { rail: scan(document.querySelector('.library-rail')), inspector: scan(document.querySelector('#inspectorPanel')) };
      })()`);
      report.paintops = out;
    } finally { await app.cleanup(app.cdp); }
    save(); console.log(JSON.stringify(report.paintops, null, 1)); return;
  }
  if (what === 'layers') {
    const app = await launchApp();
    try {
      const { cdp } = app; const trees = [];
      cdp.on('LayerTree.layerTreeDidChange', ({ layers }) => { if (layers) trees.push({ at: Date.now(), layers }); });
      await cdp.call('DOM.enable'); await cdp.call('LayerTree.enable');
      await until(async () => (await cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 5);
      await delay(250);
      const last = trees[trees.length - 1];
      const out = [];
      for (const l of (last?.layers || []).filter((x) => x.width * x.height >= 20000 || ['5', '114', '117', '122'].includes(String(x.layerId)))) {
        let reasons = []; try { reasons = (await cdp.call('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasonIds; } catch {}
        let node = ''; try { const d = await cdp.call('DOM.describeNode', { backendNodeId: l.backendNodeId }); node = d.node.nodeName + (d.node.attributes ? ' ' + (d.node.attributes.join('=').slice(0, 80)) : ''); } catch {}
        out.push({ layerId: l.layerId, w: l.width, h: l.height, drawsContent: l.drawsContent, paintCount: l.paintCount, reasons, node });
      }
      report.layers = { treesSeen: trees.length, totalLayers: last?.layers?.length, layers: out };
    } finally { await app.cleanup(app.cdp); }
    save(); console.log(JSON.stringify(report.layers, null, 1)); return;
  }
  if (what === 'census2') {
    const app = await launchApp();
    try {
      await until(async () => (await app.cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 5);
      await delay(1500);
      report.census2 = await app.cdp.evaluate(`(() => {
        const out = {};
        for (const [name, sel] of [['rail', '.library-rail'], ['inspector', '#inspectorPanel']]) {
          const root = document.querySelector(sel); const els = [root, ...root.querySelectorAll('*')];
          const c = { elements: els.length, mask: 0, clipPath: 0, radius: 0, radiusAndOverflowNotVisible: 0, overflowNotVisible: 0, gradient: 0, urlBackground: 0, boxShadow: 0, filter: 0, backdropFilter: 0, textShadow: 0, opacityLt1: 0, transform: 0, imageRenderingNotAuto: 0, imgElements: root.querySelectorAll('img').length, svgElements: root.querySelectorAll('svg').length, canvasElements: root.querySelectorAll('canvas').length, textNodes: 0, willChange: 0, mixBlend: 0, fontSmoothingOrLetterSpacing: 0 };
          const ex = { mask: [], clipPath: [], gradient: [], filter: [], imageRendering: [], radiusOverflow: [] };
          const key = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
          for (const e of els) {
            const s = getComputedStyle(e);
            if ((s.maskImage && s.maskImage !== 'none') || (s.webkitMaskImage && s.webkitMaskImage !== 'none')) { c.mask += 1; if (ex.mask.length < 4) ex.mask.push(key(e)); }
            if (s.clipPath !== 'none') { c.clipPath += 1; if (ex.clipPath.length < 4) ex.clipPath.push(key(e)); }
            const rad = s.borderRadius !== '0px';
            if (rad) c.radius += 1;
            if (s.overflowX !== 'visible' || s.overflowY !== 'visible') c.overflowNotVisible += 1;
            if (rad && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) { c.radiusAndOverflowNotVisible += 1; if (ex.radiusOverflow.length < 4) ex.radiusOverflow.push(key(e)); }
            if (/gradient/.test(s.backgroundImage)) { c.gradient += 1; if (ex.gradient.length < 4) ex.gradient.push(key(e)); }
            if (s.backgroundImage.indexOf('url(') >= 0) c.urlBackground += 1;
            if (s.boxShadow !== 'none') c.boxShadow += 1;
            if (s.filter !== 'none') { c.filter += 1; if (ex.filter.length < 4) ex.filter.push(key(e)); }
            if (s.backdropFilter && s.backdropFilter !== 'none') c.backdropFilter += 1;
            if (s.textShadow !== 'none') c.textShadow += 1;
            if (Number(s.opacity) < 1) c.opacityLt1 += 1;
            if (s.transform !== 'none') c.transform += 1;
            if (s.imageRendering !== 'auto') { c.imageRenderingNotAuto += 1; if (ex.imageRendering.length < 4) ex.imageRendering.push(key(e) + '=' + s.imageRendering); }
            if (s.willChange !== 'auto') c.willChange += 1;
            if (s.mixBlendMode !== 'normal') c.mixBlend += 1;
          }
          const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n = 0; while (tw.nextNode()) { if (tw.currentNode.textContent.trim()) n += 1; } c.textNodes = n;
          out[name] = { counts: c, examples: ex };
        }
        return out;
      })()`);
    } finally { await app.cleanup(app.cdp); }
    save(); console.log(JSON.stringify(report.census2, null, 1)); return;
  }
  if (what === 'palette') {
    const app = await launchApp();
    const out = {};
    try {
      const { cdp } = app;
      await cdp.call('Page.enable'); await cdp.call('Page.bringToFront');
      await until(() => cdp.evaluate('Boolean(document.body?.dataset.startupReveal==="normal"&&!document.body.classList.contains("theme-loading"))'), 'reveal', 60000, 50);
      await delay(4000);
      const mouse = (type, x, y) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      const clickSel = async (sel) => { const at = await cdp.evaluate(centerOf(sel)); if (!at) throw new Error('no ' + sel); await mouse('mouseMoved', at.x, at.y); await mouse('mousePressed', at.x, at.y); await mouse('mouseReleased', at.x, at.y); };
      await cdp.evaluate("document.querySelector('#settingsButton').click()"); await delay(800);
      await clickSel('[data-settings-tab="style"]'); await delay(600);
      const palettes = await cdp.evaluate("[...document.querySelectorAll('.palette-option[data-palette]')].map(b => b.dataset.palette)");
      out.palettes = palettes; out.switches = [];
      for (let round = 0; round < 3; round += 1) for (const p of palettes) {
        if ((await cdp.evaluate('document.body.dataset.palette')) === p) continue;
        await cdp.evaluate('(() => { window.__tp.gaps = []; window.__tp.longTasks = []; return 1; })()');
        await clickSel('.palette-option[data-palette="' + p + '"]'); await delay(900);
        const g = JSON.parse(await cdp.evaluate('JSON.stringify(window.__tp.gaps.map((x) => x.gap))'));
        const lt = JSON.parse(await cdp.evaluate('JSON.stringify(window.__tp.longTasks.map((x) => x.dur))'));
        out.switches.push({ p, frames: g.length, max: r1(Math.max(0, ...g)), over24: g.filter((x) => x > 24).length, over50: g.filter((x) => x > 50).length, longTasks: lt.map(Math.round) });
      }
      const mx = out.switches.map((x) => x.max).sort((a, b) => a - b);
      out.summary = { n: out.switches.length, medianMax: mx[mx.length >> 1], worst: mx[mx.length - 1], over24Total: out.switches.reduce((a, x) => a + x.over24, 0), over50Total: out.switches.reduce((a, x) => a + x.over50, 0), withLongTask: out.switches.filter((x) => x.longTasks.length).length };
    } finally { await app.cleanup(app.cdp); }
    report.palette = out; save(); console.log(JSON.stringify(out.summary)); return;
  }
  if (what === 'pipeline') {
    const app = await launchApp(); const { cdp } = app; const events = []; const out = {};
    try {
      await cdp.call('Page.enable'); await cdp.call('Page.bringToFront');
      await traceStart(cdp, events, CLEAN_CATEGORIES);
      await until(async () => ['normal', 'failed-closed'].includes(await cdp.evaluate('document.body?.dataset.startupReveal||""')), 'reveal', 60000, 10);
      await delay(3000);
      await traceStop(cdp);
      const mark = events.find((e) => e.name.startsWith('reveal:') && e.cat?.includes('blink.user_timing'));
      const tname = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [e.pid + ':' + e.tid, e.args?.name]));
      const frames = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.ts >= mark.ts - 100000 && e.ts <= mark.ts + 1500000);
      const bucket = {};
      for (const f of frames) { const b = Math.floor((f.ts - mark.ts) / 100000) * 100; const st = (f.args?.frame_reporter?.state || 'unknown').replace('STATE_', ''); const k = b; (bucket[k] ||= {}); bucket[k][st] = (bucket[k][st] || 0) + 1; }
      out.pipelineStatesPer100ms = Object.fromEntries(Object.entries(bucket).sort((a, b) => a[0] - b[0]));
      const win = events.filter((e) => e.ph === 'X' && e.ts >= mark.ts && e.ts <= mark.ts + 1200000 && e.dur >= 8000 && e.name !== 'RunTask' || (e.name === 'RunTask' && e.ph === 'X' && e.ts >= mark.ts && e.ts <= mark.ts + 1200000 && e.dur >= 8000));
      const rows = win.map((e) => ({ thread: (tname.get(e.pid + ':' + e.tid) || e.tid) + '', name: e.name, relMs: r1((e.ts - mark.ts) / 1000), durMs: r1(e.dur / 1000), arg: JSON.stringify(e.args?.tileData ? { layer: e.args.tileData.layerId } : (e.args?.data || {})).slice(0, 80) })).sort((a, b) => a.relMs - b.relMs);
      out.tasks = rows.filter((r) => ['CrGpuMain', 'VizCompositorThread', 'Compositor', 'CrRendererMain', 'ThreadPoolForegroundWorker', 'GpuVSyncThread'].includes(r.thread) && ['GPUTask', 'RasterTask', 'RunTask', 'ProxyMain::BeginMainFrame', 'LayerTreeHost::WaitForCommitCompletion', 'Commit', 'ImplFrame'].includes(r.name) || /Draw|Swap|Present|Activate|Raster/.test(r.name)).slice(0, 120);
      out.byThreadTotals = Object.entries(rows.reduce((a, r) => { const k = r.thread + ' :: ' + r.name; a[k] = (a[k] || 0) + r.durMs; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + ' = ' + r1(v) + ' ms');
      const gaps = JSON.parse(await cdp.evaluate('JSON.stringify(window.__tp.gaps.filter((g) => g.gap > 40).map((g) => ({ t: g.t, gap: g.gap })))'));
      const revealT = JSON.parse(await cdp.evaluate('JSON.stringify(window.__tp.events.find((e) => e.name.startsWith("reveal:")))')).t;
      out.rafGapsOver40 = gaps.map((g) => ({ relReveal: r1(g.t - revealT), gap: r1(g.gap) })).filter((g) => g.relReveal > -100 && g.relReveal < 1800);
    } finally { await app.cleanup(app.cdp); }
    report.pipeline = out; save(); return;
  }
  if (what === 'gpuinfo') {
    const app = await launchApp();
    try {
      const vp = (await (await fetch('http://127.0.0.1:' + (fs.readFileSync(path.join(app.profileDir, 'DevToolsActivePort'), 'utf8').split(String.fromCharCode(10))[0]) + '/json/version')).json());
      const b = await connect(vp.webSocketDebuggerUrl);
      const info = await b.call('SystemInfo.getInfo');
      b.close();
      report.gpuinfo = { devices: info.gpu.devices.map((d) => ({ vendor: d.vendorString, device: d.deviceString, driver: d.driverVendor + ' ' + d.driverVersion })), featureStatus: info.gpu.featureStatus, auxAttributes: info.gpu.auxAttributes, driverBugWorkarounds: info.gpu.driverBugWorkarounds, extraArgs: process.env.EXTRA_ELECTRON_ARGS || '' };
    } finally { await app.cleanup(app.cdp); }
    save(); console.log(JSON.stringify(report.gpuinfo, null, 1)); return;
  }
  if (what === 'interact') {
    const app = await launchApp();
    const out = { extraArgs: process.env.EXTRA_ELECTRON_ARGS || '' };
    try {
      const { cdp } = app;
      await cdp.call('Page.enable'); await cdp.call('Page.bringToFront');
      await until(() => cdp.evaluate('Boolean(document.body?.dataset.startupReveal==="normal"&&!document.body.classList.contains("theme-loading"))'), 'reveal', 60000, 50);
      await delay(4000);
      const stats = async () => { const g = JSON.parse(await cdp.evaluate('JSON.stringify(window.__tp.gaps.map((x) => x.gap))')); return { frames: g.length, max: r1(Math.max(0, ...g)), over24: g.filter((x) => x > 24).length, over50: g.filter((x) => x > 50).length, meanFrameMs: r1(g.reduce((a, b) => a + b, 0) / Math.max(1, g.length)) }; };
      const reset = () => cdp.evaluate('(() => { window.__tp.gaps = []; window.__tp.longTasks = []; return 1; })()');
      const center = async (sel) => cdp.evaluate('(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
      const click = async (sel) => { const at = await center(sel); for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.call('Input.dispatchMouseEvent', { type: t, x: at.x, y: at.y, button: t === 'mouseMoved' ? 'none' : 'left', buttons: t === 'mousePressed' ? 1 : 0, clickCount: 1 }); };
      out.scroll = [];
      for (let k = 0; k < 2; k += 1) {
        await reset(); const at = await center('#trackRows .track-row:nth-child(5)'); const t0 = Date.now();
        while (Date.now() - t0 < 5000) { await cdp.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 120 }); await delay(16); }
        await delay(200); out.scroll.push({ ...(await stats()), scrollTop: await cdp.evaluate('document.querySelector(".main-stage").scrollTop') });
        await cdp.evaluate('document.querySelector(".main-stage").scrollTop = 0'); await delay(500);
      }
      for (const [name, open, close] of [['settings', '#settingsButton', '#closeSettings'], ['queue', '#queueButton', null]]) {
        out[name] = [];
        for (let k = 0; k < 4; k += 1) {
          await reset(); await click(open); await delay(1000); out[name].push(await stats());
          if (close) await click(close); else await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await delay(700);
        }
      }
    } finally { await app.cleanup(app.cdp); }
    report.interact = out; save(); console.log(JSON.stringify(out)); return;
  }
  if (what === 'shot') {
    const name = arg('variant', 'W1_hideMainStage'); VARIANT_SCRIPT = VARIANT_SCRIPTS[name] || '';
    const app = await launchApp();
    try {
      const { cdp } = app; const errors = []; const logs = [];
      cdp.on('Runtime.exceptionThrown', (e) => errors.push(JSON.stringify(e.exceptionDetails).slice(0, 300)));
      cdp.on('Runtime.consoleAPICalled', (e) => { if (['error', 'warning'].includes(e.type)) logs.push(e.type + ': ' + (e.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200)); });
      await cdp.call('Page.enable'); await cdp.call('Log.enable').catch(() => {});
      cdp.on('Log.entryAdded', ({ entry }) => { if (['error', 'warning'].includes(entry.level)) logs.push('log ' + entry.level + ': ' + entry.text.slice(0, 200)); });
      await until(async () => (await cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 2);
      const probe = `(() => { const ms = document.querySelector('.main-stage'); const rows = [...document.querySelectorAll('#trackRows .track-row')]; const vis = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.bottom > 0 && b.top < innerHeight; }); return { t: Math.round(performance.now()), readiness: document.body.dataset.readiness, mainStageVisibility: ms && getComputedStyle(ms).visibility, workspaceOpacity: getComputedStyle(document.querySelector('.workspace')).opacity, rowsInDom: rows.length, rowsOnScreen: vis.length, firstRowText: vis[0] ? vis[0].textContent.trim().slice(0, 40) : '', rowVisibility: vis[0] ? getComputedStyle(vis[0]).visibility : '' }; })()`;
      report.shot = { variant: name, probes: {} };
      await delay(40);
      for (const [label, wait] of [['plus50ms', 0], ['plus300ms', 250], ['plus1500ms', 1200]]) {
        await delay(wait);
        report.shot.probes[label] = await cdp.evaluate(probe);
        const png = await cdp.call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(root, 'shot-' + name + '-' + label + '.png'), Buffer.from(png.data, 'base64'));
      }
      report.shot.errors = errors; report.shot.consoleErrorsAndWarnings = logs;
    } finally { VARIANT_SCRIPT = ''; await app.cleanup(app.cdp); }
    save(); console.log(JSON.stringify(report.shot, null, 1)); return;
  }
  if (what === 'variantsclean') {
    report.variantsClean = {};
    for (const name of arg('variants', 'CONTROL').split(',')) {
      VARIANT_SCRIPT = VARIANT_SCRIPTS[name]; report.variantsClean[name] = [];
      for (let i = 0; i < launches; i += 1) {
        console.error('variantsclean ' + name + ' ' + (i + 1));
        const r = await cleanTraceLaunch();
        report.variantsClean[name].push({ tasks: r.tasks.map((t) => ({ rel: t.startRelRevealMs, dur: t.durMs, kids: t.topLevelChildren })), raster: (r.rasterTimeline || []), gpuTasks: r.gpuTasks, pipeline: r.pipeline });
        save();
      }
    }
    VARIANT_SCRIPT = ''; return;
  }
  if (what === 'clean') {
    report.clean = [];
    for (let i = 0; i < launches; i += 1) { console.error('clean launch ' + (i + 1)); report.clean.push(await cleanTraceLaunch()); save(); }
    return;
  }
  if (what === 'cover') {
    const app = await launchApp();
    try {
      await until(async () => (await app.cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 10);
      await delay(3500);
      report.cover = await app.cdp.evaluate(COVER_PROBE);
    } finally { await app.cleanup(app.cdp); }
    save(); console.log(JSON.stringify(report.cover)); return;
  }
  if (what === 'variants') {
    report.variants = {};
    for (const name of arg('variants', Object.keys(VARIANT_SCRIPTS).join(',')).split(',')) {
      VARIANT_SCRIPT = VARIANT_SCRIPTS[name]; report.variants[name] = [];
      for (let i = 0; i < launches; i += 1) { console.error('variant ' + name + ' ' + (i + 1)); const r = await oneLaunch({ mode: 'plain' }); report.variants[name].push({ firstPaintMs: r.firstPaintMs, longTasksPreReveal: r.longTasksPreReveal, events: r.events.filter((e) => /^(cover|reveal)/.test(e.name)), revealMs: r.revealMs, spawnToRevealMs: r.spawnToRevealMs, coverGaps: r.coverGaps, postRevealGaps: r.postRevealGaps, longTasksNearReveal: r.longTasks.filter((l) => l.relReveal >= -100 && l.relReveal <= 3000), loafNearReveal: r.loaf.filter((l) => l.relReveal >= -50 && l.relReveal <= 600).map((l) => ({ rel: l.relReveal, dur: l.dur, blocking: l.blocking, styleLayoutStart: l.styleLayoutStart })) }); save(); }
    }
    VARIANT_SCRIPT = ''; return;
  }
  if (what === 'anims') {
    report.anims = [];
    for (let i = 0; i < launches; i += 1) {
      VARIANT_SCRIPT = ANIM_SNAPSHOT;
      const app = await launchApp();
      try {
        await until(async () => (await app.cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 10);
        await delay(800);
        report.anims.push(await app.cdp.evaluate('JSON.parse(JSON.stringify(window.__animSnaps))'));
      } finally { await app.cleanup(app.cdp); }
      save();
    }
    VARIANT_SCRIPT = ''; return;
  }
  if (what === 'probe') {
    report.probe = [];
    for (let i = 0; i < launches; i += 1) {
      const app = await launchApp();
      try {
        await until(async () => (await app.cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 5);
        const early = await app.cdp.evaluate(PROBE_EXPR);
        await delay(2500);
        const late = await app.cdp.evaluate(PROBE_EXPR);
        report.probe.push({ atReveal: early, at2500: late });
      } finally { await app.cleanup(app.cdp); }
      save();
    }
    console.log(JSON.stringify(report.probe, null, 1)); return;
  }
  if (what === 'census') {
    const app = await launchApp();
    try {
      await until(async () => (await app.cdp.evaluate('document.body?.dataset.startupReveal||""')) === 'normal', 'reveal', 60000, 10);
      report.census = await app.cdp.evaluate(`(() => {
        const key = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
        const tally = (list) => { const m = {}; for (const e of list) { const k = key(e); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25); };
        const all = [...document.querySelectorAll('*')];
        const inRows = all.filter((e) => e.closest('.track-row'));
        const stage = document.querySelector('.main-stage').getBoundingClientRect();
        const rowsOn = [...document.querySelectorAll('.track-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > stage.top && b.top < stage.bottom; });
        return { total: all.length, inTrackRows: inRows.length, notInTrackRows: all.length - inRows.length, rowsOnScreen: rowsOn.length, rowsInDom: document.querySelectorAll('.track-row').length, topInRows: tally(inRows), topOutsideRows: tally(all.filter((e) => !e.closest('.track-row'))), hiddenSurfaces: [...document.querySelectorAll('.hidden, [hidden]')].length, displayNoneElements: all.filter((e) => getComputedStyle(e).display === 'none').length };
      })()`);
    } finally { await app.cleanup(app.cdp); }
    console.log(JSON.stringify(report.census, null, 1)); return;
  }
  if (what === 'timeline') { report.launchTimeline = []; for (let i = 0; i < launches; i += 1) { console.error('timeline launch ' + (i + 1)); report.launchTimeline.push(await oneTimelineLaunch()); save(); } report.portTimeline = await portTimeline(arg('port', 'cartridge-quest'), arg('warm', 'orbital'), Number(arg('port-repeats', '3'))); save(); return; }
  if (what === 'trace') { report.traceRun = await oneLaunch({ mode: 'trace' }); save(); console.log(JSON.stringify(report.traceRun.trace, null, 1)); return; }
  if (what === 'launch' || what === 'all') {
    report.launch = { runs: [] };
    for (let i = 0; i < launches; i += 1) { console.error(`launch ${i + 1}/${launches}`); report.launch.runs.push(await oneLaunch({ mode: 'plain' })); save(); }
    console.error('launch profile run'); report.launch.profileRun = await oneLaunch({ mode: 'profile' }); save();
    console.error('launch trace run'); report.launch.traceRun = await oneLaunch({ mode: 'trace' }); save();
  }
  if (what === 'switch' || what === 'all') {
    console.error('switch run (idle)'); report.switchIdle = await runSwitches({ playingTrack: false }); save();
    if (playing || what === 'all') { console.error('switch run (playing)'); report.switchPlaying = await runSwitches({ playingTrack: true }); save(); }
  }
  save();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
