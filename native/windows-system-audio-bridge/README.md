# Pixelody System Audio Bridge

This is the future user-mode audio process for Pixelody System EQ. It is deliberately separate from `Pixelody.Wasapi.Helper.exe`: the helper stays short-lived and diagnostic; the bridge will own real-time capture, processing, rendering, watchdogs, and recovery.

The current executable provides protocol/status plus explicitly requested,
time-bounded development labs. It is not a resident real-time bridge, does not
change Windows settings, and needs no driver installation. Its virtual-route lab
fails closed before opening streams unless the exact VM-installed endpoints are
present.

## Build

```powershell
dotnet build native/windows-system-audio-bridge/Pixelody.SystemAudio.Bridge.csproj -c Release
```

The development executable is framework-dependent so it builds without fetching
runtime packs. The future signed installer decides the final self-contained
packaging strategy.

## Commands

```powershell
Pixelody.SystemAudio.Bridge.exe --json --protocol
Pixelody.SystemAudio.Bridge.exe --json --status
Pixelody.SystemAudio.Bridge.exe --json --command probe
Pixelody.SystemAudio.Bridge.exe --json --command clock-discipline-self-test --dev-allow-clock-discipline
```

Each returns the v1 bridge-shaped JSON status object. `probe` is read-only and lists active render endpoints with their exact IDs and shared mix formats. The definitive control/status contract is in `../../docs/audio/system-audio/WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md`.

## Dev Pass-Through Lab

The lab is the only command that opens audio streams. It stays disabled unless all of the following are supplied:

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command pass-through-lab --dev-allow-pass-through --capture-endpoint-id "{capture-endpoint-id}" --render-endpoint-id "{render-endpoint-id}" --duration-ms 1000
```

The two endpoint IDs must be explicitly copied from `probe`, must be different, must not be named `Pixelody Virtual ...`, and must report the same shared mix format. The bounded range is 250 to 3000 ms. The laboratory never changes the Windows default device, installs a component, writes the registry, selects a fallback device, uses exclusive mode, or keeps running after the request ends.

It is neutral PCM pass-through only. It reports frame counters, capture discontinuities, capture waits, render backpressure, buffer sizes, endpoint formats, and an estimated latency. A result is `active` only when both input and output frame counters advanced during that explicit lab run. `active` here proves the laboratory transfer only; it is not a claim that Pixelody System EQ or a virtual driver route is active.

## Dev Virtual-Route Lab

This second bounded lab exists only for the VM after its test-signed endpoint
package has passed the validation record. It is not a service and does not select
or change the Windows default output:

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command virtual-route-lab --dev-allow-virtual-route --real-output-endpoint-id "{real-output-endpoint-id}" --duration-ms 1000
```

It resolves exactly one active `Pixelody Virtual Output` render endpoint and one
active `Pixelody Virtual Monitor` capture endpoint. It captures directly from
the monitor in shared mode and renders neutral PCM to the explicit real output.
It refuses absent or duplicate virtual endpoints, either virtual endpoint as the
real output, capture/output identity matches, non-stereo/non-48 kHz formats, and
any format conversion. It stops after 250 to 3000 ms and reports endpoint IDs,
formats, period/buffer sizes, counters, discontinuities, latency, heartbeat, and
stop reason. `active` still requires both capture and real-output frames to move.

No VM package validation record exists in this source tree, so this command has
not been exercised against a Pixelody virtual endpoint. Until that record and
the VM endpoint package exist, the guarded command must fail as
`virtual-endpoint-missing` without opening audio streams.

## Dev Endpoint-Clock Discipline Lab

The bridge also has a separately armed, time-bounded endpoint-clock monitor for
the future multi-output mixer. It is not normal Pixelody playback, does not
decode or render a Pixelody track, and never changes routing. It opens only two
explicit shared-mode render endpoints, queues silent keep-alive buffers, samples
each endpoint's `IAudioClock` position, and returns a transient follower
correction recommendation:

```powershell
Pixelody.SystemAudio.Bridge.exe --json --command clock-discipline-lab --dev-allow-clock-discipline --leader-endpoint-id "{leader-endpoint-id}" --follower-endpoint-id "{follower-endpoint-id}" --duration-ms 1000
```

The endpoint IDs must be different, active, and non-virtual. The lab refuses to
select a fallback. It estimates each endpoint's clock rate against QPC and uses
a follower-only asynchronous-resampling controller bounded to +/-300 ppm with a
maximum 20 ppm change per observation. Its included float PCM linear resampler
uses that same `0.9997..1.0003` ratio range for the eventual follower render
path. The lab reports `degraded` when it observed both clocks because it has
not rendered program audio or proven native grouped playback; it is never an
`active` release claim.

`clock-discipline-self-test` exercises the estimator, slew limit, correction
bound, and PCM resampler without enumerating or opening any audio endpoint.
The detailed design and limits are in
`../../docs/audio/multi-output/MULTI_OUTPUT_NATIVE_CLOCK_DISCIPLINE_PROTOTYPE.md`.

## Guardrails

- The production bridge will capture only `Pixelody Virtual Monitor`; this pre-driver lab captures Windows loopback from a manually chosen non-Pixelody endpoint.
- It never renders to `Pixelody Virtual Output` and blocks either Pixelody virtual endpoint by name.
- Same-endpoint capture/render is blocked before either audio client is opened.
- A real start/stop implementation must retain a recoverable previous-output record before making any future default-route change.
