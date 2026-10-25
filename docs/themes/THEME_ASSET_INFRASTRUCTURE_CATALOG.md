# Reusable theme instruments

A theme instrument is a reusable presentation of a product function or visual material. It might be a seek control, an artwork frame, a status lamp or a rain field. It isn't a whole theme and doesn't get its own copy of playback, queue or output state.

This August 24, 2026 inventory separates live pieces, standalone benches and proposed families. The later [Foundry slice](THEME_INSTRUMENT_FOUNDRY.md) has twelve lifecycle-backed fixtures, two per category, but no production assignments. Counts in the recorded table belong to that inventory; use the runtime registry for the latest entries.

## Selecting and mounting an instrument

The proposed descriptor keeps the following facts explicit:

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

The host projects read-only state into an instrument, mounts it in a product-owned slot, and applies the theme recipe. Mutations go through existing callbacks. A missing/incompatible recipe falls back to the ordinary control or no decoration. Packages get only the public allowlist, never arbitrary markup, scripts, selectors, URLs or audio nodes.

## Recorded systems

| System | Current status | What is genuinely reusable | Main gap |
| --- | --- | --- | --- |

## Materials and atmosphere

| Navigation mechanics | **Live registry and dispatcher** | Eleven registered track-browsing mechanics with mount/update/destroy, keyboard/state rules, and static fallback | Playlist browsing is not equivalently generalized; assignment still uses a checked runtime map because built-in manifests are not read live |
| Information bundles/profiles | **Live registry and product slots** | Six standard read-only bundles, three profiles, five registered slot names, teardown, and safe fallback | More stable bundles and placement recipes are needed before broader HUD migration |

## Artwork and identity

| Audio visualizers | **Built and specimened; not live-wired or theme-assigned** | Sixteen canvas renderers, normalized frames, one scheduler, cost tiers, motion/conserve fallback, and a comparison foundry | One product-owned analyser tap and a theme/slot selection layer remain deliberately absent |
| Mini-player tokens | **Live CSS-variable baseline** | Shell, artwork, copy, progress, transport, play, and window-action dimensions/treatments | It is a token surface, not a registered composition or mechanic system; rectangular/specialized shapes still need scoped CSS |

## Signal and information

| Theme glyphs | **Live narrow utility** | Deterministic seed-to-variant/rotation/edition mapping shared by main and mini | Only one abstract glyph grammar; no registered iconographic or playlist-mark families |
| Interface sounds | **Live but centrally hardcoded** | Cue classification, user mode/volume, output routing, sample profiles, rate limiting, and main/mini synchronization | Theme profiles and sample selection live in one large module rather than a validated profile registry |

## Controls and interaction

| Theme load/reaction choreography | **Live but ad hoc** | Theme-switch exit styles, action codes, stage/body reaction classes, performance and motion guards | Several maps in `renderer.js`; no common lifecycle, cost metadata, slots, or reusable choreography registry |
| Semantic color tokens | **Tested but not live-wired for built-in manifests** | Legacy-to-semantic conversion | Runtime still primarily consumes historical palette keys; manifests are not the live source of truth |

## Motion, feedback and sound

| Per-theme CSS/SVG/raster/font assets | **Live, theme-local** | Original/licensed assets, asset directories, manifest intent, and provenance ledger | No typed reusable material/ornament/artwork-treatment catalog; most assets are selected indirectly through CSS |
| CSS loader | **Built but intentionally inert** | Correct link enable/disable logic | Theme files mix active-theme rules with always-needed picker previews; a safe split and painted verification are required before retrying |

## Placement and delivery

| Family | Role | What the infrastructure would provide | Inputs | Natural placements | Current state | Priority |
| --- | --- | --- | --- | --- | --- | --- |

## undefined

| Surface material recipes | Aesthetic | Reusable glass, paper, molded polymer, metal, stone, fabric, CRT, ink, lacquer, and translucent-film treatments with controlled grain, edge, elevation, and conserve variants | Palette, detail, performance | panels, cards, rails, drawers, mini shell | Many excellent theme-local examples; no typed library | **P0** |
| Frame, edge, and corner systems | Hybrid | Product-safe frames, apertures, notches, registration marks, clamps, bezels, labels, and corner geometries that can wrap arbitrary owned content | State accent, focus, selection, density | artwork, hero, panel, card, mini | CSS/token fragments exist; no registry | **P0** |

## undefined

| Procedural pattern generators | Aesthetic | Grids, halftones, hatch, dither, scanline, waveform paper, topographic marks, circuit routes, star maps, and repeat-safe SVG/CSS patterns | Palette, detail, seed | background, hero, surface inset, empty state | Mostly one-off CSS/SVG assets | **P1** |
| Ambient atmosphere fields | Aesthetic | Rain, dust, steam, petals, orbital drift, fog, signal haze, caustics, film grain, light sweeps, and low-noise particle fields | Playback phase optionally; motion/detail/performance always | canvas background, hero, stage overlay | Theme-local motion exists; no shared scheduler/registry | **P1** |

## undefined

| Lighting and shadow instruments | Aesthetic | Directional light, edge glow, reflected color, vignette, bloom, cast-shadow, and focus-light recipes with contrast and conserve bounds | Palette, focus/playing state | shell, hero, artwork, selected object | Scattered CSS recipes | **P1** |
| Decorative object kits | Aesthetic | Original records, tapes, cartridges, stamps, tickets, dossiers, lenses, signal modules, petals, tags, and machine parts as composable SVG families | Seed, palette, density | hero, empty state, panel accent, playlist identity | Theme-local asset packs only | **P2** |

## undefined

| Family | Role | What the infrastructure would provide | Inputs | Natural placements | Current state | Priority |
| --- | --- | --- | --- | --- | --- | --- |

## undefined

| Artwork treatment pipeline | Hybrid | Duotone, halftone, threshold, film, prism, glass, ink, photocopy, thermal, x-ray, pixel, crop, and depth treatments with legibility and missing-art fallbacks | Artwork URL/path, palette, detail, performance | hero, cover, row, mini | Ad hoc CSS filters/masks; no reusable pipeline | **P0** |
| Artwork frame instruments | Hybrid | Turntable wells, museum plinths, sleeves, optical-media trays, monitor apertures, poster clamps, and lens rings independent of the artwork treatment itself | Artwork aspect, playing/focus state | hero, now playing, playlist card, mini | Theme-local | **P0** |

## undefined

| Playlist identity generator | Hybrid | Deterministic marks, monograms, catalog codes, color fields, and original procedural covers for missing/custom playlist art | Playlist id/name/count, seed, palette | library rail, playlist hero, mini fallback | One deterministic glyph utility exists | **P1** |
| Icon and glyph families | Functional | Registered coherent icon sets and state marks with shared literal meanings, optical centering, main/mini parity, and text fallbacks | Control/status meaning | buttons, status, navigation, empty states | One shared icon set plus one seeded glyph grammar | **P1** |

## undefined

| Family | Role | What the infrastructure would provide | Inputs | Natural placements | Current state | Priority |
| --- | --- | --- | --- | --- | --- | --- |

## undefined

| Audio visualizer set | Hybrid | Sixteen existing signal renderers across classic, history, stereo, particle, geometric, mechanical, and woven processes | Normalized visualizer frame | strip, panel, square, hero, background, artwork ring, mini candidate | Built/specimened; not live-wired | Existing foundation |
| Progress and timeline instruments | Functional | Seek-safe tape paths, filmstrips, orbit tracks, groove arcs, waveform rails, seismographs, segmented meters, and chapter-like marks | Duration, position, buffered/loading state | player, hero, mini, row | Backlog plus theme-local CSS | **P0** |

## undefined

| Playback-state signals | Functional | Playing, paused, pending, loading, stopped, unavailable, and failed lamps/locks/receipts with literal labels and non-color differences | Authoritative playback phase and failure state | player, row, hero, mini, status badge | Repeated theme-local treatments | **P0** |
| Compact status instruments | Functional | Quality, codec, source, favorite, queue, offline, processing, output, and availability badges as lamps, stamps, labels, flags, or counters | Standard information bundles | header, row, player, inspector, mini | Shared values exist; embodiments are local | **P0** |

## undefined

| Data ornament generators | Hybrid | Truthful catalog codes, tick fields, track-count scales, duration rings, bitrate ladders, waveform stamps, and seeded metadata marks | Stable literal metadata or explicit deterministic seed | card, hero, metadata, empty space | Theme-local pseudo-elements and one glyph utility | **P1** |
| Meter and gauge library | Functional | VU needles, LED ladders, balance scopes, route meters, peak/headroom indicators, storage/library gauges, and calibration confidence displays | Named audio/diagnostic/information bundle only | tuning, systems, player, inspector | Some audio UI exists; no presentation registry | **P1** |

## undefined

| Output-route diagrams | Functional | Patch bays, room maps, signal paths, speaker racks, and route receipts that never hide the literal device label or availability | Output-route and speaker-system state | player popover, systems, inspector | Theme-local concepts; output truth exists | **P1** |
| Playback neighborhood artifacts | Hybrid | Previous/current/next as tape windows, cards, slips, orbit nodes, media slabs, or cut sheets | `playback.neighborhood` | hero, player overlay, stage | Information bundle live; three profile implementations | **P1** |

## undefined

| Family | Role | What the infrastructure would provide | Host-owned actions/state | Current state | Priority |
| --- | --- | --- | --- | --- | --- |

## undefined

| Interaction-response recipes | Functional | Mechanical compression, paper lift, glass refraction, terminal cursor, stamped selection, elastic press, and focus aperture with no layout shift | hover, focus-visible, press, selected, disabled | Prototype backlog and theme CSS | **P0** |
| Transport control objects | Functional | Turntable, cassette, broadcast, arcade, observatory, deck, and minimal transport assemblies while retaining canonical icons/actions | previous, play/pause, next, shuffle, repeat | Theme-local main/mini styling | **P0** |

## undefined

| Reveal and cabinet mechanics | Functional | Drawer, bay, sleeve, hatch, overlay, telescope, fold, and layered-panel containers with shared open/close/focus/Escape/history behavior | Open state and host navigation callbacks | Shared navigation controller exists; visual embodiments are ad hoc | **P0** |
| Volume and output controls | Functional | Dials, faders, signal ladders, pressure gauges, patch selectors, and route cabinets with literal values/device names | Volume, mute, selected output, unavailable state | Standard controls with theme CSS | **P1** |

## undefined

| Search and filter instruments | Functional | Tuners, command prompts, archive indexes, band selectors, and lookup desks around unchanged search semantics | Query, filters, sort, empty/error state | Dev Lab prototype only | **P1** |
| Queue object mechanics | Functional | Cards, records, documents, messages, train cars, and cassette inserts with reorder/remove/play-next semantics | Queue callbacks and item origin | Dev Lab prototype/theme-local CSS | **P1** |

## undefined

| Tuning instrument faces | Functional | Mixing console, modular patch field, pipe organ, laboratory bench, skyline, and mastering desk embodiments | EQ bands, presets, reset, bypass, output context | Functional EQ exists; styling mostly local | **P1** |
| Workflow stage mechanics | Functional | Intake desk, loading dock, repair bench, archive vault, calibration station, and export desk shells around real multi-step flows | Import/repair/backup/calibration progress and actions | Dev Lab prototypes only | **P2** |

## undefined

| Family | Role | What the infrastructure would provide | Inputs | Current state | Priority |
| --- | --- | --- | --- | --- | --- |

## undefined

| Transition choreography profiles | Hybrid | Short reusable enter/exit/reorder/reveal patterns: wipe, lock, shutter, paper lift, eclipse, dissolve, index resolve, signal handoff | Event kind, affected slot, motion/performance state | Several live maps and CSS classes in `renderer.js` | **P0** |
| Feedback and recovery language | Functional | Success, warning, error, pending, retry, undo, destructive confirmation, and recovery receipts pairing theme metaphor with plain next action | Literal host outcome and recovery action | Theme action overlay and scattered messages | **P0** |

## undefined

| Interface sound profiles | Hybrid | Registered cue packs for hover, press, select, open, close, toggle, adjust, and swipe with rate limits and user volume/mode | Host interaction cue | Rich live module; profiles are hardcoded | **P1** |
| Track-change rituals | Hybrid | Needle find, tape engage, light acquisition, aperture lock, print registration, route arrival, or archive retrieval that confirms rather than delays playback | Requested/confirmed/failed track transition | Theme-local reactions | **P1** |

## undefined

| Family | Role | What the infrastructure would provide | Current state | Priority |
| --- | --- | --- | --- | --- |

## undefined

| General theme-instrument registry | Platform | Validation, stable keys, metadata, availability, lifecycle, allowlists, and deterministic listing for every family | Missing; navigation/information/visualizers each solve part separately | **P0** |
| Product-owned placement slots | Platform | Named ownership boundaries for canvas, hero, stage, player, inspector, rail, overlay, popover, artwork ring, empty state, and mini-specific locations | Five information slots exist; no general instrument-slot contract | **P0** |

## undefined

| Theme recipe descriptor | Platform | Theme-to-instrument mapping with parameters, main/mini relationship, fallback, and compatibility checks | Navigation/information have separate manifest keys; no general recipe block | **P0** |
| Unified specimen foundry | Platform | Side-by-side rendering of materials, artwork treatments, progress, status, controls, atmospheres, and transitions using fixed truth fixtures | Visualizer Foundry and Dev Lab exist separately | **P0** |

## undefined

| Performance and visibility governor | Platform | Shared scheduling, cost budgets, hidden-window suspension, input priority, conserve substitutions, and diagnostics | Window frame-health monitor and visualizer scheduler exist separately | **P0** |
| Accessibility/fallback recipe registry | Platform | Static substitutes, decorative semantics, focus rules, literal labels, high-contrast behavior, and failure fallback checked per instrument | Rules exist in prose and focused contracts | **P0** |

## undefined

| Responsive placement recipes | Platform | Instrument-owned size classes and reflow/collapse/substitute behavior without hiding the associated product job | Per-theme media queries and mechanic-specific narrow rules | **P1** |
| Mini-player composition profiles | Platform | Distinct condensed compositions rather than automatic shrinkage of the main theme; explicit supported instruments and controls | Strong token baseline; composition remains per-theme CSS | **P1** |

## undefined

| Asset provenance manifest | Platform | Machine-checkable file, creator, source, license, modification, role, theme/instrument consumer, and redistribution status | Human-maintained `THIRD_PARTY_ASSETS.md` | **P1** |
| Safe asset packaging/cache | Platform | Content-addressed local assets, size/type/dimension limits, decode failure fallback, and no executable formats | Community package V1 rejects assets; built-in assets are trusted files | **P2**, before community asset support |

## Building the shared pieces

Start with metadata, registry, slot and recipe validation, while leaving each family its own rendering adapter. Navigation, information, visualizers and sound don't need one enormous component API. Cross-check static maps and manifests until live reads are security-reviewed.

Use a foundry with fixed playing/paused/pending/failed states, short and long text, missing/arbitrary art, queue origin and unavailable outputs. Compare desktop/narrow, main/mini, motion, detail and conserve conditions. It makes comparison repeatable; it doesn't establish live Electron, accessibility or listener acceptance.

Materials, artwork frames/treatments, timelines, playback/status indicators, interaction responses and short transitions are useful early consumers. Transport objects, cabinets, volume/output controls, meters, queue objects and tuning faces need stricter host-action/focus contracts. Large scenes, workflow skins and mini compositions should follow an actual theme need, rather than be manufactured in bulk before anyone uses them.

## Admitting a family

Require two credible consumers, or groundwork needed by a selected reference direction. Name truth owners and allowed callbacks. Verify that missing CSS/assets, reduced/off motion, conserve mode and narrow widths preserve the associated function. Interactive pieces need keyboard, names, focus, hit targets, non-color state and Escape/back checks.

Decide whether the mini relationship is shared, distinct or unsupported. Record external-asset rights and provenance. Keep deterministic, painted, perceptual, accessibility, physical and independent-human evidence separate. An attractive one-theme asset kit isn't automatically reusable infrastructure, and a proposed marketplace doesn't supply asset safety or moderation.
