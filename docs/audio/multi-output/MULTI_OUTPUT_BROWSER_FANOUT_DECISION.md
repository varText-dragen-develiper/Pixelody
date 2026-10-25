# Keeping browser fan-out experimental

The browser prototype is useful for testing a two-output rig without installing a driver or service. It reuses the player, output profiles, EQ, trim, delay, polarity, calibration and diagnostics. It stays off by default, capped at two outputs, with route guards and recovery to primary playback.

Separate media elements can duplicate decoding and buffering, and their clocks can drift. Sink support varies by runtime, device IDs rotate, and Bluetooth adds variable buffering. Two apparently different routes can also resolve to one endpoint. The browser doesn't supply native endpoint clocking, format control or WASAPI latency facts.

## What exists and what still needs measurement

Arming checks, duplicate/same-primary blocking, secondary teardown, load/decode reporting, drift history, primary recovery and path-hidden calibration reports are implemented. Stability is reported as `stable`, `correcting`, `unstable` or `unsupported`.

The Phase 5 wired/wired and wired/Bluetooth thirty-minute workflows and FLAC/WAV/MP3 overhead comparison were documented, not physically completed at this checkpoint. A successful browser lab doesn't replace them.

Keep the option only while normal playback remains unaffected, failures return safely to one output, common-codec overhead is tolerable and real two-output runs remain usable. Bluetooth warnings remain even after a good run. Promotion beyond an experiment also needs independent EQ, trim, delay, mute/solo and polarity, plus recovery across pause, seek, track change, refresh, unplug and restart. Use the full [physical matrix](MULTI_OUTPUT_PHASE6_PHYSICAL_VALIDATION.md).

If drift is repeatedly borderline, corrections become audible, overhead is too high, routes remain misleading, or more than two outputs are needed, prioritize the [native mixer](MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md). That remains the direction for dependable grouped playback unless hardware measurements support a narrower browser claim.

Describe the current path as experimental, browser-routed, best-effort and two-output only. Claims of native sync, sample accuracy, bit-perfect or guaranteed synchronization aren't supported.
