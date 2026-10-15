const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { buildM3u8, playlistEntryLocation, sanitizePlaylistFileName } = require('../src/playlist-export');
const library = require('../src/renderer-domains/library-controller');

// Pixelody runs on Windows, so exercise Windows path rules on any host.
const win = path.win32;
const target = 'C:\\Users\\me\\Music\\Road Trip.m3u8';

assert.equal(playlistEntryLocation('C:\\Users\\me\\Music\\Artist\\Album\\01.flac', target, win), 'Artist\\Album\\01.flac', 'tracks under the playlist folder are written relative');
assert.equal(playlistEntryLocation('C:\\Users\\me\\Downloads\\x.mp3', target, win), 'C:\\Users\\me\\Downloads\\x.mp3', 'tracks outside the playlist folder stay absolute rather than using ".."');
assert.equal(playlistEntryLocation('D:\\Music\\x.flac', target, win), 'D:\\Music\\x.flac', 'tracks on another drive stay absolute');
assert.equal(playlistEntryLocation('\\\\nas\\share\\x.flac', target, win), '\\\\nas\\share\\x.flac', 'network paths stay absolute');

const entries = [
  { path: 'C:\\Users\\me\\Music\\Artist\\Album\\01 Opening.flac', title: 'Opening', artist: 'Fixture Ensemble', duration: 212.6 },
  { path: 'D:\\Archive\\Closing.mp3', title: 'Closing\r\n#EXTINF:0,Injected', artist: '', duration: null },
  { path: 'C:\\Users\\me\\Music\\Loose.wav', title: '', artist: 'Solo', duration: 0 },
];
const text = buildM3u8(entries, target, win);
assert.equal(text, [
  '#EXTM3U',
  '#EXTINF:213,Fixture Ensemble - Opening',
  'Artist\\Album\\01 Opening.flac',
  '#EXTINF:-1,Closing #EXTINF:0,Injected',
  'D:\\Archive\\Closing.mp3',
  '#EXTINF:-1,Solo',
  'Loose.wav',
  '',
].join('\r\n'), 'M3U8 output is extended M3U with one EXTINF per entry and no injected lines');

// Round trip through Pixelody's own importer: every exported track matches
// its library record exactly by path, in the exported order.
const libraryTracks = entries.map((entry, index) => ({ id: `t${index}`, path: entry.path, title: entry.title.split('\r')[0] || 'Untitled', artist: entry.artist || 'Unknown', duration: entry.duration }));
const imported = library.parseM3uPlaylist(text, win.dirname(target));
assert.equal(imported.length, entries.length, 'the importer reads back every exported entry');
imported.forEach((item, index) => {
  const match = library.matchImportedTrack(item, libraryTracks);
  assert.equal(match.status, 'matched', `entry ${index} must re-import as an exact match`);
  assert.equal(match.confidence, 100, `entry ${index} must match by path`);
  assert.equal(match.track.id, `t${index}`, `entry ${index} must keep its order`);
});

assert.equal(sanitizePlaylistFileName('Road: Trip / 2026?'), 'Road Trip 2026');
assert.equal(sanitizePlaylistFileName('  ...  '), 'Playlist');
assert.equal(sanitizePlaylistFileName('CON'), 'CON_', 'reserved Windows device names are not usable file names');
assert.equal(sanitizePlaylistFileName('trailing dots...'), 'trailing dots');
assert.equal(sanitizePlaylistFileName('x'.repeat(300)).length, 120);

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const handler = main.match(/registerHandle\('playlist:export-m3u'[\s\S]*?\n\}\);/);
assert.ok(handler, 'playlist export handler is missing');
assert.match(handler[0], /entries\.every\(\(entry\) => isGrantedPath\(entry\.path, 'media'\)\)/, 'export must refuse paths the main process has not granted');
assert.match(handler[0], /showSaveDialog/, 'the user must choose the export file');

console.log('Playlist export audit passed: M3U8 output is well-formed, injection-safe, portable where it can be, and re-imports as exact matches.');
