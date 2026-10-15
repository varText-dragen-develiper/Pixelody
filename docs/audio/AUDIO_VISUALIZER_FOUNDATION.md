# Audio Visualizer Foundation

## Status

This is a reusable renderer inventory and specimen bench. It is intentionally **not assigned to any built-in or community theme** and is not connected to live playback yet. Theme placement, theme-specific palette/geometry, and which visualizer belongs to which product surface remain later design decisions.

The current foundation contains sixteen code-native canvas renderers under `src/audio-visualizers/` and a standalone comparison page at `src/visualizer-lab.html`. It adds no external artwork or licensed dependency.

## Non-negotiable boundary

The playback graph owns sound. A visualizer owns pixels.

- A visualizer must never create an `AudioContext` or call `createMediaElementSource()`.
- Later live integration must take one product-owned analyser tap from the existing processed graph. It must not attach the media element to a second graph.
- Analysis is read-only. It cannot change gain, routing, EQ, limiting, timing, queue state, or confirmed playback state.
- `playing` is supplied by the authoritative playback host. It is not inferred from signal energy.
- The visualizer is decorative. Play state, track identity, progress, errors, and output route remain available in ordinary accessible UI.

## Normalized signal frame V1

`signal-frame.js` accepts analyser-like buffers and creates an immutable-shape frame:

- `spectrum`: 96 normalized frequency bins, `0..1`.
- `waveform`: 192 normalized time samples, `0..1` with `0.5` as center.
- `left` and `right`: optional stereo time samples; mono data is copied safely when separate channels are unavailable.
- `bands`: sub, bass, low-mid, mid, high-mid, and air energy.
- `rms`, `peak`, `beat`, `flux`, and spectral `centroid`: normalized derived features.
- `stereoWidth` and signed `balance`: optional channel relationships.
- `timestamp` and authoritative `playing`.

Renderers consume only this frame. The deterministic demo generator exists for repeatable QA; it is not presented as genuine audio analysis.

## Lifecycle and scheduling

`runtime.js` supplies one scheduler for all mounted instances:

1. The host creates one scheduler.
2. It mounts canvases by registered renderer id.
3. It pushes a normalized source frame or supplies one frame source.
4. The scheduler samples that source once per tick and updates eligible instances.
5. Each instance can change palette, size, visibility, motion, and performance mode without remounting.
6. Destroy removes the instance and releases its private history.

Full motion targets 60 fps for low/medium renderers and 30 fps for high-cost renderers. `conserve` lowers device scale and caps renderers to about 10–15 fps. `reduced` and `off` render a static diagnostic frame and do not maintain a continuous animation loop.

## Renderer inventory

| Id | Process | Cost | Natural placements |
| --- | --- | --- | --- |
| `spectrum-deck` | Log-spaced spectrum bars and peak caps | Low | strip, panel, hero |
| `mirror-scope` | Reflected time-domain scope | Low | strip, panel |
| `radial-crown` | Circular frequency rays | Medium | square, hero, artwork ring |
| `waterfall-memory` | Spectral heat history | Medium | panel, hero |
| `stereo-phase` | Stereo Lissajous phase portrait | Low | square, panel |
| `ribbon-current` | Interfering waveform ribbons | Medium | strip, hero, background |
| `topographic-field` | Stacked spectral contours | Medium | panel, hero, background |
| `particle-drift` | Deterministic band-driven particles | High | panel, hero, background |
| `signal-constellation` | Transient/proximity node network | High | square, panel, background |
| `kinetic-tiles` | Frequency-threshold cell matrix | Low | strip, panel, mini |
| `paper-seismograph` | Scrolling energy trace | Low | strip, panel, mini |
| `spectral-bloom` | Spectral polar petals | Medium | square, hero, artwork ring |
| `groove-disc` | Harmonic concentric groove deformation | Medium | square, hero, artwork ring |
| `meter-bridge` | Damped analog regional meters | Low | strip, panel, mini |
| `harmonic-pendulums` | Band-weighted damped pendulum mechanics | Medium | strip, panel, hero |
| `spectral-loom` | Interlaced waveform and spectrum threads | Medium | panel, hero, background |

## Theme integration later

A theme may eventually choose a renderer, placement recipe, palette adapter, and detail tier, but those mappings belong in a product-owned registry rather than inside renderer code or a declarative community package. Theme selection must preserve a safe no-visualizer fallback. The mini player should receive a separate mount decision; it must not inherit a large main-stage renderer automatically.

Before any live mapping is accepted, prove:

- the analyser tap sees the intended processed signal without changing it;
- output selection, EQ, limiting, calibration, imports, and playback remain unchanged;
- only visible instances render and the global scheduler yields under input/frame pressure;
- motion off, OS reduced motion, and `data-performance="conserve"` behave as documented;
- keyboard and screen-reader users lose no playback information;
- narrow, strip, square, hero, and mini placements remain legible where claimed;
- painted Windows runtime and physical playback evidence are recorded separately from deterministic lab evidence.

## Developer bench

Open `src/visualizer-lab.html` in a browser or local static server. The bench exposes five deterministic signal characters, three motion states, two performance budgets, and four neutral specimen palettes. It does not need a music file and does not touch the app audio graph.

Run `npm run check:audio-visualizers` for structural and deterministic contract coverage.
