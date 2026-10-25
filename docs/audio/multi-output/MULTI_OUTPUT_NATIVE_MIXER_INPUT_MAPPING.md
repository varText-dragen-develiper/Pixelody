# Building native mixer input from a rig

Derive `configureRig` from the saved rig already normalized by `normalizeSpeakerSystems()` and `normalizeSpeakerMember()` in `src/renderer.js`. Don't create a second native-rig store. `state.speakerSystems`, `state.activeSpeakerSystemId` and their `pixelody.*` keys remain the saved model; native command/status fields are transient.

This is the mapping for the planned [mixer API](MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md), subject to its [safety rules](MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md).

## Rig fields

| Saved rig field | Native `configureRig` field | Rule |
| --- | --- | --- |
| `system.id` | `rigId` | Required stable rig identity. |
| `system.name` | `rigName` | Diagnostics/display only; sanitize before support sharing. |
| `system.enabled` | `enabled` | False rigs cannot arm native grouped playback. |
| `system.mode` | `mode` | Must remain `multi-output` for grouped playback. |
| `system.outputs` | `members` | Normalize before mapping, then filter through safety gates. |
| `system.updatedAt` | `rigUpdatedAt` | Helps bridge reject stale reconfigure/status echoes. |

## Member fields

| Saved member field | Native member field | Rule |
| --- | --- | --- |
| `member.id` | `memberId` | Required stable member identity. |
| `member.deviceId` | `deviceId` | Browser/native route hint; native endpoint resolution may replace it with a native endpoint id in status. |
| `member.outputKey` | `outputKey` | Required for duplicate protection and device-id recovery. |
| `member.label` | `label` | Display/diagnostic label; do not use as sole endpoint identity. |
| `member.role` | `role` | Preserve user intent such as `main`, `sub`, `tower`, or `room-fill`. |
| `member.enabled` | `enabled` | Disabled members are excluded from active native output. |
| `member.muted` | `muted` | Mute gate before trim. |
| `member.solo` | `solo` | If any member is soloed, non-solo members are excluded from active native output. |
| `member.gainDb` | `gainDb` | Clamp to `-24..12` dB. |
| `member.delayMs` | `delayMs` | Clamp to `0..250` ms; represents intentional added delay, not measured total latency. |
| `member.polarity` | `polarity` | `normal` or `inverted`; native bridge applies inversion without mutating saved value. |
| `member.eqMode` | `eqMode` | Preserve for UI/diagnostics; actual EQ payload comes from bound profile. |
| `member.systemProfileId` | `systemProfileId` | Binds output tuning and spatial profile lookup. Fallback to `member.deviceId` or `default`. |
| `member.calibrationReportId` | `calibrationReportId` | Optional provenance id for diagnostics. |
| `member.calibration.software` | `calibration.software` | Compact software latency snapshot. |
| `member.calibration.microphone` | `calibration.microphone` | Compact acoustic timing snapshot. |

## Values calculated for a request

Calculate these when building a request; don't save them with the rig:

| Derived field | Source | Rule |
| --- | --- | --- |
| `active` | `enabled`, mute/solo state, availability, duplicate checks | True only when the member should render audio. |
| `primary` | primary/anchor selection | Use the same anchor rules as browser prototype unless a future native UI adds explicit primary selection. |
| `availability` | current output list and `outputKey` recovery | Unavailable members block native arming but must not delete saved rig data. |
| `duplicateRouteRisk` | output key and resolved endpoint comparison | Duplicate routes block native arming. |
| `routeWarnings` | availability, Bluetooth/wireless hints, duplicate risk, route confidence | Warnings travel to bridge/status diagnostics. |
| `profileId` | `systemProfileId || deviceId || default` | Used for tuning/spatial lookup. |
| `calibrationConfidence` | member calibration confidence helper | Diagnostics only; does not replace raw calibration snapshots. |

## Choosing audible members

Start with normalized `system.outputs`. Exclude disabled or unavailable members from playback, keeping unavailable ones in diagnostics. If any remaining member is soloed, exclude the others, then exclude muted members. At least two independent available routes must remain. Duplicate endpoints or a failed trust/safety check block arming.

A saved rig can contain more outputs than a bridge supports. Respect `probe.maxRecommendedOutputs` by capping the active request or refusing it. Never delete saved members to fit a temporary capability limit.

## Request example

```json
{
  "protocol": "pixelody.multiOutput.nativeMixer.v1",
  "command": "configureRig",
  "commandId": "stable-id-for-request",
  "issuedAt": "ISO date",
  "rigId": "speaker-system-...",
  "rigName": "Desk + Towers",
  "rigUpdatedAt": "ISO date",
  "primaryMemberId": "member-...",
  "members": [
    {
      "memberId": "member-...",
      "deviceId": "browser-or-native-route-hint",
      "outputKey": "label:desk speakers",
      "label": "Desk speakers",
      "role": "main",
      "enabled": true,
      "active": true,
      "muted": false,
      "solo": false,
      "gainDb": 0,
      "delayMs": 0,
      "polarity": "normal",
      "eqMode": "advanced",
      "systemProfileId": "default",
      "spatialProfileId": "default",
      "calibrationReportId": "",
      "calibration": {
        "software": null,
        "microphone": null,
        "confidence": "uncertain",
        "routeMatch": true
      },
      "route": {
        "available": true,
        "duplicateRouteRisk": false,
        "sameAsPrimaryRisk": false,
        "warnings": []
      }
    }
  ],
  "policy": {
    "failClosed": true,
    "privacy": {
      "pathHidden": true
    }
  }
}
```

## Timing and privacy

Carry both software and microphone snapshots. Software estimates describe the route; microphone estimates describe acoustic arrival. A route-matched microphone result is preferred for listening-position reporting, then a matched software result, otherwise `null`. Downgrade questionable confidence and set `routeMatch` false for a known mismatch. Drift correction never writes saved `delayMs`.

Labels/profile IDs can travel with the request. Raw endpoint IDs remain internal or become hashes in shared diagnostics. Track paths, artwork paths, library folders and `file://` URLs stay out of support payloads; shared snapshots carry `privacy.pathHidden: true`.

Use one builder from `activeSpeakerSystem()`, reusing availability, duplicate checks, mute/solo, profile lookup, calibration and sanitation helpers. The request is a projection of the existing rig.
