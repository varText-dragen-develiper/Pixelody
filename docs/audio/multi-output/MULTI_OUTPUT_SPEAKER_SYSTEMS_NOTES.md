# How speaker rigs work

A grouped speaker rig saves several Windows outputs and their individual controls. It might combine desk speakers and towers, USB and HDMI, or headphones and speakers. Independent tuning requires independent endpoints; two systems plugged into one analog connection look like one output to Pixelody.

Grouped Pixelody playback is separate from Windows-wide System Tuning and from J.A.M. network sessions.

## Saved members and routes

Rigs use `state.speakerSystems` and `state.activeSpeakerSystemId`, persisted through the corresponding `pixelody.*` keys and included in tuning exports/backups. Per-output EQ stays in `state.systems` and balance/mono in `state.spatialProfiles`.

```json
{
  "id": "member-...",
  "deviceId": "default-or-browser-device-id",
  "label": "Nearfield speakers",
  "outputKey": "label:nearfield speakers",
  "role": "main",
  "enabled": true,
  "muted": false,
  "solo": false,
  "gainDb": 0,
  "delayMs": 0,
  "polarity": "normal",
  "eqMode": "simple",
  "systemProfileId": "default-or-browser-device-id",
  "calibrationReportId": "",
  "calibration": {
    "software": {
      "assignedAt": "ISO date",
      "measuredAt": "ISO date",
      "method": "web-audio-path-profiler",
      "estimateMs": 12.4,
      "confidence": "Medium",
      "routeMatch": true
    },
    "microphone": {
      "assignedAt": "ISO date",
      "measuredAt": "ISO date",
      "method": "microphone-acoustic-pulse",
      "estimateMs": 34.8,
      "confidence": "High",
      "routeMatch": true
    }
  }
}
```

```json
{
  "id": "speaker-system-...",
  "name": "Desk + Towers",
  "enabled": true,
  "mode": "multi-output",
  "engineState": "Setup saved / dual-output engine not armed",
  "outputs": [],
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

`outputKey` is `default`, a normalized `label:...`, or a `device:...` fallback. Refresh recomputes availability and can recover rotating browser IDs. Missing members stay saved but can't route. Duplicate detection compares saved keys and resolved current sinks, including two old IDs that now resolve to the same endpoint.

The current primary output must be a member. Browser grouped playback stays off by default with a two-audible-output cap and explicit sink support. Device changes debounce through normal refresh, report unavailable/recovered members and tear down unsafe secondaries. Enumeration failure clears stale availability rather than leaving a healthy-looking route.

## The browser player

One primary `#audio` owns the clock and shared commands. Off-DOM secondary elements mirror source, time, rate and commands. Each has a `MediaElementAudioSourceNode` and a graph with track/member EQ, ReplayGain, headroom, spatial processing, limiting, trim and polarity, routed by `AudioContext.setSinkId()`. A failed graph/sink never gets an unprocessed fallback.

Secondary graph gain stays zero until sink confirmation. Earlier capture could report a route while producing silence; source-node routing fixed that. Track changes now retain the existing graph instead of illegally attaching one media element to another context. Remove/replace, disable and close tear down the secondary.

Positive member delay targets `primary.currentTime - delayMs / 1000`, holding at track start when needed. Drift monitoring leaves small errors alone, nudges medium errors within 0.97–1.03 of the primary rate and seeks for large errors. Stability and correction history remain diagnostic estimates, not native synchronization evidence. Media load/decode/wait/stall errors are recorded separately from routing and graph errors.

`Primary only` disables the experiment, tears down secondaries, restores the selected primary route and resumes only if it was playing. Its recovery receipt appears in reports.

## Calibration and reports

Member calibration isolates its route and restores enable/mute/solo state afterward. Software and microphone snapshots retain route match/confidence. Suggested delay waits for at least two usable estimates, delays faster members to the slowest and stays within 0–250 ms. By-ear nudges use ±5 and ±0.5 ms. Polarity comparisons record evidence without silently changing the saved setting.

The later rig workflow adds confirmed routes, physical notes, provisional level/arrival/bass comparisons and music verification. [The calibration progress page](MULTI_OUTPUT_CALIBRATION_ROADMAP.md) describes the latest recorded microphone sweep work and remaining physical gates; older threshold-detector proposals aren't current precision results.

`groupedRigSnapshot` and `Copy calibration` include identity, availability, duplicate risk, profiles, controls, calibration and browser/native status. Sanitation removes source keys and path-like strings, with `privacy.pathHidden: true` and `pixelody-rig-diagnostics-v1`. A synthetic Self-test checks normalization, clamping, round trips, non-mutation and sanitation without writing the saved rig.

## What remains experimental

The [browser decision](MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md) keeps fan-out experimental while drift, overhead and recovery evidence remain open. The [native contract](MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md) reuses rigs/profiles and defines process, DSP, trust, status and recovery. Its endpoint-clock lab queues silence; transient ppm/ratio/fill observations never change saved acoustic delay.

The [recorder](MULTI_OUTPUT_PHYSICAL_VALIDATION_RECORDER.md) can sample a real thirty-minute run but can't hear the speakers or clear a release checkbox. [Phase 5](MULTI_OUTPUT_PHASE5_MEASUREMENT_LOG.md) covers measurements; [Phase 6](MULTI_OUTPUT_PHASE6_PHYSICAL_VALIDATION.md) covers acceptance; [the ledger](MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md) still needs actual wired and Bluetooth records.

Test single built-in/USB/HDMI/Bluetooth routes, wired combinations, two USB outputs, unplug/replug while paused and playing, seek/track change, restart and backup restore. Keep output processing audible, endpoints independent and ordinary playback recoverable. See `src/renderer.js`, `src/index.html` and `src/settings.css` for rig controls, and `src/native-wasapi-helper.js` for optional native probes.
