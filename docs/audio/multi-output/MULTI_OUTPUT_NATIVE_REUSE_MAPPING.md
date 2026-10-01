# Native Mixer Profile, Calibration, And Diagnostics Reuse Mapping

This document defines how the future native grouped-playback mixer reuses Pixelody's existing output profiles, spatial profiles, calibration snapshots, and diagnostics.

It is a contract for future implementation. It does not implement native grouped playback.

Read with:

- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md`

## Principle

The native mixer must not invent parallel profile, calibration, or diagnostics systems. It should consume derived payloads from the same data Pixelody already uses for Player Mode and browser fan-out.

The saved sources of truth are:

- `state.systems`: per-output tuning profiles.
- `state.spatialProfiles`: per-output stereo image profiles.
- `state.speakerSystems[].outputs[].calibration`: per-member software and microphone calibration snapshots.
- `activeSpeakerSystemDiagnostics()`: grouped rig diagnostics source.
- `groupedCalibrationReport()`: user-copyable grouped calibration source.

## Profile Binding

Each rig member already carries a profile binding:

```json
{
  "systemProfileId": "default-or-output-id"
}
```

Native input must resolve profiles with the same fallback currently used by the renderer:

```text
profileId = member.systemProfileId || member.deviceId || "default"
outputProfile = normalizeTuning(state.systems[profileId] || tuningDefault())
spatialProfile = normalizeSpatial(state.spatialProfiles[profileId] || spatialDefault())
```

The native bridge receives derived tuning payloads, not direct access to `localStorage`.

## Output Profile Reuse

Output profiles must preserve the same meaning as Player Mode:

| Existing concept | Native use |
| --- | --- |
| Simple EQ values | Convert to the bridge's simple-EQ DSP coefficients or equivalent broad bands. |
| Advanced parametric EQ | Convert to ordered biquad/filter definitions with frequency, gain, Q, type, and enabled state. |
| Output/headphone/DAC preset data | Include only the normalized tuning values that are active for the bound profile. |
| Headroom | Apply before final limiting. |
| Master/system gain | Apply according to existing gain staging and safety caps. |
| Limiter/protection | Keep enabled when Player Mode would protect the route. |
| EQ mode | Preserve as diagnostics and native DSP selection metadata. |

Native payloads should avoid renderer-only UI detail. They should carry normalized DSP intent.

Suggested member tuning shape:

```json
{
  "profileId": "default",
  "eqMode": "advanced",
  "simple": {
    "bass": 0,
    "presence": 0,
    "treble": 0
  },
  "advanced": {
    "enabled": true,
    "bands": []
  },
  "gainStage": {
    "replayGainDb": -2.1,
    "headroomDb": -6,
    "memberTrimDb": 0,
    "limiter": true
  }
}
```

## Spatial Profile Reuse

Spatial profiles remain per-output/member profile data:

| Existing concept | Native use |
| --- | --- |
| Left/right balance | Apply as per-channel gain before final output. |
| Mono mode | Sum or route channels according to the saved spatial profile. |
| Stereo width/crossfeed-style settings, if present | Implement only when native DSP can match Player Mode; otherwise report mismatch. |
| Profile id | Include in status and diagnostics so the UI can explain which profile is active. |

The bridge must report any unsupported spatial option as a native DSP mismatch warning instead of silently ignoring it.

Suggested member spatial shape:

```json
{
  "profileId": "default",
  "balance": 0,
  "mono": false,
  "warnings": []
}
```

## Calibration Reuse

Calibration remains member-attached. Native grouped playback must consume existing snapshots before asking users to recalibrate.

Per-member native input should carry:

- software latency snapshot.
- microphone acoustic snapshot.
- calibration confidence.
- route-match state.
- caveats such as software-only timing, room sensitivity, Bluetooth buffering, and route-questionable reports.

Native bridge rules:

- Treat `member.delayMs` as the intentional user/member delay.
- Treat calibration estimates as measurement facts, not saved delay.
- Do not mutate `member.delayMs` from drift correction.
- Prefer route-matched microphone estimates for listener-position reporting.
- Use software estimates for route/engine latency comparisons when helpful.
- Report missing, stale, or route-questionable calibration clearly.

Suggested calibration shape:

```json
{
  "software": {
    "estimateMs": 12.4,
    "confidence": "Medium",
    "routeMatch": true,
    "measuredAt": "ISO date"
  },
  "microphone": {
    "estimateMs": 34.8,
    "confidence": "High",
    "routeMatch": true,
    "measuredAt": "ISO date"
  },
  "preferredEstimateMs": 34.8,
  "confidence": "high",
  "routeMatch": true,
  "caveats": []
}
```

## Diagnostics Reuse

Native grouped playback must extend the existing grouped rig diagnostics rather than creating a separate support story.

Existing diagnostics already expose:

- active rig identity.
- route availability.
- duplicate-route risk.
- browser prototype state.
- per-member profile ids.
- trim, delay, mute/solo, polarity.
- calibration confidence.
- media/load status for browser secondaries.
- path-hidden privacy marker.

Native diagnostics should add:

- native bridge availability and trust state.
- native route state.
- active native member count.
- per-member native endpoint state.
- sample rate, channel count, period, latency, drift ppm.
- underrun, overrun, glitch, and recovery counters.
- native DSP mismatch warnings.
- native last error, sanitized.

All shared diagnostics must keep:

```json
{
  "privacy": {
    "pathHidden": true,
    "sanitizer": "pixelody-native-mixer-v1"
  }
}
```

## Native Status Merge

The future renderer should merge native status into grouped rig diagnostics like this:

```json
{
  "groupedRigSnapshot": {},
  "nativeMixer": {
    "state": "bridge-missing",
    "available": false,
    "trusted": false,
    "memberRoutes": [],
    "warnings": [],
    "lastError": null,
    "privacy": {
      "pathHidden": true,
      "sanitizer": "pixelody-native-mixer-v1"
    }
  }
}
```

Do not replace browser prototype diagnostics. Browser and native status should coexist until native grouped playback has a release-ready claim.

### Current implementation

The renderer now has one `normalizeNativeMixerStatus()` reducer and a path-hidden main-process status query. Its result is merged into `groupedRigDiagnosticsSnapshot()`, `groupedCalibrationReport()`, and `activeSpeakerSystemDiagnostics()`; the last of those already feeds the local J.A.M. audio-profile snapshot.

The current native bridge reports only an optional bounded-lab component. Consequently the reducer reports `bridge-missing`, `blocked-unsigned`, `blocked-incompatible`, `error`, or `not-required`/`ready` as appropriate; it does not manufacture an `active` grouped route. The optional development endpoint-clock lab can supply a transient `runtimeClock` observation with leader/follower rate estimates and follower correction facts. Raw endpoint IDs, executable paths, and local media paths stay outside the renderer-facing payload.

`runtimeClock` is deliberately not persisted with the rig. Saved member `delayMs` remains the listener/acoustic alignment control and calibration receipt evidence; runtime ppm, ratio, buffer-fill error, and correction state are diagnostic facts only. The rig self-test verifies this separation and path sanitation.

## J.A.M. Snapshot Reuse

The local J.A.M. audio-profile snapshot may include native grouped rig metadata only if it stays path-hidden and does not claim remote synchronized playback. It may report:

- active rig id/name.
- native route state.
- member count.
- profile ids.
- calibration confidence.
- warnings.

It must not expose local track paths, raw endpoint ids, or native component paths.

## Failure And Mismatch Rules

Native reuse is blocked or degraded when:

- a member profile id is missing and fallback profile cannot normalize.
- a spatial option cannot be represented natively.
- calibration is route-questionable.
- diagnostics sanitation is unavailable.
- the bridge reports a different active profile id than the renderer requested.
- the native DSP payload version does not match the app's expected version.

The UI/diagnostics should call these `degraded`, `unsupported`, or `mismatch` states. Do not silently pretend parity with Player Mode.

## Implementation Notes

When native bridge plumbing is added, prefer one renderer-side builder that emits:

- `members[]` from `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md`.
- `profiles.output[profileId]` from normalized `state.systems`.
- `profiles.spatial[profileId]` from normalized `state.spatialProfiles`.
- `calibration` from each member.
- `diagnosticsPolicy` with path-hidden sanitation requirements.

The bridge should return native counters and status. The renderer remains responsible for merging those counters into Pixelody's existing grouped rig diagnostics and user-copyable reports.
