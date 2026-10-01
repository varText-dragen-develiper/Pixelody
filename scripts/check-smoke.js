const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PixelodyStateStore } = require('../src/state-store');

const root = path.resolve(__dirname, '..');
const failureRoot = path.join(root, '.artifacts', 'smoke-failures');
const scenarioArgument = process.argv.find((arg) => arg.startsWith('--scenario='))?.slice('--scenario='.length) || '';
const keepPassingProfiles = process.argv.includes('--keep-profiles');

const validScenarios = new Set(['fresh', 'core', 'recovery', 'sharing-privacy', 'security']);
if (scenarioArgument && !validScenarios.has(scenarioArgument)) {
  throw new Error(`Unsupported smoke test scenario: ${scenarioArgument}. Supported: ${[...validScenarios].join(', ')}`);
}

function assertInside(base, target, label) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its owned root (${base}).`);
  }
}

function sanitizeText(value, ownedRoot = '') {
  let text = String(value || '');
  if (ownedRoot) text = text.split(ownedRoot).join('[test-root-hidden]');
  return text
    .replace(/[a-zA-Z]:\\[^\r\n"']+/g, '[windows-path-hidden]')
    .replace(/\/[\w.-]+(?:\/[\w.-]+)+/g, '[unix-path-hidden]')
    .replace(/file:\/\/\/[^\s"']+/gi, '[file-url-hidden]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credential-hidden]')
    .slice(0, 200000);
}

async function removeOwnedTemporaryRoot(target) {
  const resolvedTemp = path.resolve(os.tmpdir());
  assertInside(resolvedTemp, target, 'Smoke test temporary root');
  if (!path.basename(target).startsWith('pixelody-smoke-')) {
    throw new Error('Refusing to remove a non-smoke temporary root.');
  }
  await fsp.rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}

function createWaveBuffer(frequency, seconds = 4, sampleRate = 44100) {
  const frames = Math.round(seconds * sampleRate);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.min(1, frame / 500) * Math.min(1, (frames - frame) / 500);
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 0.12 * envelope * 32767), 44 + frame * 2);
  }
  return buffer;
}

function fixtureValues(fixtureDirectory) {
  const tracks = [
    { id: 'fixture-tone-a', path: path.join(fixtureDirectory, 'fixture-a.wav'), title: 'Fixture A', artist: 'Pixelody Test', album: 'Generated Signals', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, missing: false, dateAdded: 1 },
    { id: 'fixture-tone-b', path: path.join(fixtureDirectory, 'fixture-b.wav'), title: 'Fixture B', artist: 'Pixelody Test', album: 'Generated Signals', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, missing: false, dateAdded: 2 },
  ];
  return {
    'aurelia.library': tracks,
    'aurelia.playlists': [
      { id: 'all', name: 'All Music', trackIds: tracks.map((track) => track.id), background: null },
      { id: 'fixture-mix', name: 'Integration Mix', trackIds: tracks.map((track) => track.id), background: null },
    ],
    'aurelia.tunings': {},
    'aurelia.systems': {},
    'aurelia.activePlaylist': 'all',
    'pixelody.spatialProfiles': {},
    'pixelody.speakerSystems': [],
    'pixelody.activeSpeakerSystemId': '',
    'pixelody.libraryMode': 'playlists',
    'pixelody.collectionBackgrounds': {},
    'pixelody.favorites': [],
    'pixelody.history': [],
    'pixelody.playCounts': {},
    'pixelody.signalJournal': {},
    'pixelody.signalSettings': {},
    'pixelody.migrationReports': [],
    'pixelody.wantedTracks': [],
    'pixelody.queue': tracks.map((track) => track.id),
    'pixelody.shuffle': false,
    'pixelody.flowShuffle': {},
    'pixelody.repeat': 'off',
    'pixelody.sort': 'added-desc',
    'pixelody.eqModes': { track: 'simple', system: 'simple' },
    'pixelody.systemTuningMode': {},
    'pixelody.speakerSystemPrototype': {},
    'pixelody.appearance': { theme: 'studio', palette: 'gold', detail: 'balanced', motion: 'off' },
    'pixelody.motionEffects': { glow: false, dots: false, hover: false, panels: false, artwork: false },
    'pixelody.interfaceSounds': { mode: 'off', volume: 0 },
    'pixelody.layout': {},
    'pixelody.profileImage': '',
    'pixelody.cartridgeQuestStats': {},
    'pixelody.outputDeviceId': '',
    'pixelody.outputDeviceLabel': 'System Default',
    'pixelody.volume': 0.6,
    'pixelody.session': { id: 'fixture-tone-a', time: 0.2, volume: 0.6 },
    'pixelody.collapsedCards': {},
    'pixelody.collapsedSettingGroups': {},
    'pixelody.settingsTab': 'diagnostics',
    'pixelody.signalOrbitRepair': 'visible-ring-v1',
  };
}

async function createOwnedProfile(label, options = {}) {
  const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `pixelody-smoke-${label}-`));
  const profile = path.join(testRoot, 'profile');
  const fixtures = path.join(testRoot, 'fixtures');
  await fsp.mkdir(profile, { recursive: true });
  await fsp.mkdir(fixtures, { recursive: true });
  await fsp.writeFile(path.join(fixtures, 'fixture-a.wav'), createWaveBuffer(330));
  await fsp.writeFile(path.join(fixtures, 'fixture-b.wav'), createWaveBuffer(550));
  if (options.seed !== false) {
    const store = new PixelodyStateStore({ directory: path.join(profile, 'state'), backupIntervalMs: 0 });
    const values = fixtureValues(fixtures);
    store.commitSync(values, { reason: 'smoke-fixture' });
    if (options.recovery) {
      store.commitSync({ ...values, 'pixelody.favorites': ['fixture-tone-a'] }, { reason: 'smoke-newer-generation' });
      await fsp.writeFile(store.paths.current, '{"truncated":', 'utf8');
    }
  }
  return { testRoot, profile, fixtures, report: path.join(profile, 'integration-report.jsonl') };
}

function parseReport(text) {
  return String(text || '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function retainFailure(scenario, owned, result, error) {
  await fsp.mkdir(failureRoot, { recursive: true });
  const target = path.join(failureRoot, `${process.platform}-${scenario}`);
  assertInside(failureRoot, target, 'Failure artifact directory');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  const reportText = fs.existsSync(owned.report) ? await fsp.readFile(owned.report, 'utf8') : '';
  await fsp.writeFile(path.join(target, 'report.jsonl'), sanitizeText(reportText, owned.testRoot), 'utf8');
  await fsp.writeFile(path.join(target, 'process.log'), sanitizeText(`${result?.stdout || ''}\n${result?.stderr || ''}`, owned.testRoot), 'utf8');
  await fsp.writeFile(path.join(target, 'failure.json'), `${JSON.stringify({ platform: process.platform, scenario, message: sanitizeText(error.message || String(error), owned.testRoot), privacy: { pathsHidden: true, fixtureOnly: true, credentialsIncluded: false } }, null, 2)}\n`, 'utf8');
  const screenshot = path.join(owned.profile, 'integration-failure.png');
  if (fs.existsSync(screenshot)) {
    await fsp.copyFile(screenshot, path.join(target, 'integration-failure.png'));
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || !Number.isInteger(child.pid)) return;
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    await waitForExit(child, 3000);
    return;
  }
  const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await waitForExit(killer, 5000);
  await waitForExit(child, 3000);
}

async function launchScenario(executable, scenario, owned) {
  await fsp.rm(owned.report, { force: true });
  const args = [
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    // The core scenario asserts the animated theme loader. Hosted macOS
    // runners enable the OS Reduce Motion setting, which the renderer
    // correctly honors, so pin the media query instead of inheriting it.
    '--force-prefers-no-reduced-motion',
  ];
  if (process.platform === 'linux') {
    args.push('--no-sandbox');
  }
  args.push(
    root,
    '--pixelody-integration-test',
    `--pixelody-test-scenario=${scenario}`,
    `--pixelody-test-user-data=${owned.profile}`,
    `--pixelody-test-report=${owned.report}`,
  );
  const childEnv = {
    ...process.env,
    PIXELODY_TEST_MODE: '1',
    PIXELODY_VISUAL_MODE: '0',
    PIXELODY_DEVELOPMENT_MAXIMIZED: '0',
    PIXELODY_TEST_LAUNCH: '1',
    PIXELODY_TEST_SCENARIO: scenario,
    PIXELODY_TEST_USER_DATA: owned.profile,
    PIXELODY_TEST_REPORT: owned.report,
    PIXELODY_DEV_CLEAR_CACHE: '0',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, args, {
    cwd: root,
    env: childEnv,
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-200000); });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-200000); });
  const deadline = Date.now() + 30000;
  let terminal = null;
  while (Date.now() < deadline && !terminal) {
    if (fs.existsSync(owned.report)) {
      try {
        const records = parseReport(await fsp.readFile(owned.report, 'utf8'));
        terminal = records.find((record) => record.event === 'terminal') || null;
      } catch {}
    }
    if (!terminal && child.exitCode !== null) break;
    if (!terminal) await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (!terminal) {
    await terminateProcessTree(child);
    const error = new Error(`Smoke scenario ${scenario} did not produce a terminal report within 30 seconds.`);
    error.processResult = { stdout, stderr, exitCode: child.exitCode };
    throw error;
  }
  const exitCode = await waitForExit(child, 5000);
  if (exitCode === null) {
    await terminateProcessTree(child);
  }
  const result = { stdout, stderr, exitCode: child.exitCode, terminal };
  if (terminal.detail?.ok !== true) {
    const error = new Error(`Smoke scenario ${scenario} failed: ${terminal.detail?.summary?.message || terminal.detail?.code || 'unknown failure'}`);
    error.processResult = result;
    throw error;
  }
  return result;
}

async function main() {
  assertInside(path.join(root, '.artifacts'), failureRoot, 'Smoke failure artifact root');
  await fsp.rm(failureRoot, { recursive: true, force: true });
  await fsp.mkdir(failureRoot, { recursive: true });
  const executable = require('electron');
  const passingRoots = [];

  async function runSingle(scenario, options = {}) {
    const owned = await createOwnedProfile(scenario, { ...options, scenario });
    passingRoots.push(owned.testRoot);
    let result = null;
    try {
      result = await launchScenario(executable, scenario, owned);
      console.log(`PASS smoke ${scenario}`);
      return { owned, result };
    } catch (error) {
      await retainFailure(scenario, owned, error.processResult || result, error);
      await removeOwnedTemporaryRoot(owned.testRoot);
      throw error;
    }
  }


  const scenariosToRun = scenarioArgument ? [scenarioArgument] : ['fresh', 'core', 'recovery', 'sharing-privacy', 'security'];
  try {
    for (const scenario of scenariosToRun) {
      await runSingle(scenario, {
        seed: scenario !== 'fresh' && scenario !== 'security',
        recovery: scenario === 'recovery',
      });
    }
  } finally {
    if (!keepPassingProfiles) {
      for (const target of passingRoots) {
        await removeOwnedTemporaryRoot(target).catch(() => {});
      }
    }
  }
  console.log(`Cross-platform smoke harness passed on ${process.platform} for: ${scenariosToRun.join(', ')}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { createWaveBuffer, fixtureValues };
