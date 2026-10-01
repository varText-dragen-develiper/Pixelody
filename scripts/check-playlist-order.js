const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const stateStore = fs.readFileSync(path.join(root, 'src', 'state-store.js'), 'utf8');
function extract(pattern, label) {
  const match = renderer.match(pattern);
  assert.ok(match, `renderer.js no longer defines ${label}`);
  return match[0];
}

// Playlists and albums show their natural order, keep their own sort choice,
// and user playlists can be reordered relative to the visible neighbours.
assert.match(html, /<option value="playlist-order" hidden disabled>Playlist order<\/option>/, 'sort control must offer playlist order');
assert.match(html, /data-track-action="move-up" class="hidden"/, 'track menu must offer Move up');
assert.match(html, /data-track-action="move-down" class="hidden"/, 'track menu must offer Move down');
for (const key of ['pixelody.playlistSort', 'pixelody.albumSort']) {
  assert.ok(stateStore.includes(`'${key}'`), `durable store must accept ${key}`);
  assert.ok(renderer.includes(`'${key}': state.`), `renderer must persist ${key}`);
}
assert.match(renderer, /function renderTracks\(options = \{\}\) \{\s*syncSortControl\(\);/, 'every render must sync the sort control to the active collection');
assert.match(renderer, /\$\('#sortSelect'\)\.onchange = \(event\) => \{ setActiveSort\(event\.target\.value\);/, 'the sort control must write the active collection\'s sort');
assert.match(renderer, /document\.addEventListener\('keydown', \(event\) => \{\s*if \(!event\.altKey[\s\S]*?moveTrackInPlaylist\([\s\S]*?\}, true\);/, 'Alt+Up/Down reorder must run in the capture phase');

const source = [
  'playlistTrackIds', 'isAlbumCollection', 'isUserPlaylist', 'isOrderedCollection', 'activeSortKey', 'setActiveSort',
  'collectionOrderComparator', 'visibleTracks', 'playlistReorderEnabled', 'moveTrackInPlaylist',
].map((name) => extract(new RegExp(`function ${name}\\((?:[^()]|\\(\\))*\\) \\{[\\s\\S]*?\\n\\}`), name)).join('\n');
const track = (id, extra = {}) => ({ id, title: id.toUpperCase(), artist: 'A', album: 'Alb', dateAdded: extra.dateAdded || 0, ...extra });
const context = {
  search: '',
  persisted: 0,
  state: {
    activePlaylistId: 'road',
    shuffle: false,
    sort: 'added-desc',
    playlistSort: 'playlist-order',
    albumSort: 'playlist-order',
    filter: 'all',
    playCounts: {},
    tracks: [
      track('a', { dateAdded: 1, trackNumber: 3 }),
      track('b', { dateAdded: 4, trackNumber: 1 }),
      track('c', { dateAdded: 3, trackNumber: 2, discNumber: 1 }),
      track('d', { dateAdded: 2, trackNumber: 1, discNumber: 2, lossless: true }),
    ],
    playlists: [{ id: 'all', name: 'All Music', trackIds: [] }, { id: 'road', name: 'Road', trackIds: ['c', 'a', 'd', 'b'] }],
  },
  isLossless: (item) => Boolean(item.lossless),
  isHiRes: () => false,
  persist() { context.persisted += 1; },
  renderTracks() {},
};
context.$ = () => ({ value: context.search });
context.activePlaylist = () => {
  const id = context.state.activePlaylistId;
  if (id === 'daily') return { id, name: 'Daily', trackIds: ['d', 'a'], dailyMix: true, virtual: true };
  if (id.startsWith('album:')) return { id, name: 'Alb', trackIds: context.state.tracks.map((item) => item.id), virtual: true, collectionType: 'Album' };
  return context.state.playlists.find((item) => item.id === id) || context.state.playlists[0];
};
context.playlistTracks = () => {
  const playlist = context.activePlaylist();
  if (playlist.id === 'all') return context.state.tracks.slice();
  if (playlist.dailyMix) return playlist.trackIds.map((id) => context.state.tracks.find((item) => item.id === id));
  const ids = new Set(context.playlistTrackIds(playlist));
  return context.state.tracks.filter((item) => ids.has(item.id));
};
vm.createContext(context);
vm.runInContext(`${source}; ${['playlistTrackIds', 'activeSortKey', 'setActiveSort', 'visibleTracks', 'moveTrackInPlaylist', 'playlistReorderEnabled', 'isOrderedCollection'].map((name) => `this.${name} = ${name};`).join(' ')}`, context);
const order = () => context.visibleTracks().map((item) => item.id).join('');
const show = (id) => { context.state.activePlaylistId = id; };

assert.equal(order(), 'cadb', 'a user playlist shows its saved order by default');
show('album:Alb');
assert.equal(order(), 'bcad', 'an album shows disc then track order, and a missing disc number counts as disc 1');
show('all');
assert.equal(context.activeSortKey(), 'added-desc');
assert.equal(context.isOrderedCollection(), false, 'the library offers no playlist order');
assert.equal(order(), 'bcda', 'the library keeps its own sort');
context.setActiveSort('title-asc');
assert.equal(context.state.sort, 'title-asc');
assert.equal(context.state.playlistSort, 'playlist-order', 'changing the library sort leaves playlists in their order');
context.setActiveSort('playlist-order');
assert.equal(context.state.sort, 'title-asc', 'playlist order is never applied to the library');
show('daily');
assert.equal(context.isOrderedCollection(), false, 'a daily mix is not offered playlist order');
assert.equal(order(), 'da', 'a daily mix keeps the order it was curated in');
assert.equal(context.playlistReorderEnabled(), false, 'a daily mix is not reorderable');
show('road');
assert.equal(context.playlistReorderEnabled(), true);

assert.equal(context.moveTrackInPlaylist('a', -1), true);
assert.deepEqual([...context.state.playlists[1].trackIds], ['a', 'c', 'd', 'b'], 'Move up swaps with the previous track');
assert.equal(context.persisted, 1, 'a move is persisted');
assert.equal(context.moveTrackInPlaylist('a', -1), false, 'the first track cannot move up');
assert.equal(context.moveTrackInPlaylist('b', 1), false, 'the last track cannot move down');
context.state.shuffle = true;
assert.equal(context.playlistReorderEnabled(), false, 'reordering is off while shuffle lays out the rows');
assert.equal(context.moveTrackInPlaylist('c', 1), false);
context.state.shuffle = false;
context.state.filter = 'lossless';
context.state.playlists[1].trackIds = ['a', 'd', 'c', 'b'];
context.state.tracks.find((item) => item.id === 'b').lossless = true;
assert.equal(order(), 'db', 'filtered view shows only lossless tracks');
assert.equal(context.moveTrackInPlaylist('b', -1), true);
assert.deepEqual([...context.state.playlists[1].trackIds], ['a', 'b', 'd', 'c'], 'a filtered move lands next to the visible neighbour');
context.state.filter = 'all';
context.setActiveSort('title-asc');
assert.equal(context.playlistReorderEnabled(), false, 'reordering is off when the playlist is shown in another sort');
assert.equal(context.moveTrackInPlaylist('a', 1), false);
show('album:Alb');
assert.equal(context.activeSortKey(), 'playlist-order', 'sorting a playlist by title leaves albums in track order');
assert.equal(context.playlistReorderEnabled(), false, 'albums keep their track order and are not reorderable');
context.setActiveSort('plays-desc');
assert.equal(context.state.albumSort, 'plays-desc');
assert.equal(context.state.playlistSort, 'title-asc', 'album and playlist sorts are remembered separately');

// The playing track's menu also opens from the now-playing surfaces.
assert.match(renderer, /\['#nowPlayingSummary', '#heroTrackInfo'\]\.forEach\(\(selector\) => \{[\s\S]*?addEventListener\('contextmenu', showCurrentTrackMenu\)[\s\S]*?event\.key === 'F10' && event\.shiftKey/, 'now-playing surfaces must open the playing track menu by right-click and Shift+F10');

console.log('Playlist order audit passed: playlists and albums show their own order and keep their own sort, daily mixes keep theirs, and user playlists reorder relative to the visible neighbours.');
