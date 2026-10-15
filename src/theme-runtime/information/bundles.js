(function pixelodyInformationBundlesFactory(root, factory) {
  const registry = (typeof module === 'object' && module.exports)
    ? require('./registry')
    : root && root.PixelodyInformationRegistry;
  const api = factory(registry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyInformationBundles = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInformationBundlesApi(registry) {
  'use strict';

  if (!registry) throw new Error('PixelodyInformationBundles requires PixelodyInformationRegistry first.');

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  function trackSummary(track) {
    if (!track) return null;
    return freeze({
      id: String(track.id || ''),
      title: String(track.title || 'Untitled track'),
      artist: String(track.artist || 'Unknown artist'),
      album: String(track.album || ''),
      format: String(track.format || 'LOCAL').toUpperCase(),
      duration: Number(track.duration) || 0,
      sampleRate: Number(track.sampleRate) || 0,
      bitDepth: Number(track.bitDepth) || 0,
      hasArtwork: Boolean(track.artworkPath),
    });
  }

  const standardBundles = Object.freeze([
    {
      key: 'collection.summary',
      owner: 'library state',
      description: 'Truthful active-collection identity and counts.',
      project(snapshot = {}) {
        const collection = snapshot.collection || {};
        const tracks = Array.isArray(snapshot.tracks?.collection) ? snapshot.tracks.collection : [];
        return freeze({
          id: String(collection.id || ''),
          name: String(collection.name || 'All Music'),
          type: String(collection.type || 'Playlist'),
          description: String(collection.description || ''),
          trackCount: tracks.length,
        });
      },
    },
    {
      key: 'playback.neighborhood',
      owner: 'playback state',
      description: 'Current, previous, and next track around host-confirmed playback.',
      project(snapshot = {}) {
        const display = Array.isArray(snapshot.tracks?.display) ? snapshot.tracks.display : [];
        const all = Array.isArray(snapshot.tracks?.all) ? snapshot.tracks.all : [];
        const currentId = snapshot.playback?.currentId == null ? null : String(snapshot.playback.currentId);
        let ordered = display;
        let currentIndex = currentId ? ordered.findIndex((track) => String(track.id) === currentId) : -1;
        if (currentId && currentIndex < 0) {
          ordered = all;
          currentIndex = ordered.findIndex((track) => String(track.id) === currentId);
        }
        const phase = currentIndex < 0 ? 'idle' : snapshot.playback?.phase === 'playing' ? 'playing' : 'paused';
        return freeze({
          previous: trackSummary(currentIndex > 0 ? ordered[currentIndex - 1] : null),
          current: trackSummary(currentIndex >= 0 ? ordered[currentIndex] : null),
          next: trackSummary(currentIndex >= 0 && currentIndex < ordered.length - 1 ? ordered[currentIndex + 1] : null),
          currentIndex,
          total: ordered.length,
          phase,
        });
      },
    },
    {
      key: 'playback.technical',
      owner: 'media metadata and playback state',
      description: 'Literal format, depth, rate, duration, and playback phase.',
      project(snapshot = {}) {
        const all = Array.isArray(snapshot.tracks?.all) ? snapshot.tracks.all : [];
        const currentId = snapshot.playback?.currentId == null ? null : String(snapshot.playback.currentId);
        const track = currentId ? all.find((item) => String(item.id) === currentId) : null;
        return freeze({ track: trackSummary(track), phase: track ? (snapshot.playback?.phase === 'playing' ? 'playing' : 'paused') : 'idle' });
      },
    },
    {
      key: 'output.route',
      owner: 'audio output state',
      description: 'Current effective output label without device-control ownership.',
      project(snapshot = {}) {
        return freeze({ label: String(snapshot.output?.label || 'System Default'), active: Boolean(snapshot.output?.active) });
      },
    },
    {
      key: 'queue.summary',
      owner: 'queue state',
      description: 'Queue size only; queue mutation remains host-owned.',
      project(snapshot = {}) {
        const items = Array.isArray(snapshot.queue?.items) ? snapshot.queue.items : [];
        return freeze({ count: items.length });
      },
    },
    {
      key: 'artwork.summary',
      owner: 'library metadata',
      description: 'Artwork availability for the active collection.',
      project(snapshot = {}) {
        const tracks = Array.isArray(snapshot.tracks?.collection) ? snapshot.tracks.collection : [];
        return freeze({ total: tracks.length, missing: tracks.filter((track) => !track.artworkPath).length });
      },
    },
  ]);

  function registerStandardBundles() {
    standardBundles.forEach((bundle) => { if (!registry.hasBundle(bundle.key)) registry.registerBundle(bundle); });
    return standardBundles.length;
  }

  registerStandardBundles();

  return Object.freeze({ standardBundles, registerStandardBundles, trackSummary });
}));
