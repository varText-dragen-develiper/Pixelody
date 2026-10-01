(function calibrationCaptureFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCalibrationCapture = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCalibrationCapture() {
  'use strict';

  // Capture-path validation and stimulus gain staging.
  //
  // The measurement DSP assumes the microphone returns what the microphone
  // heard. Windows APOs, device firmware and browser media processing all break
  // that assumption quietly, and `MediaStreamTrack.getSettings()` reporting
  // `autoGainControl: false` is a claim, not evidence. Automatic gain control
  // destroys every level measurement and partially destroys timing ones, and it
  // does so without any visible error.
  //
  // So the capture path is measured rather than trusted.
  //
  // Pure logic. No DOM, no AudioContext. Scored by
  // scripts/check-calibration-capture.js.

  const VERSION = 1;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // ------------------------------------------------------------- linearity

  // Levels for the linearity probe, in dBFS relative to the stimulus ceiling.
  // A 30 dB span is wide enough that a compressor has to reveal itself and
  // narrow enough to stay above a normal room's noise floor.
  // Five levels, not three. A limiter's knee usually sits near the top of the
  // range, so with only three or four points a global line fit absorbs the one
  // affected point and reports a clean slope. The extra level puts two points
  // above a typical knee, which is what makes the bend visible.
  const LINEARITY_LEVELS_DBFS = Object.freeze([-40, -30, -20, -12, -4]);

  // Each tone must be sustained. Automatic gain control has an attack of
  // several hundred milliseconds; a short burst can slip underneath it entirely
  // and produce a clean-looking linear fit from a compressed capture path.
  const LINEARITY_TONE_SECONDS = 1.8;

  // Present the levels in a randomised order. Gain control is history
  // dependent, so an ascending ramp lets it track smoothly and look linear.
  // A shuffled order forces it to react.
  function linearityPlan(options = {}) {
    const random = options.random || Math.random;
    const levels = (options.levelsDbfs || LINEARITY_LEVELS_DBFS).slice();
    for (let i = levels.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const swap = levels[i];
      levels[i] = levels[j];
      levels[j] = swap;
    }
    return {
      levelsDbfs: levels,
      toneSeconds: options.toneSeconds || LINEARITY_TONE_SECONDS,
      toneHz: options.toneHz || 1000,
      gapSeconds: options.gapSeconds === undefined ? 0.4 : options.gapSeconds,
      note: 'sustained tones, randomised order; both are required to expose gain control',
    };
  }

  // points: [{ playedDbfs, capturedRms }]
  //
  // A clean capture path is a straight line of slope 1: 10 dB more out is 10 dB
  // more in. Slope below 1 is compression, which is what automatic gain control
  // and firmware limiting look like. Curvature that a straight line cannot
  // explain is the other tell, so both slope and worst deviation are reported.
  function analyzeLinearity(points, options = {}) {
    const usable = (points || [])
      .map((point) => ({
        playedDb: Number(point.playedDbfs),
        capturedDb: 20 * Math.log10(Math.max(Number(point.capturedRms) || 0, 1e-12)),
      }))
      .filter((point) => Number.isFinite(point.playedDb) && point.capturedDb > -110);

    if (usable.length < 3) {
      return {
        version: VERSION,
        verdict: 'inconclusive',
        usable: false,
        points: usable.length,
        reason: 'fewer than three usable levels; the capture was too quiet or the probe did not run',
      };
    }

    const n = usable.length;
    const meanX = usable.reduce((sum, p) => sum + p.playedDb, 0) / n;
    const meanY = usable.reduce((sum, p) => sum + p.capturedDb, 0) / n;
    let sxy = 0;
    let sxx = 0;
    usable.forEach((p) => {
      sxy += (p.playedDb - meanX) * (p.capturedDb - meanY);
      sxx += (p.playedDb - meanX) * (p.playedDb - meanX);
    });
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = meanY - slope * meanX;
    let worstDeviation = 0;
    usable.forEach((p) => {
      worstDeviation = Math.max(worstDeviation, Math.abs(p.capturedDb - (slope * p.playedDb + intercept)));
    });

    const slopeFloor = options.slopeFloor === undefined ? 0.85 : options.slopeFloor;
    const slopeCeiling = options.slopeCeiling === undefined ? 1.15 : options.slopeCeiling;
    const deviationLimitDb = options.deviationLimitDb === undefined ? 1.0 : options.deviationLimitDb;
    const kneeLimit = options.kneeLimit === undefined ? 0.3 : options.kneeLimit;

    // Second detector, for a different defect. Automatic gain control
    // compresses the whole range, so the global slope catches it. A limiter is
    // linear until its knee and then is not, which a global fit plus a
    // deviation threshold will absorb - it reports a slope near 1 and a small
    // residual on an obviously bent curve. Comparing adjacent segment slopes
    // against their own median finds the bend regardless of where it sits.
    const ordered = usable.slice().sort((a, b) => a.playedDb - b.playedDb);
    const segmentSlopes = [];
    for (let i = 1; i < ordered.length; i += 1) {
      const run = ordered[i].playedDb - ordered[i - 1].playedDb;
      if (Math.abs(run) > 1e-6) segmentSlopes.push((ordered[i].capturedDb - ordered[i - 1].capturedDb) / run);
    }
    const sortedSlopes = segmentSlopes.slice().sort((a, b) => a - b);
    const medianSlope = sortedSlopes.length
      ? (sortedSlopes.length % 2
        ? sortedSlopes[(sortedSlopes.length - 1) / 2]
        : (sortedSlopes[sortedSlopes.length / 2 - 1] + sortedSlopes[sortedSlopes.length / 2]) / 2)
      : slope;
    let worstKnee = 0;
    segmentSlopes.forEach((value) => { worstKnee = Math.max(worstKnee, Math.abs(value - medianSlope)); });

    let verdict = 'linear';
    let reason = '';
    if (worstKnee > kneeLimit) {
      verdict = 'nonlinear';
      reason = `capture gain changed by ${worstKnee.toFixed(2)} dB per dB partway up the range; `
        + 'this is a compressor or limiter knee in the capture path';
    } else if (slope < slopeFloor) {
      verdict = 'compressed';
      reason = `captured level tracked played level at ${slope.toFixed(2)} dB per dB; `
        + 'automatic gain control or firmware limiting is still in the capture path';
    } else if (slope > slopeCeiling) {
      verdict = 'expanded';
      reason = `captured level tracked played level at ${slope.toFixed(2)} dB per dB; `
        + 'expansion or a noise gate is in the capture path';
    } else if (worstDeviation > deviationLimitDb) {
      verdict = 'nonlinear';
      reason = `captured level departed from a straight line by ${worstDeviation.toFixed(2)} dB`;
    }

    return {
      version: VERSION,
      verdict,
      usable: verdict === 'linear',
      slopeDbPerDb: Number(slope.toFixed(3)),
      worstDeviationDb: Number(worstDeviation.toFixed(2)),
      worstKneeDbPerDb: Number(worstKnee.toFixed(3)),
      points: n,
      reason,
    };
  }

  // The second detector, and the more specific one.
  //
  // Slope compression tells you gain control exists. Level drift *within a
  // single sustained tone* is its signature: the level is pulled back over
  // several hundred milliseconds while the tone itself is constant. A capture
  // path with no gain control holds flat.
  //
  // frameRmsSeries: RMS per analysis frame across one sustained tone.
  function analyzeGainDrift(frameRmsSeries, options = {}) {
    const series = Array.from(frameRmsSeries || []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
    const driftLimitDb = options.driftLimitDb === undefined ? 1.0 : options.driftLimitDb;
    if (series.length < 8) {
      return { version: VERSION, verdict: 'inconclusive', usable: false, driftDb: null, reason: 'too few analysis frames' };
    }
    // Skip the first eighth so the onset transient does not read as drift.
    const start = Math.floor(series.length / 8);
    const body = series.slice(start);
    const quarter = Math.max(1, Math.floor(body.length / 4));
    const toDb = (list) => 20 * Math.log10(list.reduce((sum, value) => sum + value, 0) / list.length);
    const headDb = toDb(body.slice(0, quarter));
    const tailDb = toDb(body.slice(-quarter));
    const driftDb = tailDb - headDb;

    let verdict = 'steady';
    let reason = '';
    if (driftDb < -driftLimitDb) {
      verdict = 'gain-control';
      reason = `captured level fell ${Math.abs(driftDb).toFixed(2)} dB during a constant tone; `
        + 'this is the signature of automatic gain control regardless of what getSettings() reports';
    } else if (driftDb > driftLimitDb) {
      verdict = 'gain-control';
      reason = `captured level rose ${driftDb.toFixed(2)} dB during a constant tone; `
        + 'the capture path is applying its own gain';
    }
    return {
      version: VERSION,
      verdict,
      usable: verdict === 'steady',
      driftDb: Number(driftDb.toFixed(2)),
      frames: series.length,
      reason,
    };
  }

  // Combine what the browser claims with what was actually measured.
  //
  // Measurement wins. A reported flag can only downgrade the result, never
  // upgrade it, because a device that says processing is off and then behaves
  // like a compressor is a device with processing on.
  function assessCapturePath(reported = {}, linearity = null, drift = null) {
    const caveats = [];
    const flags = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];
    const reportedOff = flags.every((flag) => reported[flag] === false);
    const reportable = flags.every((flag) => typeof reported[flag] === 'boolean');

    if (!reportable) caveats.push('The microphone did not report every processing control, so its state is unknown.');
    else if (!reportedOff) {
      caveats.push('The microphone reports processing still enabled: '
        + flags.filter((flag) => reported[flag] !== false).join(', ') + '.');
    }

    let confidence = 'high';
    if (!reportedOff || !reportable) confidence = 'medium';

    if (linearity && linearity.verdict !== 'linear') {
      confidence = 'low';
      caveats.push(`Capture linearity check failed: ${linearity.reason}`);
    } else if (!linearity) {
      confidence = confidence === 'high' ? 'medium' : confidence;
      caveats.push('Capture linearity was not verified.');
    }

    if (drift && drift.verdict === 'gain-control') {
      confidence = 'low';
      caveats.push(`Level drift check failed: ${drift.reason}`);
    }

    // A measured-clean path outranks a bad flag report, but never reaches
    // "high" on a device that would not tell us what it is doing.
    const measuredClean = linearity && linearity.verdict === 'linear' && drift && drift.verdict === 'steady';
    if (measuredClean && confidence === 'low') confidence = 'medium';

    return {
      version: VERSION,
      confidence,
      levelMeasurementsUsable: confidence !== 'low',
      reportedOff,
      reportable,
      caveats,
    };
  }

  // ------------------------------------------------------- gain staging

  // Target captured peak. Low enough to leave headroom for a room mode or a
  // transient, high enough to keep the deconvolution well above the noise
  // floor.
  const TARGET_PEAK_DBFS = -12;

  function createGainStaging(options = {}) {
    const targetDbfs = options.targetDbfs === undefined ? TARGET_PEAK_DBFS : options.targetDbfs;
    const minGain = options.minGain === undefined ? 0.01 : options.minGain;
    const maxGain = options.maxGain === undefined ? 0.5 : options.maxGain;
    const maxStepDb = options.maxStepDb === undefined ? 12 : options.maxStepDb;
    const toleranceDb = options.toleranceDb === undefined ? 3 : options.toleranceDb;
    // Two thresholds, not one. `toleranceDb` is when to stop looking; this is
    // what is good enough once there is nowhere left to look. Without the
    // second one, a rig that lands at -15 dBFS against a -12 target reports
    // failure while holding a perfectly usable capture level.
    const acceptableDb = options.acceptableDb === undefined ? 6 : options.acceptableDb;
    const maxProbes = options.maxProbes === undefined ? 6 : options.maxProbes;

    let gain = clamp(options.startGain === undefined ? 0.16 : options.startGain, minGain, maxGain);
    let probes = 0;
    let status = 'probing';
    let reason = '';
    const history = [];

    // capturedPeak is the linear peak sample magnitude of the probe capture.
    function observe(capturedPeak) {
      if (status !== 'probing') return { status, gain, reason };
      probes += 1;
      const peak = Math.max(Number(capturedPeak) || 0, 1e-9);
      const peakDbfs = 20 * Math.log10(peak);
      history.push({ probe: probes, gain: Number(gain.toFixed(4)), peakDbfs: Number(peakDbfs.toFixed(2)) });

      if (peak >= 0.995) {
        // Clipped. Back off hard and do not trust the ratio, because a clipped
        // peak understates how far over the level actually is.
        gain = clamp(gain * 0.4, minGain, maxGain);
        if (probes >= maxProbes) { status = 'failed'; reason = 'capture kept clipping at the minimum usable stimulus level'; }
        return { status, gain: Number(gain.toFixed(4)), reason };
      }

      const errorDb = targetDbfs - peakDbfs;
      if (Math.abs(errorDb) <= toleranceDb) {
        status = 'ready';
        return { status, gain: Number(gain.toFixed(4)), reason };
      }

      const stepDb = clamp(errorDb, -maxStepDb, maxStepDb);
      const next = gain * Math.pow(10, stepDb / 20);
      const clamped = clamp(next, minGain, maxGain);

      if (clamped === gain) {
        // Nowhere left to go. Take what is there if it is usable, and only
        // then report which wall was hit.
        if (Math.abs(errorDb) <= acceptableDb) {
          status = 'ready';
          reason = `settled at ${peakDbfs.toFixed(1)} dBFS against a ${targetDbfs} dBFS target; `
            + 'the stimulus gain limit was reached but the level is usable';
          return { status, gain: Number(gain.toFixed(4)), reason };
        }
        status = errorDb > 0 ? 'too-quiet' : 'too-loud';
        reason = errorDb > 0
          ? 'the rig could not reach a usable capture level at the maximum safe stimulus gain; turn the speakers up or move the microphone closer'
          : 'the rig was still too loud at the minimum stimulus gain; turn the speakers down';
        return { status, gain: Number(gain.toFixed(4)), reason };
      }
      gain = clamped;
      if (probes >= maxProbes) { status = 'failed'; reason = 'stimulus level did not settle within the probe budget'; }
      return { status, gain: Number(gain.toFixed(4)), reason };
    }

    return {
      next: () => ({ gain: Number(gain.toFixed(4)), probe: probes + 1, status }),
      observe,
      result: () => ({
        version: VERSION,
        gain: Number(gain.toFixed(4)),
        status,
        probes,
        reason,
        history: history.slice(),
      }),
    };
  }

  // Quality of a completed capture, independent of what it contains.
  function captureQuality(stats = {}) {
    const peak = Math.max(Number(stats.peak) || 0, 1e-12);
    const rms = Math.max(Number(stats.rms) || 0, 1e-12);
    const noiseRms = Math.max(Number(stats.noiseRms) || 0, 1e-12);
    const clippedFrames = Math.max(0, Number(stats.clippedFrames) || 0);
    const snrDb = 20 * Math.log10(rms / noiseRms);
    const headroomDb = -20 * Math.log10(peak);
    const minimumSnrDb = stats.minimumSnrDb === undefined ? 20 : stats.minimumSnrDb;
    const problems = [];
    if (clippedFrames > 0) problems.push('clipping');
    if (snrDb < minimumSnrDb) problems.push('low signal-to-noise');
    if (headroomDb < 0.5) problems.push('no headroom');
    return {
      version: VERSION,
      snrDb: Number(snrDb.toFixed(2)),
      headroomDb: Number(headroomDb.toFixed(2)),
      clippedFrames,
      usable: problems.length === 0,
      problems,
    };
  }

  return Object.freeze({
    VERSION,
    LINEARITY_LEVELS_DBFS,
    LINEARITY_TONE_SECONDS,
    TARGET_PEAK_DBFS,
    linearityPlan,
    analyzeLinearity,
    analyzeGainDrift,
    assessCapturePath,
    createGainStaging,
    captureQuality,
  });
}));
