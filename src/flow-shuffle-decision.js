(function flowShuffleDecisionFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffleDecision = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleDecision() {
  'use strict';

  const VERSION = 1;
  const KINDS = new Set(['candidate', 'planned', 'priority', 'forward', 'previous', 'stop']);
  const MODES = new Set(['flow', 'discovery', 'comfort', 'energy', 'genre-weave', 'deep-library']);
  const SHAPES = new Set(['auto', 'steady', 'rise', 'wave', 'wind-down']);
  const DIRECTIONS = new Set(['unknown', 'rising', 'falling', 'steady']);
  const SIGNALS = new Set(['tempo', 'key', 'energy', 'genre', 'artist', 'mood']);
  const DIVERSITY = new Set(['unknown', 'spaced', 'repeat', 'available', 'pressure']);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const integer = (value, min, max, fallback = 0) => clamp(Math.round(Number(value) || fallback), min, max);
  const text = (value, max = 160) => String(value || '').slice(0, max);
  const nullableText = (value, max = 32) => value === null || value === undefined || value === '' ? null : text(value, max);
  const nullableUnit = (value) => { const number = finite(value); return number === null ? null : Number(clamp(number, 0, 1).toFixed(3)); };
  const nullableBpm = (value) => { const number = finite(value); return number === null || number <= 0 ? null : integer(number, 1, 400); };

  function normalizeTransition(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const bpmInput = input.bpm && typeof input.bpm === 'object' ? input.bpm : {};
    const energyInput = input.energy && typeof input.energy === 'object' ? input.energy : {};
    const keyInput = input.key && typeof input.key === 'object' ? input.key : {};
    const bpmCurrent = nullableBpm(bpmInput.current);
    const bpmCandidate = nullableBpm(bpmInput.candidate);
    const bpmAvailable = bpmInput.available === true && bpmCurrent !== null && bpmCandidate !== null;
    const energyCurrent = nullableUnit(energyInput.current);
    const energyCandidate = nullableUnit(energyInput.candidate);
    const energyTarget = nullableUnit(energyInput.target);
    const keyCurrent = nullableText(keyInput.current);
    const keyCandidate = nullableText(keyInput.candidate);
    const keyAvailable = keyInput.available === true && Boolean(keyCurrent && keyCandidate);
    return {
      bpm: { current: bpmAvailable ? bpmCurrent : null, candidate: bpmAvailable ? bpmCandidate : null, delta: bpmAvailable ? integer(bpmInput.delta, -400, 400, bpmCandidate - bpmCurrent) : null, points: integer(bpmInput.points, -4, 4), available: bpmAvailable },
      energy: { current: energyCurrent, candidate: energyCandidate, target: energyTarget, points: integer(energyInput.points, -20, 20), available: energyInput.available === true && energyCandidate !== null, direction: DIRECTIONS.has(energyInput.direction) ? energyInput.direction : 'unknown' },
      key: { current: keyAvailable ? keyCurrent : null, candidate: keyAvailable ? keyCandidate : null, points: integer(keyInput.points, -6, 6), available: keyAvailable },
      totalPoints: integer(input.totalPoints, -32, 32),
    };
  }

  function normalizeDecision(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const diversityInput = input.diversity && typeof input.diversity === 'object' ? input.diversity : {};
    const availableSignals = [...new Set((Array.isArray(input.availableSignals) ? input.availableSignals : []).map(String).filter((signal) => SIGNALS.has(signal)))].slice(0, 8);
    return {
      version: VERSION,
      kind: KINDS.has(input.kind) ? input.kind : 'candidate',
      source: text(input.source, 80) || 'local track metadata',
      mode: MODES.has(input.mode) ? input.mode : 'flow',
      shape: SHAPES.has(input.shape) ? input.shape : 'steady',
      trackId: text(input.trackId, 300),
      fromTrackId: text(input.fromTrackId, 300),
      planPosition: integer(input.planPosition, 0, 10),
      horizon: integer(input.horizon, 5, 10, 6),
      fitScore: integer(input.fitScore, -1000, 1000),
      evidenceStrength: Number(clamp(Number(input.evidenceStrength) || 0, 0, 1).toFixed(2)),
      metadataCoverage: Number(clamp(Number(input.metadataCoverage) || 0, 0, 1).toFixed(2)),
      availableSignals,
      transition: normalizeTransition(input.transition),
      diversity: {
        artist: DIVERSITY.has(diversityInput.artist) ? diversityInput.artist : 'unknown',
        album: DIVERSITY.has(diversityInput.album) ? diversityInput.album : 'unknown',
        genre: DIVERSITY.has(diversityInput.genre) ? diversityInput.genre : 'unknown',
        points: integer(diversityInput.points, -32, 0),
      },
    };
  }

  return Object.freeze({ VERSION, normalizeDecision, normalizeTransition });
}));
