'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pngIconResource, syncInstalledShortcutIcons } = require('./windows-taskbar-icon');

// A separate immutable resource per frame prevents Shell reuse of old decoded pixels.
// No renderer-supplied image or filesystem path crosses this boundary.
function createWindowsTaskbarFrameSession({ app, shell, identity, profileDirectory = '', windows, refresh, platform = process.platform }) {
  let directory = '';
  const files = [];
  async function publish(image, index, count) {
    if (platform !== 'win32') return;
    if (!Number.isInteger(index) || !Number.isInteger(count) || count < 2 || count > 18 || index < 1 || index >= count) throw new Error('Invalid taskbar frame index.');
    if (!directory) {
      const root = path.join(app.getPath('userData'), 'brand-icons');
      fs.mkdirSync(root, { recursive: true });
      directory = fs.mkdtempSync(path.join(root, 'motion-'));
    }
    const file = path.join(directory, `${index}.ico`);
    if (files.includes(file)) throw new Error('Taskbar frame resource must be immutable.');
    fs.writeFileSync(file, pngIconResource(image.resize({ width: 256, height: 256 }).toPNG()), { flag: 'wx' });
    files.push(file);
    const shortcuts = new Set();
    syncInstalledShortcutIcons({ app, shell, identity, file, profileDirectory, onMatch: shortcut => shortcuts.add(shortcut) });
    for (const win of windows()) {
      if (!win || win.isDestroyed()) continue;
      win.setAppDetails({ appIconPath: file, appIconIndex: 0 });
      // Keep the established window identity fixed throughout the transition.
      // Per-frame ID assignment adds no visible benefit in the installed app.
    }
    await refresh({ app, shortcuts: [...shortcuts], animationFrame: true });
  }
  // Call only after a successful synchronous final-color refresh. If the app quits
  // or final publication fails, retain the files still referenced by its shortcuts.
  function dispose() {
    if (!directory) return;
    for (const file of files) {
      if (path.dirname(file) !== directory) throw new Error('Invalid taskbar frame cleanup path.');
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') return; }
    }
    try { fs.rmdirSync(directory); } catch (error) { if (error.code !== 'ENOENT') return; }
    directory = '';
  }
  return { publish, dispose };
}

module.exports = { createWindowsTaskbarFrameSession };
