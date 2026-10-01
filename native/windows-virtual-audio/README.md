# Pixelody Windows Virtual Audio Endpoint

This folder is reserved for Pixelody's optional Windows-wide System EQ endpoint.

The driver/component must remain optional. Normal Pixelody playback, imports, playlists, metadata, in-app EQ, and themes must work without this component installed.

Detailed roadmap: `../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_ROADMAP.md`

Bridge control/status contract: `../../docs/audio/system-audio/WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md`

VM-only WDK and recovery runbook: `../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md`

Driver scaffold and ownership contract: `DRIVER_SCAFFOLD.md`

## Target User Flow

1. User enables System EQ in Pixelody.
2. Pixelody offers to install a signed optional component.
3. Windows exposes `Pixelody Virtual Output`.
4. External apps render to `Pixelody Virtual Output`.
5. Pixelody captures the paired virtual monitor stream.
6. Pixelody processes audio in user mode.
7. Pixelody renders to the selected real output.
8. Turning System EQ off restores normal Windows output routing.

## Endpoint Contract

Playback endpoint:

- Name: `Pixelody Virtual Output`
- Role: Windows shared-mode render target for external apps.
- Behavior: accepts PCM audio from Windows apps and feeds a paired virtual monitor/capture path.

Capture/monitor endpoint:

- Name: `Pixelody Virtual Monitor`
- Role: user-mode bridge capture source.
- Behavior: exposes the audio rendered into `Pixelody Virtual Output`.

Real output:

- Selected in Pixelody.
- Must not be the Pixelody virtual endpoint.
- Receives processed audio from the user-mode bridge through WASAPI render.

## Architecture

```text
External app
  -> Pixelody Virtual Output
  -> virtual cable buffer
  -> Pixelody Virtual Monitor
  -> Pixelody.SystemAudio.Bridge.exe
  -> EQ/headroom/limiter/spatial
  -> selected real Windows output
```

## Development Baseline

Use Microsoft SysVAD as the architectural reference:

https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad

Initial implementation should be a narrow SysVAD-derived virtual cable, not a broad sample-port:

- one render endpoint,
- one capture/monitor endpoint,
- stereo 48 kHz first,
- no APO,
- no Bluetooth/offload/keyword examples,
- minimal kernel-mode logic,
- real DSP in user mode.

## Current Scaffold Status

This directory contains a contract-first source scaffold only. It does not contain
SysVAD source, a WDK project, a `PixelodyVirtualAudio.sys` binary, a valid INF, or
a catalog. Nothing here can install a driver or change Windows audio routing.

The upstream reference and license obligations are recorded in
`upstream/SYSVAD_PROVENANCE.md`. Any future source import must be separately
reviewed, pinned to a specific upstream revision, and carry the required notices.
Do not treat the current `main` branch URL as a source pin.

## Non-Negotiable Safety Rules

- Do not silently install the driver.
- Do not silently change Windows default output.
- Do not render processed audio back into `Pixelody Virtual Output`.
- Do not leave Windows default output pointing to a removed endpoint after uninstall.
- Do not require test signing on a normal user machine.
- Do not claim external-app EQ is active unless the virtual endpoint is installed, selected, captured, processed, and rendered to a real output.

## First Engineering Gate

WDK build validation is allowed only through the VM workflow in
`../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md`. This scaffold deliberately
does not provide a build command. When a future VM-only build exists, it must
test only this narrow contract:

- WDK installed.
- Test signing enabled only on that test environment.
- Driver can install/uninstall cleanly.
- Endpoint appears in Windows Sound settings.
- WASAPI capture can read audio from the paired monitor endpoint.
- Pixelody can restore normal audio routing after stop/uninstall.
