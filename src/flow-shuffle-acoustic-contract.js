(function flowShuffleAcousticContractFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyFlowShuffleAcousticContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFlowShuffleAcousticContract() {
  'use strict';

  // Phase 0 contract for local acoustic analysis.
  //
  // This module is deliberately pure: no Electron, no filesystem, no clock, no
  // decoder, no DSP. It exists so the profile, job, provenance, and invalidation
  // semantics can be frozen and tested BEFORE any decoder is chosen, which is the
  // one ordering that stops a later surface from being built on values that do not
  // yet mean anything.
  //
  // It does not replace src/flow-shuffle-acoustic.js. That file remains the older
  // PCM prototype and its existing check still covers it unchanged. Nothing here
  // claims that production analysis exists.

  const SCHEMA_VERSION = 1;

  // Bump ALGORITHM_VERSION whenever any feature's numeric output changes. Stored
  // profiles carrying a different value are stale by definition, which is what
  // stops one library from silently mixing two generations of feature math.
  const ALGORITHM_VERSION = 'pixelody-acoustic-v0-contract';

  // Separate from ALGORITHM_VERSION on purpose: the similarity vector can stay
  // compatible across feature revisions, or break while other features hold. Two
  // tracks may only be compared when this matches exactly.
  const SIMILARITY_VECTOR_VERSION = null;

  const PROFILE_STATUS = Object.freeze([
    'complete',
    'failed',
    'unsupported',
    'cancelled',
  ]);

  const FRESHNESS = Object.freeze([
    'current',
    'stale-file',
    'stale-algorithm',
    'stale-schema',
    'unsupported',
    'invalid',
    'absent',
  ]);

  const JOB_STATUS = Object.freeze([
    'idle',
    'running',
    'paused',
    'cancelled',
    'complete',
  ]);

  const FAILURE_KIND = Object.freeze([
    'decode-unsupported',
    'decode-corrupt',
    'file-missing',
    'permission-denied',
    'too-short',
    'worker-error',
    'store-error',
    'cancelled',
    'unknown',
  ]);

  // Analyzed values below these thresholds stay neutral. They are intentionally
  // conservative: a wrong tempo shown as fact is worse than no tempo, and Flow
  // treats unavailable as neutral rather than as a penalty.
  const CONFIDENCE_FLOOR = Object.freeze({
    tempo: 0.5,
    key: 0.6,
    loudness: 0.5,
    similarity: 0.5,
  });

  // The existing four-point acoustic cap is preserved for the first integrated
  // version. Raising it is a product decision that needs evidence, not a constant.
  const MAX_ACOUSTIC_POINTS = 4;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const finiteOrNull = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  // Nullable means UNAVAILABLE, never zero. A track with no measurable loudness
  // and a track measured at 0 LUFS are completely different facts, and collapsing
  // them is how "unavailable" quietly becomes "silent" or "120 BPM".
  const boundedOrNull = (value, min, max) => {
    const number = finiteOrNull(value);
    if (number === null) return null;
    if (number < min || number > max) return null;
    return number;
  };

  const confidence = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Number(clamp(number, 0, 1).toFixed(3)) : 0;
  };

  const methodOf = (value, fallback) => {
    const text = String(value == null ? '' : value).trim();
    return text ? text.slice(0, 64) : fallback;
  };

  const stringOrEmpty = (value, limit) => String(value == null ? '' : value).trim().slice(0, limit);

  const warningList = (value) => {
    if (!Array.isArray(value)) return [];
    const seen = [];
    for (const entry of value) {
      const text = stringOrEmpty(entry, 120);
      if (text && !seen.includes(text)) seen.push(text);
      if (seen.length >= 8) break;
    }
    return seen;
  };

  function normalizeFileIdentity(source) {
    const input = source && typeof source === 'object' ? source : {};
    return {
      size: Math.max(0, Math.round(finiteOrNull(input.size) || 0)),
      modifiedMs: Math.max(0, Math.round(finiteOrNull(input.modifiedMs) || 0)),
      // A bounded token, never a path. Paths must not reach a stored profile,
      // an export, a diagnostic, or a J.A.M. payload.
      contentToken: stringOrEmpty(input.contentToken, 64),
    };
  }

  function normalizeCoverage(source) {
    const input = source && typeof source === 'object' ? source : {};
    return {
      strategy: input.strategy === 'representative-windows' ? 'representative-windows'
        : input.strategy === 'whole-track' ? 'whole-track'
          : 'leading-window',
      durationSeconds: boundedOrNull(input.durationSeconds, 0, 86400),
      analyzedSeconds: boundedOrNull(input.analyzedSeconds, 0, 86400),
      sourceSampleRate: boundedOrNull(input.sourceSampleRate, 1, 768000),
      analysisSampleRate: boundedOrNull(input.analysisSampleRate, 1, 768000),
      sourceChannels: boundedOrNull(input.sourceChannels, 1, 64),
      analysisChannels: boundedOrNull(input.analysisChannels, 1, 64),
      decoder: stringOrEmpty(input.decoder, 48),
    };
  }

  function normalizeFeatures(source) {
    const input = source && typeof source === 'object' ? source : {};
    const tempo = input.tempo && typeof input.tempo === 'object' ? input.tempo : {};
    const key = input.key && typeof input.key === 'object' ? input.key : {};
    const loudness = input.loudness && typeof input.loudness === 'object' ? input.loudness : {};
    const dynamics = input.dynamics && typeof input.dynamics === 'object' ? input.dynamics : {};
    const spectral = input.spectral && typeof input.spectral === 'object' ? input.spectral : {};
    const energy = input.energy && typeof input.energy === 'object' ? input.energy : {};

    return {
      tempo: {
        bpm: boundedOrNull(tempo.bpm, 20, 300),
        confidence: confidence(tempo.confidence),
        // Half/double-time ambiguity is reported, never silently resolved. The
        // caller usually has more context (library, genre, neighbours) than the
        // detector does.
        alternateBpm: boundedOrNull(tempo.alternateBpm, 20, 300),
        stable: tempo.stable === true,
        method: methodOf(tempo.method, 'unavailable'),
      },
      key: {
        value: stringOrEmpty(key.value, 24) || null,
        // Camelot is carried separately because a key and its relative
        // major/minor share a Camelot NUMBER. That number survives the single
        // most common key-detection error, so it is the field worth trusting.
        camelot: stringOrEmpty(key.camelot, 4) || null,
        confidence: confidence(key.confidence),
        modeConfidence: confidence(key.modeConfidence),
        method: methodOf(key.method, 'unavailable'),
      },
      loudness: {
        integratedLufs: boundedOrNull(loudness.integratedLufs, -120, 12),
        rangeLu: boundedOrNull(loudness.rangeLu, 0, 60),
        samplePeakDbfs: boundedOrNull(loudness.samplePeakDbfs, -120, 12),
        // Stays null until real oversampling exists. Reporting sample peak as
        // true peak is a claim the implementation has not earned.
        truePeakDbtp: boundedOrNull(loudness.truePeakDbtp, -120, 12),
        method: methodOf(loudness.method, 'unavailable'),
      },
      dynamics: {
        crestFactorDb: boundedOrNull(dynamics.crestFactorDb, 0, 60),
        transientDensity: boundedOrNull(dynamics.transientDensity, 0, 1),
        onsetRate: boundedOrNull(dynamics.onsetRate, 0, 100),
        method: methodOf(dynamics.method, 'unavailable'),
      },
      spectral: {
        centroidHz: boundedOrNull(spectral.centroidHz, 0, 384000),
        rolloffHz: boundedOrNull(spectral.rolloffHz, 0, 384000),
        flatness: boundedOrNull(spectral.flatness, 0, 1),
        bandEnergy: normalizeBandEnergy(spectral.bandEnergy),
        method: methodOf(spectral.method, 'unavailable'),
      },
      energy: {
        value: boundedOrNull(energy.value, 0, 1),
        confidence: confidence(energy.confidence),
        method: methodOf(energy.method, 'unavailable'),
      },
    };
  }

  // Bounded on purpose. Large FFT frames, onset arrays, and full spectrograms are
  // never persisted; only a compact band summary is.
  function normalizeBandEnergy(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value.slice(0, 64)) {
      const number = boundedOrNull(entry, -200, 60);
      if (number === null) return [];
      out.push(Number(number.toFixed(2)));
    }
    return out;
  }

  function normalizeSimilarityVector(source) {
    const input = source && typeof source === 'object' ? source : {};
    const version = stringOrEmpty(input.version, 48) || null;
    if (!version) return { version: null, values: [] };
    if (!Array.isArray(input.values) || !input.values.length) return { version: null, values: [] };
    const values = [];
    for (const entry of input.values.slice(0, 64)) {
      const number = finiteOrNull(entry);
      // A single non-finite entry invalidates the whole vector rather than being
      // coerced to zero, which would silently move a track in similarity space.
      if (number === null) return { version: null, values: [] };
      values.push(Number(clamp(number, -1, 1).toFixed(5)));
    }
    return { version, values };
  }

  /**
   * Normalize a stored or freshly produced acoustic profile.
   *
   * Accepts anything and returns the frozen shape. Unavailable stays unavailable.
   * `analyzedAt` is passed in rather than read from a clock so tests are
   * deterministic without a fixed epoch masquerading as a real timestamp.
   */
  function normalizeProfile(source, options) {
    const input = source && typeof source === 'object' ? source : {};
    const config = options && typeof options === 'object' ? options : {};
    const status = PROFILE_STATUS.includes(input.status) ? input.status : 'failed';
    const failure = status === 'complete' ? '' : stringOrEmpty(input.failureReason, 64);

    return {
      schemaVersion: Math.max(0, Math.round(finiteOrNull(input.schemaVersion) || SCHEMA_VERSION)),
      algorithmVersion: stringOrEmpty(input.algorithmVersion, 64) || ALGORITHM_VERSION,
      trackId: stringOrEmpty(input.trackId, 128),
      source: 'local-acoustic-analysis',
      status,
      failureKind: FAILURE_KIND.includes(input.failureKind) ? input.failureKind
        : (status === 'complete' ? '' : 'unknown'),
      failureReason: failure,
      analyzedAt: stringOrEmpty(input.analyzedAt || config.analyzedAt, 32),
      fileIdentity: normalizeFileIdentity(input.fileIdentity),
      coverage: normalizeCoverage(input.coverage),
      features: normalizeFeatures(input.features),
      similarityVector: normalizeSimilarityVector(input.similarityVector),
      warnings: warningList(input.warnings),
    };
  }

  /**
   * Decide whether a stored profile may influence anything.
   *
   * Returns one of FRESHNESS. Only 'current' is usable; every other value must be
   * treated as neutral by Flow, not as evidence against a track.
   */
  function profileFreshness(profile, expected) {
    if (!profile || typeof profile !== 'object') return 'absent';
    const want = expected && typeof expected === 'object' ? expected : {};

    if (!PROFILE_STATUS.includes(profile.status)) return 'invalid';
    if (profile.status === 'unsupported') return 'unsupported';
    if (profile.status !== 'complete') return 'invalid';
    if (profile.source !== 'local-acoustic-analysis') return 'invalid';

    const schema = Number(profile.schemaVersion);
    if (!Number.isFinite(schema)) return 'invalid';
    const wantSchema = Number.isFinite(Number(want.schemaVersion)) ? Number(want.schemaVersion) : SCHEMA_VERSION;
    if (schema !== wantSchema) return 'stale-schema';

    const wantAlgorithm = stringOrEmpty(want.algorithmVersion, 64) || ALGORITHM_VERSION;
    if (stringOrEmpty(profile.algorithmVersion, 64) !== wantAlgorithm) return 'stale-algorithm';

    // File identity is checked last because it is the most likely to differ in
    // normal use, and a mismatch here is the least alarming: the user simply
    // re-tagged or re-encoded the file.
    const identity = want.fileIdentity && typeof want.fileIdentity === 'object' ? want.fileIdentity : null;
    if (identity) {
      const stored = normalizeFileIdentity(profile.fileIdentity);
      const current = normalizeFileIdentity(identity);
      if (stored.size !== current.size) return 'stale-file';
      if (stored.modifiedMs !== current.modifiedMs) return 'stale-file';
      // The token only strengthens invalidation when both sides have one.
      if (stored.contentToken && current.contentToken && stored.contentToken !== current.contentToken) {
        return 'stale-file';
      }
    }
    return 'current';
  }

  const isUsableProfile = (profile, expected) => profileFreshness(profile, expected) === 'current';

  /**
   * The small view Flow scoring is allowed to see.
   *
   * Deliberately much smaller than the diagnostic profile: injecting a full
   * feature payload into every track object is how a scoring path ends up
   * carrying megabytes and leaking fields nobody audited. Returns null when the
   * profile may not be used at all.
   */
  function scoringView(profile, expected) {
    if (!isUsableProfile(profile, expected)) return null;
    const normalized = normalizeProfile(profile);
    const features = normalized.features;
    const vector = normalized.similarityVector;

    return {
      schemaVersion: normalized.schemaVersion,
      algorithmVersion: normalized.algorithmVersion,
      tempoBpm: features.tempo.confidence >= CONFIDENCE_FLOOR.tempo ? features.tempo.bpm : null,
      tempoConfidence: features.tempo.confidence,
      keyCamelot: features.key.confidence >= CONFIDENCE_FLOOR.key ? features.key.camelot : null,
      keyConfidence: features.key.confidence,
      integratedLufs: features.loudness.integratedLufs,
      energy: features.energy.confidence >= CONFIDENCE_FLOOR.similarity ? features.energy.value : null,
      similarityVectorVersion: vector.version,
      similarityVector: vector.values,
    };
  }

  /**
   * Resolve a value across provenance tiers without mutating stored metadata.
   *
   * manual > tagged > confident analyzed > unavailable.
   *
   * Automatic analysis must never overwrite track.bpm or track.musicalKey; it
   * only supplies a fallback at decision time. The returned `agreement` field
   * lets the UI surface a non-blocking discrepancy without changing behaviour.
   */
  function resolveValue(sources, options) {
    const input = sources && typeof sources === 'object' ? sources : {};
    const config = options && typeof options === 'object' ? options : {};
    const floor = Number.isFinite(Number(config.confidenceFloor)) ? Number(config.confidenceFloor) : 0.5;
    const equals = typeof config.equals === 'function' ? config.equals : (a, b) => a === b;
    const valid = typeof config.valid === 'function' ? config.valid : (v) => v !== null && v !== undefined && v !== '';

    const manual = valid(input.manual) ? input.manual : null;
    const tagged = valid(input.tagged) ? input.tagged : null;
    const analyzedConfident = valid(input.analyzed) && confidence(input.analyzedConfidence) >= floor
      ? input.analyzed
      : null;

    let value = null;
    let provenance = 'unavailable';
    if (manual !== null) { value = manual; provenance = 'manual'; }
    else if (tagged !== null) { value = tagged; provenance = 'tagged'; }
    else if (analyzedConfident !== null) { value = analyzedConfident; provenance = 'local analysis'; }

    // Agreement is reported against whichever authored value won, and only when
    // an analyzed value actually exists to compare with.
    let agreement = 'not-compared';
    const authored = manual !== null ? manual : tagged;
    const analyzedAny = valid(input.analyzed) ? input.analyzed : null;
    if (authored !== null && analyzedAny !== null) {
      agreement = equals(authored, analyzedAny) ? 'agrees' : 'differs';
    }

    return {
      value,
      provenance,
      confidence: provenance === 'local analysis' ? confidence(input.analyzedConfidence) : null,
      agreement,
      analyzed: analyzedAny,
      analyzedConfidence: valid(input.analyzed) ? confidence(input.analyzedConfidence) : null,
    };
  }

  const validBpm = (value) => Number.isFinite(Number(value)) && Number(value) >= 20 && Number(value) <= 300;

  function resolveTempo(sources) {
    return resolveValue(sources, {
      confidenceFloor: CONFIDENCE_FLOOR.tempo,
      valid: validBpm,
      // Within 2% is the same tempo for provenance purposes; a tagged 128 and an
      // analyzed 127.9 are not a disagreement worth showing anyone.
      equals: (a, b) => Math.abs(Number(a) - Number(b)) / Math.max(1, Number(a)) < 0.02,
    });
  }

  function resolveKey(sources) {
    return resolveValue(sources, {
      confidenceFloor: CONFIDENCE_FLOOR.key,
      valid: (value) => typeof value === 'string' && value.trim().length > 0,
      equals: (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase(),
    });
  }

  /**
   * Bounded acoustic contribution, with the receipt fields the decision log needs.
   *
   * Returns zero points for every unusable case: absent, stale, wrong schema,
   * wrong algorithm, missing vector, or mismatched vector version. Absent
   * evidence is neutral and must never make a track less eligible.
   */
  function acousticContribution(currentView, candidateView, options) {
    const config = options && typeof options === 'object' ? options : {};
    const cap = Math.max(0, Math.round(finiteOrNull(config.cap) || MAX_ACOUSTIC_POINTS));
    const reject = (reason) => ({ points: 0, similarity: 0, applied: false, reason, cap });

    if (!currentView || !candidateView) return reject('no-profile');
    const left = currentView.similarityVector;
    const right = candidateView.similarityVector;
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) {
      return reject('no-similarity-vector');
    }
    if (!currentView.similarityVectorVersion || !candidateView.similarityVectorVersion) {
      return reject('no-similarity-vector');
    }
    if (currentView.similarityVectorVersion !== candidateView.similarityVectorVersion) {
      return reject('incompatible-vector-version');
    }
    if (left.length !== right.length) return reject('incompatible-vector-length');

    let distance = 0;
    for (let index = 0; index < left.length; index += 1) {
      const a = finiteOrNull(left[index]);
      const b = finiteOrNull(right[index]);
      if (a === null || b === null) return reject('non-finite-vector');
      distance += Math.abs(a - b);
    }
    distance /= left.length;
    const similarity = Number(clamp(1 - distance * 2, 0, 1).toFixed(3));
    const points = Math.round(similarity * cap);
    return {
      points: clamp(points, 0, cap),
      similarity,
      applied: points > 0,
      reason: points > 0 ? 'applied' : 'below-threshold',
      cap,
    };
  }

  /**
   * Job state for a real, resumable analysis run.
   *
   * This is a shape only. Normalizing a status is NOT evidence that pause,
   * resume, or cancel behave correctly; that requires the Phase 4 worker and its
   * lifecycle tests. Kept separate from the older prototype normalizeJob so the
   * existing shuffle check keeps passing unchanged.
   */
  function normalizeAnalysisJob(source) {
    const input = source && typeof source === 'object' ? source : {};
    const ids = (value, limit) => {
      if (!Array.isArray(value)) return [];
      const seen = [];
      for (const entry of value) {
        const text = stringOrEmpty(entry, 128);
        if (text && !seen.includes(text)) seen.push(text);
        if (seen.length >= limit) break;
      }
      return seen;
    };
    const requested = ids(input.requestedTrackIds, 100000);
    const completed = ids(input.completedTrackIds, 100000);
    const failed = ids(input.failedTrackIds, 100000);
    const skipped = ids(input.skippedTrackIds, 100000);

    return {
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion: stringOrEmpty(input.algorithmVersion, 64) || ALGORITHM_VERSION,
      status: JOB_STATUS.includes(input.status) ? input.status : 'idle',
      scope: input.scope === 'selection' ? 'selection' : 'library',
      mode: input.mode === 'thorough' ? 'thorough' : 'fast',
      requestedTrackIds: requested,
      completedTrackIds: completed,
      failedTrackIds: failed,
      skippedTrackIds: skipped,
      // Never a path, and never a title that could contain one.
      currentTrackId: stringOrEmpty(input.currentTrackId, 128),
      currentProgress: Number(clamp(finiteOrNull(input.currentProgress) || 0, 0, 1).toFixed(3)),
      startedAt: stringOrEmpty(input.startedAt, 32),
      updatedAt: stringOrEmpty(input.updatedAt, 32),
      concurrency: clamp(Math.round(finiteOrNull(input.concurrency) || 1), 1, 8),
      lastFailureKind: FAILURE_KIND.includes(input.lastFailureKind) ? input.lastFailureKind : '',
    };
  }

  /**
   * Path-free progress snapshot for the renderer.
   *
   * Counts and one opaque track id only. If a caller wants a display title it
   * resolves it locally from its own library state; titles are not pushed
   * through this boundary because a filename-derived title can contain a path.
   */
  function progressSnapshot(job) {
    const normalized = normalizeAnalysisJob(job);
    const total = normalized.requestedTrackIds.length;
    const done = normalized.completedTrackIds.length;
    const failed = normalized.failedTrackIds.length;
    const skipped = normalized.skippedTrackIds.length;
    const settled = done + failed + skipped;
    return {
      schemaVersion: SCHEMA_VERSION,
      status: normalized.status,
      scope: normalized.scope,
      mode: normalized.mode,
      total,
      completed: done,
      failed,
      skipped,
      remaining: Math.max(0, total - settled),
      currentTrackId: normalized.currentTrackId,
      currentProgress: normalized.currentProgress,
      overallProgress: total ? Number((settled / total).toFixed(3)) : 0,
      lastFailureKind: normalized.lastFailureKind,
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    ALGORITHM_VERSION,
    SIMILARITY_VECTOR_VERSION,
    PROFILE_STATUS,
    FRESHNESS,
    JOB_STATUS,
    FAILURE_KIND,
    CONFIDENCE_FLOOR,
    MAX_ACOUSTIC_POINTS,
    normalizeProfile,
    normalizeFileIdentity,
    profileFreshness,
    isUsableProfile,
    scoringView,
    resolveValue,
    resolveTempo,
    resolveKey,
    acousticContribution,
    normalizeAnalysisJob,
    progressSnapshot,
  });
}));
