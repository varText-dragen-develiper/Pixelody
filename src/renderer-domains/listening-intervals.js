(function pixelodyListeningIntervalsFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyListeningIntervals = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createListeningIntervalsApi() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MEASUREMENT_VERSION = 'observed-media-v1';
  const DEFAULTS = Object.freeze({ maxSampleGapSeconds: 5, positionToleranceSeconds: 0.25, maxCoverageRanges: 4096 });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const finiteNonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const positionValue = (value) => finiteNonnegative(value) ? value : null;
  const positiveValue = (value) => finiteNonnegative(value) && value > 0 ? value : null;
  const reasonValue = (value) => typeof value === 'string' ? value.slice(0, 128) : '';
  const idValue = (value) => {
    if (typeof value !== 'string' || !value.length) throw new TypeError('Listening identity must be a nonempty opaque string');
    return value;
  };
  const defaultNow = () => typeof performance === 'object' && typeof performance.now === 'function' ? performance.now() : Date.now();

  function unionRange(ranges, start, end) {
    if (!(end > start)) return ranges;
    const result = [];
    let left = start;
    let right = end;
    let inserted = false;
    for (const range of ranges) {
      if (range[1] < left) result.push(range);
      else if (range[0] > right) {
        if (!inserted) { result.push([left, right]); inserted = true; }
        result.push(range);
      } else { left = Math.min(left, range[0]); right = Math.max(right, range[1]); }
    }
    if (!inserted) result.push([left, right]);
    return result;
  }

  /**
   * The primary audio owner supplies media observations; this module owns no
   * timers, media, storage, wall-clock timestamps, learning, or completion rule.
   * `now` returns monotonic milliseconds. Call sample on timeupdate/ratechange;
   * seeking must call sample({seeking:true}) before seeked calls resume. Close
   * pause/wait/focus/route boundaries with suspend(observation), and resume only
   * after the audio route actually runs. A gap >5s defaults to no backfill.
   * Optional onInterval receives accepted observations in integer milliseconds
   * for an injected learning adapter; callback failures do not affect playback.
   */
  function createTracker(options = {}) {
    const now = typeof options.now === 'function' ? options.now : defaultNow;
    const onInterval = typeof options.onInterval === 'function' ? options.onInterval : null;
    const maxSampleGapSeconds = positiveValue(options.maxSampleGapSeconds) || DEFAULTS.maxSampleGapSeconds;
    const positionToleranceSeconds = positionValue(options.positionToleranceSeconds) ?? DEFAULTS.positionToleranceSeconds;
    const maxCoverageRanges = Number.isInteger(options.maxCoverageRanges) && options.maxCoverageRanges > 0
      ? Math.min(options.maxCoverageRanges, DEFAULTS.maxCoverageRanges) : DEFAULTS.maxCoverageRanges;
    let current = null;
    let clockHighWater = null;
    let previousClock = null;

    function readClock() {
      const raw = now();
      if (!finiteNonnegative(raw)) {
        if (current) current.invalidClockSamples += 1;
        previousClock = null;
        return null;
      }
      if (clockHighWater !== null && raw < clockHighWater && current) current.clockRollbacks += 1;
      clockHighWater = Math.max(clockHighWater ?? raw, raw);
      return clockHighWater;
    }

    function stale(observation) {
      return (own(observation, 'occurrenceId') && observation.occurrenceId !== current.occurrenceId)
        || (own(observation, 'trackId') && observation.trackId !== current.trackId);
    }

    function nextObservation(observation) {
      const next = {
        position: own(observation, 'position') ? positionValue(observation.position) : current.position,
        duration: own(observation, 'duration') ? positiveValue(observation.duration) : current.duration,
        rate: own(observation, 'rate') ? positiveValue(observation.rate) : current.rate,
        playing: own(observation, 'playing') ? observation.playing === true : current.playing,
        blocked: own(observation, 'blocked') ? observation.blocked === true : current.blocked,
        seeking: own(observation, 'seeking') ? observation.seeking === true : current.seeking,
      };
      if (next.position !== null && next.duration !== null) next.position = Math.min(next.position, next.duration);
      return next;
    }

    function trimCoverage(duration) {
      if (duration === null) return;
      // A shorter duration can invalidate previously observed positions. Their
      // exposure remains real, but exposure minus retained coverage is no longer
      // an exact repeated-section total.
      if (current.coverageRanges.some((range) => range[1] > duration)) current.coverageTruncated = true;
      current.coverageRanges = current.coverageRanges
        .filter((range) => range[0] < duration).map((range) => [range[0], Math.min(range[1], duration)]);
    }

    function checkpoint() {
      if (!current) return null;
      const coveredSeconds = current.coverageRanges.reduce((sum, range) => sum + range[1] - range[0], 0);
      return {
        schemaVersion: SCHEMA_VERSION,
        measurementVersion: MEASUREMENT_VERSION,
        occurrenceId: current.occurrenceId,
        trackId: current.trackId,
        listenedWallSeconds: current.listenedWallSeconds,
        mediaExposureSeconds: current.mediaExposureSeconds,
        coveredSeconds,
        repeatedMediaSeconds: current.coverageTruncated ? null : Math.max(0, current.mediaExposureSeconds - coveredSeconds),
        coverageRatio: current.duration === null ? null : Math.min(1, coveredSeconds / current.duration),
        coverageRanges: current.coverageRanges.map((range) => range.slice()),
        coverageTruncated: current.coverageTruncated,
        position: current.position,
        duration: current.duration,
        rate: current.rate,
        playing: current.playing,
        blocked: current.blocked,
        seeking: current.seeking,
        suspensionReason: current.suspensionReason,
        naturalEndObserved: current.naturalEndObserved,
        finalized: current.finalized,
        reason: current.reason,
        discontinuities: current.discontinuities,
        ignoredSampleGaps: current.ignoredSampleGaps,
        clockRollbacks: current.clockRollbacks,
        invalidClockSamples: current.invalidClockSamples,
        staleSamples: current.staleSamples,
        intervalCallbackErrors: current.intervalCallbackErrors,
      };
    }

    function begin(observation = {}) {
      const occurrenceId = idValue(observation.occurrenceId);
      const trackId = idValue(observation.trackId);
      // A duplicate activation callback must not erase this occurrence's heard
      // evidence, including after finalization. Genuine replay needs a new ID.
      if (current?.occurrenceId === occurrenceId) {
        if (current.trackId !== trackId) throw new TypeError('Occurrence identity cannot change track');
        return checkpoint();
      }
      if (current && !current.finalized) throw new Error('Finalize the active occurrence before beginning another');
      current = {
        occurrenceId, trackId, position: null, duration: null, rate: 1,
        playing: false, blocked: false, seeking: false,
        listenedWallSeconds: 0, mediaExposureSeconds: 0, coverageRanges: [], coverageTruncated: false,
        naturalEndObserved: false, finalized: false, reason: '', suspensionReason: '',
        discontinuities: 0, ignoredSampleGaps: 0, clockRollbacks: 0, invalidClockSamples: 0, staleSamples: 0,
        intervalCallbackErrors: 0,
      };
      Object.assign(current, nextObservation(observation));
      previousClock = readClock();
      return checkpoint();
    }

    function sample(observation = {}) {
      if (!current || current.finalized) return checkpoint();
      if (stale(observation)) { current.staleSamples += 1; return checkpoint(); }
      const at = readClock();
      const next = nextObservation(observation);
      const elapsed = at === null || previousClock === null ? 0 : Math.max(0, (at - previousClock) / 1000);
      const delta = next.position === null || current.position === null ? null : next.position - current.position;
      const eligible = current.playing && !current.blocked && !current.seeking && current.rate !== null
        && !next.blocked && !next.seeking;
      let acceptedInterval = null;
      if (eligible && elapsed > maxSampleGapSeconds) current.ignoredSampleGaps += 1;
      else if (eligible && delta !== null && elapsed > 0) {
        const expected = elapsed * current.rate;
        if (delta < 0 || delta > expected + positionToleranceSeconds) current.discontinuities += 1;
        else if (delta > 0) {
          // Position/rate caps wall exposure, even when a stall arrived before
          // its event. Clock/rate caps media coverage, even with small drift.
          const media = Math.min(delta, expected);
          current.listenedWallSeconds += Math.min(elapsed, delta / current.rate);
          current.mediaExposureSeconds += media;
          const ranges = unionRange(current.coverageRanges, next.position - media, next.position);
          if (ranges.length <= maxCoverageRanges) current.coverageRanges = ranges;
          else current.coverageTruncated = true; // lower-bound coverage; never fill unobserved gaps
          acceptedInterval = Object.freeze({
            occurrenceId: current.occurrenceId,
            trackId: current.trackId,
            monotonicStartMs: Math.round(at - media / current.rate * 1000),
            monotonicEndMs: Math.round(at),
            mediaStartMs: Math.round((next.position - media) * 1000),
            mediaEndMs: Math.round(next.position * 1000),
            speedPermille: Math.round(current.rate * 1000),
            playing: true,
            discontinuity: false,
          });
        }
      }
      Object.assign(current, next);
      trimCoverage(current.duration);
      previousClock = at;
      if (acceptedInterval && onInterval) {
        try { onInterval(acceptedInterval); }
        catch (_) { current.intervalCallbackErrors += 1; }
      }
      return checkpoint();
    }

    function suspend(observation = {}, reason = 'suspended') {
      if (!current || current.finalized) return checkpoint();
      if (stale(observation)) { current.staleSamples += 1; return checkpoint(); }
      // A boundary observation closes progress up to the interruption. Future
      // samples cannot accrue until resume, even if the media clock keeps moving.
      sample({ ...observation, blocked: false });
      current.playing = false;
      current.blocked = true;
      current.suspensionReason = reasonValue(reason);
      return checkpoint();
    }

    function resume(observation = {}) {
      if (!current || current.finalized) return checkpoint();
      if (stale(observation)) { current.staleSamples += 1; return checkpoint(); }
      Object.assign(current, nextObservation({ ...observation, playing: observation.playing !== false, blocked: false, seeking: false }));
      trimCoverage(current.duration);
      current.suspensionReason = '';
      previousClock = readClock(); // intentionally no backfill across any interruption
      return checkpoint();
    }

    function finalize(observation = {}) {
      if (!current || current.finalized) return checkpoint();
      if (stale(observation)) { current.staleSamples += 1; return checkpoint(); }
      sample(observation);
      current.naturalEndObserved = observation.naturallyEnded === true;
      current.finalized = true;
      current.reason = reasonValue(observation.reason);
      current.playing = false;
      current.blocked = true;
      return checkpoint();
    }

    function restore(saved) {
      if (current && !current.finalized) throw new Error('Finalize the active occurrence before restoring another');
      if (!saved || saved.schemaVersion !== SCHEMA_VERSION || saved.measurementVersion !== MEASUREMENT_VERSION) {
        throw new TypeError('Unsupported listening checkpoint; retain the original data');
      }
      const occurrenceId = idValue(saved.occurrenceId);
      const trackId = idValue(saved.trackId);
      if (!finiteNonnegative(saved.listenedWallSeconds) || !finiteNonnegative(saved.mediaExposureSeconds)
        || !Array.isArray(saved.coverageRanges) || saved.coverageRanges.length > maxCoverageRanges) {
        throw new TypeError('Invalid listening checkpoint');
      }
      let coverageRanges = [];
      for (const range of saved.coverageRanges) {
        if (!Array.isArray(range) || range.length !== 2 || !finiteNonnegative(range[0]) || !finiteNonnegative(range[1]) || range[1] <= range[0]) {
          throw new TypeError('Invalid listening coverage range');
        }
        coverageRanges = unionRange(coverageRanges, range[0], range[1]);
      }
      const covered = coverageRanges.reduce((sum, range) => sum + range[1] - range[0], 0);
      if (covered > saved.mediaExposureSeconds + 1e-8) throw new TypeError('Coverage exceeds observed media exposure');
      current = null; // validation has completed; reinitializing the same ID must also restore its media anchor
      begin({ occurrenceId, trackId, position: saved.position, duration: saved.duration, rate: saved.rate, playing: false, blocked: true });
      current.coverageRanges = coverageRanges;
      current.listenedWallSeconds = saved.listenedWallSeconds;
      current.mediaExposureSeconds = saved.mediaExposureSeconds;
      current.coverageTruncated = saved.coverageTruncated === true;
      current.naturalEndObserved = saved.naturalEndObserved === true;
      current.finalized = saved.finalized === true;
      current.reason = reasonValue(saved.reason);
      current.suspensionReason = current.finalized ? '' : 'restored-paused';
      for (const key of ['discontinuities', 'ignoredSampleGaps', 'clockRollbacks', 'invalidClockSamples', 'staleSamples', 'intervalCallbackErrors']) {
        if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) current[key] = saved[key];
      }
      trimCoverage(current.duration);
      return checkpoint();
    }

    return Object.freeze({ begin, sample, suspend, resume, checkpoint, finalize, restore });
  }

  return Object.freeze({ SCHEMA_VERSION, MEASUREMENT_VERSION, DEFAULTS, createTracker });
}));
