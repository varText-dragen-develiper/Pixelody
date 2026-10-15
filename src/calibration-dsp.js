(function calibrationDspFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCalibrationDsp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCalibrationDsp() {
  'use strict';

  // Pure measurement DSP for multi-output speaker alignment.
  //
  // No DOM, no AudioContext, no renderer state. Everything here is deterministic
  // and testable from node, which is the point: the defects this module replaces
  // were invisible to code review and produced plausible-looking output when
  // wrong.
  //
  // Scored against known ground truth by scripts/check-calibration-dsp.js.

  const VERSION = 1;
  const DEFAULT_SAMPLE_RATE = 48000;

  // Bands used when nothing better is known yet. Once a member has a measured
  // usable band, derive the alignment band from the overlap instead.
  const DEFAULT_ARRIVAL_BAND_HZ = [250, 10000];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function nextPowerOfTwo(value) {
    let size = 1;
    while (size < value) size *= 2;
    return size;
  }

  function median(values) {
    const list = Array.from(values).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!list.length) return NaN;
    const middle = list.length >> 1;
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  // ------------------------------------------------------------------ FFT
  // Iterative in-place radix-2 Cooley-Tukey. Length must be a power of two.

  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / len;
      const wRe = Math.cos(angle);
      const wIm = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let curRe = 1;
        let curIm = 0;
        for (let k = 0; k < len / 2; k += 1) {
          const aRe = re[i + k];
          const aIm = im[i + k];
          const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
          const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
          re[i + k] = aRe + bRe;
          im[i + k] = aIm + bIm;
          re[i + k + len / 2] = aRe - bRe;
          im[i + k + len / 2] = aIm - bIm;
          const nextRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nextRe;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i += 1) { re[i] /= n; im[i] /= n; }
    }
  }

  function padded(signal, size) {
    const out = new Float64Array(size);
    const limit = Math.min(signal.length, size);
    for (let i = 0; i < limit; i += 1) out[i] = signal[i];
    return out;
  }

  function convolve(a, b) {
    const outputLength = a.length + b.length - 1;
    const n = nextPowerOfTwo(outputLength);
    const aRe = padded(a, n);
    const aIm = new Float64Array(n);
    const bRe = padded(b, n);
    const bIm = new Float64Array(n);
    fft(aRe, aIm, false);
    fft(bRe, bIm, false);
    for (let i = 0; i < n; i += 1) {
      const re = aRe[i] * bRe[i] - aIm[i] * bIm[i];
      const im = aRe[i] * bIm[i] + aIm[i] * bRe[i];
      aRe[i] = re;
      aIm[i] = im;
    }
    fft(aRe, aIm, true);
    return aRe.subarray(0, outputLength);
  }

  // Frequency for FFT bin k, folding the negative half. Used by every mask.
  function binFrequency(k, n, sampleRate) {
    return (k <= n / 2 ? k : n - k) * sampleRate / n;
  }

  // ------------------------------------------------------- stimulus (D5)

  // Exponential sine sweep plus its inverse filter. ESS rather than noise or
  // MLS because it pushes harmonic distortion into negative time, where the
  // direct-sound window removes it. Cheap speakers driven loud enough to
  // measure over a room's noise floor are distorting; MLS would fold that
  // distortion into the impulse response noise floor instead.
  function makeSweep(options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const f1 = options.f1 || 20;
    const f2 = options.f2 || Math.min(20000, sampleRate / 2 - 100);
    const duration = options.durationSeconds || 6;
    const fadeSeconds = options.fadeSeconds === undefined ? 0.05 : options.fadeSeconds;

    const n = Math.round(duration * sampleRate);
    const ratio = Math.log(f2 / f1);
    const sweep = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      sweep[i] = Math.sin(2 * Math.PI * f1 * duration / ratio * (Math.exp(t * ratio / duration) - 1));
    }
    const fade = Math.max(1, Math.round(fadeSeconds * sampleRate));
    for (let i = 0; i < fade && i < n; i += 1) {
      const w = 0.5 * (1 - Math.cos(Math.PI * i / fade));
      sweep[i] *= w;
      sweep[n - 1 - i] *= w;
    }

    // Inverse: time reversed with a -6 dB/oct envelope, which whitens the
    // pink spectrum of the sweep so the deconvolution yields a flat impulse.
    const inverse = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      inverse[i] = sweep[n - 1 - i] * Math.exp(-(i / sampleRate) * ratio / duration);
    }
    const probe = convolve(sweep, inverse);
    let peak = 0;
    for (let i = 0; i < probe.length; i += 1) peak = Math.max(peak, Math.abs(probe[i]));
    if (peak > 0) for (let i = 0; i < n; i += 1) inverse[i] /= peak;

    return { sweep, inverse, sampleRate, durationSeconds: n / sampleRate, f1, f2 };
  }

  // INVARIANT: returns the impulse response in the ABSOLUTE time base of the
  // capture. It deliberately does not window or re-zero. Every member measured
  // in one session must stay on one shared time base, because the quantity
  // being measured IS the offset between them. Window later, at firstArrival.
  function deconvolve(recording, inverse) {
    return convolve(recording, inverse);
  }

  // ------------------------------------------------------- filtering (D3)

  // Zero-phase band-pass with raised-cosine skirts. Zero-phase is required:
  // a filter carrying its own group delay corrupts a delay measurement.
  function bandpass(signal, lowHz, highHz, sampleRate = DEFAULT_SAMPLE_RATE) {
    const n = nextPowerOfTwo(signal.length * 2);
    const re = padded(signal, n);
    const im = new Float64Array(n);
    fft(re, im, false);
    const lo1 = lowHz / Math.SQRT2;
    const lo2 = lowHz;
    const hi1 = highHz;
    const hi2 = highHz * Math.SQRT2;
    for (let k = 0; k < n; k += 1) {
      const f = binFrequency(k, n, sampleRate);
      let gain;
      if (f >= lo2 && f <= hi1) gain = 1;
      else if (f > lo1 && f < lo2) gain = 0.5 * (1 - Math.cos(Math.PI * (f - lo1) / (lo2 - lo1)));
      else if (f > hi1 && f < hi2) gain = 0.5 * (1 + Math.cos(Math.PI * (f - hi1) / (hi2 - hi1)));
      else gain = 0;
      re[k] *= gain;
      im[k] *= gain;
    }
    fft(re, im, true);
    return re.subarray(0, signal.length);
  }

  // Hilbert envelope. Used instead of |x| because a band-limited impulse
  // oscillates, and thresholding a raw oscillation picks an arbitrary zero
  // crossing rather than the arrival.
  function analyticEnvelope(signal) {
    const n = nextPowerOfTwo(signal.length);
    const re = padded(signal, n);
    const im = new Float64Array(n);
    fft(re, im, false);
    for (let k = 1; k < n / 2; k += 1) { re[k] *= 2; im[k] *= 2; }
    for (let k = n / 2 + 1; k < n; k += 1) { re[k] = 0; im[k] = 0; }
    fft(re, im, true);
    const env = new Float64Array(signal.length);
    for (let i = 0; i < signal.length; i += 1) env[i] = Math.hypot(re[i], im[i]);
    return env;
  }

  // --------------------------------------------------- arrival timing (D1)

  // INVARIANT: the FIRST arrival above threshold, never the LARGEST.
  //
  // A reflection off a desk, wall or floor can easily be louder than the direct
  // sound, especially for a small speaker on a hard surface, which is exactly
  // the hardware this feature exists for. It can never be earlier. Peak-picking
  // latches onto whichever is louder and returns a delay wrong by the path
  // difference, typically 5-45 ms: audible as smearing, invisible in the UI,
  // and impossible for a listener to diagnose by ear.
  //
  // confidenceDb reports how far the direct sound sits below the loudest
  // arrival. Near 0 dB means the direct sound dominates. Strongly negative
  // means the microphone is closer to a reflecting surface than to the speaker;
  // ask the user to move the microphone rather than proceeding silently.
  function firstArrival(impulseResponse, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const lowHz = options.lowHz || DEFAULT_ARRIVAL_BAND_HZ[0];
    const highHz = options.highHz || DEFAULT_ARRIVAL_BAND_HZ[1];
    const thresholdDb = options.thresholdDb === undefined ? -20 : options.thresholdDb;
    const lookMs = options.lookBackMs === undefined ? 200 : options.lookBackMs;

    const env = analyticEnvelope(bandpass(impulseResponse, lowHz, highHz, sampleRate));
    let loudest = 0;
    for (let i = 1; i < env.length; i += 1) if (env[i] > env[loudest]) loudest = i;

    const threshold = env[loudest] * Math.pow(10, thresholdDb / 20);
    const from = Math.max(0, loudest - Math.round(lookMs * sampleRate / 1000));
    let index = loudest;
    for (let i = from; i <= loudest; i += 1) {
      if (env[i] > threshold) { index = i; break; }
    }
    // Refine to the local envelope maximum of that arrival, within 1 ms.
    const refineEnd = Math.min(env.length, index + Math.round(sampleRate / 1000));
    let peak = index;
    for (let i = index; i < refineEnd; i += 1) if (env[i] > env[peak]) peak = i;

    const confidenceDb = 20 * Math.log10((env[peak] + 1e-30) / (env[loudest] + 1e-30));
    return {
      index: peak,
      loudestIndex: loudest,
      confidenceDb: Number(confidenceDb.toFixed(2)),
      reflectionDominant: confidenceDb < -3,
    };
  }

  // INVARIANT: extract the direct sound as a SHORT segment, not a full-length
  // array with a hole punched in it. Zero-padding a 5 ms window out to the
  // length of the whole capture and then analysing the first 64k samples
  // analyses silence, and returns a confident, flat, entirely fictitious
  // frequency response.
  //
  // Applied BEFORE any whitening: PHAT weighting flattens the spectrum, and
  // that amplifies the reverb tail along with everything else, so whitening an
  // ungated impulse response makes the room louder relative to the direct
  // sound rather than quieter. 4 ms is about 1.4 m of extra path length.
  function directWindow(impulseResponse, index, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const preMs = options.preMs === undefined ? 1 : options.preMs;
    const postMs = options.postMs === undefined ? 4 : options.postMs;
    const start = Math.max(0, index - Math.round(preMs * sampleRate / 1000));
    const end = Math.min(impulseResponse.length, index + Math.round(postMs * sampleRate / 1000));
    const length = Math.max(1, end - start);
    const segment = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / Math.max(1, length - 1)));
      segment[i] = impulseResponse[start + i] * w;
    }
    return { segment, start, end };
  }

  // Polarity from the sign of the direct arrival. Exact and free from the
  // measurement, so the listener should never be asked to guess it. Inverted
  // polarity between two members is a common cause of "sounds thin and I
  // cannot fix it", and it is nearly impossible to hear directly because the
  // cue is a bass suckout rather than an obvious defect.
  function polarityFromArrival(impulseResponse, index, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const half = Math.max(4, Math.round(sampleRate / 2000));
    const from = Math.max(0, index - half);
    const to = Math.min(impulseResponse.length, index + half);
    let extreme = 0;
    for (let i = from; i < to; i += 1) {
      if (Math.abs(impulseResponse[i]) > Math.abs(extreme)) extreme = impulseResponse[i];
    }
    return extreme < 0 ? -1 : 1;
  }

  // ------------------------------------------------- frequency response

  function magnitudeSpectrum(signal, fftSize, sampleRate = DEFAULT_SAMPLE_RATE) {
    const n = fftSize || nextPowerOfTwo(Math.max(1024, signal.length * 2));
    const re = padded(signal, n);
    const im = new Float64Array(n);
    fft(re, im, false);
    const bins = n / 2 + 1;
    const frequencies = new Float64Array(bins);
    const magnitude = new Float64Array(bins);
    for (let k = 0; k < bins; k += 1) {
      frequencies[k] = k * sampleRate / n;
      magnitude[k] = Math.hypot(re[k], im[k]);
    }
    return { frequencies, magnitude };
  }

  // Energy-average over 1/frac-octave bands. Unsmoothed response is dominated
  // by comb filtering that changes if the listener moves 10 cm; correcting
  // that is worse than not correcting at all.
  function fractionalOctaveSmooth(frequencies, magnitude, frac = 6) {
    const n = magnitude.length;
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + magnitude[i] * magnitude[i];
    const ratio = Math.pow(2, 1 / (2 * frac));
    const binWidth = frequencies.length > 1 ? frequencies[1] - frequencies[0] : 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const fc = frequencies[i];
      if (!(fc > 0) || binWidth <= 0) { out[i] = magnitude[i]; continue; }
      const lo = clamp(Math.floor(fc / ratio / binWidth), 0, n - 1);
      const hi = clamp(Math.ceil(fc * ratio / binWidth), lo + 1, n);
      out[i] = Math.sqrt((prefix[hi] - prefix[lo]) / (hi - lo));
    }
    return out;
  }

  // Short gate above splitHz, long window below it, level-matched and
  // crossfaded. The tradeoff is unavoidable rather than a shortcut: a 5 ms
  // gate is reflection-free but cannot resolve below roughly 200 Hz, and a
  // window long enough to see 50 Hz necessarily contains the room. Below
  // splitHz the curve honestly describes speaker plus room at that one
  // microphone position, which is also what the listener hears from that seat.
  function hybridResponse(impulseResponse, index, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const splitHz = options.splitHz || 300;
    const fftSize = options.fftSize || 65536;

    const short = directWindow(impulseResponse, index, { sampleRate }).segment;
    const longStart = Math.max(0, index - Math.round(sampleRate / 1000));
    const longEnd = Math.min(impulseResponse.length, longStart + Math.round(0.3 * sampleRate));
    const longLength = Math.max(1, longEnd - longStart);
    const long = new Float64Array(longLength);
    const tail = Math.min(longLength, Math.round(0.05 * sampleRate));
    for (let i = 0; i < longLength; i += 1) {
      const fromEnd = longLength - 1 - i;
      const w = fromEnd < tail ? 0.5 * (1 + Math.cos(Math.PI * (tail - fromEnd) / tail)) : 1;
      long[i] = impulseResponse[longStart + i] * w;
    }

    const shortSpectrum = magnitudeSpectrum(short, fftSize, sampleRate);
    const longSpectrum = magnitudeSpectrum(long, fftSize, sampleRate);
    const frequencies = shortSpectrum.frequencies;
    const shortSmooth = fractionalOctaveSmooth(frequencies, shortSpectrum.magnitude);
    const longSmooth = fractionalOctaveSmooth(frequencies, longSpectrum.magnitude);

    const overlapShort = [];
    const overlapLong = [];
    for (let i = 0; i < frequencies.length; i += 1) {
      if (frequencies[i] >= splitHz && frequencies[i] <= splitHz * 3) {
        overlapShort.push(shortSmooth[i]);
        overlapLong.push(longSmooth[i]);
      }
    }
    const scale = overlapShort.length ? median(overlapLong) / Math.max(median(overlapShort), 1e-30) : 1;

    const magnitude = new Float64Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i += 1) {
      const w = clamp(Math.log2(Math.max(frequencies[i], 1e-9) / splitHz) / 0.5, 0, 1);
      magnitude[i] = longSmooth[i] * (1 - w) + shortSmooth[i] * scale * w;
    }
    return { frequencies, magnitude };
  }

  // The member's honest capability: where it is still within dropDb of its own
  // midband level. EQ outside this range spends amplifier power and driver
  // excursion on output that never arrives.
  function usableBand(frequencies, smoothedMagnitude, options = {}) {
    const dropDb = options.dropDb === undefined ? 10 : options.dropDb;
    const minHz = options.minHz || 25;
    const maxHz = options.maxHz || 20000;
    const reference = [];
    for (let i = 0; i < frequencies.length; i += 1) {
      if (frequencies[i] >= 300 && frequencies[i] <= 5000) {
        reference.push(20 * Math.log10(Math.max(smoothedMagnitude[i], 1e-12)));
      }
    }
    const ref = median(reference);
    let lowHz = null;
    let highHz = null;
    for (let i = 0; i < frequencies.length; i += 1) {
      const f = frequencies[i];
      if (f < minHz || f > maxHz) continue;
      const db = 20 * Math.log10(Math.max(smoothedMagnitude[i], 1e-12));
      if (db >= ref - dropDb) {
        if (lowHz === null) lowHz = f;
        highHz = f;
      }
    }
    return {
      lowHz: lowHz === null ? minHz : Number(lowHz.toFixed(1)),
      highHz: highHz === null ? maxHz : Number(highHz.toFixed(1)),
      referenceDb: Number(ref.toFixed(2)),
    };
  }

  // Band-restricted RMS. Broadband RMS is the wrong metric when one member has
  // bass and the other does not: it makes the small speaker look quiet, and the
  // matcher then drives it into distortion trying to catch up.
  function bandLevelDb(signal, lowHz, highHz, sampleRate = DEFAULT_SAMPLE_RATE) {
    const filtered = bandpass(signal, lowHz, highHz, sampleRate);
    let sum = 0;
    for (let i = 0; i < filtered.length; i += 1) sum += filtered[i] * filtered[i];
    return 20 * Math.log10(Math.sqrt(sum / Math.max(1, filtered.length)) + 1e-12);
  }

  // --------------------------------------------------------- delay (D2)

  function alignmentBand(bandA, bandB, guard = 1.3) {
    const lowHz = Math.max(bandA.lowHz, bandB.lowHz) * guard;
    const highHz = Math.min(bandA.highHz, bandB.highHz) / guard;
    if (!(highHz > lowHz * 1.2)) return null;
    return { lowHz, highHz };
  }

  // Sub-sample residual between two direct-sound segments that have each
  // already been cut at their own arrival. The coarse part of the answer is the
  // arrival index difference; this only returns the small leftover.
  //
  // PHAT weighting flattens magnitude so only phase alignment counts, which
  // makes it insensitive to the two members having very different levels and
  // tonal balance. Feeding it ungated, unaligned impulse responses turns a
  // 30 microsecond refinement into a multi-millisecond error, because the
  // correlator then has whole reflections to lock onto.
  function gccPhatRefineMs(segmentA, segmentB, lowHz, highHz, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const maxMs = options.maxMs === undefined ? 2 : options.maxMs;
    const n = nextPowerOfTwo(segmentA.length + segmentB.length);
    const aRe = padded(segmentA, n);
    const aIm = new Float64Array(n);
    const bRe = padded(segmentB, n);
    const bIm = new Float64Array(n);
    fft(aRe, aIm, false);
    fft(bRe, bIm, false);
    for (let k = 0; k < n; k += 1) {
      // cross spectrum A * conj(B)
      let re = aRe[k] * bRe[k] + aIm[k] * bIm[k];
      let im = aIm[k] * bRe[k] - aRe[k] * bIm[k];
      const mag = Math.hypot(re, im);
      const f = binFrequency(k, n, sampleRate);
      if (mag < 1e-12 || f < lowHz || f > highHz) { re = 0; im = 0; } else { re /= mag; im /= mag; }
      aRe[k] = re;
      aIm[k] = im;
    }
    fft(aRe, aIm, true);

    const limit = Math.max(1, Math.round(maxMs * sampleRate / 1000));
    let bestLag = 0;
    let bestValue = -Infinity;
    for (let lag = -limit; lag <= limit; lag += 1) {
      const value = aRe[(lag + n) % n];
      if (value > bestValue) { bestValue = value; bestLag = lag; }
    }
    const at = (lag) => aRe[(lag + n) % n];
    const y0 = at(bestLag - 1);
    const y1 = at(bestLag);
    const y2 = at(bestLag + 1);
    const denominator = y0 - 2 * y1 + y2;
    const fractional = Math.abs(denominator) > 1e-30 ? 0.5 * (y0 - y2) / denominator : 0;
    return (bestLag + clamp(fractional, -1, 1)) / sampleRate * 1000;
  }

  // ------------------------------------------------- per-member measurement

  // Everything Pixelody needs from one member, from one sweep capture.
  // impulseResponse must come from deconvolve() and must NOT have been
  // re-zeroed or trimmed: measurement.index is meaningful only on the shared
  // capture time base.
  function measureMember(impulseResponse, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const arrival = firstArrival(impulseResponse, {
      sampleRate,
      lowHz: options.arrivalLowHz || DEFAULT_ARRIVAL_BAND_HZ[0],
      highHz: options.arrivalHighHz || DEFAULT_ARRIVAL_BAND_HZ[1],
    });
    const polarity = polarityFromArrival(impulseResponse, arrival.index, { sampleRate });
    const corrected = new Float64Array(impulseResponse.length);
    for (let i = 0; i < impulseResponse.length; i += 1) corrected[i] = impulseResponse[i] * polarity;
    const { segment } = directWindow(corrected, arrival.index, { sampleRate });
    const response = hybridResponse(corrected, arrival.index, { sampleRate });
    const band = usableBand(response.frequencies, response.magnitude);
    return {
      version: VERSION,
      sampleRate,
      index: arrival.index,
      arrivalMs: Number((arrival.index / sampleRate * 1000).toFixed(4)),
      confidenceDb: arrival.confidenceDb,
      reflectionDominant: arrival.reflectionDominant,
      polarity,
      segment,
      frequencies: response.frequencies,
      magnitude: response.magnitude,
      band,
    };
  }

  // Relative delay of B with respect to A. Positive means B arrives later.
  //
  // Two stages, and the split matters. The coarse arrival difference is
  // sample-accurate and needs NO shared frequency band, so it still works for a
  // woofer paired with a tweeter. The refinement is sub-sample but requires
  // overlap, so it is skipped when there is none.
  function relativeDelayMs(measurementA, measurementB) {
    const sampleRate = measurementA.sampleRate || DEFAULT_SAMPLE_RATE;
    const coarseMs = (measurementB.index - measurementA.index) / sampleRate * 1000;
    const band = alignmentBand(measurementA.band, measurementB.band);
    if (!band) {
      return {
        coarseMs: Number(coarseMs.toFixed(4)),
        delayMs: Number(coarseMs.toFixed(4)),
        refinedMs: null,
        band: null,
        method: 'arrival-difference-only',
      };
    }
    const residualMs = gccPhatRefineMs(measurementB.segment, measurementA.segment, band.lowHz, band.highHz, { sampleRate });
    const delayMs = coarseMs + residualMs;
    return {
      coarseMs: Number(coarseMs.toFixed(4)),
      refinedMs: Number(residualMs.toFixed(4)),
      delayMs: Number(delayMs.toFixed(4)),
      band: { lowHz: Number(band.lowHz.toFixed(1)), highHz: Number(band.highHz.toFixed(1)) },
      method: 'arrival-difference-plus-gcc-phat',
    };
  }

  // --------------------------------------------- capability allocation (M2)

  // Do not try to make every member flat. A 2 inch driver has no 45 Hz to
  // flatten, and asking for it produces excursion and distortion rather than
  // bass, while also muddying whatever the capable member is doing. Give each
  // band to the member that can reproduce it and high-pass the ones that
  // cannot. No amount of delay or gain tuning reaches this result, which is a
  // large part of why tuning mismatched speakers by ear feels unwinnable.
  //
  // This is derived from each member's own roll-off, not from room modes, so
  // it stays valid from a single microphone position. It is not room EQ.
  function assignCrossovers(members, options = {}) {
    const overlapOctaves = options.overlapOctaves === undefined ? 0.5 : options.overlapOctaves;
    const list = Array.from(members || []);
    if (!list.length) return [];
    const anchor = list.reduce((best, member) => (member.band.lowHz < best.band.lowHz ? member : best), list[0]);
    return list.map((member) => {
      if (member.id === anchor.id) {
        return { id: member.id, highPassHz: null, lowPassHz: null, role: 'full-range', anchor: true };
      }
      const highPassHz = Math.max(member.band.lowHz * Math.pow(2, overlapOctaves), anchor.band.lowHz);
      return {
        id: member.id,
        highPassHz: Number(highPassHz.toFixed(1)),
        lowPassHz: null,
        role: 'band-limited',
        anchor: false,
      };
    });
  }

  // Constrained inversion toward flat, confined to the usable band.
  //
  // Cuts are cheap and always safe. Boosts are not, so the allowed boost tapers
  // to zero as the measured deficit approaches giveUpDb: a 3 dB dip is fully
  // corrected, an 8 dB dip partially, a 10 dB roll-off left alone. Without the
  // taper, the band edges - exactly where the driver is already struggling -
  // receive the maximum boost, which is the classic way an automatic EQ makes a
  // cheap speaker sound worse than it did untouched.
  function eqTargets(frequencies, smoothedMagnitude, band, options = {}) {
    const maxBoostDb = options.maxBoostDb === undefined ? 6 : options.maxBoostDb;
    const maxCutDb = options.maxCutDb === undefined ? 12 : options.maxCutDb;
    const giveUpDb = options.giveUpDb === undefined ? 10 : options.giveUpDb;
    const reference = [];
    for (let i = 0; i < frequencies.length; i += 1) {
      const f = frequencies[i];
      if (f >= Math.max(300, band.lowHz) && f <= Math.min(5000, band.highHz)) {
        reference.push(20 * Math.log10(Math.max(smoothedMagnitude[i], 1e-12)));
      }
    }
    const ref = median(reference);
    const correction = new Float64Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i += 1) {
      const f = frequencies[i];
      if (f < band.lowHz || f > band.highHz) { correction[i] = 0; continue; }
      const deficit = ref - 20 * Math.log10(Math.max(smoothedMagnitude[i], 1e-12));
      if (deficit > 0) {
        const cap = maxBoostDb * clamp(1 - deficit / giveUpDb, 0, 1);
        correction[i] = Math.min(deficit, cap);
      } else {
        correction[i] = Math.max(deficit, -maxCutDb);
      }
    }
    return { frequencies, correctionDb: correction, referenceDb: Number(ref.toFixed(2)) };
  }

  // ------------------------------------------------ parametric EQ fitting

  // Magnitude response of one RBJ peaking biquad, in dB, at the given
  // frequencies. This is the same cookbook Web Audio's BiquadFilterNode
  // 'peaking' type implements, so a curve fitted here is a curve the renderer
  // can actually realise rather than an abstraction of one.
  function peakingResponseDb(frequencies, frequencyHz, q, gainDb, sampleRate = DEFAULT_SAMPLE_RATE) {
    const out = new Float64Array(frequencies.length);
    if (!gainDb) return out;
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * frequencyHz / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.max(q, 1e-6));
    const b0 = 1 + alpha * A;
    const b1 = -2 * Math.cos(w0);
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha / A;
    for (let i = 0; i < frequencies.length; i += 1) {
      const w = 2 * Math.PI * frequencies[i] / sampleRate;
      const cos1 = Math.cos(-w);
      const sin1 = Math.sin(-w);
      const cos2 = Math.cos(-2 * w);
      const sin2 = Math.sin(-2 * w);
      const numRe = b0 + b1 * cos1 + b2 * cos2;
      const numIm = b1 * sin1 + b2 * sin2;
      const denRe = a0 + a1 * cos1 + a2 * cos2;
      const denIm = a1 * sin1 + a2 * sin2;
      const numMag = Math.hypot(numRe, numIm);
      const denMag = Math.hypot(denRe, denIm);
      out[i] = 20 * Math.log10(Math.max(numMag / Math.max(denMag, 1e-30), 1e-12));
    }
    return out;
  }

  // Greedily approximate a correction curve with a small bank of peaking
  // filters, emitted in the renderer's parametric band shape.
  //
  // Fitting to a realisable filter bank rather than shipping a raw curve
  // matters: five bells cannot reproduce an arbitrary curve, and pretending
  // otherwise means the applied result silently differs from the measured
  // intent. Whatever the bank cannot reach is left uncorrected, which is the
  // honest outcome.
  function fitParametricBands(frequencies, correctionDb, options = {}) {
    const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    const count = options.count || 5;
    const gainLimitDb = options.gainLimitDb === undefined ? 12 : options.gainLimitDb;
    const qChoices = options.qChoices || [0.7, 1, 1.4, 2, 3, 4.5];
    const defaults = options.defaultFrequencies || [60, 250, 1000, 4000, 12000];
    const minHz = options.minHz || 20;
    const maxHz = options.maxHz || 20000;

    const residual = Float64Array.from(correctionDb);
    const usable = [];
    for (let i = 0; i < frequencies.length; i += 1) {
      if (frequencies[i] >= minHz && frequencies[i] <= maxHz && correctionDb[i] !== 0) usable.push(i);
    }

    const chosen = [];
    for (let band = 0; band < count && usable.length; band += 1) {
      let worst = usable[0];
      for (let k = 0; k < usable.length; k += 1) {
        if (Math.abs(residual[usable[k]]) > Math.abs(residual[worst])) worst = usable[k];
      }
      if (Math.abs(residual[worst]) < 0.25) break;

      const frequencyHz = clamp(frequencies[worst], minHz, maxHz);
      const gain = clamp(residual[worst], -gainLimitDb, gainLimitDb);
      let bestQ = qChoices[0];
      let bestScore = Infinity;
      let bestShape = null;
      for (let c = 0; c < qChoices.length; c += 1) {
        const shape = peakingResponseDb(frequencies, frequencyHz, qChoices[c], gain, sampleRate);
        let score = 0;
        for (let k = 0; k < usable.length; k += 1) {
          const i = usable[k];
          const after = residual[i] - shape[i];
          score += after * after;
        }
        if (score < bestScore) { bestScore = score; bestQ = qChoices[c]; bestShape = shape; }
      }
      if (!bestShape) break;
      for (let k = 0; k < usable.length; k += 1) {
        const i = usable[k];
        residual[i] -= bestShape[i];
      }
      chosen.push({ frequency: Number(frequencyHz.toFixed(1)), q: bestQ, gain: Number(gain.toFixed(2)) });
    }

    chosen.sort((a, b) => a.frequency - b.frequency);
    const bands = [];
    for (let i = 0; i < count; i += 1) {
      if (i < chosen.length) {
        bands.push({ id: `p${i + 1}`, enabled: true, frequency: chosen[i].frequency, q: chosen[i].q, gain: chosen[i].gain });
      } else {
        bands.push({ id: `p${i + 1}`, enabled: false, frequency: defaults[i] || 1000, q: 1, gain: 0 });
      }
    }

    let worstResidual = 0;
    for (let k = 0; k < usable.length; k += 1) worstResidual = Math.max(worstResidual, Math.abs(residual[usable[k]]));
    return { bands, worstResidualDb: Number(worstResidual.toFixed(2)) };
  }

  // ------------------------------------------------------- rig planning

  function levelMatchBand(bandA, bandB) {
    const shared = alignmentBand(bandA, bandB, 1.3);
    if (!shared) return { lowHz: 500, highHz: 4000, source: 'fallback-midband' };
    return {
      lowHz: Number(Math.max(shared.lowHz, 100).toFixed(1)),
      highHz: Number(Math.min(shared.highHz, 8000).toFixed(1)),
      source: 'measured-overlap',
    };
  }

  // Turn per-member measurements into a complete, directly applicable plan.
  //
  // Two guardrails are enforced here rather than left to the caller, because
  // both are easy to violate by accident and neither is visible once applied:
  //
  //   - Delay is POSITIVE ONLY. Everything is delayed to meet the latest
  //     member; nothing is ever advanced, because you cannot advance a signal.
  //   - Gain is ATTENUATION ONLY. Everything is trimmed down to the quietest
  //     member. Never boost a quieter member to catch up with a louder one.
  function planRig(members, options = {}) {
    const list = Array.from(members || []);
    if (list.length < 1) return { members: [], summary: [], anchorId: null };

    const sampleRate = (list[0].measurement && list[0].measurement.sampleRate) || DEFAULT_SAMPLE_RATE;
    const maxDelayMs = options.maxDelayMs === undefined ? 250 : options.maxDelayMs;
    const minGainDb = options.minGainDb === undefined ? -24 : options.minGainDb;

    // Latest arrival becomes the timing anchor: everyone else waits for it.
    const latest = list.reduce((slowest, member) => (
      member.measurement.index > slowest.measurement.index ? member : slowest), list[0]);

    // Levels are compared inside a band every pair can actually reproduce.
    const reference = list[0];
    const levels = list.map((member) => {
      const band = levelMatchBand(reference.measurement.band, member.measurement.band);
      return {
        id: member.id,
        band,
        levelDb: bandLevelDb(member.measurement.segment, band.lowHz, band.highHz, sampleRate),
      };
    });
    const quietestDb = levels.reduce((lowest, entry) => Math.min(lowest, entry.levelDb), Infinity);

    const crossovers = assignCrossovers(list.map((member) => ({ id: member.id, band: member.measurement.band })),
      { overlapOctaves: options.overlapOctaves });

    const planned = list.map((member) => {
      const measurement = member.measurement;
      const crossover = crossovers.find((entry) => entry.id === member.id) || { highPassHz: null, anchor: false };
      const level = levels.find((entry) => entry.id === member.id);

      const delayMs = clamp((latest.measurement.index - measurement.index) / sampleRate * 1000, 0, maxDelayMs);
      const trimDb = clamp(quietestDb - level.levelDb, minGainDb, 0);

      const eq = eqTargets(measurement.frequencies, measurement.magnitude, measurement.band, options.eq);
      const fitted = fitParametricBands(eq.frequencies, eq.correctionDb, {
        sampleRate,
        count: options.parametricBandCount || 5,
        gainLimitDb: options.eqGainLimitDb === undefined ? 12 : options.eqGainLimitDb,
        defaultFrequencies: options.parametricDefaultFrequencies,
      });

      return {
        id: member.id,
        label: member.label || member.id,
        delayMs: Number(delayMs.toFixed(3)),
        gainDb: Number(trimDb.toFixed(2)),
        polarity: measurement.polarity < 0 ? 'inverted' : 'normal',
        highPassHz: crossover.highPassHz,
        role: crossover.anchor ? 'full-range' : 'band-limited',
        timingAnchor: member.id === latest.id,
        band: measurement.band,
        levelMatchBand: level.band,
        measuredLevelDb: Number(level.levelDb.toFixed(2)),
        placementConfidenceDb: measurement.confidenceDb,
        parametric: fitted.bands,
        eqResidualDb: fitted.worstResidualDb,
      };
    });

    return {
      version: VERSION,
      anchorId: latest.id,
      members: planned,
      summary: describeRigPlan(planned),
      guardrails: {
        delayPositiveOnly: planned.every((member) => member.delayMs >= 0),
        attenuationOnly: planned.every((member) => member.gainDb <= 0),
      },
    };
  }

  // Plain language, because "adjust these seven parameters until it sounds
  // right" is not a thing a listener can act on, and "your small speaker will
  // handle the mids and highs" is.
  function describeRigPlan(planned) {
    const lines = [];
    planned.forEach((member) => {
      const parts = [];
      if (member.timingAnchor) parts.push('is the slowest, so everything else waits for it');
      else if (member.delayMs >= 0.05) parts.push(`arrives ${member.delayMs.toFixed(1)} ms early, so it will be held back`);
      if (member.polarity === 'inverted') parts.push('is wired out of phase and will be flipped');
      if (member.gainDb <= -0.2) parts.push(`is ${Math.abs(member.gainDb).toFixed(1)} dB louder, so it will be turned down`);
      if (member.highPassHz) parts.push(`rolls off below ${Math.round(member.band.lowHz)} Hz, so bass will go elsewhere`);
      else if (member.role === 'full-range') parts.push('reaches lowest, so it will carry the bass');
      if (member.placementConfidenceDb < -3) parts.push('measured against a strong reflection, so move the microphone and re-run');
      lines.push(`${member.label} ${parts.length ? parts.join('; ') : 'needs no changes'}.`);
    });
    return lines;
  }

  return Object.freeze({
    VERSION,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_ARRIVAL_BAND_HZ,
    nextPowerOfTwo,
    median,
    fft,
    convolve,
    makeSweep,
    deconvolve,
    bandpass,
    analyticEnvelope,
    firstArrival,
    directWindow,
    polarityFromArrival,
    magnitudeSpectrum,
    fractionalOctaveSmooth,
    hybridResponse,
    usableBand,
    bandLevelDb,
    alignmentBand,
    gccPhatRefineMs,
    measureMember,
    relativeDelayMs,
    assignCrossovers,
    eqTargets,
    peakingResponseDb,
    fitParametricBands,
    levelMatchBand,
    planRig,
    describeRigPlan,
  });
}));
