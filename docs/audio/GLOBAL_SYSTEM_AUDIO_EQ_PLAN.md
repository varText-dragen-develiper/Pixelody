# Windows-wide EQ

I want someone to tune their speaker setup once and choose where to use it.
Inside Pixelody, the existing Web Audio path can apply track and output EQ,
ReplayGain, balance, mono and limiting. Processing sound from a browser, game or
another music app is a different problem: that audio has to pass through a
Windows component that Pixelody can actually process.

The development plan settled on a virtual output as the direction for System
Tuning Mode. Other apps would send shared-mode audio to `Pixelody Virtual Output`,
then a native bridge would process it and send it to a separate real output or
speaker rig. That requires a trusted, signed endpoint component and adds latency
and support work. The UI selection and missing/detected endpoint reporting were
foundations for it, not a working Windows-wide EQ release.

The WASAPI loopback prototype was useful for capture diagnostics and checking
the EQ payload. It wasn't a safe shortcut to the same result: playing processed
audio back into the output being captured could duplicate the original or feed
it back through the loop. Processed render remained blocked. A Windows APO or
system effect was another option, left for later because of its installation,
signing and compatibility work.

## What the interface needs to tell you

Playback EQ affects music inside Pixelody. System EQ can affect other apps only
when a supported native route is active. The status needs to say when that route
is off, missing a component, ready but not enabled, unavailable or unsupported.
It also needs to distinguish `In-app only`, `System shared-mode active` and
`Bypassed by exclusive app`.

Exclusive playback, protected audio, ASIO and direct-device paths may bypass
shared-mode processing. A selected profile or an active-looking switch doesn't
establish that those apps are being tuned. Diagnostics need the real output,
engine, sample rate, latency estimate, bypass caveat and applied profile.

The intent is to reuse the output, speaker-member, spatial and calibration data
already used by Player Mode, including trim, balance, mono, polarity and delay.
The engine decides which of those settings it can apply on its route.

## Work that remained

The earlier plan recorded saved mode selection, UI status and native capability
probing. Loopback capture, non-audible EQ analysis and virtual-endpoint reporting
were partial development work. Signed endpoint installation and a processed
render bridge were still missing.

Shipping it also needed feedback prevention, latency and bypass reporting, a
clean off switch, uninstall support and physical checks across built-in audio,
USB DAC, HDMI/DisplayPort, Bluetooth and sample-rate combinations. Normal
Pixelody playback must remain available without an unsigned helper, driver,
service, registry change or background process.

The [virtual-audio roadmap](system-audio/WINDOWS_VIRTUAL_AUDIO_ROADMAP.md) has the
route and component details. Earlier implementation checklists remain in Git
history; this October 22 summary does not establish new system-route results.
