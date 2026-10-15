(function pixelodyShuffleControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyShuffleController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createShuffleControllerApi() {
  'use strict';

  const STORE_ID = 'pixelody.windows.shuffle-session';
  const SNAPSHOT_VERSION = 1;
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const id = (value) => typeof value === 'string' && value.length > 0;
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function createController(input = {}) {
    const core = input.core;
    const learning = input.learning;
    const scopes = input.scopes;
    for (const method of ['createSession', 'restore', 'stage', 'commit', 'abort', 'project', 'reduce', 'reconcile', 'setMode', 'newCycle', 'mutate', 'currentOccurrence', 'normalizeEntries']) {
      if (typeof core?.[method] !== 'function') throw new TypeError(`Shuffle core missing ${method}`);
    }
    for (const method of ['createLedger', 'importLedger', 'reduce', 'trackSignals', 'exportLedger', 'deleteLedger']) {
      if (typeof learning?.[method] !== 'function') throw new TypeError(`Shuffle learning missing ${method}`);
    }
    for (const method of ['createBank', 'save', 'restore', 'evict']) {
      if (typeof scopes?.[method] !== 'function') throw new TypeError(`Shuffle scopes missing ${method}`);
    }
    if (typeof input.nowMs !== 'function' || typeof input.newId !== 'function') throw new TypeError('Shuffle controller requires injected nowMs and newId');
    const nowMs = () => {
      const value = input.nowMs();
      if (!integer(value)) throw new TypeError('nowMs must return a nonnegative safe integer');
      return value;
    };
    const newId = (kind) => {
      const value = input.newId(kind);
      if (!id(value)) throw new TypeError('newId must return a nonempty string');
      return value;
    };
    const onChange = typeof input.onChange === 'function' ? input.onChange : () => {};
    const originalSession = clone(input.sessionSnapshot ?? null);
    const originalLedger = clone(input.ledgerSnapshot ?? null);
    let session = null;
    let ledger = null;
    let readOnly = false;
    const diagnostics = [];
    let stagedContext = null;

    function restoredState(value) {
      try { return core.restore(value); }
      catch (error) { return { status: 'corrupt', state: null, diagnostics: [error.message] }; }
    }
    function validPosition(value) {
      return value === null || object(value) && id(value.trackId) && Number.isFinite(value.position) && value.position >= 0 &&
        Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 &&
        (value.historyOccurrenceId === null || id(value.historyOccurrenceId));
    }
    function validBinding(value) {
      return value === null || object(value) && id(value.occurrenceId) && id(value.historyOccurrenceId) && id(value.trackId) && id(value.decisionId) &&
        typeof value.personal === 'boolean' && (value.source === null || typeof value.source === 'string');
    }
    function loadSession(value) {
      // A raw portable Core state is also accepted as an explicit adapter
      // migration. Its policy/schema validation still belongs to Core.
      if (object(value) && !own(value, 'storeId') && own(value, 'policyVersion')) {
        const restored = restoredState(value);
        if (!restored.state) return { ok: false, reason: `session-${restored.status}` };
        diagnostics.push('imported-portable-core-state', ...(restored.diagnostics || []));
        return { ok: true, value: { storeId: STORE_ID, schemaVersion: SNAPSHOT_VERSION, revision: 0, activeScopeId: restored.state.scopeId,
          scopes: [{ scopeId: restored.state.scopeId, state: restored.state, position: null, listening: null }] } };
      }
      if (!object(value) || value.storeId !== STORE_ID || value.schemaVersion !== SNAPSHOT_VERSION) return { ok: false, reason: 'unsupported-session-wrapper' };
      if (value.scopeBankVersion !== undefined && value.scopeBankVersion !== scopes.VERSION) return { ok: false, reason: 'unsupported-scope-bank-version' };
      if (!integer(value.revision) || !id(value.activeScopeId) || !Array.isArray(value.scopes) || !value.scopes.length || value.scopes.length > scopes.MAX_SCOPES ||
          new Set(value.scopes.map((scope) => scope?.scopeId)).size !== value.scopes.length) return { ok: false, reason: 'corrupt-session-wrapper' };
      const restoredScopes = [];
      for (const scope of value.scopes) {
        if (!object(scope) || !id(scope.scopeId) || !validPosition(scope.position ?? null) || !validBinding(scope.listening ?? null)) return { ok: false, reason: 'corrupt-scope-wrapper' };
        const restored = restoredState(scope.state);
        if (!restored.state || restored.state.scopeId !== scope.scopeId) return { ok: false, reason: `scope-${restored.status}` };
        diagnostics.push(...(restored.diagnostics || []));
        restoredScopes.push({ ...clone(scope), state: restored.state, position: scope.position ? { ...clone(scope.position), paused: true } : null, listening: clone(scope.listening ?? null) });
      }
      if (!restoredScopes.some((scope) => scope.scopeId === value.activeScopeId)) return { ok: false, reason: 'missing-active-scope' };
      return { ok: true, value: { ...clone(value), scopes: restoredScopes } };
    }
    if (originalSession !== null) {
      const restored = loadSession(originalSession);
      if (restored.ok) session = restored.value;
      else { readOnly = true; diagnostics.push(restored.reason); }
    }
    if (originalLedger !== null) {
      let restored;
      try { restored = learning.importLedger(originalLedger); }
      catch (error) { restored = { ok: false, reason: error.message }; }
      if (restored.ok) ledger = restored.ledger;
      else { readOnly = true; diagnostics.push(`ledger-${restored.reason}`); }
    }
    function makeState(options) {
      const creation = { entries: options.entries || [], scopeId: options.scopeId, sessionId: options.sessionId || newId('shuffle-session'),
        authorityId: options.authorityId || input.authorityId || newId('shuffle-authority'), seed: options.seed ?? input.seed ?? newId('shuffle-seed'),
        mode: options.mode ?? input.mode, repeat: options.repeat ?? input.repeat, options: options.options ?? input.options };
      return options.legacy && typeof core.migrateLegacy === 'function'
        ? core.migrateLegacy(options.legacy.flowShuffle || options.legacy, creation) : core.createSession(creation);
    }
    if (!readOnly) {
      if (!ledger) ledger = learning.createLedger({ nowMs: nowMs() });
      if (!session) {
        const state = makeState(input);
        let position = null;
        const legacyPosition = input.legacy?.session;
        if (id(legacyPosition?.id) && Number.isFinite(legacyPosition.time) && Number.isFinite(legacyPosition.volume)) {
          position = { trackId: legacyPosition.id, historyOccurrenceId: core.currentOccurrence(state)?.occurrenceId || null,
            position: Math.max(0, legacyPosition.time), volume: Math.max(0, Math.min(1, legacyPosition.volume)), paused: true };
        }
        session = { storeId: STORE_ID, schemaVersion: SNAPSHOT_VERSION, scopeBankVersion: scopes.VERSION, scopeEvictions: [], revision: 0, activeScopeId: state.scopeId,
          scopes: [{ scopeId: state.scopeId, state, position, listening: null }] };
        if (input.legacy) diagnostics.push('legacy-traversal-only-no-listening-evidence');
      }
    }

    const active = () => session?.scopes.find((scope) => scope.scopeId === session.activeScopeId) || null;
    function scopeBank() {
      return { schemaVersion: scopes.VERSION, scopes: session.scopes.map((scope) => ({ scopeId: scope.scopeId, savedAtMs: scope.savedAtMs || 0, session: scope.state })), evictions: session.scopeEvictions || [] };
    }
    function status() {
      return { readOnly, diagnostics: [...new Set(diagnostics)], activeScopeId: session?.activeScopeId || null,
        revision: session?.revision ?? null, scopeCount: session?.scopes.length || 0,
        maxScopes: scopes.MAX_SCOPES, horizon: core.CONFIG.horizon, maxHorizon: core.CONFIG.maxHorizon,
        evictions: clone(session?.scopeEvictions || []), dependencies: [] };
    }
    function snapshot() { return { session: clone(readOnly ? originalSession : session), ledger: clone(readOnly ? originalLedger : ledger) }; }
    function blocked() { return { ok: false, status: 'read-only', diagnostics: status().diagnostics }; }
    function changed(reason) {
      session = { ...session, revision: session.revision + 1 };
      onChange({ reason, scopeId: session.activeScopeId, revision: session.revision, sessionRevision: active()?.state.revision, ledgerRevision: ledger.revision });
    }
    function updateState(next, reason) {
      const scope = active();
      if (next === scope.state) return { ok: true, status: 'unchanged' };
      scope.state = next; stagedContext = null; changed(reason);
      return { ok: true, status: 'changed', revision: next.revision };
    }
    function current() {
      if (readOnly) return null;
      const scope = active();
      const occurrence = core.currentOccurrence(scope.state);
      return occurrence ? clone({ ...occurrence, entry: scope.state.entries.find((entry) => entry.entryId === occurrence.entryId) || null,
        position: scope.position, learningOccurrenceId: scope.listening?.occurrenceId || null, paused: scope.state.paused }) : null;
    }
    function context() {
      const timestamp = nowMs();
      // Core's scalar trackSignals performs a row lookup. Feed one indexed row
      // per call to keep 10,000-track adapter context construction linear;
      // all formulas/decay still execute in the shared learning implementation.
      const byTrack = new Map(ledger.tracks.map((row) => [row.trackId, row]));
      const trackIds = [...new Set(active().state.entries.map((entry) => entry.trackId))];
      return { nowMs: timestamp, signals: trackIds.map((trackId) => ({ trackId,
        ...learning.trackSignals({ ...ledger, tracks: byTrack.has(trackId) ? [byTrack.get(trackId)] : [] }, trackId, { nowMs: timestamp }) })) };
    }
    function project(options = {}) {
      if (readOnly) return { ...blocked(), entryIds: [], decisions: [] };
      return clone(core.project(active().state, { ...options, context: context() }));
    }
    function stage(request = {}) {
      if (readOnly) return blocked();
      const scope = active();
      let entryId = request.entryId;
      if (entryId === undefined && request.trackId !== undefined) {
        const candidates = scope.state.entries.filter((entry) => entry.trackId === request.trackId);
        if (candidates.length !== 1) return { ok: false, status: candidates.length ? 'ambiguous-track-occurrence' : 'track-unavailable' };
        entryId = candidates[0].entryId;
      }
      const attemptId = request.attemptId || newId('shuffle-attempt');
      const advanceId = request.advanceId || (entryId === undefined && request.direction !== 'previous' && scope.state.quarantine?.entryIds.length
        ? scope.state.quarantine.advanceId : attemptId);
      const next = core.stage(scope.state, { direction: request.direction === 'previous' ? 'previous' : 'next', naturalEnd: request.naturalEnd === true,
        ...(entryId === undefined ? {} : { entryId }), attemptId, advanceId }, context());
      const prior = scope.state;
      scope.state = next;
      if (!next.pending) { stagedContext = null; if (next !== prior) changed('shuffle-stage-exhausted'); return { ok: false, status: 'exhausted', diagnostics: clone(next.diagnostics) }; }
      stagedContext = { decisionId: next.pending.decisionId, personal: request.personal !== false && !['remote', 'session', 'preview'].includes(request.source),
        source: request.source || null, durationMs: request.durationMs ?? null };
      if (next !== prior) changed('shuffle-stage');
      return { ok: true, status: 'staged', reservation: clone(next.pending), entryId: next.pending.entryId, trackId: next.pending.trackId,
        entry: clone(next.entries.find((entry) => entry.entryId === next.pending.entryId)), receipt: clone(next.pending.receipt) };
    }
    const token = (reservation) => reservation?.reservation || reservation;
    function matches(reservation) {
      const candidate = token(reservation);
      const state = active().state;
      const pending = state.pending;
      return Boolean(candidate && pending && ['attemptId', 'decisionId', 'revision', 'membershipRevision', 'authorityId', 'authorityEpoch', 'entryId', 'trackId']
        .every((field) => candidate[field] === pending[field]) && state.revision === pending.revision && state.membershipRevision === pending.membershipRevision &&
        state.authorityId === pending.authorityId && state.authorityEpoch === pending.authorityEpoch);
    }
    function applyEvent(event) {
      const normalized = { ...event, schemaVersion: learning.VERSION, eventId: event.eventId || newId('shuffle-event'),
        timestampMs: event.timestampMs ?? nowMs(), learningEpoch: event.learningEpoch ?? ledger.learningEpoch };
      if (normalized.source === null) delete normalized.source;
      const next = learning.reduce(ledger, normalized, { nowMs: nowMs() });
      if (next === ledger) return false;
      ledger = next;
      return true;
    }
    function confirm(reservation, details = {}) {
      if (readOnly) return blocked();
      if (!matches(reservation)) return { ok: false, status: 'stale-or-duplicate' };
      const scope = active();
      const pending = scope.state.pending;
      const metadata = { ...(stagedContext || {}), ...details };
      const next = core.commit(scope.state, token(reservation));
      if (next === scope.state) return { ok: false, status: 'not-activated' };
      scope.state = next;
      const occurrence = core.currentOccurrence(next);
      const learningOccurrenceId = JSON.stringify(['activation', pending.decisionId]);
      scope.listening = { occurrenceId: learningOccurrenceId, historyOccurrenceId: occurrence.occurrenceId, trackId: occurrence.trackId,
        decisionId: pending.decisionId, personal: metadata.personal !== false && !['remote', 'session', 'preview'].includes(metadata.source), source: metadata.source || null };
      scope.position = { trackId: occurrence.trackId, historyOccurrenceId: occurrence.occurrenceId, position: 0,
        volume: scope.position?.volume ?? 1, paused: true };
      const eventContext = { trackId: occurrence.trackId, personal: scope.listening.personal, source: scope.listening.source };
      applyEvent({ ...eventContext, type: 'offered', eventId: JSON.stringify(['offered', pending.decisionId]) });
      applyEvent({ ...eventContext, type: 'activated', occurrenceId: learningOccurrenceId, eventId: JSON.stringify(['activated', pending.decisionId]),
        durationMs: metadata.durationMs ?? null, replay: ['previous', 'forward', 'repeat-one'].includes(pending.kind) });
      stagedContext = null; changed('shuffle-activation');
      return { ok: true, status: 'confirmed', current: current(), receipt: clone(pending.receipt), learningOccurrenceId };
    }
    function fail(reservation, reason = 'playback-error') {
      if (readOnly) return blocked();
      if (!matches(reservation)) return { ok: false, status: 'stale-or-duplicate' };
      const result = updateState(core.abort(active().state, token(reservation)), 'shuffle-activation-failure');
      return { ...result, status: 'failed', reason, personalOutcomeRecorded: false };
    }
    function reconcile(entries) {
      if (readOnly) return blocked();
      const scope = active();
      const normalized = core.normalizeEntries(entries);
      if (JSON.stringify(normalized) === JSON.stringify(scope.state.entries)) return { ok: true, status: 'unchanged' };
      return updateState(core.reconcile(scope.state, entries), 'shuffle-membership');
    }
    function setMode(mode, options) { return readOnly ? blocked() : updateState(core.setMode(active().state, mode, options), 'shuffle-mode'); }
    function setRepeat(repeat) { return readOnly ? blocked() : updateState(core.reduce(active().state, { type: 'repeat-change', repeat }), 'shuffle-repeat'); }
    function mutate(action) {
      if (readOnly) return blocked();
      const prepared = { ...action };
      if (['priority', 'move'].includes(prepared.type) && !prepared.intentId) prepared.intentId = newId('shuffle-intent');
      return updateState(core.mutate(active().state, prepared), 'shuffle-mutation');
    }
    function newCycle() { return readOnly ? blocked() : updateState(core.newCycle(active().state), 'shuffle-new-cycle'); }
    function reshuffle() { return readOnly ? blocked() : updateState(core.reduce(active().state, { type: 'reshuffle-remaining' }), 'shuffle-remaining'); }
    function checkpointPosition(position) {
      if (readOnly) return blocked();
      const scope = active();
      const occurrence = core.currentOccurrence(scope.state);
      if (!occurrence || position?.trackId !== occurrence.trackId || !Number.isFinite(position.position) || !Number.isFinite(position.volume) ||
          position.historyOccurrenceId !== undefined && position.historyOccurrenceId !== occurrence.occurrenceId) return { ok: false, status: 'stale-or-invalid-position' };
      scope.position = { trackId: occurrence.trackId, historyOccurrenceId: occurrence.occurrenceId, position: Math.max(0, position.position),
        volume: Math.max(0, Math.min(1, position.volume)), paused: true };
      changed('shuffle-position'); return { ok: true, status: 'checkpointed' };
    }
    function selectScope(options) {
      if (readOnly) return blocked();
      if (!id(options?.scopeId)) return { ok: false, status: 'invalid-scope' };
      if (options.scopeId === session.activeScopeId) return options.entries === undefined ? { ok: true, status: 'unchanged' } : reconcile(options.entries);
      let scope = session.scopes.find((candidate) => candidate.scopeId === options.scopeId);
      if (!scope) {
        const state = makeState(options);
        const saved = scopes.save(scopeBank(), state, { nowMs: nowMs() });
        if (saved.status !== 'saved') return { ok: false, status: saved.status, diagnostics: ['unfinished-scopes-preserved'], unfinished: clone(saved.unfinished || []) };
        scope = { scopeId: options.scopeId, state: saved.bank.scopes.find((row) => row.scopeId === options.scopeId).session, savedAtMs: nowMs(), position: null, listening: null };
        session.scopes.push(scope);
      }
      const outgoing = active();
      outgoing.state = restoredState(outgoing.state).state;
      scope.state = scopes.restore(scopeBank(), scope.scopeId).state;
      session.activeScopeId = scope.scopeId;
      stagedContext = null;
      if (options.entries !== undefined) {
        const normalized = core.normalizeEntries(options.entries);
        if (JSON.stringify(normalized) !== JSON.stringify(scope.state.entries)) scope.state = core.reconcile(scope.state, options.entries);
      }
      changed('shuffle-scope'); return { ok: true, status: 'selected', scopeId: scope.scopeId };
    }
    function record(event) {
      if (readOnly) return blocked();
      if (!object(event)) return { ok: false, status: 'invalid-event' };
      const listening = active().listening;
      const prepared = { ...(listening ? { trackId: listening.trackId, occurrenceId: listening.occurrenceId, personal: listening.personal, source: listening.source } : {}), ...event };
      const didChange = applyEvent(prepared);
      if (didChange) changed(`shuffle-learning-${event.type}`);
      return { ok: didChange, status: didChange ? 'recorded' : 'ignored', revision: ledger.revision };
    }
    function interval(event) { return record({ ...event, type: 'interval' }); }
    function outcome(event) { return record({ ...event, type: 'outcome' }); }
    function preference(event, value, detail = {}) { return record(typeof event === 'string'
      ? { personal: true, source: null, ...detail, trackId: event, value, type: 'preference' }
      : { personal: true, source: null, ...event, type: 'preference' }); }
    function control(type, event = {}) {
      if (readOnly) return blocked();
      if (type === 'ledger-delete') { ledger = learning.deleteLedger(ledger, { enabled: ledger.enabled, nowMs: nowMs() }); changed('shuffle-ledger-delete'); return { ok: true, status: 'deleted' }; }
      if (!['learning-enabled', 'learning-reset', 'history-delete', 'track-delete'].includes(type)) return { ok: false, status: 'unknown-control' };
      return record({ ...event, type });
    }
    function exportActiveSession() { return readOnly ? null : clone(active().state); }
    function importActiveSession(value) {
      if (readOnly) return blocked();
      const restored = restoredState(value);
      if (!restored.state) return { ok: false, status: restored.status, preserved: clone(value), diagnostics: restored.diagnostics };
      const state = restored.state;
      let scope = session.scopes.find((candidate) => candidate.scopeId === state.scopeId);
      if (!scope) {
        const saved = scopes.save(scopeBank(), state, { nowMs: nowMs() });
        if (saved.status !== 'saved') return { ok: false, status: saved.status, preserved: clone(value), unfinished: clone(saved.unfinished || []) };
        scope = { scopeId: state.scopeId, state: saved.bank.scopes.find((row) => row.scopeId === state.scopeId).session, savedAtMs: nowMs(), position: null, listening: null }; session.scopes.push(scope);
      } else { scope.state = state; scope.position = null; scope.listening = null; }
      const outgoing = active();
      if (outgoing !== scope) outgoing.state = restoredState(outgoing.state).state;
      session.activeScopeId = state.scopeId; stagedContext = null; diagnostics.push(...(restored.diagnostics || [])); changed('shuffle-session-import');
      return { ok: true, status: 'imported', paused: true };
    }
    function exportLedger() { return readOnly ? clone(originalLedger) : learning.exportLedger(ledger, { includePrivate: true }); }
    function importLedger(value) {
      if (readOnly) return blocked();
      let result;
      try { result = learning.importLedger(value); } catch (error) { result = { ok: false, reason: error.message, preserved: clone(value) }; }
      if (!result.ok) return { ok: false, status: result.reason, preserved: clone(value) };
      ledger = result.ledger; changed('shuffle-ledger-import'); return { ok: true, status: 'imported' };
    }
    function setAuthority(authorityId, authorityEpoch) { return readOnly ? blocked() : updateState(core.reduce(active().state, { type: 'authority-change', authorityId, authorityEpoch }), 'shuffle-authority'); }
    function evictScope(scopeId) {
      if (readOnly) return blocked();
      if (scopeId === session.activeScopeId) return { ok: false, status: 'active-scope-requires-switch' };
      const result = scopes.evict(scopeBank(), scopeId, { nowMs: nowMs() });
      if (result.status !== 'evicted') return { ok: false, status: result.status };
      session.scopes = session.scopes.filter((scope) => scope.scopeId !== scopeId);
      session.scopeEvictions = clone(result.bank.evictions); changed('shuffle-scope-eviction');
      return { ok: true, status: result.status, diagnostic: clone(result.diagnostic) };
    }
    function entries() { return readOnly ? [] : clone(active().state.entries); }
    return Object.freeze({ snapshot, status, current, project, stage, confirm, fail, reconcile, setMode, setRepeat, mutate, newCycle, reshuffle, checkpointPosition,
      selectScope, evictScope, entries, record, interval, outcome, preference, control, exportActiveSession, activeState: exportActiveSession, importActiveSession, exportLedger, importLedger, setAuthority });
  }
  return Object.freeze({ STORE_ID, SNAPSHOT_VERSION, createController });
}));
