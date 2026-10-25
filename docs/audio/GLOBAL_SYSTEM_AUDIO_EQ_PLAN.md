# EQ for other Windows apps

Pixelody can already tune its own music. Applying that tuning to a browser or game needs a Windows route that actually carries the other app's audio. Selecting a profile in Pixelody doesn't create that route.

The plan chose a virtual output: shared-mode apps would play into `Pixelody Virtual Output`, a monitor/capture side would feed the native bridge, and processing would send it to a separate real output or rig. It could reuse output profiles, member trim, balance, mono, polarity, delay and calibration data where the engine supports them.

At the recorded checkpoint, mode selection, status, native capability probing, endpoint reporting, loopback capture and non-audible EQ analysis were development foundations. Signed endpoint installation and an audible processed bridge were still missing.

## Why loopback alone isn't enough

Capturing an output and playing processed audio back into it can duplicate the original or feed it around the loop. The prototype therefore blocked processed same-output render. An APO/system effect was another possibility, left for later because of signing, installation and compatibility work.

A real route needs feedback prevention, a watchdog, a clean off switch and uninstall/restore behavior. Test it with built-in audio, USB DAC, HDMI/DisplayPort, Bluetooth and different sample rates. Ordinary Pixelody playback must remain available without installing a helper, driver, service or registry change.

## What the status should mean

Show whether the route is off, missing a component, ready, unavailable or unsupported. Distinguish `In-app only`, `System shared-mode active` and `Bypassed by exclusive app`. ASIO, protected audio, direct-device and exclusive paths may bypass shared-mode processing.

Diagnostics need the actual engine, real output, sample rate, estimated latency, profile and bypass limits. An active-looking switch is only useful if those facts support it. [The virtual-audio roadmap](system-audio/WINDOWS_VIRTUAL_AUDIO_ROADMAP.md) covers the components.
