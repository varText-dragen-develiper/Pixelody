# Research behind the virtual audio route

The recorded direction for Windows-wide EQ is a small virtual endpoint paired with a user-mode bridge. Other apps send shared-mode audio to `Pixelody Virtual Output`; `Pixelody Virtual Monitor` exposes it to `Pixelody.SystemAudio.Bridge.exe`, which processes it and renders to a separate real output. Same-output loopback render stays blocked because it can duplicate or feed back the original sound. APO/system-effect work is deferred.

## References used

- Microsoft SysVAD sample: https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- Microsoft WDM audio driver roadmap: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/roadmap-for-developing-wdm-audio-drivers
- Microsoft WaveRT port driver docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/wavert-port-driver
- Microsoft APO architecture docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/audio-processing-object-architecture
- Microsoft driver signing requirements: https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/code-signing-reqs
- Microsoft kernel-mode signing requirements: https://learn.microsoft.com/en-us/windows-hardware/drivers/install/kernel-mode-code-signing-requirements--windows-vista-and-later-
- Microsoft Driver Store docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/install/driver-store
- VB-CABLE public product notes: https://vb-audio.com/Cable/
- Virtual Audio Cable public manual: https://vac.muzychenko.net/en/manual/features.htm

No third-party driver was installed for this research. Product descriptions here are references from that review, not a fresh compatibility assessment.

## What the samples and cable products contribute

VB-CABLE's paired render/capture model makes the route easy to picture. VAC's format, channel, pin, period, clock and recovery controls show how much sits behind that simple connection. Pixelody still needs explicit negotiation, multi-client behavior, clocking, underrun/overrun handling, no-signal diagnosis and trusted installation.

Microsoft's SysVAD provides the WDM/WaveRT starting architecture: `CAdapterCommon` for shared adapter state, `CMiniportTopologySYSVAD` for topology/properties, and stream objects for buffers, events, position, mute/volume and peaks. It is a sample with fake/test behavior, not a finished driver. A first fork should remove extra endpoints, APO examples, offload, Bluetooth and keyword-detection pieces.

## Keeping the kernel part small

`PixelodyVirtualAudio.sys` should expose one render and one capture endpoint, transport PCM, maintain coherent clocks/positions and support required WaveRT notifications and basic properties. EQ, limiting, spatial processing, conversion, routing and diagnostics belong in the bridge. It mustn't route real speakers or change the default output from kernel mode.

The Electron app controls the route; it doesn't carry the real-time stream. Start with stereo, a 48 kHz mix and float user-mode processing. Fixed-point 16/24/32-bit formats can be added where needed. Wider rates/layouts and channel remapping come later. System EQ applies processing and isn't a bit-perfect route.

A virtual endpoint has no DAC clock. The driver needs coherent render/capture positions; the bridge needs bounded buffering, separate underrun/overrun counters and correction between virtual and real clocks. The prototype target was a 10 ms nominal period and 40–80 ms safety buffer. Lower latency needs measurements, not a smaller default chosen for its label.

## Problems to test explicitly

Distinguish no app signal, wrong capture endpoint, doubled audio and a feedback route. Test unplug, output switch, Bluetooth reconnect, rate/channel mismatch, hidden/disabled endpoints and a bridge crash while the virtual output is selected. Exclusive, ASIO, protected and direct-device paths may bypass it. Stop/uninstall must leave a clear way back to the prior real output.

Normal playback remains independent. Never silently install the component or switch defaults, and never enable render into either virtual endpoint. Keep the prior real route, watchdog state and restore action available.

## From scaffold to a usable component

The research called for a narrow source scaffold, then WDK builds and test-signed endpoint validation in a disposable VM. After endpoint capture works, a bridge can first prove neutral pass-through and only then integrate `systemEqNativePayload`, headroom, gain, limiting and spatial controls. UI should expose install/use/output/restore/diagnostics rather than raw driver controls.

Public distribution needs the appropriate Microsoft signing path, INF/catalog/driver package, Driver Store installation, signed bridge/installer and clean removal. These are requirements recorded by the plan, not completed release work. Follow the current Microsoft references when choosing a toolchain or signing channel. Use [the VM runbook](WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md) and [the roadmap](WINDOWS_VIRTUAL_AUDIO_ROADMAP.md); ordinary Pixelody must never install this scaffold.
