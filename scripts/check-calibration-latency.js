// Deterministic latency prior audit.
//
// Scores prior combination, search-window sizing, reconciliation against an
// acoustic result, and clock-ratio fitting. Nothing here measures anything
// acoustically; its job is to arrive at the acoustic measurement already
// knowing roughly where the answer is.
//
// The most important property under test is not accuracy but honesty: a prior
// that is confidently wrong is worse than one that is vaguely right, because a
// narrow window can exclude the true answer entirely.
//

const latency = require('../src/calibration-latency');

const errors = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) return true;
  errors.push(`${label}${detail ? `: ${detail}` : ''}`);
  return false;
}

function within(label, actual, expected, tolerance, unit = '') {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  return check(label, ok, `got ${Number(actual).toFixed(3)}${unit}, expected ${expected}${unit} +/- ${tolerance}${unit}`);
}

// --------------------------------------------------------------- section A
// Correlated sources must not be counted twice.

function sectionA() {
  const independent = latency.combinePriors([
    { id: 'a', ms: 100, uncertaintyMs: 10, independent: true },
    { id: 'b', ms: 100, uncertaintyMs: 10, independent: true },
  ]);
  const correlated = latency.combinePriors([
    { id: 'wasapi', ms: 100, uncertaintyMs: 10, independent: false, family: 'driver-reported' },
    { id: 'webaudio', ms: 100, uncertaintyMs: 10, independent: false, family: 'driver-reported' },
  ]);

  notes.push(`A. two independent sources at +/-10 ms -> +/-${independent.uncertaintyMs} ms`);
  notes.push(`A. two driver-derived sources at +/-10 ms -> +/-${correlated.uncertaintyMs} ms (${correlated.suppressedForCorrelation} suppressed)`);

  within('two independent sources tighten the prior', independent.uncertaintyMs, 7.07, 0.1, ' ms');
  check('two driver-derived sources do not tighten the prior',
    correlated.uncertaintyMs >= 9.9 && correlated.suppressedForCorrelation === 1,
    `+/-${correlated.uncertaintyMs} ms, ${correlated.suppressedForCorrelation} suppressed. `
    + 'The WASAPI figure and the Web Audio estimate both descend from the same driver; averaging them as two '
    + 'witnesses produces a confidence interval about 1.4x too narrow, which can confidently exclude the true value.');

  // Disagreement must widen the prior, not average away.
  const disagreeing = latency.combinePriors([
    { id: 'a', ms: 60, uncertaintyMs: 5, independent: true },
    { id: 'b', ms: 140, uncertaintyMs: 5, independent: true },
  ]);
  notes.push(`A. sources 80 ms apart, each claiming +/-5 ms -> +/-${disagreeing.uncertaintyMs} ms (formal +/-${disagreeing.formalUncertaintyMs} ms)`);
  check('sources that disagree widen the prior instead of reporting false confidence',
    disagreeing.uncertaintyMs >= 35,
    `+/-${disagreeing.uncertaintyMs} ms. If two sources 80 ms apart both claim +/-5 ms, the claimed precision is wrong.`);

  const empty = latency.combinePriors([]);
  check('no sources falls back rather than throwing', empty.method === 'fallback-no-sources' && empty.uncertaintyMs > 0);
}

// --------------------------------------------------------------- section B
// Endpoint priors from realistic inputs.

function sectionB() {
  const wired = latency.endpointPrior({ transport: 'wired', wasapiMs: 12, webAudioMs: 22 });
  const bluetooth = latency.endpointPrior({ transport: 'bluetooth', codec: 'sbc', webAudioMs: 40 });
  const known = latency.endpointPrior({ transport: 'bluetooth', codec: 'aptx-ll', previousMeasuredMs: 43, routeUnchanged: true });
  const reconnected = latency.endpointPrior({ transport: 'bluetooth', codec: 'aptx-ll', previousMeasuredMs: 43, routeUnchanged: false });

  notes.push(`B. wired:            ${wired.ms} +/- ${wired.uncertaintyMs} ms`);
  notes.push(`B. bluetooth SBC:    ${bluetooth.ms} +/- ${bluetooth.uncertaintyMs} ms`);
  notes.push(`B. known route:      ${known.ms} +/- ${known.uncertaintyMs} ms`);
  notes.push(`B. after reconnect:  ${reconnected.ms} +/- ${reconnected.uncertaintyMs} ms`);

  check('a wired endpoint gets a tight low prior', wired.ms < 60 && wired.uncertaintyMs < 20, `${wired.ms} +/- ${wired.uncertaintyMs}`);

  // Host buffering and the transport link are additive stages, not competing
  // estimates. Collapsing them back into one average produces a prior near
  // 52 ms for this endpoint against a real value near 220 ms, and a search
  // window built on it excludes the answer.
  check('a Bluetooth prior adds the link to the host figure rather than averaging them',
    bluetooth.ms > 150,
    `${bluetooth.ms} ms. Web Audio reported 40 ms and the SBC table says ~180 ms; those ADD. `
    + 'A value near 50 ms means the two stages were averaged as if they measured the same quantity.');
  check('the Bluetooth prior keeps its stage breakdown',
    bluetooth.composite && bluetooth.composite.stages && bluetooth.composite.stages.link.ms > 100,
    JSON.stringify(bluetooth.composite && bluetooth.composite.stages));
  check('a previously measured route is the tightest prior available',
    known.uncertaintyMs < bluetooth.uncertaintyMs,
    `known +/-${known.uncertaintyMs} vs codec-only +/-${bluetooth.uncertaintyMs}`);
  check('a reconnect discounts the previous measurement',
    reconnected.uncertaintyMs > known.uncertaintyMs,
    `reconnected +/-${reconnected.uncertaintyMs} vs same-route +/-${known.uncertaintyMs}. `
    + 'Bluetooth renegotiates buffering on reconnect without any user action.');

  // The codec table must be honest about how little it knows.
  const unknownBt = latency.codecPrior('unknown-bluetooth');
  check('an unknown Bluetooth codec admits a wide range', unknownBt.uncertaintyMs > 40, `+/-${unknownBt.uncertaintyMs} ms`);
  check('an unrecognised codec name falls back rather than guessing precisely',
    latency.codecPrior('some-new-codec').uncertaintyMs > 40);
}

// --------------------------------------------------------------- section C
// Search windows.

function sectionC() {
  const tight = latency.searchWindow({ ms: 43, uncertaintyMs: 2 });
  const loose = latency.searchWindow({ ms: 180, uncertaintyMs: 60 });
  notes.push(`C. tight prior 43 +/- 2 ms  -> window ${tight.startMs}-${tight.endMs} ms (${tight.widthMs} ms wide), by-ear bracket +/-${tight.byEarBracketMs} ms`);
  notes.push(`C. loose prior 180 +/- 60 ms -> window ${loose.startMs}-${loose.endMs} ms (${loose.widthMs} ms wide), by-ear bracket +/-${loose.byEarBracketMs} ms`);

  check('a tight prior still gets a floor-width window',
    tight.widthMs >= 30,
    `${tight.widthMs} ms. A suspiciously confident prior must not produce a window too narrow to contain the answer.`);
  check('a tight prior beats the legacy fixed 650 ms window', tight.widthMs < 650, `${tight.widthMs} ms`);
  check('a loose prior widens the window', loose.widthMs > tight.widthMs, `${loose.widthMs} vs ${tight.widthMs} ms`);
  check('the window never starts below zero', tight.startMs >= 0 && loose.startMs >= 0);
  check('the by-ear bracket stays inside what a listener can search',
    tight.byEarBracketMs <= 20 && loose.byEarBracketMs <= 20,
    `${tight.byEarBracketMs}, ${loose.byEarBracketMs}. A listener asked to search +/-250 ms cannot finish.`);
  check('the by-ear bracket is never degenerate', tight.byEarBracketMs >= 2, `${tight.byEarBracketMs} ms`);

  const nearZero = latency.searchWindow({ ms: 3, uncertaintyMs: 1 });
  check('a near-zero prior clamps at zero rather than going negative', nearZero.startMs === 0, `${nearZero.startMs} ms`);
}

// --------------------------------------------------------------- section D
// Reconciliation. Disagreement is information, not an error.

function sectionD() {
  const prior = { ms: 180, uncertaintyMs: 25 };
  const agrees = latency.reconcile(prior, 172);
  const marginal = latency.reconcile(prior, 245);
  const disagrees = latency.reconcile(prior, 420);
  const missing = latency.reconcile(prior, null);

  notes.push(`D. measured 172 ms -> ${agrees.verdict} (${agrees.sigmas} sigma)`);
  notes.push(`D. measured 245 ms -> ${marginal.verdict} (${marginal.sigmas} sigma)`);
  notes.push(`D. measured 420 ms -> ${disagrees.verdict} (${disagrees.sigmas} sigma)`);

  check('a result inside the prior agrees', agrees.agrees && agrees.verdict === 'agrees', agrees.verdict);
  check('a result at the edge is marginal', marginal.verdict === 'marginal', marginal.verdict);
  check('a result far outside the prior disagrees', disagrees.verdict === 'disagrees' && !disagrees.agrees, disagrees.verdict);
  check('disagreement explains what to check rather than just failing',
    /reflection/i.test(disagrees.note) && /route/i.test(disagrees.note),
    disagrees.note);
  check('a missing measurement is not treated as agreement', !missing.agrees, missing.verdict);
}

// --------------------------------------------------------------- section E
// Clock ratio fitting.

function sectionE() {
  function series({ ppm, seconds, hz = 1, jitterFrames = 0, seed = 1 }) {
    let a = seed >>> 0;
    const random = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    const rate = 48000 * (1 + ppm / 1e6);
    const out = [];
    for (let t = 0; t < seconds; t += 1 / hz) {
      const jitter = jitterFrames ? (random() * 2 - 1) * jitterFrames : 0;
      out.push({ hostNanos: t * 1e9, framePosition: Math.round(rate * t + jitter) });
    }
    return out;
  }

  const clean = latency.estimateClockRatio(series({ ppm: 20, seconds: 60 }), 48000);
  const noisy = latency.estimateClockRatio(series({ ppm: -35, seconds: 60, jitterFrames: 40 }), 48000);
  const short = latency.estimateClockRatio(series({ ppm: 20, seconds: 8 }), 48000);
  const sparse = latency.estimateClockRatio(series({ ppm: 20, seconds: 60, hz: 0.05 }), 48000);

  notes.push(`E. clean 20 ppm over 60 s  -> ${clean.ppm} ppm, r2 ${clean.r2}, usable ${clean.usable}`);
  notes.push(`E. jittered -35 ppm        -> ${noisy.ppm} ppm, residual ${noisy.residualFrames} frames, usable ${noisy.usable}`);
  notes.push(`E. 8 s window              -> ${short.usable ? short.ppm + ' ppm' : 'refused: ' + short.reason}`);

  within('clean drift is recovered', clean.ppm, 20, 2, ' ppm');
  check('clean drift is usable', clean.usable, `r2 ${clean.r2}`);
  within('drift survives realistic timestamp jitter', noisy.ppm, -35, 3, ' ppm');
  check('a short observation window is refused rather than answered',
    !short.usable && /at least/.test(short.reason),
    `${short.usable} ${short.reason}. A short window cannot separate drift from jitter.`);
  check('too few samples is refused', !sparse.usable || sparse.samples >= 8, `${sparse.samples} samples`);
}

// --------------------------------------------------------------- section F
// Bounded correction, and the separation from saved alignment.

function sectionF() {
  const gentle = latency.rateCorrection(20, { currentPpm: 0 });
  const extreme = latency.rateCorrection(5000, { currentPpm: 0 });
  const slewed = latency.rateCorrection(-200, { currentPpm: 0 });

  notes.push(`F. 20 ppm drift -> correction ${gentle.ppm} ppm, playbackRate ${gentle.playbackRate}`);
  notes.push(`F. 5000 ppm drift -> correction ${extreme.ppm} ppm (clamped ${extreme.clamped})`);

  check('correction opposes the drift', gentle.ppm < 0, `${gentle.ppm} ppm for +20 ppm drift`);
  check('correction is bounded to +/-300 ppm', Math.abs(extreme.ppm) <= 300 && extreme.clamped, `${extreme.ppm} ppm`);
  check('correction slews at no more than 20 ppm per observation',
    Math.abs(slewed.ppm) <= 20,
    `${slewed.ppm} ppm in one step; the native follower controller limits slew to 20 ppm per update`);
  check('correction is marked transient so it cannot be mistaken for saved alignment',
    gentle.transientOnly === true && extreme.transientOnly === true,
    'a clock observation must never rewrite member.delayMs');
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
  console.error(`Latency prior audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Latency prior audit passed: correlated sources are not double counted, disagreement widens '
  + 'rather than narrows, search windows stay searchable, and clock drift is bounded and transient.');
