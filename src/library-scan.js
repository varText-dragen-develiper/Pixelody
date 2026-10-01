const path = require('path');
const fs = require('fs/promises');

// Recursive audio-folder scan for library imports. A protected, offline, or
// vanished folder is skipped and counted instead of rejecting the whole scan,
// so one unreadable subfolder never discards everything already found.
async function scanAudioFolder(root, { extensions, maxFiles, readdir = fs.readdir } = {}) {
  const found = [];
  let skippedFolders = 0;
  async function walk(directory) {
    if (found.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { skippedFolders += 1; return; }
    for (const entry of entries) {
      if (found.length >= maxFiles) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) found.push(fullPath);
    }
  }
  await walk(root);
  return { paths: found, skippedFolders };
}

module.exports = { scanAudioFolder };
