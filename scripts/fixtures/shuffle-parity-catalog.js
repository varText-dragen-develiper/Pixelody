'use strict';

// Shared deterministic catalog and scenarios for the v2.1 -> v2.2 decision parity
// fixture. Personal marks are disabled, so two-queue behavior must reproduce the
// v2.1 traversal exactly for every mode it kept.
const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
function catalog(count = 40) {
  return Array.from({ length: count }, (_, i) => ({
    entryId: `e${String(i).padStart(2, '0')}`, trackId: `t${String(i % (count - 3)).padStart(2, '0')}`,
    artist: `Artist ${i % 7}`, album: `Album ${i % 11}`, albumArtist: `Artist ${i % 7}`,
    genre: ['lo-fi', 'synthwave', 'jazz', 'rock'][i % 4], discNumber: 1, trackNumber: 1 + Math.floor(i / 11),
    features: i % 5 === 4 ? {} : {
      tempo: { value: 70 + (i * 37) % 90, provenance: 'tagged' },
      energy: { value: ((i * 53) % 100) / 100, provenance: 'measured' },
      key: { value: KEYS[(i * 5) % 12] + (i % 3 ? '' : 'm'), provenance: 'tagged' },
    },
  }));
}
function signals(entries) {
  return [...new Set(entries.map((e) => e.trackId))].map((trackId, i) => i % 6 === 5 ? { trackId } : ({
    trackId, tastePoints: (i * 7) % 25 - 12, noveltyPoints: (i * 5) % 13, exposure: i % 4,
    lastHeardAtMs: i % 3 ? 1_000_000_000 - i * 3_600_000 : null, confidencePermille: (i * 97) % 1000,
  }));
}
const scenarios = [
  { name: 'off', mode: 'off' },
  { name: 'album', mode: 'album' },
  { name: 'balanced', mode: 'balanced' },
  { name: 'flow-auto', mode: 'flow' },
  { name: 'flow-wave-discovery', mode: 'flow', options: { preset: 'discovery', shape: 'wave' } },
  { name: 'flow-genre-weave-runs', mode: 'flow', options: { preset: 'genre-weave', preserveAlbumRuns: true } },
  { name: 'balanced-small', mode: 'balanced', count: 5 },
];
// The createSession input, scoring context and step count for one scenario.
function setup(scenario) {
  const entries = catalog(scenario.count || 40);
  return { input: { sessionId: 'parity', scopeId: 'parity-scope', authorityId: 'parity-device', seed: `parity:${scenario.name}`,
    mode: scenario.mode, repeat: 'all', ...(scenario.options ? { options: scenario.options } : {}), entries },
  context: { nowMs: 1_000_000_000, signals: signals(entries) }, steps: Math.ceil(entries.length * 1.5) };
}
// Plays natural ends through 1.5 cycles with Repeat All; returns the entry sequence.
// The fixture was written by running this against universal.js at 7ce0689 (v2.1).
function run(policy, scenario, extraRequest = {}) {
  const { input, context, steps } = setup(scenario);
  let state = policy.createSession(input);
  const sequence = [];
  for (let i = 0; i < steps; i += 1) {
    const staged = policy.stage(state, { attemptId: `a${i}`, naturalEnd: i > 0, ...extraRequest }, context);
    if (!staged.pending) break;
    sequence.push(staged.pending.entryId);
    state = policy.commit(staged, staged.pending);
  }
  return sequence;
}
module.exports = { catalog, signals, scenarios, setup, run };
