# Windows-wide EQ: direction and progress

The intended route is `external apps → Pixelody Virtual Output → Pixelody Virtual Monitor → Pixelody.SystemAudio.Bridge.exe → processing → real Windows output`. The driver transports PCM, the bridge owns real-time processing/routing, and Electron controls settings and status. Ordinary playback stays independent of this optional component.

## Recorded foundation

Player EQ, saved System Tuning selection, capability probes, loopback diagnostics and dry-run EQ payloads exist. The app distinguishes missing/detected virtual endpoints and blocks same-output render. Endpoint names, shared status constants, a protocol, bridge-shaped stub responses and renderer branches were established.

A bounded two-endpoint pass-through lab and VM/WDK preparation were also recorded. The narrow SysVAD-derived source/package scaffold is deliberately non-buildable and non-installable. Older headings saying no driver existed refer to a usable driver, not proof that the scaffold builds. There is no public install path or demonstrated resident processed external-app route here.

## Status shared by the components

| State | Meaning |
| --- | --- |
| `off` | System EQ is disabled. |
| `helper-missing` | App cannot reach the native helper. |
| `virtual-endpoint-missing` | `Pixelody Virtual Output` is not installed or not visible. |
| `virtual-input-detected` | Windows/app audio appears routed into the Pixelody virtual output, but the bridge is not processing yet. |
| `bridge-missing` | Virtual endpoint is present, but the bridge binary is unavailable. |
| `bridge-starting` | Bridge launch requested; no route proof yet. |
| `bridge-ready` | Bridge is running and has opened endpoints, but no signal has been proven. |
| `active` | Virtual input signal is captured, processed, and rendered to a real output. |
| `degraded` | Route is active with warnings such as high latency, drift correction, channel fallback, or format conversion. |
| `bypass-suspected` | Expected app audio is not arriving, likely due to exclusive mode, ASIO, protected path, or app-specific routing. |
| `real-output-missing` | Selected real output is unavailable. |
| `loop-risk-blocked` | Selected real output equals or resolves to the Pixelody virtual endpoint. |
| `restore-needed` | Pixelody should offer to restore the previous Windows output. |
| `error` | Bridge, driver, or route failed with a reportable error. |

The app can call a route active only with received virtual frames, running DSP, advancing render on a distinct real endpoint and a current heartbeat. Keep no-signal, missing output, loop risk and restore-needed states visible.

## Work before a release

The first practical test is a WDK-built, test-signed stereo 48 kHz endpoint pair in a disposable VM. It must expose the exact render/capture names, accept a test app's signal, supply capture frames, and uninstall/restart cleanly. No APO, kernel EQ, offload, Bluetooth extras or per-app kernel mixer belongs in that first driver.

With that proven, the bridge can validate neutral pass-through, endpoint identity, capture/render lifetime, watchdog and restore. EQ integration then applies the complete `systemEqNativePayload` atomically: simple/parametric filters, gain, headroom, limiting, balance/mono and a neutral bypass. Compare its DSP with Player Mode rather than silently accepting a mismatch.

Format negotiation, supported periods, jitter buffering and drift correction need long-run built-in/USB/HDMI/Bluetooth checks. Stable, balanced, low-latency and studio-dev policies should follow supported periods and actual glitch history. There is no universal low-latency setting.

The interface needs install, enable, real-output selection, signal verification, disable/restore and diagnostics without requiring someone to read a driver manual. Remember the prior route so a stopped bridge doesn't leave Windows pointing at silence.

Public packaging finally needs the chosen Microsoft signing channel, Driver Store install/uninstall, signed compatible bridge, rollback tests and the physical matrix on a clean machine. Keep reports to configuration, counters and state; don't record audio content. Merely detecting a component doesn't clear any of those checks.

APO/system effects, per-app EQ, wider channel layouts, encoded passthrough, automatic default switching and low-latency claims remain later work. The detailed original sequence is in Git history. Use [the protocol](WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md), [driver research](WINDOWS_VIRTUAL_AUDIO_DRIVER_RESEARCH.md) and [VM instructions](WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md) for the actual interfaces and procedures.
