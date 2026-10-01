# Windows Virtual Audio Roadmap

This roadmap turns the System EQ research into an implementation path for Pixelody's own optional Windows virtual audio endpoint.

The goal is not to build a generic virtual cable. The goal is a trusted Pixelody route:

```text
External apps
  -> Pixelody Virtual Output
  -> Pixelody Virtual Monitor
  -> Pixelody.SystemAudio.Bridge.exe
  -> Pixelody output tuning / EQ / headroom / limiter
  -> selected real Windows output
```

Normal Pixelody playback must keep working without this component. The global route is optional, signed, uninstallable, diagnosable, and honest about bypass states.

## Current Truth

Implemented foundation:

- Player Mode EQ works inside Pixelody.
- System Tuning Mode has persisted app state and settings UI.
- Native WASAPI helper can probe the default endpoint.
- Loopback diagnostics can capture packets and dry-run the EQ payload.
- Same-output render is blocked because it would duplicate or feed back the original Windows audio.
- The app now prefers the virtual endpoint route and reports when `Pixelody Virtual Output` is missing or merely detected.

Not implemented yet:

- A Pixelody virtual audio driver.
- A paired `Pixelody Virtual Monitor` capture endpoint.
- A real-time bridge process.
- Audible processed external-app audio.
- Driver installer, uninstaller, signing, restore flow, or hardware validation.

## Canonical Contract

Names:

- Driver: `PixelodyVirtualAudio.sys`
- Render endpoint: `Pixelody Virtual Output`
- Capture endpoint: `Pixelody Virtual Monitor`
- Bridge process: `Pixelody.SystemAudio.Bridge.exe`

Ownership:

- Kernel driver exposes endpoints and transports PCM.
- Bridge captures, processes, renders, measures, and reports.
- Electron app controls settings, status, restore actions, and diagnostics.

Non-goals for the first driver:

- No kernel EQ.
- No APO.
- No per-app kernel mixer.
- No silent install.
- No silent default-device takeover.
- No claim of bit-perfect System EQ.

## Route State Vocabulary

Use these shared state names across renderer, helper, bridge, logs, and support bundles.

| State | Meaning |
| --- | --- |
| `off` | System EQ is disabled. |
| `helper-missing` | App cannot reach the native helper. |
| `virtual-endpoint-missing` | `Pixelody Virtual Output` is not installed or not visible. |
| `virtual-input-detected` | Windows/app audio appears routed into the Pixelody virtual output, but the bridge is not processing yet. |
| `bridge-missing` | Virtual endpoint is present, but the bridge binary is unavailable. |
| `bridge-starting` | Bridge launch requested; no route proof yet. |
| `bridge-ready` | Bridge is running and has opened endpoints, but no signal has been proven. |
| `active` | Virtual input signal is captured, processed, and rendered to a real output. |
| `degraded` | Route is active with warnings such as high latency, drift correction, channel fallback, or format conversion. |
| `bypass-suspected` | Expected app audio is not arriving, likely due to exclusive mode, ASIO, protected path, or app-specific routing. |
| `real-output-missing` | Selected real output is unavailable. |
| `loop-risk-blocked` | Selected real output equals or resolves to the Pixelody virtual endpoint. |
| `restore-needed` | Pixelody should offer to restore the previous Windows output. |
| `error` | Bridge, driver, or route failed with a reportable error. |

## Strategic Bets

### Minimal Kernel, Smart Bridge

Keep `PixelodyVirtualAudio.sys` narrow: endpoints, buffer movement, stream position, clock, notification behavior, volume/mute/peak properties. Put EQ, limiter, format conversion, drift handling, diagnostics, watchdogs, and output routing in user mode.

### Route Proof Before Route Promise

The UI should only say global System EQ is active after Pixelody has proof:

- virtual endpoint is present,
- audio is routed into it,
- bridge capture is receiving frames,
- processing is running,
- real output render is open,
- real output is not the virtual endpoint,
- watchdog heartbeat is current.

### Format Broker

Pixelody should choose sane defaults instead of asking users to understand sample-rate plumbing. The bridge should query virtual input format, real output mix format, supported periods, channel layout, and output constraints, then report any conversions honestly.

### Adaptive Drift Governor

Treat clock drift as expected. The bridge should estimate drift between virtual input and real output, then choose the least audible correction available: none, tiny render-rate adjustment where supported, high-quality asynchronous resampling, or controlled buffer slip as a last resort.

### Safety-First Restore

Turning System EQ off or losing the bridge must not strand the user on a dead virtual output. Pixelody should remember the previous real output and offer a restore action whenever the route is unhealthy.

## Phase 0: Contract Lock

Purpose: make the project speak one language before driver code grows.

Deliverables:

- Canonical endpoint names in docs and helper output.
- Shared route-state vocabulary.
- Explicit bridge/driver/app ownership model.
- "No audible external-app EQ yet" language preserved everywhere.

Exit gate:

- A new contributor can read the research, audit, and roadmap and know the next implementation target without guessing.

Primary risks:

- Terminology drift between `Virtual Monitor`, `Processed Monitor`, helper JSON, and future INF strings.
- Accidentally updating shipped feature checklists before implementation exists.

## Phase 1: Bridge Protocol Draft

Purpose: define the user-mode bridge before writing kernel code.

Deliverables:

- Bridge command schema:
  - `probe`
  - `start`
  - `stop`
  - `setTuning`
  - `setOutput`
  - `setLatencyPolicy`
  - `restore`
  - `status`
  - Contract: `WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md`.
- Bridge status schema:
  - route state,
  - virtual endpoint id/name,
  - real output id/name,
  - sample rate,
  - channel count,
  - period size,
  - input frames,
  - output frames,
  - underruns,
  - overruns,
  - drift ppm,
  - latency estimate,
  - watchdog heartbeat,
  - last error.
- Decision on process model:
  - extend current helper for prototypes,
  - split long-running bridge into a separate binary before real-time audio.

Exit gate:

- Renderer and native side can exchange bridge-shaped JSON even when the bridge is stubbed.

Primary risks:

- Letting Electron renderer code become the real-time audio engine.
- Adding driver work before the app can understand driver/bridge states.

## Phase 2: User-Mode Audio Lab

Purpose: prove the bridge mechanics with existing endpoints before installing any driver.

Deliverables:

- A native lab path that opens two distinct WASAPI endpoints.
- Capture from one endpoint and render to another, pass-through only.
- Hard block if capture and render resolve to the same endpoint.
- Latency counters and glitch counters.
- Manual/dev-only command surface.

Exit gate:

- Pass-through works on a controlled two-device route without feedback.
- Route counters are stable enough to trust.

Primary risks:

- Testing with only one output device hides feedback and clocking problems.
- Bluetooth and HDMI may make early latency measurements look worse than the bridge actually is.

## Phase 3: SysVAD-Derived Driver Skeleton

Purpose: create a narrow Pixelody virtual endpoint from the Microsoft SysVAD architecture.

Deliverables:

- `native/windows-virtual-audio/` contains the driver source scaffold.
- INF names expose only:
  - `Pixelody Virtual Output`
  - `Pixelody Virtual Monitor`
- Stereo 48 kHz first.
- No APO, offload, Bluetooth, keyword detector, or sample extras.
- Build instructions for WDK and VM-only testing.

Exit gate:

- Driver package builds on a configured WDK machine.
- No install path exists in the public app.

Primary risks:

- Bringing too much SysVAD sample surface into the product.
- Debugging INF/topology issues on the main workstation instead of a VM.

## Phase 4: VM Test-Signed Endpoint

Purpose: prove that Windows sees the Pixelody endpoints and apps can render into them.

Deliverables:

- VM/test-machine install instructions.
- Test signing limited to the test environment.
- Endpoint appears in Windows Sound settings.
- App can select or route to `Pixelody Virtual Output`.
- WASAPI capture can read from `Pixelody Virtual Monitor`.
- Uninstall removes endpoints and leaves Windows audio usable.

Exit gate:

- A non-Pixelody app can play into `Pixelody Virtual Output`.
- A dev capture tool sees nonzero frames from `Pixelody Virtual Monitor`.
- Uninstall and restart tests pass in the VM.

Primary risks:

- Driver loads but endpoint topology is wrong.
- Endpoint appears but capture side is silent.
- Uninstall leaves stale default-device state.

## Phase 5: Bridge Pass-Through

Purpose: connect the virtual endpoint to a real output without EQ.

Deliverables:

- Bridge captures from `Pixelody Virtual Monitor`.
- Bridge renders pass-through audio to selected real output.
- Output cannot be the Pixelody virtual endpoint.
- Bridge reports latency, format, counters, and route state.
- Pixelody app can start, stop, and observe the route.

Exit gate:

- External app audio is audible through the bridge on the VM/test machine.
- Stopping the bridge mutes/restores predictably.
- Route status distinguishes no signal, wrong endpoint, bridge failure, and real output unavailable.

Primary risks:

- Clock drift creates crackles after a few minutes.
- Stop/start creates stuck endpoint sessions.
- User cannot recover if the bridge dies while virtual output is default.

## Phase 6: EQ And Tuning Integration

Purpose: make System EQ use Pixelody's actual output tuning model.

Deliverables:

- Bridge accepts `systemEqNativePayload`.
- Simple EQ and parametric EQ match app behavior closely enough for diagnostics.
- Headroom, master gain, limiter, balance, mono, and output profile data apply in the bridge.
- App shows whether active tuning is Player Mode only or System EQ active.
- A/B bypass remains available without rerouting Windows.

Exit gate:

- External-app audio audibly changes with Pixelody's System EQ profile.
- Gain-risk diagnostics match the active bridge route.
- Bypass returns processed audio to neutral without killing the route.

Primary risks:

- DSP mismatch between renderer and bridge causes confusing comparisons.
- Heavy processing creates glitches under low-latency settings.

## Phase 7: Format, Latency, And Drift Hardening

Purpose: turn pass-through into a reliable route across real devices.

Deliverables:

- Format broker with route policies:
  - `stable`
  - `balanced`
  - `low-latency`
  - `studio-dev`
- Supported-period probing where available.
- Drift estimator.
- Drift correction strategy.
- Jitter buffer metrics.
- Channel-order and level self-test.
- Diagnostics bundle with counters only, no recorded audio.

Exit gate:

- Built-in audio, USB DAC, HDMI/DisplayPort, and Bluetooth have documented behavior.
- Long-play tests do not drift into glitches on supported routes.
- Pixelody reports conversion, latency, and warnings clearly.

Primary risks:

- A universal low-latency target will fail across hardware.
- Bluetooth behavior may require conservative defaults and explicit warnings.

## Phase 8: Product UX And Recovery

Purpose: make System EQ usable by a non-developer without hiding the truth.

Deliverables:

- Install System EQ component.
- Use for Windows audio.
- Select real output.
- Restore normal Windows audio.
- Route self-test.
- Live input/output meters.
- Copy diagnostics.
- Clear states for missing component, wrong endpoint, bypass suspected, degraded, and active.

Exit gate:

- User can enable, verify, disable, and recover without reading docs.
- Pixelody never claims global EQ when only in-app EQ is active.

Primary risks:

- Too much raw driver language leaks into the UI.
- A failed route feels like broken Windows audio instead of a recoverable Pixelody state.

## Phase 9: Packaging, Signing, And Release Gate

Purpose: move from development driver to releasable optional component.

Deliverables:

- Signing path decision: attestation versus full HLK/WHCP route.
- Installer stages the driver package through the Driver Store.
- Uninstaller restores output and removes component cleanly.
- Bridge binary is signed.
- App verifies component version and compatibility.
- Release support bundle excludes audio content.

Exit gate:

- Signed component installs on a clean non-dev Windows machine.
- Uninstall and rollback tests pass.
- Manual hardware matrix passes.
- Legal/support notes are ready.

Primary risks:

- Signing or Driver Store requirements change release sequencing.
- Installer failure can damage user trust faster than any audio bug.

## First Implementation Batch

Do these next, before importing driver source:

1. [x] Normalize endpoint names everywhere to `Pixelody Virtual Output` and `Pixelody Virtual Monitor`.
2. [x] Add a bridge protocol draft document with request/response JSON.
3. [x] Add route-state constants shared by renderer and native-helper reports.
4. [x] Extend the native helper probe to report `bridge-missing` separately from `virtual-endpoint-missing`.
5. [x] Add a dev-only bridge stub command that returns bridge-shaped status.
6. [x] Add a renderer status branch for `bridge-missing`, `bridge-ready`, `active`, `degraded`, and `restore-needed`.
7. [x] Build a two-endpoint WASAPI pass-through lab before any driver install path.
8. [x] Prepare a VM-only WDK setup note.
9. [x] Scaffold the narrow SysVAD-derived driver only after the bridge state machine is visible in the app. The source and package scaffold is intentionally non-buildable and non-installable; WDK validation remains VM-only.

## Hold For Later

These are valuable, but not first-driver work:

- APO/system effect.
- Per-app EQ.
- Multi-client kernel mixing.
- Multichannel output beyond stereo.
- Non-PCM encoded passthrough.
- Public installer.
- Automatic default-device switching.
- Low-latency marketing claims.

## Release Principle

The feature is not "global EQ" until external app audio is routed into Pixelody, processed by Pixelody, rendered to a real output, and recoverable when something fails. Until then, every UI and document should call it a staged System EQ route, virtual endpoint prototype, or diagnostics path.
