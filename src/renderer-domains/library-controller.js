(function pixelodyLibraryControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyLibraryController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLibraryControllerApi() {
  'use strict';

  const normalizeText = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

  function parseDuration(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value > 10000 ? value / 1000 : value;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+:\d{2}(:\d{2})?$/.test(text)) {
      const parts = text.split(':').map(Number);
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    }
    const number = Number(text.replace(/,/g, ''));
    return Number.isFinite(number) ? (number > 10000 ? number / 1000 : number) : null;
  }

  function parseCsv(text = '') {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') { cell += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (char !== '\r') cell += char;
    }
    row.push(cell);
    rows.push(row);
    return rows.filter((item) => item.some((value) => String(value).trim()));
  }

  function compactTrack(track = {}) {
    const title = String(track.title || track.name || track.track || track['track name'] || track.song || track['song name'] || '').trim();
    const artist = String(track.artist || track.artists || track.artistName || track['artist name'] || track['artist names'] || track['artist name s'] || '').trim();
    const album = String(track.album || track.albumName || track['album name'] || '').trim();
    const path = String(track.path || track.file || track.filePath || track.location || '').trim();
    const duration = parseDuration(track.duration ?? track.durationMs ?? track['duration ms'] ?? track.time);
    return title || artist || album || path ? { title, artist, album, path, duration, isrc: String(track.isrc || track.ISRC || '').trim(), sourceUrl: String(track.url || track.uri || track.href || '').trim() } : null;
  }

  function parseCsvPlaylist(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows[0].map((header) => normalizeText(header).replace(/\s+/g, ' '));
    const known = new Set(['title', 'track', 'track name', 'song', 'song name', 'artist', 'artists', 'artist name', 'artist names', 'artist name s', 'album', 'album name', 'duration', 'duration ms', 'isrc']);
    const dataRows = headers.filter((header) => known.has(header)).length >= 2
      ? rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])))
      : rows.map((row) => ({ title: row[0] || '', artist: row[1] || '', album: row[2] || '', duration: row[3] || '' }));
    return dataRows.map(compactTrack).filter(Boolean);
  }

  function flattenJsonTracks(value, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item) => flattenJsonTracks(item, depth + 1));
    if (typeof value !== 'object') return [];
    const track = value.track && typeof value.track === 'object' ? value.track : value;
    const artistNames = Array.isArray(track.artists) ? track.artists.map((artist) => artist.name || artist).filter(Boolean).join(', ') : track.artists;
    const compact = compactTrack({ ...track, artist: track.artist || artistNames, album: track.album?.name || track.album, durationMs: track.duration_ms || track.durationMs });
    const hasTrackShape = Boolean(value.track || track.title || track.track || track.song || track.artist || artistNames || track.album || track.duration || track.duration_ms || track.durationMs || track.isrc || track.uri || track.href);
    return compact && hasTrackShape ? [compact] : Object.values(value).flatMap((item) => flattenJsonTracks(item, depth + 1));
  }

  function resolveM3uPath(baseDirectory, entryPath) {
    if (!entryPath || !baseDirectory) return entryPath;
    if (/^[a-zA-Z]:[\\/]/.test(entryPath) || entryPath.startsWith('\\\\') || entryPath.startsWith('/')) return entryPath;
    const separator = baseDirectory.includes('\\') || /^[a-zA-Z]:/.test(baseDirectory) ? '\\' : '/';
    return `${baseDirectory.replace(/[\\/]+$/, '')}${separator}${entryPath.replace(/^\.?[\\/]+/, '')}`;
  }

  function parseM3uPlaylist(text, baseDirectory = '', nameOf = (value) => String(value || '').split(/[\\/]/).pop()) {
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const tracks = [];
    let extInfo = null;
    lines.forEach((line) => {
      if (line.startsWith('#EXTINF:')) {
        const rest = line.slice('#EXTINF:'.length);
        const comma = rest.indexOf(',');
        const label = comma >= 0 ? rest.slice(comma + 1).trim() : '';
        const [artist, title] = label.includes(' - ') ? label.split(' - ', 2).map((part) => part.trim()) : ['', label];
        extInfo = { title, artist, duration: parseDuration(comma >= 0 ? rest.slice(0, comma) : '') };
      } else if (!line.startsWith('#')) {
        const resolvedPath = resolveM3uPath(baseDirectory, line);
        tracks.push(compactTrack({ ...(extInfo || {}), path: resolvedPath, title: extInfo?.title || nameOf(line) }));
        extInfo = null;
      }
    });
    return tracks.filter(Boolean);
  }

  function parseImportFile(file, nameOf) {
    if (!file || file.error) throw new Error(file?.error || 'No playlist file selected.');
    if (file.extension === 'json') return flattenJsonTracks(JSON.parse(file.text));
    if (file.extension === 'm3u' || file.extension === 'm3u8') return parseM3uPlaylist(file.text, file.directory || '', nameOf);
    return parseCsvPlaylist(file.text);
  }

  function scoreImportedTrack(imported, track, nameOf = (value) => String(value || '').split(/[\\/]/).pop()) {
    const importedTitle = normalizeText(imported.title || nameOf(imported.path || ''));
    const trackTitle = normalizeText(track.title);
    if (!importedTitle || !trackTitle) return 0;
    let score = importedTitle === trackTitle ? 46 : (trackTitle.includes(importedTitle) || importedTitle.includes(trackTitle) ? 34 : 0);
    const pairs = [[imported.artist, track.artist, 30, 18], [imported.album, track.album, 12, 6]];
    pairs.forEach(([leftRaw, rightRaw, exact, partial]) => {
      const left = normalizeText(leftRaw); const right = normalizeText(rightRaw);
      if (left && right) score += left === right ? exact : (right.includes(left) || left.includes(right) ? partial : 0);
    });
    if (imported.duration && track.duration) {
      const difference = Math.abs(Number(imported.duration) - Number(track.duration));
      score += difference <= 2 ? 12 : difference <= 6 ? 6 : 0;
    }
    return score;
  }

  function matchImportedTrack(imported, tracks, nameOf) {
    const source = Array.isArray(tracks) ? tracks : [];
    const importedPath = String(imported.path || '').toLowerCase();
    const pathMatch = importedPath && source.find((track) => String(track.path || '').toLowerCase() === importedPath);
    if (pathMatch) return { status: 'matched', confidence: 100, track: pathMatch };
    const best = source.map((track) => ({ track, confidence: scoreImportedTrack(imported, track, nameOf) })).sort((left, right) => right.confidence - left.confidence)[0];
    if (!best || best.confidence < 62) return { status: 'missing', confidence: best?.confidence || 0, track: null };
    return { status: best.confidence >= 80 ? 'matched' : 'likely_match', confidence: best.confidence, track: best.track };
  }

  function uniquePlaylistName(baseName, playlists = []) {
    const rootName = String(baseName || '').trim() || 'Imported Playlist';
    const names = new Set((Array.isArray(playlists) ? playlists : []).map((playlist) => String(playlist.name || '').toLocaleLowerCase()));
    let name = rootName; let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${rootName} ${suffix++}`;
    return name;
  }

  return Object.freeze({ compactTrack, flattenJsonTracks, matchImportedTrack, normalizeText, parseCsv, parseCsvPlaylist, parseDuration, parseImportFile, parseM3uPlaylist, resolveM3uPath, scoreImportedTrack, uniquePlaylistName });
}));
