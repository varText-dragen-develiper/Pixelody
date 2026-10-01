# Multi-Output Native Mixer Safety Policy

This policy defines what `optional`, `signed`, `uninstallable`, and `non-invasive` mean for Pixelody's future native grouped-playback mixer.

It applies to the planned `Pixelody.MultiOutput.Bridge.exe` and any native support files used for grouped speaker rigs. It does not grant release approval for native grouped playback.

## Policy Summary

The native mixer must never become a hidden dependency for Pixelody playback. Normal single-output playback, library use, imports, settings, themes, playlists, mini-player controls, media keys, and browser-safe diagnostics must continue to work when the native mixer is missing, disabled, unsigned, crashed, blocked, or uninstalled.

## Optional

Native grouped playback is optional only if all of these remain true:

- Pixelody starts and plays normally without the native mixer installed.
- The native mixer is disabled by default until a user or developer explicitly enables the native route.
- Browser fan-out remains labeled experimental and separate from the native route.
- Missing native components show a status such as `bridge-missing`, not a broken-player error.
- Disabling native grouped playback returns to the primary output path.
- The app does not require a driver, service, registry edit, default-device change, or admin prompt for normal Player Mode playback.
- Backups, tuning exports, diagnostics, and J.A.M. snapshots can include native status metadata without requiring native binaries.

## Signed

Release native components must be signed and policy-checked before Pixelody trusts them:

- Public/release builds must require valid Authenticode signing for `Pixelody.MultiOutput.Bridge.exe`.
- Any future driver package must use the Windows Driver Store and Microsoft-compatible signing path required for the target release channel.
- Unsigned native components are allowed only in unpackaged development runs with an explicit developer override.
- The app must expose a `blocked-unsigned` or equivalent state instead of launching an untrusted native mixer silently.
- Version, signer, trust status, component path source, and compatibility state must be available in diagnostics.
- A signed-but-incompatible component must be blocked with a recoverable status.

## Uninstallable

Native grouped playback is uninstallable only if:

- Removing the component leaves normal Pixelody playback usable.
- The uninstall path releases all opened WASAPI endpoints.
- No background bridge process remains after uninstall, app close, or feature disable.
- No startup task, service, scheduled task, or driver remains unless it belongs to a separately consented System EQ component.
- Any future installer records enough metadata to remove the component cleanly.
- Uninstall does not delete user libraries, playlists, artwork, tuning profiles, speaker rigs, calibration reports, or backups.
- If a future driver/component ever affects Windows output routing, uninstall must restore or clearly offer to restore the previous real output.

## Non-Invasive

The native mixer is non-invasive only if it keeps to the smallest scope required for grouped Pixelody playback:

- Use direct WASAPI endpoint rendering for Pixelody playback before considering drivers.
- Do not mutate Windows default output for grouped Pixelody playback.
- Do not write registry settings for normal grouped playback.
- Do not install a service for normal grouped playback.
- Do not capture external app audio for the grouped playback mixer.
- Do not record or persist audio content.
- Do not install virtual endpoints for grouped Pixelody playback unless a separate System EQ feature gate explicitly requires them.
- Do not render to a virtual endpoint or duplicate route that could create feedback or doubled playback.
- Do not open unavailable, disabled, duplicate, or same-resolved endpoints.
- Do not leave endpoints open after stop, route change, app close, crash recovery, or feature disable.

## Runtime Safety Gates

The app must block native grouped playback unless:

- Bridge policy status is trusted.
- Requested rig has at least two available, enabled, non-duplicated member routes.
- Every active member route can be opened independently.
- The selected source format is supported or safely converted.
- Per-member tuning payloads are valid and clamped.
- The primary-output recovery path is available.
- Diagnostics sanitation is active.

If any gate fails during playback, the route must fail closed, release endpoints, report a path-hidden error, and keep or restore normal primary-output playback.

## Diagnostics Rules

Native mixer diagnostics may include:

- component version.
- signing/trust state.
- route state.
- endpoint labels and redacted/stable endpoint ids.
- sample rate, channel count, period, latency, drift, underrun, overrun, and glitch counters.
- member trim, delay, mute/solo, polarity, profile ids, and calibration confidence.
- sanitized last error and recovery action.

Native mixer diagnostics must not include:

- raw local track paths.
- artwork paths.
- library folder paths.
- raw `file://` URLs.
- recorded audio content.
- decoded PCM samples.
- private Windows account paths.

Diagnostics must include:

```json
{
  "privacy": {
    "pathHidden": true,
    "sanitizer": "pixelody-native-mixer-v1"
  }
}
```

## Development Override Policy

Development overrides are allowed only when all of these are true:

- The app is running unpackaged.
- The override is explicit, such as an environment variable or dev-only command flag.
- The UI and diagnostics label the route as development-only.
- The override cannot be enabled from normal user settings.
- Release builds ignore the override.

## Release Gate

Do not ship native grouped playback as release-ready until:

- Signed component verification passes on a clean non-dev Windows machine.
- Install, disable, app-close, crash, update, uninstall, and rollback flows are manually tested.
- Normal playback is verified before install, during native disabled state, after native failure, and after uninstall.
- Physical output matrix passes for two real outputs.
- Diagnostics are path-hidden.
- The user can recover to primary-output playback from every native route state.

## Contract Relationship

This safety policy extends `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md`. If implementation pressure conflicts with this policy, the policy wins until the roadmap is deliberately updated with a new safety decision.
