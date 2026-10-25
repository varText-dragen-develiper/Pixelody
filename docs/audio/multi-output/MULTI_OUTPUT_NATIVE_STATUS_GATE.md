# Native mixer status

A binary being installed doesn't mean a rig is playing. Use one reducer to turn bridge reports and app-side checks into the states below, then feed the same result to Audio Systems, diagnostics, calibration reports, J.A.M. metadata and recovery controls. This contract doesn't establish native grouped playback.

## States

Use these names across the renderer, main process, bridge and reports:

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

## Showing an active route

The bridge must be present, trusted, compatible, allowed and sending a current heartbeat. The rig must come from normalized saved data, with available independent members passing mute/solo and safety checks. All endpoints need to be open, the source loaded or safely supplied as PCM, and the shared command sequence acknowledged. Each member must be rendering or ready at the expected timeline. Sanitation and primary recovery must also be available.

If those facts expire, move to `degraded`, `unstable`, `recovering` or `error`. Missing, unsigned, incompatible, unavailable-member, duplicate-route, unsupported-format and error states block arming while ordinary playback remains usable.

`degraded` can describe Bluetooth latency, format conversion, correction, unsupported DSP parity or a longer endpoint period. Keep the details copyable. It isn't a clean release claim; any later limited claim needs explicit caveats in the release notes.

## Recovery and release

Report `recovering` after a crash, disable, route change, output removal/refresh, close, source unload, duplicate detection or policy failure. Recovery finishes when endpoints are released and primary playback is playing or paused as intended.

A release needs more than `off → ready → active`: it needs the Phase 6 thirty-minute physical run. Record any degraded periods; no unstable/recovering/error transition, duplicate route or unavailable required member can be hidden. Verify independent endpoints, EQ/spatial profiles, trim/delay/mute/solo, shared commands, path-hidden reports and recovery afterward.

## Snapshot example

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

Before those checks pass, use descriptions such as planned, unavailable, prototype, active for testing or degraded. Claims of release-ready/native-quality/driver-grade/guaranteed sync or bit-perfect grouped playback aren't supported. See the [API](MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md), [safety policy](MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md), [input mapping](MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md) and [profile reuse](MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md).
