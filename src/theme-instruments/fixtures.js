(function pixelodyThemeInstrumentFixturesFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyThemeInstrumentFixtures = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFixtureApi() {
  'use strict';

  const TRACKS = Object.freeze([
    Object.freeze({ id: 'track-aurora', title: 'Aurora Relay', artist: 'Mara Venn', album: 'Night Transit', duration: 264, quality: '24 / 96', format: 'FLAC' }),
    Object.freeze({ id: 'track-static', title: 'Static Orchard', artist: 'The Paper Rooms', album: 'Weather Index', duration: 218, quality: '16 / 44.1', format: 'ALAC' }),
    Object.freeze({ id: 'track-tidal', title: 'Tidal Memory', artist: 'Orison Field', album: 'Glass Coordinates', duration: 307, quality: '24 / 192', format: 'FLAC' }),
  ]);

  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, Number(value) || 0)); }
  function createFixtureState(overrides = {}) {
    return {
      tracks: TRACKS,
      trackIndex: 0,
      playback: { phase: 'playing', position: 102, duration: TRACKS[0].duration, pending: false, error: '' },
      modes: { shuffle: false, repeat: 'off' },
      output: { label: 'Studio DAC / USB', active: true },
      queue: { count: 7, manual: 3, flow: 4 },
      collection: { id: 'collection-night', name: 'Night Transit Archive', count: 48 },
      cabinetOpen: false,
      feedback: { state: 'ready', message: 'Local library is ready.', action: 'No action needed.' },
      ...overrides,
    };
  }

  function currentTrack(state) { return state.tracks[state.trackIndex] || state.tracks[0]; }
  function withTrack(state, index) {
    const trackIndex = (index + state.tracks.length) % state.tracks.length;
    const track = state.tracks[trackIndex];
    return { ...state, trackIndex, playback: { ...state.playback, position: 0, duration: track.duration, phase: 'playing', pending: false, error: '' } };
  }
  function reduceFixture(state, action = {}) {
    switch (action.type) {
      case 'TOGGLE_PLAY': return { ...state, playback: { ...state.playback, phase: state.playback.phase === 'playing' ? 'paused' : 'playing', pending: false, error: '' } };
      case 'SET_PHASE': return { ...state, playback: { ...state.playback, phase: action.phase || 'stopped', pending: action.phase === 'pending', error: action.phase === 'failed' ? 'File is unavailable.' : '' } };
      case 'SEEK': return { ...state, playback: { ...state.playback, position: clamp(action.position, 0, state.playback.duration) } };
      case 'NEXT_TRACK': return withTrack(state, state.trackIndex + 1);
      case 'PREVIOUS_TRACK': return withTrack(state, state.trackIndex - 1);
      case 'TOGGLE_SHUFFLE': return { ...state, modes: { ...state.modes, shuffle: !state.modes.shuffle } };
      case 'CYCLE_REPEAT': {
        const values = ['off', 'all', 'one'];
        return { ...state, modes: { ...state.modes, repeat: values[(values.indexOf(state.modes.repeat) + 1) % values.length] } };
      }
      case 'SET_CABINET': return { ...state, cabinetOpen: Boolean(action.open) };
      case 'SET_FEEDBACK': return { ...state, feedback: { state: action.state || 'ready', message: String(action.message || ''), action: String(action.action || '') } };
      default: return state;
    }
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function hashString(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || '')) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
    return hash >>> 0;
  }

  return Object.freeze({ TRACKS, createFixtureState, currentTrack, formatTime, hashString, reduceFixture });
}));
