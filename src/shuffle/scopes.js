(function shuffleScopesFactory(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./universal.js') : root.PixelodyUniversalShuffle);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyShuffleScopesV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createShuffleScopes(policy) {
  'use strict';
  const VERSION = 2, MAX_SCOPES = 32, MAX_EVICTION_DIAGNOSTICS = 128;
  function createBank() { return { schemaVersion: VERSION, scopes: [], evictions: [] }; }
  function save(bank, session, context = {}) {
    policy.validateState(session);
    if (bank.schemaVersion !== VERSION) return { status: 'unsupported', bank, preserved: bank };
    const prior = bank.scopes.find((row) => row.scopeId === session.scopeId);
    if (!prior && bank.scopes.length >= MAX_SCOPES) return { status: 'capacity-requires-explicit-eviction', bank, unfinished: bank.scopes.filter((row) => row.session.remaining.length > 0).map((row) => row.scopeId) };
    const savedAtMs = Number.isSafeInteger(context.nowMs) && context.nowMs >= 0 ? context.nowMs : 0;
    const scopes = bank.scopes.filter((row) => row.scopeId !== session.scopeId).concat({ scopeId: session.scopeId, savedAtMs, session: JSON.parse(JSON.stringify(session)) });
    scopes.sort((a, b) => policy.ordinal(a.scopeId, b.scopeId));
    return { status: 'saved', bank: { ...bank, scopes } };
  }
  function restore(bank, scopeId) {
    if (bank.schemaVersion !== VERSION) return { status: 'unsupported', preserved: bank, state: null };
    const row = bank.scopes.find((item) => item.scopeId === scopeId);
    if (row) return policy.restore(row.session);
    const eviction = bank.evictions.findLast((item) => item.scopeId === scopeId);
    return { status: eviction ? 'explicitly-evicted' : 'missing', state: null, diagnostics: eviction ? [eviction] : [] };
  }
  function evict(bank, scopeId, context = {}) {
    if (bank.schemaVersion !== VERSION) return { status: 'unsupported', bank, preserved: bank };
    const row = bank.scopes.find((item) => item.scopeId === scopeId);
    if (!row) return { status: 'missing', bank };
    const record = { scopeId, atMs: Number.isSafeInteger(context.nowMs) && context.nowMs >= 0 ? context.nowMs : 0, unfinishedEntitlements: row.session.remaining.length, completed: row.session.remaining.length === 0, reason: 'explicit-scope-eviction' };
    return { status: 'evicted', bank: { ...bank, scopes: bank.scopes.filter((item) => item.scopeId !== scopeId), evictions: [...bank.evictions, record].slice(-MAX_EVICTION_DIAGNOSTICS) }, diagnostic: record };
  }
  return Object.freeze({ VERSION, MAX_SCOPES, MAX_EVICTION_DIAGNOSTICS, createBank, save, restore, evict });
}));
