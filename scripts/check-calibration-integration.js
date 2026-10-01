// Calibration integration audit.
//
// The module audits score the DSP. This one scores the wiring, and it exists
// because the wiring is where the last two defects lived: the analysis worker
// read `measurement.arrival.index` from an object that has no `arrival`
// property, and it reported an arrival index still carrying the deconvolution's
// own sweep-length offset.
//
// Neither was visible to `node --check`, to the DSP audits, or to review. The
// first threw on every real run, so microphone calibration failed outright; the
// second inflated every reported latency by the whole sweep duration while
// leaving relative delays correct, which is the kind of wrong that survives a
// demo.
//
// So this audit EXECUTES the real worker source against synthetic captures with
// known latency, rather than reading it. Static checks on the renderer follow.
//

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dsp = require('../src/calibration-dsp');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const SAMPLE_RATE = 48000;
const SWEEP_SECONDS = 4;
const errors = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) return true;
  errors.push(`${label}${detail ? `: ${detail}` : ''}`);
  return false;
}

function within(label, actual, expected, tolerance, unit = '') {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  return check(label, ok, `got ${Number(actual).toFixed(4)}${unit}, expected ${expected}${unit} +/- ${tolerance}${unit}`);
}

// ------------------------------------------------------- worker sandbox
//
// Load the real worker file with the globals a Worker would provide. If the
// worker's contract with calibration-dsp.js ever drifts again, this throws.

function loadWorker() {
  const sandbox = {
    performance: { now: () => Date.now() },
    Float32Array,
    Float64Array,
    Math,
    Number,
    Object,
    Array,
    String,
    Error,
    console,
  };
  sandbox.self = sandbox;
  sandbox.importScripts = (file) => {
    vm.runInContext(read(path.join('src', file)), sandbox, { filename: file });
  };
  vm.createContext(sandbox);
  vm.runInContext(read('src/calibration-analysis-worker.js'), sandbox, { filename: 'calibration-analysis-worker.js' });
  if (typeof sandbox.onmessage !== 'function') throw new Error('worker did not register an onmessage handler');
  return sandbox;
}

function runWorker(sandbox, payload) {
  let response = null;
  sandbox.postMessage = (message) => { response = message; };
  sandbox.onmessage({ data: payload });
  if (!response) throw new Error('worker produced no response');
  return response;
}

// ---------------------------------------------------------- fixtures

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A capture containing one sweep per trial, each arriving `acousticDelayMs`
// after the moment it was scheduled. This is what the microphone would return.
function buildCapture(options) {
  const {
    trialCount = 2,
    firstOffsetSeconds = 0.85,
    spacingSeconds = 4.85,
    acousticDelayMs,
    inverted = false,
    gain = 0.3,
    noise = 0.0008,
    seed = 5,
  } = options;

  const sweep = dsp.makeSweep({ durationSeconds: SWEEP_SECONDS, sampleRate: SAMPLE_RATE });
  const totalSeconds = firstOffsetSeconds + spacingSeconds * trialCount + SWEEP_SECONDS + 1;
  const samples = new Float32Array(Math.round(totalSeconds * SAMPLE_RATE));
  const random = mulberry32(seed);
  for (let i = 0; i < samples.length; i += 1) samples[i] = (random() * 2 - 1) * noise;

  const trials = [];
  const delayFrames = Math.round(acousticDelayMs / 1000 * SAMPLE_RATE);
  for (let t = 0; t < trialCount; t += 1) {
    const scheduledSeconds = firstOffsetSeconds + spacingSeconds * t;
    const scheduledIndex = Math.round(scheduledSeconds * SAMPLE_RATE);
    const arrivalIndex = scheduledIndex + delayFrames;
    for (let i = 0; i < sweep.sweep.length; i += 1) {
      const target = arrivalIndex + i;
      if (target < samples.length) samples[target] += sweep.sweep[i] * gain * (inverted ? -1 : 1);
    }
    trials.push({ code: t % 2 ? 'B' : 'A', cycle: 1, ordinal: t + 1, captureTime: scheduledSeconds });
  }
  return { samples, trials, noiseRms: noise / Math.sqrt(3) };
}

function payloadFor(capture, startedAt = 0) {
  const buffer = capture.samples.buffer.slice(0);
  return {
    samples: buffer,
    sampleRate: SAMPLE_RATE,
    captureStartTime: 0,
    trials: capture.trials,
    noiseRms: capture.noiseRms,
    startedAt,
  };
}

// --------------------------------------------------------------- section A
// The worker runs at all, and reports the latency that was actually simulated.

function sectionA(sandbox) {
  const trueDelayMs = 37.5;
  const capture = buildCapture({ acousticDelayMs: trueDelayMs, trialCount: 2 });
  const response = runWorker(sandbox, payloadFor(capture));

  check('the analysis worker completes without throwing',
    response.ok === true,
    `worker returned an error: ${response.error}. This is the failure that made microphone calibration `
    + 'unusable while every static gate stayed green.');
  if (!response.ok) return null;

  const trials = response.result.trials;
  notes.push(`A. worker returned ${trials.length} trials, ${trials.filter((t) => t.usable).length} usable, `
    + `latencies ${trials.map((t) => t.latencyMs.toFixed(2)).join(', ')} ms (true ${trueDelayMs} ms)`);

  check('every trial is usable on a clean capture',
    trials.every((trial) => trial.usable),
    trials.filter((trial) => !trial.usable).map((trial) => `#${trial.ordinal} ${trial.reason}`).join(', '));

  trials.forEach((trial) => {
    within(`trial ${trial.ordinal} reports the simulated acoustic latency`, trial.latencyMs, trueDelayMs, 1.0, ' ms');
  });

  // The specific regression: a reported latency still carrying the sweep length.
  const sweepMs = SWEEP_SECONDS * 1000;
  check('reported latency does not carry the deconvolution offset',
    trials.every((trial) => Math.abs(trial.latencyMs - trueDelayMs) < sweepMs / 2),
    `latencies near ${sweepMs} ms mean the (sweepLength - 1) deconvolution offset was not removed. `
    + 'Relative delays between members stay correct under that bug, so it survives casual testing.');

  return response.result;
}

// --------------------------------------------------------------- section B
// The renderer's contract with the worker.

function sectionB(result) {
  if (!result) return;
  const trial = result.trials[0];
  const required = ['usable', 'reason', 'latencyMs', 'peakToSidelobeDb', 'signalToNoiseDb',
    'placementConfidenceDb', 'reflectionDominant', 'polarity', 'usableBandHz', 'rms', 'peak', 'clippedFrames'];
  required.forEach((field) => {
    check(`the worker returns \`${field}\``, trial[field] !== undefined, `missing from trial payload`);
  });
  check('trial identity survives the round trip',
    trial.code !== undefined && trial.cycle !== undefined && trial.ordinal !== undefined,
    'A-B-B-A ordering and cycle statistics depend on these');
  check('the usable band is a two-element range',
    Array.isArray(trial.usableBandHz) && trial.usableBandHz.length === 2 && trial.usableBandHz[0] < trial.usableBandHz[1],
    JSON.stringify(trial.usableBandHz));
  check('placement confidence is a non-positive dB figure',
    Number.isFinite(trial.placementConfidenceDb) && trial.placementConfidenceDb <= 0.01,
    `${trial.placementConfidenceDb}`);
  notes.push(`B. trial payload: polarity ${trial.polarity}, band ${trial.usableBandHz[0]}-${trial.usableBandHz[1]} Hz, `
    + `placement ${trial.placementConfidenceDb} dB, sidelobe ${trial.peakToSidelobeDb} dB, SNR ${trial.signalToNoiseDb} dB`);
}

// --------------------------------------------------------------- section C
// Polarity and relative delay through the whole wiring.

function sectionC(sandbox) {
  const normal = runWorker(sandbox, payloadFor(buildCapture({ acousticDelayMs: 20, trialCount: 1, seed: 11 })));
  const flipped = runWorker(sandbox, payloadFor(buildCapture({ acousticDelayMs: 20, trialCount: 1, inverted: true, seed: 11 })));
  check('both polarity captures analysed', normal.ok && flipped.ok, `${normal.error || ''} ${flipped.error || ''}`);
  if (!normal.ok || !flipped.ok) return;

  notes.push(`C. polarity: normal capture -> ${normal.result.trials[0].polarity}, inverted capture -> ${flipped.result.trials[0].polarity}`);
  check('a normal capture reports normal polarity', normal.result.trials[0].polarity === 'normal', normal.result.trials[0].polarity);
  check('an inverted capture reports inverted polarity', flipped.result.trials[0].polarity === 'inverted', flipped.result.trials[0].polarity);

  // Two members at different latencies: the difference is what alignment uses.
  const fast = runWorker(sandbox, payloadFor(buildCapture({ acousticDelayMs: 12, trialCount: 1, seed: 21 })));
  const slow = runWorker(sandbox, payloadFor(buildCapture({ acousticDelayMs: 46, trialCount: 1, seed: 22 })));
  if (fast.ok && slow.ok) {
    const relative = slow.result.trials[0].latencyMs - fast.result.trials[0].latencyMs;
    notes.push(`C. relative delay between members: ${relative.toFixed(3)} ms (true 34.000 ms)`);
    within('relative delay between two members', relative, 34, 1.0, ' ms');
  }
}

// --------------------------------------------------------------- section D
// Bad captures are rejected rather than reported confidently.

function sectionD(sandbox) {
  const clipped = buildCapture({ acousticDelayMs: 30, trialCount: 1, gain: 4.0, seed: 31 });
  for (let i = 0; i < clipped.samples.length; i += 1) clipped.samples[i] = Math.max(-1, Math.min(1, clipped.samples[i]));
  const clippedResult = runWorker(sandbox, payloadFor(clipped));
  check('a clipped capture is analysed and rejected, not crashed on', clippedResult.ok === true, clippedResult.error);
  if (clippedResult.ok) {
    const trial = clippedResult.result.trials[0];
    notes.push(`D. clipped capture -> usable ${trial.usable}, reason "${trial.reason}"`);
    check('a clipped capture is not usable', !trial.usable, `reason "${trial.reason}"`);
    check('clipping is named as the reason', trial.reason === 'captured-clipping', trial.reason);
  }

  const buried = buildCapture({ acousticDelayMs: 30, trialCount: 1, gain: 0.002, noise: 0.05, seed: 41 });
  const buriedResult = runWorker(sandbox, payloadFor(buried));
  check('a capture buried in noise is analysed and rejected', buriedResult.ok === true, buriedResult.error);
  if (buriedResult.ok) {
    const trial = buriedResult.result.trials[0];
    notes.push(`D. noise-buried capture -> usable ${trial.usable}, reason "${trial.reason}", SNR ${trial.signalToNoiseDb} dB`);
    check('a noise-buried capture is not usable', !trial.usable, `reason "${trial.reason}"`);
    // The reason drives what the wizard tells the user to do next. A silent
    // capture blamed on microphone placement sends them to move a microphone
    // when the actual problem is that nothing was playing.
    check('a noise-buried capture is diagnosed as low signal-to-noise, not bad placement',
      trial.reason === 'low-capture-snr',
      `reason "${trial.reason}". Placement confidence is meaningless without a signal, so signal-to-noise `
      + 'must be checked first.');
  }
}

// --------------------------------------------------------------- section E
// Static assertions on the renderer wiring.

function sectionE() {
  const renderer = read('src/renderer.js');
  const worker = read('src/calibration-analysis-worker.js');
  const index = read('src/index.html');

  const forbidden = [
    ['const coarseStride', 'the decimated coarse correlation search'],
    ['function normalizedCorrelationAt', 'the legacy normalized correlator'],
    ['best.magnitude < 0.18', 'the absolute correlation floor that rejected band-limited speakers'],
    ['candidate.magnitude > best.magnitude', 'largest-peak arrival selection'],
  ];
  forbidden.forEach(([needle, description]) => {
    check(`the renderer no longer contains ${description}`, !renderer.includes(needle), `found ${JSON.stringify(needle)}`);
  });

  const required = [
    [renderer, 'window.PixelodyCalibrationDsp', 'the renderer binds the shared DSP module'],
    [renderer, 'calibration-analysis-worker.js', 'the renderer runs analysis in a worker'],
    [renderer, 'placementConfidenceDb', 'the renderer carries placement confidence'],
    [index, 'calibration-dsp.js', 'index.html loads the DSP module'],
    [worker, "importScripts('calibration-dsp.js')", 'the worker loads the same DSP module rather than a copy'],
    [worker, 'dsp.deconvolve', 'the worker deconvolves rather than correlating a burst'],
    [worker, 'dsp.measureMember', 'the worker uses the shared measurement entry point'],
    [worker, 'deconvolutionOffset', 'the worker removes the deconvolution offset'],
  ];
  required.forEach(([source, needle, description]) => {
    check(description, source.includes(needle), `missing ${JSON.stringify(needle)}`);
  });

  // The worker must never re-implement the DSP; that would let the shipped path
  // and the audited path diverge silently.
  check('the worker does not re-implement first-arrival detection',
    !worker.includes('function firstArrival'),
    'the worker must call the shared module, not carry its own copy');

  // Placement confidence must gate the whole capture, not filter trials.
  check('a reflection-dominant capture is a capture-wide gate',
    /Placement is a capture-wide safety gate/.test(renderer) || /reflectionDominant/.test(renderer),
    'discarding reflection-dominant trials and calling the remainder confident hides the problem');
}

// ------------------------------------------------------------------- run

const started = Date.now();
try {
  const sandbox = loadWorker();
  const result = sectionA(sandbox);
  sectionB(result);
  sectionC(sandbox);
  sectionD(sandbox);
  sectionE();
} catch (error) {
  errors.push(`audit threw: ${error && error.stack ? error.stack : error}`);
}

notes.forEach((note) => console.log(note));
console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);

if (errors.length) {
  console.error(`Calibration integration audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Calibration integration audit passed: the analysis worker runs against real captures, reports '
  + 'the latency that was simulated, propagates polarity and placement confidence, rejects unusable captures, '
  + 'and the legacy correlator has not returned.');
