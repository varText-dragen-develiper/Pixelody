# Multi-Output Native Mixer Contract

This contract defines the future native Windows mixer path for Pixelody grouped speaker rigs. It is a design/API contract, not an implemented native audio renderer.

Use this when browser fan-out is not enough and Pixelody needs release-quality grouped playback across multiple Windows outputs.

Read with:

- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md` for the optional, signed, uninstallable, and non-invasive safety rules that gate any native implementation.
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md` for the saved grouped-rig to native `configureRig` mapping.
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md` for output profile, spatial profile, calibration, and diagnostics reuse.
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_STATUS_GATE.md` for native route states and release-claim gating.

## Decision Boundary

The native mixer is required if Phase 5/6 measurements show that browser fan-out cannot honestly provide stable two-output playback, acceptable codec overhead, reliable recovery, or support beyond the current two-output experimental cap.

Until the native mixer is implemented and physically validated, Pixelody must keep normal Player Mode playback on the current renderer/Web Audio path and keep browser fan-out labeled experimental.

## Ownership

### Electron Renderer

- Owns user intent, current track state, queue state, rig selection, member controls, and UI status.
- Builds the mixer request from existing rig members, output profiles, spatial profiles, calibration snapshots, current track info, ReplayGain, volume, mute/solo, seek/play/pause, and diagnostics policy.
- Does not run the release-quality real-time multi-output render loop.
- Must keep single-output playback recoverable if native routing fails.

### Electron Main Process

- Owns helper/bridge discovery, process launch, process shutdown, request validation, IPC boundaries, status polling, and crash/restart reporting.
- Must hide local paths from support-facing diagnostics.
- Must reject unknown or malformed renderer commands.

### Native Mixer Bridge

Suggested process name: `Pixelody.MultiOutput.Bridge.exe`.

- Owns real-time WASAPI rendering to multiple real Windows output endpoints.
- Opens each selected endpoint independently.
- Applies per-member gain, delay, polarity, EQ, spatial/balance/mono, headroom, and limiting.
- Maintains one shared playback timeline from the app command stream.
- Reports endpoint format, route state, latency, drift, underruns, overruns, glitches, and last error.
- Must fail closed by stopping native grouped output and returning control to normal Pixelody playback.

### Optional Shared Native Audio Core

The multi-output bridge may share DSP, endpoint probing, route-state, and diagnostics code with future System EQ bridge work, but the contracts stay distinct:

- Multi-output bridge: Pixelody playback to multiple real outputs.
- System EQ bridge: external Windows/shared-mode audio through `Pixelody Virtual Output` / `Pixelody Virtual Monitor` to a real output.

## Non-Goals

- No driver required for normal Pixelody playback.
- No driver required for the first native multi-output mixer if direct WASAPI endpoint rendering is enough.
- No registry edits.
- No default-device changes.
- No silent install.
- No kernel EQ.
- No claim of bit-perfect output while Pixelody processing, Windows shared mode, resampling, or per-output tuning is active.
- No support for protected, exclusive, ASIO, or non-PCM app audio in the grouped playback mixer contract.

## Route States

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

## Renderer To Bridge Commands

All command payloads must include:

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

Required response fields:

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

Required source facts:

- source id.
- codec/format label.
- duration if known.
- sample rate if known.
- channel count if known.
- ReplayGain facts if known.
- sanitized diagnostics label.

### `play`

Starts or resumes native grouped playback at a shared timeline position.

Required fields:

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

## Bridge Status Snapshot

The bridge must report path-hidden JSON shaped like:

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

## DSP Requirements

The native mixer must preserve the same user-facing meaning as Pixelody Player Mode:

- Track EQ applies before output/member EQ.
- ReplayGain remains capped.
- Headroom precedes limiting.
- Per-member gain trim happens independently.
- Per-member mute/solo gates must match the renderer rig behavior.
- Per-member delay offsets represent intentional delay added to that member.
- Polarity flip inverts the member output without changing the saved member value unless commanded.
- Balance and mono settings come from the member's bound spatial profile.

Any deliberate DSP mismatch between renderer and native bridge must be reported in diagnostics.

## Timing Requirements

- One shared playback command timeline controls every member.
- Per-member delays are applied relative to the shared timeline.
- Endpoint latency and drift estimates are reported per member.
- Drift correction is internal to the bridge and must not mutate user delay settings.
- Route status becomes `degraded` or `unstable` when correction becomes frequent or audible.
- A follower route must estimate its endpoint clock against QPC, select one endpoint as the timeline leader, and use a bounded asynchronous-resampling ratio for transient correction. The initial prototype limit is +/-300 ppm with no more than 20 ppm of change per observation; a production renderer may only widen that range after physical validation.
- Runtime clock correction, buffer-fill error, and correction counters are transient status facts. They are not calibration results and must never overwrite saved acoustic `delayMs` values.

## Safety Requirements

- Native mixer must be optional.
- Release native components must be signed and trusted; unsigned components are dev-only with an explicit unpackaged override.
- Native grouped playback must be uninstallable without deleting user data or breaking normal playback.
- Native grouped playback must not mutate Windows default output, install a service, write registry settings, or capture external app audio.
- Single-output playback must work if the bridge is missing, unsigned, failed, or disabled.
- Any bridge failure must fail closed and release endpoints.
- Duplicate endpoint routes must be blocked before playback.
- Unavailable members must not block normal primary playback.
- Bluetooth routes must carry conservative warnings.
- Diagnostics must not expose track paths, artwork paths, library paths, or raw local source URLs.
- No audio content may be stored in diagnostics.

## Implementation Gate

Before coding the native bridge, the app should add stubbed status plumbing that can represent:

- `bridge-missing`
- `blocked-unsigned`
- `ready`
- `active`
- `degraded`
- `member-unavailable`
- `duplicate-route-blocked`
- `unstable`
- `recovering`
- `error`

Those states must flow through the canonical status gate described in `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_STATUS_GATE.md`; UI, diagnostics, J.A.M. snapshots, and support bundles should not invent separate native status vocabularies.

Before release claims, physical Phase 6 validation must prove native grouped playback with real outputs, independent per-output tuning, route recovery, shared commands, and non-regression of normal Pixelody playback.
