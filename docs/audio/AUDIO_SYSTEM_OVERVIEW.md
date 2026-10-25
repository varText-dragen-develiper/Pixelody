# Audio in Pixelody

Ordinary playback uses the renderer's Web Audio graph. Grouped speakers and Windows-wide EQ have separate experimental/native work behind them; neither becomes available just because an output profile is saved. Read this with [the release checks](AUDIO_RELEASE_GATE.md) before changing playback or routing.

## The music path

`#audio` owns loading, decoding, time, duration, play/pause, seeking, rate, ended behavior and queue advance. Restore, media keys, mini-player and J.A.M. state follow that same player. Main transport, hero play and permissioned remote commands converge on `playTrack()`, `toggleCurrentPlayback()` and `issueSharedPlaybackCommand()`.

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

Create this graph once per renderer session. If it can't be created or a non-default sink can't keep it routed, show the failure. A second audible primary element would split the clock and bypass the controls people think they're hearing. That happened before July 16, 2026, when an emergency direct element played while the processed element was muted. `scripts/check-audio.js` guards against bringing that path back.

## Saved audio settings

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

Tuning exports include track/output EQ, spatial profiles, EQ modes, System EQ staging and rigs. Full backups also carry the library, collections, queue, history and appearance. Restore rebuilds artwork metadata instead of trusting cached paths.

## Routing and processing

Output selection routes the `AudioContext`; it mustn't fall back to an unprocessed media element. System Default is the empty sink ID. Non-default outputs require processed-context sink support. Device IDs can rotate, so rig members keep an `outputKey` from a normalized meaningful label, falling back to the ID. Refresh/device-change handling updates availability without deleting missing members.

Combined EQ is clamped and gets automatic headroom. Positive ReplayGain is capped; a missing tag stays `null` and uses unity gain. Balance/mono come before the limiter. A/B bypass removes tuning and spatial changes but keeps the safe processing route. Windows shared mode may resample after the graph, so this isn't a bit-perfect path.

Test tones and microphone chirps have short-lived selected-output routes. Interface sounds use a separate limited context in the main and mini windows. They follow the output ID but don't inherit track EQ or ReplayGain. Hearing a chirp doesn't prove the music graph or a grouped/native route works.

## Grouped outputs

The browser prototype is off by default and capped at two audible members. The primary player anchors an off-DOM secondary element with its own captured graph and sink. Capture/routing failures and duplicate routes block it. Members have bound EQ/spatial profiles, headroom, ReplayGain, limiting, trim, mute/solo, positive delay and polarity, with drift history, rate/seek corrections and teardown.

Separate decoders and clocks can drift, especially over Bluetooth. The open hardware work includes thirty-minute wired/wired and wired/Bluetooth runs, codec overhead, audible independent tuning, saved-delay restore and recovery to one output. [The browser decision](multi-output/MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md) explains why this remains experimental.

## Windows-wide EQ

`src/native-wasapi-helper.js` and `native/windows-wasapi-helper/Program.cs` provide endpoint probes, bounded loopback capture and non-audible EQ analysis. They don't replace Player Mode. The intended future route is:

`external apps → Pixelody Virtual Output → Pixelody Virtual Monitor → Pixelody.SystemAudio.Bridge.exe → user-mode processing → real output`.

A signed endpoint/installer, processed render, loop prevention and restore/watchdog behavior still need their own implementation and validation. Same-output loopback render is blocked. Normal listening must keep working without a driver, service, registry edit, administrator prompt or unsigned helper.

For a release, test the actual output/codec matrix, audible tuning and main/mini/media-key/J.A.M. commands. Gapless/crossfade, deeper room correction and native output work have their own scope. The older audit's browser-storage concern has since moved to [the durable file store](../architecture/DURABLE_STATE_AND_RECOVERY.md). Support/shared snapshots must continue to hide local paths.
