// Capture-path validation audit.
//
// Simulates capture paths that a real machine actually produces - clean,
// automatic gain control, firmware limiting, noise gating - and scores whether
// the detectors identify each one. A detector that has never been shown the
// thing it detects is a guess with a function name.
//

const capture = require('../src/calibration-capture');

const errors = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) return true;
  errors.push(`${label}${detail ? `: ${detail}` : ''}`);
  return false;
}

// ------------------------------------------------------ simulated paths
//
// Each takes a played level in dBFS and returns the captured RMS a real
// capture path of that kind would produce.

const MIC_SENSITIVITY_DB = -6; // arbitrary fixed offset; only the slope matters

function cleanPath(playedDbfs) {
  return Math.pow(10, (playedDbfs + MIC_SENSITIVITY_DB) / 20);
}

// Automatic gain control pulls everything toward a target level. Slope well
// under 1, and - crucially - it still looks like a straight line, which is why
// slope alone is a usable detector but a "looks linear" eyeball check is not.
function agcPath(playedDbfs, options = {}) {
  const targetDbfs = options.targetDbfs === undefined ? -20 : options.targetDbfs;
  const ratio = options.ratio === undefined ? 0.35 : options.ratio;
  const raw = playedDbfs + MIC_SENSITIVITY_DB;
  return Math.pow(10, (targetDbfs + (raw - targetDbfs) * ratio) / 20);
}

// Firmware limiting is linear until it is not. The slope stays near 1 across
// most of the range, so the curvature is the only tell.
function limiterPath(playedDbfs, kneeDbfs = -14) {
  const raw = playedDbfs + MIC_SENSITIVITY_DB;
  const out = raw <= kneeDbfs ? raw : kneeDbfs + (raw - kneeDbfs) * 0.15;
  return Math.pow(10, out / 20);
}

function samplePath(path, levels) {
  return levels.map((playedDbfs) => ({ playedDbfs, capturedRms: path(playedDbfs) }));
}

// Level over time within one sustained tone.
function driftSeries(kind, frames = 60) {
  const out = [];
  for (let i = 0; i < frames; i += 1) {
    const seconds = i / 30;
    if (kind === 'steady') out.push(0.2 * (1 + 0.01 * Math.sin(i)));
    else if (kind === 'agc') {
      // Attack of a few hundred milliseconds, pulling the level down ~4 dB.
      const settle = 1 - 0.37 * (1 - Math.exp(-seconds / 0.45));
      out.push(0.2 * settle);
    } else out.push(0.2);
  }
  return out;
}

// --------------------------------------------------------------- section A
// Linearity detection.

function sectionA() {
  const levels = capture.LINEARITY_LEVELS_DBFS;

  const clean = capture.analyzeLinearity(samplePath(cleanPath, levels));
  const agc = capture.analyzeLinearity(samplePath(agcPath, levels));
  const limiter = capture.analyzeLinearity(samplePath(limiterPath, levels));

  notes.push(`A. clean path:   slope ${clean.slopeDbPerDb} dB/dB, knee ${clean.worstKneeDbPerDb} -> ${clean.verdict}`);
  notes.push(`A. AGC path:     slope ${agc.slopeDbPerDb} dB/dB, knee ${agc.worstKneeDbPerDb} -> ${agc.verdict}`);
  notes.push(`A. limiter path: slope ${limiter.slopeDbPerDb} dB/dB, knee ${limiter.worstKneeDbPerDb} -> ${limiter.verdict}`);

  check('a clean capture path passes linearity', clean.verdict === 'linear' && clean.usable, clean.reason);
  check('slope near 1 on a clean path', Math.abs(clean.slopeDbPerDb - 1) < 0.02, `got ${clean.slopeDbPerDb}`);
  check('automatic gain control is detected by the global slope', agc.verdict === 'compressed' && !agc.usable, `verdict ${agc.verdict}`);
  check('firmware limiting is detected by the knee test', limiter.verdict === 'nonlinear' && !limiter.usable,
    `verdict ${limiter.verdict}, slope ${limiter.slopeDbPerDb}, knee ${limiter.worstKneeDbPerDb}`);
  // The two linearity detectors must stay complementary. A limiter with a
  // near-unity slope is exactly the case a global line fit alone misses.
  check('the knee test catches what the slope test misses',
    limiter.slopeDbPerDb > 0.85 && limiter.worstKneeDbPerDb > 0.3,
    `slope ${limiter.slopeDbPerDb} (would pass the slope test), knee ${limiter.worstKneeDbPerDb}. `
    + 'If the slope test alone would have caught this, the fixture stopped exercising a knee.');

  const tooFew = capture.analyzeLinearity([{ playedDbfs: -20, capturedRms: 0.1 }]);
  check('too few points is inconclusive, not a pass', tooFew.verdict === 'inconclusive' && !tooFew.usable, tooFew.verdict);

  const silent = capture.analyzeLinearity(levels.map((playedDbfs) => ({ playedDbfs, capturedRms: 0 })));
  check('a silent capture is inconclusive, not linear', silent.verdict === 'inconclusive' && !silent.usable, silent.verdict);
}

// --------------------------------------------------------------- section B
// Drift detection: the specific signature, and why slope alone is not enough.

function sectionB() {
  const steady = capture.analyzeGainDrift(driftSeries('steady'));
  const agc = capture.analyzeGainDrift(driftSeries('agc'));
  notes.push(`B. steady tone: drift ${steady.driftDb} dB -> ${steady.verdict}`);
  notes.push(`B. AGC tone:    drift ${agc.driftDb} dB -> ${agc.verdict}`);

  check('a steady capture path shows no drift', steady.verdict === 'steady' && steady.usable, steady.reason);
  check('gain control is detected by in-tone drift', agc.verdict === 'gain-control' && !agc.usable, agc.reason);
  check('too few frames is inconclusive', capture.analyzeGainDrift([0.1, 0.1]).verdict === 'inconclusive');

  // The reason both detectors exist: a slow AGC can slip under a short probe
  // and produce a clean slope. Drift within a sustained tone still catches it.
  const shortProbeLevels = capture.LINEARITY_LEVELS_DBFS;
  const slowAgcSlope = capture.analyzeLinearity(samplePath((db) => agcPath(db, { ratio: 0.92 }), shortProbeLevels));
  const slowAgcDrift = capture.analyzeGainDrift(driftSeries('agc'));
  notes.push(`B. slow/weak AGC: slope check says ${slowAgcSlope.verdict}, drift check says ${slowAgcDrift.verdict}`);
  check('a weak AGC that passes the slope check is still caught by the drift check',
    slowAgcSlope.verdict === 'linear' && slowAgcDrift.verdict === 'gain-control',
    `slope ${slowAgcSlope.verdict}, drift ${slowAgcDrift.verdict}. If both agree, one detector is redundant `
    + 'and the pair no longer covers slow gain control.');
}

// --------------------------------------------------------------- section C
// Combined verdict. Measurement outranks the browser's claim.

function sectionC() {
  const off = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const on = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
  const unknown = { echoCancellation: null, noiseSuppression: null, autoGainControl: null };
  const linear = capture.analyzeLinearity(samplePath(cleanPath, capture.LINEARITY_LEVELS_DBFS));
  const compressed = capture.analyzeLinearity(samplePath(agcPath, capture.LINEARITY_LEVELS_DBFS));
  const steady = capture.analyzeGainDrift(driftSeries('steady'));
  const drifting = capture.analyzeGainDrift(driftSeries('agc'));

  const best = capture.assessCapturePath(off, linear, steady);
  const lying = capture.assessCapturePath(off, compressed, drifting);
  const honest = capture.assessCapturePath(on, linear, steady);
  const opaque = capture.assessCapturePath(unknown, linear, steady);
  const unverified = capture.assessCapturePath(off, null, null);

  notes.push(`C. reported off + measured clean      -> ${best.confidence}`);
  notes.push(`C. reported off + measured compressed -> ${lying.confidence}`);
  notes.push(`C. reported on  + measured clean      -> ${honest.confidence}`);
  notes.push(`C. not reportable + measured clean    -> ${opaque.confidence}`);
  notes.push(`C. reported off + not verified        -> ${unverified.confidence}`);

  check('clean and honest reaches high confidence', best.confidence === 'high' && best.levelMeasurementsUsable, best.confidence);
  check('a device that claims processing is off but behaves like a compressor is downgraded',
    lying.confidence !== 'high' && !lying.levelMeasurementsUsable,
    `${lying.confidence}. A reported flag must never outrank a measurement.`);
  check('a device that admits processing never reaches high confidence', honest.confidence !== 'high', honest.confidence);
  check('an unreportable device never reaches high confidence', opaque.confidence !== 'high', opaque.confidence);
  check('an unverified path never reaches high confidence', unverified.confidence !== 'high', unverified.confidence);
  check('every downgrade carries a reason the user can act on',
    lying.caveats.length > 0 && honest.caveats.length > 0 && opaque.caveats.length > 0);
}

// --------------------------------------------------------------- section D
// Gain staging.

function sectionD() {
  // Rig sensitivities spanning 40 dB, plus one that cannot be reached.
  const rigs = [
    { label: 'quiet rig', sensitivity: 0.35 },
    { label: 'typical rig', sensitivity: 3.0 },
    { label: 'loud rig', sensitivity: 18.0 },
  ];

  rigs.forEach((rig) => {
    const staging = capture.createGainStaging({ startGain: 0.16 });
    let guard = 0;
    let state = staging.next();
    while (state.status === 'probing' && guard < 20) {
      const peak = Math.min(1.0, state.gain * rig.sensitivity);
      staging.observe(peak);
      state = staging.next();
      guard += 1;
    }
    const result = staging.result();
    const finalPeak = Math.min(1.0, result.gain * rig.sensitivity);
    const finalDbfs = 20 * Math.log10(finalPeak);
    notes.push(`D. ${rig.label}: settled at gain ${result.gain} -> ${finalDbfs.toFixed(1)} dBFS in ${result.probes} probes (${result.status})`);
    check(`${rig.label} reaches a usable capture level`, result.status === 'ready', `${result.status}: ${result.reason}`);
    check(`${rig.label} lands between -18 and -6 dBFS`, finalDbfs >= -18 && finalDbfs <= -6, `${finalDbfs.toFixed(1)} dBFS`);
    check(`${rig.label} does not clip`, finalPeak < 0.995, `peak ${finalPeak.toFixed(3)}`);
    check(`${rig.label} stays within the probe budget`, result.probes <= 6, `${result.probes} probes`);
  });

  // A rig too quiet to measure must say so rather than looping or lying.
  const hopeless = capture.createGainStaging({ startGain: 0.16 });
  let guard = 0;
  let state = hopeless.next();
  while (state.status === 'probing' && guard < 20) {
    hopeless.observe(state.gain * 0.02);
    state = hopeless.next();
    guard += 1;
  }
  const hopelessResult = hopeless.result();
  notes.push(`D. unreachable rig: ${hopelessResult.status} - "${hopelessResult.reason}"`);
  check('a rig that cannot reach a usable level reports why',
    hopelessResult.status === 'too-quiet' && hopelessResult.reason.length > 0,
    hopelessResult.status);

  // Clipping must back off, and must not trust the clipped peak's ratio.
  const clipping = capture.createGainStaging({ startGain: 0.5 });
  const before = clipping.next().gain;
  clipping.observe(1.0);
  const after = clipping.next().gain;
  check('clipping backs the stimulus off', after < before, `${before} -> ${after}`);
}

// --------------------------------------------------------------- section E
// Capture quality of a completed sweep.

function sectionE() {
  const good = capture.captureQuality({ peak: 0.25, rms: 0.08, noiseRms: 0.0015, clippedFrames: 0 });
  const clipped = capture.captureQuality({ peak: 1.0, rms: 0.3, noiseRms: 0.002, clippedFrames: 12 });
  const noisy = capture.captureQuality({ peak: 0.2, rms: 0.02, noiseRms: 0.012, clippedFrames: 0 });
  notes.push(`E. good capture: SNR ${good.snrDb} dB, headroom ${good.headroomDb} dB, usable ${good.usable}`);
  notes.push(`E. clipped: ${clipped.problems.join(', ')}; noisy: ${noisy.problems.join(', ')}`);
  check('a good capture is usable', good.usable, good.problems.join(', '));
  check('clipping is rejected', !clipped.usable && clipped.problems.includes('clipping'));
  check('a poor signal-to-noise capture is rejected', !noisy.usable && noisy.problems.includes('low signal-to-noise'));
}

// --------------------------------------------------------------- section F
// Probe design invariants.

function sectionF() {
  const plan = capture.linearityPlan({ random: () => 0.5 });
  check('the linearity probe uses sustained tones', plan.toneSeconds >= 1.5,
    `${plan.toneSeconds} s. Automatic gain control has an attack of several hundred milliseconds; `
    + 'a short burst slips underneath it and produces a clean fit from a compressed path.');
  check('the linearity probe spans at least 25 dB',
    Math.max(...plan.levelsDbfs) - Math.min(...plan.levelsDbfs) >= 25,
    `span ${Math.max(...plan.levelsDbfs) - Math.min(...plan.levelsDbfs)} dB`);
  check('the linearity probe uses at least three levels', plan.levelsDbfs.length >= 3, `${plan.levelsDbfs.length}`);

  // Order must actually vary, or gain control tracks a smooth ramp and hides.
  const orders = new Set();
  for (let seed = 0; seed < 40; seed += 1) {
    let a = seed * 2654435761 % 4294967296;
    const random = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
    orders.add(capture.linearityPlan({ random }).levelsDbfs.join(','));
  }
  check('the linearity probe randomises level order', orders.size > 1,
    'a fixed ascending ramp lets gain control track smoothly and read as linear');
}

// ------------------------------------------------------------------- run

const started = Date.now();
try {
  sectionA();
  sectionB();
  sectionC();
  sectionD();
  sectionE();
  sectionF();
} catch (error) {
  errors.push(`audit threw: ${error && error.stack ? error.stack : error}`);
}

notes.forEach((note) => console.log(note));
console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);

if (errors.length) {
  console.error(`Capture path audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Capture path audit passed: gain control and limiting are detected, a reported flag '
  + 'cannot outrank a measurement, and stimulus level settles across a 40 dB span of rig sensitivity.');
