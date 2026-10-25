# Renderer modules

`src/renderer.js` binds the DOM and coordinates the controllers in `src/renderer-domains/`. The controllers load first and use UMD exports so the same code can run as a classic renderer script or be required by Node tests. They don't import each other; coordination belongs in the composition root.

| Domain | Owned behavior | Injected dependencies | Commands/results |
| --- | --- | --- | --- |
| State | Serialized durable commits, migration initialization, debounce/flush lifecycle, runtime write diagnostics | Narrow desktop bridge, snapshot builder, clock/timers, malformed-key list | `initialize`, `schedule`, `enqueue`, `flush`; commit status and revision |
| Library/import | CSV, JSON, and M3U parsing; duration normalization; imported-track scoring/matching; unique playlist names | Optional filename adapter and current track/playlist arrays | Normalized import records and match decisions; no filesystem access |
| Navigation | Deduplicated history, back behavior, surface-state calculation | Capture, restore, close-current, and main-process notification adapters | `push`, `back`, `discard`, `sync`; back-availability state |
| Playback/session | Queue rotation/filtering, linear adjacency, bounded session normalization | Track and queue snapshots | Ordered IDs, adjacent track, normalized session; no media-element ownership |
| Diagnostics | Numeric/statistical helpers, gain-risk policy, snapshot/render lifecycle | Snapshot builder and renderer adapters | Current privacy-safe diagnostic snapshot and rendered update |
| J.A.M. | Host snapshot projection, valid playlist/queue filtering, pairing expiry, URL candidate selection | Renderer state, playback facts, audio-profile projection | Private host snapshot for main-process sanitization; pairing/base-URL decisions |
| Appearance | Saved appearance, motion, and interface-sound normalization; deterministic color math | Defaults and persisted values | Normalized appearance models and palette values |
| Audio | Tuning/parametric normalization, Web Audio graph construction, limiter/spatial wiring, DSP math | AudioContext, media element, band definitions and limits | Connected graph nodes and bounded tuning/spatial results |

## Where a change belongs

Put reusable policy and deterministic transforms in the owning module, with a module test before wiring them to the renderer. Keep DOM choreography, accessibility attributes, IDs and mini-player message order in `renderer.js` until a component has an equally explicit owner.

The state controller gets narrow bridge methods, never filesystem primitives. The main-process store owns durable data; controllers don't access legacy browser storage directly. A J.A.M. snapshot can contain paths privately on its way to the main process, but `src/server/` must strip them before any response. `check-server.js` includes a Windows-path fixture for that case.

Audio still has one primary media source and a graph with simple/parametric EQ, gain, spatial processing, limiter and destination. Extracting a controller doesn't authorize a second clock or a route that bypasses processing.

## Checking a change

`scripts/check-renderer-domains.js` exercises the modules with controlled dependencies, including a fake audio graph. `check-ui-bindings.js` covers DOM composition/startup; state, audio and server checks cover the other boundaries. The Windows smoke scenario checks real startup, restore, navigation, diagnostics, playback commands, default-off J.A.M. and mini-player synchronization. Keep that runtime result separate from module-test coverage.
