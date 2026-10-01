# Multi-output speaker calibration design

Status: research complete / no implementation claimed

## Product goal

Give a normal listener a safe, understandable way to make two independently powered speaker systems sound like one system at a chosen listening position, even when the systems use separate DACs and have unrelated physical volume, bass, crossover, or DSP controls.

The product promise should be perceptual rather than laboratory-grade:

> Pixelody helps both speaker systems arrive together, play at a comparable level, and blend cleanly at your seat. If the measured result and the listener's preferred result differ, the listener gets the final vote.

Do not call the result “perfect synchronization.” Two independent DACs have independent clocks and can change latency or drift after reconnects, format changes, driver changes, or wireless buffering.

## The problem is three problems

1. **Arrival alignment** — DAC, driver, DSP, buffering, amplifier, speaker distance, and acoustic travel determine when each system reaches the listening position.
2. **Level matching** — unequal acoustic level can pull attention and apparent location toward the louder system, making a timing problem seem better or worse than it is.
3. **Bass/crossover integration** — a subwoofer or bass-heavy second system has frequency-dependent phase and group delay. A single broadband delay number cannot guarantee good summation around the crossover region.

Pixelody should measure and present these separately. “Timing aligned” must not imply “level matched” or “bass integrated.”

## What Pixelody already has

- Per-member `gainDb`, positive `delayMs`, mute, solo, polarity, EQ, and spatial profiles.
- Member isolation during calibration.
- Software-path and microphone acoustic reports stored per member.
- Positive-delay suggestions that align faster members to the slowest measured member.
- By-ear delay nudges of 5 ms and 0.5 ms.
- Browser-prototype drift monitoring, rate nudges, seek correction, and route diagnostics.
- Generated microphone chirps and a confidence model based on detections, spread, and signal-to-noise ratio.

These are the right primitives, but the current microphone measurement is not precise enough for speaker alignment:

- The microphone capture foundation now uses an `AudioWorklet` ring buffer and returns raw, bounded waveform samples with audio-render-timeline frame metadata. It still needs deterministic correlation and repeatability analysis before it can claim precision alignment.
- It finds the first envelope block above a threshold instead of correlating the captured waveform with the emitted test sequence.
- The generated chirp uses a short-lived calibration output route. Project architecture explicitly warns that a test-tone route does not prove the music graph.
- Sequential absolute measurements do not explicitly cancel clock drift or ordering bias.
- There is no guided relative-level match, hardware-knob contract, or crossover-specific step.

## Recommended user experience

Add one primary action to the grouped-rig panel: **Calibrate rig**.

Offer two paths:

- **Guided by ear** — no microphone required; recommended default and always available.
- **Measure with microphone** — faster initial suggestion, followed by the same listening confirmation.

Both paths use the same six-stage wizard.

### 1. Prepare

Explain the physical setup in plain language:

- Put the microphone or your head at the listening position.
- Make the room reasonably quiet.
- Set every physical volume, bass, crossover, loudness, and DSP control to a repeatable position. Mark or photograph the knob positions outside Pixelody if useful.
- Do not change physical controls after calibration without rerunning at least the quick check.
- Start quietly. Pixelody will never increase a member above its safe baseline merely to match a louder system.

Let the user name the seat, for example `Desk chair` or `Couch center`. Calibration is position-specific.

Run a route-identification check: announce and play a quiet signal through A, then B. The user confirms the labels match the physical systems. Stop on duplicate, missing, or fallback routes.

### 2. Match level

Level must be matched before timing judgment.

#### Microphone path

1. Alternate band-limited pink noise through A and B at the listening position.
2. First measure a midband such as 500 Hz–4 kHz so a subwoofer or large bass difference cannot dominate the result.
3. Optionally measure broadband and low-band values separately.
4. Calculate a relative level difference; an uncalibrated microphone is acceptable for relative matching if its processing remains stable between the alternating measurements.
5. Attenuate the louder member to the quieter member. Never boost the quieter member automatically.
6. Repeat in `A-B-B-A` order and use the median difference to reduce drift and ordering bias.

Request `echoCancellation: false`, `noiseSuppression: false`, and `autoGainControl: false`, then inspect `MediaStreamTrack.getSettings()`. If processing remains enabled or is not reportable, mark the result low-confidence and require the listening check. These controls are constrainable but user agents and devices still determine their actual settings under the [Media Capture and Streams specification](https://www.w3.org/TR/mediacapture-streams/).

#### By-ear path

Alternate equal-duration pink-noise bursts with short crossfades. Ask only:

- `A sounds louder`
- `B sounds louder`
- `They sound equal`

Use an adaptive staircase: 1 dB steps, then 0.5 dB near the match. Randomize whether A or B plays first on some trials so the choice is not trained to a fixed order. Apply only attenuation and show the resulting trim in dB.

Do not use music for the initial match. Music changes continuously and makes small level comparisons unreliable. ITU listening-room guidance aligns loudspeakers with pink noise at the reference listening point; see [ITU-R BS.1116-3](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1116-3-201502-I%21%21PDF-E.pdf).

### 3. Align arrival time

#### Microphone path

Replace block-envelope detection with sample-level correlation:

1. Use an `AudioWorklet` capture ring buffer, not `ScriptProcessorNode`.
2. Emit a deterministic, windowed broadband sequence such as a logarithmic sweep, MLS-like sequence, or coded chirp.
3. Route the stimulus through the same per-member graph and sink used by music. Pause music, isolate one member, bypass the user's intentional delay for measurement, and preserve/restore all state afterward.
4. Cross-correlate the recorded waveform with the known emitted sequence. Store the correlation peak, peak-to-sidelobe ratio, and ambiguity flags—not just threshold crossing.
5. Measure `A-B-B-A` for at least two cycles. Use median relative arrival and median absolute deviation/spread.
6. Delay the faster member by `slowest arrival - member arrival`. Continue using positive delay only.
7. Remeasure after applying delay and store the residual error.

Cross-correlation is an established way to calculate acoustic delay from a known signal and recorded return; for an example in an international recommendation, see [ITU-T P.341](https://www.itu.int/epublications/publication/itu-t-p-341-2011-03-transmission-characteristics-for-wideband-digital-loudspeaking-and-hands-free-telephony-terminals). Web Audio's timing values remain estimates and may change with the output device, so they are useful supporting evidence but not a replacement for the acoustic result; see [Web Audio API 1.1](https://www.w3.org/TR/webaudio-1.1/).

Suggested confidence bands for the relative result, subject to physical validation:

- **High:** at least four usable trials per member, residual spread at or below 0.5 ms, strong unambiguous correlation, input processing confirmed off.
- **Medium:** at least three usable trials, spread at or below 2 ms, correlation usable but room reflections or input processing add uncertainty.
- **Low:** spread above 2 ms, ambiguous peaks, wireless endpoint, or microphone processing unknown.
- **Failed:** missing return, clipping, route mismatch, or inconsistent trial ordering.

Do not advertise a universal audibility threshold. Lead-lag perception depends on signal, direction, level, room, and listener. Research demonstrates a several-millisecond precedence window for some stimuli, rather than one fixed threshold; see this [human psychoacoustic study](https://pubmed.ncbi.nlm.nih.gov/23903865/). Pixelody's goal is repeatability plus listener acceptance.

#### By-ear path

After level matching, play correlated mono material through both systems:

- short broadband clicks/noise bursts for coarse alignment;
- a centered mono voice or percussion loop for fine alignment;
- optional bass bursts near the crossover range for a subwoofer system.

Use a blinded two-choice adjustment:

1. Pixelody presents two delay settings as `Option 1` and `Option 2` without showing which is larger.
2. Ask which sounds tighter, more centered, or less echo-like.
3. Bracket at 5 ms, refine at 1 ms, then 0.25–0.5 ms where the route supports it.
4. Include `No difference` and `Both sound wrong`.
5. Finish when the listener chooses `No difference` twice or explicitly prefers the current result.

The wizard should say: `Your ears are the final check. The measured value is a starting point.`

### 4. Integrate bass, when applicable

Ask whether either member is a subwoofer or has a separate bass/crossover control. If no, skip this stage.

For a subwoofer/bass system:

- Store physical knob notes: gain position, crossover frequency, phase switch, and DSP mode.
- Measure or audition the crossover band separately, initially 50–120 Hz with user-adjustable bounds.
- Compare normal and inverted polarity without silently changing the saved value.
- Evaluate the combined A+B level around the crossover, not merely each system alone. Prefer the setting with smoother/stronger coherent summation that does not create a narrow boom.
- Offer a small timing sweep around the broadband suggestion because low-frequency group delay can differ from the full-range impulse peak.
- Never generate a room-EQ curve from one microphone point in this first implementation.

Hardware bass knobs cannot be inferred or controlled digitally. Pixelody should acknowledge this directly and store the user's repeatable physical setting as part of the calibration receipt.

### 5. Verify with music

Offer three short checks:

- centered mono voice;
- transient/percussion material;
- bass-containing material when bass integration was run.

Controls:

- `Sounds centered`
- `One side leads`
- `One side is louder`
- `Bass is hollow`
- `Bass is boomy`
- `I cannot hear a difference`

Map these answers to the relevant stage instead of exposing a wall of DSP controls. Preserve an Advanced link for direct trim, delay, polarity, and band-specific inspection.

### 6. Save and monitor

Save a calibration receipt against the rig and listening position. Run a 60-second stability observation immediately. Show one of:

- `Aligned and stable`
- `Aligned; occasional correction`
- `Alignment may drift`
- `Recalibration required`

Offer a lightweight **Quick check** on later launches: alternating level bursts plus a short timing sequence. Recommend it after a device reconnect, Windows output-format change, driver/DSP change, physical-knob change, or Bluetooth reconnection.

## Independent-DAC clock strategy

Static acoustic delay fixes start alignment; it cannot stop two hardware clocks from drifting.

### Browser prototype

- Keep the primary media element as the authority.
- Keep the existing gentle playback-rate correction for medium drift and seek correction only for large drift.
- Suppress correction during the measurement burst itself.
- After calibration, observe at least 60 seconds before calling the route stable.
- If corrections are frequent, show `Alignment may drift` and keep the saved static calibration separate from transient runtime corrections.
- Never rewrite the user's saved `delayMs` from live drift corrections.

### Native mixer target

A release-quality native path should open both WASAPI render endpoints, correlate each endpoint's device position with QueryPerformanceCounter, estimate clock offset and rate, and continuously resample the follower stream. Microsoft's `IAudioClock::GetPosition` returns both stream/device position and its correlated performance-counter time, which is the right basis for this mapping: [Microsoft IAudioClock documentation](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclock-getposition).

The native path should:

- maintain an affine clock model per endpoint (`device frames = rate * QPC time + offset`);
- choose one endpoint as clock leader;
- use a bounded asynchronous sample-rate converter for the follower;
- avoid audible seek corrections during steady playback;
- expose ppm drift, buffer fill, underruns, and correction rate;
- keep the saved acoustic offset independent of live clock-discipline state.

`IAudioClockAdjustment::SetSampleRate` is available only for suitable shared-mode streams and should not be assumed universally; see [Microsoft's API contract](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclockadjustment-setsamplerate).

## Proposed persisted model

Add a versioned calibration object without replacing existing member fields:

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

Continue storing operational `gainDb`, `delayMs`, and `polarity` on each member. The calibration receipt explains why those values were chosen; it is not a second control store.

## Implementation phases

### Phase A — consumer workflow using existing primitives

- Add `Calibrate rig` and the six-stage wizard.
- Implement route identification, hardware-knob notes, by-ear level staircase, blinded delay comparison, optional bass workflow, music verification, and quick check.
- Reuse existing member isolation, trim, delay, polarity, persistence, and diagnostics.
- This phase produces real user value without claiming microphone precision.

### Phase B — precision microphone measurement

- The `AudioWorklet` sample-capture ring buffer is implemented; retain it as the raw-capture source for the remaining microphone stages.
- Add deterministic test sequences and offline cross-correlation.
- Send the sequence through the exact per-member music graph/sink path.
- Add A-B-B-A trials, repeatability statistics, residual verification, clipping checks, and actual microphone-setting capture.
- Keep all automatically applied gain changes attenuation-only.

### Phase C — clock-disciplined native output

- Extend the optional native mixer around WASAPI endpoint clocks and bounded asynchronous resampling.
- Merge native clock diagnostics into the existing sanitized grouped-rig report.
- Preserve browser calibration receipts and controls; do not create a parallel native configuration model.

The implementation keeps this distinction explicit: saved `member.delayMs` represents intentional acoustic alignment at the listening position, while native `runtimeClock` ppm/ratio/buffer-fill values are transient follower-engine correction. A clock observation cannot update the rig, its calibration receipt, or a listener-confirmed value. Native status is reduced once and merged into the grouped snapshot, calibration report, and J.A.M. audio-profile diagnostics with `privacy.pathHidden: true`.

## Acceptance criteria

The feature is ready for consumer labeling only when physical tests show:

- The wizard never sends a test signal to an unconfirmed or duplicate route.
- Cancel or failure restores playback, routing, mute/solo, EQ, delay, and volume state.
- Capture that state once when a calibration stage starts, rather than rebuilding it from current controls at cancellation. A track or output-route change must abort temporary calibration media, restore the captured member/profile state, then proceed with the requested change. Accepted results are the only path that releases this snapshot without rolling back intentional changes.
- Automatic level matching only attenuates and leaves adequate limiter headroom.
- Repeated microphone trials are reported honestly when they disagree.
- A track change does not invalidate or destroy grouped routing.
- Applied timing is verified by a second measurement, not assumed from the first estimate.
- The user can complete the entire workflow without understanding milliseconds, decibels, phase, or DAC clocks.
- Advanced users can inspect the measurements, trials, confidence, applied trim/delay, polarity, route identities, and drift history.
- Wired+wired rigs remain acceptably aligned for 30 minutes under the existing physical validation matrix.
- Wireless routes are labeled degraded unless they pass a separate reconnect and long-run drift matrix.
- At least one test setup includes a full-range system plus a separately controlled subwoofer/bass system.

## Explicit non-goals for the first implementation

- Absolute SPL certification from an uncalibrated consumer microphone.
- Full-room correction from one microphone position.
- Automatically moving physical volume, bass, crossover, phase, or DSP controls.
- Claiming sample-locked synchronization from two independent browser output paths.
- Hiding a low-confidence result behind a single green checkmark.

## Recommended first implementation task

Start with Phase A. It matches the product philosophy—good enough to the listener is the finish line—while establishing the state machine, copy, receipts, safety restoration, and physical-control acknowledgement needed by every later measurement method. Then implement Phase B behind the same wizard rather than exposing the existing mic-chirp controls as the final consumer experience.
