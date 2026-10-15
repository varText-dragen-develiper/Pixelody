(function flowShufflePlannerFactory(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./shuffle/universal.js') : root?.PixelodyUniversalShuffle);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShufflePlanner = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShufflePlanner(universalPolicy) {
  'use strict';

  const VERSION = 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalized = (value = '') => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  const finiteFeature = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : null;
  const trackEnergy = (track = {}) => { const value = finiteFeature(track.energy); return value === null ? null : clamp(value, 0, 1); };
  const compareIds = (left, right) => left === right ? 0 : String(left) < String(right) ? -1 : 1;
  // Camelot A is minor and B is major. Pitch classes are pinned to the
  // official chart: https://mixedinkey.com/camelot-wheel/ . No key is inferred
  // from a track ID, title, or an unsupported tag.
  const CAMELOT_MINOR = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];
  const CAMELOT_MAJOR = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4];
  const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function parseMusicalKey(value) {
    if (typeof value !== 'string') return null;
    const text = value.normalize('NFKC').trim().replace(/\u266f/g, '#').replace(/\u266d/g, 'b');
    const camelot = text.match(/^(1[0-2]|[1-9])\s*([AB])$/i);
    let pitchClass;
    let mode;
    if (camelot) {
      mode = camelot[2].toUpperCase() === 'A' ? 'minor' : 'major';
      pitchClass = (mode === 'minor' ? CAMELOT_MINOR : CAMELOT_MAJOR)[Number(camelot[1]) - 1];
    } else {
      const note = text.match(/^([A-Ga-g])\s*([#b]?)\s*(major|maj|minor|min|m)?$/i);
      if (!note) return null;
      const suffix = note[3] || '';
      mode = suffix === 'm' || /^min/i.test(suffix) ? 'minor' : 'major';
      pitchClass = (({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 })[note[1].toLowerCase()] + (note[2] === '#' ? 1 : note[2] === 'b' ? -1 : 0) + 12) % 12;
    }
    return { pitchClass, mode, canonical: `${PITCH_NAMES[pitchClass]} ${mode}` };
  }
  const trackKey = (track = {}) => parseMusicalKey(track.musicalKey || track.key);
  function keyPoints(first, second) {
    if (!first || !second) return 0;
    const distance = Math.min((first.pitchClass - second.pitchClass + 12) % 12, (second.pitchClass - first.pitchClass + 12) % 12);
    if (first.mode !== second.mode) {
      const major = first.mode === 'major' ? first.pitchClass : second.pitchClass;
      const minor = first.mode === 'minor' ? first.pitchClass : second.pitchClass;
      return (minor - major + 12) % 12 === 9 ? 3 : distance >= 6 ? -3 : 0;
    }
    return distance === 0 ? 4 : distance <= 2 ? 2 : distance >= 6 ? -3 : 0;
  }
  function keyCompatibility(left, right) {
    return keyPoints(trackKey(left), trackKey(right));
  }
  function transitionBreakdown(previous = {}, candidate = {}, options = {}) {
    const previousEnergy = trackEnergy(previous);
    const candidateEnergy = trackEnergy(candidate);
    const target = shapeTarget(options.shape, options.position, options.horizon, options.sessionStartEnergy ?? previousEnergy);
    const energyPoints = candidateEnergy === null ? 0 : Math.round((1 - Math.abs(candidateEnergy - target)) * 10) - 5;
    const previousBpm = finiteFeature(previous?.bpm);
    const candidateBpm = finiteFeature(candidate?.bpm);
    const bpmAvailable = Number.isFinite(previousBpm) && previousBpm > 0 && Number.isFinite(candidateBpm) && candidateBpm > 0;
    const bpmPoints = bpmAvailable ? Math.max(-4, 4 - Math.round(Math.abs(previousBpm - candidateBpm) / 18)) : 0;
    const keyPoints = keyCompatibility(previous, candidate);
    const previousKey = trackKey(previous)?.canonical || '';
    const candidateKey = trackKey(candidate)?.canonical || '';
    return {
      bpm: { current: bpmAvailable ? Math.round(previousBpm) : null, candidate: bpmAvailable ? Math.round(candidateBpm) : null, delta: bpmAvailable ? Math.round(candidateBpm - previousBpm) : null, points: bpmPoints, available: bpmAvailable },
      energy: { current: previousEnergy, candidate: candidateEnergy, target, points: energyPoints, available: candidateEnergy !== null, direction: candidateEnergy === null || previousEnergy === null ? 'unknown' : candidateEnergy > previousEnergy + 0.04 ? 'rising' : candidateEnergy < previousEnergy - 0.04 ? 'falling' : 'steady' },
      key: { current: previousKey || null, candidate: candidateKey || null, points: keyPoints, available: Boolean(previousKey && candidateKey) },
      totalPoints: energyPoints + bpmPoints + keyPoints,
    };
  }
  function shapeTarget(shape = 'steady', position = 0, horizon = 6, currentEnergy = null) {
    const value = finiteFeature(currentEnergy);
    const start = value === null ? 0.52 : clamp(value, 0, 1);
    const progress = horizon <= 1 ? 1 : position / Math.max(1, horizon - 1);
    if (shape === 'rise') return clamp(start + 0.30 * progress, 0, 1);
    if (shape === 'wind-down') return clamp(start - 0.30 * progress, 0, 1);
    if (shape === 'wave') return clamp(start + Math.sin(progress * Math.PI * 2) * 0.18, 0, 1);
    return start;
  }
  function transitionScore(previous, candidate, options = {}) {
    return transitionBreakdown(previous, candidate, options).totalPoints;
  }
  function diversityPenalty(sequence = [], candidate = {}, options = {}) {
    const artist = normalized(candidate.artist);
    const album = albumIdentity(candidate);
    const genre = normalized(candidate.genre);
    const recent = sequence.slice(-Math.max(1, Number(options.window) || 4));
    let penalty = 0;
    if (artist && recent.some((track) => normalized(track.artist) === artist)) penalty -= 10;
    if (album && recent.some((track) => albumIdentity(track) === album)) penalty -= 7;
    if (genre && recent.filter((track) => normalized(track.genre) === genre).length >= 2) penalty -= 4;
    return penalty;
  }
  function diversityBreakdown(sequence = [], candidate = {}, options = {}) {
    const artist = normalized(candidate.artist);
    const album = albumIdentity(candidate);
    const genre = normalized(candidate.genre);
    const recent = sequence.slice(-Math.max(1, Number(options.window) || 4));
    const artistRepeat = Boolean(artist && recent.some((track) => normalized(track.artist) === artist));
    const albumRepeat = Boolean(album && recent.some((track) => albumIdentity(track) === album));
    const genrePressure = Boolean(genre && recent.filter((track) => normalized(track.genre) === genre).length >= 2);
    return { artist: artistRepeat ? 'repeat' : artist ? 'spaced' : 'unknown', album: albumRepeat ? 'repeat' : album ? 'spaced' : 'unknown', genre: genrePressure ? 'pressure' : genre ? 'available' : 'unknown', points: (artistRepeat ? -10 : 0) + (albumRepeat ? -7 : 0) + (genrePressure ? -4 : 0) };
  }
  function albumIdentity(track = {}) {
    if (typeof track.albumId === 'string' && track.albumId) return JSON.stringify(['id', track.albumId]);
    const album = normalized(track.album);
    const artist = normalized(track.albumArtist || track.artist);
    return album && artist ? JSON.stringify(['album', artist, album]) : '';
  }
  function unitsFromCandidates(candidates = [], options = {}) {
    const preserveAlbums = options.albumPolicy === 'album' || options.preserveAlbumRuns;
    if (!preserveAlbums) return candidates.map((track) => ({ tracks: [track], representative: track }));
    const groups = new Map();
    candidates.forEach((track, index) => {
      const key = albumIdentity(track) || JSON.stringify(['unidentified', index]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(track);
    });
    return [...groups.entries()].map(([albumId, tracks]) => {
      const number = (value) => { const result = finiteFeature(value); return Number.isInteger(result) && result > 0 ? result : null; };
      const multiDisc = tracks.some((track) => (number(track.discNumber) || 1) > 1);
      const orderKnown = tracks.every((track) => number(track.trackNumber) !== null && (!multiDisc || number(track.discNumber) !== null));
      const ordered = orderKnown ? tracks.slice().sort((left, right) => (number(left.discNumber) || 1) - (number(right.discNumber) || 1) || number(left.trackNumber) - number(right.trackNumber)) : tracks.slice();
      return { albumId, orderKnown, tracks: ordered, representative: ordered[0] };
    });
  }
  function planSession(options = {}) {
    const horizon = clamp(Math.round(Number(options.horizon) || 6), 5, 10);
    const beamWidth = clamp(Math.round(Number(options.beamWidth) || 8), 2, 16);
    const current = options.current || {};
    const candidates = (Array.isArray(options.candidates) ? options.candidates : []).filter((track) => track?.id && !track.missing);
    const baseScores = options.baseScores || {};
    const units = unitsFromCandidates(candidates, options);
    const sessionStartEnergy = trackEnergy(current);
    const window = Math.max(1, Number(options.window) || 4);
    // Beam search scoring is the hot path (beams x candidates per step, over a
    // whole library for Daily Curated). Each track's normalized features are
    // computed once per call, every expansion is scored with the same
    // arithmetic as transitionBreakdown()/diversityBreakdown() without
    // allocating their detail objects, and only the beamWidth survivors are
    // materialized, with details from those exported functions. Beams record
    // the units they used instead of copying the remaining list per
    // expansion, which made a step O(beams x candidates^2) and froze startup
    // for minutes on large libraries. Output is unchanged.
    const features = new Map();
    const featuresOf = (track) => {
      let entry = features.get(track);
      if (!entry) {
        const bpm = finiteFeature(track?.bpm);
        entry = {
          energy: trackEnergy(track),
          bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
          key: trackKey(track),
          artist: normalized(track?.artist),
          album: albumIdentity(track),
          genre: normalized(track?.genre),
        };
        features.set(track, entry);
      }
      return entry;
    };
    // Cache bounded ID suffixes. Compare actual opaque IDs by UTF-16 ordinal
    // order, never locale or delimiter joins (['a|b', 'c'] != ['a', 'b|c']).
    const unitSuffixes = new Map(units.map((unit) => {
      return [unit, unit.tracks.slice(0, horizon).map((track) => String(track.id))];
    }));
    const currentAlbumId = albumIdentity(current);
    const continuationUnit = (options.albumPolicy === 'album' || options.preserveAlbumRuns) && currentAlbumId ? units.find((unit) => unit.albumId === currentAlbumId) : null;
    let beams = [{ tracks: [], tiePrefix: [], used: new Set(), score: 0, steps: [], albumContinuation: null }];
    const compareKeys = (left, right) => {
      const leftSuffix = unitSuffixes.get(left.unit);
      const rightSuffix = unitSuffixes.get(right.unit);
      const leftLength = Math.min(horizon, left.position + leftSuffix.length);
      const rightLength = Math.min(horizon, right.position + rightSuffix.length);
      for (let index = 0; index < Math.min(leftLength, rightLength); index += 1) {
        const leftId = index < left.position ? left.beam.tiePrefix[index] : leftSuffix[index - left.position];
        const rightId = index < right.position ? right.beam.tiePrefix[index] : rightSuffix[index - right.position];
        const comparison = compareIds(leftId, rightId);
        if (comparison) return comparison;
      }
      return leftLength - rightLength;
    };
    // Same order as sorting every expansion with this comparator (stable) and
    // keeping the first beamWidth: an expansion enters `top` only if it would
    // sort before the current last entry, after any equal earlier ones. Most
    // expansions are rejected on score alone, before any allocation.
    const sortsBefore = (left, right) => right.score - left.score || compareKeys(left, right);
    while (beams.length && beams[0].tracks.length < horizon) {
      const top = [];
      beams.forEach((beam) => {
        const previous = beam.tracks[beam.tracks.length - 1] || current;
        const position = beam.tracks.length;
        const before = featuresOf(previous);
        const target = shapeTarget(options.shape, position, horizon, sessionStartEnergy ?? before.energy);
        const recent = beam.tracks.slice(-window).map(featuresOf);
        const recentArtists = new Set(recent.map((entry) => entry.artist));
        const recentAlbums = new Set(recent.map((entry) => entry.album));
        const recentGenres = new Map();
        recent.forEach((entry) => recentGenres.set(entry.genre, (recentGenres.get(entry.genre) || 0) + 1));
        units.forEach((unit) => {
          if (beam.used.has(unit)) return;
          if (position === 0 && continuationUnit && unit !== continuationUnit) return;
          const candidate = unit.representative;
          const after = featuresOf(candidate);
          const energyPoints = after.energy === null ? 0 : Math.round((1 - Math.abs(after.energy - target)) * 10) - 5;
          const bpmPoints = before.bpm !== null && after.bpm !== null ? Math.max(-4, 4 - Math.round(Math.abs(before.bpm - after.bpm) / 18)) : 0;
          const transition = energyPoints + bpmPoints + keyPoints(before.key, after.key);
          const diversity = (after.artist && recentArtists.has(after.artist) ? -10 : 0)
            + (after.album && recentAlbums.has(after.album) ? -7 : 0)
            + (after.genre && (recentGenres.get(after.genre) || 0) >= 2 ? -4 : 0);
          const base = Number(baseScores[candidate.id]) || 0;
          const score = beam.score + base + transition + diversity;
          if (top.length === beamWidth && score < top[beamWidth - 1].score) return;
          const expansion = { beam, unit, previous, position, base, score };
          if (top.length === beamWidth && sortsBefore(expansion, top[beamWidth - 1]) >= 0) return;
          let index = top.length;
          while (index > 0 && sortsBefore(expansion, top[index - 1]) < 0) index -= 1;
          top.splice(index, 0, expansion);
          if (top.length > beamWidth) top.pop();
        });
      });
      if (!top.length) break;
      beams = top.map((expansion) => {
        const { beam, unit, previous, position, base, score } = expansion;
        const candidate = unit.representative;
        const transitionDetails = transitionBreakdown(previous, candidate, { ...options, position, horizon, sessionStartEnergy });
        const diversityDetails = diversityBreakdown(beam.tracks, candidate, options);
        const transition = transitionDetails.totalPoints;
        const diversity = diversityDetails.points;
        const remaining = unit.tracks.slice(horizon - position).map((track) => track.id);
        const tracks = beam.tracks.concat(unit.tracks).slice(0, horizon);
        return {
          tracks,
          tiePrefix: tracks.map((track) => String(track.id)),
          used: new Set(beam.used).add(unit),
          score,
          albumContinuation: remaining.length ? { albumId: unit.albumId, prefixIds: unit.tracks.slice(0, horizon - position).map((track) => track.id), ids: remaining, orderKnown: unit.orderKnown } : null,
          steps: beam.steps.concat({ trackId: candidate.id, previousTrackId: previous.id || '', position: position + 1, basePoints: base, transitionPoints: transition, diversityPoints: diversity, totalPoints: base + transition + diversity, transition: transitionDetails, diversity: diversityDetails }),
        };
      });
    }
    const best = beams.slice().sort((left, right) => right.score - left.score)[0] || { tracks: [], score: 0, steps: [] };
    return { ids: best.tracks.map((track) => track.id), score: Math.round(best.score), horizon, shape: options.shape || 'steady', albumPolicy: options.albumPolicy || 'track', albumContinuation: best.albumContinuation || null, steps: best.steps };
  }
  // Active selection uses universalPolicy; planSession preserves the legacy
  // preset/saved-state surface until its adapter supplies occurrence IDs.
  return Object.freeze({ VERSION, universalPolicy, albumIdentity, diversityBreakdown, diversityPenalty, keyCompatibility, parseMusicalKey, planSession, shapeTarget, transitionBreakdown, transitionScore });
}));
