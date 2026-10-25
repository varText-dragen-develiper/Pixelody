# Reusing profiles in the native mixer

The mixer request should use the same output/spatial profiles, member calibration and reports as Player Mode and browser fan-out. Creating native-only copies would leave two sets of settings to keep in step.

Saved tuning comes from `state.systems`, spatial settings from `state.spatialProfiles`, and measurements from `state.speakerSystems[].outputs[].calibration`. Reports already come through `activeSpeakerSystemDiagnostics()` and `groupedCalibrationReport()`. The bridge receives a normalized request, never direct browser-storage access.

## Resolving a profile

```text
profileId = member.systemProfileId || member.deviceId || "default"
outputProfile = normalizeTuning(state.systems[profileId] || tuningDefault())
spatialProfile = normalizeSpatial(state.spatialProfiles[profileId] || spatialDefault())
```

| Existing concept | Native use |
| --- | --- |
| Simple EQ values | Convert to the bridge's simple-EQ DSP coefficients or equivalent broad bands. |
| Advanced parametric EQ | Convert to ordered biquad/filter definitions with frequency, gain, Q, type, and enabled state. |
| Output/headphone/DAC preset data | Include only the normalized tuning values that are active for the bound profile. |
| Headroom | Apply before final limiting. |
| Master/system gain | Apply according to existing gain staging and safety caps. |
| Limiter/protection | Keep enabled when Player Mode would protect the route. |
| EQ mode | Preserve as diagnostics and native DSP selection metadata. |

Send DSP values rather than UI state. One possible tuning payload is:

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

Balance and mono follow the bound spatial profile. Implement any width/crossfeed option only where native processing can match it; otherwise report the mismatch. Include the profile ID so status can say which settings were actually applied.

```json
{
  "profileId": "default",
  "balance": 0,
  "mono": false,
  "warnings": []
}
```

## Measurements remain separate from corrections

Carry existing software and microphone snapshots, confidence, route match and caveats. A matched microphone result is useful at the listening position; software timing describes the route/engine. Missing, stale or mismatched reports need to remain visible. Neither measured latency nor runtime drift replaces the listener's intentional `member.delayMs`.

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

## Adding status to existing reports

Keep browser diagnostics and add bridge availability/trust, native route/member state, endpoint format/period/latency/drift, underrun/overrun/glitch/recovery counters, DSP mismatches and sanitized errors. Preserve the path-hidden marker:

```json
{
  "privacy": {
    "pathHidden": true,
    "sanitizer": "pixelody-native-mixer-v1"
  }
}
```

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

The implemented `normalizeNativeMixerStatus()` reducer and main-process query merge into `groupedRigDiagnosticsSnapshot()`, `groupedCalibrationReport()` and `activeSpeakerSystemDiagnostics()`. The latter also feeds local J.A.M. audio-profile metadata.

At this checkpoint the bridge was a bounded lab component. Reports could show missing, unsigned, incompatible, error or appropriate ready/not-required status; they didn't manufacture an active grouped route. The endpoint-clock lab could add a transient `runtimeClock` observation. Raw endpoint IDs, executable/media paths and that transient clock state stay outside saved rigs and shared payloads. The rig self-test checks sanitation and the separation from saved acoustic delay.

J.A.M. may carry rig identity, route state, member count, profile IDs, confidence and warnings. That metadata doesn't establish synchronized remote audio. Block or degrade unnormalizable profiles, unsupported spatial options, questionable calibration, missing sanitation, unexpected returned profile IDs and DSP-version mismatch.

Use one builder for members, normalized output/spatial profiles, member calibration and diagnostics policy. The bridge returns counters; the renderer merges them into existing reports. See [rig input](MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md), [the API](MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md) and [safety](MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md).
