# Pixelody Backbone Audit Checklist

This checklist is for finding the places where Pixelody's main function can be weakened by the platform underneath it: Electron, Chromium media playback, Windows audio routing, DAC handoff, local storage, IPC, graphics, CSS, themes, and asset loading.

Use it when playback feels unreliable, theme animation looks stale or slow, output devices behave strangely, large libraries feel heavy, or main-window and mini-player state disagree.

## Current Architecture Touchpoints

- Electron lifecycle, cache policy, windows, dialogs, metadata, artwork previews, and mini-player creation: `src/main.js`.
- Renderer state, local library, playback, Web Audio graph, output device selection, themes, settings, frame-health monitor, and Media Session handlers: `src/renderer.js`.
- Safe renderer bridge and file URL conversion: `src/preload.js`.
- Mini-player receive/render/command loop: `src/mini-player.js`.
- Main CSS cascade: `src/index.html`, ending with `src/playback-performance.css`.
- Built-in theme map and manifests: `src/themes/built-in-themes.json` and `src/themes/*.theme.json`.

## Priority Key

- P0: Can break playback, output routing, data integrity, or make the app unusable.
- P1: Can cause stutter, stale UI, wrong state, excessive resource use, or confusing audio reporting.
- P2: Quality, maintainability, or test coverage issue that should be handled before major theme/audio expansion.
- [~]: A practical guardrail exists, but manual/device testing or broader architecture work remains.

## Audit Progress

- Code guardrails added: development runtime stamping, cache diagnostics, output-device persistence, output-device change watching, actual-versus-preferred output routing, output error reporting, diagnostics copyout, performance-conserve trigger reasons, pause-based conserve animation handling that does not replay row/view entry animations when performance returns to full, audio graph creation/resume diagnostics, conservative EQ headroom, debounced tuning persistence, guided output-system listening calibration, routed speaker/channel test tones, selected-output microphone calibration chirps, stale microphone fallback, browser-safe DAC/device diagnostics, and a native-helper gate that stays off unless a future measurement requires it.
- Still requires physical/manual testing: DAC unplug/replug, Bluetooth/HDMI/USB output behavior, Windows shared-mode sample-rate combinations, media keys, large-library stress, and every-theme playback/motion inspection.

## App Lifecycle And Cache

- [x] P0 Confirm development cache busting runs before the main and mini-player windows load.
- [x] P1 Verify full app quit closes the mini-player and clears stale renderer resources on the next dev launch.
- [x] P1 Add a visible or loggable dev build identifier so screenshots and animation checks prove which code is running.
- [x] P1 Check whether `file://` CSS, image, font, and script loads are all refreshed after CSS edits.
- [x] P2 Document the difference between development cache policy and packaged cache policy.
- [x] P2 Add a one-command local launch path that uses the same Electron startup flags every time.

## Windows Audio And DAC Routing

- [ ] P0 Test output selection with System Default, built-in speakers, Bluetooth, HDMI/DisplayPort, USB DAC, and unplugged/replugged DAC.
- [x] P0 Verify `audio.setSinkId()` success and failure paths show useful status instead of silently falling back.
- [x] P0 Re-check output after app restart; selected system tuning should still match the intended output device.
- [ ] P0 Test device changes while music is actively playing, paused, and seeking.
- [x] P1 Add `navigator.mediaDevices.ondevicechange` handling so the output list updates when a DAC appears or disappears.
- [x] P1 Confirm device labels are available only after permission and that permission prompts do not interrupt first-run use.
- [x] P1 Make the UI explicitly separate source format, Web Audio engine sample rate, and Windows shared-mode output reality.
- [ ] P1 Test Windows sample-rate mismatch cases, such as 44.1 kHz source through a 48 kHz shared-mode device.
- [ ] P1 Track whether Bluetooth devices add latency or pause/resume errors that should be surfaced differently.
- [ ] P1 Design and validate multi-output speaker-system routing before allowing simultaneous speakers/headphones playback.
- [~] P1 Define and validate optional Windows-wide System Tuning Mode before claiming Pixelody can EQ audio from other apps; planning, status foundation, native capability probe, app EQ payload handoff, dev loopback capture, and non-audible native EQ sample processing exist, processed native route remains.
- [x] P2 Add browser-safe DAC/device diagnostics for selected output, sink support, device labels, engine state, and native-helper status.
- [ ] P2 Create a small compatibility table for tested DACs and Windows output types.

## Audio Graph Integrity

- [x] P0 Verify the Web Audio graph is created only once per renderer session and reconnects cleanly after play/pause/track changes.
- [x] P0 Confirm `AudioContext.resume()` happens after a user action and failure paths are visible.
- [ ] P0 Test unsupported or partially supported codecs, especially AIFF, ALAC/M4A, OGG, Opus, and unusual WAV/FLAC files.
- [x] P1 Check that per-track EQ plus per-system EQ sum correctly and cannot unexpectedly overdrive the graph.
- [ ] P1 Verify ReplayGain handling with negative, positive, missing, and malformed tags.
- [x] P1 Confirm the limiter is protective but not misleadingly advertised as bit-perfect playback.
- [ ] P1 Test volume, seek, pause, resume, next, previous, shuffle, repeat-one, and natural track advance through the graph.
- [ ] P1 Measure whether metadata hydration or artwork optimization can block first playback.
- [x] P2 Add lightweight diagnostics for `AudioContext.sampleRate`, current sink ID, decode errors, current track format, and active EQ values.

## Import, Metadata, And Storage

- [ ] P0 Test imported files from local disk, OneDrive, network shares, external USB drives, and paths with spaces/non-ASCII characters.
- [ ] P0 Verify missing-file detection is clear and does not delete user metadata or playlist membership.
- [ ] P0 Confirm backups preserve playlists, tuning, history, queue, appearance, and intentional user metadata behavior.
- [ ] P1 Audit localStorage size growth with large libraries; consider IndexedDB or a file-backed store before scale becomes painful.
- [~] P1 Check synchronous `localStorage.setItem()` calls during playback for stutter risk; EQ tuning persistence is debounced. The ~24-key synchronous `localStorage` write in `persist()` (including the full library array on every debounced tick) has been removed entirely — the durable file-backed store was already duplicating it. That store's playback-heartbeat and settings-change writes no longer re-serialize library-scale data either, and the playback-position heartbeat interval was raised from 5s to 30s to cut the standing atomic-write frequency during any playback session. Track-list DOM cost (virtualization) and a possible deeper storage-engine change remain — see items 5-6 of that plan.
- [ ] P1 Verify metadata hydration worker concurrency does not saturate disk, OneDrive sync, or the renderer event loop.
- [ ] P1 Confirm artwork extraction and preview generation cap image size and avoid re-processing already optimized art.
- [ ] P1 Test drag/drop path extraction through `webUtils.getPathForFile()`.
- [ ] P2 Add import progress and cancellation for large folder scans.
- [ ] P2 Add an explicit data migration plan for legacy `aurelia.*` storage keys.

## Main Window, Mini-Player, And IPC

- [ ] P0 Verify main-window playback commands from the mini-player work while minimized, restored, and after focus changes.
- [ ] P0 Ensure closing the main window closes the mini-player without leaving audio or hidden renderer state behind.
- [ ] P1 Confirm mini-player receives the latest state immediately when opened.
- [ ] P1 Test mini-player theme, artwork, progress, quality, play/pause, and performance-mode parity with the main player.
- [ ] P1 Confirm IPC senders are validated for state-changing channels.
- [ ] P1 Keep player state broadcasts throttled enough to avoid IPC spam while preserving smooth progress display.
- [ ] P2 Add a debug command or log line for last sent mini-player state when diagnosing sync bugs.

## Renderer Speed And Layout Cost

- [ ] P0 During playback, confirm the frame-health monitor enters `data-performance="conserve"` when long tasks or slow frames recur.
- [x] P0 Verify conserve mode removes decorative cost without hiding playback controls, metadata, queue, settings, tuning, or replaying one-shot track/view entry animations.
- [ ] P1 Profile large libraries, because `renderTracks()` rebuilds the visible track HTML and playlist rendering can grow with library size.
- [ ] P1 Test 100, 1,000, 5,000, and 10,000 track libraries for first paint, search, sort, scroll, and track change.
- [ ] P1 Check whether EQ canvas redraws, `getComputedStyle()`, and device-pixel-ratio scaling are cheap enough during theme changes and resize.
- [ ] P1 Audit full-window backdrop blur, large shadows, filters, masks, and animated pseudo-elements for GPU cost.
- [x] P1 Confirm all pointermove/scroll theme effects are requestAnimationFrame-throttled and disabled or static when motion is off.
- [x] P1 Consider track-list virtualization before adding more artwork-heavy row states. Rows are materialized on demand near the viewport and refreshed in place.
- [ ] P2 Add a manual render budget note: playback theme animations should stay below 16 ms/frame on a normal desktop and degrade before audio is affected.

## Themes, Colors, Assets, And Motion

- [ ] P0 Confirm every theme keeps play, queue, settings, search, systems, inspector, track editor, and mini-player readable.
- [ ] P0 Test every theme with `data-motion="off"` and with OS reduced-motion enabled.
- [ ] P0 Test every theme while playback is active and while `data-performance="conserve"` is active.
- [ ] P1 Verify the CSS cascade order in `index.html` still ends with `playback-performance.css`.
- [ ] P1 Keep theme CSS scoped to `body[data-theme="..."]` unless a shared rule is intentional.
- [ ] P1 Check palette tokens for readable contrast: base, surfaces, text, muted text, line, primary accent, secondary accent, and state.
- [ ] P1 Verify custom colors do not break controls, progress bars, metadata, or mini-player accent.
- [ ] P1 Audit bundled fonts and artwork for licensing and `THIRD_PARTY_ASSETS.md` coverage.
- [ ] P1 Test theme action overlays for short duration, no layout shift, and no stale animation classes.
- [ ] P2 Keep theme manifest intent aligned with runtime CSS, mini CSS, and `built-in-themes.json`.

## Windows And Hardware Integration

- [ ] P0 Test media keys through `navigator.mediaSession` for play, pause, previous, next, seek, and lock-screen metadata.
- [ ] P1 Verify keyboard shortcuts do not fire while typing in inputs, search, settings, or track editor.
- [ ] P1 Test high DPI scaling, mixed-DPI monitors, narrow desktop width, and moving the app between monitors.
- [ ] P1 Check GPU acceleration behavior on integrated graphics, discrete graphics, and battery saver mode.
- [ ] P1 Verify always-on-top mini-player behavior with full-screen apps, taskbar positions, and multiple monitors.
- [x] P2 Consider a diagnostics pane for OS, Electron, Chromium, audio engine sample rate, selected sink, renderer FPS/conserve mode, and storage size.

## Manual Audit Matrix

- [ ] P0 Fresh launch with empty library, then import a small known-good FLAC/WAV/MP3 set.
- [ ] P0 Launch with an existing library, active queue, prior session, selected theme, selected motion setting, and mini-player closed.
- [ ] P0 Launch, open mini-player, minimize main window, change tracks from mini-player, restore main window.
- [ ] P0 Switch outputs before playback, during playback, while paused, and after unplug/replug.
- [ ] P1 Switch through Studio, Graphite Loadout, Frosted Void, Dead Signal, Meme Machine, Cartridge Quest, and Poster Pop during playback.
- [ ] P1 Test motion off, calm, expressive, and OS reduced-motion.
- [ ] P1 Test large artwork, missing artwork, custom artwork, playlist background, and embedded artwork.
- [ ] P1 Test large folder import, app restart during metadata hydration, and backup/export/import.
- [ ] P2 Capture screenshots or short clips for theme animation checks only after a full app quit and reopen.

## Likely Follow-Up Fixes

- [x] P0 Add output-device change handling and persistence that survives DAC unplug/replug without confusing the selected system tuning.
- [x] P0 Add a diagnostics surface for audio output, engine sample rate, sink status, decode errors, cache mode, and renderer conserve mode.
- [~] P1 Move large-library state away from synchronous localStorage before library size becomes the next bottleneck. The redundant synchronous `localStorage` write of the library array is gone; the durable file-backed `PixelodyStateStore` is the sole write path for it now. Remaining: track-list DOM virtualization (item 5) and, only if still needed after that, moving off a single-JSON-blob storage model (item 6).
- [~] P1 Add track-list virtualization and incremental rendering for large libraries. Rows are materialized incrementally as the list scrolls, with a spacer for the rest; once materialized they stay, so a list scrolled to the end of a very large library still holds every row.
- [x] P1 Add explicit dev/runtime version stamping so visual QA cannot accidentally inspect stale CSS.
- [x] P1 Expand performance conservation to include theme-specific expensive selectors, not only shared decorative layers.
- [ ] P2 Add a repeatable hardware test log for Windows devices, DACs, Bluetooth, HDMI, and sample-rate combinations.
- [x] P2 Add non-invasive speaker/channel test tones for left, right, both, bass, and sweep checks.

## Done Criteria For A Backbone Pass

- Playback starts, pauses, seeks, advances, and survives output changes across the manual matrix.
- The app reports source quality and engine behavior honestly without implying exclusive bit-perfect output.
- Main player and mini-player agree on track, progress, theme, motion, artwork, and play state.
- Development CSS and animation checks are reproducible after a full app quit and reopen.
- Expensive theme visuals degrade before audio or input responsiveness does.
- Large-library, large-artwork, and missing-file scenarios remain understandable and recoverable.
