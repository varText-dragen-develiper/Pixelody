# Pixelody WASAPI Helper

Optional Windows-only diagnostics and development-probe helper for Pixelody.

## Policy

- Diagnostics and explicit development probes only.
- No driver.
- No background service.
- No registry edits.
- No default-device changes.
- No production playback engine changes.
- No exclusive-mode playback.
- Must be Authenticode-signed before the Electron app will run it by default.
- Unsigned local diagnostics/probing can use the `dev-publish` helper in an unpackaged development run. The bounded loopback capture prototype still requires `PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV=1`.

The helper reports Windows render-endpoint facts that Chromium/Electron cannot expose directly, such as endpoint mix format and WASAPI device periods. It can also run a bounded development-only WASAPI loopback capture prototype. Pixelody still plays through the existing Electron/Web Audio path, and the prototype does not render processed audio back to the speaker route.

## Build

```powershell
dotnet publish native/windows-wasapi-helper/Pixelody.Wasapi.Helper.csproj -c Release
```

The expected development output path is:

```text
native/windows-wasapi-helper/bin/Release/net8.0-windows/win-x64/publish/Pixelody.Wasapi.Helper.exe
```

For production packaging, place the signed executable at:

```text
resources/native/Pixelody.Wasapi.Helper.exe
```

For local testing, `PIXELODY_WASAPI_HELPER` may point at the executable. The Electron launcher still blocks unsigned helpers.

For local unsigned diagnostics/probing, publish the helper:

```powershell
dotnet publish native/windows-wasapi-helper/Pixelody.Wasapi.Helper.csproj -c Release
```

For the bounded dev loopback capture prototype, use all of these conditions:

```powershell
$env:PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV='1'
# launch the unpackaged Electron app from this same shell
```

Or use the workspace helper script:

```powershell
.\scripts\launch-system-eq-dev.ps1
```

The helper is considered missing until the executable exists at the publish path above, or `PIXELODY_WASAPI_HELPER` points to an existing executable.

## Contract

Pixelody invokes:

```powershell
Pixelody.Wasapi.Helper.exe --json --diagnose --output-label "Device name" --sink-id "default"
Pixelody.Wasapi.Helper.exe --json --probe --output-label "Device name" --sink-id "default"
Pixelody.Wasapi.Helper.exe --json --loopback-prototype --dev-allow-loopback-prototype --duration-ms 1000
```

The helper writes one JSON object to stdout and exits. It must not prompt, stay resident, write files, or mutate system audio state.

The loopback prototype is intentionally capture-only. It proves that the default shared-mode render stream can be initialized and sampled, then reports packet/frame counts. Feedback prevention and processed render output are separate release gates.
