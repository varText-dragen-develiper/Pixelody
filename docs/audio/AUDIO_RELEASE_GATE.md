# Checking audio before release

Use `npm run check:audio` for the graph and command structure, then listen on the outputs being supported. The source check can't tell you whether a DAC actually played the processed signal.

The current path has one graph per renderer session, visible route/creation/resume failures, capped combined EQ and ReplayGain, headroom and limiting. Main transport, hero, mini-player, media keys, queue, repeat, shuffle and restore share playback state. A clean restart should keep music, playlists, artwork, theme and tuning while clearing transient cache.

## Physical checks

Try System Default, built-in speakers, USB DAC, Bluetooth and HDMI/DisplayPort. Switch outputs while playing and paused, unplug/reconnect, seek and let tracks advance. Compare source format, engine rate and Windows shared-mode output reporting.

Try normal supported files and failures involving AIFF, ALAC/M4A, OGG, Opus and unusual WAV/FLAC. Check audible track/output EQ, ReplayGain, bypass, balance, mono, volume and limiting. A decode or route failure needs a useful way to recover without losing the library.

The tuning tools include saved output profiles, conservative presets, parametric frequency/Q controls, profile import/export, headphone/DAC profiles and a calibration wizard. The wizard previews the current track in a repeatable clip, lets someone replay it, records profile provenance and saves only after confirmation. Slider writes are debounced. Verify those behaviors in the artifact being released.

## Additional audio routes

Speaker/channel tones and browser-safe endpoint diagnostics exist. Microphone chirps use the selected output and recover from stale microphone IDs, but physical latency/calibration results need device evidence. Deeper room EQ isn't established by those tools.

Grouped playback still needs independent per-output tuning and thirty-minute physical sync/recovery tests. An optional native helper needs signing, packaging and hardware checks. Windows-wide System Tuning also needs a safe processed route, bypass/latency reporting and an off switch; capability probes, loopback capture, EQ payloads and non-audible analysis don't clear that requirement.

Normal playback must remain usable without system-wide drivers, services, registry changes or exclusive output. Keep the result tied to the build and hardware you actually checked.
