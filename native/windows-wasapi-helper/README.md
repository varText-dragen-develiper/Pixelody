# WASAPI diagnostic helper

The optional helper reports Windows endpoint formats and periods that the browser cannot expose. It also has explicit bounded capture probes. Playback remains on Electron/Web Audio.

## Scope

- Diagnostics and explicit development probes only.
- No driver.
- No background service.
- No registry edits.
- No default-device changes.
- No production playback engine changes.
- No exclusive-mode playback.
- Must be Authenticode-signed before the Electron app will run it by default.
- Unsigned local diagnostics/probing can use the `dev-publish` helper in an unpackaged development run. The bounded loopback capture prototype still requires `PIXELODY_ALLOW_UNSIGNED_WASAPI_DEV=1`.

The loopback probe captures only; it never sends processed audio back into the captured output.

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

## Invocation

Pixelody invokes:

```powershell
Pixelody.Wasapi.Helper.exe --json --diagnose --output-label "Device name" --sink-id "default"
Pixelody.Wasapi.Helper.exe --json --probe --output-label "Device name" --sink-id "default"
Pixelody.Wasapi.Helper.exe --json --loopback-prototype --dev-allow-loopback-prototype --duration-ms 1000
```

The helper writes one JSON object to stdout and exits. It must not prompt, stay resident, write files, or mutate system audio state.

A successful capture reports initialized shared-mode packets/frames. Feedback-safe processed render still needs its own implementation and release checks.
