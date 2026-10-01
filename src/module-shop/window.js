'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { MAX_BYTES, validRequest, parsePackage, allowedShopUrl } = require('./contract');
const { ModuleStore, WebModuleStore } = require('./store');
function createModuleShop({ app, BrowserWindow, dialog }) {
  let win = null; let webWin = null; let webSession = null;
  const documentUrl = pathToFileURL(path.join(__dirname, 'shop.html')).href;
  const store = () => new ModuleStore(path.join(app.getPath('userData'), 'modules'));
  const webStore = () => new WebModuleStore(path.join(app.getPath('userData'), 'modules'));
  const snapshot = () => ({ ...store().read(), shop: webStore().read() });
  function openWebShop() {
    const pkg = webStore().read();
    if (!pkg || pkg.kind !== 'web-shop') throw new Error('Import the free shop module first.');
    if (webWin && !webWin.isDestroyed()) { webWin.show(); webWin.focus(); return; }
    webWin = new BrowserWindow({ width: 1060, height: 800, minWidth: 420, minHeight: 500, title: 'Pixelody Optional shop', webPreferences: { partition: 'pixelody-optional-web-shop', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
    webWin.setMenu(null);
    const contents = webWin.webContents;
    if (webSession !== contents.session) {
      webSession = contents.session;
      webSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      webSession.setPermissionCheckHandler(() => false);
      webSession.on('will-download', (event, item) => {
        const urls = item.getURLChain();
        const safe = urls.length > 0 && urls.every(value => {
          if (!allowedShopUrl(value)) return false;
          const url = new URL(value);
          return /^\/modules\/[a-z0-9][a-z0-9.-]*\.pixelody-module$/.test(url.pathname) && !url.search && !url.hash;
        });
        if (!safe || !['application/octet-stream', 'application/json'].includes(item.getMimeType()) || item.getTotalBytes() > MAX_BYTES) { event.preventDefault(); return; }
        item.setSaveDialogOptions({ title: 'Save module, then import it from Modules', defaultPath: path.basename(new URL(urls[urls.length - 1]).pathname), filters: [{ name: 'Pixelody module', extensions: ['pixelody-module'] }] });
      });
    }
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event, url) => { if (!allowedShopUrl(url || event.url)) event.preventDefault(); };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.on('will-frame-navigate', guard);
    contents.on('will-attach-webview', event => event.preventDefault());
    webWin.on('closed', () => { webWin = null; });
    webWin.loadURL(pkg.entry);
  }
  function authorized(event) { return Boolean(win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === documentUrl); }
  function open() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return true; }
    win = new BrowserWindow({ width: 900, height: 760, minWidth: 420, minHeight: 500, title: 'Pixelody Modules', backgroundColor: '#f5f2e9', webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false } });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-frame-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.on('closed', () => { win = null; });
    win.loadFile(path.join(__dirname, 'shop.html'));
    return true;
  }
  async function handle(request) {
    if (!validRequest(request)) return { ok: false, error: 'Invalid module request.' };
    try {
      const storage = store(); let state;
      if (request.op === 'state') state = snapshot();
      if (request.op === 'open-shop') openWebShop();
      if (request.op === 'remove-shop') { if (webWin && !webWin.isDestroyed()) webWin.destroy(); webStore().remove(); if (webSession) await webSession.clearStorageData(); }
      if (request.op === 'remove') state = storage.remove();
      if (request.op === 'save') state = storage.save(request.text);
      if (request.op === 'import') {
        const selected = await dialog.showOpenDialog(win, { title: 'Install a Pixelody module', properties: ['openFile'], filters: [{ name: 'Pixelody module', extensions: ['pixelody-module'] }] });
        if (selected.canceled || !selected.filePaths[0]) return { ok: true, canceled: true };
        const file = selected.filePaths[0]; const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Choose a regular module file no larger than 8 KB.');
        const fd = fs.openSync(file, 'r'); const bytes = Buffer.alloc(MAX_BYTES + 1); let count;
        try { count = fs.readSync(fd, bytes, 0, bytes.length, 0); } finally { fs.closeSync(fd); }
        const data = bytes.subarray(0, count);
        const pkg = parsePackage(data, 'desktop');
        if (pkg.kind === 'web-shop') webStore().install(data); else storage.install(data);
      }
      return { ok: true, state: snapshot() };
    } catch (error) { return { ok: false, error: error.code ? 'The local file could not be read or saved. Existing notes were preserved.' : error.message }; }
  }
  return { open, authorized, handle };
}
module.exports = { createModuleShop };
