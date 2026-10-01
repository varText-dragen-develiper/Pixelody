// By-ear calibration procedure audit.
//
// Runs the listening state machines against simulated listeners and scores
// whether they converge, how fast, and whether they survive an imperfect
// listener. The point of the by-ear path is that an ordinary person can finish
// it; a procedure that only works for a perfect listener has not solved
// anything.
//
// The null stages are simulated PHYSICALLY, not modelled: correlated noise is
// generated, one copy delayed and inverted, summed, and the residual measured.
// Only the direction stage uses a behavioural model, and that is stated where
// it happens.
//

const byEar = require('../src/calibration-by-ear');
const dsp = require('../src/calibration-dsp');

const SAMPLE_RATE = 48000;
const errors = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) return true;
  errors.push(`${label}${detail ? `: ${detail}` : ''}`);
  return false;
}

function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- physical null model

const noiseCache = new Map();
function bandNoise(bandHz) {
  const key = bandHz.join('-');
  if (!noiseCache.has(key)) {
    const raw = byEar.makeCorrelatedNoise({ sampleRate: SAMPLE_RATE, seconds: 0.5, seed: 0x5eed1234 });
    noiseCache.set(key, dsp.bandpass(raw, bandHz[0], bandHz[1], SAMPLE_RATE));
  }
  return noiseCache.get(key);
}

// Residual level, in dB, when two members play the same band-limited noise with
// one inverted and a timing error of errorMs between them. This is the quantity
// the listener is actually judging.
function nullResidualDb(errorMs, bandHz) {
  const signal = bandNoise(bandHz);
  const shift = errorMs / 1000 * SAMPLE_RATE;
  const whole = Math.floor(shift);
  const frac = shift - whole;
  let sum = 0;
  let count = 0;
  for (let i = 200; i < signal.length - 200; i += 1) {
    const j = i - whole;
    const delayed = signal[j] * (1 - frac) + signal[j - 1] * frac;
    const residual = signal[i] - delayed; // one member inverted
    sum += residual * residual;
    count += 1;
  }
  return 10 * Math.log10(sum / Math.max(1, count) + 1e-20);
}

// ------------------------------------------------------------- listeners

// jndDb: how much quieter one option must be before the listener can tell.
// jndMs: how much timing lead is needed before direction is audible.
function makeListener(trueDelayMs, options = {}) {
  const jndDb = options.jndDb === undefined ? 0 : options.jndDb;
  const jndMs = options.jndMs === undefined ? 0 : options.jndMs;
  const random = options.random || seededRandom(7);
  let sameAnswers = 0;

  return function answer(prompt) {
    const errorA = prompt.optionA.delayMs - trueDelayMs;
    const errorB = prompt.optionB.delayMs - trueDelayMs;

    if (prompt.question === 'which-first') {
      // Behavioural model, not a physical simulation: precedence-effect
      // lateralization is reliable in sign but has a threshold in magnitude.
      // A candidate delay short of the true value leaves that member early.
      const leadA = -errorA;
      const leadB = -errorB;
      const difference = Math.abs(leadA) - Math.abs(leadB);
      if (Math.abs(leadA - leadB) < jndMs) { sameAnswers += 1; return 'same'; }
      // Report the option whose null is closer, i.e. less audible leading.
      return difference < 0 ? 'a' : 'b';
    }

    const dbA = nullResidualDb(errorA, prompt.bandHz);
    const dbB = nullResidualDb(errorB, prompt.bandHz);
    if (Math.abs(dbA - dbB) < jndDb) { sameAnswers += 1; return 'same'; }
    return dbA < dbB ? 'a' : 'b';
  };
}

function runDelaySearch(trueDelayMs, listenerOptions = {}, searchOptions = {}) {
  const search = byEar.createDelaySearch({
    bracketMs: 20,
    centerMs: 0,
    random: seededRandom(searchOptions.seed === undefined ? 11 : searchOptions.seed),
    ...searchOptions,
  });
  const listener = makeListener(trueDelayMs, listenerOptions);
  let prompt = search.next();
  let guard = 0;
  while (prompt && guard < 100) {
    search.respond(listener(prompt));
    prompt = search.next();
    guard += 1;
  }
  return search.result();
}

// --------------------------------------------------------------- section A
// Staged search converges from a wide bracket.

function sectionA() {
  const truths = [-14.2, -6.5, -1.1, 0.4, 3.7, 9.8, 15.3];
  const results = truths.map((truth) => ({ truth, result: runDelaySearch(truth) }));

  const worstError = Math.max(...results.map((entry) => Math.abs(entry.result.delayMs - entry.truth)));
  const worstComparisons = Math.max(...results.map((entry) => entry.result.comparisons));
  const allConverged = results.every((entry) => entry.result.status === 'converged');

  notes.push(`A. staged search from +/-20 ms: worst error ${(worstError * 1000).toFixed(0)} us, `
    + `worst ${worstComparisons} comparisons, ${results.filter((e) => e.result.status === 'converged').length}/${truths.length} converged`);

  check('every staged search converged', allConverged,
    results.filter((entry) => entry.result.status !== 'converged').map((entry) => `${entry.truth} ms -> ${entry.result.status}`).join(', '));
  check('staged search lands within 0.1 ms', worstError <= 0.1, `worst error ${worstError.toFixed(4)} ms`);
  check('staged search needs 12 comparisons or fewer', worstComparisons <= 12, `worst ${worstComparisons}`);
}

// --------------------------------------------------------------- section B
// The staging exists for a reason. A single-band null over the same bracket
// must fail, or the invariant is decorative.

function sectionB() {
  const truths = [-14.2, -6.5, 3.7, 9.8, 15.3];
  let sideLobeFailures = 0;
  let worstError = 0;

  truths.forEach((truth) => {
    // Deliberately bypass staging: bisect a +/-20 ms bracket using only the
    // mid null band, which is what a naive implementation would do.
    let low = -20;
    let high = 20;
    const random = seededRandom(3);
    for (let i = 0; i < 12; i += 1) {
      const mid = (low + high) / 2;
      const quarter = (high - low) / 4;
      const lower = mid - quarter;
      const upper = mid + quarter;
      void random();
      const dbLower = nullResidualDb(lower - truth, [400, 1200]);
      const dbUpper = nullResidualDb(upper - truth, [400, 1200]);
      if (dbLower < dbUpper) high = mid; else low = mid;
    }
    const error = Math.abs((low + high) / 2 - truth);
    worstError = Math.max(worstError, error);
    if (error > 0.1) sideLobeFailures += 1;
  });

  notes.push(`B. unstaged 400-1200 Hz null from +/-20 ms: ${sideLobeFailures}/${truths.length} converged on a side lobe, worst error ${worstError.toFixed(2)} ms`);
  check('unstaged single-band null must fail (staging regression guard)',
    sideLobeFailures > 0,
    'a single-band null over +/-20 ms found the true null every time. If this passes, the null model stopped being realistic '
    + 'and section A is no longer proving anything.');
}

// --------------------------------------------------------------- section C
// An imperfect listener still finishes.

function sectionC() {
  const truths = [-9.4, -2.3, 1.8, 7.1];
  const results = truths.map((truth) => ({
    truth,
    result: runDelaySearch(truth, { jndDb: 0.8, jndMs: 0.6 }),
  }));
  const worstError = Math.max(...results.map((entry) => Math.abs(entry.result.delayMs - entry.truth)));
  const finished = results.filter((entry) => entry.result.status === 'converged').length;
  notes.push(`C. listener with 0.8 dB / 0.6 ms thresholds: worst error ${worstError.toFixed(3)} ms, ${finished}/${truths.length} finished`);
  check('an imperfect listener still finishes', finished === truths.length,
    results.filter((entry) => entry.result.status !== 'converged').map((entry) => entry.result.status).join(', '));
  check('an imperfect listener still lands within 0.5 ms', worstError <= 0.5, `worst error ${worstError.toFixed(3)} ms`);
}

// --------------------------------------------------------------- section D
// Level staircase.

function sectionD() {
  const truths = [-6.2, -2.5, 0, 1.4, 5.8];
  let worstError = 0;
  let worstTrials = 0;
  let converged = 0;

  truths.forEach((truth, index) => {
    const staircase = byEar.createLevelStaircase({ random: seededRandom(index + 31) });
    const jndDb = 0.7;
    let prompt = staircase.next();
    let guard = 0;
    while (prompt && guard < 100) {
      // trimDb is applied to member B; the listener hears the residual.
      const residual = truth - prompt.trimDb;
      let response;
      if (Math.abs(residual) < jndDb) response = 'same';
      else response = residual > 0 ? 'b' : 'a';
      staircase.respond(response);
      prompt = staircase.next();
      guard += 1;
    }
    const result = staircase.result();
    if (result.status === 'converged') converged += 1;
    worstError = Math.max(worstError, Math.abs(result.relativeDb - truth));
    worstTrials = Math.max(worstTrials, result.trials);
    check(`level staircase applies attenuation only (truth ${truth} dB)`,
      result.attenuationDb <= 0, `got ${result.attenuationDb} dB`);
  });

  notes.push(`D. level staircase with a 0.7 dB listener: worst error ${worstError.toFixed(2)} dB, worst ${worstTrials} trials, ${converged}/${truths.length} converged`);
  check('level staircase converges', converged === truths.length, `${converged}/${truths.length}`);
  check('level staircase lands within 1 dB', worstError <= 1.0, `worst error ${worstError.toFixed(2)} dB`);
  check('level staircase stays under 40 trials', worstTrials <= 40, `worst ${worstTrials}`);
}

// --------------------------------------------------------------- section E
// Procedure invariants.

function sectionE() {
  const search = byEar.createDelaySearch({ bracketMs: 20, random: seededRandom(5) });
  const first = search.next();
  check('the coarse stage asks for direction, not quality',
    first.question === 'which-first',
    `first question was "${first.question}"; a quality judgment is what makes the current by-ear path unusable`);
  check('no prompt exposes a candidate value as a labelled setting',
    first.optionA.delayMs !== undefined && first.stage !== undefined && !('sliderMs' in first),
    'candidates must stay blinded');

  const stageIds = byEar.STAGES.map((stage) => stage.id);
  check('null stages declare the bracket they require', byEar.STAGES.slice(1).every((stage) => stage.requiresBracketMs > 0),
    `stages: ${stageIds.join(', ')}`);
  byEar.STAGES.slice(1).forEach((stage, index) => {
    const previous = byEar.STAGES[index];
    check(`stage ${stage.id} is only entered inside its main lobe`,
      previous.untilMs <= stage.requiresBracketMs,
      `previous stage narrows to ${previous.untilMs} ms but ${stage.id} needs ${stage.requiresBracketMs} ms`);
  });

  const aborted = byEar.createDelaySearch({ bracketMs: 20, random: seededRandom(9) });
  aborted.next();
  aborted.respond('bad');
  check('"both sound wrong" aborts rather than guessing', aborted.result().status === 'aborted', aborted.result().status);

  const questions = new Set();
  const walk = byEar.createDelaySearch({ bracketMs: 20, random: seededRandom(13) });
  const listener = makeListener(4.2);
  let prompt = walk.next();
  let guard = 0;
  while (prompt && guard < 60) {
    questions.add(prompt.question);
    walk.respond(listener(prompt));
    prompt = walk.next();
    guard += 1;
  }
  check('only forced-choice questions are ever asked',
    [...questions].every((question) => question === 'which-first' || question === 'which-quieter'),
    `asked: ${[...questions].join(', ')}`);
}

// ------------------------------------------------------------------- run

const started = Date.now();
try {
  sectionA();
  sectionB();
  sectionC();
  sectionD();
  sectionE();
} catch (error) {
  errors.push(`audit threw: ${error && error.stack ? error.stack : error}`);
}

notes.forEach((note) => console.log(note));
console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);

if (errors.length) {
  console.error(`By-ear procedure audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('By-ear procedure audit passed: staged null seeking converges from a wide bracket, '
  + 'survives an imperfect listener, applies attenuation only, and never asks for an absolute judgment.');
