const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { PixelodyStateStore, WORKSPACE_THEME_IDS } = require('../src/state-store');
const { createAuthority: createWorkspaceAuthority } = require('../src/workspace-composition/persistence');
const composableThemeExperiment = require('../src/workspace-composition/theme-experiment');
const canvasStudioPreset = require('../src/workspace-composition/canvas-studio-preset');
const { buildWindowsSmokePackage } = require('./package-windows-smoke');
const releaseIdentity = require('../release/windows-identity.json');

const root = path.resolve(__dirname, '..');
const failureRoot = path.join(root, '.artifacts', 'windows-integration');
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='))?.slice('--mode='.length) || 'unpacked';
const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='))?.slice('--scenario='.length) || '';
const executableArgument = process.argv.find((argument) => argument.startsWith('--executable='))?.slice('--executable='.length) || '';
const productionExecutable = path.resolve(executableArgument || path.join(root, '.artifacts', 'windows-release', 'instrumented', 'win-unpacked', `${releaseIdentity.executableName}.exe`));
const keepPassingProfiles = process.argv.includes('--keep-profiles');
const visualMode = process.argv.includes('--visual-mode');
const hostInProcessGpu = process.argv.includes('--host-in-process-gpu');
const singularityReducedMotion = process.argv.includes('--singularity-reduced-motion');
const singularityForcedColors = process.argv.includes('--singularity-forced-colors');
// Canvas Studio is a development-only surface. The release gate
// runs without them; the non-blocking canvas-development CI job runs them.
const skipDevelopmentCanvas = process.argv.includes('--skip-development-canvas');
const validModes = new Set(['unpacked', 'packaged', 'production', 'all']);
const validScenarios = new Set(['fresh', 'core', 'counterform-choir', 'singularity-stage3', 'singularity-stage3-proxy', 'theme-imprints', 'theme-package', 'theme-package-write', 'theme-package-read', 'flow-runtime', 'persistence-write', 'persistence-read', 'workspace-persistence-write', 'workspace-persistence-read', 'workspace-production', 'workspace-theme-experiment', 'workspace-canvas-studio', 'output-loss', 'recovery', 'sharing-privacy', 'security']);
const singularityScenarios = new Set(['singularity-stage3', 'singularity-stage3-proxy']);
const singularityEvidenceSources = [
  'src/workspace-composition/singularity-contract.js',
  'src/workspace-composition/singularity-profile.js',
  'src/workspace-composition/singularity-panel-model.js',
  'src/workspace-composition/singularity-proxy-portal-probe.js',
  'src/workspace-composition/singularity-graph-projection-probe.js',
  'src/workspace-composition/singularity-live-host.js',
  'src/singularity-probe.css',
  'src/mini-singularity-probe.css',
  'src/index.html',
  'src/renderer.js',
  'src/mini-player.html',
  'src/mini-player.js',
  'src/main.js',
  'src/electron-security.js',
  'src/preload.js',
  'src/integration-test-runner.js',
  'scripts/check-singularity-probe.js',
  'scripts/check-singularity-receipts.js',
  'scripts/check-electron-security.js',
  'scripts/check-windows-integration.js',
  'package.json',
  'Launch Pixelody.ps1',
  'Start Pixelody Singularity Proxy.cmd',
  'Start Pixelody Singularity Graph.cmd',
];
if (process.platform !== 'win32') throw new Error('Pixelody desktop integration checks require Windows.');
if (!validModes.has(modeArgument)) throw new Error(`Unsupported integration mode: ${modeArgument}`);
if (scenarioArgument && !validScenarios.has(scenarioArgument)) throw new Error(`Unsupported integration scenario: ${scenarioArgument}`);
if ([...singularityScenarios, 'workspace-production', 'workspace-theme-experiment', 'workspace-canvas-studio'].includes(scenarioArgument) && modeArgument !== 'unpacked') throw new Error('Development workspace scenarios require --mode=unpacked.');
if (hostInProcessGpu && modeArgument !== 'unpacked') throw new Error('The host in-process GPU diagnostic is unpacked-only.');
if (hostInProcessGpu && visualMode) throw new Error('The host in-process GPU diagnostic cannot produce painted evidence.');
if (singularityReducedMotion && !singularityScenarios.has(scenarioArgument)) throw new Error('The Singularity reduced-motion mode requires an explicit Singularity scenario.');
if (singularityReducedMotion && (visualMode || hostInProcessGpu)) throw new Error('The Singularity reduced-motion mode is a separate non-painted evidence class.');
if (singularityForcedColors && !singularityScenarios.has(scenarioArgument)) throw new Error('The Singularity forced-colors mode requires an explicit Singularity scenario.');
if (singularityForcedColors && (visualMode || hostInProcessGpu || singularityReducedMotion)) throw new Error('The Singularity forced-colors mode is a separate non-painted evidence class.');
if (scenarioArgument === 'theme-imprints' && (modeArgument !== 'unpacked' || !visualMode)) throw new Error('Theme imprint capture requires --mode=unpacked --visual-mode.');
if (modeArgument === 'production') {
  assertInside(path.join(root, '.artifacts'), productionExecutable, 'Production executable');
  if (path.basename(productionExecutable).toLowerCase() !== `${releaseIdentity.executableName}.exe`.toLowerCase() || !fs.existsSync(productionExecutable)) throw new Error('Production executable must match the release identity under .artifacts.');
}

function assertInside(base, target, label) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} is outside its owned root.`);
}

function sanitizeText(value, ownedRoot = '') {
  let text = String(value || '');
  if (ownedRoot) text = text.split(ownedRoot).join('[test-root-hidden]');
  return text
    .replace(/[a-zA-Z]:\\[^\r\n"']+/g, '[windows-path-hidden]')
    .replace(/file:\/\/\/[^\s"']+/gi, '[file-url-hidden]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credential-hidden]')
    .slice(0, 200000);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fileSha256(filePath) {
  return sha256(await fsp.readFile(filePath));
}

async function singularityEvidenceIdentity(scenario) {
  const sourceFiles = {};
  for (const relativePath of singularityEvidenceSources) {
    sourceFiles[relativePath] = await fileSha256(path.join(root, relativePath));
  }
  const sourceBundle = Object.entries(sourceFiles).map(([relativePath, hash]) => `${relativePath}:${hash}`).join('\n');
  const normalizedFixture = JSON.stringify(fixtureValues('__fixture__', scenario)).replace(/\\\\/g, '/');
  return {
    hypothesisId: scenario === 'singularity-stage3' ? 'H-B R2 Graph' : 'H-A Proxy/portal',
    candidateId: null,
    selectionStatus: 'unselected-comparison-hypothesis',
    fixture: {
      id: 'singularity-hostile-eight-track-r1',
      sha256: sha256(normalizedFixture),
    },
    sourceScope: {
      algorithm: 'sha256',
      bundleSha256: sha256(sourceBundle),
      files: sourceFiles,
    },
  };
}

async function removeOwnedTemporaryRoot(target) {
  const resolvedTemp = path.resolve(os.tmpdir());
  assertInside(resolvedTemp, target, 'Integration temporary root');
  if (!path.basename(target).startsWith('pixelody-integration-')) throw new Error('Refusing to remove a non-integration temporary root.');
  try {
    await fsp.rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
    // A crashed Chromium grandchild can briefly retain profile databases on
    // Windows. The owned root is unique and remains inside os.tmpdir(); report
    // the deferred cleanup without replacing the scenario's actual outcome.
    console.warn(`WARN retained locked integration temp root (${error.code}): ${path.basename(target)}`);
  }
}

async function stageProductionPackage(executable) {
  const sourceDirectory = path.dirname(executable);
  const stageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixelody-production-launch-'));
  const targetDirectory = path.join(stageRoot, 'app');
  await fsp.cp(sourceDirectory, targetDirectory, { recursive: true, dereference: true });
  const canonicalTargetDirectory = await fsp.realpath(targetDirectory);
  return { stageRoot, executable: path.join(canonicalTargetDirectory, `${releaseIdentity.executableName}.exe`) };
}

async function removeProductionStage(target) {
  const resolvedTemp = path.resolve(os.tmpdir());
  assertInside(resolvedTemp, target, 'Production staging root');
  if (!path.basename(target).startsWith('pixelody-production-launch-')) throw new Error('Refusing to remove a non-production staging root.');
  await fsp.rm(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
}

function createWaveBuffer(frequency, seconds = 4, sampleRate = 44100) {
  const frames = Math.round(seconds * sampleRate);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.min(1, frame / 500) * Math.min(1, (frames - frame) / 500);
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 0.12 * envelope * 32767), 44 + frame * 2);
  }
  return buffer;
}

function fixtureValues(fixtureDirectory, scenario = '') {
  const counterform = scenario === 'counterform-choir';
  const hostileTheme = counterform || singularityScenarios.has(scenario);
  const tracks = hostileTheme ? [
    { id: 'cf-track-01', path: path.join(fixtureDirectory, 'fixture-a.wav'), title: 'Previous Voice / 밝은 밤', artist: 'Unknown Artist', album: 'Warm Pearl Studies', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-bright.svg'), missing: false, dateAdded: 8 },
    { id: 'cf-track-02', path: path.join(fixtureDirectory, 'fixture-b.wav'), title: 'Luminous Entry / Untitled', artist: 'Field Recording', album: 'Counter-curve Assembly', format: 'FLAC', codec: 'PCM', duration: 4, sampleRate: 96000, bitDepth: 24, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-dark.svg'), missing: false, dateAdded: 7 },
    { id: 'cf-track-03', path: path.join(fixtureDirectory, 'fixture-a.wav'), title: 'The Unreasonably Long Track Title (Live at Łódź)', artist: 'A Very Long Artist Name', album: 'Collected Counterforms / 記憶', format: 'FLAC', codec: 'PCM', duration: 4, sampleRate: 96000, bitDepth: 24, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-near-black.svg'), missing: false, dateAdded: 6 },
    { id: 'cf-track-04', path: path.join(fixtureDirectory, 'fixture-b.wav'), title: '미완성 궤도 / Not Yet Playing', artist: 'Choir Assembly', album: 'Open Score', format: 'ALAC', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-high-key.svg'), missing: false, dateAdded: 5 },
    { id: 'cf-track-05', path: path.join(fixtureDirectory, 'fixture-a.wav'), title: 'White Aperture Does Not Mean Play', artist: 'State Truth Unit', album: 'Selected ≠ Current', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-neutral.svg'), missing: false, dateAdded: 4 },
    { id: 'cf-track-06', path: path.join(fixtureDirectory, 'fixture-b.wav'), title: 'A/B seam — close inspection', artist: 'Material Proof Choir', album: 'Face / underside / seam', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-graphic.svg'), missing: false, dateAdded: 3 },
    { id: 'cf-track-07', path: path.join(fixtureDirectory, 'fixture-a.wav'), title: 'Low Contrast User Artwork / recover me', artist: 'Quiet Signal', album: 'Do Not Occlude', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: path.join(fixtureDirectory, 'art-low-contrast.svg'), missing: false, dateAdded: 2 },
    { id: 'cf-track-08', path: path.join(fixtureDirectory, 'missing.wav'), title: '□□□□□ / Missing Artwork + Missing Source', artist: 'Unknown Artist', album: 'Failure Must Preserve Current', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, artworkPath: null, missing: false, dateAdded: 1 },
  ] : [
    { id: 'fixture-tone-a', path: path.join(fixtureDirectory, 'fixture-a.wav'), title: 'Fixture A', artist: 'Pixelody Test', album: 'Generated Signals', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, missing: false, dateAdded: 1 },
    { id: 'fixture-tone-b', path: path.join(fixtureDirectory, 'fixture-b.wav'), title: 'Fixture B', artist: 'Pixelody Test', album: 'Generated Signals', format: 'WAV', codec: 'PCM', duration: 4, sampleRate: 44100, bitDepth: 16, bitrate: 705600, channels: 1, lossless: true, metadataVersion: 1, missing: false, dateAdded: 2 },
  ];
  return {
    'aurelia.library': tracks,
    'aurelia.playlists': hostileTheme ? [
      { id: 'all', name: 'A Very Long Collection Name / 記憶 ∑ Choir', trackIds: tracks.map((track) => track.id), background: path.join(fixtureDirectory, 'art-bright.svg') },
      { id: 'empty-score', name: 'Empty Score / まだ聴いていない', trackIds: [], background: null },
    ] : [
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
    'pixelody.appearance': counterform
      ? { theme: 'counterform-choir', palette: 'counterform-choir', detail: 'rich', motion: 'expressive' }
      : { theme: 'studio', palette: 'gold', detail: 'balanced', motion: 'off' },
    'pixelody.motionEffects': { glow: false, dots: false, hover: false, panels: false, artwork: false },
    'pixelody.interfaceSounds': { mode: 'off', volume: 0 },
    'pixelody.layout': {},
    'pixelody.profileImage': '',
    'pixelody.cartridgeQuestStats': {},
    'pixelody.outputDeviceId': '',
    'pixelody.outputDeviceLabel': 'System Default',
    'pixelody.volume': 0.6,
    'pixelody.session': { id: hostileTheme ? 'cf-track-03' : 'fixture-tone-a', time: 0.2, volume: 0.6 },
    'pixelody.collapsedCards': {},
    'pixelody.collapsedSettingGroups': {},
    'pixelody.settingsTab': 'diagnostics',
    'pixelody.signalOrbitRepair': 'visible-ring-v1',
  };
}

async function createOwnedProfile(label, options = {}) {
  const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `pixelody-integration-${label}-`));
  const profile = path.join(testRoot, 'profile');
  const fixtures = path.join(testRoot, 'fixtures');
  await fsp.mkdir(profile, { recursive: true });
  await fsp.mkdir(fixtures, { recursive: true });
  await fsp.writeFile(path.join(fixtures, 'fixture-a.wav'), createWaveBuffer(330));
  await fsp.writeFile(path.join(fixtures, 'fixture-b.wav'), createWaveBuffer(550));
  const artFixtures = [
    ['art-bright.svg', '#fffdf7', '#2f4dff'],
    ['art-dark.svg', '#17102f', '#32d8c4'],
    ['art-near-black.svg', '#080611', '#6d5dff'],
    ['art-high-key.svg', '#ffffff', '#69d8ff'],
    ['art-neutral.svg', '#b8b2c9', '#211553'],
    ['art-graphic.svg', '#2f4dff', '#e84f67'],
    ['art-low-contrast.svg', '#ded9ec', '#cbc5dd'],
  ];
  await Promise.all(artFixtures.map(([name, base, accent], index) => fsp.writeFile(path.join(fixtures, name), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${base}"/><path d="M-40 ${90 + index * 23} C120 ${20 + index * 11} 270 ${460 - index * 17} 560 ${180 + index * 19}" fill="none" stroke="${accent}" stroke-width="${28 + index * 3}"/><circle cx="${110 + index * 37}" cy="${330 - index * 21}" r="${44 + index * 5}" fill="${accent}" opacity=".72"/></svg>`, 'utf8')));
  if (options.seed !== false) {
    const workspaceProfile = options.scenario === 'workspace-theme-experiment'
      ? composableThemeExperiment
      : options.scenario === 'workspace-canvas-studio'
        ? canvasStudioPreset
        : null;
    const workspaceAuthority = workspaceProfile ? createWorkspaceAuthority({
      creatorDefaultGraph: workspaceProfile.graphForVersion(1),
      themeIds: [...WORKSPACE_THEME_IDS, workspaceProfile.THEME_ID],
      defaultThemeId: workspaceProfile.THEME_ID,
      requiredJobs: workspaceProfile.REQUIRED_JOBS,
      commitRequiredJobs: workspaceProfile.COMMIT_REQUIRED_JOBS || workspaceProfile.REQUIRED_JOBS,
    }) : undefined;
    const values = fixtureValues(fixtures, options.scenario || '');
    const stateDirectory = path.join(profile, 'state');
    const store = new PixelodyStateStore({ directory: stateDirectory, backupIntervalMs: 0, workspaceAuthority });
    store.commitSync(values, { reason: 'integration-fixture' });
    if (options.recovery) {
      store.commitSync({ ...values, 'pixelody.favorites': ['fixture-tone-a'] }, { reason: 'integration-newer-generation' });
      await fsp.writeFile(store.paths.current, '{"truncated":', 'utf8');
    }
  }
  return { testRoot, profile, fixtures, report: path.join(profile, 'integration-report.jsonl') };
}

function parseReport(text) {
  return String(text || '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function retainFailure(mode, scenario, owned, result, error) {
  await fsp.mkdir(failureRoot, { recursive: true });
  const suffix = hostInProcessGpu ? '-in-process-diagnostic' : visualMode ? '-visual' : singularityReducedMotion ? '-reduced-motion' : singularityForcedColors ? '-forced-colors' : '';
  // A flaky launch must not erase an earlier passing Singularity receipt or
  // its painted captures. Keep the latest failed attempt beside the durable
  // pass for the same evidence class. Other integration scenarios preserve
  // their long-standing failure directory names.
  const failureSuffix = singularityScenarios.has(scenario) ? `${suffix}-latest-failure` : suffix;
  const target = path.join(failureRoot, `${mode}-${scenario}${failureSuffix}`);
  assertInside(failureRoot, target, 'Failure artifact directory');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  const reportText = fs.existsSync(owned.report) ? await fsp.readFile(owned.report, 'utf8') : '';
  await fsp.writeFile(path.join(target, 'report.jsonl'), sanitizeText(reportText, owned.testRoot), 'utf8');
  await fsp.writeFile(path.join(target, 'process.log'), sanitizeText(`${result?.stdout || ''}\n${result?.stderr || ''}`, owned.testRoot), 'utf8');
  await fsp.writeFile(path.join(target, 'failure.json'), `${JSON.stringify({ mode, scenario, message: sanitizeText(error.message || String(error), owned.testRoot), privacy: { pathsHidden: true, fixtureOnly: true, credentialsIncluded: false } }, null, 2)}\n`, 'utf8');
  const screenshot = path.join(owned.profile, 'integration-failure.png');
  if (fs.existsSync(screenshot)) await fsp.copyFile(screenshot, path.join(target, 'integration-failure.png'));
}

async function retainOwnedPass(mode, scenario, owned, result) {
  if (!hostInProcessGpu && !singularityScenarios.has(scenario)) return;
  await fsp.mkdir(failureRoot, { recursive: true });
  const suffix = hostInProcessGpu ? '-in-process-diagnostic' : visualMode ? '-visual' : singularityReducedMotion ? '-reduced-motion' : singularityForcedColors ? '-forced-colors' : '';
  const target = path.join(failureRoot, `${mode}-${scenario}${suffix}`);
  assertInside(failureRoot, target, 'Owned integration pass artifact directory');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  const reportText = fs.existsSync(owned.report) ? await fsp.readFile(owned.report, 'utf8') : '';
  await fsp.writeFile(path.join(target, 'report.jsonl'), sanitizeText(reportText, owned.testRoot), 'utf8');
  await fsp.writeFile(path.join(target, 'process.log'), sanitizeText(`${result?.stdout || ''}\n${result?.stderr || ''}`, owned.testRoot), 'utf8');
  const captures = visualMode && singularityScenarios.has(scenario)
    ? (await fsp.readdir(owned.profile)).filter((name) => /^capture-singularity-(?:proxy-)?(?:main-(?:rest|playing|failure|intermediate|narrow|compact|zoom-200|restored-maximized)|mini-compact)\.png$/.test(name)).sort()
    : [];
  await Promise.all(captures.map((name) => fsp.copyFile(path.join(owned.profile, name), path.join(target, name))));
  const singularityIdentity = singularityScenarios.has(scenario) ? await singularityEvidenceIdentity(scenario) : null;
  const captureIntegrity = {};
  const captureGeometry = {};
  if (singularityIdentity && captures.length) {
    const report = parseReport(reportText);
    const captureEvents = report.filter((entry) => entry?.event === 'singularity-stage3-capture');
    for (const name of captures) {
      captureIntegrity[name] = await fileSha256(path.join(owned.profile, name));
      const detail = captureEvents.find((entry) => entry?.detail?.artifact === name)?.detail;
      if (!detail) throw new Error(`Singularity capture receipt is missing geometry for ${name}.`);
      captureGeometry[name] = {
        kind: detail.kind,
        image: { width: detail.width, height: detail.height },
        rendererViewport: detail.rendererViewport,
        bounds: detail.bounds,
        contentBounds: detail.contentBounds,
        minimumSize: detail.minimumSize,
        isMaximized: detail.isMaximized,
        isFullScreen: detail.isFullScreen,
        display: detail.display,
      };
    }
  }
  await fsp.writeFile(path.join(target, 'receipt.json'), `${JSON.stringify({
    mode,
    scenario,
    ...singularityIdentity,
    status: 'PASS',
    evidenceClass: hostInProcessGpu
      ? 'renderer-assertions-under-in-process-gpu'
      : visualMode
        ? 'painted-application-path'
        : singularityReducedMotion
          ? 'renderer-assertions-os-reduced-motion-disabled-gpu'
          : singularityForcedColors ? 'renderer-assertions-forced-colors-disabled-gpu' : 'renderer-assertions-disabled-gpu',
    graphicsProcessMode: hostInProcessGpu ? 'in-process-disabled-gpu' : visualMode ? 'default' : 'subprocess-disabled-gpu',
    osReducedMotionRequested: singularityReducedMotion,
    forcedColorsRequested: singularityForcedColors,
    paintedEvidence: visualMode,
    gpuPerformanceEvidence: false,
    ownerAcceptance: false,
    captures,
    captureIntegrity: { algorithm: 'sha256', files: captureIntegrity },
    captureGeometry,
    privacy: { pathsHidden: true, fixtureOnly: true, credentialsIncluded: false },
  }, null, 2)}\n`, 'utf8');
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
  if (await waitForExit(child, 3000) === null) {
    try { child.kill('SIGKILL'); } catch {}
    await waitForExit(child, 1500);
  }
}

function releaseChildOutputPipes(child) {
  child?.stdout?.destroy?.();
  child?.stderr?.destroy?.();
  child?.unref?.();
}

async function launchScenario(mode, executable, scenario, owned, options = {}) {
  await fsp.rm(owned.report, { force: true });
  // Chromium switches must precede the Electron application path. When they
  // are appended after `root`, Electron forwards them to the renderer as app
  // arguments and the GPU process still starts on hosts where graphics
  // initialization is unavailable.
  const args = [];
  if (!visualMode) args.push('--disable-gpu', '--disable-gpu-compositing');
  if (hostInProcessGpu) args.push('--in-process-gpu');
  // The Counterform midpoint repair requires a painted runtime receipt for
  // the OS media contract. This Chromium launch-level switch exercises the
  // same prefers-reduced-motion path without mutating renderer classes or CSS.
  // Every other scenario pins the opposite: hosted Windows runners turn off
  // OS animations, which would otherwise disable the theme loader's motion
  // that the core scenario asserts.
  if (scenario === 'counterform-choir' || singularityReducedMotion) args.push('--force-prefers-reduced-motion');
  else args.push('--force-prefers-no-reduced-motion');
  if (singularityForcedColors) args.push('--force-high-contrast');
  if (mode === 'unpacked') args.push(root);
  if (scenario === 'workspace-canvas-studio') args.push('--pixelody-canvas');
  if (scenario === 'singularity-stage3') args.push('--pixelody-singularity-probe=graph');
  if (scenario === 'singularity-stage3-proxy') args.push('--pixelody-singularity-probe=proxy');
  args.push(
    '--pixelody-integration-test',
    `--pixelody-test-scenario=${scenario}`,
    `--pixelody-test-user-data=${owned.profile}`,
    `--pixelody-test-report=${owned.report}`,
  );
  const child = spawn(executable, args, {
    cwd: root,
    env: {
      ...process.env,
      PIXELODY_TEST_MODE: '1',
      PIXELODY_VISUAL_MODE: visualMode ? '1' : '0',
      PIXELODY_DEVELOPMENT_MAXIMIZED: visualMode ? '1' : '0',
      PIXELODY_TEST_LAUNCH: '1',
      PIXELODY_TEST_SCENARIO: scenario,
      PIXELODY_TEST_USER_DATA: owned.profile,
      PIXELODY_TEST_REPORT: owned.report,
      PIXELODY_DEV_CLEAR_CACHE: '0',
      PIXELODY_COMPOSABLE_EXPERIMENT_VERSION: String(options.composableExperimentVersion || 1),
      PIXELODY_CANVAS_PROFILE: '',
    },
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-200000); });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-200000); });
  const deadline = Date.now() + (scenario === 'theme-imprints' ? 120000 : 30000);
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
    releaseChildOutputPipes(child);
    const error = new Error(`Scenario ${scenario} did not produce a terminal report within 30 seconds.`);
    error.processResult = { stdout, stderr, exitCode: child.exitCode };
    throw error;
  }
  const exitCode = await waitForExit(child, 5000);
  if (exitCode === null) {
    await terminateProcessTree(child);
  }
  releaseChildOutputPipes(child);
  const result = { stdout, stderr, exitCode: child.exitCode, terminal };
  if (terminal.detail?.ok !== true) {
    const error = new Error(`Scenario ${scenario} failed: ${terminal.detail?.summary?.message || terminal.detail?.code || 'unknown failure'}`);
    error.processResult = result;
    throw error;
  }
  return result;
}

async function runMode(mode, executable) {
  const passingRoots = [];
  async function runSingle(scenario, options = {}) {
    const owned = await createOwnedProfile(`${mode}-${scenario}`, { ...options, scenario });
    passingRoots.push(owned.testRoot);
    let result = null;
    try {
      result = await launchScenario(mode, executable, scenario, owned);
      await retainOwnedPass(mode, scenario, owned, result);
      console.log(`PASS ${mode} ${scenario}`);
      return { owned, result };
    } catch (error) {
      await retainFailure(mode, scenario, owned, error.processResult || result, error);
      if (singularityScenarios.has(scenario)) {
        // Failed Chromium launches on this host can leave an orphaned process
        // holding DIPS/Network profile files. The root is isolated, contains
        // fixtures only, and is safer to retain than to let cleanup hide the
        // actual scenario failure or keep the harness alive indefinitely.
        console.warn(`WARN retained failed Singularity profile: ${path.basename(owned.testRoot)}`);
      } else {
        await removeOwnedTemporaryRoot(owned.testRoot);
      }
      throw error;
    }
  }

  if (scenarioArgument) {
    if (scenarioArgument === 'persistence-read') {
      const persistence = await runSingle('persistence-write');
      try {
        await launchScenario(mode, executable, 'persistence-read', persistence.owned);
        console.log(`PASS ${mode} persistence-read`);
      } catch (error) {
        await retainFailure(mode, 'persistence-read', persistence.owned, error.processResult, error);
        await removeOwnedTemporaryRoot(persistence.owned.testRoot);
        throw error;
      }
    } else if (scenarioArgument === 'workspace-persistence-read') {
      const persistence = await runSingle('workspace-persistence-write');
      try {
        await launchScenario(mode, executable, 'workspace-persistence-read', persistence.owned);
        console.log(`PASS ${mode} workspace-persistence-read-1`);
        await launchScenario(mode, executable, 'workspace-persistence-read', persistence.owned);
        console.log(`PASS ${mode} workspace-persistence-read-2`);
      } catch (error) {
        await retainFailure(mode, 'workspace-persistence-read', persistence.owned, error.processResult, error);
        await removeOwnedTemporaryRoot(persistence.owned.testRoot);
        throw error;
      }
    } else if (scenarioArgument === 'workspace-theme-experiment') {
      const experiment = await runSingle('workspace-theme-experiment');
      if (visualMode) {
        console.log(`PASS ${mode} workspace-theme-experiment-painted`);
      } else try {
        await fsp.copyFile(experiment.owned.report, path.join(experiment.owned.profile, 'workspace-theme-experiment-phase-1.jsonl'));
        await launchScenario(mode, executable, 'workspace-theme-experiment', experiment.owned, { composableExperimentVersion: 1 });
        console.log(`PASS ${mode} workspace-theme-experiment-relaunch-1`);
        await fsp.copyFile(experiment.owned.report, path.join(experiment.owned.profile, 'workspace-theme-experiment-phase-2.jsonl'));
        await launchScenario(mode, executable, 'workspace-theme-experiment', experiment.owned, { composableExperimentVersion: 2 });
        console.log(`PASS ${mode} workspace-theme-experiment-relaunch-2-default-update`);
        await fsp.copyFile(experiment.owned.report, path.join(experiment.owned.profile, 'workspace-theme-experiment-phase-3.jsonl'));
      } catch (error) {
        await retainFailure(mode, 'workspace-theme-experiment', experiment.owned, error.processResult, error);
        await removeOwnedTemporaryRoot(experiment.owned.testRoot);
        throw error;
      }
    } else if (scenarioArgument === 'theme-package-read') {
      const themePackage = await runSingle('theme-package-write');
      try {
        await launchScenario(mode, executable, 'theme-package-read', themePackage.owned);
        console.log(`PASS ${mode} theme-package-read`);
      } catch (error) {
        await retainFailure(mode, 'theme-package-read', themePackage.owned, error.processResult, error);
        await removeOwnedTemporaryRoot(themePackage.owned.testRoot);
        throw error;
      }
    } else {
      await runSingle(scenarioArgument, { seed: scenarioArgument !== 'fresh' && scenarioArgument !== 'security', recovery: scenarioArgument === 'recovery' });
    }
    if (!keepPassingProfiles && !singularityScenarios.has(scenarioArgument)) {
      for (const target of passingRoots) await removeOwnedTemporaryRoot(target);
    }
    return;
  }

  await runSingle('fresh', { seed: false });
  await runSingle('core');
  const themePackage = await runSingle('theme-package-write');
  try {
    await launchScenario(mode, executable, 'theme-package-read', themePackage.owned);
    console.log(`PASS ${mode} theme-package-read`);
  } catch (error) {
    await retainFailure(mode, 'theme-package-read', themePackage.owned, error.processResult, error);
    await removeOwnedTemporaryRoot(themePackage.owned.testRoot);
    throw error;
  }
  const persistence = await runSingle('persistence-write');
  try {
    await launchScenario(mode, executable, 'persistence-read', persistence.owned);
    console.log(`PASS ${mode} persistence-read`);
  } catch (error) {
    await retainFailure(mode, 'persistence-read', persistence.owned, error.processResult, error);
    await removeOwnedTemporaryRoot(persistence.owned.testRoot);
    throw error;
  }
  const workspacePersistence = await runSingle('workspace-persistence-write');
  try {
    await launchScenario(mode, executable, 'workspace-persistence-read', workspacePersistence.owned);
    console.log(`PASS ${mode} workspace-persistence-read-1`);
    await launchScenario(mode, executable, 'workspace-persistence-read', workspacePersistence.owned);
    console.log(`PASS ${mode} workspace-persistence-read-2`);
  } catch (error) {
    await retainFailure(mode, 'workspace-persistence-read', workspacePersistence.owned, error.processResult, error);
    await removeOwnedTemporaryRoot(workspacePersistence.owned.testRoot);
    throw error;
  }
  if (mode === 'unpacked') {
    await runSingle('singularity-stage3');
    await runSingle('workspace-production');
    if (!skipDevelopmentCanvas) {
      await runSingle('workspace-canvas-studio');
    }
  }
  await runSingle('output-loss');
  await runSingle('recovery', { recovery: true });
  await runSingle('sharing-privacy');
  await runSingle('security', { seed: false });
  if (!keepPassingProfiles) {
    for (const target of passingRoots) await removeOwnedTemporaryRoot(target);
  }
}

async function main() {
  assertInside(path.join(root, '.artifacts'), failureRoot, 'Integration artifact root');
  // The three Singularity evidence modes run as separate invocations and must
  // coexist without one evidence class deleting the others. Each exact target
  // is still replaced by retainFailure/retainOwnedPass before it is written.
  if (!singularityScenarios.has(scenarioArgument)) await fsp.rm(failureRoot, { recursive: true, force: true });
  await fsp.mkdir(failureRoot, { recursive: true });
  const modes = modeArgument === 'all' ? ['unpacked', 'packaged'] : [modeArgument];
  let packaged = null;
  let productionStage = null;
  try {
    for (const mode of modes) {
      if (mode === 'production') productionStage ||= await stageProductionPackage(productionExecutable);
      const executable = mode === 'unpacked'
        ? require('electron')
        : mode === 'production'
          ? productionStage.executable
          : (packaged ||= await buildWindowsSmokePackage()).executable;
      await runMode(mode, executable);
    }
  } finally {
    if (productionStage) await removeProductionStage(productionStage.stageRoot);
  }
  console.log(`Windows integration audit passed for: ${modes.join(', ')}. Profiles were isolated, fixtures were generated, and J.A.M. remained opt-in.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { createWaveBuffer, fixtureValues, createOwnedProfile };
