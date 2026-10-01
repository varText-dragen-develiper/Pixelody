const { contextBridge, ipcRenderer } = require('electron');

// The main process adds this renderer-only sentinel after its two independent launch gates succeed.
const integrationTestEnabled = process.argv.includes('--pixelody-preload-integration-test');
const runtimeSecurity = Object.freeze({
  windowKind: 'mini',
  sandboxed: process.sandboxed === true,
  contextIsolated: process.contextIsolated === true,
  mainFrame: process.isMainFrame !== false,
});

const desktopApi = {
  runtimeSecurity,
  closeMiniPlayer: () => ipcRenderer.send('mini:close'),
  restoreMainWindow: () => ipcRenderer.send('mini:restore-main'),
  sendMiniCommand: (command) => ipcRenderer.send('mini:command', command),
  onPlayerState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, playerState) => callback(playerState);
    ipcRenderer.on('player:state', listener);
    return () => ipcRenderer.removeListener('player:state', listener);
  },
};

if (integrationTestEnabled) {
  desktopApi.integrationTest = Object.freeze({
    enabled: true,
    getConfig: () => ipcRenderer.invoke('test:config'),
    report: (eventName, detail = {}) => ipcRenderer.invoke('test:report', eventName, detail),
  });
}

contextBridge.exposeInMainWorld('desktop', Object.freeze(desktopApi));
