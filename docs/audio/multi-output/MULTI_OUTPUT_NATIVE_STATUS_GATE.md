# Native Mixer Status-State Gate

This document defines the native status states that must exist before Pixelody can make any release claim about native grouped speaker playback.

It is a contract for future implementation. It does not implement native grouped playback.

Read with:

- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md`

## Principle

Pixelody must never treat "native component exists" as the same thing as "native grouped playback works." Native status must be a state machine with explicit proof points, blocking states, recovery states, and release gates.

Until all release gates pass, native grouped playback language must stay experimental, prototype, dev-only, or unavailable.

## Required State Vocabulary

Use these states across renderer, main process, native bridge, logs, diagnostics, and support bundles:

| State | Release meaning |
| --- | --- |
| `off` | Native grouped playback is disabled. No release claim. |
| `not-required` | Browser fan-out is active or selected instead. No native release claim. |
| `bridge-missing` | Native bridge is absent. Block native route. |
| `blocked-unsigned` | Native bridge is present but not trusted. Block release and normal user launch. |
| `blocked-incompatible` | Native bridge exists but protocol, version, architecture, or capability is incompatible. Block native route. |
| `starting` | Start requested, not proven. No release claim. |
| `ready` | Bridge accepted configuration but is not rendering. No release claim. |
| `active` | Bridge is rendering all required member outputs and route proof is current. Candidate state only. |
| `degraded` | Native route is audible but has warnings such as high latency, format conversion, drift correction, fallback, or unsupported DSP parity. Experimental only. |
| `member-unavailable` | Required output cannot be opened. Block native route. |
| `duplicate-route-blocked` | Members resolve to the same endpoint or unsafe route. Block native route. |
| `unsupported-format` | Source or route format cannot be handled safely. Block or fall back. |
| `unstable` | Repeated glitches, underruns, drift corrections, endpoint failures, or command desync. Block release claim. |
| `recovering` | Native route is shutting down and returning to primary playback. No release claim. |
| `error` | Native bridge or route failed. Block native route. |

## Route Proof Requirements

The app may show `active` only when all of these are true:

- Bridge binary is present, trusted, compatible, and policy-allowed.
- Bridge heartbeat is current.
- Active rig was normalized from the saved `state.speakerSystems` model.
- Active members passed availability, duplicate-route, mute/solo, and safety gates.
- Every required member endpoint is opened by the bridge.
- The source is loaded or a safe PCM handoff is active.
- Shared playback command sequence is acknowledged.
- Each active member is rendering or ready to render at the expected timeline.
- Native diagnostics sanitation is active.
- Primary-output recovery path is available.

If any proof expires, the state must move to `degraded`, `unstable`, `recovering`, or `error`.

## Release Claim Gate

Do not describe native grouped playback as release-ready unless the app can show a stable progression through:

```text
off
-> ready
-> active
-> active-with-clean-30-minute-physical-run
```

The final release claim also requires Phase 6 physical validation. `active` alone is not enough.

Minimum release-gate facts:

- Route stayed `active` or acceptable `degraded` only for documented hardware runs.
- No `unstable`, `recovering`, or `error` transition occurred during the run.
- No duplicate route or unavailable member appeared.
- All active members reported independent endpoint identities.
- Per-output EQ, spatial profile, gain trim, delay, mute/solo, and diagnostics were independent.
- Mini-player, media keys, queue, seek, pause/resume, track change, and restore remained on one shared command model.
- Native diagnostics stayed path-hidden.
- Primary-output recovery worked after the run.

## Blocking States

These states must prevent native grouped playback from arming:

- `bridge-missing`
- `blocked-unsigned`
- `blocked-incompatible`
- `member-unavailable`
- `duplicate-route-blocked`
- `unsupported-format`
- `error`

The UI should keep normal primary-output playback usable and describe the blocking reason without implying the app itself is broken.

## Degraded States

`degraded` is allowed for development and possibly future experimental use, but not for a clean release-ready claim unless the release notes narrowly describe the caveat.

Examples:

- Bluetooth route active with high latency warning.
- Format conversion active.
- Drift correction active but not audible.
- Native DSP parity warning for a spatial option.
- Endpoint period higher than requested.

Degraded routes must remain copyable in diagnostics.

## Recovery States

`recovering` must be visible in diagnostics when native grouped playback is being torn down after:

- bridge crash.
- feature disable.
- route change.
- output refresh/device removal.
- app close.
- track unload.
- duplicate route detection.
- safety-policy failure.

Recovery completes only after endpoints are released and normal primary-output playback is either active or explicitly paused according to user intent.

## Status Snapshot Shape

Native status should merge into grouped rig diagnostics as:

```json
{
  "nativeMixer": {
    "state": "bridge-missing",
    "claim": {
      "releaseReady": false,
      "reason": "Native bridge is not installed.",
      "allowedLanguage": ["unavailable", "planned"]
    },
    "component": {
      "available": false,
      "trusted": false,
      "compatible": false,
      "version": "",
      "signer": ""
    },
    "routeProof": {
      "heartbeatCurrent": false,
      "configuredRigId": "",
      "activeMemberCount": 0,
      "allEndpointsOpen": false,
      "commandSequenceAck": 0,
      "diagnosticsPathHidden": true,
      "primaryRecoveryAvailable": true
    },
    "members": [],
    "warnings": [],
    "lastError": null,
    "privacy": {
      "pathHidden": true,
      "sanitizer": "pixelody-native-mixer-v1"
    }
  }
}
```

## User-Facing Language Rules

Allowed before Phase 6 passes:

- "Native mixer planned"
- "Native mixer unavailable"
- "Native mixer prototype"
- "Native route active for testing"
- "Native route degraded"

Blocked before Phase 6 passes:

- "release-ready native multi-output"
- "native-quality sync"
- "driver-grade synchronization"
- "guaranteed sync"
- "bit-perfect grouped playback"

## Implementation Notes

When native plumbing begins, add a single status reducer that converts bridge status plus app-side safety gates into this state vocabulary. Do not let UI components invent their own native status labels independently.

The reducer should feed:

- Audio Systems rig panel.
- grouped rig diagnostics.
- copyable grouped calibration report.
- J.A.M. audio profile snapshot.
- recovery button state.
- future release-gate test logs.
