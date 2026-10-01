# Pixelody Audio System Overview

This is the ownership map for Pixelody audio work. Read it with `AUDIO_RELEASE_GATE.md`, `MULTI_OUTPUT_SPEAKER_SYSTEMS_NOTES.md`, and `WINDOWS_VIRTUAL_AUDIO_ROADMAP.md` before changing playback, tuning, output routing, calibration, grouped rigs, or System EQ.

## Product Boundaries

Pixelody currently has three distinct audio layers:

1. **Player Mode** is the release path. It plays local files inside Pixelody and applies the in-app Web Audio graph.
2. **Grouped speaker rigs** are an experimental, disabled-by-default browser fan-out path. The saved model and two-output prototype exist, but physical sync and release validation do not.
3. **System EQ** is a staged native route for audio from other Windows apps. Capability probing, loopback capture, and non-audible EQ analysis exist. Audible processed external-app audio does not.

Never merge these claims in UI or documentation. A working Player Mode profile does not mean System EQ is active, and a saved grouped rig does not mean simultaneous playback is release-ready.

## Authoritative Player Path

There is one primary media element: `#audio`. It owns source loading, decode errors, play/pause, seek, playback rate, current time, duration, ended behavior, queue advancement, session restore, Media Session actions, mini-player state, J.A.M. playback state, and the clock used by experimental secondary outputs.

The audible path is:

```text
local file URL
  -> #audio
  -> MediaElementAudioSourceNode
  -> 3 simple track+system filters
  -> 5 track parametric filters
  -> 5 system parametric filters
  -> ReplayGain + automatic EQ headroom gain
  -> balance / mono matrix
  -> protective limiter
  -> AudioContext destination
  -> selected output via AudioContext.setSinkId()
```

The graph is created once per renderer session. Playback must fail visibly if the graph cannot be created or if a selected non-default sink cannot keep the processed graph routed. Do not add a parallel audible primary `Audio` element: two primary media clocks split seek, ended, errors, calibration, EQ, and state reporting.

## State And Persistence

| Concern | Runtime owner | Persistent key/data |
| --- | --- | --- |
| Current track and primary clock | `state.index`, `#audio` | `pixelody.session` |
| Queue/shuffle/repeat | `state.queue`, `state.flowShuffle`, `state.shuffle`, `state.repeat` | corresponding `pixelody.*` keys |
| Track EQ | `state.tunings` | `aurelia.tunings` |
| Output EQ | `state.systems` keyed by active output id | `aurelia.systems` |
| Balance/mono | `state.spatialProfiles` | `pixelody.spatialProfiles` |
| EQ mode | `eqModes.track/system` | `pixelody.eqModes` |
| Preferred/active output | `outputState` | `pixelody.outputDeviceId`, `pixelody.outputDeviceLabel` |
| Grouped rigs | `state.speakerSystems` | `pixelody.speakerSystems`, `pixelody.activeSpeakerSystemId` |
| Grouped prototype guard | `speakerSystemPrototype` | `pixelody.speakerSystemPrototype` |
| System EQ staging | `systemTuningMode` | `pixelody.systemTuningMode` |
| Last software/mic latency reports | `latencyState`, `micCalibrationState` | `pixelody.lastLatencyReport`, `pixelody.lastMicCalibrationReport` |

Tuning-profile export/import includes track EQ, output EQ, spatial profiles, EQ modes, System EQ staging state, and speaker rigs. Full backup also includes the library, playback collections, queue, history, and appearance. Backup restore deliberately rehydrates artwork metadata rather than trusting cached artwork paths.

## Shared Control Model

Main transport, hero play, mini-player, keyboard controls, Media Session/media keys, queue actions, natural advance, session restore, and permissioned J.A.M. commands converge on `playTrack()`, `toggleCurrentPlayback()`, and `issueSharedPlaybackCommand()`.

New playback controls must use the same command/state path. They must not call a second player, maintain a second primary clock, or advance the queue independently.

## Output Routing And Device Identity

Primary output selection routes the `AudioContext`, not an unprocessed media-element bypass. System Default uses the empty sink id. A selected non-default endpoint requires processed context sink support.

Browser device ids can rotate. Grouped rig members also keep an `outputKey` derived from a meaningful normalized label, with the device id as fallback. Availability is recomputed after output refresh and `devicechange`; missing members stay saved but fail closed.

Test tones and microphone chirps use separate short-lived/generated paths and explicitly route to the selected output. Their success does not prove the music graph, grouped fan-out, or native System EQ route.

Theme/interface sounds also use a separate low-level, limited Web Audio context. Main- and mini-player interface-sound engines receive the active output id and follow that sink, but intentionally do not inherit music ReplayGain or track/output EQ.

## Gain And Tuning Safety

- Simple and parametric gains are clamped to the supported range.
- Positive combined EQ estimates produce an automatic headroom reduction.
- Positive ReplayGain is capped; missing ReplayGain stays `null` and is reported as unity rather than a fake `0.0 dB` tag.
- Balance and mono processing occur before the final limiter.
- The limiter is a protective last stage, not a bit-perfect claim.
- Windows shared mode may resample after Pixelody's graph.
- A/B bypass zeroes track/output tuning and spatial changes but retains the safe processing path.

## Experimental Grouped Rig Path

The browser prototype is hard-capped at two audible members and is off by default. It keeps the primary player as anchor and creates an off-DOM secondary media element for the other member. The secondary is captured into its own Web Audio graph, routed with `AudioContext.setSinkId()`, and fails closed if capture, graph routing, or duplicate-route protection cannot be proven.

Implemented prototype mechanics include per-member profile binding, EQ mode, headroom, track ReplayGain parity, bound balance/mono profile, protective limiting, trim, mute/solo, positive delay, polarity inversion, drift history, playback-rate correction, seek correction, teardown, and diagnostics. This is still experimental because duplicate decoding and independent media clocks can drift, especially with Bluetooth.

## Native Windows Layers

`src/native-wasapi-helper.js` and `native/windows-wasapi-helper/Program.cs` provide optional diagnostics and dev probes. They do not replace Player Mode. The current helper can inspect endpoint format/periods, run bounded default-output loopback capture, receive an EQ payload, and analyze captured float samples without rendering them.

The chosen future System EQ shape is:

```text
external apps
  -> Pixelody Virtual Output
  -> Pixelody Virtual Monitor
  -> Pixelody.SystemAudio.Bridge.exe
  -> user-mode EQ / headroom / limiter / spatial / drift handling
  -> selected real output
```

The driver, bridge, installer, restore/watchdog flow, signing, and audible processed render do not exist yet. Same-output loopback render remains blocked.

## Non-Negotiable Regression Invariants

- Exactly one authoritative primary media element and clock.
- Audible primary playback always traverses the advertised processing graph.
- Sink switching routes the processed graph or reports a visible failure.
- Queue, restore, mini-player, media keys, and J.A.M. commands share playback state.
- Unavailable grouped members and unsafe duplicate routes fail closed without stopping normal single-output playback.
- System EQ never says `active` without virtual input, processing, real-output render, loop prevention, and a live watchdog.
- Normal playback never requires a driver, service, registry edit, admin prompt, or unsigned native executable.
- Diagnostics and shared snapshots must not expose private file paths to remote clients.

Run `npm run check`, `npm run check:audio`, and `npm run check:themes` after relevant changes. Use the bundled Node executable listed in `CHAT_MIGRATION_NOTES_2026-07-15.md` when `npm` is unavailable.

## Open Gaps In Priority Order

### P0 Release Evidence

- Manually validate System Default, built-in, Bluetooth, HDMI/DisplayPort, USB DAC, unplug/replug, pause/resume, seek, natural advance, and active output switching.
- Manually validate common and lossless playback plus AIFF, ALAC/M4A, OGG, Opus, unusual WAV, and unusual FLAC decode failures.
- Verify audible EQ, ReplayGain, bypass, balance, mono, calibration preview, volume, and limiter behavior on physical outputs.
- Verify main/mini/media-key/J.A.M. controls against one shared state while minimized and during output changes.

### P1 Experimental Audio

- Run two-output 30-minute drift/CPU matrices for wired+wired and wired+Bluetooth.
- Add member-isolated calibration, relative delay suggestions, a grouped recovery action, and persistence/sanitation self-tests.
- Decide from measurements whether browser fan-out stays experimental or yields to a native WASAPI mixer.
- Draft and implement the System EQ bridge protocol/state constants before importing driver code.

### P2 Product Expansion

- Gapless playback and configurable crossfade.
- Crash-safe storage instead of synchronous localStorage for large libraries.
- Shared/exclusive-mode indicator and repeatable hardware compatibility log.
- Deeper room correction only after trustworthy member-aware physical measurement exists.

## Audit History

On 2026-07-16, the emergency parallel direct primary element was removed. It had made the unprocessed element audible while the EQ graph remained attached to a muted timing element, so EQ, ReplayGain, spatial controls, limiter behavior, and guided calibration could be reported without affecting heard primary audio. Player Mode now uses the single processed path above. `scripts/check-audio.js` guards this structural invariant.
