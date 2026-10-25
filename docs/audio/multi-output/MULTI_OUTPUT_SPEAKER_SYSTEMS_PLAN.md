# Playing through a speaker rig

I want someone to save their Windows outputs as a rig and tune each member
for the setup they use. That might be desk speakers and towers,
or speakers and headphones, with separate gain, EQ and delay for each output.
If the hardware is all behind one analog connection, though, Pixelody can only
tune that combined output. Windows has to expose separate endpoints before the
app can treat them separately.

The earlier prototype added saved rigs under `pixelody.speakerSystems`, member
controls and calibration assignments in Audio Systems. It reused the existing
output profiles rather than making a second tuning system. Members could be
added, removed and reordered, with trim, mute, solo and delay controls, and the
rig could be included in diagnostics and backups.

Getting sound to two endpoints was the experimental part. Chromium normally
routes one media element to one sink with `setSinkId()`. The browser prototype
used secondary media elements and per-output processing graphs, kept them under
the same playback controls, and watched for drift. That made it possible to work
on the controls and calibration without first building a native mixer, but it
also meant extra decoding, separate clocks and runtime-dependent routing.

The completed prototype tasks didn't establish physical synchronization.
The release checks were still open: at least 30 minutes of two-output playback,
audibly independent EQ and gain, saved delay surviving a restart, and recovery
when an output disappears. Bluetooth needs its own warnings and tests. A rig
failure shouldn't take normal single-output playback with it, and the
mini-player and media keys should keep controlling the same player.

Calibration is for the listening position. Check one output at a time, keep its
software and microphone results attached to that member, then compare the
suggested delays while listening. Physical volume, crossover and DSP controls
are part of the setup; the app can't adjust hardware it doesn't control.

This is separate from Windows-wide System EQ. A rig plays Pixelody's music
through several outputs; System EQ would process audio from other apps. They can
reuse profiles, but selecting a rig doesn't mean Windows audio is being tuned.

For the experimental browser limits, see
[the fan-out decision](MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md). The
[roadmap summary](MULTI_OUTPUT_SPEAKER_SYSTEMS_ROADMAP.md) and
[physical validation notes](MULTI_OUTPUT_PHASE6_PHYSICAL_VALIDATION.md) explain
what still needed hardware checks. This October 24 copy update adds no device results.
