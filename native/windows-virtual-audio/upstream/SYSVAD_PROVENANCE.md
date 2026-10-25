# SysVAD reference and provenance

## Upstream source

The Microsoft SysVAD directory is an architectural reference:

- Source: https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- Repository license: https://github.com/microsoft/Windows-driver-samples/blob/main/LICENSE
- License named by the repository: Microsoft Public License (MS-PL).

No SysVAD source, binaries, INFs or generated files are included. Before importing
anything, pin the exact revision, retain its notices and review the applicable
license/support terms. The moving main-branch URL is a reference, not a source pin.

## Relevant sample structures

- WaveRT adapter and miniport organization.
- Narrow endpoint topology and advertised PCM format patterns.
- Stream position, clock, buffer, and event-notification mechanics.
- Driver package and validation patterns for a VM-only test workflow.

## Excluded from the first driver

- SysVAD APO/sample DSP paths.
- Offload, Bluetooth, USB, keyword detector, tone generator, and sample-device paths.
- Multiple virtual products or broad sample feature sets.
- Any behavior that changes the default Windows audio device.

Any future derived implementation must remain restricted to `Pixelody Virtual
Output` and `Pixelody Virtual Monitor`, stereo 48 kHz shared-mode PCM, and the
kernel/bridge division documented in `../DRIVER_SCAFFOLD.md`.
