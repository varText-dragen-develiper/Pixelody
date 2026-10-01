# Native Mixer Rig Input Mapping

This document maps Pixelody's existing grouped speaker rig model to the future native mixer `configureRig` input. It is a contract for future implementation; it does not implement native grouped playback.

Read with:

- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md`

## Source Of Truth

The renderer already normalizes grouped speaker rigs through `normalizeSpeakerSystems()` and `normalizeSpeakerMember()` in `src/renderer.js`.

The native mixer must consume that normalized model instead of introducing a separate saved native-rig schema. Native-specific fields may appear in transient command/status payloads, but persisted rig ownership stays with:

- `state.speakerSystems`
- `state.activeSpeakerSystemId`
- `pixelody.speakerSystems`
- `pixelody.activeSpeakerSystemId`

## Rig Mapping

| Saved rig field | Native `configureRig` field | Rule |
| --- | --- | --- |
| `system.id` | `rigId` | Required stable rig identity. |
| `system.name` | `rigName` | Diagnostics/display only; sanitize before support sharing. |
| `system.enabled` | `enabled` | False rigs cannot arm native grouped playback. |
| `system.mode` | `mode` | Must remain `multi-output` for grouped playback. |
| `system.outputs` | `members` | Normalize before mapping, then filter through safety gates. |
| `system.updatedAt` | `rigUpdatedAt` | Helps bridge reject stale reconfigure/status echoes. |

## Member Mapping

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

## Derived Native Fields

These fields are not persisted as part of the saved rig. The renderer/main process derives them when building native mixer input:

| Derived field | Source | Rule |
| --- | --- | --- |
| `active` | `enabled`, mute/solo state, availability, duplicate checks | True only when the member should render audio. |
| `primary` | primary/anchor selection | Use the same anchor rules as browser prototype unless a future native UI adds explicit primary selection. |
| `availability` | current output list and `outputKey` recovery | Unavailable members block native arming but must not delete saved rig data. |
| `duplicateRouteRisk` | output key and resolved endpoint comparison | Duplicate routes block native arming. |
| `routeWarnings` | availability, Bluetooth/wireless hints, duplicate risk, route confidence | Warnings travel to bridge/status diagnostics. |
| `profileId` | `systemProfileId || deviceId || default` | Used for tuning/spatial lookup. |
| `calibrationConfidence` | member calibration confidence helper | Diagnostics only; does not replace raw calibration snapshots. |

## Active Member Selection

Native input must use the same audible-member rules as the browser prototype:

1. Start from normalized `system.outputs`.
2. Remove disabled members.
3. Remove unavailable members for active native playback, but keep them in diagnostics.
4. If any remaining member is soloed, keep only soloed members.
5. Remove muted members.
6. Block if fewer than two active members remain.
7. Block if active members resolve to the same endpoint or unsafe duplicate route.
8. Block if the native safety policy rejects the bridge/component state.

The saved rig may store more members than the initial native bridge supports. The native bridge should report `maxRecommendedOutputs` from `probe`; the renderer must cap active members or block arming according to that capability.

## Native `configureRig` Shape

The future renderer-to-main/native payload should be assembled from the saved rig like this:

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

## Calibration Mapping

Do not flatten calibration down to one latency number too early.

The native bridge should receive both snapshots when available:

- `software`: fastest route/software estimate, useful for internal route latency comparison.
- `microphone`: acoustic arrival estimate, useful for listener-position delay suggestions.

The renderer may also derive:

- `preferredEstimateMs`: microphone estimate if route-matched, otherwise software estimate if route-matched, otherwise null.
- `confidence`: highest usable confidence, with route-questionable reports downgraded in diagnostics.
- `routeMatch`: false if either selected calibration snapshot is known to belong to a different route.

Native drift correction must not mutate saved `delayMs`. Calibration estimates and drift estimates are separate facts.

## Sanitization

The native input/status path must keep local-source privacy rules:

- Saved rig labels and profile ids may be included.
- Raw track paths, artwork paths, library folders, and `file://` URLs must not appear in support-facing payloads.
- Native endpoint ids may be redacted or hashed in diagnostics while raw ids stay internal to the bridge.
- All shared snapshots must include `privacy.pathHidden: true`.

## Implementation Notes

When this becomes code, prefer adding one renderer-side builder that converts `activeSpeakerSystem()` into a native `configureRig` request. That builder should reuse existing helpers for:

- normalized rig/member data.
- member availability.
- duplicate route risk.
- mute/solo active member selection.
- output profile and spatial profile lookup.
- calibration confidence and caveats.
- diagnostics sanitation.

Do not add a second persisted native rig store. The saved grouped speaker rig is the model; native input is a derived command payload.
