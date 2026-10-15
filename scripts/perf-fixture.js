// Deterministic generated library for performance measurement. Track records
// match the shape created by the renderer import path; paths are fictional.
function fixtureTrack(index, mediaRoot = 'C:\\Users\\listener\\Music') {
  const album = Math.floor(index / 12);
  const artist = `Artist ${album % 400}`;
  return {
    id: `fixture-${index.toString(36)}-${(index * 2654435761 >>> 0).toString(36)}`,
    path: `${mediaRoot}\\${artist}\\Album ${album}\\${String(index % 12 + 1).padStart(2, '0')} - Track Title Number ${index}.flac`,
    title: `Track Title Number ${index}`,
    artist,
    albumArtist: artist,
    album: `Album ${album}`,
    genre: ['Jazz', 'Electronic', 'Rock', 'Classical'][index % 4],
    userTags: [],
    moodTags: index % 7 ? [] : ['calm', 'late'],
    contextTags: [],
    energyLevel: index % 5 ? null : 60,
    listeningRole: '',
    year: 1990 + (index % 30),
    trackNumber: index % 12 + 1,
    discNumber: 1,
    composer: '',
    comment: '',
    bpm: null,
    isrc: '',
    label: 'Label',
    copyright: '',
    artworkPath: null,
    format: 'FLAC',
    codec: 'FLAC',
    lossless: true,
    sampleRate: 44100,
    bitDepth: 16,
    bitrate: 900000,
    channels: 2,
    replayGainDb: -6.5,
    duration: 245.3,
    metadataVersion: 3,
    dateAdded: 1700000000000 + index,
  };
}

function fixtureValues(trackCount, options = {}) {
  const tracks = Array.from({ length: trackCount }, (_, index) => fixtureTrack(index, options.mediaRoot));
  const ids = tracks.map((track) => track.id);
  return {
    'aurelia.library': tracks,
    'aurelia.playlists': [
      { id: 'all', name: 'All Music', trackIds: [], background: null },
      ...Array.from({ length: 20 }, (_, playlist) => ({ id: `fixture-playlist-${playlist}`, name: `Playlist ${playlist}`, trackIds: ids.filter((_, index) => index % (playlist + 3) === 0).slice(0, 400), background: null })),
    ],
    'aurelia.tunings': {},
    'aurelia.systems': {},
    'pixelody.favorites': ids.slice(0, 200),
    'pixelody.history': [],
    'pixelody.playCounts': Object.fromEntries(ids.slice(0, Math.floor(trackCount / 3)).map((id, index) => [id, index % 40])),
    'pixelody.queue': ids.slice(0, 500),
    'pixelody.session': { id: ids[0] || '', time: 0, volume: 0.2 },
    'pixelody.signalJournal': { events: [] },
    'pixelody.shuffle': false,
    'pixelody.volume': 0.2,
    'pixelody.repeat': 'off',
    'pixelody.sort': 'added-desc',
  };
}

module.exports = { fixtureTrack, fixtureValues };
