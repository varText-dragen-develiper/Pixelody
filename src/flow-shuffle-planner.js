(function flowShufflePlannerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShufflePlanner = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShufflePlanner() {
  'use strict';

  const VERSION = 1;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalized = (value = '') => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const trackEnergy = (track = {}) => Number.isFinite(Number(track.energy)) ? clamp(Number(track.energy), 0, 1) : null;
  const trackKey = (track = {}) => normalized(track.musicalKey || track.key);
  const keyClass = (key = '') => {
    const match = String(key).match(/\b([a-g])(?:#|b)?\b/i);
    if (!match) return -1;
    return ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 })[match[1].toLowerCase()] ?? -1;
  };
  function keyCompatibility(left, right) {
    const first = keyClass(trackKey(left));
    const second = keyClass(trackKey(right));
    if (first < 0 || second < 0) return 0;
    const distance = Math.min((first - second + 12) % 12, (second - first + 12) % 12);
    return distance === 0 ? 4 : distance <= 2 ? 2 : distance >= 6 ? -3 : 0;
  }
  function transitionBreakdown(previous = {}, candidate = {}, options = {}) {
    const previousEnergy = trackEnergy(previous);
    const candidateEnergy = trackEnergy(candidate);
    const target = shapeTarget(options.shape, options.position, options.horizon, options.sessionStartEnergy ?? previousEnergy);
    const energyPoints = candidateEnergy === null ? 0 : Math.round((1 - Math.abs(candidateEnergy - target)) * 10) - 5;
    const previousBpm = Number(previous?.bpm);
    const candidateBpm = Number(candidate?.bpm);
    const bpmAvailable = Number.isFinite(previousBpm) && previousBpm > 0 && Number.isFinite(candidateBpm) && candidateBpm > 0;
    const bpmPoints = bpmAvailable ? Math.max(-4, 4 - Math.round(Math.abs(previousBpm - candidateBpm) / 18)) : 0;
    const keyPoints = keyCompatibility(previous, candidate);
    const previousKey = trackKey(previous) || '';
    const candidateKey = trackKey(candidate) || '';
    return {
      bpm: { current: bpmAvailable ? Math.round(previousBpm) : null, candidate: bpmAvailable ? Math.round(candidateBpm) : null, delta: bpmAvailable ? Math.round(candidateBpm - previousBpm) : null, points: bpmPoints, available: bpmAvailable },
      energy: { current: previousEnergy, candidate: candidateEnergy, target, points: energyPoints, available: candidateEnergy !== null, direction: candidateEnergy === null || previousEnergy === null ? 'unknown' : candidateEnergy > previousEnergy + 0.04 ? 'rising' : candidateEnergy < previousEnergy - 0.04 ? 'falling' : 'steady' },
      key: { current: previousKey || null, candidate: candidateKey || null, points: keyPoints, available: Boolean(previousKey && candidateKey) },
      totalPoints: energyPoints + bpmPoints + keyPoints,
    };
  }
  function shapeTarget(shape = 'steady', position = 0, horizon = 6, currentEnergy = null) {
    const start = currentEnergy === null ? 0.52 : currentEnergy;
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
    const album = normalized(candidate.album);
    const genre = normalized(candidate.genre);
    const recent = sequence.slice(-Math.max(1, Number(options.window) || 4));
    let penalty = 0;
    if (artist && recent.some((track) => normalized(track.artist) === artist)) penalty -= 10;
    if (album && recent.some((track) => normalized(track.album) === album)) penalty -= 7;
    if (genre && recent.filter((track) => normalized(track.genre) === genre).length >= 2) penalty -= 4;
    return penalty;
  }
  function diversityBreakdown(sequence = [], candidate = {}, options = {}) {
    const artist = normalized(candidate.artist);
    const album = normalized(candidate.album);
    const genre = normalized(candidate.genre);
    const recent = sequence.slice(-Math.max(1, Number(options.window) || 4));
    const artistRepeat = Boolean(artist && recent.some((track) => normalized(track.artist) === artist));
    const albumRepeat = Boolean(album && recent.some((track) => normalized(track.album) === album));
    const genrePressure = Boolean(genre && recent.filter((track) => normalized(track.genre) === genre).length >= 2);
    return { artist: artistRepeat ? 'repeat' : artist ? 'spaced' : 'unknown', album: albumRepeat ? 'repeat' : album ? 'spaced' : 'unknown', genre: genrePressure ? 'pressure' : genre ? 'available' : 'unknown', points: (artistRepeat ? -10 : 0) + (albumRepeat ? -7 : 0) + (genrePressure ? -4 : 0) };
  }
  function unitsFromCandidates(candidates = [], options = {}) {
    const preserveAlbums = options.albumPolicy === 'album' || options.preserveAlbumRuns;
    if (!preserveAlbums) return candidates.map((track) => ({ tracks: [track], representative: track }));
    const groups = new Map();
    candidates.forEach((track) => {
      const album = normalized(track.album);
      const key = album ? `${normalized(track.albumArtist || track.artist)} / ${album}` : `track:${track.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(track);
    });
    return [...groups.values()].map((tracks) => {
      const ordered = tracks.slice().sort((left, right) => Number(left.discNumber || 0) - Number(right.discNumber || 0) || Number(left.trackNumber || 0) - Number(right.trackNumber || 0));
      return { tracks: ordered, representative: ordered[0] };
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
        const bpm = Number(track?.bpm);
        entry = {
          energy: trackEnergy(track),
          bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
          keyClass: keyClass(trackKey(track)),
          artist: normalized(track?.artist),
          album: normalized(track?.album),
          genre: normalized(track?.genre),
        };
        features.set(track, entry);
      }
      return entry;
    };
    // Cache each unit's bounded ID suffix and each retained beam's prefix.
    // Equal scores are common with sparse metadata; rebuilding arrays and ID
    // strings for every rejected expansion dominated large-library startup.
    const unitSuffixes = new Map(units.map((unit) => {
      const ids = unit.tracks.slice(0, horizon).map((track) => track.id);
      return [unit, Array.from({ length: horizon + 1 }, (_, count) => ids.slice(0, count).join('|'))];
    }));
    const compareKeys = new Intl.Collator().compare;
    let beams = [{ tracks: [], tiePrefix: '', used: new Set(), score: 0, steps: [] }];
    const tieKey = (expansion) => {
      if (expansion.tieKey === undefined) expansion.tieKey = expansion.beam.tiePrefix + unitSuffixes.get(expansion.unit)[horizon - expansion.position];
      return expansion.tieKey;
    };
    // Same order as sorting every expansion with this comparator (stable) and
    // keeping the first beamWidth: an expansion enters `top` only if it would
    // sort before the current last entry, after any equal earlier ones. Most
    // expansions are rejected on score alone, before any allocation.
    const sortsBefore = (left, right) => right.score - left.score || compareKeys(tieKey(left), tieKey(right));
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
          const candidate = unit.representative;
          const after = featuresOf(candidate);
          const energyPoints = after.energy === null ? 0 : Math.round((1 - Math.abs(after.energy - target)) * 10) - 5;
          const bpmPoints = before.bpm !== null && after.bpm !== null ? Math.max(-4, 4 - Math.round(Math.abs(before.bpm - after.bpm) / 18)) : 0;
          let keyPoints = 0;
          if (before.keyClass >= 0 && after.keyClass >= 0) {
            const distance = Math.min((before.keyClass - after.keyClass + 12) % 12, (after.keyClass - before.keyClass + 12) % 12);
            keyPoints = distance === 0 ? 4 : distance <= 2 ? 2 : distance >= 6 ? -3 : 0;
          }
          const transition = energyPoints + bpmPoints + keyPoints;
          const diversity = (after.artist && recentArtists.has(after.artist) ? -10 : 0)
            + (after.album && recentAlbums.has(after.album) ? -7 : 0)
            + (after.genre && (recentGenres.get(after.genre) || 0) >= 2 ? -4 : 0);
          const base = Number(baseScores[candidate.id]) || 0;
          const score = beam.score + base + transition + diversity;
          if (top.length === beamWidth && score < top[beamWidth - 1].score) return;
          const expansion = { beam, unit, previous, position, base, score, tieKey: undefined };
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
        return {
          tracks: beam.tracks.concat(unit.tracks).slice(0, horizon),
          tiePrefix: `${tieKey(expansion)}|`,
          used: new Set(beam.used).add(unit),
          score,
          steps: beam.steps.concat({ trackId: candidate.id, previousTrackId: previous.id || '', position: position + 1, basePoints: base, transitionPoints: transition, diversityPoints: diversity, totalPoints: base + transition + diversity, transition: transitionDetails, diversity: diversityDetails }),
        };
      });
    }
    const best = beams.slice().sort((left, right) => right.score - left.score)[0] || { tracks: [], score: 0, steps: [] };
    return { ids: best.tracks.map((track) => track.id), score: Math.round(best.score), horizon, shape: options.shape || 'steady', albumPolicy: options.albumPolicy || 'track', steps: best.steps };
  }
  return Object.freeze({ VERSION, diversityBreakdown, diversityPenalty, keyCompatibility, planSession, shapeTarget, transitionBreakdown, transitionScore });
}));
