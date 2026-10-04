const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The main process adds this renderer-only sentinel after its two independent launch gates succeed.
const integrationTestEnabled = process.argv.includes('--pixelody-preload-integration-test');
const approvedPaths = new Set();

function pathKey(filePath) {
  if (typeof filePath !== 'string' || !filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function approvePath(filePath) {
  const key = pathKey(filePath);
  if (key) approvedPaths.add(key);
  return filePath;
}

function approvePaths(paths) {
  if (Array.isArray(paths)) paths.forEach(approvePath);
  return paths;
}

function approveStateValues(values) {
  if (!values || typeof values !== 'object') return;
  const tracks = Array.isArray(values['aurelia.library']) ? values['aurelia.library'] : [];
  for (const track of tracks) {
    approvePath(track?.path);
    approvePath(track?.artworkPath);
  }
  const playlists = Array.isArray(values['aurelia.playlists']) ? values['aurelia.playlists'] : [];
  playlists.forEach((playlist) => approvePath(playlist?.background));
  const backgrounds = values['pixelody.collectionBackgrounds'];
  if (backgrounds && typeof backgrounds === 'object') Object.values(backgrounds).forEach(approvePath);
  approvePath(values['pixelody.profileImage']);
}

function approveStateResult(result) {
  approveStateValues(result?.state?.values);
  return result;
}

function isApproved(filePath) {
  const key = pathKey(filePath);
  return Boolean(key && approvedPaths.has(key));
}

function toApprovedFileUrl(filePath) {
  if (!isApproved(filePath)) return '';
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    const [host, ...parts] = normalized.slice(2).split('/');
    return `file://${host}/${parts.map(encodeURIComponent).join('/')}`;
  }
  if (normalized.startsWith('/')) {
    const parts = normalized.slice(1).split('/');
    return `file:///${parts.map(encodeURIComponent).join('/')}`;
  }
  const [drive, ...parts] = normalized.split('/');
  return `file:///${drive}/${parts.map(encodeURIComponent).join('/')}`;
}

function plainJson(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

async function invokePaths(channel) {
  const result = await ipcRenderer.invoke(channel);
  return approvePaths(result);
}

async function invokePath(channel) {
  const result = await ipcRenderer.invoke(channel);
  return approvePath(result);
}

const runtimeSecurity = Object.freeze({
  windowKind: 'main',
  sandboxed: process.sandboxed === true,
  contextIsolated: process.contextIsolated === true,
  mainFrame: process.isMainFrame !== false,
  platform: process.platform,
});

const desktopApi = {
  openModuleShop: () => ipcRenderer.invoke('modules:open'),
  runtimeSecurity,
  chooseFiles: () => invokePaths('music:choose-files'),
  chooseFolder: async () => {
    const result = await ipcRenderer.invoke('music:choose-folder');
    return { paths: approvePaths(Array.isArray(result?.paths) ? result.paths : []), skippedFolders: Number(result?.skippedFolders) || 0 };
  },
  choosePlaylistFile: () => ipcRenderer.invoke('migration:choose-playlist-file'),
  chooseImage: () => invokePath('music:choose-image'),
  registerDroppedFiles: async (files) => {
    // The main-process contract rejects the whole request if any path is not
    // an audio file, so one stray image, playlist or folder in a drop used to
    // cancel the entire import. Filter here and let the renderer report it.
    const paths = Array.from(files || []).map((file) => webUtils.getPathForFile(file))
      .filter((filePath) => filePath && /\.(flac|wav|wave|aiff?|mp3|m4a|aac|ogg|opus)$/i.test(filePath))
      .slice(0, 10_000);
    const granted = await ipcRenderer.invoke('music:register-dropped-paths', paths);
    return approvePaths(granted);
  },
  cacheProfileImage: async (sourcePath) => {
    if (!isApproved(sourcePath)) return '';
    return approvePath(await ipcRenderer.invoke('app:cache-profile-image', sourcePath));
  },
  cacheTrackImage: async (sourcePath, trackId) => {
    if (!isApproved(sourcePath)) return '';
    return approvePath(await ipcRenderer.invoke('app:cache-track-image', sourcePath, trackId));
  },
  optimizeArtwork: async (sourcePath) => {
    if (!isApproved(sourcePath)) return '';
    return approvePath(await ipcRenderer.invoke('app:optimize-artwork', sourcePath));
  },
  scanDownloads: () => invokePaths('music:scan-downloads'),
  setTextScale: (factor) => ipcRenderer.invoke('app:set-text-scale', factor),
  verifyIntegrity: (entries) => ipcRenderer.invoke('music:verify-integrity', (Array.isArray(entries) ? entries : []).filter((entry) => entry && isApproved(entry.path)).map((entry) => ({ path: entry.path, ...(Number.isFinite(entry.size) ? { size: entry.size } : {}), ...(Number.isFinite(entry.mtimeMs) ? { mtimeMs: entry.mtimeMs } : {}) }))),
  exists: (filePath) => isApproved(filePath) ? ipcRenderer.invoke('music:exists', filePath) : Promise.resolve(false),
  musicBrainzSearch: (query) => ipcRenderer.invoke('metadata:musicbrainz-search', plainJson(query)),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  getRuntimeInfo: () => ipcRenderer.invoke('app:runtime-info'),
  onThemeEditionRequest: (callback) => {
    const listener = (_event, recipe) => { if (['cosmic-cinema', 'neon-burst'].includes(recipe)) callback(recipe); };
    ipcRenderer.on('theme:edition-request', listener);
    return () => ipcRenderer.removeListener('theme:edition-request', listener);
  },
  listThemePackages: () => ipcRenderer.invoke('theme:list-packages'),
  importThemePackage: () => ipcRenderer.invoke('theme:import-package'),
  deleteThemePackage: (identity) => ipcRenderer.invoke('theme:delete-package', plainJson(identity)),
  loadStateSnapshot: () => approveStateResult(ipcRenderer.sendSync('state:load-sync')),
  migrateLegacyState: async (values, malformedLegacyKeys = []) => {
    const result = await ipcRenderer.invoke('state:migrate-legacy', values, malformedLegacyKeys);
    if (result?.ok) approveStateValues(values);
    return approveStateResult(result);
  },
  saveStateSnapshot: (values, options = {}) => ipcRenderer.invoke('state:commit', values, options),
  importBackupToState: async (backup, normalizedOverrides = {}) => {
    const result = await ipcRenderer.invoke('state:import-backup-v1', backup, normalizedOverrides);
    if (result?.ok) approveStateValues(normalizedOverrides);
    return approveStateResult(result);
  },
  getStateStoreDiagnostics: () => ipcRenderer.invoke('state:diagnostics'),
  loadWorkspaceComposition: () => ipcRenderer.invoke('state:workspace-load'),
  saveWorkspaceComposition: (graph, options = {}) => ipcRenderer.invoke('state:workspace-commit', plainJson(graph), plainJson(options)),
  cancelWorkspaceComposition: (options = {}) => ipcRenderer.invoke('state:workspace-cancel', plainJson(options)),
  reportWorkspaceStartup: (action, detail = {}) => ipcRenderer.invoke('state:workspace-startup', action, plainJson(detail)),
  clearRuntimeCache: () => ipcRenderer.invoke('app:clear-runtime-cache'),
  getWasapiHelperStatus: () => ipcRenderer.invoke('app:wasapi-helper-status'),
  runWasapiDiagnostics: (request = {}) => ipcRenderer.invoke('app:wasapi-helper-diagnostics', request),
  runWasapiProbe: (request = {}) => ipcRenderer.invoke('app:wasapi-helper-probe', request),
  runWasapiLoopbackPrototype: (request = {}) => ipcRenderer.invoke('app:wasapi-helper-loopback-prototype', request),
  getNativeMixerStatus: () => ipcRenderer.invoke('app:native-mixer-status'),
  runNativeMixerClockDisciplineLab: (request = {}) => ipcRenderer.invoke('app:native-mixer-clock-discipline-lab', request),
  getSharingStatus: () => ipcRenderer.invoke('sharing:status'),
  updateSharingSnapshot: (snapshot) => ipcRenderer.invoke('sharing:update-snapshot', plainJson(snapshot)),
  startSharingHost: (snapshot, options = {}) => ipcRenderer.invoke('sharing:start', plainJson(snapshot), options),
  stopSharingHost: () => ipcRenderer.invoke('sharing:stop'),
  runSharingSelfTest: () => ipcRenderer.invoke('sharing:self-test'),
  createSharingDevice: (options = {}) => ipcRenderer.invoke('sharing:create-device', options),
  revokeSharingDevice: (deviceId) => ipcRenderer.invoke('sharing:revoke-device', deviceId),
  deleteSharingDevice: (deviceId) => ipcRenderer.invoke('sharing:delete-device', deviceId),
  updateSharingDevicePermissions: (deviceId, permissions, accessProfile) => accessProfile === undefined
    ? ipcRenderer.invoke('sharing:update-device-permissions', deviceId, permissions)
    : ipcRenderer.invoke('sharing:update-device-permissions', deviceId, permissions, accessProfile),
  refreshSharingDevices: (options = {}) => ipcRenderer.invoke('sharing:refresh-devices', options),
  startSharingPairing: (options = {}) => ipcRenderer.invoke('sharing:start-pairing', options),
  getJamSession: () => ipcRenderer.invoke('sharing:jam-session'),
  startJamSession: (options = {}) => ipcRenderer.invoke('sharing:start-jam-session', options),
  stopJamSession: () => ipcRenderer.invoke('sharing:stop-jam-session'),
  updateJamPolicy: (options = {}) => ipcRenderer.invoke('sharing:update-jam-policy', options),
  approveJamParticipant: (deviceId, options = {}) => ipcRenderer.invoke('sharing:approve-jam-participant', deviceId, options),
  removeJamParticipant: (deviceId) => ipcRenderer.invoke('sharing:remove-jam-participant', deviceId),
  exportBackup: (backup) => ipcRenderer.invoke('app:export-backup', backup),
  importBackup: () => ipcRenderer.invoke('app:import-backup'),
  importSignalReport: () => ipcRenderer.invoke('app:import-signal-report'),
  exportTuningProfiles: (profiles) => ipcRenderer.invoke('app:export-tuning-profiles', profiles),
  exportPlaylistM3u: (playlist) => ipcRenderer.invoke('playlist:export-m3u', playlist),
  importTuningProfiles: () => ipcRenderer.invoke('app:import-tuning-profiles'),
  addWatchedFolder: async (folderPath) => {
    const res = await ipcRenderer.invoke('library:add-watched-folder', folderPath);
    if (Array.isArray(res?.tracks)) approvePaths(res.tracks);
    return res;
  },
  removeWatchedFolder: (folderPath) => ipcRenderer.invoke('library:remove-watched-folder', folderPath),
  getWatchedFolders: () => ipcRenderer.invoke('library:get-watched-folders'),
  syncWatchedFolders: (folderPaths) => ipcRenderer.invoke('library:sync-watched-folders', folderPaths),
  rescanWatchedFolders: () => ipcRenderer.invoke('library:rescan-watched-folders'),
  onWatchedFolderChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, change) => {
      if (Array.isArray(change?.addedPaths)) approvePaths(change.addedPaths);
      callback(change);
    };
    ipcRenderer.on('library:folder-changed', listener);
    return () => ipcRenderer.removeListener('library:folder-changed', listener);
  },
  inspect: async (filePath) => {
    if (!isApproved(filePath)) return {};
    const metadata = await ipcRenderer.invoke('music:inspect', filePath);
    approvePath(metadata?.artworkPath);
    return metadata;
  },
  fileUrl: toApprovedFileUrl,
  openMiniPlayer: () => ipcRenderer.invoke('mini:open'),
  setBrandIcon: (logoColor, themeAccent = '') => ipcRenderer.invoke('app:set-brand-icon', String(logoColor || ''), String(themeAccent || '')),
  relaunchDevelopmentProfile: (profileId) => ipcRenderer.invoke('app:relaunch-development-profile', String(profileId || '')),
  sendPlayerState: (playerState) => ipcRenderer.send('player:state', playerState),
  onPlayerCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('player:command', listener);
    return () => ipcRenderer.removeListener('player:command', listener);
  },
  onSharingRemoteCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('sharing:remote-command', listener);
    return () => ipcRenderer.removeListener('sharing:remote-command', listener);
  },
};

if (integrationTestEnabled) {
  desktopApi.integrationTest = Object.freeze({
    enabled: true,
    getConfig: () => ipcRenderer.invoke('test:config'),
    getStatus: () => ipcRenderer.invoke('test:status'),
    report: (eventName, detail = {}) => ipcRenderer.invoke('test:report', eventName, detail),
    action: (action, detail) => detail === undefined
      ? ipcRenderer.invoke('test:action', action)
      : ipcRenderer.invoke('test:action', action, plainJson(detail)),
    verifySharingPrivacy: (snapshot) => ipcRenderer.invoke('test:verify-sharing-privacy', plainJson(snapshot)),
    captureFailure: (label) => ipcRenderer.invoke('test:capture-failure', label),
    finish: (result = {}) => ipcRenderer.invoke('test:finish', result),
  });
}

contextBridge.exposeInMainWorld('desktop', Object.freeze(desktopApi));
