# Browser Fan-Out Decision Record

This decision record covers Pixelody's browser multi-sink prototype for grouped speaker rigs.

## Decision

Browser fan-out is acceptable as an experimental-only engine for two-output grouped playback. It is not acceptable as the release-quality multi-output engine unless future physical measurements prove stable 30-minute sync, tolerable codec overhead, reliable route recovery, and independent per-output tuning across the release matrix.

The current release-quality direction remains a native Windows mixer path if grouped playback needs to ship as a dependable feature rather than an advanced experiment.

## Why

The browser prototype gives Pixelody a useful proof path without drivers, services, registry changes, default-device mutation, or admin prompts. It can reuse the current player state, output profiles, Web Audio EQ, gain trim, delay, polarity, diagnostics, and grouped rig model.

The same design also carries risks that Pixelody cannot honestly hide:

- Each output uses a separate media element or graph, so decode and buffering work can duplicate.
- Media clocks can drift and need corrective nudges.
- `setSinkId()` and `AudioContext.setSinkId()` support varies by runtime.
- Browser-visible device IDs can rotate.
- Bluetooth and wireless endpoints add variable buffering outside Pixelody's control.
- Route fallback can accidentally resolve two members to one physical sink unless guarded.
- Browser fan-out does not provide native shared endpoint clocking, endpoint format control, or WASAPI-level latency facts.

Because of those constraints, browser fan-out should remain behind the existing disabled-by-default experimental flag, hard two-output cap, route guards, recovery path, and stability diagnostics.

## Current Status

Implemented browser-prototype protections:

- Disabled-by-default experimental feature flag.
- Hard two-output prototype cap.
- Guarded arming conditions.
- Unique-route and same-primary fallback blocking.
- Hidden secondary media teardown on route/source/app changes.
- Per-secondary media load/decode diagnostics.
- Drift monitor and correction history.
- Visible stability states: `stable`, `correcting`, `unstable`, `unsupported`.
- Primary-only recovery action.
- Path-hidden diagnostics and copyable calibration reports.

Documented but not physically completed Phase 5 measurements:

- 30-minute wired+wired drift workflow.
- 30-minute wired+Bluetooth drift workflow.
- FLAC/WAV/MP3 CPU and decode-overhead workflow.

## Product Rule

User-facing copy and docs may describe browser fan-out as:

- `experimental`
- `prototype`
- `best-effort`
- `two-output only`
- `browser-routed`

User-facing copy and docs must not describe browser fan-out as:

- `release-ready`
- `native sync`
- `bit-perfect`
- `sample-accurate`
- `driver-grade`
- `guaranteed synchronized`

## Conditions To Keep Browser Fan-Out

Browser fan-out may remain available as an advanced experimental option if real hardware runs show:

- Single-output playback remains unaffected when the feature is disabled.
- Two-output wired+wired playback remains audible for 30 minutes.
- Bluetooth routes keep conservative warnings even if a test run performs well.
- FLAC, WAV, and MP3 overhead remains tolerable on a normal Windows machine.
- Decode/load failures fail closed to normal playback.
- The primary-only recovery button reliably returns to single-output playback.

## Conditions To Promote Beyond Experiment

Do not promote browser fan-out beyond experimental unless all of these are true:

- Physical drift runs pass across the Phase 6 matrix.
- Per-output EQ, trim, delay, mute/solo, polarity, and diagnostics remain independent.
- Route stability stays good through seek, pause/resume, track change, output refresh, unplug/replug, and app restart.
- CPU and decode overhead remains acceptable for common local libraries.
- Bluetooth caveats remain visible and honest.
- Release notes still distinguish browser-routed sync from native mixer sync.

## Native Mixer Trigger

Define or prioritize the native WASAPI mixer contract if any of these happen:

- Wired+wired 30-minute drift is bad or repeatedly borderline.
- Bluetooth behavior is misleading or too unstable even with caveats.
- FLAC/WAV/MP3 overhead makes the app feel heavy.
- Drift correction becomes audible or frequent.
- Users need more than two outputs.
- Users need release-quality grouped playback instead of an advanced experiment.

## Decision Summary

Keep browser fan-out as a guarded experimental prototype. Continue using it to validate the rig model, controls, diagnostics, calibration flow, and measurement process. Treat native WASAPI mixing as the release-quality path unless completed hardware measurements prove the browser route is stable enough for a narrower claim.
