# Theme Asset and Instrument Infrastructure Catalog

Status: planning and platform inventory, 2026-08-24. This document does not mark any roadmap item complete and does not assign new infrastructure to a production theme.

The first comparison slice is now implemented in the standalone [Theme Instrument Foundry](THEME_INSTRUMENT_FOUNDRY.md): twelve lifecycle-backed specimens, exactly two under each category below, using deterministic fixture truth and explicit fallback conditions. It remains foundry evidence rather than a production-theme assignment.

## Purpose

Pixelody needs more reusable theme building blocks like the audio visualizer set: pieces that can be made and polished independently, then selected, placed, and embodied differently by later themes.

This catalog calls those pieces **theme instruments**. An instrument may be:

- **Aesthetic:** atmosphere, material, framing, texture, lighting, or ornament with no product-state ownership.
- **Functional:** a reusable embodiment of an existing product job such as seeking, queue management, output selection, or metadata inspection.
- **Hybrid:** an aesthetic projection of truthful state, such as a status lamp, progress instrument, playback artifact, or output meter.

An instrument is not a theme. It is reviewed product-owned infrastructure that a built-in theme—and, where explicitly allowlisted, a bounded local theme package—may select by stable key. It never grants a theme arbitrary DOM, selectors, JavaScript, audio-graph access, or application-state ownership.

## Current infrastructure reality

| System | Current status | What is genuinely reusable | Main gap |
| --- | --- | --- | --- |
| Navigation mechanics | **Live registry and dispatcher** | Eleven registered track-browsing mechanics with mount/update/destroy, keyboard/state rules, and static fallback | Playlist browsing is not equivalently generalized; assignment still uses a checked runtime map because built-in manifests are not read live |
| Information bundles/profiles | **Live registry and product slots** | Six standard read-only bundles, three profiles, five registered slot names, teardown, and safe fallback | More stable bundles and placement recipes are needed before broader HUD migration |
| Audio visualizers | **Built and specimened; not live-wired or theme-assigned** | Sixteen canvas renderers, normalized frames, one scheduler, cost tiers, motion/conserve fallback, and a comparison foundry | One product-owned analyser tap and a theme/slot selection layer remain deliberately absent |
| Mini-player tokens | **Live CSS-variable baseline** | Shell, artwork, copy, progress, transport, play, and window-action dimensions/treatments | It is a token surface, not a registered composition or mechanic system; rectangular/specialized shapes still need scoped CSS |
| Theme glyphs | **Live narrow utility** | Deterministic seed-to-variant/rotation/edition mapping shared by main and mini | Only one abstract glyph grammar; no registered iconographic or playlist-mark families |
| Interface sounds | **Live but centrally hardcoded** | Cue classification, user mode/volume, output routing, sample profiles, rate limiting, and main/mini synchronization | Theme profiles and sample selection live in one large module rather than a validated profile registry |
| Theme load/reaction choreography | **Live but ad hoc** | Theme-switch exit styles, action codes, stage/body reaction classes, performance and motion guards | Several maps in `renderer.js`; no common lifecycle, cost metadata, slots, or reusable choreography registry |
| Semantic color tokens | **Tested but not live-wired for built-in manifests** | Legacy-to-semantic conversion | Runtime still primarily consumes historical palette keys; manifests are not the live source of truth |
| Per-theme CSS/SVG/raster/font assets | **Live, theme-local** | Original/licensed assets, asset directories, manifest intent, and provenance ledger | No typed reusable material/ornament/artwork-treatment catalog; most assets are selected indirectly through CSS |
| CSS loader | **Built but intentionally inert** | Correct link enable/disable logic | Theme files mix active-theme rules with always-needed picker previews; a safe split and painted verification are required before retrying |
| Dev Lab mechanics | **Prototype workshop only** | Seventeen switchable presentation experiments and motion-off scaffolding | They are CSS prototypes, not production registries or behavior-aware instruments |

## Proposed common instrument contract

The audio visualizer foundation should be the structural precedent, not a special case. Every future reusable instrument family should expose equivalent metadata even when its renderer is CSS, SVG, DOM, canvas, or audio.

```text
id                     stable lowercase key
family                 material, progress, atmosphere, control, meter, etc.
role                   aesthetic | functional | hybrid
jobs                   product jobs it supports; empty for purely decorative work
inputs                 named read-only bundles or host signals
placements             registered slots and supported shapes/sizes
renderer               css | svg | dom | canvas | audio
interaction            none or a named host-owned action contract
motion                  full, reduced, and off behavior
detail                  sparse, balanced, rich behavior
performance             cost tier and conserve substitute
accessibility           labels, focus behavior, non-color state, decorative semantics
fallback                safe baseline if unavailable or disabled
mainMiniRelationship    none | shared recipe | distinct companion recipe
assets                  product-owned local asset references only
provenance              source/license record for every external asset
lifecycle               mount/update/resize/destroy where runtime work exists
```

The fixed dependency direction should be:

`authoritative state -> read-only signal/bundle -> registered instrument -> product-owned slot -> theme-owned visual recipe`

Themes select reviewed keys and parameters. They do not inject renderer code, markup, selectors, URLs, or factual-looking content. Community-theme V1 should remain narrower still: it may select only an explicitly public allowlist of product-owned recipes, with Studio fallback for anything missing or incompatible.

## Catalog A: visual material and atmosphere

These families mainly establish identity. They should never be necessary for understanding playback or operating the app.

| Family | Role | What the infrastructure would provide | Inputs | Natural placements | Current state | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Surface material recipes | Aesthetic | Reusable glass, paper, molded polymer, metal, stone, fabric, CRT, ink, lacquer, and translucent-film treatments with controlled grain, edge, elevation, and conserve variants | Palette, detail, performance | panels, cards, rails, drawers, mini shell | Many excellent theme-local examples; no typed library | **P0** |
| Frame, edge, and corner systems | Hybrid | Product-safe frames, apertures, notches, registration marks, clamps, bezels, labels, and corner geometries that can wrap arbitrary owned content | State accent, focus, selection, density | artwork, hero, panel, card, mini | CSS/token fragments exist; no registry | **P0** |
| Procedural pattern generators | Aesthetic | Grids, halftones, hatch, dither, scanline, waveform paper, topographic marks, circuit routes, star maps, and repeat-safe SVG/CSS patterns | Palette, detail, seed | background, hero, surface inset, empty state | Mostly one-off CSS/SVG assets | **P1** |
| Ambient atmosphere fields | Aesthetic | Rain, dust, steam, petals, orbital drift, fog, signal haze, caustics, film grain, light sweeps, and low-noise particle fields | Playback phase optionally; motion/detail/performance always | canvas background, hero, stage overlay | Theme-local motion exists; no shared scheduler/registry | **P1** |
| Lighting and shadow instruments | Aesthetic | Directional light, edge glow, reflected color, vignette, bloom, cast-shadow, and focus-light recipes with contrast and conserve bounds | Palette, focus/playing state | shell, hero, artwork, selected object | Scattered CSS recipes | **P1** |
| Decorative object kits | Aesthetic | Original records, tapes, cartridges, stamps, tickets, dossiers, lenses, signal modules, petals, tags, and machine parts as composable SVG families | Seed, palette, density | hero, empty state, panel accent, playlist identity | Theme-local asset packs only | **P2** |
| Background scene compositions | Aesthetic | Layered room, observatory, archive, gallery, broadcast, transit, laboratory, and abstract-field scenes with safe crop/focal-region metadata | Window size, collection art, detail, motion | app canvas, hero | Individual theme compositions only | **P2** |

## Catalog B: artwork and identity instruments

These pieces make arbitrary user music and local collections feel native to a theme without replacing or obscuring user-selected art.

| Family | Role | What the infrastructure would provide | Inputs | Natural placements | Current state | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Artwork treatment pipeline | Hybrid | Duotone, halftone, threshold, film, prism, glass, ink, photocopy, thermal, x-ray, pixel, crop, and depth treatments with legibility and missing-art fallbacks | Artwork URL/path, palette, detail, performance | hero, cover, row, mini | Ad hoc CSS filters/masks; no reusable pipeline | **P0** |
| Artwork frame instruments | Hybrid | Turntable wells, museum plinths, sleeves, optical-media trays, monitor apertures, poster clamps, and lens rings independent of the artwork treatment itself | Artwork aspect, playing/focus state | hero, now playing, playlist card, mini | Theme-local | **P0** |
| Playlist identity generator | Hybrid | Deterministic marks, monograms, catalog codes, color fields, and original procedural covers for missing/custom playlist art | Playlist id/name/count, seed, palette | library rail, playlist hero, mini fallback | One deterministic glyph utility exists | **P1** |
| Icon and glyph families | Functional | Registered coherent icon sets and state marks with shared literal meanings, optical centering, main/mini parity, and text fallbacks | Control/status meaning | buttons, status, navigation, empty states | One shared icon set plus one seeded glyph grammar | **P1** |
| Typography composition profiles | Hybrid | Tested display/body/mono/metadata role systems, scale ramps, wrapping rules, numeric alignment, and narrow fallbacks—not arbitrary font injection | Copy role, density, locale/length | global, hero, metadata, meters | Manifest intent and theme CSS; no live role registry | **P1** |

## Catalog C: truthful reactive and information instruments

These are the closest relatives of audio visualizers. They project host-owned state without owning it.

| Family | Role | What the infrastructure would provide | Inputs | Natural placements | Current state | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Audio visualizer set | Hybrid | Sixteen existing signal renderers across classic, history, stereo, particle, geometric, mechanical, and woven processes | Normalized visualizer frame | strip, panel, square, hero, background, artwork ring, mini candidate | Built/specimened; not live-wired | Existing foundation |
| Progress and timeline instruments | Functional | Seek-safe tape paths, filmstrips, orbit tracks, groove arcs, waveform rails, seismographs, segmented meters, and chapter-like marks | Duration, position, buffered/loading state | player, hero, mini, row | Backlog plus theme-local CSS | **P0** |
| Playback-state signals | Functional | Playing, paused, pending, loading, stopped, unavailable, and failed lamps/locks/receipts with literal labels and non-color differences | Authoritative playback phase and failure state | player, row, hero, mini, status badge | Repeated theme-local treatments | **P0** |
| Compact status instruments | Functional | Quality, codec, source, favorite, queue, offline, processing, output, and availability badges as lamps, stamps, labels, flags, or counters | Standard information bundles | header, row, player, inspector, mini | Shared values exist; embodiments are local | **P0** |
| Data ornament generators | Hybrid | Truthful catalog codes, tick fields, track-count scales, duration rings, bitrate ladders, waveform stamps, and seeded metadata marks | Stable literal metadata or explicit deterministic seed | card, hero, metadata, empty space | Theme-local pseudo-elements and one glyph utility | **P1** |
| Meter and gauge library | Functional | VU needles, LED ladders, balance scopes, route meters, peak/headroom indicators, storage/library gauges, and calibration confidence displays | Named audio/diagnostic/information bundle only | tuning, systems, player, inspector | Some audio UI exists; no presentation registry | **P1** |
| Output-route diagrams | Functional | Patch bays, room maps, signal paths, speaker racks, and route receipts that never hide the literal device label or availability | Output-route and speaker-system state | player popover, systems, inspector | Theme-local concepts; output truth exists | **P1** |
| Playback neighborhood artifacts | Hybrid | Previous/current/next as tape windows, cards, slips, orbit nodes, media slabs, or cut sheets | `playback.neighborhood` | hero, player overlay, stage | Information bundle live; three profile implementations | **P1** |
| Queue and session maps | Functional | Route, stack, train, constellation, deck, or timeline projections of the authoritative queue/Flow plan | Queue, Flow receipts, manual/generated origin | drawer, stage, hero | Queue is functional; no mechanic registry | **P2** |

## Catalog D: interaction and control instruments

These pieces embody existing operations. They require stricter accessibility and behavior contracts than decoration.

| Family | Role | What the infrastructure would provide | Host-owned actions/state | Current state | Priority |
| --- | --- | --- | --- | --- | --- |
| Interaction-response recipes | Functional | Mechanical compression, paper lift, glass refraction, terminal cursor, stamped selection, elastic press, and focus aperture with no layout shift | hover, focus-visible, press, selected, disabled | Prototype backlog and theme CSS | **P0** |
| Transport control objects | Functional | Turntable, cassette, broadcast, arcade, observatory, deck, and minimal transport assemblies while retaining canonical icons/actions | previous, play/pause, next, shuffle, repeat | Theme-local main/mini styling | **P0** |
| Reveal and cabinet mechanics | Functional | Drawer, bay, sleeve, hatch, overlay, telescope, fold, and layered-panel containers with shared open/close/focus/Escape/history behavior | Open state and host navigation callbacks | Shared navigation controller exists; visual embodiments are ad hoc | **P0** |
| Volume and output controls | Functional | Dials, faders, signal ladders, pressure gauges, patch selectors, and route cabinets with literal values/device names | Volume, mute, selected output, unavailable state | Standard controls with theme CSS | **P1** |
| Search and filter instruments | Functional | Tuners, command prompts, archive indexes, band selectors, and lookup desks around unchanged search semantics | Query, filters, sort, empty/error state | Dev Lab prototype only | **P1** |
| Queue object mechanics | Functional | Cards, records, documents, messages, train cars, and cassette inserts with reorder/remove/play-next semantics | Queue callbacks and item origin | Dev Lab prototype/theme-local CSS | **P1** |
| Tuning instrument faces | Functional | Mixing console, modular patch field, pipe organ, laboratory bench, skyline, and mastering desk embodiments | EQ bands, presets, reset, bypass, output context | Functional EQ exists; styling mostly local | **P1** |
| Workflow stage mechanics | Functional | Intake desk, loading dock, repair bench, archive vault, calibration station, and export desk shells around real multi-step flows | Import/repair/backup/calibration progress and actions | Dev Lab prototypes only | **P2** |

## Catalog E: motion, feedback, and sound language

| Family | Role | What the infrastructure would provide | Inputs | Current state | Priority |
| --- | --- | --- | --- | --- | --- |
| Transition choreography profiles | Hybrid | Short reusable enter/exit/reorder/reveal patterns: wipe, lock, shutter, paper lift, eclipse, dissolve, index resolve, signal handoff | Event kind, affected slot, motion/performance state | Several live maps and CSS classes in `renderer.js` | **P0** |
| Feedback and recovery language | Functional | Success, warning, error, pending, retry, undo, destructive confirmation, and recovery receipts pairing theme metaphor with plain next action | Literal host outcome and recovery action | Theme action overlay and scattered messages | **P0** |
| Interface sound profiles | Hybrid | Registered cue packs for hover, press, select, open, close, toggle, adjust, and swipe with rate limits and user volume/mode | Host interaction cue | Rich live module; profiles are hardcoded | **P1** |
| Track-change rituals | Hybrid | Needle find, tape engage, light acquisition, aperture lock, print registration, route arrival, or archive retrieval that confirms rather than delays playback | Requested/confirmed/failed track transition | Theme-local reactions | **P1** |
| Ambient playback choreography | Aesthetic | Slow background behavior that begins only on confirmed playback and freezes on pause without becoming a state requirement | Confirmed phase, motion/detail/performance | Theme-local | **P2** |

## Catalog F: composition and delivery infrastructure

These are the enablers that keep the families above from becoming new piles of theme-specific code.

| Family | Role | What the infrastructure would provide | Current state | Priority |
| --- | --- | --- | --- | --- |
| General theme-instrument registry | Platform | Validation, stable keys, metadata, availability, lifecycle, allowlists, and deterministic listing for every family | Missing; navigation/information/visualizers each solve part separately | **P0** |
| Product-owned placement slots | Platform | Named ownership boundaries for canvas, hero, stage, player, inspector, rail, overlay, popover, artwork ring, empty state, and mini-specific locations | Five information slots exist; no general instrument-slot contract | **P0** |
| Theme recipe descriptor | Platform | Theme-to-instrument mapping with parameters, main/mini relationship, fallback, and compatibility checks | Navigation/information have separate manifest keys; no general recipe block | **P0** |
| Unified specimen foundry | Platform | Side-by-side rendering of materials, artwork treatments, progress, status, controls, atmospheres, and transitions using fixed truth fixtures | Visualizer Foundry and Dev Lab exist separately | **P0** |
| Performance and visibility governor | Platform | Shared scheduling, cost budgets, hidden-window suspension, input priority, conserve substitutions, and diagnostics | Window frame-health monitor and visualizer scheduler exist separately | **P0** |
| Accessibility/fallback recipe registry | Platform | Static substitutes, decorative semantics, focus rules, literal labels, high-contrast behavior, and failure fallback checked per instrument | Rules exist in prose and focused contracts | **P0** |
| Responsive placement recipes | Platform | Instrument-owned size classes and reflow/collapse/substitute behavior without hiding the associated product job | Per-theme media queries and mechanic-specific narrow rules | **P1** |
| Mini-player composition profiles | Platform | Distinct condensed compositions rather than automatic shrinkage of the main theme; explicit supported instruments and controls | Strong token baseline; composition remains per-theme CSS | **P1** |
| Asset provenance manifest | Platform | Machine-checkable file, creator, source, license, modification, role, theme/instrument consumer, and redistribution status | Human-maintained `THIRD_PARTY_ASSETS.md` | **P1** |
| Safe asset packaging/cache | Platform | Content-addressed local assets, size/type/dimension limits, decode failure fallback, and no executable formats | Community package V1 rejects assets; built-in assets are trusted files | **P2**, before community asset support |

## Recommended first build program

### Phase 1: one common host, no new theme assignments

Build the general instrument contract, registry, placement-slot registry, and a recipe validator. Reuse the proven rules from navigation, information, and visualizers rather than merging their incompatible rendering APIs into one oversized interface. The common layer should validate metadata and route each family to its own adapter.

Definition of done:

- Stable key and duplicate-registration failures.
- Declared role, inputs, placements, cost, motion, accessibility, and fallback.
- No arbitrary selectors, DOM, URLs, or executable manifest content.
- Missing instruments and incompatible slots fail safely to no instrument or the existing baseline.
- Built-in runtime maps and manifests are cross-checked until a security-reviewed live manifest path exists.

### Phase 2: generalize the specimen workflow

Extend the Visualizer Foundry pattern into a **Theme Instrument Foundry**. Use deterministic fixtures for playing/paused/pending/failed, short/long metadata, arbitrary/missing artwork, queue origin, output availability, desktop/narrow, main/mini, motion, detail, and performance states.

This is comparison evidence, not application acceptance. Promotion still requires painted Electron behavior, keyboard/accessibility checks, and independent-human review where appropriate.

### Phase 3: first six reusable families

Build these before high-character workflows because they improve nearly every theme without taking over complex product behavior:

1. Surface material recipes.
2. Artwork treatment and frame instruments.
3. Progress/timeline instruments.
4. Playback and compact status signals.
5. Interaction-response recipes.
6. Transition choreography profiles.

### Phase 4: functional instruments

After the first families prove the host, build transport objects, reveal/cabinet mechanics, volume/output instruments, meters, queue objects, and tuning faces. Each keeps the current host action contract and has a plain fallback.

### Phase 5: high-character systems

Only then promote ambient scenes, playlist identity objects, session maps, workflow stages, track-change rituals, and mini-player composition profiles. These have greater topology, performance, and acceptance risk and should be justified by a selected theme direction rather than built speculatively in bulk.

## What not to build as shared infrastructure

- A generic “make it themed” layer that only swaps colors, blur, and border radius.
- One enormous universal component API covering navigation, information, sound, canvas, and controls.
- Arbitrary theme JavaScript, selectors, markup, URLs, or audio nodes.
- A second copy of playback, queue, metadata, output, or navigation state inside an instrument.
- Decorative telemetry, invented coordinates, fake audio measurements, or status inferred from animation.
- Theme-specific assets promoted to global infrastructure without a second credible consumer.
- An asset marketplace or community asset loader before file safety, licensing, moderation, signatures, and fallback are designed.
- Motion that is required to identify state or an expensive effect that survives conserve mode at the expense of playback/input responsiveness.

## Acceptance gate for any instrument family

- It has at least two credible theme consumers or is required groundwork for a user-selected reference direction.
- Its contract names truth owners and forbids state mutation outside host callbacks.
- Functional meaning survives no CSS, missing assets, motion off, reduced motion, conserve mode, and narrow width.
- Keyboard, focus, hit targets, accessible names, non-color state, and Escape/back behavior are verified where interaction exists.
- Main and mini behavior are explicitly shared, distinct, or unsupported—never accidentally inherited.
- External assets have compatible redistribution/modification rights and provenance.
- Deterministic checks, painted runtime evidence, perceptual/usability review, accessibility evidence, physical/device evidence where relevant, and independent-human acceptance remain separately labeled.

## Immediate recommendation

A standalone asset production workflow, maintained separately, covers how a reference-informed asset
kit is analyzed, generated, selected, validated, and handed off. It is complementary
to this catalog: the process can produce theme-local families now, while this
catalog describes the runtime registries, placement contracts, state inputs,
foundry fixtures, and packaging infrastructure required to consume such families
safely and repeatedly. A successful one-theme asset kit is not automatically a
shared instrument; promote it only after the consumer and acceptance rules below
are satisfied.

The highest-leverage next implementation is not another theme and not a giant asset pack. It is the common instrument descriptor/registry plus a generalized foundry, followed by the first six families above. That creates a safe place to manufacture reusable theme identity at the same quality level as the visualizer set without forcing every future theme to rediscover lifecycle, state truth, performance, accessibility, responsive placement, and fallback from scratch.
