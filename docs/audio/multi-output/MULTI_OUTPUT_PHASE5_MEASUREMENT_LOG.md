# Multi-Output Phase 5 Measurement Log

This log is for deciding whether Pixelody's experimental browser multi-sink prototype is stable enough to keep using while a native WASAPI mixer decision is pending.

The procedure documents how to measure drift. It is not, by itself, a release pass. Release readiness still requires the full `docs/audio/AUDIO_RELEASE_GATE.md` and Phase 6 matrix.

## Shared Rules

- Use a local lossless or high-quality long track, album, or playlist that can run for at least 35 minutes without a source change.
- Use the experimental browser dual-output prototype only after the guard reports armed.
- Use exactly two audible rig members because the prototype is hard-capped at two outputs.
- Disable Bluetooth, wireless, virtual cable, HDMI sleep, or display-power features unless that matrix explicitly asks for them.
- Keep the PC awake and plugged in.
- Avoid changing queue, seek, output selector, EQ mode, app theme, or Windows default output during a measurement run.
- Capture `Copy diagnostics` from the grouped rig panel before start, at 15 minutes, at 30 minutes, and after stop.
- Capture `Copy calibration` after the run if drift, correction, or member timing details need to be shared.
- Keep diagnostics path-hidden. The rig diagnostics sanitizer should report `privacy.pathHidden: true`.

## Wired + Wired Drift Run

Use this for the roadmap item: `Compare browser prototype drift after 30 minutes on wired + wired`.

### Hardware Setup

- Primary output: wired endpoint, such as built-in speakers, USB DAC, 3.5 mm output, or HDMI/DisplayPort audio.
- Secondary output: different wired endpoint, such as another USB DAC, HDMI/DisplayPort audio, line output, or monitor speakers.
- Do not use Bluetooth, Wi-Fi speakers, casting, AirPlay, remote desktop audio, virtual audio cable, or wireless headset routes.
- Confirm Windows exposes both outputs as separate endpoints in Pixelody's output picker.

### Pixelody Setup

1. Open Audio Systems.
2. Refresh outputs.
3. Select or create a grouped speaker rig.
4. Add both wired endpoints as rig members.
5. Make sure both members are enabled, unmuted, and available.
6. Set solo off for both members unless using solo only to isolate a setup problem.
7. Set per-member delay and trim to the intended test values.
8. Enable the experimental browser dual-output prototype.
9. Confirm the rig panel reports a routed secondary path and no duplicate/same-primary route warning.
10. Press `Self-test` and confirm it passes before the physical run.
11. Press `Copy diagnostics` and save the pre-run JSON outside the repo if needed.

### Measurement Steps

1. Start playback and let both outputs play for 60 seconds.
2. At `T+00:01`, confirm both physical outputs are audible.
3. Start the 30-minute timer after that confirmation.
4. Every 5 minutes, record the drift, stability state, correction count, and audible impression.
5. Do not seek or change tracks unless the test is being aborted.
6. At `T+15:00`, copy grouped rig diagnostics.
7. At `T+30:00`, copy grouped rig diagnostics again before stopping playback.
8. Stop playback, then copy grouped rig diagnostics once more.

### Data Table

| Time | Stability | Worst drift ms | Max drift ms | Drift samples | Total corrections | Seek corrections | Rate nudges | Audible result | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| T+00:01 |  |  |  |  |  |  |  | both audible? |  |
| T+05:00 |  |  |  |  |  |  |  |  |  |
| T+10:00 |  |  |  |  |  |  |  |  |  |
| T+15:00 |  |  |  |  |  |  |  |  | diagnostics copied |
| T+20:00 |  |  |  |  |  |  |  |  |  |
| T+25:00 |  |  |  |  |  |  |  |  |  |
| T+30:00 |  |  |  |  |  |  |  |  | diagnostics copied |

### Suggested Decision Thresholds

These thresholds guide the browser/native decision. They are intentionally conservative.

- **Good wired+wired result:** Both physical outputs remain audible for 30 minutes, route stability is mostly `stable`, no repeated seek corrections, no media decode/load errors, and audible timing does not smear vocals, drums, or transients.
- **Borderline wired+wired result:** Route stability alternates between `stable` and `correcting`, rate nudges are occasional, no repeated large seek corrections, and the user can still tolerate the timing.
- **Bad wired+wired result:** Any output drops out, the secondary route becomes `unsupported` or `unstable`, repeated seek corrections occur, drift becomes obvious by ear, or the recovery button is needed.

### Required Run Summary

Fill this in after a real hardware run:

```text
Date:
Pixelody build/thread:
Windows version:
Primary wired endpoint:
Secondary wired endpoint:
Track/source format:
Rig name:
Prototype armed at start: yes/no
Both outputs audible at T+00:01: yes/no
Worst drift at T+30:
Max drift across run:
Total corrections:
Seek corrections:
Rate nudges:
Decode/load errors:
Route failures:
Recovery used:
Audible verdict:
Decision: good / borderline / bad
Notes:
```

## Wired + Bluetooth Drift Run

Use this for the roadmap item: `Compare browser prototype drift after 30 minutes on wired + Bluetooth`.

This run is intentionally stricter about notes and caveats than the wired+wired run. Bluetooth endpoints can add variable buffering, codec delay, operating-system handoff latency, radio interference, headset power-management behavior, and reconnect events that Pixelody cannot fully control from the browser prototype.

### Hardware Setup

- Primary output: wired endpoint, such as built-in speakers, USB DAC, 3.5 mm output, or HDMI/DisplayPort audio.
- Secondary output: Bluetooth endpoint exposed by Windows as a separate output device.
- Use only one Bluetooth endpoint during this run.
- Fully charge or plug in the Bluetooth device before starting.
- Keep the Bluetooth device close to the PC and avoid moving it during the run.
- Disable Bluetooth multipoint, headset call mode, spatial audio enhancements, or vendor low-latency modes unless those are the exact route being measured.
- Confirm Windows and Pixelody both expose the wired and Bluetooth outputs as separate endpoints.

### Pixelody Setup

1. Open Audio Systems.
2. Refresh outputs.
3. Select or create a grouped speaker rig.
4. Add one wired endpoint and one Bluetooth endpoint as rig members.
5. Make sure both members are enabled, unmuted, available, and not resolving to the same route.
6. Put the wired endpoint in the primary/anchor role when possible.
7. Set solo off for both members unless isolating a setup problem.
8. Set per-member delay and trim to the intended test values.
9. Confirm the rig panel shows the Bluetooth caveat for the wireless member.
10. Enable the experimental browser dual-output prototype.
11. Confirm the rig panel reports a routed secondary path and no duplicate/same-primary route warning.
12. Press `Self-test` and confirm it passes before the physical run.
13. Press `Copy diagnostics` and save the pre-run JSON outside the repo if needed.

### Measurement Steps

1. Start playback and let both outputs play for 60 seconds.
2. At `T+00:01`, confirm both physical outputs are audible and the Bluetooth route has not switched to headset/call mode.
3. Start the 30-minute timer after that confirmation.
4. Every 5 minutes, record the drift, stability state, correction count, audible impression, and whether the Bluetooth output glitched, rebuffered, or reconnected.
5. Do not seek, change tracks, reconnect Bluetooth, change Windows output mode, or move the Bluetooth device unless the test is being aborted.
6. At `T+15:00`, copy grouped rig diagnostics.
7. At `T+30:00`, copy grouped rig diagnostics again before stopping playback.
8. Stop playback, then copy grouped rig diagnostics once more.

### Data Table

| Time | Stability | Worst drift ms | Max drift ms | Drift samples | Total corrections | Seek corrections | Rate nudges | Bluetooth events | Audible result | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| T+00:01 |  |  |  |  |  |  |  | route stable? | both audible? |  |
| T+05:00 |  |  |  |  |  |  |  |  |  |  |
| T+10:00 |  |  |  |  |  |  |  |  |  |  |
| T+15:00 |  |  |  |  |  |  |  | diagnostics copied |  |  |
| T+20:00 |  |  |  |  |  |  |  |  |  |  |
| T+25:00 |  |  |  |  |  |  |  |  |  |  |
| T+30:00 |  |  |  |  |  |  |  | diagnostics copied |  |  |

### Suggested Decision Thresholds

These thresholds guide the browser/native decision and the user-facing Bluetooth warning language. They are intentionally conservative.

- **Good wired+Bluetooth result:** Both physical outputs remain audible for 30 minutes, the Bluetooth route does not reconnect or switch modes, route stability is mostly `stable` or occasional `correcting`, no repeated seek corrections happen, and the Bluetooth delay is tolerable after manual/member delay adjustment.
- **Borderline wired+Bluetooth result:** The route stays audible, but stability frequently alternates between `stable` and `correcting`, rate nudges are common, audible alignment is only acceptable for casual room-fill use, or Bluetooth buffering makes the route feel less precise than wired+wired.
- **Bad wired+Bluetooth result:** The Bluetooth output drops out, reconnects, switches to headset/call mode, becomes `unsupported` or `unstable`, needs repeated seek corrections, drifts obviously by ear, or the recovery button is needed.

### Required Run Summary

Fill this in after a real hardware run:

```text
Date:
Pixelody build/thread:
Windows version:
Primary wired endpoint:
Bluetooth endpoint:
Bluetooth device model:
Bluetooth codec/mode if known:
Track/source format:
Rig name:
Prototype armed at start: yes/no
Both outputs audible at T+00:01: yes/no
Bluetooth caveat visible: yes/no
Worst drift at T+30:
Max drift across run:
Total corrections:
Seek corrections:
Rate nudges:
Decode/load errors:
Bluetooth glitches/reconnects/mode switches:
Route failures:
Recovery used:
Audible verdict:
Decision: good / borderline / bad
Notes:
```

## Codec CPU And Decode Overhead Run

Use this for the roadmap item: `Compare browser prototype CPU and decode overhead on FLAC/WAV/MP3`.

This run compares normal single-output playback against the browser multi-sink prototype. The goal is to learn whether duplicate media elements and per-output Web Audio graphs create enough CPU, memory, decode, or responsiveness overhead that browser fan-out should remain experimental-only or be replaced by a native mixer for release-quality grouped playback.

### Test Sources

Use local files that represent normal Pixelody libraries:

- FLAC: one lossless stereo track, preferably 16-bit/44.1 kHz or 24-bit/48 kHz.
- WAV: one uncompressed stereo track, preferably matching the FLAC sample rate if available.
- MP3: one common lossy stereo track, preferably 256-320 kbps CBR/VBR.

Use tracks that are at least 5 minutes long, or loop a stable section without seeking during each measurement window. Avoid network streams, remote folders, cloud-placeholder files, or tracks that trigger artwork/metadata imports during the run.

### Hardware And App Setup

1. Use two wired outputs for the first overhead pass unless intentionally testing Bluetooth overhead separately.
2. Keep the PC awake and plugged in.
3. Close unrelated high-CPU apps.
4. Open Windows Task Manager, Resource Monitor, or another local process monitor.
5. Record the Pixelody/Electron process CPU percentage, memory usage, and any obvious GPU/media-engine usage if the tool exposes it.
6. In Pixelody, create or select a two-member grouped rig.
7. Confirm the experimental browser dual-output prototype can arm.
8. Press `Self-test` and confirm it passes before measuring.
9. Use the same EQ, ReplayGain, output profiles, spatial profiles, volume, and rig member settings for baseline and prototype runs.

### Measurement Steps

Run each codec twice: once in normal single-output playback and once with the browser multi-sink prototype armed.

1. Select the codec test track.
2. Start playback and let it stabilize for 60 seconds.
3. Record a baseline sample at `T+01:00`.
4. Continue playback for 5 minutes without seeking.
5. Record CPU, memory, responsiveness, decode/load status, and diagnostics at `T+05:00`.
6. Stop playback.
7. Repeat the same file with the browser multi-sink prototype armed and both outputs audible.
8. Copy grouped rig diagnostics after the prototype pass.
9. Repeat for FLAC, WAV, and MP3.

### Data Table

| Codec | Mode | CPU at T+01 | CPU at T+05 | Memory at T+01 | Memory at T+05 | Decode/load errors | Drift corrections | UI responsiveness | Audible result | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |
| FLAC | single output |  |  |  |  |  | n/a |  |  |  |
| FLAC | browser multi-sink |  |  |  |  |  |  |  |  |  |
| WAV | single output |  |  |  |  |  | n/a |  |  |  |
| WAV | browser multi-sink |  |  |  |  |  |  |  |  |  |
| MP3 | single output |  |  |  |  |  | n/a |  |  |  |
| MP3 | browser multi-sink |  |  |  |  |  |  |  |  |  |

### Suggested Decision Thresholds

These thresholds guide the browser/native decision. They are intentionally conservative because grouped playback must not make normal music playback feel fragile.

- **Good overhead result:** Prototype CPU and memory stay close to the single-output baseline for FLAC/WAV/MP3, no decode/load errors appear, the UI remains responsive, and drift correction does not increase under codec load.
- **Borderline overhead result:** Prototype overhead is clearly higher but tolerable for a two-output experimental feature, with no audio dropouts, no repeated decode/load errors, and no severe UI stutter.
- **Bad overhead result:** Any codec causes dropouts, repeated decode/load errors, unstable drift correction, obvious UI stalls, runaway memory growth, or CPU usage high enough to make common library browsing/playback unpleasant.

### Required Run Summary

Fill this in after a real hardware run:

```text
Date:
Pixelody build/thread:
Windows version:
CPU model:
RAM:
Primary endpoint:
Secondary endpoint:
Rig name:
EQ/profile state:
FLAC file format:
WAV file format:
MP3 bitrate/mode:
Process monitor used:
FLAC single-output CPU/memory:
FLAC prototype CPU/memory:
WAV single-output CPU/memory:
WAV prototype CPU/memory:
MP3 single-output CPU/memory:
MP3 prototype CPU/memory:
Decode/load errors:
Drift correction changes under load:
UI responsiveness:
Audible verdict:
Decision: good / borderline / bad
Notes:
```

## Roadmap Use

Checking the Phase 5 drift and codec-overhead items means these measurement workflows exist and are ready to run. It does not mean Pixelody has passed the physical release gate until real completed run summaries are recorded.

For the final calibration Phase C gate, copy the actual wired and Bluetooth run
summaries into `MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md`. That ledger is the
single record used to decide whether the calibration roadmap can be checked; a
blank workflow or an unverified diagnostic snapshot is not a physical pass.
