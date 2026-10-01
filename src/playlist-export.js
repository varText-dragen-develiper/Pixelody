const path = require('path');

// Playlist export as extended M3U (UTF-8 .m3u8). Paths inside the playlist's
// own folder are written relative, so a playlist saved at the music root
// travels with the library. Anything else stays absolute, because the
// importer (library-controller resolveM3uPath) joins relative entries without
// collapsing "..", and an absolute path always round-trips to an exact match.

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizePlaylistFileName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();
  if (!cleaned) return 'Playlist';
  return WINDOWS_RESERVED_NAMES.test(cleaned) ? `${cleaned}_` : cleaned;
}

function singleLine(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function playlistEntryLocation(entryPath, targetPath, pathApi = path) {
  const relative = pathApi.relative(pathApi.dirname(targetPath), entryPath);
  const inside = relative && !pathApi.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..');
  return inside ? relative : entryPath;
}

function buildM3u8(entries, targetPath, pathApi = path) {
  const lines = ['#EXTM3U'];
  for (const entry of entries) {
    const seconds = Number.isFinite(entry.duration) && entry.duration > 0 ? Math.round(entry.duration) : -1;
    const label = [singleLine(entry.artist), singleLine(entry.title)].filter(Boolean).join(' - ');
    lines.push(`#EXTINF:${seconds},${label}`);
    lines.push(playlistEntryLocation(entry.path, targetPath, pathApi));
  }
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { buildM3u8, playlistEntryLocation, sanitizePlaylistFileName };
