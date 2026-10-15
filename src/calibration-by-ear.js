(function calibrationByEarFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCalibrationByEar = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCalibrationByEar() {
  'use strict';

  // Listening procedures for aligning speakers without a microphone.
  //
  // The governing idea: never ask for an absolute judgment. People are poor at
  // "is this right yet?" regardless of training, which is why the existing
  // "which sounds tighter or more centered" comparison defeats even careful
  // listeners. People are good at two other questions, and only these are asked
  // here:
  //
  //     "which side did you hear first?"      (direction, coarse)
  //     "which one is quieter?"               (a null, fine)
  //
  // Both have a right answer the listener can actually hear, and both drive a
  // search that converges on its own. No screen presents a slider.
  //
  // Pure state machines. No DOM, no AudioContext. Scored against simulated
  // listeners by scripts/check-calibration-by-ear.js.

  const VERSION = 1;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // ------------------------------------------------------------- staging
  //
  // INVARIANT: a null search only converges while its bracket sits inside the
  // main lobe of the band being used.
  //
  // Cancellation between two correlated band-limited signals is not a single
  // V shape. It oscillates at roughly the band's centre frequency, so a
  // 200-800 Hz null has side lobes every ~2 ms. Bisecting a +/-20 ms bracket
  // against that band does not find the true null; it confidently converges on
  // a side lobe several milliseconds out, which is exactly the class of error
  // this whole effort exists to remove.
  //
  // So the bracket is narrowed by a direction judgment first, and each null
  // stage only runs once the bracket is small enough for its band.

  const STAGES = Object.freeze([
    Object.freeze({
      id: 'lateralization',
      question: 'which-first',
      bandHz: Object.freeze([200, 4000]),
      stimulus: 'click-pair',
      untilMs: 2.0,
      // Precedence-effect lateralization stays reliable to roughly 1-2 ms.
      // It is used only to shrink the bracket, never to finish the job.
    }),
    Object.freeze({
      id: 'null-low',
      question: 'which-quieter',
      bandHz: Object.freeze([100, 300]),
      stimulus: 'inverted-correlated-noise',
      // Centre ~200 Hz, so the main lobe is about +/-2.5 ms. Safe from 2 ms.
      requiresBracketMs: 2.5,
      untilMs: 0.25,
    }),
    Object.freeze({
      id: 'null-mid',
      question: 'which-quieter',
      bandHz: Object.freeze([400, 1200]),
      stimulus: 'inverted-correlated-noise',
      // Centre ~800 Hz, main lobe about +/-0.6 ms. Safe from 0.25 ms.
      requiresBracketMs: 0.6,
      untilMs: 0.05,
    }),
  ]);

  // ------------------------------------------------- delay: staged search

  // Bisection on a null, not a hill climb toward one.
  //
  // Each comparison presents two candidates straddling the midpoint of the
  // current bracket, at 25% and 75%. Whichever the listener reports as quieter
  // contains the null, so the bracket halves every answer. From a 4 ms bracket
  // to 0.05 ms is about 7 comparisons; the direction stage ahead of it costs
  // about 4 more from +/-20 ms.
  //
  // The listener never sees a value, and the two candidates are presented in a
  // randomised order so the answer cannot be trained to a position.
  function createDelaySearch(options = {}) {
    const bracketMs = options.bracketMs === undefined ? 20 : options.bracketMs;
    const centerMs = options.centerMs === undefined ? 0 : options.centerMs;
    const maxComparisons = options.maxComparisons === undefined ? 24 : options.maxComparisons;
    const random = options.random || Math.random;

    let low = centerMs - Math.abs(bracketMs);
    let high = centerMs + Math.abs(bracketMs);
    let stageIndex = 0;
    let comparisons = 0;
    let sameCount = 0;
    let status = 'running';
    let pending = null;
    const history = [];

    function currentStage() {
      return STAGES[Math.min(stageIndex, STAGES.length - 1)];
    }

    function advanceStageIfReady() {
      // Move on once the bracket is tight enough for this stage, and never
      // enter a null stage whose main lobe is narrower than the bracket.
      while (stageIndex < STAGES.length - 1) {
        const stage = STAGES[stageIndex];
        const width = (high - low) / 2;
        if (width > stage.untilMs) return;
        const next = STAGES[stageIndex + 1];
        if (next.requiresBracketMs !== undefined && width > next.requiresBracketMs) return;
        stageIndex += 1;
      }
    }

    function next() {
      if (status !== 'running') return null;
      advanceStageIfReady();
      const stage = currentStage();
      const width = (high - low) / 2;
      if (width <= stage.untilMs && stageIndex === STAGES.length - 1) {
        status = 'converged';
        return null;
      }
      if (comparisons >= maxComparisons) {
        status = 'exhausted';
        return null;
      }
      const mid = (low + high) / 2;
      const quarter = (high - low) / 4;
      const lower = mid - quarter;
      const upper = mid + quarter;
      const flip = random() < 0.5;
      pending = {
        stage: stage.id,
        question: stage.question,
        stimulus: stage.stimulus,
        bandHz: stage.bandHz,
        invertOneMember: stage.stimulus === 'inverted-correlated-noise',
        optionA: { delayMs: flip ? upper : lower },
        optionB: { delayMs: flip ? lower : upper },
        lowerIsOptionA: !flip,
        bracketMs: Number(width.toFixed(4)),
        comparison: comparisons + 1,
      };
      return {
        stage: pending.stage,
        question: pending.question,
        stimulus: pending.stimulus,
        bandHz: pending.bandHz,
        invertOneMember: pending.invertOneMember,
        optionA: pending.optionA,
        optionB: pending.optionB,
        bracketMs: pending.bracketMs,
        comparison: pending.comparison,
      };
    }

    // response: 'a' | 'b' | 'same' | 'bad'
    //
    // For 'which-quieter' the answer names the quieter option; for
    // 'which-first' it names the option whose leading side was heard first,
    // which means the null lies on the other side of that candidate.
    function respond(response) {
      if (status !== 'running' || !pending) return { status };
      comparisons += 1;
      const mid = (low + high) / 2;

      if (response === 'bad') {
        status = 'aborted';
        history.push({ comparison: comparisons, stage: pending.stage, response });
        pending = null;
        return { status };
      }
      if (response === 'same') {
        sameCount += 1;
        history.push({ comparison: comparisons, stage: pending.stage, response });
        // Two "no difference" answers at the finest stage is a real result:
        // the listener is at the limit of what they can resolve.
        if (sameCount >= 2 && stageIndex === STAGES.length - 1) status = 'converged';
        else if (sameCount >= 2) { stageIndex = Math.min(stageIndex + 1, STAGES.length - 1); sameCount = 0; }
        pending = null;
        return { status };
      }

      sameCount = 0;
      const chosenIsLower = (response === 'a') === pending.lowerIsOptionA;
      if (chosenIsLower) high = mid; else low = mid;
      history.push({
        comparison: comparisons,
        stage: pending.stage,
        response,
        keptLowerHalf: chosenIsLower,
        bracketMs: Number(((high - low) / 2).toFixed(4)),
      });
      pending = null;
      return { status };
    }

    function result() {
      return {
        version: VERSION,
        delayMs: Number(((low + high) / 2).toFixed(4)),
        bracketMs: Number(((high - low) / 2).toFixed(4)),
        comparisons,
        status,
        stagesUsed: stageIndex + 1,
        history: history.slice(),
      };
    }

    return { next, respond, result, stages: STAGES };
  }

  // --------------------------------------------------- level: 2AFC staircase

  // Alternate the two members and ask which is louder. A transformed staircase
  // converges on the point of subjective equality without ever asking the
  // listener to decide when two things "match", which is the absolute judgment
  // that makes a level slider unusable.
  //
  // Two-down-one-up with a shrinking step, terminating on reversals rather than
  // a fixed trial count, and reporting the mean of the final reversals.
  //
  // Attenuation only: the returned trim is applied to whichever member is
  // louder, never as a boost to the quieter one.
  function createLevelStaircase(options = {}) {
    const startDb = options.startDb === undefined ? 0 : options.startDb;
    const steps = options.stepScheduleDb || [2, 1, 0.5];
    const targetReversals = options.targetReversals === undefined ? 6 : options.targetReversals;
    const maxTrials = options.maxTrials === undefined ? 40 : options.maxTrials;
    const random = options.random || Math.random;

    let trimDb = startDb;
    let stepIndex = 0;
    let consecutiveSame = 0;
    let lastDirection = 0;
    let trials = 0;
    let status = 'running';
    const reversals = [];
    let pending = null;

    function next() {
      if (status !== 'running') return null;
      if (trials >= maxTrials) { status = 'exhausted'; return null; }
      const aFirst = random() < 0.5;
      pending = { trimDb, aFirst, trial: trials + 1 };
      return {
        question: 'which-louder',
        stimulus: 'alternating-pink-noise',
        trimDb: Number(trimDb.toFixed(2)),
        firstMember: aFirst ? 'a' : 'b',
        stepDb: steps[Math.min(stepIndex, steps.length - 1)],
        trial: pending.trial,
      };
    }

    // response: 'a' | 'b' | 'same'
    function respond(response) {
      if (status !== 'running' || !pending) return { status };
      trials += 1;
      const step = steps[Math.min(stepIndex, steps.length - 1)];

      if (response === 'same') {
        consecutiveSame += 1;
        if (consecutiveSame >= 2) {
          if (stepIndex < steps.length - 1) { stepIndex += 1; consecutiveSame = 0; } else { status = 'converged'; }
        }
        pending = null;
        return { status };
      }
      consecutiveSame = 0;

      // Move the trim toward whichever member was reported louder.
      const direction = response === 'a' ? -1 : 1;
      if (lastDirection !== 0 && direction !== lastDirection) {
        reversals.push(trimDb);
        if (reversals.length % 2 === 0 && stepIndex < steps.length - 1) stepIndex += 1;
        if (reversals.length >= targetReversals) status = 'converged';
      }
      lastDirection = direction;
      trimDb = clamp(trimDb + direction * step, -24, 24);
      pending = null;
      return { status };
    }

    function result() {
      const tail = reversals.slice(-4);
      const estimate = tail.length
        ? tail.reduce((sum, value) => sum + value, 0) / tail.length
        : trimDb;
      return {
        version: VERSION,
        relativeDb: Number(estimate.toFixed(2)),
        // Applied as attenuation to the louder member only.
        attenuateMember: estimate > 0 ? 'b' : 'a',
        attenuationDb: Number((-Math.abs(estimate)).toFixed(2)),
        trials,
        reversals: reversals.length,
        status,
      };
    }

    return { next, respond, result };
  }

  // ------------------------------------------------------------- stimulus

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function nextRandom() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic correlated noise for the null stages. Both members must play
  // the SAME waveform for cancellation to mean anything, so this is generated
  // once per comparison and shared, never generated per member.
  function makeCorrelatedNoise(options = {}) {
    const sampleRate = options.sampleRate || 48000;
    const seconds = options.seconds === undefined ? 1.2 : options.seconds;
    const seed = options.seed === undefined ? 0x9e3779b9 : options.seed;
    const fadeSeconds = options.fadeSeconds === undefined ? 0.02 : options.fadeSeconds;
    const amplitude = options.amplitude === undefined ? 0.25 : options.amplitude;

    const length = Math.max(1, Math.round(seconds * sampleRate));
    const random = mulberry32(seed);
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (random() * 2 - 1) * amplitude;
    const fade = Math.max(1, Math.round(fadeSeconds * sampleRate));
    for (let i = 0; i < fade && i < length; i += 1) {
      const w = 0.5 * (1 - Math.cos(Math.PI * i / fade));
      out[i] *= w;
      out[length - 1 - i] *= w;
    }
    return out;
  }

  return Object.freeze({
    VERSION,
    STAGES,
    createDelaySearch,
    createLevelStaircase,
    makeCorrelatedNoise,
  });
}));
