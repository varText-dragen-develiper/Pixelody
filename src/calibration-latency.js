(function calibrationLatencyFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCalibrationLatency = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCalibrationLatency() {
  'use strict';

  // Deterministic latency priors, search-window sizing, and clock-ratio fitting.
  //
  // None of this measures anything acoustically. Its job is to arrive at the
  // acoustic measurement already knowing roughly where the answer is, which
  // makes the search cheaper, makes a wrong lock less likely, and makes the
  // no-microphone path tractable — a listener asked to search +/-20 ms can
  // finish, a listener asked to search +/-250 ms cannot.
  //
  // Pure logic. No DOM, no AudioContext, no native calls. Scored by
  // scripts/check-calibration-latency.js.

  const VERSION = 1;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // ------------------------------------------------------------ codec table

  // Starting estimates only, never a final value.
  //
  // These vary by chipset, by negotiated buffer size, and between one
  // connection and the next on the same pair of devices. The ranges are wide
  // on purpose: a wide honest prior produces a wide search window, which is
  // slow but correct, while a narrow wrong prior produces a narrow window that
  // excludes the true answer. Treat any figure here as "which order of
  // magnitude", not "what the number is".
  const CODEC_LATENCY_MS = Object.freeze({
    'wired': Object.freeze({ min: 0, typical: 10, max: 40 }),
    'usb': Object.freeze({ min: 0, typical: 15, max: 50 }),
    'sbc': Object.freeze({ min: 100, typical: 180, max: 300 }),
    'aac': Object.freeze({ min: 100, typical: 180, max: 300 }),
    'aptx': Object.freeze({ min: 50, typical: 90, max: 160 }),
    'aptx-ll': Object.freeze({ min: 20, typical: 40, max: 80 }),
    'aptx-adaptive': Object.freeze({ min: 40, typical: 80, max: 150 }),
    'ldac': Object.freeze({ min: 100, typical: 180, max: 320 }),
    'unknown-bluetooth': Object.freeze({ min: 20, typical: 160, max: 350 }),
    'unknown': Object.freeze({ min: 0, typical: 80, max: 350 }),
  });

  function codecPrior(codec) {
    const key = String(codec || 'unknown').toLowerCase();
    const entry = CODEC_LATENCY_MS[key] || CODEC_LATENCY_MS.unknown;
    // Treat the quoted range as roughly +/-2 sigma.
    return {
      id: `codec:${key}`,
      ms: entry.typical,
      uncertaintyMs: Math.max((entry.max - entry.min) / 4, 1),
      independent: true,
      note: 'codec table; starting estimate only',
    };
  }

  // ----------------------------------------------------- combining priors

  // Inverse-variance weighting, with one correction that matters.
  //
  // Inverse-variance combination assumes the sources are independent. Several
  // of ours are not: the WASAPI figure and the Web Audio estimate both descend
  // from the same driver's reported buffering, so averaging them as though they
  // were two witnesses produces a confidence interval roughly 1.4x too narrow
  // and a prior that can confidently exclude the true value.
  //
  // Sources carrying `independent: false` are therefore grouped by `family`,
  // and each family contributes once, at the precision of its best member.
  function combinePriors(sources, options = {}) {
    const usable = (sources || []).filter((source) => (
      source && Number.isFinite(Number(source.ms)) && Number(source.uncertaintyMs) > 0
    ));
    if (!usable.length) {
      const fallback = options.fallback || CODEC_LATENCY_MS.unknown;
      return {
        version: VERSION,
        ms: fallback.typical,
        uncertaintyMs: Math.max((fallback.max - fallback.min) / 4, 1),
        sources: [],
        method: 'fallback-no-sources',
      };
    }

    const families = new Map();
    usable.forEach((source) => {
      const family = source.independent === false ? (source.family || 'driver-reported') : `independent:${source.id}`;
      const existing = families.get(family);
      if (!existing || Number(source.uncertaintyMs) < Number(existing.uncertaintyMs)) families.set(family, source);
    });

    let weightSum = 0;
    let weighted = 0;
    const contributing = [];
    families.forEach((source) => {
      const variance = Number(source.uncertaintyMs) * Number(source.uncertaintyMs);
      const weight = 1 / variance;
      weightSum += weight;
      weighted += weight * Number(source.ms);
      contributing.push({ id: source.id, ms: Number(source.ms), uncertaintyMs: Number(source.uncertaintyMs) });
    });

    const ms = weighted / weightSum;
    const uncertaintyMs = Math.sqrt(1 / weightSum);

    // If the contributing sources disagree by more than their stated precision,
    // the precision is wrong. Inflate by the standard scale factor
    // sqrt(chi2/dof), which is how a particle-data-style average handles
    // inconsistent inputs: two sources 80 ms apart that each claim +/-5 ms are
    // not jointly accurate to +/-3.5 ms, and a window built on that number can
    // exclude the true value entirely.
    let chiSquared = 0;
    contributing.forEach((source) => {
      chiSquared += ((source.ms - ms) / source.uncertaintyMs) ** 2;
    });
    const dof = Math.max(1, contributing.length - 1);
    const scale = contributing.length > 1 ? Math.max(1, Math.sqrt(chiSquared / dof)) : 1;
    const widened = uncertaintyMs * scale;

    let spreadMs = 0;
    contributing.forEach((source) => { spreadMs = Math.max(spreadMs, Math.abs(source.ms - ms)); });

    return {
      version: VERSION,
      ms: Number(ms.toFixed(3)),
      uncertaintyMs: Number(widened.toFixed(3)),
      formalUncertaintyMs: Number(uncertaintyMs.toFixed(3)),
      inconsistencyScale: Number(scale.toFixed(3)),
      disagreementMs: Number(spreadMs.toFixed(3)),
      sources: contributing,
      suppressedForCorrelation: usable.length - families.size,
      method: 'inverse-variance-with-correlated-families-collapsed-and-chi2-inflation',
    };
  }

  const BLUETOOTH_CODECS = Object.freeze(['sbc', 'aac', 'aptx', 'aptx-ll', 'aptx-adaptive', 'ldac', 'unknown-bluetooth']);

  // Build a prior for one endpoint.
  //
  // The important structure here is that host buffering and the transport link
  // are ADDITIVE STAGES, not competing estimates of the same quantity.
  //
  // `IAudioClient::GetStreamLatency` and Web Audio's `outputLatency` describe
  // the host-side path. Neither can see a Bluetooth link's own buffering, so on
  // a wireless endpoint they are a floor, not an estimate. Averaging them
  // against the codec table as though all three were measuring the same thing
  // drags the prior down toward the host figure - for an SBC endpoint that
  // produced a 52 ms prior against a real value near 220 ms, which is exactly
  // the confidently-wrong prior that makes a search window exclude the answer.
  //
  // So: compose the stages, then reconcile the composite against anything that
  // genuinely measured the total, which means a previous acoustic result.
  function endpointPrior(endpoint = {}) {
    const hostSources = [];

    if (Number.isFinite(Number(endpoint.wasapiMs))) {
      hostSources.push({
        id: 'wasapi:GetStreamLatency',
        ms: Number(endpoint.wasapiMs),
        uncertaintyMs: endpoint.wasapiUncertaintyMs === undefined ? 5 : Number(endpoint.wasapiUncertaintyMs),
        independent: false,
        family: 'driver-reported',
        note: 'engine-side figure; excludes the transport link and the acoustic path',
      });
    }
    if (Number.isFinite(Number(endpoint.webAudioMs))) {
      hostSources.push({
        id: 'webaudio:outputLatency',
        ms: Number(endpoint.webAudioMs),
        uncertaintyMs: endpoint.webAudioUncertaintyMs === undefined ? 15 : Number(endpoint.webAudioUncertaintyMs),
        independent: false,
        family: 'driver-reported',
        note: 'browser estimate; the spec permits it to change with the output device',
      });
    }

    const codec = String(endpoint.codec || '').toLowerCase();
    const isBluetooth = endpoint.transport === 'bluetooth' || BLUETOOTH_CODECS.indexOf(codec) >= 0;

    let composite;
    if (!hostSources.length) {
      // Nothing host-side to build on, so the table has to carry the whole
      // estimate, link and buffering together.
      const table = codecPrior(isBluetooth ? (codec || 'unknown-bluetooth') : (endpoint.transport || 'unknown'));
      composite = { id: 'stage:table-only', ms: table.ms, uncertaintyMs: table.uncertaintyMs };
    } else {
      const host = combinePriors(hostSources);
      // On a wired endpoint the driver figure already covers the path; only a
      // small unmodelled remainder is added. On Bluetooth the link is a real
      // additional stage.
      const link = isBluetooth
        ? codecPrior(codec || 'unknown-bluetooth')
        : { id: 'link:wired', ms: 0, uncertaintyMs: 5 };
      composite = {
        id: 'stage:host+link',
        ms: host.ms + link.ms,
        uncertaintyMs: Math.sqrt(host.uncertaintyMs ** 2 + link.uncertaintyMs ** 2),
        stages: { host, link: { id: link.id, ms: link.ms, uncertaintyMs: link.uncertaintyMs } },
      };
    }

    const totals = [{ ...composite, independent: true }];
    if (Number.isFinite(Number(endpoint.previousMeasuredMs))) {
      // A previous acoustic result measured the whole chain, so it is a true
      // competing estimate of the total - and the best one available, while the
      // route is the same one. A reconnect renegotiates buffering without any
      // user action, so it is heavily discounted rather than discarded.
      totals.push({
        id: 'previous:acoustic',
        ms: Number(endpoint.previousMeasuredMs),
        uncertaintyMs: endpoint.routeUnchanged === false ? 40 : 2,
        independent: true,
        note: endpoint.routeUnchanged === false
          ? 'previous measurement on a route that has since been re-established; heavily discounted'
          : 'previous acoustic measurement on the same route',
      });
    }

    const combined = combinePriors(totals);
    return { ...combined, transport: isBluetooth ? 'bluetooth' : (endpoint.transport || 'unknown'), composite };
  }

  // ------------------------------------------------------- search window

  // Convert a prior into the window the acoustic search should scan.
  //
  // Wider than the prior's uncertainty by a safety factor, floored so a
  // suspiciously confident prior cannot produce a window too narrow to contain
  // the answer, and clamped to the delay range the application supports.
  function searchWindow(prior, options = {}) {
    const sigmas = options.sigmas === undefined ? 3 : options.sigmas;
    const floorMs = options.floorMs === undefined ? 15 : options.floorMs;
    const ceilingMs = options.ceilingMs === undefined ? 650 : options.ceilingMs;
    const maxDelayMs = options.maxDelayMs === undefined ? 250 : options.maxDelayMs;

    const halfWidth = clamp(Math.max(prior.uncertaintyMs * sigmas, floorMs), floorMs, ceilingMs / 2);
    const startMs = Math.max(0, prior.ms - halfWidth);
    const endMs = Math.min(maxDelayMs + halfWidth, prior.ms + halfWidth);
    return {
      version: VERSION,
      startMs: Number(startMs.toFixed(3)),
      endMs: Number(endMs.toFixed(3)),
      widthMs: Number((endMs - startMs).toFixed(3)),
      centerMs: Number(prior.ms.toFixed(3)),
      halfWidthMs: Number(halfWidth.toFixed(3)),
      // What the by-ear path should bracket, which is a relative offset rather
      // than an absolute latency.
      byEarBracketMs: Number(clamp(halfWidth, 2, 20).toFixed(3)),
    };
  }

  // Did the acoustic result land where the prior said it would?
  //
  // A large disagreement is information, not an error: it usually means the
  // route changed, the codec was misidentified, or the arrival estimate locked
  // onto a reflection. Report it and let the caller decide; never silently
  // accept a measurement the prior says is impossible.
  function reconcile(prior, measuredMs, options = {}) {
    const alarmSigmas = options.alarmSigmas === undefined ? 4 : options.alarmSigmas;
    const measured = Number(measuredMs);
    if (!Number.isFinite(measured)) {
      return { version: VERSION, agrees: false, verdict: 'no-measurement', deviationMs: null, sigmas: null };
    }
    const deviationMs = measured - prior.ms;
    const sigmas = Math.abs(deviationMs) / Math.max(prior.uncertaintyMs, 1e-6);
    let verdict = 'agrees';
    let note = '';
    if (sigmas > alarmSigmas) {
      verdict = 'disagrees';
      note = 'the acoustic result is far outside the deterministic prior. Check that the route is the one that was '
        + 'confirmed, that the codec did not renegotiate, and that the arrival estimate did not lock onto a reflection.';
    } else if (sigmas > alarmSigmas / 2) {
      verdict = 'marginal';
      note = 'the acoustic result sits at the edge of the deterministic prior; treat the prior as stale.';
    }
    return {
      version: VERSION,
      agrees: verdict === 'agrees',
      verdict,
      deviationMs: Number(deviationMs.toFixed(3)),
      sigmas: Number(sigmas.toFixed(2)),
      note,
    };
  }

  // --------------------------------------------------------- clock ratio

  // Fit a clock ratio from timestamp pairs.
  //
  // samples: [{ hostNanos, framePosition }] as reported by, for example,
  // AudioTrack.getTimestamp(). The slope of framePosition against host time is
  // the endpoint's true sample rate; its deviation from nominal is the drift.
  //
  // This measures DRIFT, not absolute offset. Timestamp APIs cannot account for
  // delay unknown to the framework, which for a Bluetooth endpoint usually
  // means the link latency itself, so the intercept here is not the latency.
  // The acoustic measurement supplies the offset; this supplies the rate.
  function estimateClockRatio(samples, nominalRate, options = {}) {
    const list = (samples || [])
      .map((sample) => ({ t: Number(sample.hostNanos) / 1e9, f: Number(sample.framePosition) }))
      .filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.f))
      .sort((a, b) => a.t - b.t);

    const minSamples = options.minSamples === undefined ? 8 : options.minSamples;
    const minSpanSeconds = options.minSpanSeconds === undefined ? 20 : options.minSpanSeconds;
    if (list.length < minSamples) {
      return { version: VERSION, usable: false, reason: `need at least ${minSamples} timestamps, got ${list.length}` };
    }
    const spanSeconds = list[list.length - 1].t - list[0].t;
    if (spanSeconds < minSpanSeconds) {
      return {
        version: VERSION,
        usable: false,
        reason: `need at least ${minSpanSeconds} s of observation, got ${spanSeconds.toFixed(1)} s. `
          + 'A short window cannot separate drift from jitter.',
      };
    }

    const n = list.length;
    const meanT = list.reduce((sum, s) => sum + s.t, 0) / n;
    const meanF = list.reduce((sum, s) => sum + s.f, 0) / n;
    let stt = 0;
    let stf = 0;
    list.forEach((s) => { stt += (s.t - meanT) ** 2; stf += (s.t - meanT) * (s.f - meanF); });
    const rate = stt > 0 ? stf / stt : 0;

    let ssTotal = 0;
    let ssResidual = 0;
    const intercept = meanF - rate * meanT;
    list.forEach((s) => {
      ssTotal += (s.f - meanF) ** 2;
      ssResidual += (s.f - (rate * s.t + intercept)) ** 2;
    });
    const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
    const ppm = (rate / nominalRate - 1) * 1e6;
    const residualFrames = Math.sqrt(ssResidual / n);

    return {
      version: VERSION,
      usable: r2 > (options.minR2 === undefined ? 0.999 : options.minR2),
      measuredRate: Number(rate.toFixed(4)),
      nominalRate,
      ppm: Number(ppm.toFixed(2)),
      r2: Number(r2.toFixed(6)),
      residualFrames: Number(residualFrames.toFixed(2)),
      spanSeconds: Number(spanSeconds.toFixed(1)),
      samples: n,
      reason: r2 > 0.999 ? '' : 'timestamp series is too noisy or non-linear to give a trustworthy rate',
    };
  }

  // Bounded correction, matching the native follower controller's limits.
  // A clock estimate never rewrites a saved acoustic alignment; this returns a
  // transient playback-rate nudge only.
  function rateCorrection(ppm, options = {}) {
    const maxPpm = options.maxPpm === undefined ? 300 : options.maxPpm;
    const maxSlewPpm = options.maxSlewPpm === undefined ? 20 : options.maxSlewPpm;
    const currentPpm = options.currentPpm === undefined ? 0 : Number(options.currentPpm);
    const target = clamp(-Number(ppm) || 0, -maxPpm, maxPpm);
    const step = clamp(target - currentPpm, -maxSlewPpm, maxSlewPpm);
    const next = clamp(currentPpm + step, -maxPpm, maxPpm);
    return {
      version: VERSION,
      ppm: Number(next.toFixed(2)),
      playbackRate: Number((1 + next / 1e6).toFixed(9)),
      clamped: Math.abs(target) >= maxPpm,
      transientOnly: true,
    };
  }

  return Object.freeze({
    VERSION,
    CODEC_LATENCY_MS,
    codecPrior,
    combinePriors,
    endpointPrior,
    searchWindow,
    reconcile,
    estimateClockRatio,
    rateCorrection,
  });
}));
