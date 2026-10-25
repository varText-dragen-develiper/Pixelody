# Connecting a native multi-output mixer

This is the proposed API for a Windows mixer that can render Pixelody to several real outputs. The contract doesn't provide a running renderer. Until implementation and physical checks pass, ordinary playback stays on Web Audio and browser fan-out stays experimental.

The renderer owns intent, track/queue state, rig selection and controls. It builds requests from existing tuning and calibration data. The main process validates those requests and manages discovery, trust, process lifetime, polling and crash reporting. Neither should run a real-time endpoint render loop.

The suggested `Pixelody.MultiOutput.Bridge.exe` would own WASAPI endpoints, a shared timeline, per-member DSP and route counters. A failure must stop grouped output, release the endpoints and return control to normal playback. It may share native DSP/probing code with System EQ, but grouped playback consumes Pixelody's music; System EQ consumes another app's shared-mode audio through virtual endpoints.

Use the [input mapping](MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md), [profile mapping](MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md), [safety rules](MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md) and [status definitions](MULTI_OUTPUT_NATIVE_STATUS_GATE.md) alongside this API. A measurement failure, excessive browser overhead or a need for more than two outputs is the reason to pursue this route.

It mustn't require a driver for ordinary playback, or for native grouped playback if direct WASAPI rendering is sufficient. No silent installation, registry/default-device mutation, kernel EQ or grouped capture of protected/exclusive/ASIO/non-PCM external-app audio belongs in this contract. Processing and shared-mode resampling also preclude a bit-perfect claim.

## Route states

Use these states across renderer, main process, bridge, logs, and diagnostics:

| State | Meaning |
| --- | --- |
| `off` | Native grouped playback is disabled. |
| `not-required` | Browser fan-out remains the active experimental path; native mixer is not currently selected. |
| `bridge-missing` | Native mixer bridge binary is not installed or not discoverable. |
| `blocked-unsigned` | Bridge exists but is not trusted by current policy. |
| `starting` | Start requested; endpoints and audio graph are not proven yet. |
| `ready` | Bridge process is alive and has accepted configuration, but playback is not active. |
| `active` | Bridge is rendering current Pixelody playback to all required member outputs. |
| `degraded` | Playback is active with warnings such as format conversion, high latency, drift correction, endpoint fallback, or reduced channel mode. |
| `member-unavailable` | One or more required rig member outputs cannot be opened. |
| `duplicate-route-blocked` | Two members resolve to the same endpoint or unsafe route. |
| `unsupported-format` | The bridge cannot decode, accept, or convert the current source/format safely. |
| `unstable` | The route has repeated glitches, underruns, overruns, drift corrections, or member failures. |
| `recovering` | Bridge is stopping and returning Pixelody to primary-output playback. |
| `error` | Bridge failed with a reportable error. |

## Requests

Each request carries this envelope:

```json
{
  "protocol": "pixelody.multiOutput.nativeMixer.v1",
  "commandId": "stable-id-for-request",
  "issuedAt": "ISO date",
  "rigId": "speaker-system-...",
  "playbackSessionId": "renderer-session-or-track-session-id"
}
```

### `probe`

Reports bridge capability without opening render streams.

Return:

- bridge version.
- signing/trust status.
- WASAPI availability.
- supported channel counts.
- supported sample formats.
- max recommended outputs.
- whether low-latency/event-driven shared mode is available.

### `configureRig`

Sends the complete native mixer configuration for one grouped rig.

The payload must be derived from the saved grouped speaker rig model described in `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md`. Do not add a separate persisted native rig schema.

Payload:

```json
{
  "command": "configureRig",
  "primaryMemberId": "member-...",
  "maxOutputs": 2,
  "members": [
    {
      "memberId": "member-...",
      "deviceId": "browser-or-native-device-id",
      "outputKey": "label:example",
      "label": "Desk speakers",
      "role": "main",
      "enabled": true,
      "muted": false,
      "solo": false,
      "gainDb": 0,
      "delayMs": 0,
      "polarity": "normal",
      "systemProfileId": "default",
      "spatialProfileId": "default",
      "calibration": {
        "softwareEstimateMs": 12.4,
        "microphoneEstimateMs": 34.8,
        "confidence": "medium",
        "routeMatch": true
      }
    }
  ],
  "tuning": {
    "masterVolume": 0.72,
    "replayGainDb": -2.1,
    "headroomDb": -6,
    "limiter": true,
    "profiles": []
  },
  "policy": {
    "latencyMode": "stable",
    "failClosed": true,
    "allowBluetooth": true,
    "allowFormatConversion": true,
    "privacy": {
      "pathHidden": true
    }
  }
}
```

### `loadSource`

Sends a source descriptor that the native bridge can open or receive through a future app-owned decoded PCM stream.

The first contract should prefer an app-managed PCM handoff or safe local source handle over raw path strings in diagnostics. If local paths are needed internally, they must never appear in support-facing status payloads.

Include:

- source id.
- codec/format label.
- duration if known.
- sample rate if known.
- channel count if known.
- ReplayGain facts if known.
- sanitized diagnostics label.

### `play`

Starts or resumes native grouped playback at a shared timeline position.

Include:

- target position seconds.
- playback rate.
- command sequence number.

### `pause`

Pauses all member routes on the same command sequence.

### `seek`

Moves all member routes to a shared timeline position and reapplies per-member delay offsets.

### `setPlaybackRate`

Updates shared playback rate. Per-member drift correction must remain internal and reported separately.

### `setVolumeBase`

Updates the shared base volume before per-member trim, mute/solo, headroom, and limiter.

### `updateMembers`

Hot-updates member controls that do not require reopening endpoints:

- enabled.
- muted.
- solo.
- gainDb.
- delayMs.
- polarity.
- profile bindings.

The bridge may respond with `requiresReconfigure: true` if an endpoint, format, or graph change is required.

### `setTuning`

Updates track EQ, output EQ, spatial profile, ReplayGain, headroom, and limiter payloads.

The bridge payload must reuse the existing output profile, spatial profile, calibration, and diagnostics sources described in `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md`. Do not add parallel native-only tuning, spatial, calibration, or diagnostics stores.

### `stop`

Stops grouped rendering and releases endpoints.

### `recoverToPrimary`

Stops grouped rendering, releases endpoints, and reports whether Pixelody should resume normal primary-output playback.

### `status`

Returns a full status snapshot.

## Status snapshot

Status uses path-hidden JSON:

```json
{
  "protocol": "pixelody.multiOutput.nativeMixer.v1",
  "state": "active",
  "bridge": {
    "version": "0.0.0-dev",
    "signed": true,
    "heartbeatAt": "ISO date",
    "uptimeMs": 120000
  },
  "rig": {
    "rigId": "speaker-system-...",
    "memberCount": 2,
    "activeMemberCount": 2,
    "primaryMemberId": "member-..."
  },
  "playback": {
    "sourceId": "sanitized-source-id",
    "positionSec": 42.2,
    "playbackRate": 1,
    "playing": true,
    "commandSequence": 18
  },
  "members": [
    {
      "memberId": "member-...",
      "state": "active",
      "deviceIdHash": "stable-redacted-id",
      "label": "Desk speakers",
      "sampleRate": 48000,
      "channels": 2,
      "format": "float32",
      "periodMs": 10,
      "latencyMs": 62,
      "driftPpm": 0,
      "underruns": 0,
      "overruns": 0,
      "glitches": 0,
      "gainDb": 0,
      "delayMs": 0,
      "muted": false,
      "solo": false,
      "polarity": "normal",
      "profileId": "default",
      "warnings": []
    }
  ],
  "warnings": [],
  "lastError": null,
  "privacy": {
    "pathHidden": true,
    "sanitizer": "pixelody-native-mixer-v1"
  }
}
```

## Processing and timing

Track EQ precedes member/output EQ. Keep ReplayGain caps, headroom before limiting, independent trim and the same mute/solo behavior as the renderer. Delay means intentionally added delay; polarity changes the samples without silently changing the saved setting. Balance and mono come from the bound spatial profile. Report any DSP mismatch.

Every endpoint follows one command timeline with member delay offsets. Report latency and drift per member. A follower compares its endpoint clock with QPC and uses bounded asynchronous resampling against a leader. The initial range is ±300 ppm, with no more than 20 ppm change per observation. Widening it needs physical validation.

Runtime correction, buffer-fill error and counters are transient. They mustn't overwrite acoustic `delayMs` or become calibration results. Frequent or audible correction makes the route `degraded` or `unstable`.

## Before calling it ready

The [safety policy](MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md) requires an optional, trusted, removable component, duplicate-route blocking and recovery without lost user data. Keep local media/artwork/library paths and audio content out of diagnostics. Missing, unsigned or failed components must leave single-output playback usable. Bluetooth needs conservative warnings.

Use one status reducer for the app, diagnostics, reports and J.A.M. snapshots. Before release, Phase 6 still needs real outputs, independent tuning, shared commands, route recovery and ordinary-playback regression checks. A process starting or accepting configuration isn't that result.
