# What a simpler Windows EQ route could do

I want someone to choose their output and correction without having to become the person who wires a virtual cable into a repeater. Pixelody has a narrower job than a general cable utility: receive shared-mode audio, process it, play it through a real output and make recovery understandable.

This is the recorded research direction, not a list of available features or proven novel ideas.

## References from the review

- Microsoft Low Latency Audio: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio
- Microsoft WASAPI overview: https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi
- Microsoft Exclusive-Mode Streams: https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams
- Microsoft Device Formats: https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-formats
- Microsoft IAudioClockAdjustment: https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudioclockadjustment
- Microsoft Hardware-Offloaded Audio Processing: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/hardware-offloaded-audio-processing
- Microsoft SysVAD sample: https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- VAC advanced manual: https://vac.muzychenko.net/en/manual/advanced.htm
- VAC feature list: https://vac.muzychenko.net/en/manual/features.htm
- VB-CABLE product notes: https://vb-audio.com/Cable/

## Put the changeable work in the bridge

VAC's broad compatibility requires format conversion, clock controls, mixing and many client types. For Pixelody, keeping the kernel component close to PCM transport would put EQ, resampling, limiting and diagnostics in user mode, where iteration and failure handling are easier. The driver still needs correct WaveRT clocks, buffers, positions and topology; a small driver can still fail.

A bridge could query the virtual and real mix formats, channel layout and supported periods, choose an internal float format, and explain conversions. Any later format lock needs a stable base route first. EQ and conversion don't support a bit-perfect claim.

Virtual and real outputs have different clocks. Drift handling should stay behind the interface: bounded jitter buffering, rate adjustment where supported, asynchronous resampling otherwise, and buffer slips only as a last resort. Keep counters visible. A single clock strategy won't fit every endpoint.

## Choose policies from measured behavior

Stable, Balanced, Low latency and Studio/dev could expose different buffering/quality tradeoffs. `IAudioClient3` can supply supported periods where available, with appropriate audio scheduling and underrun/overrun/jitter/padding counters. Bluetooth and some USB/HDMI outputs still need conservative settings.

Output profiles could remember a stable period, preferred rate, drift behavior, measured latency and known failures. High-quality SRC costs CPU and latency; dither belongs only where reducing to integer output. A proposed profiler could choose a safe DSP budget, but that needs implementation and hardware results.

## Explain where the signal stopped

Status should distinguish component installed, app audio arriving, capture running, processing, real-output render and recovery availability. A small input/output meter and route self-test could help separate a wrong endpoint from no signal, missing bridge or suspected bypass.

Exclusive, ASIO, protected and direct hardware paths can bypass shared-mode audio, and an app may select its own output. Session metadata can help diagnosis but may be incomplete; no shared-mode route can force every possible app path through Pixelody. Start by letting Windows mix into one virtual endpoint, rather than adding per-client kernel mixing.

A low-level test signal/channel check was proposed for route certification. It would need explicit controls and evidence before becoming a product claim. Likewise, route/session counters could help support without recording content; they aren't a reason to collect audio or unnecessary app history.

## Recovery is part of the route

Keep changing settings, output targets and DSP in the bridge where possible. INF/topology changes still require install/restart handling. A bridge restart or hot swap must account for mute/crossfade and leave the virtual input stable where supported. If it dies while Windows points at the virtual device, offer restoration of the prior real output.

Installation and routing changes need clear consent. Signing, Driver Store packaging, kernel reliability, non-PCM decoding, protected paths and physical Bluetooth latency remain constraints. Rendering back into a captured endpoint is blocked.

The first useful work was one protocol/status vocabulary and a two-endpoint user-mode lab, before driver import. [The roadmap](WINDOWS_VIRTUAL_AUDIO_ROADMAP.md) records how far that foundation went. The proposed format broker, adaptive policies, route proof and counters-only support bundle still need actual implementation and measurements.
