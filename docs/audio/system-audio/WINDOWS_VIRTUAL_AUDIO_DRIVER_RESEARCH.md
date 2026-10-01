# Windows Virtual Audio Driver Research

Pixelody's chosen Windows-wide System EQ route is a virtual endpoint:

1. External apps render to `Pixelody Virtual Output`.
2. Pixelody captures that virtual endpoint stream.
3. Pixelody applies the existing output-system EQ, spatial, headroom, limiter, and diagnostics model in user mode.
4. Pixelody renders the processed stream to the selected real Windows output.

APO/system-effect work stays deferred. Loopback capture stays useful for diagnostics, but same-output loopback render is intentionally blocked because it would duplicate or feed back the original Windows audio.

## Source Trail

- Microsoft SysVAD sample: https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- Microsoft WDM audio driver roadmap: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/roadmap-for-developing-wdm-audio-drivers
- Microsoft WaveRT port driver docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/wavert-port-driver
- Microsoft APO architecture docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/audio-processing-object-architecture
- Microsoft driver signing requirements: https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/code-signing-reqs
- Microsoft kernel-mode signing requirements: https://learn.microsoft.com/en-us/windows-hardware/drivers/install/kernel-mode-code-signing-requirements--windows-vista-and-later-
- Microsoft Driver Store docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/install/driver-store
- VB-CABLE public product notes: https://vb-audio.com/Cable/
- Virtual Audio Cable public manual: https://vac.muzychenko.net/en/manual/features.htm

No third-party virtual audio driver was installed during this research. Installing arbitrary audio drivers on the development machine is too invasive for discovery work and can destabilize Windows audio.

## What Other Virtual Cable Drivers Expose Publicly

Commercial virtual cable products generally expose a paired endpoint model:

- A playback/render endpoint that apps send audio into.
- A recording/capture endpoint that another app can read from.
- Optional control-panel settings for cable count, channel count, format limits, buffer/period sizing, clock correction, stream state, and diagnostics.

VB-CABLE describes its device as a Windows audio driver where audio entering the cable input is forwarded to the cable output, with broad compatibility across MME, KS, DirectX, and WASAPI. VAC documents the long tail of features needed once a virtual cable becomes serious: multiple cables, pin instance counts, event periods, Kernel Streaming support, WaveRT notification/packet mode, format conversion, mixing, volume, clock correction, channel remapping, default-device behavior, logs, and support bundles.

Pixelody should not copy product behavior blindly. The useful lesson is that virtual audio looks simple to the user but needs explicit handling for:

- format negotiation,
- clock drift,
- multi-client behavior,
- buffer underrun/overrun,
- Windows default-device changes,
- restart/uninstall behavior,
- diagnostics for "no signal" versus "wrong endpoint",
- user trust around signed installers.

## Microsoft Baseline: SysVAD

SysVAD is the strongest starting point because it is the Microsoft virtual audio device sample. It demonstrates a virtual WDM audio driver with WaveRT render devices and multiple endpoints. The sample's README explicitly frames it as a virtual audio driver rather than hardware-backed adapter, with miniport/topology classes and APO examples.

Important sample concepts for Pixelody:

- `CAdapterCommon`: shared adapter/virtual hardware state.
- `CMiniportTopologySYSVAD`: topology/property handling.
- WaveRT miniport stream objects: stream lifecycle, buffer allocation, notification events, position tracking, mute/volume/peak-meter state.
- APO examples: useful later, but not the first global EQ path.
- INF packaging: driver package includes `.sys`, APO DLLs when used, `.cat`, and INF files.

SysVAD is not product-ready as-is. It is a teaching sample with fake devices and test behavior. Pixelody should fork the architecture, strip it down, and build one narrow virtual cable first.

## Proposed Pixelody Driver Shape

### Kernel Driver

Name: `PixelodyVirtualAudio.sys`

Expose:

- Render endpoint: `Pixelody Virtual Output`
- Capture endpoint: `Pixelody Virtual Monitor`

Responsibilities:

- Present Windows with a normal shared-mode render endpoint.
- Accept PCM audio from external apps.
- Expose the received audio to a paired capture endpoint for the Pixelody bridge.
- Maintain stream position, clock, packet/event notifications, and basic volume/mute/peak properties.
- Avoid DSP in kernel mode except trivial copy/format-safe operations.
- Keep kernel code small, deterministic, and defensive.

Non-responsibilities:

- Do not implement EQ in kernel mode.
- Do not route to real speakers in kernel mode.
- Do not change the user's default output silently.
- Do not run a background service unless System EQ is enabled.

### User-Mode Bridge

Name: `Pixelody.SystemAudio.Bridge.exe`

Responsibilities:

- Capture from `Pixelody Virtual Output`/monitor endpoint.
- Apply Pixelody's system/output tuning model.
- Render processed samples to the selected real endpoint.
- Report latency, sample rate, clock drift, underruns, overruns, and bypass caveats.
- Provide a clean off switch.
- Exit when not needed.

This keeps the dangerous part narrow and puts EQ, limiter, diagnostics, and routing in user mode where failures are less catastrophic.

## Core Audio Pipeline

First full prototype:

```text
External app
  -> Windows shared-mode audio engine
  -> Pixelody Virtual Output render endpoint
  -> Pixelody virtual cable buffer
  -> Pixelody Virtual Monitor capture endpoint
  -> Pixelody.SystemAudio.Bridge.exe
  -> Pixelody EQ/headroom/limiter
  -> WASAPI render client
  -> Real output device
```

The renderer app should remain the control surface. The bridge should be the real-time audio process. The Electron renderer should not carry the global audio stream.

## Format Strategy

Start conservative:

- Stereo only.
- 48 kHz default mix format.
- 32-bit float in user-mode processing.
- Accept 16/24/32-bit PCM only if the driver must expose fixed-point formats.
- Avoid "bit-perfect" claims for System EQ.

Expand later:

- 44.1/48/96/192 kHz.
- 1/2/6/8 channel layouts.
- Channel remapping.
- Per-app or per-mode format policies.

Reasons:

- VAC's public manual calls out format selection, format conversion, multichannel limits, and channel scattering/gathering as real product issues.
- VB-CABLE's Hi-Fi cable notes call out matching sample rates for bit-perfect style routing.
- Pixelody's value is safe correction, not pretending global Windows audio is bit-perfect.

## Clocking And Buffering

The virtual endpoint has no physical hardware clock. That means Pixelody must define timing carefully.

Driver:

- Maintain a monotonic audio clock for the virtual cable.
- Implement WaveRT packet/notification behavior correctly.
- Track render write position and capture read position.
- Report coherent position for the paired endpoints.

Bridge:

- Use event-driven WASAPI where possible.
- Keep a bounded jitter buffer between capture and render.
- Track underruns and overruns separately.
- Apply drift correction if virtual capture rate and real output render rate diverge.
- Prefer tiny resampling/drift smoothing over glitchy hard drops once the stream is live.

First target:

- 10 ms nominal endpoint period.
- 40-80 ms total safety buffer while prototyping.
- Lower latency only after reliability is proven.

## Failure Modes To Design Out Early

- No signal because Windows is still outputting to real speakers instead of `Pixelody Virtual Output`.
- No signal because the bridge is listening to the wrong endpoint.
- Doubled audio because the real output is still receiving original app audio.
- Feedback because the bridge renders back into the virtual endpoint.
- Device switch mid-stream.
- Real output unplug/replug.
- Bluetooth route latency and reconnection.
- Sample rate mismatch.
- Channel count mismatch.
- App uses exclusive mode, ASIO, protected path, or direct hardware route.
- Bridge crash while virtual endpoint remains default output.
- Driver install succeeds but endpoint is hidden, disabled, or not default.
- Driver uninstall leaves default output pointing at a removed endpoint.
- Windows Update or driver signing policy blocks loading.

## Safety Rules For Pixelody

- Never install the driver silently.
- Never require the driver for normal Pixelody playback.
- Always show whether external audio is actually routed through Pixelody.
- Always keep a "restore Windows output" action.
- Detect and block render-to-virtual-endpoint loops.
- Keep the previous real output device id and restore it when System EQ turns off.
- Do not enable System EQ if the selected real output equals the virtual endpoint.
- Keep a watchdog: if the bridge dies, warn and offer to restore output.
- Make uninstall remove the endpoint and restore normal routing.

## Packaging And Signing

Windows kernel audio drivers are normal kernel drivers for signing purposes, even if they are virtual. Microsoft documentation says virtual drivers follow the same requirements as actual hardware drivers. Modern public release requires Microsoft signing through the Hardware Dev Center path. Development can use test signing, but that requires a controlled test machine and may require boot configuration changes.

Release package will need:

- `.sys` kernel driver.
- INF file.
- Catalog file.
- Signed installer or app-managed optional component installer.
- Clean uninstall path.
- Driver Store staging.
- Hardware Lab Kit or attestation path decision.

Development should happen on a VM or second test machine first, not on the user's main workstation.

## Build Plan

### Phase 0: Research Scaffold

- Keep current native helper detection.
- Add `virtualEndpoint` state reporting.
- Keep same-output loopback blocked.
- Document target architecture.

### Phase 1: SysVAD Fork

- Create `native/windows-virtual-audio/`.
- Bring in the minimum SysVAD-derived driver structure.
- Rename devices/classes to Pixelody.
- Strip Bluetooth, keyword detector, sample APOs, offload examples, and nonessential endpoints.
- Build a single render/capture virtual cable.

### Phase 2: Test-Signed Local Driver

- Build with WDK.
- Install only on a VM/test machine with test signing enabled.
- Verify endpoint appears in Windows Sound settings.
- Verify apps can render to `Pixelody Virtual Output`.
- Verify WASAPI capture from the paired monitor endpoint receives signal.
- Verify uninstall removes endpoints and restores output.

### Phase 3: User-Mode Bridge

- Extend current C# helper or create a separate bridge process.
- Capture virtual monitor endpoint.
- Render to selected real endpoint.
- Implement pass-through first, no EQ.
- Add underrun/overrun/latency counters.
- Add loop-prevention and endpoint identity checks.

### Phase 4: EQ Integration

- Reuse `systemEqNativePayload`.
- Port the native EQ processor into the bridge's real-time path.
- Add headroom, master gain, limiter, balance/mono.
- Match in-app simple/parametric behavior closely enough for diagnostics.

### Phase 5: Product UX

- Replace dev controls with:
  - Install System EQ component.
  - Use for Windows audio.
  - Real output target.
  - Restore normal Windows audio.
  - Diagnostics.
- Keep loopback/dev capture under an advanced diagnostics fold.

### Phase 6: Signing/Release

- Decide attestation versus full HLK/WHCP route.
- Get organization signing setup.
- Build installer/uninstaller.
- Validate on built-in audio, USB DAC, HDMI/DisplayPort, Bluetooth, and sample-rate changes.

## Immediate Next Engineering Tasks

1. Create `native/windows-virtual-audio/README.md` with the intended driver contract.
2. Decide whether to vendor a narrow SysVAD fork or add it as a separate upstream-tracked source import.
3. Add an app status state: "System EQ component not installed" distinct from "native helper missing".
4. Design the bridge process protocol before driver code: commands, status JSON, endpoint ids, tuning payload, watchdog heartbeat.
5. Build in a VM/test-machine workflow before any local installation path exists.
