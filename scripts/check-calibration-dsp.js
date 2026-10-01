// Multi-output speaker alignment measurement audit.
//
// Scores the calibration DSP against synthetic captures with known ground
// truth. Real rooms give no reference answer, so this is the only place the
// arrival estimator can actually be graded.
//
// It also runs the legacy renderer correlator over the same fixtures. That is
// deliberate: the legacy result must stay visibly bad, so that whoever replaces
// it can see the defect rather than take it on faith, and so a regression back
// to peak-picking cannot pass silently.
//

const dsp = require('../src/calibration-dsp');

const SAMPLE_RATE = 48000;
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

// --------------------------------------------------------------- fixtures

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Minimum-phase spectrum from a magnitude, via the real cepstrum. Real speakers
// are approximately minimum phase: their roll-offs carry group delay, which is
// why the correct alignment between dissimilar members is band dependent rather
// than a single number.
function minimumPhase(magnitude, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const mirrored = k <= n / 2 ? k : n - k;
    re[k] = Math.log(Math.max(magnitude[mirrored], 1e-9));
  }
  dsp.fft(re, im, true);
  for (let k = 0; k < n; k += 1) {
    const weight = k === 0 || k === n / 2 ? 1 : (k < n / 2 ? 2 : 0);
    re[k] *= weight;
    im[k] *= weight;
  }
  dsp.fft(re, im, false);
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const magnitudeK = Math.exp(re[k]);
    outRe[k] = magnitudeK * Math.cos(im[k]);
    outIm[k] = magnitudeK * Math.sin(im[k]);
  }
  return { re: outRe, im: outIm };
}

// Direct sound, discrete early reflections, diffuse tail. Reflection amplitudes
// are drawn wide enough that some seeds produce a reflection LOUDER than the
// direct sound. That is the realistic case, and it is the whole reason
// first-arrival detection exists.
function makeRoom(length, seed, rt60 = 0.45) {
  const random = mulberry32(seed);
  const ir = new Float64Array(length);
  ir[0] = 1;
  for (let i = 0; i < 12; i += 1) {
    const delay = Math.round(0.004 * SAMPLE_RATE + random() * (0.05 - 0.004) * SAMPLE_RATE);
    if (delay < length) ir[delay] += gaussian(random) * 0.5 * Math.exp(-3 * delay / SAMPLE_RATE / rt60);
  }
  const tailStart = Math.round(0.02 * SAMPLE_RATE);
  for (let i = tailStart; i < length; i += 1) {
    ir[i] += gaussian(random) * Math.exp(-6.9 * (i / SAMPLE_RATE) / rt60) * 0.06;
  }
  return ir;
}

function simulateMember(sweep, spec) {
  const {
    delayMs, gainDb, lowHz, highHz,
    order = 8, inverted = false, snrDb = 30, seed = 0, reverberant = true,
  } = spec;
  const captureLength = sweep.length + Math.round(SAMPLE_RATE);
  const n = dsp.nextPowerOfTwo(captureLength);

  const magnitude = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k += 1) {
    const f = k * SAMPLE_RATE / n;
    const hp = Math.pow(f / lowHz, order) / Math.sqrt(1 + Math.pow(f / lowHz, 2 * order));
    const lp = 1 / Math.sqrt(1 + Math.pow(f / highHz, 2 * order));
    const value = hp * lp;
    magnitude[k] = Number.isFinite(value) ? value : 0;
  }
  const mp = minimumPhase(magnitude, n);

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < sweep.length; i += 1) re[i] = sweep[i];
  dsp.fft(re, im, false);
  for (let k = 0; k < n; k += 1) {
    const f = (k <= n / 2 ? k : k - n) * SAMPLE_RATE / n;
    const phase = -2 * Math.PI * f * delayMs / 1000;
    const dRe = Math.cos(phase);
    const dIm = Math.sin(phase);
    const hRe = mp.re[k] * dRe - mp.im[k] * dIm;
    const hIm = mp.re[k] * dIm + mp.im[k] * dRe;
    const outRe = re[k] * hRe - im[k] * hIm;
    const outIm = re[k] * hIm + im[k] * hRe;
    re[k] = outRe;
    im[k] = outIm;
  }
  dsp.fft(re, im, true);

  const scale = Math.pow(10, gainDb / 20) * (inverted ? -1 : 1);
  let signal = new Float64Array(captureLength);
  for (let i = 0; i < captureLength; i += 1) signal[i] = re[i] * scale;

  if (reverberant) {
    const convolved = dsp.convolve(signal, makeRoom(Math.round(0.6 * SAMPLE_RATE), seed + 7));
    signal = convolved.subarray(0, captureLength);
  }

  let energy = 0;
  for (let i = 0; i < signal.length; i += 1) energy += signal[i] * signal[i];
  const rms = Math.sqrt(energy / Math.max(1, signal.length));
  const noiseScale = rms * Math.pow(10, -snrDb / 20);
  const random = mulberry32(seed + 991);
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) out[i] = signal[i] + gaussian(random) * noiseScale;
  return out;
}

// ------------------------------------------------- legacy renderer behaviour
//
// Transcribed from src/renderer.js correlateMicCalibrationTrial as of
// 2026-07-26 (lines 12359-12416). Two defects are preserved exactly:
//   - the coarse scan decimates by `stride` with no anti-alias filter;
//   - `best` is the LARGEST |correlation|, not the first arrival.
// Do not "fix" this copy. Its job is to keep failing.

function legacyNormalizedCorrelationAt(samples, sequence, offset, stride = 1) {
  let dot = 0;
  let capturedEnergy = 0;
  let sequenceEnergy = 0;
  for (let index = 0; index < sequence.length; index += stride) {
    const captured = samples[offset + index] || 0;
    const expected = sequence[index] || 0;
    dot += captured * expected;
    capturedEnergy += captured * captured;
    sequenceEnergy += expected * expected;
  }
  if (capturedEnergy < 1e-9 || sequenceEnergy < 1e-9) return 0;
  return dot / Math.sqrt(capturedEnergy * sequenceEnergy);
}

function legacyArrivalIndex(samples, sequence, searchFrom, searchTo) {
  const coarseStride = 8;
  let best = null;
  for (let offset = searchFrom; offset <= searchTo; offset += coarseStride) {
    const correlation = legacyNormalizedCorrelationAt(samples, sequence, offset, coarseStride);
    const candidate = { offset, magnitude: Math.abs(correlation) };
    if (!best || candidate.magnitude > best.magnitude) best = candidate;
  }
  if (!best) return null;
  const refineFrom = Math.max(searchFrom, best.offset - coarseStride);
  const refineTo = Math.min(searchTo, best.offset + coarseStride);
  for (let offset = refineFrom; offset <= refineTo; offset += 1) {
    const correlation = legacyNormalizedCorrelationAt(samples, sequence, offset, 1);
    const magnitude = Math.abs(correlation);
    if (magnitude > best.magnitude) best = { offset, magnitude };
  }
  return best.offset;
}

// ------------------------------------------------------------------ specs

const BOOKSHELF = { delayMs: 5.0, gainDb: 0, lowHz: 55, highHz: 19000 };
const PUCK = { delayMs: 12.7, gainDb: -4.5, lowHz: 190, highHz: 13000, inverted: true };
const TRUE_DELAY_MS = PUCK.delayMs - BOOKSHELF.delayMs;
const SEEDS = 10;

// A short sweep keeps the audit under a minute; production uses 6 s.
const { sweep, inverse } = dsp.makeSweep({ durationSeconds: 2, sampleRate: SAMPLE_RATE });

// A short reference burst, matched to what the legacy path actually correlates
// against, so the legacy comparison is fair rather than rigged.
const legacyReference = (() => {
  const length = Math.round(0.14 * SAMPLE_RATE);
  const random = mulberry32(0x5eedc0de);
  const fade = Math.round(0.012 * SAMPLE_RATE);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const edge = Math.min(1, i / fade, (length - 1 - i) / fade);
    out[i] = (random() * 2 - 1) * Math.max(0, edge) * 0.72;
  }
  return out;
})();

// --------------------------------------------------------------- section A
// Peak-picking versus first-arrival, over reverberant rooms.

function sectionA() {
  const legacyErrors = [];
  const currentErrors = [];

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const captureA = simulateMember(sweep, { ...BOOKSHELF, seed });
    const captureB = simulateMember(sweep, { ...PUCK, seed: seed + 100 });

    const irA = dsp.deconvolve(captureA, inverse);
    const irB = dsp.deconvolve(captureB, inverse);
    const length = Math.min(irA.length, irB.length);

    const arrivalA = dsp.firstArrival(irA.subarray(0, length), { sampleRate: SAMPLE_RATE });
    const arrivalB = dsp.firstArrival(irB.subarray(0, length), { sampleRate: SAMPLE_RATE });
    currentErrors.push((arrivalB.index - arrivalA.index) / SAMPLE_RATE * 1000 - TRUE_DELAY_MS);

    // Legacy path works on the raw capture against its burst reference.
    const legacyReverbA = simulateMember(legacyReference, { ...BOOKSHELF, seed });
    const legacyReverbB = simulateMember(legacyReference, { ...PUCK, seed: seed + 100 });
    const window = Math.round(0.65 * SAMPLE_RATE);
    const offsetA = legacyArrivalIndex(legacyReverbA, legacyReference, 0, window);
    const offsetB = legacyArrivalIndex(legacyReverbB, legacyReference, 0, window);
    if (offsetA !== null && offsetB !== null) {
      legacyErrors.push((offsetB - offsetA) / SAMPLE_RATE * 1000 - TRUE_DELAY_MS);
    }
  }

  const abs = (list) => list.map((value) => Math.abs(value));
  const legacyBad = abs(legacyErrors).filter((value) => value > 1).length;
  const currentBad = abs(currentErrors).filter((value) => value > 1).length;
  const currentMean = abs(currentErrors).reduce((sum, value) => sum + value, 0) / Math.max(1, currentErrors.length);
  const currentWorst = Math.max(...abs(currentErrors));

  notes.push(`A. legacy peak-pick: ${legacyBad}/${legacyErrors.length} seeds wrong by more than 1 ms`);
  notes.push(`A. first-arrival:    ${currentBad}/${currentErrors.length} seeds wrong by more than 1 ms, `
    + `mean ${(currentMean * 1000).toFixed(1)} us, worst ${(currentWorst * 1000).toFixed(1)} us`);

  check('legacy correlator must remain visibly wrong (regression guard)',
    legacyBad > 0,
    `expected at least one seed over 1 ms, got ${legacyBad}/${legacyErrors.length}. `
    + 'If this passes, the fixture stopped exercising the reflection case.');
  check('first-arrival: no seed wrong by more than 1 ms', currentBad === 0, `${currentBad}/${SEEDS} seeds failed`);
  within('first-arrival mean |error|', currentMean * 1000, 0, 50, ' us');
}

// --------------------------------------------------------------- section B
// Full per-member extraction and pair alignment.

function sectionB() {
  const captureA = simulateMember(sweep, { ...BOOKSHELF, seed: 3 });
  const captureB = simulateMember(sweep, { ...PUCK, seed: 103 });
  const irA = dsp.deconvolve(captureA, inverse);
  const irB = dsp.deconvolve(captureB, inverse);
  const length = Math.min(irA.length, irB.length);

  const memberA = dsp.measureMember(irA.subarray(0, length), { sampleRate: SAMPLE_RATE });
  const memberB = dsp.measureMember(irB.subarray(0, length), { sampleRate: SAMPLE_RATE });

  notes.push(`B. bookshelf band ${memberA.band.lowHz}-${memberA.band.highHz} Hz, polarity ${memberA.polarity >= 0 ? '+1' : '-1'}, confidence ${memberA.confidenceDb} dB`);
  notes.push(`B. puck      band ${memberB.band.lowHz}-${memberB.band.highHz} Hz, polarity ${memberB.polarity >= 0 ? '+1' : '-1'}, confidence ${memberB.confidenceDb} dB`);

  check('bookshelf polarity is +1', memberA.polarity === 1, `got ${memberA.polarity}`);
  check('puck polarity is -1 (fixture is inverted)', memberB.polarity === -1, `got ${memberB.polarity}`);

  const bandTolerance = 0.35;
  check('bookshelf low corner near 55 Hz',
    Math.abs(Math.log2(memberA.band.lowHz / 55)) < bandTolerance, `got ${memberA.band.lowHz} Hz`);
  check('puck low corner near 190 Hz',
    Math.abs(Math.log2(memberB.band.lowHz / 190)) < bandTolerance, `got ${memberB.band.lowHz} Hz`);
  check('puck high corner near 13000 Hz',
    Math.abs(Math.log2(memberB.band.highHz / 13000)) < bandTolerance, `got ${memberB.band.highHz} Hz`);
  check('puck band is narrower than bookshelf band',
    memberB.band.lowHz > memberA.band.lowHz && memberB.band.highHz < memberA.band.highHz,
    `puck ${memberB.band.lowHz}-${memberB.band.highHz}, bookshelf ${memberA.band.lowHz}-${memberA.band.highHz}`);

  const delay = dsp.relativeDelayMs(memberA, memberB);
  notes.push(`B. delay coarse ${delay.coarseMs} ms -> refined ${delay.delayMs} ms (true ${TRUE_DELAY_MS} ms), band ${delay.band ? `${delay.band.lowHz}-${delay.band.highHz} Hz` : 'none'}`);
  check('alignment band was found for overlapping members', delay.band !== null);
  within('coarse delay', delay.coarseMs, TRUE_DELAY_MS, 0.1, ' ms');
  within('refined delay', delay.delayMs, TRUE_DELAY_MS, 0.05, ' ms');

  const band = delay.band || { lowHz: 300, highHz: 5000 };
  const levelA = dsp.bandLevelDb(memberA.segment, band.lowHz, band.highHz, SAMPLE_RATE);
  const levelB = dsp.bandLevelDb(memberB.segment, band.lowHz, band.highHz, SAMPLE_RATE);
  const relativeDb = levelB - levelA;
  notes.push(`B. relative level ${relativeDb.toFixed(3)} dB (true ${PUCK.gainDb - BOOKSHELF.gainDb} dB)`);
  within('relative level', relativeDb, PUCK.gainDb - BOOKSHELF.gainDb, 0.5, ' dB');

  return { memberA, memberB };
}

// --------------------------------------------------------------- section C
// Near-disjoint bands: correlation cannot run, arrival difference still can.

function sectionC() {
  const woofer = { delayMs: 5.0, gainDb: 0, lowHz: 40, highHz: 1800 };
  const tweeter = { delayMs: 12.7, gainDb: -4.5, lowHz: 2200, highHz: 18000 };
  const values = [];
  for (let seed = 0; seed < 6; seed += 1) {
    const irW = dsp.deconvolve(simulateMember(sweep, { ...woofer, seed }), inverse);
    const irT = dsp.deconvolve(simulateMember(sweep, { ...tweeter, seed: seed + 100 }), inverse);
    const length = Math.min(irW.length, irT.length);
    const aW = dsp.firstArrival(irW.subarray(0, length), { sampleRate: SAMPLE_RATE, lowHz: 60, highHz: 1500 });
    const aT = dsp.firstArrival(irT.subarray(0, length), { sampleRate: SAMPLE_RATE, lowHz: 2500, highHz: 15000 });
    values.push((aT.index - aW.index) / SAMPLE_RATE * 1000);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  notes.push(`C. woofer/tweeter arrival difference ${mean.toFixed(3)} ms, sd ${(sd * 1000).toFixed(1)} us`);
  check('woofer/tweeter arrival difference is repeatable', sd * 1000 < 60, `sd ${(sd * 1000).toFixed(1)} us`);
  check('woofer/tweeter arrival difference is physically plausible',
    mean > 6.5 && mean < 8.0,
    `got ${mean.toFixed(3)} ms; explicit offset is ${TRUE_DELAY_MS} ms plus the woofer's own group delay`);
}

// --------------------------------------------------------------- section D
// Capability allocation and constrained EQ.

function sectionD(members) {
  const plan = dsp.assignCrossovers([
    { id: 'bookshelf', band: members.memberA.band },
    { id: 'puck', band: members.memberB.band },
  ]);
  const anchor = plan.find((entry) => entry.anchor);
  const limited = plan.find((entry) => !entry.anchor);
  notes.push(`D. crossover plan: anchor=${anchor && anchor.id}, ${limited && limited.id} high-passed at ${limited && limited.highPassHz} Hz`);
  check('the member with the lowest roll-off is the full-range anchor',
    anchor && anchor.id === 'bookshelf', `got ${anchor && anchor.id}`);
  check('the band-limited member is high-passed above its own roll-off',
    limited && limited.highPassHz > members.memberB.band.lowHz,
    `high-pass ${limited && limited.highPassHz} Hz vs roll-off ${members.memberB.band.lowHz} Hz`);

  const eq = dsp.eqTargets(members.memberB.frequencies, members.memberB.magnitude, members.memberB.band);
  let worstBoostInRolloff = 0;
  let maxBoost = 0;
  let maxCut = 0;
  for (let i = 0; i < eq.frequencies.length; i += 1) {
    const correction = eq.correctionDb[i];
    maxBoost = Math.max(maxBoost, correction);
    maxCut = Math.min(maxCut, correction);
    const db = 20 * Math.log10(Math.max(members.memberB.magnitude[i], 1e-12));
    if (eq.referenceDb - db > 8 && correction > worstBoostInRolloff) worstBoostInRolloff = correction;
  }
  notes.push(`D. constrained EQ: max boost ${maxBoost.toFixed(2)} dB, max cut ${maxCut.toFixed(2)} dB, worst boost into a >8 dB deficit ${worstBoostInRolloff.toFixed(2)} dB`);
  check('EQ never boosts more than 6 dB', maxBoost <= 6.001, `got ${maxBoost.toFixed(2)} dB`);
  check('EQ never cuts more than 12 dB', maxCut >= -12.001, `got ${maxCut.toFixed(2)} dB`);
  check('EQ does not push more than 2 dB into a deficit deeper than 8 dB',
    worstBoostInRolloff <= 2.001,
    `got ${worstBoostInRolloff.toFixed(2)} dB. This is the auto-EQ failure mode that makes a cheap speaker sound worse than untouched.`);
}

// --------------------------------------------------------------- section E
// Invariants that are cheap to assert and expensive to violate.

function sectionE() {
  const impulse = new Float64Array(4096);
  impulse[1000] = 1;
  const filtered = dsp.bandpass(impulse, 250, 10000, SAMPLE_RATE);
  let peak = 0;
  for (let i = 1; i < filtered.length; i += 1) if (Math.abs(filtered[i]) > Math.abs(filtered[peak])) peak = i;
  check('bandpass is zero-phase (adds no group delay)',
    Math.abs(peak - 1000) <= 1,
    `impulse moved from 1000 to ${peak}; a filter with its own group delay corrupts every delay measurement`);

  const gated = dsp.directWindow(impulse, 1000, { sampleRate: SAMPLE_RATE });
  check('directWindow returns a compact segment, not a full-length array',
    gated.segment.length < impulse.length / 4,
    `segment length ${gated.segment.length} of ${impulse.length}; zero-padding a gate to full capture length analyses silence`);

  const late = new Float64Array(4096);
  late[3000] = 1;
  const reflectionLouder = new Float64Array(4096);
  reflectionLouder[1500] = 0.4;
  reflectionLouder[1900] = 1.0;
  const arrival = dsp.firstArrival(reflectionLouder, { sampleRate: SAMPLE_RATE, lowHz: 250, highHz: 10000 });
  check('firstArrival picks the earlier quieter arrival over the later louder one',
    Math.abs(arrival.index - 1500) < 120,
    `picked index ${arrival.index}, expected near 1500 (the 0.4 arrival), not 1900 (the 1.0 arrival)`);
  check('firstArrival reports low confidence when a reflection dominates',
    arrival.confidenceDb < -3,
    `confidence ${arrival.confidenceDb} dB should warn the user to move the microphone`);
}

// --------------------------------------------------------------- section F
// Rig planning: the directly applicable output.

function sectionF(members) {
  const plan = dsp.planRig([
    { id: 'bookshelf', label: 'Bookshelf', measurement: members.memberA },
    { id: 'puck', label: 'Bluetooth puck', measurement: members.memberB },
  ]);

  const bookshelf = plan.members.find((entry) => entry.id === 'bookshelf');
  const puck = plan.members.find((entry) => entry.id === 'puck');

  notes.push(`F. anchor=${plan.anchorId}; bookshelf delay ${bookshelf.delayMs} ms gain ${bookshelf.gainDb} dB; `
    + `puck delay ${puck.delayMs} ms gain ${puck.gainDb} dB polarity ${puck.polarity} highpass ${puck.highPassHz} Hz`);
  plan.summary.forEach((line) => notes.push(`F. "${line}"`));

  // Guardrails, enforced in planRig rather than left to the caller.
  check('every delay is positive (you cannot advance a signal)',
    plan.guardrails.delayPositiveOnly && plan.members.every((entry) => entry.delayMs >= 0),
    plan.members.map((entry) => `${entry.id}=${entry.delayMs}`).join(', '));
  check('every gain is attenuation (never boost a quieter member)',
    plan.guardrails.attenuationOnly && plan.members.every((entry) => entry.gainDb <= 0),
    plan.members.map((entry) => `${entry.id}=${entry.gainDb}`).join(', '));
  check('the latest-arriving member is the timing anchor with zero delay',
    plan.anchorId === 'puck' && puck.delayMs === 0,
    `anchor ${plan.anchorId}, puck delay ${puck.delayMs} ms`);
  within('bookshelf is delayed by the measured offset', bookshelf.delayMs, TRUE_DELAY_MS, 0.1, ' ms');
  check('the louder member is the one attenuated',
    bookshelf.gainDb < 0 && puck.gainDb === 0,
    `bookshelf ${bookshelf.gainDb} dB, puck ${puck.gainDb} dB (puck was the quieter fixture at -4.5 dB)`);
  check('measured polarity reaches the plan', puck.polarity === 'inverted' && bookshelf.polarity === 'normal',
    `bookshelf ${bookshelf.polarity}, puck ${puck.polarity}`);
  check('the band-limited member is high-passed and the anchor is not',
    puck.highPassHz > 0 && bookshelf.highPassHz === null,
    `puck ${puck.highPassHz}, bookshelf ${bookshelf.highPassHz}`);

  // Parametric bands must be realisable in the renderer's existing schema.
  plan.members.forEach((entry) => {
    check(`${entry.id} emits exactly 5 parametric bands`, entry.parametric.length === 5, `got ${entry.parametric.length}`);
    entry.parametric.forEach((band, index) => {
      check(`${entry.id} band ${index + 1} matches the renderer schema`,
        band.id === `p${index + 1}`
        && band.frequency >= 20 && band.frequency <= 20000
        && band.q >= 0.1 && band.q <= 12
        && Math.abs(band.gain) <= 12,
        JSON.stringify(band));
    });
  });

  // The fit has to actually approximate the intended curve, or the applied
  // result silently differs from the measured intent.
  const eq = dsp.eqTargets(members.memberB.frequencies, members.memberB.magnitude, members.memberB.band);
  const fitted = dsp.fitParametricBands(eq.frequencies, eq.correctionDb, { sampleRate: SAMPLE_RATE });
  let intended = 0;
  for (let i = 0; i < eq.correctionDb.length; i += 1) intended = Math.max(intended, Math.abs(eq.correctionDb[i]));
  notes.push(`F. EQ fit: intended peak ${intended.toFixed(2)} dB, worst residual after 5 bells ${fitted.worstResidualDb} dB`);
  check('the parametric fit leaves less error than it corrects',
    fitted.worstResidualDb < intended,
    `residual ${fitted.worstResidualDb} dB vs intended peak ${intended.toFixed(2)} dB`);

  // A peaking filter's own response must be modelled correctly, or the fit is
  // subtracting something the renderer will not produce.
  const probe = dsp.peakingResponseDb(Float64Array.from([1000]), 1000, 1.4, 6, SAMPLE_RATE);
  within('peaking filter hits its nominal gain at centre frequency', probe[0], 6, 0.15, ' dB');
  const away = dsp.peakingResponseDb(Float64Array.from([50]), 1000, 1.4, 6, SAMPLE_RATE);
  check('peaking filter is near unity far from centre', Math.abs(away[0]) < 0.5, `got ${away[0].toFixed(3)} dB at 50 Hz`);

  const summaryText = plan.summary.join(' ');
  check('the plan is explained without jargon',
    !/\bms\b.*\bdB\b.*\bHz\b/.test(summaryText) || summaryText.includes('bass'),
    'summary should read as plain language, not a parameter dump');
  check('the summary names the bass decision',
    /bass/i.test(summaryText),
    `got: ${summaryText}`);
}

// ------------------------------------------------------------------- run

const started = Date.now();
try {
  sectionA();
  const members = sectionB();
  sectionC();
  sectionD(members);
  sectionE();
  sectionF(members);
} catch (error) {
  errors.push(`audit threw: ${error && error.stack ? error.stack : error}`);
}

notes.forEach((note) => console.log(note));
console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);

if (errors.length) {
  console.error(`Calibration DSP audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Calibration DSP audit passed: first-arrival timing, polarity, usable band, '
  + 'pair alignment, capability allocation, and constrained EQ all match known ground truth.');
