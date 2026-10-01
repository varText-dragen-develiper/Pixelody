(function flowShuffleLearningFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffleLearning = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleLearning() {
  'use strict';

  const VERSION = 1;
  const IGNORED_OUTCOME_REASONS = new Set([
    'connection-lost',
    'host-unreachable',
    'missing-file',
    'network-disconnect',
    'permission-revoked',
    'playback-error',
    'route-failure',
    'seek',
    'shutdown',
    'token-expired',
    'vpn-failure',
  ]);
  const normalizedText = (value = '') => String(value || '').toLowerCase().replace(/\b(feat\.?|featuring|with)\b.*$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const artistIdentity = (track = {}) => normalizedText(track.albumArtist || track.artist);
  const albumIdentity = (track = {}) => [artistIdentity(track), normalizedText(track.album)].filter(Boolean).join(' / ');
  const recordingIdentity = (track = {}) => {
    const isrc = normalizedText(track.isrc);
    return isrc ? `isrc:${isrc}` : [artistIdentity(track), normalizedText(track.title)].filter(Boolean).join(' / ');
  };

  function classifyOutcome(outcome, percentCompleted, reason = '') {
    const percent = Math.max(0, Math.min(1, Number(percentCompleted) || 0));
    const normalizedReason = String(reason || '').toLowerCase();
    if (IGNORED_OUTCOME_REASONS.has(normalizedReason)) return { kind: 'ignored', percent, reason: normalizedReason };
    if (outcome === 'completed') return { kind: 'completed', percent: Math.max(percent, 0.98), reason: normalizedReason || 'natural-end' };
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
    const playedAt = new Date(lastPlayedAt || 0).getTime();
    if (!playedAt || playedAt > now) return 0;
    return Math.max(0, Math.min(1, 1 - (now - playedAt) / Math.max(1, Number(cooldownMs) || 1)));
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
