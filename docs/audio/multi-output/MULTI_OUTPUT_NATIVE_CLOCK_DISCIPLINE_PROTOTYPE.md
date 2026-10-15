# Native Endpoint-Clock Discipline Prototype

Status: development-only native mixer component. This is not a resident multi-output renderer, is not wired into normal Pixelody playback, and makes no release-quality synchronization claim.

## Purpose

Independent Windows endpoints have independent hardware clocks. A future native mixer needs one endpoint to define the shared playback timeline and needs every follower to make small, temporary rate corrections instead of accumulating an audible offset. This prototype adds the two reusable pieces required for that path:

- `IAudioClock` endpoint sampling correlated with QPC.
- A bounded asynchronous float-PCM resampler/controller for a follower output.

No calibration value, route selection, Windows default device, registry value, or persistent rig field is changed by this prototype.

## Clock Model

For each endpoint, `EndpointClockModel` keeps up to 96 monotonically advancing `(deviceFrames, qpcPosition)` pairs. It estimates the observed frame rate over the retained window and reports:

```text
driftPpm = (observedFramesPerSecond - nominalSampleRate) / nominalSampleRate * 1,000,000
```

The selected leader defines the timeline. A follower requests a source-frame ratio from the relative leader/follower drift plus a deliberately small buffer-fill correction. A faster follower receives a ratio below one so it consumes the shared source timeline slightly more slowly.

## Correction Bounds

The limits are deliberately conservative until physical measurements prove a different operating range is needed:

| Limit | Value |
| --- | --- |
| Ratio range | `0.9997` to `1.0003` |
| Maximum correction | +/-300 ppm |
| Maximum correction change per observation | 20 ppm |
| Buffer-fill contribution | +/-80 ppm |
| Clock history | 96 samples |

`BoundedAsyncResampler` accepts interleaved float PCM, retains fractional source position across render buffers, and performs linear interpolation only within that ratio range. It reports how many source frames the caller may release while retaining the fractional remainder. Decode, sample-format conversion, channel conversion, buffering, and endpoint ownership remain responsibilities of the future real-time native mixer. The resampler is therefore a component, not evidence that full native fan-out is implemented.

## Explicit Development Labs

The bridge command below opens only the two supplied shared-mode render endpoints for 250 to 3000 ms. It queues silent keep-alive buffers so the endpoint clocks advance; it never renders Pixelody program audio:

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command clock-discipline-lab --dev-allow-clock-discipline --leader-endpoint-id "{leader-endpoint-id}" --follower-endpoint-id "{follower-endpoint-id}" --duration-ms 1000
```

It refuses missing, identical, inactive, fallback, or Pixelody-virtual endpoints. The response includes observed leader/follower clock snapshots, follower correction ppm/ratio/state, silent queued-frame counts, and the fixed resampler limits. A successful observation remains `degraded`, not `active`, because no grouped program source was rendered.

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command clock-discipline-self-test --dev-allow-clock-discipline
```

The self-test opens no endpoints. It validates the estimator, correction bound, slew bound, and float PCM resampler path with synthetic data.

## Separation From Calibration

Saved `member.delayMs` is an intentional acoustic alignment choice established by listening or microphone evidence. Runtime follower correction is transient clock discipline and must stay separate. The next calibration-roadmap task owns the sanitized diagnostics merge that shows both facts without treating either as the other.

That merge is now implemented through the renderer's native-mixer status reducer. It emits a path-hidden `runtimeClock` object only in diagnostics and never persists it with `state.speakerSystems`. When the optional bridge is absent or blocked, the same reducer reports a native availability state without affecting normal playback or the browser prototype.

## Remaining Gate

This component still needs a native real-time source renderer, endpoint buffer and underrun policy, native status merge, and physical wired/Bluetooth validation. Browser fan-out remains the existing guarded experimental path.
