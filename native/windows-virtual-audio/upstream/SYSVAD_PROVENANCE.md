# SysVAD Provenance and Scope

## Upstream Reference

Pixelody uses the Microsoft Windows Driver Samples SysVAD directory as an
architectural reference only:

- Source: https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- Repository license: https://github.com/microsoft/Windows-driver-samples/blob/main/LICENSE
- License named by the repository: Microsoft Public License (MS-PL).

No SysVAD source files, binaries, INF files, or generated artifacts have been
copied into this repository. This note is not an upstream revision pin. Before
any source is imported, record the exact commit, retain the applicable notices,
and review the then-current license and support implications.

## What Pixelody May Study

- WaveRT adapter and miniport organization.
- Narrow endpoint topology and advertised PCM format patterns.
- Stream position, clock, buffer, and event-notification mechanics.
- Driver package and validation patterns for a VM-only test workflow.

## What the First Pixelody Driver Excludes

- SysVAD APO/sample DSP paths.
- Offload, Bluetooth, USB, keyword detector, tone generator, and sample-device paths.
- Multiple virtual products or broad sample feature sets.
- Any behavior that changes the default Windows audio device.

Any future derived implementation must remain restricted to `Pixelody Virtual
Output` and `Pixelody Virtual Monitor`, stereo 48 kHz shared-mode PCM, and the
kernel/bridge division documented in `../DRIVER_SCAFFOLD.md`.
