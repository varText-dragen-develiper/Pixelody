'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const shortcutMatchCache = new Map();

function taskbarIdentityForProfile(identity, profileDirectory = '') {
  if (!profileDirectory) return identity.appUserModelId;
  const suffix = crypto.createHash('sha256').update(path.resolve(profileDirectory).toLowerCase()).digest('hex').slice(0, 12);
  return `${identity.appUserModelId}.preview.${suffix}`;
}

// Windows' taskbar relaunch icon needs a real ICO file outside the ASAR. Wrap
// the generated mark's PNG bytes without changing its geometry or pixels.
function pngIconResource(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  // Zero dimensions represent the 256px image used by this ICO entry.
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

function syncInstalledShortcutIcons({ app, shell, identity, file, profileDirectory = '', onMatch = () => {} }) {
  if (!app.isPackaged) return [];
  const appId = taskbarIdentityForProfile(identity, profileDirectory);
  const candidates = [];
  const collect = (kind, directory, depth = 0) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) candidates.push([kind, filePath]);
      else if (entry.isDirectory() && depth > 0) collect(kind, filePath, depth - 1);
    }
  };
  collect('desktop', app.getPath('desktop'));
  collect('start-menu', path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 3);
  const pinned = path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned');
  collect('taskbar', path.join(pinned, 'TaskBar'));
  collect('implicit', path.join(pinned, 'ImplicitAppShortcuts'), 3);
  // Resolving every unrelated .lnk through COM on every color change stalls
  // the UI. Discover paths cheaply, then revalidate only this app's matches.
  // New/renamed links and edits to foreign links invalidate discovery.
  const cacheKey = `${process.execPath}:${app.getPath('userData')}:${appId}`;
  const cached = shortcutMatchCache.get(cacheKey);
  const signatureFor = matches => candidates.map(([, shortcut]) => {
    if (matches.has(shortcut)) return shortcut;
    try { return `${shortcut}:${fs.statSync(shortcut).mtimeMs}`; } catch { return `${shortcut}:missing`; }
  }).join('\0');
  const priorMatches = new Set((cached?.matches || []).map(([, shortcut]) => shortcut));
  const reuse = cached && Date.now() - cached.scannedAt < 30000 && cached.signature === signatureFor(priorMatches);
  const inspected = reuse ? cached.matches : candidates;
  const matched = [];
  const updated = [];
  const failures = [];
  for (const [kind, shortcut] of inspected) {
    if (!fs.existsSync(shortcut)) continue;
    let matchesInstallation = false;
    try {
      const details = shell.readShortcutLink(shortcut);
      if (path.resolve(details.target).toLowerCase() !== path.resolve(process.execPath).toLowerCase()) continue;
      const args = (details.args || '').trim().toLowerCase();
      if (profileDirectory) {
        const value = profileDirectory.toLowerCase();
        if (![ `--pixelody-profile-directory="${value}"`, `"--pixelody-profile-directory=${value}"`, `--pixelody-profile-directory=${value}` ].includes(args)) continue;
        if (details.appUserModelId && ![identity.appUserModelId, appId].includes(details.appUserModelId)) continue;
      } else if (details.appUserModelId !== appId || args) continue;
      matchesInstallation = true;
      matched.push([kind, shortcut]);
      onMatch(shortcut);
      if (details.icon === file && details.iconIndex === 0 && details.appUserModelId === appId) continue;
      const backupDirectory = path.join(app.getPath('userData'), 'brand-icons', 'shortcut-backups');
      fs.mkdirSync(backupDirectory, { recursive: true });
      const conventionalName = path.basename(shortcut).toLowerCase() === `${identity.productName.toLowerCase()}.lnk` && kind !== 'implicit';
      const linkKey = profileDirectory || !conventionalName ? `-${crypto.createHash('sha256').update(shortcut).digest('hex').slice(0, 12)}` : '';
      const backup = path.join(backupDirectory, `${kind}${linkKey}.lnk`);
      if (!fs.existsSync(backup)) fs.copyFileSync(shortcut, backup, fs.constants.COPYFILE_EXCL);
      // Preserve launch targets/arguments. Each color has a distinct resource
      // path so the Shell does not reuse another color's cached image.
      const update = { icon: file, iconIndex: 0 };
      if (profileDirectory && details.appUserModelId !== appId) update.appUserModelId = appId;
      if (!shell.writeShortcutLink(shortcut, 'update', update)) {
        throw new Error('Shortcut icon update failed.');
      }
      updated.push(shortcut);
    } catch (error) {
      if (matchesInstallation) failures.push(error);
      console.warn(`Pixelody ${kind} icon update failed:`, error.message);
    }
  }
  shortcutMatchCache.set(cacheKey, { matches: matched, signature: signatureFor(new Set(matched.map(([, shortcut]) => shortcut))), scannedAt: reuse ? cached.scannedAt : Date.now() });
  if (failures.length) throw new AggregateError(failures, 'Pixelody shortcut icon update failed.');
  return updated;
}

function applyWindowsTaskbarIcon({ win, image, app, identity, color, profileDirectory = '', shell, onShortcut = () => {} }) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid taskbar logo color.');
  const directory = path.join(app.getPath('userData'), 'brand-icons');
  const file = path.join(directory, `logo-${color.slice(1).toLowerCase()}.ico`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, pngIconResource(image.resize({ width: 256, height: 256 }).toPNG()));
  }
  const quote = value => `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  const command = [quote(process.execPath)];
  if (!app.isPackaged) command.push(quote(app.getAppPath()));
  if (profileDirectory) command.push(quote(`--pixelody-profile-directory=${profileDirectory}`));
  if (app.isPackaged) syncInstalledShortcutIcons({ app, shell: shell || require('electron').shell, identity, file, profileDirectory, onMatch: onShortcut });
  // Setting AppUserModel.ID triggers the taskbar refresh. Microsoft requires
  // relaunch/icon properties to precede it. Electron sets ID first when both
  // are passed in one call, so deliberately publish them in separate calls.
  win.setAppDetails({
    appIconPath: file,
    appIconIndex: 0,
    relaunchCommand: command.join(' '),
    relaunchDisplayName: identity.productName,
  });
  win.setAppDetails({ appId: taskbarIdentityForProfile(identity, profileDirectory) });
  return file;
}

module.exports = { pngIconResource, taskbarIdentityForProfile, syncInstalledShortcutIcons, applyWindowsTaskbarIcon };
