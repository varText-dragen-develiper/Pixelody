# Pixelody Audio Release Gate

Pixelody does not ship until the audio path is stable, honest, and conservative on normal Windows systems. Advanced features must fail gracefully and must not require system-wide drivers, registry edits, background services, or exclusive-mode assumptions.

Automated structural guard: `npm run check:audio`. It does not replace the physical output and codec matrices below.

## Required For Release

- [x] Local playback works through Chromium-supported formats.
- [x] Output selection has visible success, fallback, and error status.
- [x] The Web Audio graph is created once per renderer session and reports creation/resume failures.
- [x] Per-track and per-output EQ combine through a capped, headroom-managed gain stage.
- [x] ReplayGain remains capped and is followed by protective limiting.
- [x] Source format, Web Audio engine rate, and Windows shared-output caveat are shown honestly.
- [x] Main player, hero play, mini-player commands, media keys, queue, shuffle, repeat, and restore paths stay on the same playback state.
- [x] Runtime clean restart preserves user music, playlists, artwork, theme, and tuning while clearing transient cache state.
- [ ] Physical output matrix must be manually verified: System Default, built-in speakers, Bluetooth, HDMI/DisplayPort, USB DAC, unplug/replug, pause/resume, seek, and active playback.
- [ ] Unsupported and partially supported codecs need a manual decode-error pass with AIFF, ALAC/M4A, OGG, Opus, unusual WAV, and unusual FLAC files.

## High-Fidelity Layer

- [x] Output-specific correction profiles are persistent.
- [x] System presets provide conservative broad correction.
- [x] Guided calibration wizard previews candidate profiles without saving until confirmed.
- [x] Guided calibration uses the current track, a repeated clip window, output-specific preview state, replay control, saved-profile provenance, and lossy-format restraint.
- [x] EQ slider persistence is debounced to reduce playback-time stutter while tuning.
- [x] Parametric EQ with frequency and Q controls.
- [x] Importable/exportable tuning profiles.
- [x] Headphone and DAC profile library.
- [x] Left/right balance and mono mode.
- [ ] Multi-output speaker systems require independent per-output EQ, gain, delay, diagnostics, and physical sync validation before release.

## Optional Advanced Layer

- [x] Channel and speaker test tones.
- [x] Browser-safe DAC/device diagnostics for selected output, sink support, engine state, device count, test-tone route, and native-helper gate.
- [~] Microphone-assisted acoustic speaker/latency calibration routes chirps through the selected output and falls back from stale mic IDs; physical-device validation and deeper room EQ remain.
- [~] Reliable software/output-path and microphone acoustic latency profiler; physical-device validation remains.
- [~] Native Windows audio helper bridge and diagnostics source, only if it remains signed, optional, and non-invasive; signed bundle and hardware validation remain.
- [~] Windows-wide System Tuning Mode for external app audio requires a signed optional native route, visible bypass/exclusive-mode caveats, latency reporting, a clean off switch, and hardware validation before any release claim; native capability probe, dev loopback prototype, app EQ payload handoff, and non-audible captured-sample EQ analysis exist.
