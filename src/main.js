const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, shell } = require('electron');
const path = require('path');
const moduleShop = require('./module-shop/window').createModuleShop({ app, BrowserWindow, dialog, applyEdition: async (recipe) => {
  if (!composableThemeExperimentEnabled || singularityProbeMode || !mainWindow || mainWindow.isDestroyed()) throw new Error('Theme editions require a Windows Canvas development session.');
  mainWindow.webContents.send('theme:edition-request', recipe);
  mainWindow.show(); mainWindow.focus();
} });
const fs = require('fs/promises');
const nodeFs = require('fs');
const crypto = require('crypto');
const { createPersonalServer } = require('./server');
const { scanAudioFolder } = require('./library-scan');
const { buildM3u8, sanitizePlaylistFileName } = require('./playlist-export');
const { verifyFiles } = require('./file-integrity');
const { getWasapiHelperStatus, getNativeMixerStatus, runWasapiDiagnostics, runWasapiCapabilityProbe, runWasapiLoopbackPrototype, runNativeMixerClockDisciplineLab } = require('./native-wasapi-helper');
const { PixelodyStateStore, WORKSPACE_STATE_KEY, WORKSPACE_THEME_IDS } = require('./state-store');
const { WorkspaceStartupWatchdog, createAuthority: createWorkspaceAuthority } = require('./workspace-composition/persistence');
const composableThemeExperiment = require('./workspace-composition/theme-experiment');
const foregroundStageExperiment = require('./workspace-composition/foreground-experiment');
const canvasStudioPreset = require('./workspace-composition/canvas-studio-preset');
const developmentProfiles = require('./development-profiles');
const { ThemePackageStore } = require('./theme-packages/store');
const { ThemePackageError } = require('./theme-packages/contract');
const {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC_CONTRACTS,
  boundedJson,
  expectedDocumentUrl,
  sameDocumentUrl,
  validateIpcArguments,
} = require('./electron-security');
const releaseIdentity = require('./release-identity');
const builtInThemeRegistry = require('./themes/built-in-themes.json');
const brandMark = require('./brand-mark');
const musicBrainz = require('./musicbrainz');

app.enableSandbox();
// Low-memory & V8 size optimization switches to constrain idle heap and GPU texture allocations
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --optimize-for-size');
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
let musicMetadata;
let mainWindow = null;
// Logo colour chosen in Settings > Style. Only the baked purple-range icons in
// src/assets/brand supply the geometry; a validated theme accent may tint it in memory.
let activeLogoColor = brandMark.DEFAULT_LOGO_COLOR;
let activeThemeMarkAccent = '';

function brandIconPath(key = activeLogoColor) {
  return path.join(__dirname, 'assets', 'brand', `window-icon-${brandMark.normalizeLogoColor(key)}.png`);
}

function applyBrandIcon(win) {
  let image = nativeImage.createFromPath(brandIconPath());
  if (activeThemeMarkAccent) {
    // Recolour the generated mark in memory. The graphite tile and geometry
    // remain the generator's; no arbitrary image path crosses IPC.
    image = nativeImage.createFromPath(brandIconPath(brandMark.DEFAULT_LOGO_COLOR));
    const bitmap = image.toBitmap();
    const rgb = activeThemeMarkAccent.slice(1).match(/../g).map((value) => parseInt(value, 16));
    for (let i = 0; i < bitmap.length; i += 4) {
      const blue = bitmap[i], green = bitmap[i + 1], red = bitmap[i + 2];
      if (blue <= red + 8 || blue <= green + 8) continue;
      const coverage = Math.max(0, Math.min(1, (blue - 18) / (255 - 18)));
      bitmap[i] = Math.round(18 + (rgb[2] - 18) * coverage);
      bitmap[i + 1] = Math.round(15 + (rgb[1] - 15) * coverage);
      bitmap[i + 2] = Math.round(14 + (rgb[0] - 14) * coverage);
    }
    image = nativeImage.createFromBitmap(bitmap, image.getSize());
  }
  if (image.isEmpty()) return false;
  if (process.platform === 'darwin') {
    if (app.dock) app.dock.setIcon(image);
    return true;
  }
  if (!win || win.isDestroyed()) return false;
  win.setIcon(image);
  return true;
}
let miniWindow = null;
let hostileTestWindow = null;
let hostileTestResolver = null;
let lastPlayerState = null;
let personalServer = null;
let durableStateStore = null;
let durableStateStartupLoad = null;
let workspaceStartupWatchdog = null;
let localThemePackageStore = null;
let lastMiniTestSecurity = null;
let lastMiniCounterformState = null;
let lastMiniCommunityThemeState = null;
let lastMiniSingularityState = null;
let lastMainTestViewport = null;
const INTEGRATION_TEST_SCENARIOS = new Set(['fresh', 'core', 'counterform-choir', 'singularity-stage3', 'singularity-stage3-proxy', 'theme-imprints', 'theme-package', 'theme-package-write', 'theme-package-read', 'flow-runtime', 'persistence-write', 'persistence-read', 'workspace-persistence-write', 'workspace-persistence-read', 'workspace-production', 'workspace-theme-experiment', 'workspace-canvas-studio', 'output-loss', 'recovery', 'sharing-privacy', 'security']);
const integrationTestFlag = process.argv.includes('--pixelody-integration-test') || process.env.PIXELODY_TEST_LAUNCH === '1';
const integrationTestMode = process.env.PIXELODY_TEST_MODE === '1' && integrationTestFlag;
const integrationVisualMode = integrationTestMode && process.env.PIXELODY_VISUAL_MODE === '1';
if (integrationTestMode && !integrationVisualMode) {
  // The integration runner must remain usable on Windows hosts where the
  // Electron GPU subprocess cannot initialize. Set these before app ready so
  // Chromium receives them even when the launcher forwards app arguments.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
}
if (!integrationTestMode) app.setName(releaseIdentity.productName);
if (process.platform === 'win32' && !integrationTestMode) app.setAppUserModelId(releaseIdentity.appUserModelId);
const integrationArgument = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  if (!integrationTestMode) return '';
  const environmentName = `PIXELODY_${name.replace(/^pixelody-test-/, 'TEST_').replace(/-/g, '_').toUpperCase()}`;
  return process.env[environmentName] || '';
};
const integrationTestScenario = integrationTestMode && INTEGRATION_TEST_SCENARIOS.has(integrationArgument('pixelody-test-scenario'))
  ? integrationArgument('pixelody-test-scenario')
  : '';
const integrationUserDataArgument = integrationArgument('pixelody-test-user-data');
const integrationReportArgument = integrationArgument('pixelody-test-report');
const integrationUserDataPath = integrationTestMode && integrationUserDataArgument && path.isAbsolute(integrationUserDataArgument) ? path.resolve(integrationUserDataArgument) : '';
const themeAdmissionUserDataArgument = process.env.PIXELODY_THEME_TEST_USER_DATA || '';
const themeAdmissionUserDataPath = !app.isPackaged && themeAdmissionUserDataArgument && path.isAbsolute(themeAdmissionUserDataArgument)
  ? path.resolve(themeAdmissionUserDataArgument)
  : '';
const themeAdmissionDownloadsArgument = process.env.PIXELODY_THEME_TEST_DOWNLOADS || '';
const themeAdmissionDownloadsPath = themeAdmissionUserDataPath && themeAdmissionDownloadsArgument && path.isAbsolute(themeAdmissionDownloadsArgument)
  ? path.resolve(themeAdmissionDownloadsArgument)
  : '';
const developmentUserDataArgument = process.argv.find((argument) => argument.startsWith('--pixelody-dev-user-data='))?.slice('--pixelody-dev-user-data='.length) || '';
const developmentUserDataPath = !app.isPackaged && !integrationTestMode && developmentUserDataArgument && path.isAbsolute(developmentUserDataArgument)
  ? path.resolve(developmentUserDataArgument)
  : '';
const integrationReportCandidate = integrationTestMode && integrationReportArgument && path.isAbsolute(integrationReportArgument) ? path.resolve(integrationReportArgument) : '';
const integrationReportRelative = integrationUserDataPath && integrationReportCandidate ? path.relative(integrationUserDataPath, integrationReportCandidate) : '';
const integrationReportPath = integrationTestMode && integrationUserDataPath && integrationReportCandidate
  && integrationReportRelative && !integrationReportRelative.startsWith('..') && !path.isAbsolute(integrationReportRelative)
  ? integrationReportCandidate
  : '';
let integrationReportQueue = Promise.resolve();
if (integrationTestMode && integrationUserDataPath) {
  app.setPath('userData', integrationUserDataPath);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
} else if (themeAdmissionUserDataPath) {
  // Theme admission needs genuine application paths without touching the owner's
  // library. This development-only boundary changes storage location, not runtime
  // behavior, and is ignored in packaged builds or for non-absolute paths.
  app.setPath('userData', themeAdmissionUserDataPath);
  if (themeAdmissionDownloadsPath) app.setPath('downloads', themeAdmissionDownloadsPath);
} else if (developmentUserDataPath) {
  // Explicit manual-QA isolation. Chromium's --user-data-dir is intentionally
  // not authoritative here because Pixelody pins its durable state directory;
  // this development-only absolute path provides a safe painted-test profile.
  app.setPath('userData', developmentUserDataPath);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), releaseIdentity.userDataDirectoryName));
}
// One process owns a profile's durable store, J.A.M. host, and windows.
// Electron keys this lock on the userData path, so it must follow setPath().
// A second launch would otherwise commit whole-library snapshots over the
// first instance's edits; it hands focus back to the running window instead.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => revealMainWindow());
const isDevelopment = !app.isPackaged || process.env.PIXELODY_DEV_CLEAR_CACHE === '1';
const singularityProbeArgument = process.argv.find((argument) => argument.startsWith('--pixelody-singularity-probe='));
const singularityProbeCandidate = singularityProbeArgument?.slice('--pixelody-singularity-probe='.length)
  || process.env.PIXELODY_SINGULARITY_PROBE
  || '';
const singularityProbeMode = isDevelopment && ['proxy', 'graph'].includes(singularityProbeCandidate)
  ? singularityProbeCandidate
  : '';
const developmentZoomArgument = process.argv.find((argument) => argument.startsWith('--pixelody-development-zoom='));
const developmentZoomFactor = isDevelopment && developmentZoomArgument
  ? Number.parseFloat(developmentZoomArgument.slice('--pixelody-development-zoom='.length))
  : 1;
// --pixelody-canvas opens Canvas Studio: a near-blank canvas plus the rail
// that builds one. PIXELODY_CANVAS_PROFILE=foreground-stage selects the earlier
// fixed preset instead, for comparison. --pixelody-canvas-foreground is kept as
// an alias so existing launchers keep working. All of it is development only;
// none of it widens the packaged runtime, and the Counterspace Relay path is
// unchanged when no canvas flag is passed.
const canvasRequested = process.argv.includes('--pixelody-canvas')
  || process.argv.includes('--pixelody-canvas-foreground')
  || Boolean(process.env.PIXELODY_CANVAS_PROFILE);
const canvasProfile = process.env.PIXELODY_CANVAS_PROFILE === 'foreground-stage'
  ? foregroundStageExperiment
  : canvasStudioPreset;
// The canvas runtime is *seeded* on every development launch, flag or not.
// Two rounds were lost to a launch argument that never arrived, and there is
// no good reason for the authority's readiness to depend on how the app was
// started. Seeding is additive: it owns its own durable key and nothing
// activates until the renderer is told to. What the flag still controls is
// whether Pixelody *opens* into the canvas; without it the choice lives in
// Settings, which is where a product decision belongs anyway.
// The archived workspace-production integration scenario proves the original
// C8 authority and must not be silently migrated to Canvas Studio's one-pane
// creator graph. Ordinary development launches still seed Canvas Studio so
// the visible Settings entry can activate it without a relaunch.
const composableThemeExperimentEnabled = isDevelopment && (
  canvasRequested
  // Ordinary development launches seed Canvas too, and that is what makes the
  // Settings route above actually exist. canvasRuntimeReady() in renderer.js
  // keys off composableThemeExperimentTheme, which ships as '' whenever this
  // constant is false -- so while this was gated on canvasRequested alone, a
  // flagless launch installed no Canvas entry in Settings and left the user in
  // the pre-modularisation shell with no way forward. Opening into the canvas
  // is still flag-only; that decision is composableThemeExperimentLaunchFlag
  // and canvasOptIn in the renderer, not this constant.
  // Scoped to !integrationTestMode deliberately: the workspace-production
  // scenario's archived C8 authority must keep the seeding it has today, so
  // the harness scenarios stay listed explicitly below.
  || !integrationTestMode
  || integrationTestScenario === 'workspace-theme-experiment'
  || integrationTestScenario === 'workspace-canvas-studio'
);
// Counterspace Relay stays the profile for its own flag AND for the
// workspace-theme-experiment scenario, which selects it by scenario name and
// never passes the flag -- scripts/check-windows-integration.js builds its
// expected authority from theme-experiment.js directly, so seeding anything
// else here fails that scenario at activate() with "the isolated
// composable-theme authority was not active".
const composableThemeRelayRequested = process.argv.includes('--pixelody-composable-theme-experiment')
  || integrationTestScenario === 'workspace-theme-experiment';
const composableThemeProfile = composableThemeRelayRequested ? composableThemeExperiment : canvasProfile;
const composableThemeExperimentVersion = composableThemeExperimentEnabled && Number(process.env.PIXELODY_COMPOSABLE_EXPERIMENT_VERSION) >= 2 ? 2 : 1;
// The theme explorer's development entries (Settings > Themes). Integration
// scenarios pass the same flags as the launchers but keep their own evidence
// contract, so they neither list the entries nor get the isolated-session
// write rules.
const developmentExplorerEnabled = isDevelopment && !integrationTestMode;
const activeDevelopmentProfile = developmentExplorerEnabled
  ? developmentProfiles.get(developmentProfiles.activeProfileId({ canvasRequested, canvasProfileId: canvasProfile.PROFILE_ID, singularityProbeMode }))
  : null;
const composableWorkspaceStateKey = WORKSPACE_STATE_KEY;
// Development inspection is performed against the largest ordinary desktop
// layout. This is a maximized window (with normal controls), not kiosk or
// borderless fullscreen. Automated non-visual integration stays at its declared
// dimensions; explicit visual QA may opt into a bounded launch size. Normal
// packaged launches retain their ordinary window behavior.
const developmentMaximizedLaunch = process.argv.includes('--pixelody-development-maximized')
  || process.env.PIXELODY_DEVELOPMENT_MAXIMIZED === '1'
  || integrationVisualMode
  || (isDevelopment && !integrationTestMode && process.env.PIXELODY_DEVELOPMENT_MAXIMIZED !== '0');
const boundedDevelopmentDimension = (name, fallback, minimum) => {
  if (!isDevelopment) return fallback;
  const requested = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(requested) ? Math.max(minimum, requested) : fallback;
};
const developmentWindowWidth = boundedDevelopmentDimension('PIXELODY_DEVELOPMENT_WINDOW_WIDTH', 1440, 800);
const developmentWindowHeight = boundedDevelopmentDimension('PIXELODY_DEVELOPMENT_WINDOW_HEIGHT', 920, 700);
const devCacheToken = Date.now().toString(36);
const appStartedAt = new Date().toISOString();
const RUNTIME_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', 'ShaderCache', 'blob_storage'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_JSON_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_SIGNAL_IMPORT_BYTES = 32 * 1024 * 1024;
const MAX_TUNING_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_FOLDER_IMPORT_FILES = 100_000;
const DURABLE_STATE_DRAIN_TIMEOUT_MS = 8000;
const grantedMediaPaths = new Set();
const grantedImagePaths = new Set();

if (isDevelopment) {
  app.commandLine.appendSwitch('disable-http-cache');
}

async function getMusicMetadata() {
  musicMetadata ||= await import('music-metadata');
  return musicMetadata;
}

function themePackageStore() {
  localThemePackageStore ||= new ThemePackageStore({
    directory: path.join(app.getPath('userData'), 'theme-packages'),
    appVersion: app.getVersion(),
  });
  return localThemePackageStore;
}

function publicThemePackageError(error) {
  if (error instanceof ThemePackageError) return { ok: false, code: error.code, message: error.message };
  console.warn('Local theme package operation failed:', error?.code || error?.name || 'unknown');
  return { ok: false, code: 'theme_package_io_error', message: 'Pixelody could not complete the local theme-package operation.' };
}

const AUDIO_FILTERS = [
  { name: 'Music', extensions: ['flac', 'wav', 'wave', 'aiff', 'aif', 'mp3', 'm4a', 'aac', 'ogg', 'opus'] },
];

function normalizedPathKey(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return '';
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function grantPath(filePath, kind) {
  const key = normalizedPathKey(filePath);
  if (!key) return false;
  if (kind === 'media') grantedMediaPaths.add(key);
  if (kind === 'image') grantedImagePaths.add(key);
  return true;
}

function grantStatePaths(values) {
  if (!values || typeof values !== 'object') return;
  const tracks = Array.isArray(values['aurelia.library']) ? values['aurelia.library'] : [];
  for (const track of tracks) {
    grantPath(track?.path, 'media');
    grantPath(track?.artworkPath, 'image');
  }
  const playlists = Array.isArray(values['aurelia.playlists']) ? values['aurelia.playlists'] : [];
  playlists.forEach((playlist) => grantPath(playlist?.background, 'image'));
  const backgrounds = values['pixelody.collectionBackgrounds'];
  if (backgrounds && typeof backgrounds === 'object') Object.values(backgrounds).forEach((value) => grantPath(value, 'image'));
  grantPath(values['pixelody.profileImage'], 'image');
}

function statePathsAreGranted(values) {
  if (!values || typeof values !== 'object') return true;
  const tracks = Array.isArray(values['aurelia.library']) ? values['aurelia.library'] : [];
  if (tracks.some((track) => track?.path && !isGrantedPath(track.path, 'media'))) return false;
  if (tracks.some((track) => track?.artworkPath && !isGrantedPath(track.artworkPath, 'image'))) return false;
  const playlists = Array.isArray(values['aurelia.playlists']) ? values['aurelia.playlists'] : [];
  if (playlists.some((playlist) => playlist?.background && !isGrantedPath(playlist.background, 'image'))) return false;
  const backgrounds = values['pixelody.collectionBackgrounds'];
  if (backgrounds && typeof backgrounds === 'object' && Object.values(backgrounds).some((value) => value && !isGrantedPath(value, 'image'))) return false;
  return !(values['pixelody.profileImage'] && !isGrantedPath(values['pixelody.profileImage'], 'image'));
}

function isGrantedPath(filePath, kind = 'any') {
  const key = normalizedPathKey(filePath);
  if (!key) return false;
  if (kind === 'media') return grantedMediaPaths.has(key);
  if (kind === 'image') return grantedImagePaths.has(key);
  return grantedMediaPaths.has(key) || grantedImagePaths.has(key);
}

async function isRegularGrantedFile(filePath, kind, extensions, maxBytes = Number.MAX_SAFE_INTEGER) {
  if (!isGrantedPath(filePath, kind) || !extensions.has(path.extname(filePath).toLowerCase())) return false;
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size <= maxBytes;
  } catch {
    return false;
  }
}

async function readBoundedJsonFile(filePath, maxBytes) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > maxBytes) return null;
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return boundedJson(parsed, maxBytes) ? parsed : null;
  } catch {
    return null;
  }
}

function senderMatchesWindow(event, window, fileName) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  return sameDocumentUrl(frame.url, expectedDocumentUrl(__dirname, fileName));
}

function isMainWindowSender(event) {
  return senderMatchesWindow(event, mainWindow, 'index.html');
}

function isMiniWindowSender(event) {
  return senderMatchesWindow(event, miniWindow, 'mini-player.html');
}

function isKnownWindowSender(event) {
  return isMainWindowSender(event) || isMiniWindowSender(event);
}

function isHostileTestWindowSender(event) {
  return integrationTestMode && senderMatchesWindow(event, hostileTestWindow, 'security-probe.html');
}

function authorizedForContract(channel, event) {
  const sender = IPC_CONTRACTS[channel]?.sender;
  if (sender === 'module-shop') return moduleShop.authorized(event);
  if (sender === 'main') return isMainWindowSender(event);
  if (sender === 'mini') return isMiniWindowSender(event);
  if (sender === 'known-test-window') return integrationTestMode && isKnownWindowSender(event);
  if (sender === 'main-test-window') return integrationTestMode && isMainWindowSender(event);
  if (sender === 'hostile-test-window') return isHostileTestWindowSender(event);
  return false;
}

function rejectedIpc(code, channel, message) {
  return { ok: false, code, channel, error: message };
}

function registerHandle(channel, handler) {
  if (!IPC_CONTRACTS[channel]) throw new Error(`Missing IPC contract for ${channel}.`);
  ipcMain.handle(channel, async (event, ...args) => {
    if (!authorizedForContract(channel, event)) return rejectedIpc('unauthorized_sender', channel, 'Unauthorized sender.');
    const validation = validateIpcArguments(channel, args);
    if (!validation.ok) return rejectedIpc(validation.code, channel, validation.message);
    return handler(event, ...validation.args);
  });
}

function registerOn(channel, handler) {
  if (!IPC_CONTRACTS[channel]) throw new Error(`Missing IPC contract for ${channel}.`);
  ipcMain.on(channel, (event, ...args) => {
    if (!authorizedForContract(channel, event)) {
      if (channel === 'state:load-sync') event.returnValue = rejectedIpc('unauthorized_sender', channel, 'Unauthorized sender.');
      return;
    }
    const validation = validateIpcArguments(channel, args);
    if (!validation.ok) {
      if (channel === 'state:load-sync') event.returnValue = rejectedIpc(validation.code, channel, validation.message);
      return;
    }
    return handler(event, ...validation.args);
  });
}

function sanitizeIntegrationValue(value, key = '') {
  if (Array.isArray(value)) return value.slice(0, 100).map((item, index) => sanitizeIntegrationValue(item, `${key}.${index}`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [entryKey, sanitizeIntegrationValue(entryValue, key ? `${key}.${entryKey}` : entryKey)]));
  }
  if (typeof value !== 'string') return value;
  if (/(?:token|secret|authorization|path|url|uri|trackid|artwork)/i.test(key)) return value ? '[private-value-hidden]' : '';
  return value
    .replace(/[a-zA-Z]:\\[^\r\n"']+/g, '[windows-path-hidden]')
    .replace(/file:\/\/\/[^\s"']+/gi, '[file-url-hidden]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credential-hidden]')
    .slice(0, 1000);
}

function appendIntegrationReport(eventName, detail = {}) {
  if (!integrationTestMode || !integrationReportPath) return Promise.resolve(false);
  const record = {
    at: new Date().toISOString(),
    scenario: integrationTestScenario,
    event: String(eventName || 'event').slice(0, 80),
    detail: sanitizeIntegrationValue(detail),
  };
  integrationReportQueue = integrationReportQueue.then(async () => {
    await fs.mkdir(path.dirname(integrationReportPath), { recursive: true });
    await fs.appendFile(integrationReportPath, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  });
  return integrationReportQueue;
}

function stateStore() {
  durableStateStore ||= new PixelodyStateStore({
    directory: path.join(app.getPath('userData'), 'state'),
    workspaceStateKey: composableWorkspaceStateKey,
    workspaceAuthority: composableThemeExperimentEnabled ? createWorkspaceAuthority({
      creatorDefaultGraph: composableThemeProfile.graphForVersion(composableThemeExperimentVersion),
      themeIds: [...WORKSPACE_THEME_IDS, composableThemeProfile.THEME_ID],
      defaultThemeId: composableThemeProfile.THEME_ID,
      // Canvas Studio declares an empty required-job set so a one-pane canvas
      // is a legal creator default. The save gate in the studio rail re-applies
      // the real floor before anything durable is written.
      requiredJobs: composableThemeProfile.REQUIRED_JOBS,
      commitRequiredJobs: composableThemeProfile.COMMIT_REQUIRED_JOBS || composableThemeProfile.REQUIRED_JOBS,
    }) : undefined,
  });
  return durableStateStore;
}

function sharingServer() {
  personalServer ||= createPersonalServer({
    appVersion: app.getVersion(),
    platform: process.platform,
    identityStorePath: path.join(app.getPath('userData'), 'sharing-host-identity.json'),
    deviceStorePath: path.join(app.getPath('userData'), 'trusted-devices.json'),
    onRemoteCommand: (command) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sharing:remote-command', command);
    },
  });
  return personalServer;
}

function isPixelodyFileWindow(webContents) {
  try {
    if (!webContents) return false;
    if (mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents) {
      return sameDocumentUrl(webContents.getURL(), expectedDocumentUrl(__dirname, 'index.html'));
    }
    if (miniWindow && !miniWindow.isDestroyed() && webContents === miniWindow.webContents) {
      return sameDocumentUrl(webContents.getURL(), expectedDocumentUrl(__dirname, 'mini-player.html'));
    }
    return false;
  } catch {
    return false;
  }
}

function configureLocalMediaPermissions() {
  const allowedPermissions = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.has(permission) && isPixelodyFileWindow(webContents));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    allowedPermissions.has(permission) && isPixelodyFileWindow(webContents)
  ));
}

function configureWindowSecurity(window, fileName, counters = null) {
  const expected = expectedDocumentUrl(__dirname, fileName);
  const denyUnexpectedNavigation = (event, navigationUrl) => {
    if (sameDocumentUrl(navigationUrl, expected)) return;
    counters && (counters.navigationDenied += 1);
    event.preventDefault();
  };
  window.webContents.setWindowOpenHandler(() => {
    counters && (counters.popupDenied += 1);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', denyUnexpectedNavigation);
  window.webContents.on('will-redirect', denyUnexpectedNavigation);
  window.webContents.on('will-frame-navigate', (event, details) => {
    if (details.isMainFrame && sameDocumentUrl(details.url, expected)) return;
    counters && (counters.frameNavigationDenied += 1);
    event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => {
    counters && (counters.webviewDenied += 1);
    event.preventDefault();
  });
  return counters;
}

function secureWebPreferences(preload) {
  return {
    preload,
    additionalArguments: integrationTestMode ? ['--pixelody-preload-integration-test'] : [],
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    devTools: isDevelopment,
  };
}

function createWindow() {
  const windowOptions = {
    width: developmentWindowWidth,
    height: developmentWindowHeight,
    minWidth: 800,
    minHeight: 700,
    backgroundColor: '#080b10',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    // Never expose Chromium's construction frame. The renderer already owns a
    // branded startup surface; showing the window before that surface paints
    // produces a black flash followed by a visible aspect-ratio reflow.
    show: false,
    webPreferences: secureWebPreferences(path.join(__dirname, 'preload.js')),
  };
  if (process.platform !== 'darwin') windowOptions.icon = brandIconPath();
  if (process.platform === 'darwin') {
    windowOptions.trafficLightPosition = { x: 16, y: 16 };
  }
  const win = new BrowserWindow(windowOptions);

  // Accessibility evidence may launch an isolated development profile at a
  // real Electron renderer zoom. Packaged builds ignore this argument.
  if (Number.isFinite(developmentZoomFactor) && developmentZoomFactor >= 1 && developmentZoomFactor <= 3 && developmentZoomFactor !== 1) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.setZoomFactor(developmentZoomFactor);
    });
  }

  win.setMenu(null);
  win.setMenuBarVisibility(false);
  mainWindow = win;
  // Establish the final native bounds before navigation. ready-to-show will
  // then describe a frame painted at the real work-area aspect ratio on
  // Windows, macOS, and Linux instead of a 1440x920 frame that immediately
  // stretches after it becomes visible.
  if (developmentMaximizedLaunch) win.maximize();
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  if (isDevelopment) {
    // No application menu exists (setMenu(null) above), so there is
    // otherwise no way to reach DevTools at all -- Ctrl+Shift+I / F12 only
    // work if a menu accelerator or handler registers them, and neither
    // did. Without this, console errors are completely invisible to
    // whoever is running the app, which made a real renderer bug (the
    // theme-switching overlay fix from 2026-07-23) much harder to
    // diagnose than it needed to be.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const isDevToolsCombo = input.key === 'F12'
        || (input.control && input.shift && (input.key === 'I' || input.key === 'i'));
      if (isDevToolsCombo) {
        event.preventDefault();
        win.webContents.toggleDevTools();
      }
    });
  }
  if (isDevelopment) {
    // The launch shortcut runs PowerShell with -WindowStyle Hidden, so even
    // main-process console.error output (below, and in the
    // integrationTestMode block) is invisible during normal use, on top of
    // DevTools having no menu entry. Mirror renderer console activity to a
    // plain text file at the project root so it can be read directly,
    // without needing DevTools or a visible terminal at all. Overwritten
    // fresh on every launch.
    const consoleLogPath = path.join(__dirname, '..', 'Pixelody-console-log.txt');
    fs.writeFile(consoleLogPath, `Pixelody console log -- launched ${new Date().toISOString()}\n\n`).catch(() => {});
    const appendConsoleLog = (line) => { fs.appendFile(consoleLogPath, `${line}\n`).catch(() => {}); };
    const consoleLevelNames = ['log', 'warning', 'error', 'info'];
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const levelName = consoleLevelNames[level] || `level${level}`;
      const location = sourceId ? ` (${sourceId.split(/[\\/]/).pop()}:${line})` : '';
      appendConsoleLog(`[${new Date().toISOString()}] [${levelName}] ${String(message || '')}${location}`);
    });
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      appendConsoleLog(`[${new Date().toISOString()}] [preload-error:${preloadPath}] ${String(error?.stack || error?.message || error)}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description) => {
      appendConsoleLog(`[${new Date().toISOString()}] [load-error:${code}] ${String(description || '')}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      appendConsoleLog(`[${new Date().toISOString()}] [renderer-gone] ${String(details?.reason || 'unknown')}`);
    });
  }
  configureWindowSecurity(win, 'index.html');
  recoverRendererOnCrash(win, 'index.html');
  if (integrationTestMode) {
    win.webContents.on('console-message', (_event, level, message) => console.error(`[renderer:${level}] ${String(message || '').slice(0, 1000)}`));
    win.webContents.on('preload-error', (_event, _preloadPath, error) => console.error(`[preload-error] ${String(error?.message || error).slice(0, 1000)}`));
    win.webContents.on('did-fail-load', (_event, code, description) => console.error(`[load-error:${code}] ${String(description || '').slice(0, 500)}`));
    win.webContents.on('render-process-gone', (_event, details) => console.error(`[renderer-gone] ${JSON.stringify({ reason: details?.reason || 'unknown', exitCode: details?.exitCode ?? null, killed: details?.killed ?? null })}`));
  }
  loadAppFile(win, 'index.html');
  // the window's close ('X', Alt+F4,
  // taskbar "close all windows") used to be intercepted here and turned into an
  // in-app "go back" navigation instead of actually closing, whenever the renderer
  // reported it had back-navigation history. That's removed -- closing the window
  // by any of those paths now always just closes it, full stop. In-app back
  // navigation (Escape key, the various X/close buttons inside the app) is
  // untouched and still works via navigateBack() in renderer.js; it never went
  // through this handler.
  win.on('minimize', () => {
    createMiniWindow();
    try {
      session.defaultSession.clearCodeCaches({ urls: [] }).catch(() => {});
    } catch {}
  });
  win.on('closed', () => {
    mainWindow = null;
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
  });
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.focus();
    if (lastPlayerState) miniWindow.webContents.send('player:state', lastPlayerState);
    return miniWindow;
  }
  miniWindow = new BrowserWindow({
    width: 500,
    height: 200,
    minWidth: 340,
    minHeight: 148,
    maxWidth: 820,
    maxHeight: 460,
    frame: false,
    transparent: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    ...(process.platform !== 'darwin' ? { icon: brandIconPath() } : {}),
    backgroundColor: '#0b0d0f',
    show: false,
    webPreferences: secureWebPreferences(path.join(__dirname, 'mini-preload.js')),
  });
  applyBrandIcon(miniWindow);
  miniWindow.setMenu(null);
  miniWindow.setMenuBarVisibility(false);
  miniWindow.setAlwaysOnTop(true, 'floating');
  configureWindowSecurity(miniWindow, 'mini-player.html');
  recoverRendererOnCrash(miniWindow, 'mini-player.html');
  loadAppFile(miniWindow, 'mini-player.html');
  miniWindow.once('ready-to-show', () => {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = miniWindow.getBounds();
    miniWindow.setPosition(workArea.x + workArea.width - bounds.width - 20, workArea.y + workArea.height - bounds.height - 20);
    miniWindow.show();
    if (lastPlayerState) miniWindow.webContents.send('player:state', lastPlayerState);
  });
  miniWindow.on('closed', () => { miniWindow = null; });
  return miniWindow;
}

// A crashed or out-of-memory renderer used to leave a blank window that did
// nothing until the person quit and relaunched. Library, playlists and settings
// live in the main-process state store, so reloading the page restores the app.
// Three crashes inside a minute stop the retries, so a crash during load cannot
// spin forever. Integration runs keep the crash visible instead of hiding it.
const RENDERER_CRASH_WINDOW_MS = 60_000;
const RENDERER_CRASH_RETRIES = 3;
function recoverRendererOnCrash(window, fileName) {
  const crashTimes = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    const reason = details?.reason || 'unknown';
    if (integrationTestMode || reason === 'clean-exit' || window.isDestroyed()) return;
    const now = Date.now();
    while (crashTimes.length && now - crashTimes[0] > RENDERER_CRASH_WINDOW_MS) crashTimes.shift();
    crashTimes.push(now);
    if (crashTimes.length > RENDERER_CRASH_RETRIES) {
      console.error(`[renderer-recovery] ${fileName} kept crashing (${reason}); not reloading again.`);
      return;
    }
    console.error(`[renderer-recovery] ${fileName} renderer exited (${reason}); reloading.`);
    setTimeout(() => { if (!window.isDestroyed()) loadAppFile(window, fileName); }, 250);
  });
}

function loadAppFile(window, fileName) {
  const options = isDevelopment ? { query: { 'pixelody-dev-cache': devCacheToken } } : undefined;
  window.loadFile(path.join(__dirname, fileName), options);
}

function windowSecuritySnapshot(window) {
  if (!window || window.isDestroyed()) return { open: false };
  const preferences = window.webContents.getLastWebPreferences();
  return {
    open: true,
    sandbox: preferences.sandbox === true,
    contextIsolation: preferences.contextIsolation === true,
    nodeIntegration: preferences.nodeIntegration === false,
    webviewTag: preferences.webviewTag === false,
    preload: path.basename(preferences.preload || ''),
  };
}

// What the mini player would show changing: a forged state or a relayed
// transport command changes these. The main window also re-broadcasts state
// on its own (the startup output scan finishing, appearance and output syncs),
// so a new snapshot with the same playback is not a side effect.
function playbackSideEffectSignature(playerState) {
  if (!playerState) return '';
  const { title, artist, album, paused, duration } = playerState;
  return JSON.stringify([title, artist, album, paused, duration]);
}

async function runHostileSecurityProbe() {
  if (!integrationTestMode || hostileTestWindow) return { ok: false, code: 'probe_unavailable' };
  const counters = { popupDenied: 0, navigationDenied: 0, frameNavigationDenied: 0, webviewDenied: 0 };
  const before = {
    miniOpen: Boolean(miniWindow && !miniWindow.isDestroyed()),
    // The legitimate main renderer may rebroadcast an equivalent snapshot
    // while this probe window is alive. Object identity would treat that as a
    // hostile side effect even though all state values are unchanged.
    playback: playbackSideEffectSignature(lastPlayerState),
  };
  hostileTestWindow = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    webPreferences: secureWebPreferences(path.join(__dirname, 'security-probe-preload.js')),
  });
  configureWindowSecurity(hostileTestWindow, 'security-probe.html', counters);
  const resultPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, code: 'hostile_probe_timeout' }), 5000);
    hostileTestResolver = (payload) => {
      clearTimeout(timeout);
      resolve({ ok: true, payload });
    };
  });
  loadAppFile(hostileTestWindow, 'security-probe.html');
  const outcome = await resultPromise;
  await new Promise((resolve) => setTimeout(resolve, 100));
  const preferences = windowSecuritySnapshot(hostileTestWindow);
  const sideEffectsBlocked = before.miniOpen === Boolean(miniWindow && !miniWindow.isDestroyed())
    && before.playback === playbackSideEffectSignature(lastPlayerState);
  if (hostileTestWindow && !hostileTestWindow.isDestroyed()) hostileTestWindow.destroy();
  hostileTestWindow = null;
  hostileTestResolver = null;
  return { ...outcome, counters, preferences, sideEffectsBlocked };
}

async function clearRuntimeCacheDirectories() {
  const userData = app.getPath('userData');
  const results = [];
  for (const directory of RUNTIME_CACHE_DIRS) {
    const target = path.join(userData, directory);
    try {
      await fs.rm(target, { recursive: true, force: true });
      results.push({ directory, status: 'cleared' });
    } catch (error) {
      results.push({ directory, status: 'failed', message: error.message });
    }
  }
  return results;
}

async function clearRuntimeCaches() {
  const report = { sessionCache: 'skipped', storageCache: 'skipped', directories: [] };
  try {
    await session.defaultSession.clearCache();
    report.sessionCache = 'cleared';
  } catch (error) {
    report.sessionCache = `failed: ${error.message}`;
  }
  try {
    await session.defaultSession.clearStorageData({ storages: ['appcache', 'cachestorage', 'serviceworkers', 'shadercache'] });
    report.storageCache = 'cleared';
  } catch (error) {
    report.storageCache = `failed: ${error.message}`;
  }
  report.directories = await clearRuntimeCacheDirectories();
  return report;
}

async function prepareDevelopmentSession() {
  if (!isDevelopment) return;
  const devSession = session.defaultSession;
  devSession.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cache-Control': ['no-store, no-cache, must-revalidate, max-age=0'],
        Pragma: ['no-cache'],
        Expires: ['0'],
      },
    });
  });
  const report = await clearRuntimeCaches();
  const failures = [report.sessionCache, report.storageCache, ...report.directories.map((entry) => entry.status)].filter((status) => String(status).startsWith('failed'));
  if (failures.length) console.warn('Pixelody development runtime cache clear had failures:', report);
}

registerHandle('mini:open', () => { createMiniWindow(); return true; });
registerHandle('app:set-brand-icon', (event, logoColor, themeAccent = '') => {
  activeLogoColor = brandMark.normalizeLogoColor(logoColor);
  activeThemeMarkAccent = /^#[0-9a-f]{6}$/i.test(themeAccent) ? themeAccent.toLowerCase() : '';
  const applied = [mainWindow, miniWindow].map((win) => applyBrandIcon(win)).some(Boolean);
  return { ok: true, logoColor: activeLogoColor, themeAccent: activeThemeMarkAccent, applied };
});
registerOn('mini:close', () => { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close(); });
function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
registerOn('mini:restore-main', () => revealMainWindow());
registerOn('mini:command', (_event, command) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('player:command', command);
});
registerOn('player:state', (event, playerState) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  lastPlayerState = playerState;
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('player:state', playerState);
});

registerHandle('test:config', (event) => {
  if (!integrationTestMode || !isKnownWindowSender(event)) return { enabled: false };
  return {
    enabled: true,
    scenario: integrationTestScenario,
    packaged: app.isPackaged,
    visualMode: integrationVisualMode,
    osReducedMotion: app.commandLine.hasSwitch('force-prefers-reduced-motion'),
    forcedColors: app.commandLine.hasSwitch('force-high-contrast'),
  };
});
registerHandle('test:status', (event) => {
  if (!integrationTestMode || !isKnownWindowSender(event)) return { enabled: false };
  return {
    enabled: true,
    packaged: app.isPackaged,
    mainOpen: Boolean(mainWindow && !mainWindow.isDestroyed()),
    miniOpen: Boolean(miniWindow && !miniWindow.isDestroyed()),
    sharingEnabled: Boolean(personalServer?.status().enabled),
    mainSecurity: windowSecuritySnapshot(mainWindow),
    miniSecurity: windowSecuritySnapshot(miniWindow),
    miniReportedSecurity: lastMiniTestSecurity,
    miniCounterformState: lastMiniCounterformState,
    miniCommunityThemeState: lastMiniCommunityThemeState,
    miniSingularityState: lastMiniSingularityState,
    playerState: ['counterform-choir', 'singularity-stage3', 'singularity-stage3-proxy', 'theme-package', 'theme-package-write', 'theme-package-read', 'workspace-production'].includes(integrationTestScenario) && lastPlayerState ? {
      theme: lastPlayerState.theme,
      title: lastPlayerState.title,
      paused: lastPlayerState.paused,
      currentTime: lastPlayerState.currentTime,
      duration: lastPlayerState.duration,
      chorus: lastPlayerState.chorus,
      singularityProbe: ['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario) ? lastPlayerState.singularityProbe : undefined,
      communityTheme: integrationTestScenario.startsWith('theme-package') ? lastPlayerState.communityTheme : undefined,
    } : null,
  };
});
registerHandle('test:report', async (event, eventName, detail = {}) => {
  if (!integrationTestMode || !isKnownWindowSender(event)) return false;
  if (isMainWindowSender(event) && eventName === 'capture-window-state') {
    const viewport = detail?.rendererViewport;
    lastMainTestViewport = viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
      ? {
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          devicePixelRatio: Number.isFinite(viewport.devicePixelRatio) ? viewport.devicePixelRatio : null,
        }
      : null;
  }
  if (isMiniWindowSender(event) && eventName === 'mini-command') lastMiniTestSecurity = detail?.runtimeSecurity || null;
  if (isMiniWindowSender(event) && eventName === 'counterform-mini-state') lastMiniCounterformState = detail || null;
  if (isMiniWindowSender(event) && eventName === 'community-theme-mini-state') lastMiniCommunityThemeState = detail || null;
  if (isMiniWindowSender(event) && eventName === 'singularity-mini-state') lastMiniSingularityState = detail || null;
  return appendIntegrationReport(eventName, detail);
});

function windowEvidenceSnapshot(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return null;
  const bounds = targetWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    bounds,
    contentBounds: targetWindow.getContentBounds(),
    rendererViewport: targetWindow === mainWindow ? lastMainTestViewport : null,
    minimumSize: targetWindow.getMinimumSize(),
    isMaximized: targetWindow.isMaximized(),
    isFullScreen: targetWindow.isFullScreen(),
    display: {
      id: String(display.id),
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      bounds: display.bounds,
      workArea: display.workArea,
    },
  };
}

function accessibilityProperty(node, name) {
  const property = Array.isArray(node?.properties) ? node.properties.find((entry) => entry?.name === name) : null;
  const value = property?.value?.value;
  return ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
}

async function inspectSingularityAccessibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
  const target = mainWindow.webContents;
  const debug = target.debugger;
  let attachedHere = false;
  try {
    if (!debug.isAttached()) {
      debug.attach('1.3');
      attachedHere = true;
    }
    await debug.sendCommand('Accessibility.enable');
    const snapshot = await debug.sendCommand('Accessibility.getFullAXTree');
    const allowedRoles = new Set(['button', 'region', 'status', 'option', 'listbox', 'combobox', 'textbox']);
    const rawNodes = snapshot?.nodes || [];
    const nodeById = new Map(rawNodes.map((node) => [node.nodeId, node]));
    const descendantText = (node, depth = 0, seen = new Set()) => {
      if (!node || depth > 6 || seen.has(node.nodeId)) return '';
      seen.add(node.nodeId);
      return [node?.name?.value || '', ...(node.childIds || []).map((id) => descendantText(nodeById.get(id), depth + 1, seen))]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const nodes = rawNodes
      .filter((node) => node?.ignored !== true)
      .map((node) => ({
        role: String(node?.role?.value || '').toLowerCase(),
        name: String(node?.name?.value || '').replace(/\s+/g, ' ').trim().slice(0, 512),
        text: descendantText(node).slice(0, 512),
        focused: accessibilityProperty(node, 'focused') === true,
        focusable: accessibilityProperty(node, 'focusable') === true,
        expanded: accessibilityProperty(node, 'expanded'),
      }))
      .filter((node) => allowedRoles.has(node.role))
      .slice(0, 256);
    return { ok: true, evidenceClass: 'chromium-accessibility-tree', nodes };
  } catch (error) {
    return { ok: false, code: 'accessibility_tree_unverified', message: String(error?.message || error).slice(0, 180) };
  } finally {
    if (attachedHere && debug.isAttached()) {
      try { debug.detach(); } catch {}
    }
  }
}
registerHandle('test:action', async (event, action, inputDetail) => {
  if (!integrationTestMode || !isMainWindowSender(event)) return { ok: false, code: 'disabled' };
  if (action === 'inspect-singularity-accessibility') {
    if (!['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario)) return { ok: false, code: 'scenario_denied' };
    const snapshot = await inspectSingularityAccessibility();
    await appendIntegrationReport(snapshot.ok ? 'singularity-accessibility-tree' : 'singularity-accessibility-tree-unverified', {
      evidenceClass: snapshot.evidenceClass || 'unverified',
      nodeCount: snapshot.nodes?.length || 0,
      code: snapshot.code || '',
      pathsHidden: true,
    });
    return snapshot;
  }
  if (['singularity-keyboard-enter', 'singularity-keyboard-escape'].includes(action)) {
    if (!['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario)) return { ok: false, code: 'scenario_denied' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    const webContents = mainWindow.webContents;
    const keyCode = action === 'singularity-keyboard-enter' ? 'Enter' : 'Escape';
    const windowWasFocused = mainWindow.isFocused();
    const detail = { action, keyCode, windowWasFocused, evidenceClass: 'electron-webcontents-input-injection', physicalInputEvidence: false, pathsHidden: true };
    if (!mainWindow.isVisible()) mainWindow.show();
    if (!windowWasFocused) {
      mainWindow.focus();
      webContents.focus();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await appendIntegrationReport('singularity-keyboard-input', detail);
    webContents.sendInputEvent({ type: 'rawKeyDown', keyCode });
    if (keyCode === 'Enter') webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    webContents.sendInputEvent({ type: 'keyUp', keyCode });
    return { ok: true, ...detail };
  }
  if (['singularity-pointer-preview-enter', 'singularity-pointer-preview-leave', 'singularity-pointer-activate'].includes(action)) {
    if (!['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario)) return { ok: false, code: 'scenario_denied' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    const webContents = mainWindow.webContents;
    const proxyRoute = integrationTestScenario === 'singularity-stage3-proxy';
    const expectedTargets = action === 'singularity-pointer-preview-leave'
      ? new Set(['outside'])
      : action === 'singularity-pointer-activate'
        ? new Set([proxyRoute ? 'tracks' : 'secondary'])
        : new Set(proxyRoute ? ['tracks'] : ['library', 'secondary']);
    const contentBounds = mainWindow.getContentBounds();
    const point = inputDetail;
    if (!point || !expectedTargets.has(point.target) || point.x < 0 || point.y < 0 || point.x >= contentBounds.width || point.y >= contentBounds.height) {
      await appendIntegrationReport('singularity-pointer-input-unverified', { action, code: 'point_denied', pathsHidden: true });
      return { ok: false, code: 'point_denied' };
    }
    mainWindow.show();
    mainWindow.focus();
    webContents.focus();
    if (action === 'singularity-pointer-preview-enter') {
      webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2, movementX: 0, movementY: 0 });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y, movementX: 0, movementY: 0 });
    if (action === 'singularity-pointer-activate') {
      webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 140));
    const detail = { action, target: point.target, x: point.x, y: point.y, evidenceClass: 'electron-webcontents-input-injection', physicalInputEvidence: false, pathsHidden: true };
    await appendIntegrationReport('singularity-pointer-input', detail);
    return { ok: true, ...detail };
  }
  if (action === 'singularity-wheel-scroll') {
    if (!['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario)) return { ok: false, code: 'scenario_denied' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    const contentBounds = mainWindow.getContentBounds();
    const wheel = inputDetail;
    if (!wheel || wheel.target !== 'tracks' || wheel.x < 0 || wheel.y < 0 || wheel.x >= contentBounds.width || wheel.y >= contentBounds.height || !Number.isInteger(wheel.deltaY) || wheel.deltaY === 0 || Math.abs(wheel.deltaY) > 1200) {
      await appendIntegrationReport('singularity-wheel-input-unverified', { action, code: 'wheel_denied', pathsHidden: true });
      return { ok: false, code: 'wheel_denied' };
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: wheel.x, y: wheel.y, movementX: 0, movementY: 0 });
    mainWindow.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: wheel.x,
      y: wheel.y,
      deltaX: 0,
      deltaY: wheel.deltaY,
      wheelTicksX: 0,
      wheelTicksY: Math.sign(wheel.deltaY) * 6,
      accelerationRatioX: 1,
      accelerationRatioY: 1,
      hasPreciseScrollingDeltas: true,
      canScroll: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const detail = { action, target: wheel.target, x: wheel.x, y: wheel.y, deltaY: wheel.deltaY, evidenceClass: 'electron-webcontents-input-injection', physicalInputEvidence: false, pathsHidden: true };
    await appendIntegrationReport('singularity-wheel-input', detail);
    return { ok: true, ...detail };
  }
  if (['set-singularity-zoom-200', 'reset-singularity-zoom'].includes(action)) {
    if (!['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario)) return { ok: false, code: 'scenario_denied' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    const zoomFactor = action === 'set-singularity-zoom-200' ? 2 : 1;
    mainWindow.webContents.setZoomFactor(zoomFactor);
    await new Promise((resolve) => setTimeout(resolve, 240));
    const actualZoomFactor = mainWindow.webContents.getZoomFactor();
    await appendIntegrationReport('singularity-zoom', { zoomFactor: actualZoomFactor, pathsHidden: true });
    return { ok: Math.abs(actualZoomFactor - zoomFactor) < .01, zoomFactor: actualZoomFactor };
  }
  if (action === 'maximize-main') {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    lastMainTestViewport = null;
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const windowState = windowEvidenceSnapshot(mainWindow);
    await appendIntegrationReport('main-window-maximized', windowState);
    return { ok: windowState?.isMaximized === true, windowState };
  }
  if (action === 'resize-singularity-intermediate') {
    if (!['singularity-stage3', 'singularity-stage3-proxy'].includes(integrationTestScenario)) return { ok: false, code: 'scenario_denied' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    lastMainTestViewport = null;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(1440, 800, false);
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const windowState = windowEvidenceSnapshot(mainWindow);
    await appendIntegrationReport('singularity-window-intermediate', windowState);
    return { ok: windowState?.isMaximized === false && windowState.bounds.width === 1440 && windowState.bounds.height === 800, windowState };
  }
  if (action === 'resize-main-narrow') {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    lastMainTestViewport = null;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(1050, 700, false);
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const windowState = windowEvidenceSnapshot(mainWindow);
    await appendIntegrationReport('main-window-narrow', windowState);
    return { ok: windowState?.isMaximized === false && windowState.bounds.width === 1050, windowState };
  }
  if (action === 'resize-main-compact') {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    lastMainTestViewport = null;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(800, 700, false);
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const windowState = windowEvidenceSnapshot(mainWindow);
    await appendIntegrationReport('main-window-compact', windowState);
    return { ok: windowState?.isMaximized === false && windowState.bounds.width === 800, windowState };
  }
  if (action === 'close-mini') {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
    return { ok: true };
  }
  if (integrationTestScenario === 'workspace-theme-experiment' && ['capture-workspace-theme-experiment', 'capture-workspace-theme-experiment-remix'].includes(action)) {
    if (!integrationVisualMode || !mainWindow || mainWindow.isDestroyed() || !integrationUserDataPath) return { ok: false, code: 'visual_mode_required' };
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 320));
    const image = await mainWindow.webContents.capturePage();
    const artifact = action.endsWith('-remix') ? 'workspace-theme-experiment-remix-wide.png' : 'workspace-theme-experiment-wide.png';
    await fs.writeFile(path.join(integrationUserDataPath, artifact), image.toPNG());
    const windowState = windowEvidenceSnapshot(mainWindow);
    await appendIntegrationReport('paint-capture', { artifact, evidenceClass: 'painted-application-path', width: image.getSize().width, height: image.getSize().height, ...windowState });
    return { ok: true, artifact, width: image.getSize().width, height: image.getSize().height, ...windowState };
  }
  if (integrationTestScenario === 'workspace-canvas-studio' && ['capture-canvas-cartridge-quest-wide', 'capture-canvas-cartridge-quest-playing', 'capture-canvas-cartridge-quest-narrow', 'capture-canvas-cartridge-quest-mini', 'capture-canvas-cartridge-quest-playing-mini'].includes(action)) {
    const kind = action.endsWith('-mini') ? 'mini' : 'main';
    const targetWindow = kind === 'mini' ? miniWindow : mainWindow;
    if (!integrationVisualMode || !integrationUserDataPath) return { ok: false, code: 'visual_mode_required' };
    if (!targetWindow || targetWindow.isDestroyed()) return { ok: false, code: `${kind}_window_unavailable` };
    if (action.endsWith('-wide') && !targetWindow.isMaximized()) targetWindow.maximize();
    targetWindow.show();
    targetWindow.focus();
    targetWindow.webContents.focus();
    targetWindow.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 320));
    const image = await targetWindow.webContents.capturePage();
    const artifact = `${action}.png`;
    await fs.writeFile(path.join(integrationUserDataPath, artifact), image.toPNG());
    const runtime = {
      theme: lastPlayerState?.theme || '',
      canvasThemePort: lastPlayerState?.canvasThemePort?.key || '',
    };
    const windowState = windowEvidenceSnapshot(targetWindow);
    await appendIntegrationReport('canvas-cartridge-quest-capture', { artifact, kind, runtime, evidenceClass: 'painted-application-path', width: image.getSize().width, height: image.getSize().height, ...windowState });
    return { ok: true, artifact, kind, runtime, evidenceClass: 'painted-application-path', width: image.getSize().width, height: image.getSize().height, ...windowState };
  }
  if (integrationTestScenario === 'theme-imprints' && action.startsWith('capture-theme-imprint-')) {
    const runtimeKey = action.slice('capture-theme-imprint-'.length);
    const allowed = new Set((builtInThemeRegistry.themes || []).map((theme) => theme.runtimeKey));
    if (!integrationVisualMode || !allowed.has(runtimeKey) || !mainWindow || mainWindow.isDestroyed() || !integrationUserDataPath) return { ok: false, code: 'theme_imprint_denied' };
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
    mainWindow.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 260));
    const image = await mainWindow.webContents.capturePage();
    const artifact = `theme-imprint-${runtimeKey}.png`;
    await fs.writeFile(path.join(integrationUserDataPath, artifact), image.toPNG());
    await appendIntegrationReport('theme-imprint-capture', { runtimeKey, artifact, width: image.getSize().width, height: image.getSize().height, pathsHidden: true });
    return { ok: true, runtimeKey, artifact, width: image.getSize().width, height: image.getSize().height };
  }
  if (['theme-package', 'theme-package-write'].includes(integrationTestScenario) && action === 'install-theme-package-fixture') {
    try {
      return await themePackageStore().installFromPath(path.join(__dirname, 'themes', 'community-theme-template.pixelody-theme'));
    } catch (error) {
      return { ok: false, code: error instanceof ThemePackageError ? error.code : 'install_failed' };
    }
  }
  if (integrationTestScenario === 'counterform-choir' && action === 'resize-mini-compact') {
    if (!miniWindow || miniWindow.isDestroyed()) return { ok: false, code: 'window_unavailable' };
    miniWindow.setSize(340, 148, false);
    if (lastPlayerState) miniWindow.webContents.send('player:state', lastPlayerState);
    const bounds = miniWindow.getBounds();
    await appendIntegrationReport('candidate-mini-compact-bounds', { bounds, minimumSize: miniWindow.getMinimumSize() });
    return { ok: true, bounds, minimumSize: miniWindow.getMinimumSize() };
  }
  const singularityGraphCapture = integrationTestScenario === 'singularity-stage3'
    && /^capture-singularity-(?:main-(?:rest|playing|failure|intermediate|narrow|compact|zoom-200|restored-maximized)|mini-compact)$/.test(action);
  const singularityProxyCapture = integrationTestScenario === 'singularity-stage3-proxy'
    && /^capture-singularity-proxy-(?:main-(?:rest|playing|failure|intermediate|narrow|compact|zoom-200|restored-maximized)|mini-compact)$/.test(action);
  if (singularityGraphCapture || singularityProxyCapture) {
    const kind = action.includes('-mini-') ? 'mini' : 'main';
    const targetWindow = kind === 'mini' ? miniWindow : mainWindow;
    if (!integrationVisualMode) return { ok: false, code: 'visual_mode_required' };
    if (!integrationUserDataPath) return { ok: false, code: 'isolated_profile_unavailable' };
    if (!targetWindow || targetWindow.isDestroyed()) return { ok: false, code: `${kind}_window_unavailable` };
    try {
      targetWindow.show();
      targetWindow.focus();
      targetWindow.webContents.focus();
      targetWindow.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 220));
      const image = await targetWindow.webContents.capturePage();
      const artifact = `${action}.png`;
      await fs.writeFile(path.join(integrationUserDataPath, artifact), image.toPNG());
      const windowState = windowEvidenceSnapshot(targetWindow);
      await appendIntegrationReport('singularity-stage3-capture', { artifact, kind, evidenceClass: 'painted-application-path', width: image.getSize().width, height: image.getSize().height, ...windowState });
      return { ok: true, artifact, evidenceClass: 'painted-application-path', width: image.getSize().width, height: image.getSize().height, ...windowState };
    } catch (error) {
      await appendIntegrationReport('singularity-stage3-capture-unverified', { action, kind, code: error?.name || 'capture_error', message: String(error?.message || error).slice(0, 180) });
      return { ok: false, code: 'capture_unverified', message: String(error?.message || error).slice(0, 180) };
    }
  }
  if (action === 'run-security-probes' && integrationTestScenario === 'security') return runHostileSecurityProbe();
  if (integrationTestScenario === 'counterform-choir' && /^capture-(?:main|mini)-(?:wide|paused|failure|narrow|narrow-fold|narrow-aperture|narrow-paused|playing|empty|loading|grayscale|reduced-motion|compact|paused-full)$/.test(action)) {
    const kind = action.startsWith('capture-mini-') ? 'mini' : 'main';
    const targetWindow = kind === 'mini' ? miniWindow : mainWindow;
    if (!targetWindow || targetWindow.isDestroyed() || !integrationUserDataPath) return { ok: false, code: 'window_unavailable' };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        if (action === 'capture-main-wide' && !targetWindow.isMaximized()) {
          targetWindow.maximize();
          await new Promise((resolve) => setTimeout(resolve, 180));
        }
        targetWindow.show();
        targetWindow.focus();
        targetWindow.webContents.focus();
        targetWindow.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, action === 'capture-main-loading' ? 90 : 180 * attempt));
        let image = await targetWindow.webContents.capturePage();
        let evidenceClass = 'painted-application-path';
        if (action === 'capture-main-grayscale') {
          const size = image.getSize();
          const bitmap = image.toBitmap();
          for (let offset = 0; offset < bitmap.length; offset += 4) {
            const luminance = Math.round(bitmap[offset] * 0.114 + bitmap[offset + 1] * 0.587 + bitmap[offset + 2] * 0.299);
            bitmap[offset] = luminance;
            bitmap[offset + 1] = luminance;
            bitmap[offset + 2] = luminance;
          }
          image = nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height, scaleFactor: 1 });
          evidenceClass = 'painted-perceptual-derivative';
        }
        const artifact = `counterform-${action.slice('capture-'.length)}.png`;
        await fs.writeFile(path.join(integrationUserDataPath, artifact), image.toPNG());
        const windowState = windowEvidenceSnapshot(targetWindow);
        await appendIntegrationReport('candidate-capture', { artifact, kind, evidenceClass, attempt, width: image.getSize().width, height: image.getSize().height, ...windowState });
        return { ok: true, artifact, evidenceClass, width: image.getSize().width, height: image.getSize().height, ...windowState };
      } catch (error) {
        await appendIntegrationReport('candidate-capture-attempt-unverified', { action, kind, attempt, code: error?.name || 'capture_error', message: String(error?.message || error).slice(0, 180) });
        if (attempt === 2) {
          await appendIntegrationReport('candidate-capture-unverified', { action, kind, code: error?.name || 'capture_error', message: String(error?.message || error).slice(0, 180) });
          return { ok: false, code: 'capture_unverified', kind, message: String(error?.message || error).slice(0, 180) };
        }
      }
    }
  }
  return { ok: false, code: 'unsupported-action' };
});
registerOn('test:hostile-result', (event, result) => {
  if (!isHostileTestWindowSender(event) || !hostileTestResolver) return;
  hostileTestResolver(result);
});
registerHandle('test:capture-failure', async (event, label = 'failure') => {
  if (!integrationTestMode || !isMainWindowSender(event) || !integrationUserDataPath) return { ok: false };
  try {
    const image = await mainWindow.webContents.capturePage();
    const target = path.join(integrationUserDataPath, 'integration-failure.png');
    await fs.writeFile(target, image.toPNG());
    await appendIntegrationReport('failure-capture', { label: String(label).slice(0, 80), artifact: 'integration-failure.png' });
    return { ok: true, artifact: 'integration-failure.png' };
  } catch (error) {
    await appendIntegrationReport('failure-capture-error', { message: error.message || String(error) });
    return { ok: false };
  }
});
registerHandle('test:verify-sharing-privacy', async (event, snapshot) => {
  if (!integrationTestMode || !isMainWindowSender(event)) return { ok: false, code: 'disabled' };
  const server = sharingServer();
  const privateMarkers = (Array.isArray(snapshot?.tracks) ? snapshot.tracks : [])
    .flatMap((track) => [track?.id, track?.path, track?.artworkPath])
    .map((value) => String(value || ''))
    .filter(Boolean);
  try {
    server.updateSnapshot(snapshot);
    const status = await server.start({ host: '127.0.0.1' });
    const response = await fetch(`${status.baseUrl}/api/v1/library/snapshot`, { headers: { Authorization: `Bearer ${status.token}` } });
    const text = await response.text();
    const leaked = privateMarkers.some((marker) => text.includes(marker));
    const ensure = (ok, label) => { if (!ok) throw new Error(`J.A.M. lifecycle fixture failed: ${label}`); };
    const guest = server.createTrustedDevice({ name: 'Sequence 5 simulated client', accessProfile: 'jam-guest', permissions: ['browse', 'playback:read'] });
    ensure(guest.ok, 'guest creation');
    const request = async (route, method = 'GET', body) => {
      const result = await fetch(`${status.baseUrl}/api/v1/${route}`, {
        method, headers: { Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: result.status, body: await result.json() };
    };
    ensure(server.startJamSession().active, 'start');
    ensure((await request('jam/session/join', 'POST', { role: 'guest' })).body.approvalRequired, 'pending join');
    ensure(server.approveJamParticipant(guest.device.id, { permissions: ['view', 'suggest'] }).ok, 'approval');
    ensure((await request('jam/session/playback', 'POST', { action: 'toggle' })).status === 403, 'restricted playback');
    ensure(server.approveJamParticipant(guest.device.id, { permissions: ['view', 'suggest', 'add', 'editQueue', 'controlPlayback'] }).ok, 'expanded policy');
    const publicTrack = JSON.parse(text).tracks[0];
    ensure(Boolean(publicTrack), 'generated track');
    const queued = await request('jam/session/queue', 'POST', { action: 'suggest', trackId: publicTrack.id });
    ensure(queued.status === 202 && queued.body.queue.some((item) => item.addedByDeviceId === guest.device.id && item.sourceDeviceId === status.hostId), 'queue ownership');
    ensure(!(await request('library/snapshot')).body.tracks.some((item) => item.streamUrl), 'guest original media denial');
    ensure(server.removeJamParticipant(guest.device.id).ok, 'participant removal');
    const removed = await request('live');
    ensure(!removed.body.jamSession?.currentParticipant && !removed.body.jamSession?.queue?.length, 'removed live state');
    ensure((await request('jam/session/playback', 'POST', { action: 'toggle' })).status === 403, 'removed control denial');
    ensure(server.revokeTrustedDevice(guest.device.id).ok, 'credential revocation');
    ensure((await request('live')).body.code === 'auth_revoked', 'structured revocation');
    ensure(server.stopJamSession().ok && !server.status().jamSession?.active, 'session cleanup');
    await server.stop();
    const restarted = await server.start({ host: '127.0.0.1' });
    ensure(!restarted.jamSession?.active, 'empty restart');
    return { ok: response.ok && !leaked, statusCode: response.status, leaked, sanitized: !leaked, jamLifecycle: true };
  } catch (error) {
    return { ok: false, code: 'privacy-check-error', message: String(error.message || error).slice(0, 300) };
  } finally {
    await server.stop().catch(() => {});
  }
});
registerHandle('test:finish', async (event, result = {}) => {
  if (!integrationTestMode || !isMainWindowSender(event)) return false;
  await appendIntegrationReport('terminal', {
    ok: result?.ok === true,
    code: String(result?.code || (result?.ok ? 'passed' : 'failed')).slice(0, 80),
    summary: result?.summary && typeof result.summary === 'object' ? result.summary : {},
  });
  if (process.env.PIXELODY_HOLD_OPEN !== '1') {
    setTimeout(() => {
      app.quit();
    }, 80);
  }
  return true;
});

registerHandle('app:runtime-info', () => ({
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  isDevelopment,
  composableThemeExperiment: composableThemeExperimentEnabled,
  composableThemeExperimentVersion: composableThemeExperimentEnabled ? composableThemeExperimentVersion : 0,
  composableThemeExperimentProfile: composableThemeExperimentEnabled ? composableThemeProfile.PROFILE_ID : '',
  composableThemeExperimentLabel: composableThemeExperimentEnabled ? composableThemeProfile.LABEL : '',
  composableThemeExperimentTheme: composableThemeExperimentEnabled ? composableThemeProfile.THEME_ID : '',
  composableThemeExperimentStudio: composableThemeExperimentEnabled && (composableThemeProfile === canvasStudioPreset || composableThemeProfile.CANVAS_STUDIO === true),
  composableThemeExperimentStartInUseMode: composableThemeExperimentEnabled && composableThemeProfile.START_IN_USE_MODE === true,
  composableThemeExperimentLaunchFlag: isDevelopment && canvasRequested,
  composableThemeExperimentCanvasGrid: composableThemeExperimentEnabled ? composableThemeProfile.CANVAS_GRID_ID || '' : '',
  developmentProfiles: developmentExplorerEnabled ? developmentProfiles.describe() : [],
  activeDevelopmentProfile: activeDevelopmentProfile?.id || '',
  activeDevelopmentProfileIsolated: activeDevelopmentProfile?.isolated === true,
  singularityProbeMode,
  cachePolicy: isDevelopment ? 'development-no-store' : 'packaged-default',
  devCacheToken: isDevelopment ? devCacheToken : '',
  startedAt: appStartedAt,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  },
  integrationTest: integrationTestMode ? { enabled: true, scenario: integrationTestScenario } : { enabled: false },
}));

// Restarts Pixelody into a development presentation from the theme explorer,
// or back to Studio. The profile is chosen when the process starts (see
// canvasProfile and singularityProbeMode above), so this is a real restart:
// the durable store drains on will-quit and the new process owns the profile
// lock once this one has exited. Development builds only; never in tests.
registerHandle('app:relaunch-development-profile', (_event, profileId) => {
  if (!developmentExplorerEnabled) return { ok: false, error: 'Development presentations are available in development builds only.' };
  if (profileId === activeDevelopmentProfile?.id) return { ok: false, error: 'Pixelody is already running that presentation.' };
  const plan = developmentProfiles.relaunchPlan(profileId, { argv: process.argv, appPath: app.isPackaged ? '' : app.getAppPath() });
  if (!plan) return { ok: false, error: 'Unknown development presentation.' };
  for (const [key, value] of Object.entries(plan.env)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  console.info(`Pixelody development restart: ${activeDevelopmentProfile?.id || 'none'} -> ${profileId}`);
  app.relaunch({ args: plan.args });
  setTimeout(() => app.quit(), 0);
  return { ok: true };
});

registerHandle('theme:list-packages', async () => {
  try {
    return await themePackageStore().list();
  } catch (error) {
    return publicThemePackageError(error);
  }
});

registerHandle('theme:import-package', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import a Pixelody theme',
    defaultPath: app.getPath('downloads'),
    properties: ['openFile'],
    filters: [{ name: 'Pixelody theme package', extensions: ['pixelody-theme'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, code: 'canceled', canceled: true };
  try {
    return await themePackageStore().installFromPath(result.filePaths[0]);
  } catch (error) {
    return publicThemePackageError(error);
  }
});

registerHandle('theme:delete-package', async (event, identity) => {
  try {
    return await themePackageStore().delete(identity);
  } catch (error) {
    return publicThemePackageError(error);
  }
});

registerOn('state:load-sync', (event) => {
  if (!isMainWindowSender(event)) {
    event.returnValue = { ok: false, status: 'unauthorized', state: null, readOnly: true, diagnostics: { status: 'unauthorized', pathsHidden: true } };
    return;
  }
  try {
    event.returnValue = { ...(durableStateStartupLoad || stateStore().loadSync()), presentation: {
      canvasAllowed: isDevelopment && composableThemeExperimentEnabled && composableThemeProfile.THEME_ID === 'foreground',
      canvasRequested: isDevelopment && canvasRequested,
    } };
    durableStateStartupLoad = null;
  } catch (error) {
    event.returnValue = { ok: false, status: 'load-error', state: null, readOnly: true, diagnostics: { status: 'load-error', message: error.message, pathsHidden: true } };
  }
});
registerHandle('state:migrate-legacy', async (event, values = {}, malformedLegacyKeys = []) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  const result = await stateStore().migrateLegacy(values, malformedLegacyKeys);
  if (result?.ok) grantStatePaths(values);
  return result;
});
registerHandle('state:commit', async (event, values = {}, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  if (!statePathsAreGranted(values)) return rejectedIpc('path_not_granted', 'state:commit', 'State contains a path that was not selected, dropped, imported, or previously stored.');
  const reason = typeof options?.reason === 'string' ? options.reason : 'renderer-persist';
  // Routine saves only need the committed revision back, not a full-library
  // copy cloned over IPC on every playback tick.
  return stateStore().commit(values, { reason, includeState: false });
});
registerHandle('state:import-backup-v1', async (event, backup, normalizedOverrides = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  const result = await stateStore().importBackupV1(backup, normalizedOverrides);
  if (result?.ok) grantStatePaths(normalizedOverrides);
  return result;
});
registerHandle('state:diagnostics', async (event) => {
  if (!isMainWindowSender(event)) return { status: 'unauthorized', pathsHidden: true };
  return stateStore().diagnosticsSnapshot();
});
registerHandle('state:workspace-load', async (event) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  return { ok: true, status: 'ready', state: stateStore().workspaceSnapshot() };
});
registerHandle('state:workspace-commit', async (event, graph, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  return stateStore().commitWorkspaceComposition(graph, {
    expectedRevision: options.expectedRevision,
    activeThemeId: options.activeThemeId,
    reason: typeof options.reason === 'string' ? options.reason : 'workspace-composition-commit',
  });
});
registerHandle('state:workspace-cancel', async (event, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  return stateStore().cancelWorkspaceComposition({ expectedRevision: options.expectedRevision });
});
registerHandle('state:workspace-startup', async (event, action, detail = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: 'unauthorized' };
  if (action !== 'begin') {
    workspaceStartupWatchdog?.cancel();
    workspaceStartupWatchdog = null;
  }
  const result = await stateStore().recordWorkspaceStartup(action, detail);
  if (action === 'begin' && result?.ok) {
    workspaceStartupWatchdog?.cancel();
    workspaceStartupWatchdog = new WorkspaceStartupWatchdog({
      delayMs: result.state.startup.watchdogMs,
      onExpired: () => {
        workspaceStartupWatchdog = null;
        stateStore().recordWorkspaceStartup('failed', { errorCode: 'WORKSPACE_WATCHDOG_EXPIRED' })
          .catch((error) => console.warn('Pixelody workspace startup watchdog receipt failed:', error));
      },
    });
    workspaceStartupWatchdog.begin();
  }
  return result;
});

registerHandle('app:clear-runtime-cache', async () => clearRuntimeCaches());
registerHandle('app:wasapi-helper-status', async (event) => {
  if (!isMainWindowSender(event)) return { supported: false, installed: false, available: false, status: 'Unauthorized', required: false };
  return getWasapiHelperStatus(app);
});
registerHandle('app:wasapi-helper-diagnostics', async (event, request = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: { supported: false, installed: false, available: false, status: 'Unauthorized', required: false }, diagnostics: null };
  return runWasapiDiagnostics(app, request);
});
registerHandle('app:wasapi-helper-probe', async (event, request = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: { supported: false, installed: false, available: false, status: 'Unauthorized', required: false }, probe: null };
  return runWasapiCapabilityProbe(app, request);
});
registerHandle('app:wasapi-helper-loopback-prototype', async (event, request = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: { supported: false, installed: false, available: false, status: 'Unauthorized', required: false }, prototype: null };
  return runWasapiLoopbackPrototype(app, request);
});
registerHandle('app:native-mixer-status', async (event) => {
  if (!isMainWindowSender(event)) return { state: 'error', reason: 'Unauthorized native mixer status request.', privacy: { pathHidden: true, sanitizer: 'pixelody-native-mixer-v1' } };
  return getNativeMixerStatus(app);
});
registerHandle('app:native-mixer-clock-discipline-lab', async (event, request = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, status: { state: 'error', reason: 'Unauthorized native mixer clock-lab request.', privacy: { pathHidden: true, sanitizer: 'pixelody-native-mixer-v1' } } };
  return runNativeMixerClockDisciplineLab(app, request);
});
registerHandle('app:open-external', async (event, url) => {
  if (!isMainWindowSender(event)) return false;
  try {
    const parsed = new URL(String(url || ''));
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});
// MusicBrainz metadata repair. The renderer sends only track text and a
// duration; the URL is built here, limited to one request per MusicBrainz's
// rate policy, and never accepts a URL from the renderer.
const musicBrainzLimiter = musicBrainz.createRateLimiter();
registerHandle('metadata:musicbrainz-search', async (event, query) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized', candidates: [] };
  const url = musicBrainz.buildSearchUrl(query);
  if (!url || !musicBrainz.isAllowedSearchUrl(url)) return { ok: false, code: 'bad-query', candidates: [] };
  try {
    return await musicBrainzLimiter.schedule(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(url, { headers: { 'User-Agent': musicBrainz.userAgent(app.getVersion()), Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
        if (response.status === 503 || response.status === 429) return { ok: false, code: 'rate-limited', candidates: [] };
        if (!response.ok) return { ok: false, code: 'http-error', status: response.status, candidates: [] };
        const payload = await response.json();
        return { ok: true, candidates: musicBrainz.parseSearchResponse(payload) };
      } finally {
        clearTimeout(timer);
      }
    });
  } catch (error) {
    return { ok: false, code: error?.name === 'AbortError' ? 'timeout' : 'network', candidates: [] };
  }
});
registerHandle('sharing:status', (event) => {
  if (!isMainWindowSender(event)) return { enabled: false, error: 'Unauthorized sender.' };
  return sharingServer().status();
});
registerHandle('sharing:update-snapshot', (event, snapshot) => {
  if (!isMainWindowSender(event)) return { enabled: false, error: 'Unauthorized sender.' };
  return sharingServer().updateSnapshot(snapshot);
});
registerHandle('sharing:start', async (event, snapshot, options = {}) => {
  if (!isMainWindowSender(event)) return { enabled: false, error: 'Unauthorized sender.' };
  const server = sharingServer();
  if (snapshot) server.updateSnapshot(snapshot);
  const mode = options && options.mode === 'lan' ? 'lan' : 'localhost';
  return server.start({ host: mode === 'lan' ? '0.0.0.0' : '127.0.0.1' });
});
registerHandle('sharing:stop', async (event) => {
  if (!isMainWindowSender(event)) return { enabled: false, error: 'Unauthorized sender.' };
  return sharingServer().stop();
});
registerHandle('sharing:self-test', async (event) => {
  if (!isMainWindowSender(event)) return { enabled: false, error: 'Unauthorized sender.' };
  return sharingServer().selfTest();
});
registerHandle('sharing:create-device', (event, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, error: 'Unauthorized sender.' };
  return sharingServer().createTrustedDevice(options);
});
registerHandle('sharing:revoke-device', (event, deviceId) => {
  if (!isMainWindowSender(event)) return { ok: false, error: 'Unauthorized sender.' };
  return sharingServer().revokeTrustedDevice(deviceId);
});
registerHandle('sharing:delete-device', (event, deviceId) => {
  if (!isMainWindowSender(event)) return { ok: false, error: 'Unauthorized sender.' };
  return sharingServer().deleteTrustedDevice(deviceId);
});
registerHandle('sharing:update-device-permissions', (event, deviceId, permissions, accessProfile) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', error: 'Unauthorized sender.' };
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 128) {
    return { ok: false, code: 'device_id_invalid', message: 'Trusted-device ID is invalid.' };
  }
  if (!Array.isArray(permissions) || permissions.length > 16 || permissions.some((permission) => typeof permission !== 'string' || permission.length > 64)) {
    return { ok: false, code: 'permissions_invalid', message: 'Trusted-device permissions are invalid.' };
  }
  if (accessProfile !== undefined && !['personal-device', 'jam-guest'].includes(accessProfile)) {
    return { ok: false, code: 'access_profile_invalid', message: 'Trusted-device access profile is invalid.' };
  }
  return sharingServer().updateTrustedDeviceAccess(deviceId, { permissions, accessProfile });
});
registerHandle('sharing:refresh-devices', (event, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, error: 'Unauthorized sender.' };
  return sharingServer().requestDeviceRefresh(options);
});
registerHandle('sharing:start-pairing', (event, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, error: 'Unauthorized sender.' };
  return sharingServer().startPairing(options);
});
registerHandle('sharing:jam-session', (event) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender.' };
  return sharingServer().jamSession();
});
registerHandle('sharing:start-jam-session', (event, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender.' };
  if (!options || typeof options !== 'object' || Array.isArray(options)) return { ok: false, code: 'jam_policy_invalid', message: 'J.A.M. policy is invalid.' };
  return sharingServer().startJamSession(options);
});
registerHandle('sharing:stop-jam-session', (event) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender.' };
  return sharingServer().stopJamSession();
});
registerHandle('sharing:update-jam-policy', (event, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender.' };
  if (!options || typeof options !== 'object' || Array.isArray(options)) return { ok: false, code: 'jam_policy_invalid', message: 'J.A.M. policy is invalid.' };
  return sharingServer().updateJamPolicy(options);
});
registerHandle('sharing:approve-jam-participant', (event, deviceId, options = {}) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender.' };
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 128) return { ok: false, code: 'device_id_invalid', message: 'Participant ID is invalid.' };
  if (!options || typeof options !== 'object' || Array.isArray(options) || (Array.isArray(options.permissions) && options.permissions.length > 8)) return { ok: false, code: 'jam_permissions_invalid', message: 'J.A.M. participant permissions are invalid.' };
  return sharingServer().approveJamParticipant(deviceId, options);
});
registerHandle('sharing:remove-jam-participant', (event, deviceId) => {
  if (!isMainWindowSender(event)) return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender.' };
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 128) return { ok: false, code: 'device_id_invalid', message: 'Participant ID is invalid.' };
  return sharingServer().removeJamParticipant(deviceId);
});

registerHandle('music:choose-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: app.getPath('music'),
    properties: ['openFile', 'multiSelections'],
    filters: AUDIO_FILTERS,
  });
  if (result.canceled) return [];
  const files = [];
  for (const filePath of result.filePaths.slice(0, MAX_FOLDER_IMPORT_FILES)) {
    if (AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      grantPath(filePath, 'media');
      files.push(filePath);
    }
  }
  return files;
});

registerHandle('migration:choose-playlist-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [
      { name: 'Playlist metadata', extensions: ['csv', 'json', 'm3u', 'm3u8', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stats = await fs.stat(filePath);
  const allowedExtensions = new Set(['.csv', '.json', '.m3u', '.m3u8', '.txt']);
  if (!stats.isFile() || stats.size > 10 * 1024 * 1024 || !allowedExtensions.has(path.extname(filePath).toLowerCase())) {
    return { error: 'Playlist file is unsupported or too large for this importer.' };
  }
  return {
    path: filePath,
    directory: path.dirname(filePath),
    name: path.basename(filePath, path.extname(filePath)),
    extension: path.extname(filePath).toLowerCase().replace('.', ''),
    text: await fs.readFile(filePath, 'utf8'),
  };
});

registerHandle('music:choose-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: app.getPath('pictures'),
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES || !IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
  } catch {
    return null;
  }
  grantPath(filePath, 'image');
  return filePath;
});

registerHandle('music:register-dropped-paths', async (_event, filePaths) => {
  const granted = [];
  for (const filePath of filePaths) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || !AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
      grantPath(filePath, 'media');
      granted.push(filePath);
    } catch {}
  }
  return granted;
});

registerHandle('app:cache-profile-image', async (_event, sourcePath) => {
  if (!(await isRegularGrantedFile(sourcePath, 'image', IMAGE_EXTENSIONS, MAX_IMAGE_BYTES))) return rejectedIpc('path_not_granted', 'app:cache-profile-image', 'Profile image was not selected by the user.');
  const extension = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(path.extname(sourcePath).toLowerCase()) ? path.extname(sourcePath).toLowerCase() : '.jpg';
  const profileDirectory = path.join(app.getPath('userData'), 'profile');
  const destination = path.join(profileDirectory, `profile${extension}`);
  await fs.mkdir(profileDirectory, { recursive: true });
  await fs.copyFile(sourcePath, destination);
  grantPath(destination, 'image');
  return destination;
});

registerHandle('app:cache-track-image', async (_event, sourcePath, trackId) => {
  if (!(await isRegularGrantedFile(sourcePath, 'image', IMAGE_EXTENSIONS, MAX_IMAGE_BYTES))) return rejectedIpc('path_not_granted', 'app:cache-track-image', 'Track image was not selected by the user.');
  const extension = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(path.extname(sourcePath).toLowerCase()) ? path.extname(sourcePath).toLowerCase() : '.jpg';
  const artworkDirectory = path.join(app.getPath('userData'), 'custom-artwork');
  const name = crypto.createHash('sha1').update(trackId).digest('hex');
  await fs.mkdir(artworkDirectory, { recursive: true });
  if (extension !== '.gif') {
    const image = nativeImage.createFromPath(sourcePath);
    if (!image.isEmpty()) {
      const size = image.getSize();
      if (Math.max(size.width, size.height) > 512) {
        const scale = 512 / Math.max(size.width, size.height);
        const preview = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' });
        const keepsAlpha = ['.png', '.webp'].includes(extension);
        const destination = path.join(artworkDirectory, `${name}.${keepsAlpha ? 'png' : 'jpg'}`);
        await fs.writeFile(destination, keepsAlpha ? preview.toPNG() : preview.toJPEG(85));
        grantPath(destination, 'image');
        return destination;
      }
    }
  }
  const destination = path.join(artworkDirectory, `${name}${extension}`);
  await fs.copyFile(sourcePath, destination);
  grantPath(destination, 'image');
  return destination;
});

registerHandle('app:optimize-artwork', async (_event, sourcePath) => {
  if (!(await isRegularGrantedFile(sourcePath, 'image', IMAGE_EXTENSIONS, MAX_IMAGE_BYTES))) return rejectedIpc('path_not_granted', 'app:optimize-artwork', 'Artwork path is not granted.');
  try {
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) return sourcePath;
    const size = image.getSize();
    if (Math.max(size.width, size.height) <= 512) return sourcePath;
    const scale = 512 / Math.max(size.width, size.height);
    const preview = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' });
    const stats = await fs.stat(sourcePath);
    const name = crypto.createHash('sha1').update(`${sourcePath}:${stats.size}:${stats.mtimeMs}`).digest('hex');
    const previewDirectory = path.join(app.getPath('userData'), 'artwork-previews');
    const destination = path.join(previewDirectory, `${name}.jpg`);
    await fs.mkdir(previewDirectory, { recursive: true });
    try { await fs.access(destination); } catch { await fs.writeFile(destination, preview.toJPEG(85)); }
    grantPath(destination, 'image');
    return destination;
  } catch {
    return sourcePath;
  }
});

registerHandle('music:scan-downloads', async () => {
  const downloads = app.getPath('downloads');
  const extensions = new Set(AUDIO_FILTERS[0].extensions.map((extension) => `.${extension}`));
  const entries = await fs.readdir(downloads, { withFileTypes: true });
  const found = entries
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .slice(0, MAX_FOLDER_IMPORT_FILES)
    .map((entry) => path.join(downloads, entry.name));
  found.forEach((filePath) => grantPath(filePath, 'media'));
  return found;
});

registerHandle('app:set-text-scale', (event, factor) => {
  // Window zoom scales text and layout together; there is no app menu, so
  // Ctrl+plus/minus never worked. Only the allowlisted steps reach here.
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target !== mainWindow || target.isDestroyed()) return false;
  target.webContents.setZoomFactor(factor);
  return true;
});

registerHandle('music:verify-integrity', async (_event, entries) => {
  const granted = entries.filter((entry) => isGrantedPath(entry.path, 'media'));
  if (granted.length !== entries.length) return rejectedIpc('path_not_granted', 'music:verify-integrity', 'Integrity check includes a path outside the library.');
  return verifyFiles(entries);
});

registerHandle('music:exists', async (_event, filePath) => {
  if (!isGrantedPath(filePath)) return false;
  try { await fs.access(filePath); return true; } catch { return false; }
});

registerHandle('app:export-backup', async (_event, backup) => {
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('documents'), `Pixelody-backup-${date}.json`), filters: [{ name: 'Pixelody backup', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
  return true;
});

registerHandle('playlist:export-m3u', async (_event, playlist) => {
  // Every entry must already be a library path the main process granted; the
  // renderer cannot use export to write arbitrary paths into a file.
  if (!playlist.entries.every((entry) => isGrantedPath(entry.path, 'media'))) return rejectedIpc('path_not_granted', 'playlist:export-m3u', 'Playlist contains a path outside the library.');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('music'), `${sanitizePlaylistFileName(playlist.name)}.m3u8`),
    filters: [{ name: 'M3U8 playlist', extensions: ['m3u8'] }, { name: 'M3U playlist', extensions: ['m3u'] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, buildM3u8(playlist.entries, result.filePath), 'utf8');
  return { ok: true, count: playlist.entries.length };
});

registerHandle('app:import-backup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { defaultPath: app.getPath('documents'), properties: ['openFile'], filters: [{ name: 'Pixelody backup', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return readBoundedJsonFile(result.filePaths[0], MAX_JSON_IMPORT_BYTES);
});

registerHandle('app:import-signal-report', async (event) => {
  if (!isMainWindowSender(event)) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Pixelody Signal Journal or backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return readBoundedJsonFile(result.filePaths[0], MAX_SIGNAL_IMPORT_BYTES);
});

registerHandle('app:export-tuning-profiles', async (_event, profiles) => {
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('documents'), `Pixelody-tuning-profiles-${date}.json`), filters: [{ name: 'Pixelody tuning profiles', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, JSON.stringify(profiles, null, 2), 'utf8');
  return true;
});

registerHandle('app:import-tuning-profiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { defaultPath: app.getPath('documents'), properties: ['openFile'], filters: [{ name: 'Pixelody tuning profiles', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return readBoundedJsonFile(result.filePaths[0], MAX_TUNING_IMPORT_BYTES);
});

registerHandle('music:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { defaultPath: app.getPath('music'), properties: ['openDirectory'] });
  if (result.canceled) return { paths: [], skippedFolders: 0 };
  const extensions = new Set(AUDIO_FILTERS[0].extensions.map(ext => `.${ext}`));
  const scan = await scanAudioFolder(result.filePaths[0], { extensions, maxFiles: MAX_FOLDER_IMPORT_FILES });
  scan.paths.forEach((filePath) => grantPath(filePath, 'media'));
  return scan;
});

class WatchedFolderManager {
  constructor(options = {}) {
    this.getMainWindow = options.getMainWindow || (() => null);
    this.watchers = new Map();
    this.debounceMs = options.debounceMs || 1200;
  }

  async scanDirectory(folderPath) {
    const extensions = new Set(AUDIO_FILTERS[0].extensions.map((ext) => `.${ext}`));
    const found = [];
    async function walk(dir) {
      if (found.length >= MAX_FOLDER_IMPORT_FILES) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (found.length >= MAX_FOLDER_IMPORT_FILES) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
            found.push(fullPath);
          }
        }
      } catch {}
    }
    await walk(folderPath);
    found.forEach((filePath) => grantPath(filePath, 'media'));
    return found;
  }

  async addWatchedFolder(folderPath) {
    if (!folderPath || typeof folderPath !== 'string') return { ok: false, error: 'Invalid folder path.' };
    const resolved = path.resolve(folderPath);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) return { ok: false, error: 'Path is not a directory.' };
    } catch (err) {
      return { ok: false, error: `Directory inaccessible: ${err.message}` };
    }

    const normKey = normalizedPathKey(resolved);
    if (this.watchers.has(normKey)) {
      const existing = this.watchers.get(normKey);
      return { ok: true, folderPath: resolved, trackCount: existing.lastScanPaths.length, alreadyWatching: true, tracks: existing.lastScanPaths };
    }

    const initialTracks = await this.scanDirectory(resolved);
    let watcher = null;
    try {
      watcher = nodeFs.watch(resolved, { recursive: true }, (eventType, filename) => {
        this.handleFsEvent(normKey, resolved, eventType, filename);
      });
      watcher.on('error', (err) => {
        console.warn(`Watched folder error on ${resolved}:`, err);
      });
    } catch (err) {
      try {
        watcher = nodeFs.watch(resolved, (eventType, filename) => {
          this.handleFsEvent(normKey, resolved, eventType, filename);
        });
      } catch {}
    }

    const entry = {
      path: resolved,
      watcher,
      timer: null,
      lastScanPaths: initialTracks,
      lastScannedAt: new Date().toISOString(),
    };
    this.watchers.set(normKey, entry);
    return { ok: true, folderPath: resolved, trackCount: initialTracks.length, tracks: initialTracks };
  }

  removeWatchedFolder(folderPath) {
    const normKey = normalizedPathKey(folderPath);
    const entry = this.watchers.get(normKey);
    if (!entry) return { ok: false, error: 'Folder is not being watched.' };
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.watcher) {
      try { entry.watcher.close(); } catch {}
    }
    this.watchers.delete(normKey);
    return { ok: true, folderPath: entry.path };
  }

  handleFsEvent(normKey, folderPath) {
    const entry = this.watchers.get(normKey);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      entry.timer = null;
      try {
        const currentTracks = await this.scanDirectory(folderPath);
        const previousSet = new Set(entry.lastScanPaths.map((p) => normalizedPathKey(p)));
        const currentSet = new Set(currentTracks.map((p) => normalizedPathKey(p)));

        const addedPaths = currentTracks.filter((p) => !previousSet.has(normalizedPathKey(p)));
        const removedPaths = entry.lastScanPaths.filter((p) => !currentSet.has(normalizedPathKey(p)));

        entry.lastScanPaths = currentTracks;
        entry.lastScannedAt = new Date().toISOString();

        if (addedPaths.length > 0 || removedPaths.length > 0) {
          const win = this.getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('library:folder-changed', {
              folderPath,
              addedPaths,
              removedPaths,
              totalTracks: currentTracks.length,
              timestamp: entry.lastScannedAt,
            });
          }
        }
      } catch (err) {
        console.warn(`Watched folder rescan failed for ${folderPath}:`, err);
      }
    }, this.debounceMs);
  }

  async rescanAll() {
    const results = [];
    for (const entry of this.watchers.values()) {
      try {
        const currentTracks = await this.scanDirectory(entry.path);
        const previousSet = new Set(entry.lastScanPaths.map((p) => normalizedPathKey(p)));
        const currentSet = new Set(currentTracks.map((p) => normalizedPathKey(p)));

        const addedPaths = currentTracks.filter((p) => !previousSet.has(normalizedPathKey(p)));
        const removedPaths = entry.lastScanPaths.filter((p) => !currentSet.has(normalizedPathKey(p)));

        entry.lastScanPaths = currentTracks;
        entry.lastScannedAt = new Date().toISOString();

        if (addedPaths.length > 0 || removedPaths.length > 0) {
          const win = this.getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('library:folder-changed', {
              folderPath: entry.path,
              addedPaths,
              removedPaths,
              totalTracks: currentTracks.length,
              timestamp: entry.lastScannedAt,
            });
          }
        }
        results.push({ ok: true, folderPath: entry.path, trackCount: currentTracks.length, added: addedPaths.length, removed: removedPaths.length });
      } catch (err) {
        results.push({ ok: false, folderPath: entry.path, error: err.message });
      }
    }
    return results;
  }

  getWatchedFolders() {
    return Array.from(this.watchers.values()).map((entry) => ({
      path: entry.path,
      trackCount: entry.lastScanPaths.length,
      lastScannedAt: entry.lastScannedAt,
      active: Boolean(entry.watcher),
    }));
  }

  async syncWatchedFolders(folderPaths = []) {
    const targetSet = new Set((folderPaths || []).map((p) => normalizedPathKey(p)).filter(Boolean));
    for (const [normKey, entry] of Array.from(this.watchers.entries())) {
      if (!targetSet.has(normKey)) {
        this.removeWatchedFolder(entry.path);
      }
    }
    const results = [];
    for (const folderPath of folderPaths || []) {
      const normKey = normalizedPathKey(folderPath);
      if (!this.watchers.has(normKey)) {
        const res = await this.addWatchedFolder(folderPath);
        results.push(res);
      }
    }
    return { ok: true, folders: this.getWatchedFolders() };
  }

  dispose() {
    for (const entry of this.watchers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.watcher) {
        try { entry.watcher.close(); } catch {}
      }
    }
    this.watchers.clear();
  }
}

const watchedFolderManager = new WatchedFolderManager({ getMainWindow: () => mainWindow });

registerHandle('library:add-watched-folder', async (_event, folderPath) => {
  let targetPath = folderPath;
  if (!targetPath) {
    const result = await dialog.showOpenDialog(mainWindow, { defaultPath: app.getPath('music'), properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    targetPath = result.filePaths[0];
  }
  return watchedFolderManager.addWatchedFolder(targetPath);
});

registerHandle('library:remove-watched-folder', async (_event, folderPath) => {
  return watchedFolderManager.removeWatchedFolder(folderPath);
});

registerHandle('library:get-watched-folders', async () => {
  return watchedFolderManager.getWatchedFolders();
});

registerHandle('library:sync-watched-folders', async (_event, folderPaths) => {
  return watchedFolderManager.syncWatchedFolders(folderPaths);
});

registerHandle('library:rescan-watched-folders', async () => {
  return watchedFolderManager.rescanAll();
});

registerHandle('music:inspect', async (_event, filePath) => {
  if (!(await isRegularGrantedFile(filePath, 'media', AUDIO_EXTENSIONS))) return rejectedIpc('path_not_granted', 'music:inspect', 'Audio path is not granted.');
  try {
    const { parseFile } = await getMusicMetadata();
    const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
    const picture = metadata.common.picture?.[0];
    const replayGain = metadata.common.replaygain_track_gain;
    const replayGainDb = typeof replayGain === 'number' ? replayGain : replayGain?.dB;
    let artworkPath = null;
    if (picture && picture.data.length <= 5 * 1024 * 1024) {
      const artworkDirectory = path.join(app.getPath('userData'), 'artwork');
      const hash = crypto.createHash('sha1').update(picture.data).digest('hex');
      artworkPath = path.join(artworkDirectory, `${hash}.jpg`);
      await fs.mkdir(artworkDirectory, { recursive: true });
      try {
        await fs.access(artworkPath);
      } catch {
        const image = nativeImage.createFromBuffer(picture.data);
        if (!image.isEmpty()) {
          const size = image.getSize();
          const scale = Math.min(1, 1024 / Math.max(size.width, size.height));
          const preview = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }) : image;
          await fs.writeFile(artworkPath, preview.toJPEG(88));
        } else await fs.writeFile(artworkPath, picture.data);
      }
    }
    grantPath(artworkPath, 'image');
    return {
      title: metadata.common.title || null,
      artist: metadata.common.artist || metadata.common.albumartist || null,
      albumArtist: metadata.common.albumartist || null,
      album: metadata.common.album || null,
      year: metadata.common.year || null,
      trackNumber: metadata.common.track?.no || null,
      discNumber: metadata.common.disk?.no || null,
      genre: Array.isArray(metadata.common.genre) ? metadata.common.genre.join(', ') : metadata.common.genre || null,
      composer: Array.isArray(metadata.common.composer) ? metadata.common.composer.join(', ') : metadata.common.composer || null,
      comment: Array.isArray(metadata.common.comment) ? metadata.common.comment.join('\n') : metadata.common.comment || null,
      bpm: metadata.common.bpm || null,
      musicalKey: metadata.common.key || null,
      isrc: Array.isArray(metadata.common.isrc) ? metadata.common.isrc.join(', ') : metadata.common.isrc || null,
      label: Array.isArray(metadata.common.label) ? metadata.common.label.join(', ') : metadata.common.label || null,
      copyright: metadata.common.copyright || null,
      artworkPath,
      duration: metadata.format.duration || null,
      sampleRate: metadata.format.sampleRate || null,
      bitDepth: metadata.format.bitsPerSample || null,
      bitrate: metadata.format.bitrate || null,
      channels: metadata.format.numberOfChannels || null,
      codec: metadata.format.codec || metadata.format.container || null,
      lossless: metadata.format.lossless ?? null,
      replayGainDb: Number.isFinite(replayGainDb) ? replayGainDb : null,
      metadataVersion: 1,
    };
  } catch {}
  try {
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    await handle.close();
    const data = buffer.subarray(0, bytesRead);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.flac' && data.toString('ascii', 0, 4) === 'fLaC') {
      const offset = 8;
      const packed = data.readBigUInt64BE(offset + 10);
      const sampleRate = Number((packed >> 44n) & 0xfffffn);
      const bitDepth = Number((packed >> 36n) & 0x1fn) + 1;
      const totalSamples = Number(packed & 0xfffffffffn);
      return { sampleRate, bitDepth, duration: sampleRate ? totalSamples / sampleRate : null };
    }
    if (['.wav', '.wave'].includes(ext) && data.toString('ascii', 0, 4) === 'RIFF') {
      let offset = 12;
      while (offset + 8 <= data.length) {
        const id = data.toString('ascii', offset, offset + 4);
        const size = data.readUInt32LE(offset + 4);
        if (id === 'fmt ' && offset + 8 + size <= data.length) {
          return { sampleRate: data.readUInt32LE(offset + 12), bitDepth: data.readUInt16LE(offset + 22) };
        }
        offset += 8 + size + (size % 2);
      }
    }
  } catch {}
  return {};
});

registerHandle('modules:open', () => moduleShop.open());
registerHandle('modules:request', (_event, request) => moduleShop.handle(request));

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (integrationTestMode && (!integrationTestScenario || !integrationUserDataPath || !integrationReportPath)) {
    console.error('Pixelody integration test launch is missing a valid scenario, isolated userData path, or report path.');
    app.exit(2);
    return;
  }
  if (integrationTestMode) {
    await appendIntegrationReport('main-ready', {
      packaged: app.isPackaged,
      scenarioAccepted: Boolean(integrationTestScenario),
      isolatedProfileAccepted: Boolean(integrationUserDataPath),
      reportAccepted: Boolean(integrationReportPath),
    });
  }
  Menu.setApplicationMenu(null);
  configureLocalMediaPermissions();
  durableStateStartupLoad = stateStore().loadSync();
  grantStatePaths(durableStateStartupLoad?.state?.values);
  await prepareDevelopmentSession();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('before-quit', () => {
  workspaceStartupWatchdog?.cancel();
  workspaceStartupWatchdog = null;
  if (personalServer) personalServer.stop().catch((error) => console.warn('Pixelody sharing server shutdown failed:', error));
});
let durableStateDrainStarted = false;
app.on('will-quit', (event) => {
  // Durable commits write asynchronously; let the closing window's final save
  // reach disk before exit. Bounded so a stuck disk cannot hang shutdown.
  if (durableStateDrainStarted || !durableStateStore?.hasPendingWrites()) return;
  durableStateDrainStarted = true;
  event.preventDefault();
  const deadline = new Promise((resolve) => setTimeout(resolve, DURABLE_STATE_DRAIN_TIMEOUT_MS));
  Promise.race([durableStateStore.whenIdle(), deadline]).finally(() => app.quit());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
