(function shuffleLearningFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyShuffleLearningV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createShuffleLearning() {
  'use strict';

  const VERSION = 2;
  const POLICY_VERSION = 'universal-shuffle-v2.1';
  // These integers are part of the portable policy, rather than tunable adapter defaults.
  const CONFIG = Object.freeze({
    maxJournal: 512, maxEventIds: 4096, maxProducers: 64, maxProducerGap: 1024,
    maxOpenOccurrences: 128, maxClosedOccurrences: 256, maxCoverageRanges: 64,
    maxClocksPerOccurrence: 8, maxIntervalMs: 60000, maxDurationMs: 86400000,
    maxFutureSkewMs: 300000, maxCounter: 2147483647,
    implicitUnitCap: 120, priorUnits: 24, implicitScale: 12, explicitPoints: 8,
    tasteLimit: 12, decayPeriodMs: 2419200000, maxDecayPeriods: 8,
    positiveCompletionUnits: 3, positiveReplayUnits: 1, negativeEarlySkipUnits: 2,
    completionCoveragePermille: 800, completionWallPermille: 500,
    completionWallCapMs: 60000, earlySkipMinimumMs: 3000,
    earlySkipMaximumMs: 30000, earlySkipCoveragePermille: 250,
    noveltyLimit: 12, exposureNoveltyStep: 2, debtLimit: 12,
    confidenceScale: 1000, speedMinimumPermille: 250, speedMaximumPermille: 4000,
    mediaProgressToleranceMs: 500,
  });
  const TYPES = Object.freeze(['offered', 'activated', 'interval', 'outcome', 'preference',
    'learning-enabled', 'learning-reset', 'history-delete', 'track-delete']);
  const IGNORED_REASONS = Object.freeze(['buffering', 'connection-lost', 'credential-loss',
    'crash', 'decode-error', 'focus-loss', 'host-unreachable', 'missing-file',
    'network-disconnect', 'network-error', 'pause', 'permission-revoked', 'playback-error',
    'preview', 'remote-action', 'route-failure', 'seek', 'shutdown', 'token-expired', 'vpn-failure']);
  const ignoredReasons = new Set(IGNORED_REASONS);
  const personalOutcomeReasons = new Set(['natural-end', 'manual', 'manual-next', 'manual-skip', 'manual-switch',
    'user-next', 'user-skip', 'user-replay', 'replay', 'early-skip', 'late-skip', 'track-change']);
  const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
  const validId = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  const id = (value) => validId(value, 1024);
  // Generated structural playback identities can expand JSON-escaped source IDs.
  const occurrenceIdentity = (value) => validId(value, 16384);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const add = (a, b = 1) => Math.min(CONFIG.maxCounter, a + b);
  const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function createLedger(options = {}) {
    const now = integer(options.nowMs) ? options.nowMs : 0;
    return { schemaVersion: VERSION, policyVersion: POLICY_VERSION,
      enabled: options.enabled !== false, learningEpoch: integer(options.learningEpoch) ? options.learningEpoch : 0,
      revision: 0, clockFloorMs: now, resetAtMs: null, tracks: [], occurrences: [],
      producers: [], seenEventIds: [], journal: [],
      diagnostics: { clockRollbacks: 0, futureClamps: 0, coverageUnderflows: 0, prunedOccurrences: 0 } };
  }

  function normalizeEvent(input, context = {}) {
    if (!input || typeof input !== 'object' || input.schemaVersion !== VERSION ||
        !id(input.eventId) || !TYPES.includes(input.type) || !integer(context.nowMs)) return null;
    if (['personal', 'replay', 'playing', 'discontinuity', 'userInitiated'].some((key) => input[key] !== undefined && typeof input[key] !== 'boolean') ||
        (input.source !== undefined && typeof input.source !== 'string') ||
        (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string')) return null;
    const timestampMs = input.timestampMs === undefined ? context.nowMs : input.timestampMs;
    if (!integer(timestampMs) || timestampMs > context.nowMs + CONFIG.maxFutureSkewMs) return null;
    if (input.learningEpoch !== undefined && !integer(input.learningEpoch)) return null;
    const hasProducer = input.producerId !== undefined || input.sequence !== undefined;
    if (hasProducer && (!id(input.producerId) || !integer(input.sequence, 1))) return null;
    if (['offered', 'activated', 'interval', 'outcome', 'preference', 'track-delete'].includes(input.type) && !id(input.trackId)) return null;
    if (['activated', 'interval', 'outcome'].includes(input.type) && !occurrenceIdentity(input.occurrenceId)) return null;
    const event = { schemaVersion: VERSION, eventId: input.eventId, type: input.type,
      timestampMs: Math.min(timestampMs, context.nowMs),
      personal: input.personal !== false && input.source !== 'remote' && input.source !== 'session' && input.source !== 'preview',
      reason: typeof input.reason === 'string' && ignoredReasons.has(input.reason) ? input.reason : null };
    // An unfamiliar interruption label must not accidentally become a personal skip/completion.
    if (input.type === 'outcome' && input.reason && !ignoredReasons.has(input.reason) && !personalOutcomeReasons.has(input.reason)) event.reason = 'unclassified';
    if (timestampMs > context.nowMs) event.futureClamped = true;
    if (input.learningEpoch !== undefined) event.learningEpoch = input.learningEpoch;
    if (hasProducer) { event.producerId = input.producerId; event.sequence = input.sequence; }
    if (id(input.trackId)) event.trackId = input.trackId;
    if (occurrenceIdentity(input.occurrenceId)) event.occurrenceId = input.occurrenceId;
    if (input.type === 'activated') {
      if (input.durationMs !== undefined && input.durationMs !== null && !integer(input.durationMs, 1, CONFIG.maxDurationMs)) return null;
      event.durationMs = input.durationMs == null ? null : input.durationMs;
      event.replay = input.replay === true;
    }
    if (input.type === 'interval') {
      if (!id(input.monotonicClockId) || !integer(input.monotonicStartMs) || !integer(input.monotonicEndMs) ||
          input.monotonicEndMs < input.monotonicStartMs || input.monotonicEndMs - input.monotonicStartMs > CONFIG.maxIntervalMs ||
          !integer(input.mediaStartMs, 0, CONFIG.maxDurationMs) || !integer(input.mediaEndMs, 0, CONFIG.maxDurationMs)) return null;
      const speed = input.speedPermille === undefined ? 1000 : input.speedPermille;
      if (!integer(speed, CONFIG.speedMinimumPermille, CONFIG.speedMaximumPermille)) return null;
      Object.assign(event, { monotonicClockId: input.monotonicClockId, monotonicStartMs: input.monotonicStartMs,
        monotonicEndMs: input.monotonicEndMs, mediaStartMs: input.mediaStartMs, mediaEndMs: input.mediaEndMs,
        speedPermille: speed, playing: input.playing === true, discontinuity: input.discontinuity === true });
    }
    if (input.type === 'outcome') {
      if (!['natural-end', 'deliberate-skip', 'replay', 'interrupted'].includes(input.outcome)) return null;
      event.outcome = input.outcome;
      event.userInitiated = input.userInitiated === true;
    }
    if (input.type === 'preference') {
      if (![-1, 0, 1].includes(input.value)) return null;
      event.value = input.value;
    }
    if (input.type === 'learning-enabled') {
      if (typeof input.enabled !== 'boolean') return null;
      event.enabled = input.enabled;
    }
    return event;
  }

  function trackRow(trackId) {
    return { trackId, offered: 0, activated: 0, heardOccurrences: 0, naturalEnds: 0,
      deliberateSkips: 0, replays: 0, positiveUnits: 0, negativeUnits: 0,
      evidenceAtMs: null, lastHeardAtMs: null, explicitPreference: 0,
      explicitPreferenceAtMs: null, opportunityDebt: 0, heardWallMs: 0 };
  }

  function decayed(row, nowMs) {
    const periods = row.evidenceAtMs === null ? 0 : Math.min(CONFIG.maxDecayPeriods,
      Math.floor(Math.max(0, nowMs - row.evidenceAtMs) / CONFIG.decayPeriodMs));
    const divisor = 2 ** periods;
    return { positive: Math.floor(row.positiveUnits / divisor), negative: Math.floor(row.negativeUnits / divisor) };
  }

  function recordEvidence(row, positive, negative, nowMs, occurredAtMs) {
    const old = decayed(row, nowMs);
    const agePeriods = Math.min(CONFIG.maxDecayPeriods,
      Math.floor(Math.max(0, nowMs - occurredAtMs) / CONFIG.decayPeriodMs));
    row.positiveUnits = Math.min(CONFIG.implicitUnitCap, old.positive + Math.floor(positive / (2 ** agePeriods)));
    row.negativeUnits = Math.min(CONFIG.implicitUnitCap, old.negative + Math.floor(negative / (2 ** agePeriods)));
    // Preserve the decay phase during frequent listening; adding evidence must not postpone decay forever.
    row.evidenceAtMs = row.evidenceAtMs === null ? nowMs : row.evidenceAtMs +
      Math.floor(Math.max(0, nowMs - row.evidenceAtMs) / CONFIG.decayPeriodMs) * CONFIG.decayPeriodMs;
  }

  function coverageMs(occurrence) {
    return occurrence.coverageRanges.reduce((total, range) => total + range[1] - range[0], 0);
  }

  function mergeCoverage(occurrence, start, end, diagnostics) {
    if (end <= start) return;
    const ranges = occurrence.coverageRanges.concat([[start, end]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push(range.slice());
    }
    // Never fill an unheard gap to bound storage. Excess disjoint ranges undercount.
    if (merged.length > CONFIG.maxCoverageRanges) {
      diagnostics.coverageUnderflows = add(diagnostics.coverageUnderflows);
      return;
    }
    occurrence.coverageRanges = merged;
  }

  function duplicateOrUnacceptable(ledger, event) {
    if (ledger.seenEventIds.includes(event.eventId)) return true;
    if (event.learningEpoch !== undefined && event.learningEpoch !== ledger.learningEpoch) return true;
    if (event.producerId !== undefined) {
      const producer = ledger.producers.find((p) => p.producerId === event.producerId);
      if (!producer) return ledger.producers.length >= CONFIG.maxProducers || event.sequence > CONFIG.maxProducerGap;
      return event.sequence <= producer.through || producer.pending.includes(event.sequence) || event.sequence - producer.through > CONFIG.maxProducerGap;
    }
    return false;
  }

  function remember(ledger, event) {
    ledger.seenEventIds.push(event.eventId);
    if (ledger.seenEventIds.length > CONFIG.maxEventIds) ledger.seenEventIds.shift();
    if (event.producerId !== undefined) {
      let producer = ledger.producers.find((p) => p.producerId === event.producerId);
      if (!producer) { producer = { producerId: event.producerId, through: 0, pending: [] }; ledger.producers.push(producer); ledger.producers.sort((a, b) => ordinal(a.producerId, b.producerId)); }
      producer.pending.push(event.sequence);
      producer.pending.sort((a, b) => a - b);
      while (producer.pending[0] === producer.through + 1) { producer.through += 1; producer.pending.shift(); }
    }
  }

  function compactOccurrences(ledger) {
    const closed = ledger.occurrences.filter((o) => o.ended);
    if (closed.length <= CONFIG.maxClosedOccurrences) return;
    const prune = new Set(closed.slice(0, closed.length - CONFIG.maxClosedOccurrences).map((o) => o.occurrenceId));
    ledger.occurrences = ledger.occurrences.filter((o) => !prune.has(o.occurrenceId));
    ledger.diagnostics.prunedOccurrences = add(ledger.diagnostics.prunedOccurrences, prune.size);
  }

  function reduce(inputLedger, inputEvent, context = {}) {
    if (!inputLedger || inputLedger.schemaVersion !== VERSION || inputLedger.policyVersion !== POLICY_VERSION) return inputLedger;
    const rawNow = context.nowMs === undefined ? inputLedger.clockFloorMs : context.nowMs;
    if (!integer(rawNow)) return inputLedger;
    const nowMs = Math.max(rawNow, inputLedger.clockFloorMs);
    const event = normalizeEvent(inputEvent, { nowMs });
    if (!event || duplicateOrUnacceptable(inputLedger, event)) return inputLedger;
    if (['learning-enabled', 'learning-reset', 'history-delete', 'track-delete'].includes(event.type) && !event.personal) return inputLedger;
    // Bounded capacity rejection is retryable: it does not consume the event/sequence.
    if (event.type === 'activated' && !inputLedger.occurrences.some((o) => o.occurrenceId === event.occurrenceId) &&
        inputLedger.occurrences.filter((o) => !o.ended).length >= CONFIG.maxOpenOccurrences) return inputLedger;
    const ledger = clone(inputLedger);
    ledger.revision = add(ledger.revision);
    ledger.clockFloorMs = nowMs;
    if (rawNow < inputLedger.clockFloorMs) ledger.diagnostics.clockRollbacks = add(ledger.diagnostics.clockRollbacks);
    if (event.futureClamped) ledger.diagnostics.futureClamps = add(ledger.diagnostics.futureClamps);
    remember(ledger, event);
    const control = ['learning-enabled', 'learning-reset', 'history-delete', 'track-delete'].includes(event.type);
    const suppressed = !control && (!ledger.enabled || !event.personal || !!event.reason);
    let applied = !suppressed;
    let row = ledger.tracks.find((t) => t.trackId === event.trackId);
    const occurrence = ledger.occurrences.find((o) => o.occurrenceId === event.occurrenceId);
    if (event.type === 'learning-enabled') {
      ledger.enabled = event.enabled;
      // A disabled gap cannot later be measured as one continuous personal occurrence.
      if (!event.enabled) for (const open of ledger.occurrences) open.ended = true;
    }
    else if (event.type === 'learning-reset') {
      ledger.tracks = []; ledger.occurrences = []; ledger.journal = [];
      ledger.learningEpoch = add(ledger.learningEpoch); ledger.resetAtMs = nowMs;
    } else if (event.type === 'history-delete') {
      ledger.journal = []; ledger.occurrences = ledger.occurrences.filter((o) => !o.ended);
      for (const track of ledger.tracks) track.lastHeardAtMs = null;
    } else if (event.type === 'track-delete') {
      ledger.tracks = ledger.tracks.filter((t) => t.trackId !== event.trackId);
      ledger.occurrences = ledger.occurrences.filter((o) => o.trackId !== event.trackId);
      ledger.journal = ledger.journal.filter((e) => e.trackId !== event.trackId);
    } else if (!suppressed) {
      if (!row && ['offered', 'activated', 'preference'].includes(event.type) &&
          !(event.type === 'activated' && occurrence)) {
        row = trackRow(event.trackId); ledger.tracks.push(row); ledger.tracks.sort((a, b) => ordinal(a.trackId, b.trackId));
      }
      if (event.type === 'offered') { row.offered = add(row.offered); row.opportunityDebt = Math.min(CONFIG.debtLimit, row.opportunityDebt + 1); }
      else if (event.type === 'activated') {
        if (occurrence) applied = false;
        else {
          row.activated = add(row.activated); row.opportunityDebt = 0;
          if (event.replay) row.replays = add(row.replays);
          ledger.occurrences.push({ occurrenceId: event.occurrenceId, trackId: event.trackId,
            activatedAtMs: event.timestampMs, durationMs: event.durationMs, replay: event.replay,
            wallMs: 0, coverageRanges: [], clocks: [], heardCredited: false, ended: false });
        }
      } else if (event.type === 'preference') {
        if (row.explicitPreferenceAtMs === null || event.timestampMs >= row.explicitPreferenceAtMs) {
          row.explicitPreference = event.value; row.explicitPreferenceAtMs = event.timestampMs;
        } else applied = false;
      } else if (!occurrence || occurrence.trackId !== event.trackId || occurrence.ended || !row) applied = false;
      else if (event.type === 'interval') {
        if (!event.playing || event.discontinuity || event.mediaEndMs < event.mediaStartMs) applied = false;
        else {
          let clock = occurrence.clocks.find((c) => c.clockId === event.monotonicClockId);
          if (!clock && occurrence.clocks.length >= CONFIG.maxClocksPerOccurrence) applied = false;
          else {
            if (!clock) { clock = { clockId: event.monotonicClockId, throughMs: 0 }; occurrence.clocks.push(clock); }
            const start = Math.max(event.monotonicStartMs, clock.throughMs);
            const wall = Math.max(0, event.monotonicEndMs - start);
            const fullWall = event.monotonicEndMs - event.monotonicStartMs;
            clock.throughMs = Math.max(clock.throughMs, event.monotonicEndMs);
            const mediaSpan = event.mediaEndMs - event.mediaStartMs;
            // Ambiguous seek/buffer segments teach nothing. Adapters close intervals at every discontinuity.
            const plausible = mediaSpan <= Math.floor(fullWall * event.speedPermille / 1000) + CONFIG.mediaProgressToleranceMs;
            const trimMedia = fullWall > 0 ? Math.floor(mediaSpan * Math.min(fullWall, start - event.monotonicStartMs) / fullWall) : mediaSpan;
            if (wall > 0 && mediaSpan > 0 && plausible) {
              occurrence.wallMs = add(occurrence.wallMs, wall); row.heardWallMs = add(row.heardWallMs, wall);
              if (!occurrence.heardCredited) { row.heardOccurrences = add(row.heardOccurrences); occurrence.heardCredited = true; }
              row.lastHeardAtMs = Math.max(row.lastHeardAtMs === null ? 0 : row.lastHeardAtMs, event.timestampMs);
              mergeCoverage(occurrence, event.mediaStartMs + trimMedia,
                Math.min(event.mediaEndMs, occurrence.durationMs === null ? CONFIG.maxDurationMs : occurrence.durationMs), ledger.diagnostics);
            }
          }
        }
      } else if (event.type === 'outcome') {
        occurrence.ended = true;
        const coverage = occurrence.durationMs === null ? 0 : Math.min(1000, Math.floor(coverageMs(occurrence) * 1000 / occurrence.durationMs));
        const enoughWall = occurrence.durationMs !== null && occurrence.wallMs >= Math.min(CONFIG.completionWallCapMs,
          Math.floor(occurrence.durationMs * CONFIG.completionWallPermille / 1000));
        if (event.outcome === 'natural-end') {
          row.naturalEnds = add(row.naturalEnds);
          if (coverage >= CONFIG.completionCoveragePermille && enoughWall)
            recordEvidence(row, CONFIG.positiveCompletionUnits, 0, nowMs, event.timestampMs);
        } else if (event.outcome === 'replay' && event.userInitiated && enoughWall && coverage >= CONFIG.completionCoveragePermille)
          recordEvidence(row, CONFIG.positiveReplayUnits, 0, nowMs, event.timestampMs);
        else if (event.outcome === 'deliberate-skip' && event.userInitiated) {
          row.deliberateSkips = add(row.deliberateSkips);
          if (occurrence.wallMs >= CONFIG.earlySkipMinimumMs && occurrence.wallMs < CONFIG.earlySkipMaximumMs &&
              occurrence.durationMs !== null && coverage < CONFIG.earlySkipCoveragePermille)
            recordEvidence(row, 0, CONFIG.negativeEarlySkipUnits, nowMs, event.timestampMs);
        }
      }
    } else if (event.type === 'outcome' && occurrence && occurrence.trackId === event.trackId) occurrence.ended = true;
    // Compact journal deliberately excludes paths, source text, arbitrary reasons and interval/media positions.
    const journal = { eventId: event.eventId, type: event.type, timestampMs: event.timestampMs, applied };
    if (event.trackId && event.type !== 'track-delete') journal.trackId = event.trackId;
    if (event.occurrenceId) journal.occurrenceId = event.occurrenceId;
    if (suppressed) journal.suppressed = !ledger.enabled ? 'disabled' : !event.personal ? 'nonpersonal' : 'infrastructure';
    if (event.type === 'outcome') journal.outcome = event.outcome;
    ledger.journal.push(journal);
    if (ledger.journal.length > CONFIG.maxJournal) ledger.journal.shift();
    compactOccurrences(ledger);
    return ledger;
  }

  function trackSignals(ledger, trackId, context = {}) {
    const neutral = { tastePoints: 0, exposure: 0, noveltyPoints: 0, lastHeardAtMs: null, confidencePermille: 0 };
    if (!ledger || ledger.schemaVersion !== VERSION || ledger.policyVersion !== POLICY_VERSION || !ledger.enabled) return neutral;
    const now = context.nowMs === undefined ? ledger.clockFloorMs : context.nowMs;
    if (!integer(now)) return neutral;
    const row = ledger.tracks.find((t) => t.trackId === trackId);
    if (!row) return { ...neutral, noveltyPoints: CONFIG.noveltyLimit };
    const evidence = decayed(row, Math.max(now, ledger.clockFloorMs));
    const total = evidence.positive + evidence.negative;
    const implicit = Math.trunc((evidence.positive - evidence.negative) * CONFIG.implicitScale / (total + CONFIG.priorUnits));
    return { tastePoints: clamp(row.explicitPreference * CONFIG.explicitPoints + implicit, -CONFIG.tasteLimit, CONFIG.tasteLimit),
      exposure: row.activated,
      noveltyPoints: clamp(CONFIG.noveltyLimit - Math.min(CONFIG.noveltyLimit, row.activated * CONFIG.exposureNoveltyStep) + row.opportunityDebt, 0, CONFIG.noveltyLimit),
      lastHeardAtMs: row.lastHeardAtMs,
      confidencePermille: Math.floor(total * CONFIG.confidenceScale / (total + CONFIG.priorUnits)) };
  }

  function summarize(ledger) {
    return { schemaVersion: VERSION, policyVersion: POLICY_VERSION, enabled: ledger.enabled,
      tracks: ledger.tracks.length, offers: ledger.tracks.reduce((n, t) => n + t.offered, 0),
      activations: ledger.tracks.reduce((n, t) => n + t.activated, 0),
      heardOccurrences: ledger.tracks.reduce((n, t) => n + t.heardOccurrences, 0),
      heardWallMs: ledger.tracks.reduce((n, t) => n + t.heardWallMs, 0), retainedEvents: ledger.journal.length };
  }

  function exposureMetrics(ledger, trackIds = ledger.tracks.map((t) => t.trackId)) {
    const ids = [...new Set(trackIds)];
    const values = ids.map((trackId) => ledger.tracks.find((t) => t.trackId === trackId));
    const activated = values.filter((t) => t && t.activated > 0).length;
    const heard = values.filter((t) => t && t.heardOccurrences > 0).length;
    return { eligible: ids.length, activated, heard, neverActivated: ids.length - activated,
      activationCoveragePermille: ids.length ? Math.floor(activated * 1000 / ids.length) : 0,
      heardCoveragePermille: ids.length ? Math.floor(heard * 1000 / ids.length) : 0 };
  }

  function exportLedger(ledger, options = {}) {
    if (options.includePrivate !== true) throw new Error('Private learning export requires includePrivate: true');
    return clone(ledger);
  }

  function importLedger(value) {
    let input;
    try { input = typeof value === 'string' ? JSON.parse(value) : clone(value); }
    catch (_) { return { ok: false, reason: 'invalid-json', preserved: value }; }
    if (!input || input.schemaVersion !== VERSION || input.policyVersion !== POLICY_VERSION)
      return { ok: false, reason: 'unsupported-version', preserved: input };
    const keys = (item, required, optional = []) => item && typeof item === 'object' && !Array.isArray(item) &&
      required.every((key) => Object.prototype.hasOwnProperty.call(item, key)) && Object.keys(item).every((key) => required.includes(key) || optional.includes(key));
    const sortedIds = (items, field) => items.every((item, i) => i === 0 || ordinal(items[i - 1][field], item[field]) < 0);
    const validRow = (t) => keys(t, Object.keys(trackRow('schema'))) && id(t.trackId) && ['offered', 'activated', 'heardOccurrences', 'naturalEnds', 'deliberateSkips',
      'replays', 'positiveUnits', 'negativeUnits', 'opportunityDebt', 'heardWallMs'].every((key) => integer(t[key], 0, CONFIG.maxCounter)) &&
      t.positiveUnits <= CONFIG.implicitUnitCap && t.negativeUnits <= CONFIG.implicitUnitCap && t.opportunityDebt <= CONFIG.debtLimit &&
      ['heardOccurrences', 'naturalEnds', 'deliberateSkips', 'replays'].every((key) => t[key] <= t.activated) &&
      (t.evidenceAtMs !== null || (t.positiveUnits === 0 && t.negativeUnits === 0)) &&
      (t.explicitPreferenceAtMs !== null || t.explicitPreference === 0) &&
      [-1, 0, 1].includes(t.explicitPreference) && ['evidenceAtMs', 'lastHeardAtMs', 'explicitPreferenceAtMs'].every((key) => t[key] === null || integer(t[key], 0, input.clockFloorMs));
    const validOccurrence = (o) => keys(o, ['occurrenceId', 'trackId', 'activatedAtMs', 'durationMs', 'replay', 'wallMs', 'coverageRanges', 'clocks', 'heardCredited', 'ended']) &&
      occurrenceIdentity(o.occurrenceId) && id(o.trackId) && input.tracks.some((t) => t.trackId === o.trackId) &&
      integer(o.activatedAtMs, 0, input.clockFloorMs) && (o.durationMs === null || integer(o.durationMs, 1, CONFIG.maxDurationMs)) &&
      typeof o.replay === 'boolean' && integer(o.wallMs, 0, CONFIG.maxCounter) && typeof o.heardCredited === 'boolean' && typeof o.ended === 'boolean' &&
      o.heardCredited === (o.wallMs > 0) &&
      Array.isArray(o.coverageRanges) && o.coverageRanges.length <= CONFIG.maxCoverageRanges && o.coverageRanges.every((r, i) => Array.isArray(r) && r.length === 2 && integer(r[0], 0, CONFIG.maxDurationMs) &&
        integer(r[1], r[0] + 1, o.durationMs === null ? CONFIG.maxDurationMs : o.durationMs) && (i === 0 || r[0] > o.coverageRanges[i - 1][1])) &&
      Array.isArray(o.clocks) && o.clocks.length <= CONFIG.maxClocksPerOccurrence && o.clocks.every((c) => keys(c, ['clockId', 'throughMs']) && id(c.clockId) && integer(c.throughMs)) &&
      new Set(o.clocks.map((c) => c.clockId)).size === o.clocks.length;
    const validProducer = (p) => keys(p, ['producerId', 'through', 'pending']) && id(p.producerId) && integer(p.through) && Array.isArray(p.pending) &&
      p.pending.length <= CONFIG.maxProducerGap && p.pending.every((s, i) => integer(s, p.through + 1) && s - p.through <= CONFIG.maxProducerGap && (i === 0 || s > p.pending[i - 1])) && !p.pending.includes(p.through + 1);
    const valid = keys(input, Object.keys(createLedger())) && typeof input.enabled === 'boolean' && integer(input.revision, 0, CONFIG.maxCounter) && integer(input.learningEpoch, 0, CONFIG.maxCounter) && integer(input.clockFloorMs) &&
      (input.resetAtMs === null || integer(input.resetAtMs, 0, input.clockFloorMs)) && Array.isArray(input.tracks) && input.tracks.every(validRow) &&
      sortedIds(input.tracks, 'trackId') && Array.isArray(input.occurrences) && input.occurrences.every(validOccurrence) &&
      input.occurrences.filter((o) => !o.ended).length <= CONFIG.maxOpenOccurrences && input.occurrences.filter((o) => o.ended).length <= CONFIG.maxClosedOccurrences &&
      new Set(input.occurrences.map((o) => o.occurrenceId)).size === input.occurrences.length && Array.isArray(input.producers) && input.producers.length <= CONFIG.maxProducers && input.producers.every(validProducer) &&
      sortedIds(input.producers, 'producerId') && Array.isArray(input.seenEventIds) && input.seenEventIds.length <= CONFIG.maxEventIds && input.seenEventIds.every(id) &&
      new Set(input.seenEventIds).size === input.seenEventIds.length && Array.isArray(input.journal) && input.journal.length <= CONFIG.maxJournal &&
      input.journal.every((e) => keys(e, ['eventId', 'type', 'timestampMs', 'applied'], ['trackId', 'occurrenceId', 'outcome', 'suppressed']) &&
        id(e.eventId) && TYPES.includes(e.type) && integer(e.timestampMs, 0, input.clockFloorMs) && typeof e.applied === 'boolean' &&
        (e.trackId === undefined || id(e.trackId)) && (e.occurrenceId === undefined || occurrenceIdentity(e.occurrenceId)) &&
        (e.outcome === undefined || ['natural-end', 'deliberate-skip', 'replay', 'interrupted'].includes(e.outcome)) &&
        (e.suppressed === undefined || ['disabled', 'nonpersonal', 'infrastructure'].includes(e.suppressed))) &&
      keys(input.diagnostics, ['clockRollbacks', 'futureClamps', 'coverageUnderflows', 'prunedOccurrences']) &&
      ['clockRollbacks', 'futureClamps', 'coverageUnderflows', 'prunedOccurrences'].every((key) => integer(input.diagnostics[key], 0, CONFIG.maxCounter));
    return valid ? { ok: true, ledger: input } : { ok: false, reason: 'invalid-ledger', preserved: input };
  }

  function control(ledger, type, event, context) { return reduce(ledger, { ...event, schemaVersion: VERSION, type }, context); }
  function setEnabled(ledger, enabled, event, context) { return control(ledger, 'learning-enabled', { ...event, enabled }, context); }
  function resetLearning(ledger, event, context) { return control(ledger, 'learning-reset', event, context); }
  function deleteHistory(ledger, event, context) { return control(ledger, 'history-delete', event, context); }
  function deleteTrack(ledger, trackId, event, context) { return control(ledger, 'track-delete', { ...event, trackId }, context); }
  // Full private-data deletion deliberately forgets deduplication too. Use a fresh producer epoch thereafter.
  function deleteLedger(ledger, options = {}) { return createLedger({ enabled: options.enabled === true,
    nowMs: integer(options.nowMs) ? options.nowMs : ledger.clockFloorMs, learningEpoch: add(ledger.learningEpoch) }); }

  return Object.freeze({ VERSION, POLICY_VERSION, CONFIG, TYPES, IGNORED_REASONS,
    createLedger, normalizeEvent, reduce, trackSignals, coverageMs, summarize, exposureMetrics,
    exportLedger, importLedger, setEnabled, resetLearning, deleteHistory, deleteTrack, deleteLedger });
}));
