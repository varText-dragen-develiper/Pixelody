# Pixelody Virtual Audio Driver Scaffold

## Scope

This is the design-only starting point for a future `PixelodyVirtualAudio.sys`.
It is not a WDK project, driver binary, INF, catalog, installer, or install path.
No source from Microsoft SysVAD has been copied into this repository.

The first driver has exactly two intended endpoints:

| Direction | Endpoint | Purpose |
| --- | --- | --- |
| Render | `Pixelody Virtual Output` | Windows shared-mode PCM target for apps. |
| Capture | `Pixelody Virtual Monitor` | Paired capture source consumed by the user-mode bridge. |

The machine-readable version of this contract is
`PixelodyVirtualAudio.scaffold.json`. It is checked by
`../../scripts/check-virtual-audio-scaffold.js` so endpoint names cannot drift.

## First Driver Limits

- Stereo only: two channels.
- 48,000 Hz only.
- Shared-mode PCM only.
- No APO and no kernel EQ or other kernel DSP.
- No offload, Bluetooth, keyword detector, sample extras, or automatic default-device change.
- No public installer, package staging, or Driver Store interaction.

## Ownership Boundary

Kernel ownership is deliberately small: expose the two endpoint identities,
advertise the narrow PCM capability, move neutral PCM through a bounded virtual
cable buffer, maintain monotonic stream positions, and issue data-ready /
space-ready notifications. It must not select a physical device, process EQ,
capture user diagnostics, or persist routing.

`Pixelody.SystemAudio.Bridge.exe` owns all user-facing behavior: it captures
`Pixelody Virtual Monitor`, applies future user-mode DSP, selects and renders to
an explicitly chosen real endpoint, measures drift and latency, reports route
truth, and restores a safe state on failure. The bridge must refuse every route
where the real output is either Pixelody virtual endpoint.

## Virtual Cable Contract

The render endpoint's shared-mode Windows audio engine supplies PCM into the
kernel virtual cable. The paired capture endpoint reads that same neutral PCM.
The initial format contract is interleaved stereo PCM at 48 kHz; format
conversion, resampling, and EQ are outside the kernel driver.

The future implementation must use a bounded buffer and must publish a single
monotonic frame-position clock for each stream. Render writes advance the render
position; monitor reads advance the capture position. A full buffer must have a
documented bounded overrun policy, and an empty capture read must have a
documented underrun/silence policy. Neither policy may block a Windows audio
engine thread indefinitely.

Data-ready and space-ready notifications must wake the opposite side without
polling loops. The bridge will calculate latency from negotiated period/buffer
sizes and observed queue depth; it must report degraded state whenever progress,
notifications, or the clock contract cannot be proven.

## Directory Map

- `source/PixelodyVirtualAudio/`: names and compile-blocked driver contract only.
- `package/`: explicitly invalid package metadata placeholders.
- `build/`: VM-only build gate; there is no build project or command.
- `upstream/`: SysVAD provenance, scope, and license notes.

## Build Gate

Do not build this scaffold on a normal workstation. WDK build, test signing,
package staging, endpoint visibility checks, and recovery validation belong only
to the disposable VM workflow in
`../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md`. Item 8's snapshot and rollback
requirements apply before any future package becomes buildable.
