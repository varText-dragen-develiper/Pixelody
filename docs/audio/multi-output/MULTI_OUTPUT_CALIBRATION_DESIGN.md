# Calibrating a speaker rig

I want two independent speaker systems to sound coherent at the place someone listens. That means matching level, aligning arrival time and checking bass integration separately. One delay value can't establish all three, and a preferred listening result can differ from a measurement.

This is the design proposal behind the [calibration work](MULTI_OUTPUT_CALIBRATION_ROADMAP.md). That roadmap records the later implementation and the physical checks still needed.

## The listening workflow

Offer `Guided by ear` as the microphone-free default and `Measure with microphone` as a starting suggestion followed by listening. Both begin with the seat and physical setup. Keep volume, bass, crossover, phase and DSP knobs in repeatable positions; record them because the app can't move them. Start quietly and identify each route with its own signal. Missing, duplicate, fallback and unconfirmed routes block the test.

Match level before judging time. Alternate band-limited pink noise, initially 500 Hz–4 kHz, so excess bass doesn't dominate. By ear, compare A/B with randomized order, use 1 dB steps then 0.5 dB near a match, and attenuate the louder member. A microphone can compare relative levels with stable processing; repeat A-B-B-A and use the median. Never automatically boost the quieter speaker. [ITU-R BS.1116-3](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1116-3-201502-I%21%21PDF-E.pdf) provides the listening-room reference.

For timing by ear, compare blinded delay candidates using short pulses, then centered voice or percussion. Begin around 5 ms, narrow to 1 ms and 0.25–0.5 ms where supported. Include no-difference and both-wrong answers. Keep changes provisional until the listener confirms them. Delay the faster member rather than applying negative delay.

A bass/subwoofer setup needs its own check around the crossover, initially 50–120 Hz with adjustable bounds. Compare polarity and a small timing range while listening to the combined output. Record physical controls and avoid turning a single-seat result into a room-EQ curve. Verify with voice, transients and bass, and send a leading/louder/hollow/boomy result back to the relevant adjustment.

Save the receipt against the rig and seat, then observe stability for 60 seconds. Report aligned/stable, occasional correction, possible drift or recalibration. A later quick check is useful after reconnects, format/driver/DSP changes or moved knobs. The implemented quick re-check is recorded in the roadmap.

## Microphone measurements

The proposal calls for bounded AudioWorklet samples, a deterministic windowed test sequence and sample-level analysis through the exact member music graph/sink. Pause music, isolate the member, temporarily bypass intentional delay, then restore state. Record peak/sidelobe ambiguity, clipping, SNR, repeatability and route proof. A-B-B-A trials over at least two cycles help expose ordering bias; remeasure after applying a candidate to check residual error. The later implementation uses sweep deconvolution and first-arrival detection, described in the roadmap.

Request echo cancellation, noise suppression and AGC off and inspect the reported settings. Unknown or still-enabled processing lowers confidence and needs listening confirmation. [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) explains why requested constraints aren't guaranteed. [ITU-T P.341](https://www.itu.int/epublications/publication/itu-t-p-341-2011-03-transmission-characteristics-for-wideband-digital-loudspeaking-and-hands-free-telephony-terminals) and [Web Audio](https://www.w3.org/TR/webaudio-1.1/) are the timing references.

The proposed high-confidence band requires four usable trials/member, ≤0.5 ms spread, unambiguous correlation and confirmed processing off. Medium uses three trials and ≤2 ms spread; wider/ambiguous/wireless/unknown-processing results are low. Missing returns, clipping, mismatched routes or inconsistent order fail. Those bands still need hardware validation. There is no universal audibility threshold; [the cited precedence study](https://pubmed.ncbi.nlm.nih.gov/23903865/) concerns particular stimuli and conditions.

## Delay and clock drift

Static delay aligns arrival at the seat. It can't keep independent DAC clocks together indefinitely. Browser correction remains gentle rate adjustment with seek only for larger drift, suppressed during measurement bursts. Observe afterward and leave saved delay untouched.

A native path would model endpoint frames against QPC, select a leader and resample followers within validated bounds, reporting ppm, fill and underruns. See [IAudioClock::GetPosition](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclock-getposition). [IAudioClockAdjustment](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclockadjustment-setsamplerate) isn't universally available. Runtime correction belongs in transient diagnostics, separate from acoustic calibration.

## Receipt format

```json
{
  "version": 2,
  "listeningPosition": { "id": "seat-...", "name": "Desk chair" },
  "physicalSetup": {
    "memberNotes": {
      "member-id": {
        "volumeKnob": "12 o'clock",
        "bassKnob": "center detent",
        "crossoverHz": 80,
        "phaseSwitch": "0°",
        "dspMode": "Direct"
      }
    }
  },
  "level": {
    "method": "mic-relative-pink|ear-staircase",
    "measurementBandHz": [500, 4000],
    "relativeDb": 0,
    "appliedTrimDb": 0,
    "trialsDb": [],
    "confidence": "high|medium|low|failed"
  },
  "timing": {
    "method": "mic-cross-correlation|ear-blind-ab",
    "measurementBandHz": [300, 6000],
    "relativeArrivalMs": 0,
    "suggestedDelayMs": 0,
    "appliedDelayMs": 0,
    "residualMs": 0,
    "trialArrivalsMs": [],
    "spreadMs": 0,
    "confidence": "high|medium|low|failed"
  },
  "bassIntegration": {
    "performed": false,
    "bandHz": [50, 120],
    "polarity": "normal",
    "fineDelayMs": 0,
    "confidence": "not-run"
  },
  "verification": {
    "listenerAccepted": false,
    "answers": [],
    "stabilitySeconds": 60,
    "correctionCount": 0,
    "result": "not-started|aligned-stable|aligned-correcting|may-drift|recalibration-required",
    "completedAt": "ISO timestamp",
    "quickCheckAt": "ISO timestamp",
    "quickCheckResult": "not-started|aligned-stable|aligned-correcting|may-drift|recalibration-required",
    "quickCheckCorrectionCount": 0
  },
  "workflow": {
    "method": "guided-by-ear|measure-with-microphone",
    "selectedAt": "ISO timestamp",
    "preparationCompletedAt": "ISO timestamp",
    "routeCheck": {
      "status": "not-started|in-progress|passed|blocked|cancelled",
      "confirmedMemberIds": [],
      "routes": []
    },
    "levelMatch": {
      "status": "not-started|accepted|cancelled|blocked",
      "trials": [],
      "initialGainDb": {},
      "appliedGainDb": {}
    },
    "arrivalMatch": {
      "status": "not-started|accepted|cancelled|blocked",
      "anchorMemberId": "member-id",
      "targetMemberId": "member-id",
      "trials": [],
      "initialDelayMs": 0,
      "appliedDelayMs": 0,
      "finalStepMs": 0.5
    },
    "bassIntegration": {
      "status": "not-started|accepted|cancelled|blocked",
      "anchorMemberId": "member-id",
      "targetMemberId": "member-id",
      "bandHz": [50, 120],
      "polarityTrials": [],
      "delayTrials": [],
      "initialPolarity": "normal",
      "appliedPolarity": "normal",
      "initialDelayMs": 0,
      "appliedDelayMs": 0
    },
    "verification": {
      "status": "not-started|observing|accepted|attention|cancelled|blocked",
      "mode": "full|quick",
      "memberIds": [],
      "answers": [],
      "observedSeconds": 60,
      "correctionCount": 0,
      "routeStability": "stable|correcting|unstable|unsupported|idle",
      "result": "not-started|aligned-stable|aligned-correcting|may-drift|recalibration-required"
    }
  },
  "environment": {
    "microphoneId": "sanitized-id",
    "microphoneLabel": "selected mic",
    "inputProcessing": {
      "echoCancellation": false,
      "noiseSuppression": false,
      "autoGainControl": false
    },
    "sampleRate": 48000,
    "endpointRouteKeys": []
  },
  "createdAt": "ISO timestamp",
  "invalidatedAt": ""
}
```

Keep operational `gainDb`, `delayMs` and `polarity` on the member. This receipt explains those values, rather than becoming another control store.

## Completing a calibration safely

Capture recovery state once before a stage changes playback, routing, mute/solo, EQ, delay or volume. Cancel/error restores that snapshot and disposes temporary media. A requested track/output change aborts calibration first, restores its changes, then proceeds. Only acceptance keeps the intended result.

Consumer labeling still needs physical evidence: confirmed unique signals, attenuation-only matching, honest disagreement between trials, residual remeasurement, thirty-minute wired stability, separate wireless reconnect/drift checks and a full-range-plus-subwoofer setup. Keep advanced measurements available without requiring the listener to understand DSP. Don't claim absolute SPL from an uncalibrated mic, full-room correction, automatic hardware controls or sample-locked browser outputs.
