# Renderer Domain Boundaries

`src/renderer.js` remains the browser composition root: it binds the DOM, connects Electron bridge adapters, and coordinates cross-domain UI effects. Reusable state policy, deterministic transforms, and controller lifecycle now live under `src/renderer-domains/` and load before the composition root.

The domain files are UMD-style modules so the same implementation runs as a classic Electron renderer script and as a CommonJS module in Node regression tests. They do not import one another. Cross-domain coordination occurs only in `renderer.js`, preventing circular dependencies and hidden controller order.

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

## Invariants

- The main-process state store remains authoritative. The renderer state controller receives only narrow bridge methods and never receives filesystem primitives.
- Legacy localStorage remains a rollback mirror; domain modules cannot read or write it directly.
- Track paths remain in the private renderer-to-main J.A.M. snapshot only so the main process can stream local media. `src/server/` maps IDs and strips paths before any public response; `scripts/check-server.js` verifies this boundary with a Windows-path fixture.
- The primary audio graph still contains one media-element source, simple and parametric EQ, master gain, spatial matrix, protective limiter, and one destination. Output truth and direct-primary behavior are unchanged.
- Theme choreography, accessibility attributes, DOM IDs, and mini-player message ordering remain composition-root responsibilities until a later UI component migration provides an equally explicit contract.
- Every controller must remain independently require-able in Node. New domain logic belongs in its owner module and needs a module-level test before renderer wiring.

## Verification

- `scripts/check-renderer-domains.js` executes every controller boundary, including state serialization, malformed import shapes, queue/session decisions, navigation history, diagnostics lifecycle, J.A.M. projection, appearance normalization, and a fake Web Audio graph.
- `scripts/check-ui-bindings.js` guards DOM composition and the bounded startup reveal.
- `scripts/check-state-store.js`, `scripts/check-audio.js`, `scripts/check-server.js`, and the theme/legal audits protect cross-process and cross-domain invariants.
- The item 3 live Windows smoke test covers startup, durable library/queue/session restore, settings navigation, diagnostics, play/pause, J.A.M. default-off state, and mini-player synchronization.
