(function pixelodyJamControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyJamController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createJamControllerApi() {
  'use strict';
  const BLOCKED_NETWORK_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  function networkSafeJson(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(networkSafeJson);
    if (!value || typeof value !== 'object') return null;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !BLOCKED_NETWORK_KEYS.has(key))
      .map(([key, child]) => [key, networkSafeJson(child)]));
  }
  function preferredBaseUrl(status = {}) { return status.remoteBaseUrl || status.baseUrl || ''; }
  function baseUrlCandidates(status = {}) {
    const candidates = [status.remoteBaseUrl, status.baseUrl, ...(status.networkBaseUrls || []).map((entry) => entry?.baseUrl), status.localBaseUrl].filter(Boolean);
    return [...new Set(candidates.map((url) => String(url).trim().replace(/\/+$/, '')).filter(Boolean))];
  }
  function pairingExpired(pairing, now = Date.now()) { if (!pairing?.expiresAt) return false; const expiresAt = Date.parse(pairing.expiresAt); return Number.isFinite(expiresAt) && expiresAt <= now; }
  function activePairing(pairing, now = Date.now()) { return pairing && !pairingExpired(pairing, now) ? pairing : null; }
  function buildSnapshot(options = {}) {
    const state = options.state || {};
    const tracks = Array.isArray(state.tracks) ? state.tracks : [];
    const trackIds = new Set(tracks.map((track) => track.id));
    const optionalNumber = typeof options.optionalNumber === 'function' ? options.optionalNumber : (value) => Number.isFinite(Number(value)) ? Number(value) : null;
    const playback = options.playback || {};
    const currentTrack = options.currentTrack || null;
    return {
      version: 1,
      generatedAt: options.generatedAt || new Date().toISOString(),
      hostName: `Pixelody ${options.platform || 'host'}`,
      tracks: tracks.map((track) => ({
        id: track.id, title: track.title, artist: track.artist, albumArtist: track.albumArtist || '', album: track.album || '', genre: track.genre || '', year: track.year || null,
        trackNumber: track.trackNumber || null, discNumber: track.discNumber || null, composer: track.composer || '', comment: track.comment || '', bpm: track.bpm || null,
        isrc: track.isrc || '', label: track.label || '', copyright: track.copyright || '', duration: track.duration || null, format: track.format, codec: track.codec || track.format,
        lossless: track.lossless === true, sampleRate: track.sampleRate || null, bitDepth: track.bitDepth || null, bitrate: track.bitrate || null, channels: track.channels || null,
        replayGainDb: optionalNumber(track.replayGainDb), dateAdded: track.dateAdded || null, favorite: (state.favorites || []).includes(track.id), missing: track.missing === true,
        path: track.path, artworkPath: track.artworkPath || '',
      })),
      playlists: (state.playlists || []).map((playlist) => ({ id: playlist.id, name: playlist.name, trackIds: (playlist.id === 'all' ? tracks.map((track) => track.id) : playlist.trackIds || []).filter((id) => trackIds.has(id)), virtual: false })),
      favorites: (state.favorites || []).filter((id) => trackIds.has(id)),
      queue: (state.queue || []).filter((id) => trackIds.has(id)),
      playback: {
        currentTrackId: currentTrack?.id || null, paused: Boolean(playback.paused), playing: !playback.paused, currentTime: playback.currentTime || 0,
        positionSeconds: playback.currentTime || 0, duration: playback.duration || currentTrack?.duration || 0, durationSeconds: playback.duration || currentTrack?.duration || 0,
        positionUpdatedAt: options.positionUpdatedAt || new Date().toISOString(), estimatedStartedAt: !playback.paused && Number.isFinite(playback.currentTime) ? new Date((options.now || Date.now()) - (playback.currentTime || 0) * 1000).toISOString() : '',
        shuffle: Boolean(state.shuffle), repeat: state.repeat, volume: playback.volume,
      },
      flowShuffle: options.flowShuffleContract?.normalizeSnapshot ? options.flowShuffleContract.normalizeSnapshot({ ...state.flowShuffle, enabled: state.shuffle }) : undefined,
      audioProfiles: networkSafeJson(options.audioProfiles || {}),
    };
  }
  return Object.freeze({ activePairing, baseUrlCandidates, buildSnapshot, networkSafeJson, pairingExpired, preferredBaseUrl });
}));
