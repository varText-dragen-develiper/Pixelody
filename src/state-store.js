const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { WORKSPACE_STATE_KEY, createAuthority: createWorkspaceAuthority, workspaceStateKeyForProfile } = require('./workspace-composition/persistence');
const builtInThemes = require('./themes/built-in-themes.json');

const STORE_ID = 'pixelody.desktop.state';
const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_BACKUPS = 5;
const MAX_STORE_BYTES = 64 * 1024 * 1024;
const BACKUP_NAME_PATTERN = /^pixelody-state-\d+-r\d+\.json$/;
const WORKSPACE_THEME_IDS = Object.freeze(['pixelody-studio', 'studio', ...(builtInThemes.themes || []).map((theme) => theme.runtimeKey).filter(Boolean)]);

const ARRAY_VALUE_KEYS = new Set([
  'aurelia.library',
  'aurelia.playlists',
  'pixelody.speakerSystems',
  'pixelody.favorites',
  'pixelody.history',
  'pixelody.migrationReports',
  'pixelody.wantedTracks',
  'pixelody.queue',
  'pixelody.signalImportAuditHistory',
  'pixelody.watchedFolders',
  'pixelody.speakerRigValidationRuns',
]);

const OBJECT_VALUE_KEYS = new Set([
  'aurelia.tunings',
  'aurelia.systems',
  'pixelody.spatialProfiles',
  'pixelody.collectionBackgrounds',
  'pixelody.playCounts',
  'pixelody.signalJournal',
  'pixelody.signalSettings',
  'pixelody.flowShuffle',
  'pixelody.appearance',
  'pixelody.motionEffects',
  'pixelody.eqModes',
  'pixelody.interfaceSounds',
  'pixelody.systemTuningMode',
  'pixelody.speakerSystemPrototype',
  'pixelody.layout',
  'pixelody.cartridgeQuestStats',
  'pixelody.collapsedCards',
  'pixelody.collapsedSettingGroups',
  'pixelody.lastLatencyReport',
  'pixelody.lastMicCalibrationReport',
  'pixelody.session',
  'pixelody.signalImportUndo',
  'pixelody.signalImportAudit',
  'pixelody.playbackTransitions',
  WORKSPACE_STATE_KEY,
]);

const STRING_VALUE_KEYS = new Set([
  'aurelia.activePlaylist',
  'pixelody.libraryMode',
  'pixelody.repeat',
  'pixelody.sort',
  'pixelody.playlistSort',
  'pixelody.albumSort',
  'pixelody.activeSpeakerSystemId',
  'pixelody.profileImage',
  'pixelody.outputDeviceId',
  'pixelody.outputDeviceLabel',
  'pixelody.micInputDeviceId',
  'pixelody.micInputDeviceLabel',
  'pixelody.settingsTab',
  'pixelody.signalRange',
  'pixelody.signalAuditFilter',
  'pixelody.signalOrbitRepair',
]);

const BOOLEAN_VALUE_KEYS = new Set(['pixelody.shuffle']);
const NUMBER_VALUE_KEYS = new Set(['pixelody.volume', 'pixelody.lastAudibleVolume']);

// Every key this store knows how to validate. commitSync's replaceKnownValues
// sweeps exactly this set, which is what lets a restore REMOVE an entry rather
// than layer a backup over whatever is already there.
const KNOWN_VALUE_KEYS = new Set([
  ...ARRAY_VALUE_KEYS,
  ...OBJECT_VALUE_KEYS,
  ...STRING_VALUE_KEYS,
  ...BOOLEAN_VALUE_KEYS,
  ...NUMBER_VALUE_KEYS,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// Commits run on the Electron main process, where every full-library pass
// stalls window input and IPC for all windows. The envelope is written as
// compact JSON (pretty-printing made the file ~50% larger and slower to
// serialize); readers accept either form.
function serializeEnvelope(envelope) {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
}

function envelopeHeader(envelope) {
  return {
    storeId: envelope.storeId,
    schemaVersion: envelope.schemaVersion,
    revision: envelope.revision,
    committedAt: envelope.committedAt,
    reason: envelope.reason,
  };
}

function validateValueShapes(values) {
  if (!isPlainObject(values)) return { ok: false, error: 'State values must be an object.' };
  for (const [key, value] of Object.entries(values)) {
    if (ARRAY_VALUE_KEYS.has(key) && !Array.isArray(value)) return { ok: false, error: `${key} must be an array.` };
    if (OBJECT_VALUE_KEYS.has(key) && value !== null && !isPlainObject(value)) return { ok: false, error: `${key} must be an object or null.` };
    if (STRING_VALUE_KEYS.has(key) && typeof value !== 'string') return { ok: false, error: `${key} must be a string.` };
    if (BOOLEAN_VALUE_KEYS.has(key) && typeof value !== 'boolean') return { ok: false, error: `${key} must be a boolean.` };
    if (NUMBER_VALUE_KEYS.has(key) && !Number.isFinite(value)) return { ok: false, error: `${key} must be a finite number.` };
  }
  return { ok: true };
}

function validateWorkspaceValue(values, options = {}) {
  const workspaceStateKey = options.workspaceStateKey || WORKSPACE_STATE_KEY;
  if (options.workspaceAuthority && Object.prototype.hasOwnProperty.call(values, workspaceStateKey)) {
    const workspace = options.workspaceAuthority.normalizeState(values[workspaceStateKey]);
    if (!workspace.ok) return { ok: false, error: 'Workspace composition state is invalid.' };
  }
  return { ok: true };
}

function validateValues(values, options = {}) {
  const shapes = validateValueShapes(values);
  if (!shapes.ok) return shapes;
  const workspace = validateWorkspaceValue(values, options);
  if (!workspace.ok) return workspace;
  let serialized;
  try {
    serialized = JSON.stringify(values);
  } catch (error) {
    return { ok: false, error: `State values are not serializable: ${error.message}` };
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) return { ok: false, error: 'State values exceed the 64 MB safety limit.' };
  return { ok: true };
}

function normalizeEnvelope(raw, options = {}) {
  if (!isPlainObject(raw)) return { ok: false, kind: 'malformed', error: 'State envelope must be an object.' };
  if (Number(raw.schemaVersion) > CURRENT_SCHEMA_VERSION) {
    return { ok: false, kind: 'future-schema', error: `State schema ${raw.schemaVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}.`, raw };
  }
  let upgraded = raw;
  if (raw.schemaVersion === 0 || (raw.schemaVersion === undefined && isPlainObject(raw.state))) {
    upgraded = {
      ...raw,
      storeId: STORE_ID,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: Math.max(1, Number(raw.revision) || 1),
      committedAt: raw.committedAt || new Date(0).toISOString(),
      reason: raw.reason || 'schema-0-upgrade',
      values: cloneJson(raw.values || raw.state || {}),
      migration: isPlainObject(raw.migration) ? raw.migration : {},
    };
    delete upgraded.state;
  }
  if (upgraded.storeId !== STORE_ID) return { ok: false, kind: 'malformed', error: 'State store identifier is invalid.' };
  if (upgraded.schemaVersion !== CURRENT_SCHEMA_VERSION) return { ok: false, kind: 'malformed', error: 'State schema version is invalid.' };
  if (!Number.isInteger(upgraded.revision) || upgraded.revision < 1) return { ok: false, kind: 'malformed', error: 'State revision is invalid.' };
  let envelopeUpgraded = upgraded !== raw;
  if (options.workspaceAuthority) {
    const workspaceStateKey = options.workspaceStateKey || WORKSPACE_STATE_KEY;
    const workspace = options.workspaceAuthority.normalizeState(upgraded.values?.[workspaceStateKey]);
    upgraded = { ...upgraded, values: { ...(upgraded.values || {}), [workspaceStateKey]: workspace.state } };
    envelopeUpgraded = envelopeUpgraded || workspace.upgraded;
  }
  // `parsedFromText` marks an envelope freshly parsed from a size-checked file:
  // it is already JSON-safe, bounded, and owned by the caller, so the
  // re-serialization and defensive clone are skipped.
  const valuesResult = options.parsedFromText
    ? [validateValueShapes(upgraded.values), validateWorkspaceValue(upgraded.values, options)].find((result) => !result.ok) || { ok: true }
    : validateValues(upgraded.values, options);
  if (!valuesResult.ok) return { ok: false, kind: 'malformed', error: valuesResult.error };
  return { ok: true, envelope: options.parsedFromText ? upgraded : cloneJson(upgraded), upgraded: envelopeUpgraded };
}

function readJsonCandidate(filePath, options = {}) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_STORE_BYTES) return { exists: true, ok: false, kind: 'malformed', error: 'State file exceeds the 64 MB safety limit.' };
    const normalized = normalizeEnvelope(JSON.parse(text), { ...options, parsedFromText: true });
    return { exists: true, ...normalized };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, ok: false, kind: 'missing' };
    return { exists: true, ok: false, kind: 'malformed', error: error.message };
  }
}

function backupV1ToValues(backup, options = {}) {
  if (!isPlainObject(backup) || backup.version !== 1 || !Array.isArray(backup.tracks) || !Array.isArray(backup.playlists)) {
    return { ok: false, error: 'That file is not a compatible Pixelody version-1 backup.' };
  }
  const values = {
      'aurelia.library': backup.tracks.map((track) => ({ ...track, artworkPath: null, metadataVersion: 0, missing: false })),
      'aurelia.playlists': backup.playlists,
      'pixelody.collectionBackgrounds': backup.collectionBackgrounds || {},
      'aurelia.tunings': backup.tunings || {},
      'aurelia.systems': backup.systems || {},
      'pixelody.spatialProfiles': backup.spatialProfiles || backup.spatial || {},
      'pixelody.speakerSystems': backup.speakerSystems || [],
      'pixelody.activeSpeakerSystemId': backup.activeSpeakerSystemId || '',
      'pixelody.speakerSystemPrototype': backup.speakerSystemPrototype || {},
      'pixelody.eqModes': backup.eqModes || {},
      'pixelody.systemTuningMode': backup.systemTuningMode || {},
      'pixelody.favorites': backup.favorites || [],
      'pixelody.history': backup.history || [],
      'pixelody.playCounts': backup.playCounts || {},
      'pixelody.signalJournal': backup.signalJournal || {},
      'pixelody.signalSettings': backup.signalSettings || {},
      'pixelody.flowShuffle': backup.flowShuffle || {},
      'pixelody.migrationReports': backup.migrationReports || [],
      'pixelody.watchedFolders': backup.watchedFolders || [],
      'pixelody.wantedTracks': backup.wantedTracks || [],
      'pixelody.queue': backup.queue || [],
      'pixelody.appearance': backup.appearance || {},
      'pixelody.motionEffects': backup.motionEffects || {},
      'pixelody.interfaceSounds': backup.interfaceSounds || {},
      'pixelody.layout': backup.layout || {},
      'pixelody.profileImage': typeof backup.profileImage === 'string' ? backup.profileImage : '',
      'pixelody.cartridgeQuestStats': backup.cartridgeQuestStats || {},
    };
  const workspaceStateKey = options.workspaceStateKey || WORKSPACE_STATE_KEY;
  if (plainBackupWorkspace(backup.workspaceComposition)) values[workspaceStateKey] = backup.workspaceComposition;
  return {
    ok: true,
    values,
  };
}

function plainBackupWorkspace(value) {
  return isPlainObject(value) && Number(value.schemaVersion) >= 0;
}

class PixelodyStateStore {
  constructor(options = {}) {
    if (!options.directory) throw new Error('PixelodyStateStore requires a directory.');
    this.directory = options.directory;
    this.backupIntervalMs = Math.max(0, Number(options.backupIntervalMs ?? DEFAULT_BACKUP_INTERVAL_MS));
    this.maxBackups = Math.max(1, Number(options.maxBackups ?? DEFAULT_MAX_BACKUPS));
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.workspaceAuthority = options.workspaceAuthority || createWorkspaceAuthority({ now: this.now, themeIds: WORKSPACE_THEME_IDS });
    this.workspaceStateKey = options.workspaceStateKey || WORKSPACE_STATE_KEY;
    if (this.workspaceStateKey !== workspaceStateKeyForProfile(this.workspaceStateKey.slice(WORKSPACE_STATE_KEY.length + 1)) && this.workspaceStateKey !== WORKSPACE_STATE_KEY) {
      throw Object.assign(new Error('Workspace state key is invalid.'), { code: 'WORKSPACE_STATE_KEY_INVALID' });
    }
    this.paths = {
      current: path.join(this.directory, 'pixelody-state.json'),
      previous: path.join(this.directory, 'pixelody-state.previous.json'),
      temporary: path.join(this.directory, 'pixelody-state.pending.json'),
      backups: path.join(this.directory, 'backups'),
      quarantine: path.join(this.directory, 'quarantine'),
    };
    this.cachedEnvelope = null;
    // Serialized JSON of each top-level value of cachedEnvelope, valid only
    // while fragmentsFor === cachedEnvelope. A routine save changes a few keys,
    // so it re-serializes those and reuses the text of the (large) rest.
    this.fragments = null;
    this.fragmentsFor = null;
    // Load status without a state copy. It stays set after commits so later
    // commits merge against the in-memory envelope instead of re-reading and
    // re-validating the whole file from disk.
    this.lastLoad = null;
    this.writeQueue = Promise.resolve();
    this.asyncWritesInFlight = 0;
    this.pendingCommits = 0;
  }

  ensureDirectories() {
    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(this.paths.backups, { recursive: true });
    fs.mkdirSync(this.paths.quarantine, { recursive: true });
  }

  diagnostics(status, detail = {}) {
    return {
      status,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: this.cachedEnvelope?.revision || 0,
      recoveredFrom: detail.recoveredFrom || '',
      quarantined: detail.quarantined === true,
      legacyMigrationNeeded: detail.legacyMigrationNeeded === true,
      readOnly: detail.readOnly === true,
      message: String(detail.message || '').slice(0, 400),
      storage: 'userData/state',
      pathsHidden: true,
    };
  }

  quarantine(filePath, label) {
    if (!fs.existsSync(filePath)) return false;
    this.ensureDirectories();
    const suffix = `${this.now()}-${Math.random().toString(16).slice(2, 8)}`;
    fs.renameSync(filePath, path.join(this.paths.quarantine, `${label}-${suffix}.json`));
    return true;
  }

  promoteCandidate(candidatePath, envelope) {
    this.ensureDirectories();
    fs.writeFileSync(this.paths.current, serializeEnvelope(envelope));
  }

  // Callers may mutate what loadSync returns, so the state copy is made here,
  // once, rather than kept in lastLoad and cloned again.
  loadResult() {
    return {
      ...this.lastLoad,
      diagnostics: { ...this.lastLoad.diagnostics },
      state: this.cachedEnvelope && !this.lastLoad.readOnly ? cloneJson(this.cachedEnvelope) : null,
    };
  }

  loadSync() {
    // An async commit may be between its two renames, when the current file is
    // briefly absent; reading then would wrongly start recovery. The in-memory
    // envelope is already authoritative while a write is in flight.
    if (this.asyncWritesInFlight > 0 && this.lastLoad) return this.loadResult();
    this.ensureDirectories();
    const workspaceOptions = { workspaceAuthority: this.workspaceAuthority, workspaceStateKey: this.workspaceStateKey };
    const current = readJsonCandidate(this.paths.current, workspaceOptions);
    if (current.ok) {
      this.cachedEnvelope = current.envelope;
      if (current.upgraded) {
        const upgradedEnvelope = {
          ...current.envelope,
          revision: current.envelope.revision + 1,
          committedAt: new Date(this.now()).toISOString(),
          reason: 'schema-upgrade',
        };
        this.writeEnvelopeAtomic(upgradedEnvelope);
        this.cachedEnvelope = upgradedEnvelope;
      }
      this.lastLoad = { ok: true, status: current.upgraded ? 'upgraded' : 'ready', needsLegacyMigration: false, readOnly: false, diagnostics: this.diagnostics(current.upgraded ? 'upgraded' : 'ready') };
      return this.loadResult();
    }
    if (current.kind === 'future-schema') {
      this.lastLoad = { ok: false, status: 'unsupported-future-schema', needsLegacyMigration: false, readOnly: true, diagnostics: this.diagnostics('unsupported-future-schema', { readOnly: true, message: current.error }) };
      return this.loadResult();
    }

    let quarantined = false;
    if (current.exists) quarantined = this.quarantine(this.paths.current, 'current-invalid');
    const pending = readJsonCandidate(this.paths.temporary, workspaceOptions);
    if (pending.ok) {
      this.promoteCandidate(this.paths.temporary, pending.envelope);
      try { fs.rmSync(this.paths.temporary, { force: true }); } catch {}
      this.cachedEnvelope = pending.envelope;
      this.lastLoad = { ok: true, status: 'recovered', needsLegacyMigration: false, readOnly: false, diagnostics: this.diagnostics('recovered', { recoveredFrom: 'pending', quarantined }) };
      return this.loadResult();
    }
    if (pending.exists) quarantined = this.quarantine(this.paths.temporary, 'pending-invalid') || quarantined;

    const previous = readJsonCandidate(this.paths.previous, workspaceOptions);
    if (previous.ok) {
      this.promoteCandidate(this.paths.previous, previous.envelope);
      this.cachedEnvelope = previous.envelope;
      this.lastLoad = { ok: true, status: 'recovered', needsLegacyMigration: false, readOnly: false, diagnostics: this.diagnostics('recovered', { recoveredFrom: 'previous', quarantined }) };
      return this.loadResult();
    }

    this.cachedEnvelope = null;
    const status = quarantined ? 'recovery-defaults' : 'fresh';
    this.lastLoad = { ok: true, status, needsLegacyMigration: true, readOnly: false, diagnostics: this.diagnostics(status, { quarantined, legacyMigrationNeeded: true, message: quarantined ? 'Invalid state was quarantined; legacy migration or defaults are required.' : 'No durable state exists yet.' }) };
    return this.loadResult();
  }

  // Diagnostics without touching the disk; loads only if nothing has yet.
  diagnosticsSnapshot() {
    if (!this.lastLoad) return this.loadSync().diagnostics;
    return { ...this.lastLoad.diagnostics, revision: this.cachedEnvelope?.revision || 0 };
  }

  markCommitted(envelope, fragments = null) {
    this.cachedEnvelope = envelope;
    this.fragments = fragments;
    this.fragmentsFor = fragments ? envelope : null;
    this.lastLoad = { ok: true, status: 'committed', needsLegacyMigration: false, readOnly: false, diagnostics: this.diagnostics('committed') };
  }

  currentEnvelope() {
    if (!this.lastLoad) this.loadSync();
    return this.cachedEnvelope;
  }

  writeEnvelopeAtomic(envelope, serialized = serializeEnvelope(envelope), fragments = null) {
    this.ensureDirectories();
    if (serialized.length > MAX_STORE_BYTES) throw new Error('State envelope exceeds the 64 MB safety limit.');
    const descriptor = fs.openSync(this.paths.temporary, 'w');
    try {
      fs.writeFileSync(descriptor, serialized);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    // Byte-exact read-back proves the pending file is the envelope that was
    // just serialized and validated, without re-parsing the whole library.
    if (!fs.readFileSync(this.paths.temporary).equals(serialized)) throw new Error('Pending state validation failed: written bytes do not match.');
    if (fs.existsSync(this.paths.current)) {
      fs.rmSync(this.paths.previous, { force: true });
      fs.renameSync(this.paths.current, this.paths.previous);
    }
    fs.renameSync(this.paths.temporary, this.paths.current);
    this.markCommitted(envelope, fragments);
    this.rotateBackupIfDue(envelope);
  }

  // Same atomic sequence as writeEnvelopeAtomic, but disk I/O and fsync run on
  // the libuv pool so the Electron main process keeps handling input and IPC.
  async writeEnvelopeAtomicAsync(envelope, serialized = serializeEnvelope(envelope), fragments = null) {
    this.ensureDirectories();
    if (serialized.length > MAX_STORE_BYTES) throw new Error('State envelope exceeds the 64 MB safety limit.');
    this.asyncWritesInFlight += 1;
    try {
      const handle = await fsp.open(this.paths.temporary, 'w');
      try {
        await handle.writeFile(serialized);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (!(await fsp.readFile(this.paths.temporary)).equals(serialized)) throw new Error('Pending state validation failed: written bytes do not match.');
      if (fs.existsSync(this.paths.current)) {
        await fsp.rm(this.paths.previous, { force: true });
        await fsp.rename(this.paths.current, this.paths.previous);
      }
      await fsp.rename(this.paths.temporary, this.paths.current);
      this.markCommitted(envelope, fragments);
    } finally {
      this.asyncWritesInFlight -= 1;
    }
    await this.rotateBackupIfDueAsync(envelope);
  }

  backupPlan(entries) {
    const backups = entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const newestAge = backups[0] ? this.now() - backups[0].mtimeMs : Infinity;
    return { backups, due: newestAge >= this.backupIntervalMs };
  }

  backupTarget(envelope) {
    return path.join(this.paths.backups, `pixelody-state-${this.now()}-r${envelope.revision}.json`);
  }

  rotateBackupIfDue(envelope) {
    this.ensureDirectories();
    const { backups, due } = this.backupPlan(fs.readdirSync(this.paths.backups)
      .filter((name) => BACKUP_NAME_PATTERN.test(name))
      .map((name) => ({ name, path: path.join(this.paths.backups, name), mtimeMs: fs.statSync(path.join(this.paths.backups, name)).mtimeMs })));
    if (due) {
      const target = this.backupTarget(envelope);
      fs.copyFileSync(this.paths.current, target);
      backups.unshift({ name: path.basename(target), path: target, mtimeMs: this.now() });
    }
    backups.slice(this.maxBackups).forEach((backup) => fs.rmSync(backup.path, { force: true }));
  }

  async rotateBackupIfDueAsync(envelope) {
    const names = (await fsp.readdir(this.paths.backups)).filter((name) => BACKUP_NAME_PATTERN.test(name));
    const entries = await Promise.all(names.map(async (name) => {
      const backupPath = path.join(this.paths.backups, name);
      return { name, path: backupPath, mtimeMs: (await fsp.stat(backupPath)).mtimeMs };
    }));
    const { backups, due } = this.backupPlan(entries);
    if (due) {
      const target = this.backupTarget(envelope);
      await fsp.copyFile(this.paths.current, target);
      backups.unshift({ name: path.basename(target), path: target, mtimeMs: this.now() });
    }
    await Promise.all(backups.slice(this.maxBackups).map((backup) => fsp.rm(backup.path, { force: true })));
  }

  // Serializes the merged envelope exactly once. That single pass is the
  // serializability and size check, the bytes written to disk, and (parsed
  // back) the defensive copy kept as the in-memory envelope. The values were
  // previously cloned, validated, merged, pretty-printed and re-read from disk
  // on every commit, about six full-library passes on the main process.
  prepareCommit(values, options = {}) {
    if (!this.lastLoad) this.loadSync();
    if (this.lastLoad?.readOnly) return { result: { ok: false, status: 'read-only', error: this.lastLoad.diagnostics?.message || 'The state store is read-only.' } };
    if (!isPlainObject(values)) return { result: { ok: false, status: 'validation-error', error: 'State values must be an object.' } };
    // JSON drops these at the top level; skipping them before the merge keeps
    // the previously stored value, as cloning the values first used to.
    // fromEntries/spread define own properties, so a "__proto__" key stays data.
    const normalizedValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && typeof value !== 'function' && typeof value !== 'symbol'));
    if (Object.prototype.hasOwnProperty.call(normalizedValues, this.workspaceStateKey)) normalizedValues[this.workspaceStateKey] = this.workspaceAuthority.normalizeState(normalizedValues[this.workspaceStateKey]).state;
    const shapes = validateValueShapes(normalizedValues);
    if (!shapes.ok) return { result: { ok: false, status: 'validation-error', error: shapes.error } };
    const workspace = validateWorkspaceValue(normalizedValues, { workspaceAuthority: this.workspaceAuthority, workspaceStateKey: this.workspaceStateKey });
    if (!workspace.ok) return { result: { ok: false, status: 'validation-error', error: workspace.error } };
    const current = this.currentEnvelope();
    const currentValues = current?.values || {};
    // Both arms of this ternary were identical until 2026-09-20, so
    // replaceKnownValues was accepted and silently ignored and the store could
    // only ever merge. That is right for an ordinary commit -- a debounced
    // renderer tick carries only the keys it touched and must not erase the
    // rest -- but wrong for a restore, which has to be able to remove an entry:
    // a playlist deleted before the backup was taken has to stay deleted.
    //
    // The sweep is deliberately limited to KNOWN_VALUE_KEYS. Anything outside
    // that set survives a restore untouched, which covers profile-scoped
    // workspace slots and any key a later schema adds. The active workspace key
    // is retained for the same reason even though it is a known key: it has its
    // own authority and its own commit path, and a v1 backup taken before
    // Canvas existed has nothing to say about it. A backup that does carry
    // workspaceComposition still overwrites it, because normalizedValues wins.
    const retainedValues = {};
    if (options.replaceKnownValues) {
      for (const [key, value] of Object.entries(currentValues)) {
        if (!KNOWN_VALUE_KEYS.has(key) || key === this.workspaceStateKey) retainedValues[key] = value;
      }
    }
    const mergedValues = options.replaceKnownValues
      ? { ...retainedValues, ...normalizedValues }
      : { ...currentValues, ...normalizedValues };
    if (!Object.prototype.hasOwnProperty.call(mergedValues, this.workspaceStateKey)) mergedValues[this.workspaceStateKey] = this.workspaceAuthority.defaultState();
    // Only the keys this commit supplies are serialized (and parsed back as
    // the defensive copy kept in memory). Every other key reuses the text and
    // the object from the previous envelope, so a settings or position tick no
    // longer re-serializes the whole library on the main process.
    const reusable = this.fragments && this.fragmentsFor === current ? this.fragments : null;
    const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const fragments = new Map();
    const nextValues = {};
    const serializeError = (error) => ({ result: { ok: false, status: 'validation-error', error: `State values are not serializable: ${error.message}` } });
    try {
      for (const key of Object.keys(mergedValues)) {
        let fragment;
        let value;
        if (has(normalizedValues, key) || !has(currentValues, key)) {
          // Supplied by this commit (or newly defaulted): serialize it, and keep
          // the parsed-back copy so nothing the caller holds is shared.
          fragment = JSON.stringify(mergedValues[key]);
          if (fragment === undefined) fragment = 'null';
          value = JSON.parse(fragment);
        } else {
          value = currentValues[key];
          fragment = reusable && reusable.has(key) ? reusable.get(key) : JSON.stringify(value);
        }
        fragments.set(key, fragment);
        Object.defineProperty(nextValues, key, { value, enumerable: true, writable: true, configurable: true });
      }
    } catch (error) {
      return serializeError(error);
    }
    const header = {
      ...(current || {}),
      storeId: STORE_ID,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: Math.max(0, Number(current?.revision) || 0) + 1,
      committedAt: new Date(this.now()).toISOString(),
      reason: String(options.reason || 'renderer-persist').slice(0, 80),
      migration: {
        ...(isPlainObject(current?.migration) ? current.migration : {}),
        ...(isPlainObject(options.migration) ? options.migration : {}),
      },
    };
    const slot = JSON.stringify('pixelody-values-slot');
    let headerText;
    try { headerText = JSON.stringify({ ...header, values: JSON.parse(slot) }); } catch (error) { return serializeError(error); }
    if (headerText.indexOf(slot) < 0 || headerText.indexOf(slot) !== headerText.lastIndexOf(slot)) {
      return { result: { ok: false, status: 'validation-error', error: 'State header collides with the values slot.' } };
    }
    const valuesText = `{${[...fragments].map(([key, fragment]) => `${JSON.stringify(key)}:${fragment}`).join(',')}}`;
    const text = headerText.replace(slot, () => valuesText);
    const serialized = Buffer.from(`${text}
`, 'utf8');
    if (serialized.length > MAX_STORE_BYTES) return { result: { ok: false, status: 'validation-error', error: 'State values exceed the 64 MB safety limit.' } };
    return { envelope: { ...header, values: nextValues }, serialized, fragments };
  }

  // `includeState: false` returns only the envelope header. The renderer's
  // routine saves need the revision, not a full-library copy sent back over IPC.
  commitResult(envelope, options = {}) {
    return {
      ok: true,
      status: 'committed',
      state: options.includeState === false ? envelopeHeader(envelope) : cloneJson(envelope),
      diagnostics: this.diagnostics('committed'),
    };
  }

  commitSync(values, options = {}) {
    const prepared = this.prepareCommit(values, options);
    if (prepared.result) return prepared.result;
    this.writeEnvelopeAtomic(prepared.envelope, prepared.serialized, prepared.fragments);
    return this.commitResult(prepared.envelope, options);
  }

  // Writes without queueing; callers are already inside the write queue.
  async commitQueued(values, options = {}) {
    const prepared = this.prepareCommit(values, options);
    if (prepared.result) return prepared.result;
    await this.writeEnvelopeAtomicAsync(prepared.envelope, prepared.serialized, prepared.fragments);
    return this.commitResult(prepared.envelope, options);
  }

  // Every write goes through one queue, so commits never interleave their
  // renames, and pendingCommits lets the app drain the queue before exiting.
  enqueueWrite(operation) {
    this.pendingCommits += 1;
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined).finally(() => { this.pendingCommits -= 1; });
    return result;
  }

  commit(values, options = {}) {
    return this.enqueueWrite(() => this.commitQueued(values, options));
  }

  // Commits finish their disk I/O asynchronously, so the app must drain them
  // before exiting or the final save from a closing window could be lost.
  hasPendingWrites() {
    return this.pendingCommits > 0;
  }

  whenIdle() {
    return this.writeQueue;
  }

  migrateLegacy(values, malformedLegacyKeys = []) {
    const existing = this.currentEnvelope();
    if (existing) return Promise.resolve({ ok: true, status: 'already-migrated', state: cloneJson(existing), diagnostics: this.diagnostics('already-migrated') });
    return this.commit(values, {
      reason: 'legacy-local-storage-migration',
      migration: {
        legacyImportedAt: new Date(this.now()).toISOString(),
        legacyRecordsRetained: true,
        malformedLegacyKeys: Array.isArray(malformedLegacyKeys) ? malformedLegacyKeys.map(String).slice(0, 100) : [],
      },
    });
  }

  importBackupV1(backup, normalizedOverrides = {}) {
    const converted = backupV1ToValues(backup, { workspaceStateKey: this.workspaceStateKey });
    if (!converted.ok) return Promise.resolve(converted);
    const overridesValidation = validateValues(normalizedOverrides);
    if (!overridesValidation.ok) return Promise.resolve({ ok: false, status: 'validation-error', error: overridesValidation.error });
    return this.commit({ ...converted.values, ...cloneJson(normalizedOverrides) }, {
      // A restore replaces rather than merges; see commitSync.
      replaceKnownValues: true,
      reason: 'manual-backup-v1-import',
      migration: { lastManualBackupImportAt: new Date(this.now()).toISOString(), lastManualBackupVersion: 1 },
    });
  }

  workspaceSnapshot() {
    if (!this.lastLoad) this.loadSync();
    return cloneJson(this.currentEnvelope()?.values?.[this.workspaceStateKey] || this.workspaceAuthority.defaultState());
  }

  commitWorkspaceCompositionSync(candidateGraph, options = {}) {
    const result = this.workspaceAuthority.commit(this.workspaceSnapshot(), candidateGraph, options);
    if (!result.ok) return result;
    const committed = this.commitSync({ [this.workspaceStateKey]: result.state }, { reason: options.reason || 'workspace-composition-commit', includeState: false });
    return committed.ok ? { ...result, storeRevision: committed.state.revision, diagnostics: committed.diagnostics } : committed;
  }

  commitWorkspaceComposition(candidateGraph, options = {}) {
    return this.enqueueWrite(async () => {
      const result = this.workspaceAuthority.commit(this.workspaceSnapshot(), candidateGraph, options);
      if (!result.ok) return result;
      const committed = await this.commitQueued({ [this.workspaceStateKey]: result.state }, { reason: options.reason || 'workspace-composition-commit', includeState: false });
      return committed.ok ? { ...result, storeRevision: committed.state.revision, diagnostics: committed.diagnostics } : committed;
    });
  }

  cancelWorkspaceComposition(options = {}) {
    return Promise.resolve(this.workspaceAuthority.cancel(this.workspaceSnapshot(), options));
  }

  recordWorkspaceStartupSync(action, detail = {}) {
    let next;
    try { next = this.workspaceAuthority.startupAction(this.workspaceSnapshot(), action, detail); } catch (error) { return { ok: false, status: 'validation-error', code: error.code, error: error.message }; }
    const committed = this.commitSync({ [this.workspaceStateKey]: next }, { reason: `workspace-startup-${action}`, includeState: false });
    return committed.ok ? { ok: true, status: action, state: next, storeRevision: committed.state.revision, diagnostics: committed.diagnostics } : committed;
  }

  recordWorkspaceStartup(action, detail = {}) {
    return this.enqueueWrite(async () => {
      let next;
      try { next = this.workspaceAuthority.startupAction(this.workspaceSnapshot(), action, detail); } catch (error) { return { ok: false, status: 'validation-error', code: error.code, error: error.message }; }
      const committed = await this.commitQueued({ [this.workspaceStateKey]: next }, { reason: `workspace-startup-${action}`, includeState: false });
      return committed.ok ? { ok: true, status: action, state: next, storeRevision: committed.state.revision, diagnostics: committed.diagnostics } : committed;
    });
  }
}

module.exports = {
  ARRAY_VALUE_KEYS,
  BOOLEAN_VALUE_KEYS,
  CURRENT_SCHEMA_VERSION,
  MAX_STORE_BYTES,
  NUMBER_VALUE_KEYS,
  OBJECT_VALUE_KEYS,
  PixelodyStateStore,
  STORE_ID,
  STRING_VALUE_KEYS,
  WORKSPACE_STATE_KEY,
  WORKSPACE_THEME_IDS,
  backupV1ToValues,
  normalizeEnvelope,
  validateValues,
  workspaceStateKeyForProfile,
};
