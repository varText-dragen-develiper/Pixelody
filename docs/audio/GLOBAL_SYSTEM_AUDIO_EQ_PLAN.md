# Global System Audio EQ Plan

Pixelody has two audio responsibilities:

1. **Player Mode**: audio played inside Pixelody.
2. **System Tuning Mode**: optional Windows-wide tuning for audio played outside Pixelody.

Player Mode can use the current Electron/Web Audio path. System Tuning Mode cannot be solved by renderer code alone. Applying EQ to Spotify, browsers, games, video players, and other apps requires a Windows audio integration layer that sits in the system playback path.

## Product Goal

The user should be able to tune a speaker setup once, then choose whether that setup affects:

- Pixelody playback only.
- Windows shared-mode playback from other apps.
- A future grouped speaker system with multiple outputs.

The UI must always state what is actually active. Pixelody should never imply that outside-app audio is tuned when Windows or another app is bypassing Pixelody.

## Honest Constraints

- Electron/Web Audio only affects media routed through Pixelody.
- Global EQ needs an optional native Windows layer, virtual endpoint, or system audio effect.
- Apps using exclusive mode, protected/DRM playback, ASIO, or direct device paths may bypass shared-mode tuning.
- Any native component must stay optional, signed, uninstallable, and non-invasive.
- No unsigned helper, driver, service, registry mutation, or background process should be required for normal Pixelody playback.
- Latency, device changes, Bluetooth routes, and sample-rate conversion must be reported honestly.

## Architecture Options

### 1. In-App Audio Graph

Status: current foundation.

- Processes Pixelody playback only.
- Uses existing track EQ, output EQ, parametric EQ, ReplayGain, balance, mono, limiter, and diagnostics.
- Lowest release risk.
- Does not affect external apps.

### 2. WASAPI Loopback Bridge

Status: diagnostics and fallback prototype only.

- Captures Windows shared-mode output with WASAPI loopback.
- Applies Pixelody tuning in a native processing path.
- Renders the processed stream to the selected real output.
- Can reuse latency diagnostics, device profiles, and multi-output planning.
- Requires careful feedback prevention, exclusive-mode detection, latency reporting, and user opt-in.
- May not capture protected or exclusive-mode audio.

This remains useful for diagnostics, EQ payload verification, and capture analysis, but same-output render is blocked because it would duplicate or feed back the original Windows audio.

### 3. Virtual Audio Endpoint

Status: chosen System Tuning Mode direction.

- Pixelody installs or integrates with a virtual output device.
- Other apps route audio to `Pixelody Virtual Output`.
- Pixelody processes that stream and sends it to the real output or speaker system.
- Flexible for multi-output systems.
- Adds latency and requires a signed driver or trusted virtual-device component.
- Higher support burden than a diagnostics-only native helper.

This is the true global EQ shape for Pixelody: external apps send audio into the Pixelody virtual endpoint, Pixelody applies the same output-system tuning model, and Pixelody renders the processed stream to the selected real Windows output. The first integration gate is detecting whether Windows shared-mode audio is currently routed into `Pixelody Virtual Output`; the next gate is a signed virtual endpoint component plus a native bridge that opens a separate real render endpoint.

### 4. Windows APO / System Effect

Status: deferred release-grade option.

- Installs as a Windows audio processing object or system effect.
- Most natural shared-mode global EQ behavior.
- Potentially low latency.
- Most sensitive packaging, signing, compatibility, and Windows policy surface.
- Must have a clean installer, uninstaller, device compatibility matrix, and explicit bypass states before release.

## Shared Data Model

System Tuning Mode should reuse the same tuning objects as Player Mode:

- Output device profile.
- Simple EQ and advanced parametric EQ.
- Headphone/DAC profile.
- Speaker-system member profile.
- Gain trim, balance, mono, polarity, and delay.
- Latency profiler report.
- Microphone-assisted acoustic calibration report.
- Calibration provenance and user notes.

The stored tuning should be mode-agnostic. The active engine decides whether it can apply the profile inside Pixelody, through a native bridge, or through a future Windows system component.

## UI Model

Add a clear split in the audio settings:

- **Playback EQ**: affects Pixelody playback.
- **System EQ**: affects external Windows audio when a supported native route is active.

System EQ needs visible states:

- `Off`.
- `In-app only`.
- `Ready, not enabled`.
- `System shared-mode active`.
- `Bypassed by exclusive app`.
- `Device unavailable`.
- `Native component missing`.
- `Unsupported route`.

The UI should make copying diagnostics easy and should include the selected output, engine, sample rate, latency estimate, bypass caveat, and active tuning profile.

## Release Checklist

- [x] Add a persisted System Tuning Mode setting separate from Playback EQ.
- [x] Add UI status that says whether tuning is Player Mode only or Windows-wide.
- [x] Add native-helper capability probing for loopback capture, shared render-client preflight, render endpoint, exclusive-mode conflict, and device format.
- [~] Add a developer-only WASAPI loopback bridge prototype before any public global EQ claim; packet/frame capture, app EQ payload handoff, shared render preflight, same-output route blocking, and non-audible captured-sample EQ processing analysis exist, processed render remains gated.
- [~] Integrate Virtual Endpoint as the preferred System EQ engine; app state, UI selection, native status payloads, and missing/detected virtual endpoint reporting exist, signed endpoint installation and processed render bridge remain.
- [ ] Add feedback prevention so Pixelody does not capture and reprocess its own rendered stream.
- [ ] Add latency reporting and warnings for every system route.
- [ ] Add bypass detection or a conservative bypass warning for exclusive/protected/direct-device apps.
- [ ] Reuse existing output profiles and calibration reports for System EQ.
- [ ] Add a clean off switch that restores normal Windows audio routing.
- [ ] Require a signed, optional, uninstallable native component before release.
- [ ] Validate on built-in output, USB DAC, HDMI/DisplayPort, Bluetooth, and multiple sample-rate combinations.

## Recommended Build Order

See `WINDOWS_VIRTUAL_AUDIO_ROADMAP.md` for the detailed virtual endpoint roadmap, route-state vocabulary, and release gates.

1. Add System EQ data and UI status as a disabled foundation.
2. Extend the native helper to report system audio capabilities without changing routing.
3. Use loopback diagnostics to validate capture and EQ payloads, but do not render to the same captured endpoint.
4. Build or integrate a signed `Pixelody Virtual Output` endpoint and detect it as the Windows shared-mode input.
5. Render processed virtual-endpoint audio to the selected real output through a native bridge with latency reporting and a clean off switch.
6. Reuse the latency profiler and mic calibration to measure the full system route.
7. Save APO/system effect work for later if the virtual endpoint path is not enough for release quality.
8. Only ship Windows-wide EQ after signing, uninstall, manual hardware validation, and bypass reporting are complete.
