(function jamLearningContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyJamLearningContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createJamLearningContract() {
  'use strict';

  const VERSION = 1;
  const SCOPES = new Set(['personal', 'session', 'infrastructure']);
  const NETWORK_FAILURE_REASONS = new Set([
    'connection-lost',
    'host-unreachable',
    'network-disconnect',
    'permission-revoked',
    'route-failure',
    'shutdown',
    'token-expired',
    'vpn-failure',
  ]);
  const bounded = (value, limit) => String(value || '').trim().slice(0, limit);

  function isInfrastructureReason(reason = '') {
    return NETWORK_FAILURE_REASONS.has(String(reason || '').trim().toLowerCase());
  }

  function normalizeContext(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const sourceName = bounded(input.source, 32).toLowerCase();
    const requestedScope = bounded(input.learningScope, 24).toLowerCase();
    const learningScope = SCOPES.has(requestedScope)
      ? requestedScope
      : sourceName === 'remote' || sourceName === 'jam'
        ? 'session'
        : 'personal';
    const isQueueIntent = input.eventType === 'track_queued';
    const personalLearning = input.personalLearning === undefined
      ? learningScope === 'personal' && !isQueueIntent
      : input.personalLearning === true;
    return {
      learningScope,
      personalLearning,
      actorDeviceId: bounded(input.actorDeviceId, 128),
      actorRole: bounded(input.actorRole, 32),
      transport: bounded(input.transport, 32),
    };
  }

  function eventContext(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const context = normalizeContext(input);
    const ignored = context.learningScope === 'infrastructure' || isInfrastructureReason(input.outcomeReason);
    return {
      ...context,
      learningScope: ignored ? 'infrastructure' : context.learningScope,
      personalLearning: ignored ? false : context.personalLearning,
      ignored,
    };
  }

  return Object.freeze({ VERSION, eventContext, isInfrastructureReason, normalizeContext });
}));
