# Rules for an optional native mixer

The planned `Pixelody.MultiOutput.Bridge.exe` must be an optional addition. If it is missing, disabled, unsigned, blocked, crashed or removed, normal playback, the library, imports, settings, playlists, themes, mini-player, media keys and browser-safe diagnostics still need to work.

## Installation and trust

Keep native grouped playback off until explicitly enabled. A missing bridge reports `bridge-missing`, and disabling it returns to the primary route. Normal Player Mode must never require a driver, service, registry change, default-output change or administrator prompt. Backups and reports can carry native metadata without needing the binary.

Public builds require valid Authenticode signing and a compatible bridge. An incompatible signed binary is still blocked. Show version, signer, trust, discovery source and compatibility in diagnostics; use `blocked-unsigned` rather than silently launching an untrusted component. A future driver uses the Driver Store and Microsoft-compatible signing for its channel.

An unsigned override is restricted to an explicit flag/environment setting in unpackaged development. Label it as development-only, keep it out of normal settings, and ignore it in release builds.

## Scope and removal

Use direct WASAPI endpoint rendering where sufficient. Grouped playback mustn't capture external-app audio, record/persist audio content, change the default output, write registry settings or install a service. Virtual endpoints belong to a separately gated System EQ feature. Refuse unavailable, disabled, duplicate or virtual feedback routes.

Stop, route change, feature disable, app close and crash recovery must release endpoints and leave no bridge running. Uninstall must remove its installed components, startup tasks and processes while preserving libraries, playlists, artwork, profiles, rigs, calibration and backups. Any separately consented System EQ component needs its own cleanup. If routing was changed, restore or clearly offer to restore the previous real output.

## Starting and failing

Require a trusted compatible bridge, at least two available independent members, supported/safely converted source audio, clamped tuning, sanitized diagnostics and a working primary recovery path. Every active endpoint must open independently. If a requirement fails during playback, stop grouped rendering, release endpoints, report the reason and preserve or restore primary playback according to listener intent.

## Reports

Reports can include component/trust state, route, redacted endpoint IDs, labels, rates, channels, periods, latency, drift, glitches, underrun/overrun counters, member controls, profile IDs and calibration confidence. Errors need sanitation too. Do not include local track/artwork/library/account paths, file URLs, recorded content or decoded PCM.

`privacy` must include `pathHidden: true` and `sanitizer: "pixelody-native-mixer-v1"`.

Before release, verify the signed component on a clean Windows machine and test install, disable, close, crash, update, uninstall and rollback. Check normal playback before installation, while disabled, after failure and after removal. Run the physical two-output matrix and recovery from every state. These requirements take precedence over implementation convenience; changing them needs a deliberate new decision.
