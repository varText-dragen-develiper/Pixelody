# Finding problems in the Windows app

This audit grew out of playback, routing, storage and rendering problems. Some checks below were already covered in code; others still needed a real Windows session. It isn't a fresh assessment of every build.

Start with the part that owns the problem: Electron lifecycle, dialogs and metadata in `src/main.js`; playback and UI coordination in `src/renderer.js`; its bridge in `src/preload.js`; and mini-player commands in `src/mini-player.js`. The theme registry is `src/themes/built-in-themes.json`. Stylesheet order in `src/index.html` ends with `src/playback-performance.css`.

## What the audit changed

The app gained development build stamps and cache diagnostics, persistent output choices, device-change handling, and a distinction between the requested and actual route. Graph creation and resume failures became visible. Combined EQ got conservative headroom, and tuning writes were debounced. Calibration added selected-output chirps, speaker/channel tones, stale-microphone recovery and device diagnostics. Native helpers stayed off unless a measurement required one.

Performance conservation pauses expensive decoration without replaying entry animations when it returns to full. Pointer and scroll effects use animation-frame scheduling and stop with motion off. Large-library persistence stopped duplicating the library into synchronous browser storage, and playback heartbeats moved from 5 to 30 seconds without reserializing library-scale values. Row rendering work also changed over time; inspect the current virtualizer rather than treating an earlier incremental-rendering result as today's implementation.

## Checks that need a real session

Playback, data loss and an unusable interface take priority. Test these on a separate profile so a failed check doesn't damage an existing library:

- Import known-good FLAC, WAV and MP3, then try unsupported or unusual AIFF, ALAC/M4A, OGG, Opus, WAV and FLAC files. Decode failures need to be understandable and leave the library intact.
- Try play, pause, seek, natural advance, queue edits, shuffle, repeat and restore. Check ReplayGain with positive, negative, missing and malformed tags, plus audible track/output EQ, bypass and limiting.
- Switch among System Default, built-in audio, USB DAC, Bluetooth and HDMI/DisplayPort while playing, paused and seeking. Unplug and reconnect a device. Check 44.1 kHz content through a 48 kHz shared-mode endpoint without describing it as bit-perfect.
- Open the mini-player, minimize and restore the main window, use media keys, then close the main window. Track, artwork, progress, theme and play state should agree; no hidden window should keep unwanted playback alive.
- Import from local, removable, network and synced folders, including spaces and non-ASCII paths. Missing files must retain metadata and playlist membership. Test interruption during metadata hydration and a backup restore over an existing library.
- Check keyboard shortcuts while typing, high DPI, mixed-DPI monitors, narrow windows, large artwork, missing artwork and custom backgrounds. Inspect every released presentation with motion off, OS reduced motion, active playback and conserve mode.

For scaling, compare 100, 1,000, 5,000 and 10,000 tracks: startup, search, sorting, scrolling and track changes. Watch import concurrency, repeated artwork work, layout reads and full-window filters. The renderer should reduce decoration before it affects audio or input; 16 ms per frame is the ordinary desktop budget to investigate, not a guarantee on every machine.

## Keeping a result useful

Record the build, profile, device route, source format and Windows rate with each hardware result. Keep DAC/Bluetooth/HDMI compatibility results together. Screenshots need a full quit and reopen after development CSS changes so stale assets don't become evidence.

For a source change, verify sender checks on state-changing IPC, bounded mini-player broadcasts, app shutdown, file-drop conversion and import cancellation/progress where implemented. Follow [durable-state rules](DURABLE_STATE_AND_RECOVERY.md) for saved keys and [audio checks](../audio/AUDIO_RELEASE_GATE.md) for the processed path. Grouped output and Windows-wide EQ have additional gates; ordinary playback passing doesn't clear them.
