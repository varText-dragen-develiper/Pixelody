const composition = require('./contract');
const specimens = require('./dev-lab-specimens');

const WORKSPACE_STATE_KEY = 'pixelody.workspaceComposition';
const WORKSPACE_PROFILE_ID_PATTERN = /^[a-z0-9-]{1,80}$/;
const WORKSPACE_STATE_SCHEMA_VERSION = 1;
const WORKSPACE_ID = 'primary';
const DEFAULT_THEME_ID = 'pixelody-studio';
const MAX_SUBSTITUTION_RECEIPTS = 64;
const SAFE_MODE_FAILURE_THRESHOLD = 3;
const DEFAULT_WATCHDOG_MS = 8000;

function clone(value) { return JSON.parse(composition.stableStringify(value)); }
function plain(value) { return composition.isPlainRecord(value); }
function boundedText(value, maximum = 120) { return String(value || '').slice(0, maximum); }
function nowIso(value) { return new Date(value).toISOString(); }

function workspaceStateKeyForProfile(profileId = '') {
  const normalized = String(profileId || '').trim().toLowerCase();
  if (!normalized) return WORKSPACE_STATE_KEY;
  if (!WORKSPACE_PROFILE_ID_PATTERN.test(normalized)) {
    throw Object.assign(new Error('Workspace profile identifier is invalid.'), { code: 'WORKSPACE_PROFILE_ID_INVALID' });
  }
  return `${WORKSPACE_STATE_KEY}.${normalized}`;
}

function defaultCatalog() {
  const catalog = Object.create(null);
  specimens.CATALOG_SPECIMENS.forEach((specimen) => {
    const descriptor = Object.freeze({
      productJobs: Object.freeze([...specimen.jobs]),
      shapes: Object.freeze([...specimen.shapes]),
      instancePolicy: specimen.instancePolicy || 'single',
      targetShape: specimen.defaultShape,
      defaultConfiguration: Object.freeze({}),
    });
    catalog[specimen.key] = descriptor;
    catalog[`fallback.${specimen.key}`] = descriptor;
  });
  return Object.freeze(catalog);
}

function defaultSubstitutions() {
  const substitutions = Object.create(null);
  specimens.CATALOG_SPECIMENS.forEach((specimen) => { substitutions[specimen.key] = `fallback.${specimen.key}`; });
  return Object.freeze(substitutions);
}

function receipt(type, detail = {}) {
  return Object.freeze({ type, at: boundedText(detail.at, 40), ...Object.fromEntries(Object.entries(detail).filter(([key]) => key !== 'at').map(([key, value]) => [key, typeof value === 'string' ? boundedText(value) : value])) });
}

function appendReceipts(existing, additions) {
  return Object.freeze([...(Array.isArray(existing) ? existing : []), ...additions].slice(-MAX_SUBSTITUTION_RECEIPTS).map((entry) => Object.freeze(clone(entry))));
}

function createAuthority(options = {}) {
  const moduleCatalog = options.moduleCatalog || defaultCatalog();
  const requiredJobs = Object.freeze([...(options.requiredJobs || specimens.REQUIRED_JOBS)]);
  const commitRequiredJobs = Object.freeze([...(options.commitRequiredJobs || requiredJobs)]);
  const creatorResult = composition.normalizeGraph(options.creatorDefaultGraph || specimens.GRAPH, { moduleCatalog, requiredJobs });
  if (!creatorResult.valid) throw Object.assign(new Error('Workspace creator-default graph is invalid.'), { code: 'WORKSPACE_CREATOR_INVALID', errors: creatorResult.errors });
  const creatorDefaultGraph = creatorResult.graph;
  const creatorSignature = creatorResult.signature;
  const moduleSubstitutions = Object.freeze({ ...defaultSubstitutions(), ...(options.moduleSubstitutions || {}) });
  const themeIds = new Set(options.themeIds || [DEFAULT_THEME_ID]);
  const defaultThemeId = themeIds.has(options.defaultThemeId) ? options.defaultThemeId : DEFAULT_THEME_ID;
  themeIds.add(defaultThemeId);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  function validationOptions() { return { moduleCatalog, requiredJobs }; }

  function baseStartup() {
    return Object.freeze({ status: 'idle', attempt: 0, consecutiveFailures: 0, safeMode: false, lastFailureCode: '', watchdogMs: DEFAULT_WATCHDOG_MS });
  }

  function defaultState(detail = {}) {
    const at = nowIso(now());
    const additions = detail.receipts || [];
    return composition.deepFreeze({
      schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceId: WORKSPACE_ID,
      revision: Math.max(1, Number(detail.revision) || 1),
      committedAt: at,
      graph: creatorDefaultGraph,
      graphSignature: creatorSignature,
      creatorDefaultGraph,
      creatorSignature,
      lastKnownGoodGraph: creatorDefaultGraph,
      lastKnownGoodSignature: creatorSignature,
      activeThemeId: defaultThemeId,
      substitutionReceipts: appendReceipts([], additions),
      recovery: Object.freeze({ status: detail.status || 'creator-default', recoveredFrom: detail.recoveredFrom || 'creator-default', sourceSchemaVersion: Number(detail.sourceSchemaVersion) || 0, message: boundedText(detail.message, 240) }),
      startup: Object.freeze({ ...baseStartup(), ...(detail.startup || {}) }),
    });
  }

  function migrateRaw(raw) {
    if (raw?.type === 'root') return { migrated: true, sourceSchemaVersion: 0, graph: raw, raw: {} };
    if (plain(raw) && (raw.schemaVersion === 0 || (raw.schemaVersion === undefined && raw.graph))) return { migrated: true, sourceSchemaVersion: Number(raw.schemaVersion) || 0, graph: raw.graph, raw };
    return { migrated: false, sourceSchemaVersion: Number(raw?.schemaVersion) || 0, graph: raw?.graph, raw };
  }

  function reconcileGraph(inputGraph, activeThemeId, at, validationRequiredJobs = requiredJobs) {
    const graph = clone(inputGraph);
    const additions = [];
    composition.walkGraph(graph, (node) => {
      if (node.type !== 'module') return;
      const descriptor = moduleCatalog[node.moduleKey];
      if (descriptor) {
        const shapes = Array.isArray(descriptor.shapes) ? descriptor.shapes : Object.keys(descriptor.shapes || {});
        if (!shapes.includes(node.shape)) {
          const priorShape = node.shape;
          node.shape = descriptor.targetShape || shapes[0];
          additions.push(receipt('shape-substitution', { at, nodeId: node.id, from: priorShape, to: node.shape }));
        }
        return;
      }
      const replacementKey = moduleSubstitutions[node.moduleKey];
      const replacement = moduleCatalog[replacementKey];
      if (!replacement) throw Object.assign(new Error(`Workspace module "${node.moduleKey}" is unavailable and has no trusted substitution.`), { code: 'WORKSPACE_MODULE_MISSING', moduleKey: node.moduleKey });
      const shapes = Array.isArray(replacement.shapes) ? replacement.shapes : Object.keys(replacement.shapes || {});
      const priorKey = node.moduleKey;
      node.moduleKey = replacementKey;
      if (!shapes.includes(node.shape)) node.shape = replacement.targetShape || shapes[0];
      node.configuration = clone(replacement.defaultConfiguration || {});
      additions.push(receipt('module-substitution', { at, nodeId: node.id, from: priorKey, to: replacementKey }));
    });
    let themeId = boundedText(activeThemeId || defaultThemeId, 120);
    if (!themeIds.has(themeId)) {
      additions.push(receipt('theme-substitution', { at, from: themeId, to: defaultThemeId }));
      themeId = defaultThemeId;
    }
    const normalized = composition.normalizeGraph(graph, { moduleCatalog, requiredJobs: validationRequiredJobs });
    if (!normalized.valid) throw Object.assign(new Error('Workspace graph failed trusted validation.'), { code: 'WORKSPACE_GRAPH_INVALID', errors: normalized.errors });
    return { graph: normalized.graph, signature: normalized.signature, activeThemeId: themeId, receipts: additions };
  }

  function normalizeState(raw) {
    const at = nowIso(now());
    if (raw === undefined || raw === null) return { ok: true, state: defaultState(), status: 'created', upgraded: true, receipts: [] };
    const migrated = migrateRaw(raw);
    if (migrated.sourceSchemaVersion > WORKSPACE_STATE_SCHEMA_VERSION) {
      const entry = receipt('future-schema-recovery', { at, from: String(migrated.sourceSchemaVersion), to: String(WORKSPACE_STATE_SCHEMA_VERSION) });
      return { ok: true, state: defaultState({ status: 'safe-mode', recoveredFrom: 'creator-default', sourceSchemaVersion: migrated.sourceSchemaVersion, message: 'A newer workspace schema was isolated; the creator layout remains available.', receipts: [entry], startup: { safeMode: true, lastFailureCode: 'WORKSPACE_FUTURE_SCHEMA' } }), status: 'future-schema-recovered', upgraded: true, receipts: [entry] };
    }
    if (!plain(migrated.raw) && !migrated.migrated) {
      const entry = receipt('malformed-recovery', { at, from: 'malformed', to: 'creator-default' });
      return { ok: true, state: defaultState({ status: 'recovered', message: 'Malformed workspace state was replaced without affecting other durable domains.', receipts: [entry] }), status: 'recovered', upgraded: true, receipts: [entry] };
    }
    const source = migrated.raw || {};
    const existingReceipts = Array.isArray(source.substitutionReceipts) ? source.substitutionReceipts : [];
    const migrationReceipt = migrated.migrated ? [receipt('schema-migration', { at, from: String(migrated.sourceSchemaVersion), to: String(WORKSPACE_STATE_SCHEMA_VERSION) })] : [];
    let selected;
    let recoveredFrom = 'current';
    let recoveryStatus = migrated.migrated ? 'migrated' : 'ready';
    const recoveryReceipts = [];
    try {
      selected = reconcileGraph(migrated.graph, source.activeThemeId, at);
    } catch (currentError) {
      try {
        selected = reconcileGraph(source.lastKnownGoodGraph, source.activeThemeId, at);
        recoveredFrom = 'last-known-good';
      } catch {
        selected = { graph: creatorDefaultGraph, signature: creatorSignature, activeThemeId: defaultThemeId, receipts: [] };
        recoveredFrom = 'creator-default';
      }
      recoveryStatus = 'recovered';
      recoveryReceipts.push(receipt('graph-recovery', { at, from: boundedText(currentError.code || 'WORKSPACE_GRAPH_INVALID'), to: recoveredFrom }));
    }
    let lastKnownGood;
    try { lastKnownGood = reconcileGraph(source.lastKnownGoodGraph || selected.graph, source.activeThemeId, at); } catch { lastKnownGood = { graph: creatorDefaultGraph, signature: creatorSignature }; }
    const revision = Math.max(1, Math.trunc(Number(source.revision) || 1));
    const startupSource = plain(source.startup) ? source.startup : {};
    const startup = Object.freeze({
      status: ['idle', 'pending', 'healthy', 'failed'].includes(startupSource.status) ? startupSource.status : 'idle',
      attempt: Math.max(0, Math.trunc(Number(startupSource.attempt) || 0)),
      consecutiveFailures: Math.max(0, Math.min(100, Math.trunc(Number(startupSource.consecutiveFailures) || 0))),
      safeMode: startupSource.safeMode === true,
      lastFailureCode: boundedText(startupSource.lastFailureCode, 120),
      watchdogMs: Math.max(1000, Math.min(30000, Math.trunc(Number(startupSource.watchdogMs) || DEFAULT_WATCHDOG_MS))),
    });
    const allReceipts = [...migrationReceipt, ...selected.receipts, ...recoveryReceipts];
    const state = composition.deepFreeze({
      schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceId: WORKSPACE_ID,
      revision,
      committedAt: typeof source.committedAt === 'string' ? boundedText(source.committedAt, 40) : at,
      graph: selected.graph,
      graphSignature: selected.signature,
      creatorDefaultGraph,
      creatorSignature,
      lastKnownGoodGraph: lastKnownGood.graph,
      lastKnownGoodSignature: lastKnownGood.signature,
      activeThemeId: selected.activeThemeId,
      substitutionReceipts: appendReceipts(existingReceipts, allReceipts),
      recovery: Object.freeze({ status: recoveryStatus, recoveredFrom, sourceSchemaVersion: migrated.sourceSchemaVersion, message: recoveryReceipts.length ? 'Workspace recovered atomically before paint.' : '' }),
      startup,
    });
    const upgraded = migrated.migrated || allReceipts.length > 0 || source.schemaVersion !== WORKSPACE_STATE_SCHEMA_VERSION || source.creatorSignature !== creatorSignature;
    return { ok: true, state, status: recoveryStatus, upgraded, receipts: allReceipts };
  }

  function commit(currentRaw, candidateGraph, options = {}) {
    const current = normalizeState(currentRaw).state;
    const expectedRevision = Number(options.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) return { ok: false, status: 'revision-conflict', error: `Workspace revision ${expectedRevision} does not match current revision ${current.revision}.`, state: current };
    let reconciled;
    try { reconciled = reconcileGraph(candidateGraph, options.activeThemeId || current.activeThemeId, nowIso(now()), commitRequiredJobs); } catch (error) { return { ok: false, status: 'validation-error', error: error.message, code: error.code, state: current }; }
    if (reconciled.signature === current.graphSignature && reconciled.activeThemeId === current.activeThemeId) return { ok: false, status: 'no-change', error: 'Workspace commit did not change graph or theme identity.', state: current };
    const at = nowIso(now());
    const next = composition.deepFreeze({
      ...current,
      revision: current.revision + 1,
      committedAt: at,
      graph: reconciled.graph,
      graphSignature: reconciled.signature,
      lastKnownGoodGraph: current.graph,
      lastKnownGoodSignature: current.graphSignature,
      activeThemeId: reconciled.activeThemeId,
      substitutionReceipts: appendReceipts(current.substitutionReceipts, reconciled.receipts),
      recovery: Object.freeze({ status: 'ready', recoveredFrom: 'current', sourceSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, message: '' }),
    });
    return { ok: true, status: 'committed', state: next };
  }

  function cancel(currentRaw, options = {}) {
    const current = normalizeState(currentRaw).state;
    const expectedRevision = Number(options.expectedRevision);
    if (Number.isInteger(expectedRevision) && expectedRevision !== current.revision) return { ok: false, status: 'revision-conflict', error: `Workspace revision ${expectedRevision} does not match current revision ${current.revision}.`, state: current };
    return { ok: true, status: 'cancelled', state: current, wrote: false };
  }

  function startupAction(currentRaw, action, detail = {}) {
    const current = normalizeState(currentRaw).state;
    const at = nowIso(now());
    let startup = { ...current.startup };
    let graph = current.graph;
    let signature = current.graphSignature;
    let receipts = current.substitutionReceipts;
    if (action === 'begin') {
      if (startup.status === 'pending') startup.consecutiveFailures += 1;
      startup.status = 'pending';
      startup.attempt += 1;
      startup.watchdogMs = Math.max(1000, Math.min(30000, Math.trunc(Number(detail.watchdogMs) || DEFAULT_WATCHDOG_MS)));
    } else if (action === 'healthy') {
      startup = { ...startup, status: 'healthy', consecutiveFailures: 0, safeMode: false, lastFailureCode: '' };
    } else if (action === 'failed') {
      startup.status = 'failed';
      startup.consecutiveFailures += 1;
      startup.lastFailureCode = boundedText(detail.errorCode || 'WORKSPACE_STARTUP_FAILED', 120);
    } else throw Object.assign(new Error(`Unknown workspace startup action "${action}".`), { code: 'WORKSPACE_STARTUP_ACTION_INVALID' });
    if (startup.consecutiveFailures >= SAFE_MODE_FAILURE_THRESHOLD) {
      startup.safeMode = true;
      graph = creatorDefaultGraph;
      signature = creatorSignature;
      receipts = appendReceipts(receipts, [receipt('startup-safe-mode', { at, from: startup.lastFailureCode || 'repeated-unconfirmed-startup', to: 'creator-default' })]);
    }
    return composition.deepFreeze({
      ...current,
      revision: current.revision + 1,
      committedAt: at,
      graph,
      graphSignature: signature,
      lastKnownGoodGraph: action === 'healthy' ? current.graph : current.lastKnownGoodGraph,
      lastKnownGoodSignature: action === 'healthy' ? current.graphSignature : current.lastKnownGoodSignature,
      substitutionReceipts: receipts,
      recovery: startup.safeMode ? Object.freeze({ status: 'safe-mode', recoveredFrom: 'creator-default', sourceSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, message: 'Repeated startup failures activated the creator-safe layout.' }) : current.recovery,
      startup: Object.freeze(startup),
    });
  }

  return Object.freeze({ moduleCatalog, requiredJobs, commitRequiredJobs, creatorDefaultGraph, creatorSignature, defaultThemeId, validationOptions, defaultState, normalizeState, commit, cancel, startupAction });
}

class WorkspaceStartupWatchdog {
  constructor(options = {}) {
    this.delayMs = Math.max(1000, Math.min(30000, Number(options.delayMs) || DEFAULT_WATCHDOG_MS));
    this.onExpired = typeof options.onExpired === 'function' ? options.onExpired : () => {};
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.timer = null;
  }
  begin() { this.cancel(); this.timer = this.setTimer(() => { this.timer = null; this.onExpired(); }, this.delayMs); }
  healthy() { this.cancel(); }
  cancel() { if (this.timer !== null) this.clearTimer(this.timer); this.timer = null; }
}

module.exports = {
  DEFAULT_THEME_ID,
  DEFAULT_WATCHDOG_MS,
  MAX_SUBSTITUTION_RECEIPTS,
  SAFE_MODE_FAILURE_THRESHOLD,
  WORKSPACE_ID,
  WORKSPACE_STATE_KEY,
  WORKSPACE_STATE_SCHEMA_VERSION,
  WorkspaceStartupWatchdog,
  createAuthority,
  defaultCatalog,
  defaultSubstitutions,
  workspaceStateKeyForProfile,
};
