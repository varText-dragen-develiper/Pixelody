// Launches the real app on this machine with a 2,000-track generated library,
// plays a track through the EQ graph (muted), and checks the numbers behind the
// published minimum specs (docs/MINIMUM_SPECS.md): startup, memory, playback.
// Frame-rate and scroll figures are reported, not enforced, because hosted CI
// runners have software graphics and vary run to run.
//   node scripts/check-spec-budget.js [--tracks=2000]
// Linux CI: wrap in xvfb-run. Writes a table to GITHUB_STEP_SUMMARY when set.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { PixelodyStateStore } = require('../src/state-store');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const count = Number(arg('tracks', '2000'));
const BUDGET = { readyMs: 30000, playMs: 8000, memoryMB: process.platform === 'linux' ? 900 : 1800 };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, name, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await delay(100); }
  throw new Error(`Timeout waiting for ${name}`);
}

function wave(frequency, seconds = 4, rate = 44100) {
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
  const base = { path: file, album: 'Generated Signals', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, missing: false };
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
    'pixelody.appearance': { theme: 'studio', palette: 'gold', detail: 'balanced', motion: 'expressive' },
    'pixelody.motionEffects': {}, 'pixelody.interfaceSounds': { mode: 'off', volume: 0 }, 'pixelody.layout': {},
    'pixelody.profileImage': '', 'pixelody.cartridgeQuestStats': {}, 'pixelody.outputDeviceId': '',
    'pixelody.outputDeviceLabel': 'System Default', 'pixelody.volume': 0, 'pixelody.session': { id: 'spec-0', time: 0, volume: 0 },
    'pixelody.collapsedCards': {}, 'pixelody.collapsedSettingGroups': {}, 'pixelody.settingsTab': 'diagnostics',
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
    if (result.exceptionDetails) throw new Error(`Page script failed: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
    return result.result.value;
  };
  return { call, evaluate, close: () => socket.close() };
}

// Total memory of the app's process tree in MB: PSS on Linux (shared pages
// counted once), resident set elsewhere (shared pages counted per process).
function memoryMB(rootPid) {
  const table = new Map();
  if (process.platform === 'win32') {
    const json = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'], { encoding: 'utf8' });
    for (const p of [].concat(JSON.parse(json))) table.set(p.ProcessId, { parent: p.ParentProcessId, bytes: Number(p.WorkingSetSize) });
  } else {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n');
    for (const row of rows) { const [pid, ppid, rss] = row.trim().split(/\s+/).map(Number); table.set(pid, { parent: ppid, bytes: rss * 1024 }); }
  }
  const members = new Set([rootPid]);
  for (let grew = true; grew;) { grew = false; for (const [pid, p] of table) if (!members.has(pid) && members.has(p.parent)) { members.add(pid); grew = true; } }
  let total = 0;
  for (const pid of members) {
    if (process.platform === 'linux') {
      try { total += Number(/Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))[1]) * 1024; continue; } catch { /* fall through to rss */ }
    }
    total += table.get(pid)?.bytes || 0;
  }
  return { mb: Math.round(total / 1048576), processes: members.size };
}

const frameProbe = `(async()=>{const gaps=[];let last=performance.now();const end=last+3000;await new Promise((done)=>{(function tick(t){gaps.push(t-last);last=t;t<end?requestAnimationFrame(tick):done()})(last)});gaps.shift();gaps.sort((a,b)=>a-b);return{fps:+(gaps.length/3).toFixed(1),p95:+gaps[Math.floor(gaps.length*.95)].toFixed(1),max:+gaps[gaps.length-1].toFixed(1)}})()`;
const scrollProbe = `(async()=>{const el=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+500&&getComputedStyle(e).overflowY!=='visible')||document.scrollingElement;const gaps=[];let last=performance.now();for(let i=0;i<90;i++){el.scrollTop+=400;await new Promise(r=>requestAnimationFrame(t=>{gaps.push(t-last);last=t;r()}))}gaps.sort((a,b)=>a-b);return{p95:+gaps[Math.floor(gaps.length*.95)].toFixed(1),max:+gaps[gaps.length-1].toFixed(1)}})()`;

async function main() {
  const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixelody-specbudget-'));
  const profile = path.join(testRoot, 'profile');
  await fsp.mkdir(profile, { recursive: true });
  const media = path.join(testRoot, 'tone.wav');
  await fsp.writeFile(media, wave(330));
  const store = new PixelodyStateStore({ directory: path.join(profile, 'state'), backupIntervalMs: 0 });
  assertOk(store.commitSync(fixtureValues(media), { reason: 'spec-budget-fixture' }));

  const env = { ...process.env, PIXELODY_DEVELOPMENT_WINDOW_WIDTH: '1280', PIXELODY_DEVELOPMENT_WINDOW_HEIGHT: '720', PIXELODY_DEVELOPMENT_MAXIMIZED: '0' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PIXELODY_TEST_MODE', 'PIXELODY_TEST_LAUNCH', 'PIXELODY_CANVAS_PROFILE']) delete env[key];
  const args = ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--mute-audio', '--disable-gpu', '--disable-gpu-compositing'];
  // Hosted Linux runners have no setuid chrome-sandbox; check-smoke does the same.
  if (process.platform === 'linux') args.push('--no-sandbox');
  args.push(root, `--pixelody-dev-user-data=${profile}`);
  const launchedAt = Date.now();
  const child = spawn(require('electron'), args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; }); child.stderr.on('data', (d) => { output += d; });
  let cdp;
  const result = { platform: `${process.platform}/${process.arch}`, cpus: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), tracks: count };
  try {
    let port; let browserPath;
    await until(() => { try { [port, browserPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); return Boolean(port); } catch { return false; } }, 'debug port');
    let page;
    await until(async () => { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page' && p.url.includes('index.html')); return Boolean(page); }, 'main window');
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.call('Runtime.enable'); await cdp.call('Page.bringToFront');
    await until(() => cdp.evaluate(`Boolean(document.body?.dataset.startupReveal==='normal'&&!document.body.classList.contains('theme-loading'))`), 'startup reveal', BUDGET.readyMs);
    result.readyMs = Date.now() - launchedAt;
    await delay(3000);
    result.idleMemoryMB = memoryMB(child.pid).mb;
    result.idleFrames = await cdp.evaluate(frameProbe);
    const play = await cdp.evaluate(`(async()=>{const t=performance.now();await playTrack('spec-1');await new Promise(r=>setTimeout(r,500));return{ms:Math.round(performance.now()-t),paused:audio.paused,context:state.context?state.context.state:'none'}})()`);
    result.playMs = play.ms; result.audioContext = play.context; result.playing = !play.paused;
    result.playFrames = await cdp.evaluate(frameProbe);
    result.scroll = await cdp.evaluate(scrollProbe);
    const mem = memoryMB(child.pid);
    result.memoryMB = mem.mb; result.processes = mem.processes;
  } catch (error) {
    error.message += `\nApp output:\n${output.slice(-1500)}`;
    throw error;
  } finally {
    cdp?.close();
    child.kill();
    await delay(500);
    await fsp.rm(testRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
  }
  const failures = [];
  if (result.readyMs > BUDGET.readyMs) failures.push(`startup ${result.readyMs} ms > ${BUDGET.readyMs} ms`);
  if (!result.playing || result.audioContext !== 'running') failures.push(`playback did not run through the audio graph (playing=${result.playing}, context=${result.audioContext})`);
  if (result.playMs > BUDGET.playMs) failures.push(`play took ${result.playMs} ms > ${BUDGET.playMs} ms`);
  if (result.memoryMB > BUDGET.memoryMB) failures.push(`memory ${result.memoryMB} MB > ${BUDGET.memoryMB} MB`);
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [['Platform', result.platform], ['CPUs / RAM', `${result.cpus} / ${result.ramGB} GB`], ['Tracks', result.tracks], ['Startup', `${result.readyMs} ms (budget ${BUDGET.readyMs})`], ['Memory, all processes', `${result.memoryMB} MB idle ${result.idleMemoryMB} (budget ${BUDGET.memoryMB})`], ['Play to audio running', `${result.playMs} ms, context ${result.audioContext}`], ['Frames idle / playing', `${result.idleFrames.fps} / ${result.playFrames.fps} fps, p95 ${result.playFrames.p95} ms`], ['Fast scroll p95', `${result.scroll.p95} ms`]];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Spec budget\n\n| Measure | Value |\n| --- | --- |\n${rows.map((r) => `| ${r[0]} | ${r[1]} |`).join('\n')}\n\n`);
  }
  if (failures.length) { console.error(`Spec budget failed:\n- ${failures.join('\n- ')}\n${output.slice(-1500)}`); process.exitCode = 1; return; }
  console.log('Spec budget passed.');
}

function assertOk(commit) { if (!commit?.ok) throw new Error('Could not seed the generated profile.'); }

main().catch((error) => { console.error(error); process.exit(1); });
