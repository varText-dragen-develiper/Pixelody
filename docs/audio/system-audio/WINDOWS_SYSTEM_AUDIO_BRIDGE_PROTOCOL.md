# Windows System Audio Bridge Protocol

This is the v1 control and status contract for `Pixelody.SystemAudio.Bridge.exe`. It is the source of truth for Electron, the bridge, diagnostic helper, logs, and future support bundles.

The bridge is a separate user-mode real-time process. `Pixelody.Wasapi.Helper.exe` remains short-lived diagnostics only. The contract does not authorize endpoint installation, default-device changes, registry writes, or audible audio until the relevant roadmap gates are complete.

## Transport

Development stubs use one-shot JSON on stdout:

```text
Pixelody.SystemAudio.Bridge.exe --json --command status
```

The real bridge will be long-running and use an authenticated, per-user Windows named pipe. Every request and response is one UTF-8 JSON object terminated by `\n`. Electron talks to the bridge through the main process only; the renderer never owns a real-time endpoint or pipe credential.

Pipe names are generated per launch and include an unguessable token. The parent process must enforce same-user access. The exact pipe name is not persisted or exposed to the renderer.

## Route States

Only these exact state values are valid:

```text
off
helper-missing
virtual-endpoint-missing
virtual-input-detected
bridge-missing
bridge-starting
bridge-ready
active
degraded
bypass-suspected
real-output-missing
loop-risk-blocked
restore-needed
error
```

State precedence is safety-first: `loop-risk-blocked`, `real-output-missing`, and `restore-needed` outrank a ready-looking capture state. `active` is valid only when virtual input is receiving frames, the DSP loop is running, output frames are advancing on a distinct real endpoint, and the heartbeat is current.

## Envelope

Every request includes:

```json
{"contract":1,"requestId":"uuid","command":"status","payload":{}}
```

Every response includes:

```json
{"contract":1,"requestId":"uuid","ok":true,"status":{}}
```

`requestId` is echoed exactly. Unknown commands, unsupported contract versions, malformed payloads, and unsafe routes return `ok: false` with `status.state: "error"` or the specific safety state. The bridge must never silently coerce a command that could alter routing.

## Commands

| Command | Purpose | Audio side effect in v1 |
| --- | --- | --- |
| `protocol` | Return supported contract/version/capabilities. | None |
| `probe` | Inspect endpoint availability and safe-route eligibility. | None |
| `status` | Return current route status and counters. | None |
| `start` | Open the virtual monitor and selected real output after validation. | Future Phase 5 only |
| `stop` | Stop streams and report whether restore is needed. | Future Phase 5 only |
| `setTuning` | Replace the complete validated System EQ payload atomically. | Future Phase 6 only |
| `setOutput` | Select a distinct real output by endpoint ID. | Future Phase 5 only |
| `setLatencyPolicy` | Set `stable`, `balanced`, `low-latency`, or `studio-dev`. | Future Phase 7 only |
| `restore` | Restore a recorded previous Windows route when applicable. | Future Phase 8 only |

`start` is rejected unless both Pixelody virtual endpoints are present, the real output resolves to a distinct endpoint, and the bridge can open shared-mode capture/render clients. It must not fall back to the current default output.

## Status Schema

The status payload always has this shape; unavailable data is `null`, never invented:

```json
{
  "state":"bridge-ready",
  "ready":true,
  "active":false,
  "reason":"Endpoints are open; waiting for virtual input frames.",
  "endpoints":{
    "virtualOutput":{"id":"...","name":"Pixelody Virtual Output","present":true},
    "virtualMonitor":{"id":"...","name":"Pixelody Virtual Monitor","present":true},
    "realOutput":{"id":"...","name":"USB DAC","present":true}
  },
  "format":{"sampleRate":48000,"channels":2,"framesPerPeriod":480},
  "counters":{"inputFrames":0,"outputFrames":0,"underruns":0,"overruns":0,"driftPpm":0.0,"latencyMs":null},
  "watchdog":{"current":true,"lastHeartbeatUtc":"2026-07-20T12:00:00.000Z"}
}
```

The bridge records counters only. It must not write captured PCM, source metadata, track names, or audio-content-derived data to diagnostics.

## Command Payloads

`setOutput`:

```json
{"realOutputId":"{endpoint-id}"}
```

`setLatencyPolicy`:

```json
{"policy":"balanced"}
```

`setTuning` carries Pixelody's complete `systemEqNativePayload` as its payload. The bridge validates a schema/version, clamps unsafe numeric values, then swaps the whole DSP configuration at a block boundary. It never applies partial filter changes mid-block.

`restore`:

```json
{"restoreToken":"opaque-token-recorded-before-route-change"}
```

## Error Rules

- Never render to an endpoint whose ID equals either Pixelody virtual endpoint ID.
- Never infer a real output from a friendly name when an endpoint ID is required.
- Treat hot-unplug, format changes, device invalidation, and stale heartbeat as a controlled stop and report `real-output-missing`, `restore-needed`, or `error`.
- Do not claim `active` solely because a process launched or endpoints opened.
- Do not use exclusive mode in the first bridge.
- `bypass-suspected` is a warning state, not proof that a specific app is bypassing Pixelody.

## Implementation Sequence

1. The checked-in bridge supports read-only `protocol`, `status`, and endpoint `probe` responses.
2. Phase 2 provides a separate-endpoint, neutral PCM pass-through laboratory behind `--dev-allow-pass-through`. It requires two explicit endpoint IDs, accepts only matching shared mix formats, blocks same-endpoint and Pixelody-virtual routes, and stops within 250 to 3000 ms.
3. The bridge also contains a separate, dev-only `virtual-route-lab` behind `--dev-allow-virtual-route`. After the VM endpoint package has passed its validation record, it accepts only an exact `Pixelody Virtual Monitor` capture endpoint and an explicit distinct real output ID. It is bounded to 250 to 3000 ms, refuses virtual output loops and format conversion, and is not a resident bridge or a claim of VM validation.
4. Phase 5 adds pipe transport, lifecycle, capture/render, watchdogs, and recovery without EQ.
5. Phase 6 adds atomic tuning updates and neutral A/B bypass.

No production installer or driver integration begins from this protocol alone. The current helper probe reports `bridge-missing` only when Windows is already routing into `Pixelody Virtual Output` and the bridge binary is absent; it does not infer driver installation from a friendly name alone.
