(function flowShuffleLearningFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffleLearning = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleLearning() {
  'use strict';

  const VERSION = 2;
  const IGNORED_OUTCOME_REASONS = new Set([
    'connection-lost',
    'buffering',
    'crash',
    'focus-loss',
    'host-unreachable',
    'missing-file',
    'network-disconnect',
    'pause',
    'permission-revoked',
    'playback-error',
    'route-failure',
    'preview',
    'remote-action',
    'seek',
    'shutdown',
    'token-expired',
    'vpn-failure',
  ]);
  const normalizedText = (value = '') => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  const artistIdentity = (track = {}) => normalizedText(String(track.albumArtist || track.artist || '').replace(/\b(feat\.?|featuring|with)\b.*$/i, ''));
  const albumIdentity = (track = {}) => {
    if (typeof track.albumId === 'string' && track.albumId) return JSON.stringify(['album-id', track.albumId]);
    const artist = artistIdentity(track);
    const album = normalizedText(track.album);
    return artist && album ? JSON.stringify(['album', artist, album]) : '';
  };
  const recordingIdentity = (track = {}) => {
    if (typeof track.recordingId === 'string' && track.recordingId) return JSON.stringify(['recording-id', track.recordingId]);
    const isrc = typeof track.isrc === 'string' ? track.isrc.replace(/[-\s]/g, '').toUpperCase() : '';
    // Only a syntactically valid catalog recording identifier groups versions.
    // A matching title is not evidence that a live/remastered recording is equal.
    return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc) ? `isrc:${isrc}` : '';
  };

  function classifyOutcome(outcome, percentCompleted, reason = '') {
    const percent = Math.max(0, Math.min(1, Number(percentCompleted) || 0));
    const normalizedReason = String(reason || '').toLowerCase();
    if (IGNORED_OUTCOME_REASONS.has(normalizedReason)) return { kind: 'ignored', percent, reason: normalizedReason };
    if (outcome === 'completed') return { kind: 'completed', percent, reason: normalizedReason || 'natural-end' };
    if (outcome !== 'skipped') return { kind: 'ignored', percent, reason: normalizedReason || 'non-listening-event' };
    if (percent >= 0.85) return { kind: 'near-completion', percent, reason: normalizedReason || 'late-skip' };
    if (percent < 0.22) return { kind: 'early-skip', percent, reason: normalizedReason || 'manual-switch' };
    return { kind: 'mid-skip', percent, reason: normalizedReason || 'manual-switch' };
  }

  function behaviorEvidence(stats = {}) {
    const completions = Math.max(0, Number(stats.completions) || 0);
    const nearCompletions = Math.max(0, Number(stats.nearCompletions) || 0);
    const earlySkips = Math.max(0, Number(stats.earlySkips) || 0);
    const midSkips = Math.max(0, Number(stats.midSkips) || 0);
    const ignoredOutcomes = Math.max(0, Number(stats.ignoredOutcomes) || 0);
    const legacySkips = Math.max(0, (Number(stats.skips) || 0) - earlySkips - midSkips - nearCompletions - ignoredOutcomes);
    const successes = completions + nearCompletions * 0.8;
    const failures = earlySkips + midSkips * 0.45 + legacySkips * 0.6;
    const evidence = successes + failures;
    const priorStrength = 4;
    const rate = (successes + priorStrength * 0.5) / (evidence + priorStrength);
    const confidence = evidence / (evidence + priorStrength);
    return { successes, failures, evidence, rate, confidence, signal: (rate - 0.5) * 24 * confidence };
  }

  function freshnessPressure(lastPlayedAt, now = Date.now(), cooldownMs = 86400000) {
    if (lastPlayedAt === null || lastPlayedAt === undefined || lastPlayedAt === '') return 0;
    const playedAt = new Date(lastPlayedAt).getTime();
    if (!Number.isFinite(playedAt) || !Number.isFinite(Number(now))) return 0;
    return Math.max(0, Math.min(1, 1 - Math.max(0, Number(now) - playedAt) / Math.max(1, Number(cooldownMs) || 1)));
  }

  function matchingContextTags(tags = [], date = new Date()) {
    const hour = date.getHours();
    const accepted = new Set(hour >= 5 && hour < 12 ? ['morning'] : hour >= 12 && hour < 17 ? ['afternoon'] : hour >= 17 && hour < 22 ? ['evening'] : ['night', 'late night']);
    return [...new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').toLowerCase().trim()).filter((tag) => accepted.has(tag)))];
  }

  function explorationBoost(stats = {}, mode = 'flow') {
    const base = Math.max(0, 1 - Math.max(0, Number(stats.starts) || 0) / 8);
    const multiplier = mode === 'comfort' ? -5 : mode === 'discovery' ? 14 : mode === 'deep-library' ? 12 : 6;
    return Math.round(base * multiplier);
  }

  function exposureMetrics(trackStats = {}, trackIds = []) {
    const ids = Array.isArray(trackIds) ? trackIds : Object.keys(trackStats || {});
    const rows = ids.map((id) => trackStats[id] || {});
    const played = rows.filter((stats) => (Number(stats.starts) || 0) > 0).length;
    return { eligible: ids.length, played, neverPlayed: Math.max(0, ids.length - played), coverage: ids.length ? played / ids.length : 0, starts: rows.reduce((sum, stats) => sum + (Number(stats.starts) || 0), 0) };
  }

  return Object.freeze({ VERSION, albumIdentity, artistIdentity, behaviorEvidence, classifyOutcome, exposureMetrics, explorationBoost, freshnessPressure, matchingContextTags, recordingIdentity });
}));
