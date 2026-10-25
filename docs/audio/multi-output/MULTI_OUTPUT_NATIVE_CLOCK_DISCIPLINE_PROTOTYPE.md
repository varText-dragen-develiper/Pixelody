# Testing endpoint-clock correction

This development component samples `IAudioClock` against QPC and tests a bounded float-PCM follower resampler. It isn't a resident mixer, doesn't play program audio and isn't connected to normal playback. It changes no saved calibration, route, default device, registry value or rig field.

Independent endpoints have independent clocks. A leader defines the timeline; a follower uses relative drift and a small buffer-fill correction to choose its temporary source-frame ratio. A faster follower gets a ratio below one.

`EndpointClockModel` retains up to 96 monotonically advancing frame/QPC pairs. Its estimate is:

```text
driftPpm = (observedFramesPerSecond - nominalSampleRate) / nominalSampleRate * 1,000,000
```

| Limit | Value |
| --- | --- |
| Ratio range | `0.9997` to `1.0003` |
| Maximum correction | +/-300 ppm |
| Maximum correction change per observation | 20 ppm |
| Buffer-fill contribution | +/-80 ppm |
| Clock history | 96 samples |

`BoundedAsyncResampler` uses interleaved float PCM and linear interpolation within those bounds, retaining fractional position across buffers and reporting releasable source frames. Decoding, format/channel conversion, buffers and endpoint ownership still belong to a future real-time renderer.

## Running the labs

The endpoint lab opens only the two supplied shared-mode outputs for 250–3000 ms and queues silence to advance their clocks:

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command clock-discipline-lab --dev-allow-clock-discipline --leader-endpoint-id "{leader-endpoint-id}" --follower-endpoint-id "{follower-endpoint-id}" --duration-ms 1000
```

Missing, identical, inactive, fallback and Pixelody-virtual endpoints are refused. Results include clock snapshots, ppm/ratio/state, silent queued frames and fixed limits. A successful observation remains `degraded` because no grouped music was rendered.

The synthetic self-test opens no endpoints:

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command clock-discipline-self-test --dev-allow-clock-discipline
```

It checks estimation, correction/slew limits and resampling. The renderer reducer can merge the lab's path-hidden `runtimeClock` into diagnostics, but never saves it with `state.speakerSystems`. Saved `member.delayMs` remains acoustic alignment. A missing/blocked bridge shouldn't affect ordinary playback or browser fan-out.

A real source renderer, buffer/underrun handling and wired/Bluetooth physical validation are still needed before making synchronization claims.
