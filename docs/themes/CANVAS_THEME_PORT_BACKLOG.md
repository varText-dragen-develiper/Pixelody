# Canvas theme port backlog

## Scope

This ledger separates the first Canvas-native port pass from future creative
work. The 27 ports below currently preserve their existing palette,
manifest-authored HUD/type/motion traits, existing track-navigation choice, and
a deterministic stock module composition inside the Canvas shell. Each stock
composition declares module coordinates, spans, row scale, gutter, and playback
geometry reconstructed from the theme's archived host version. The exact source
and translation ledger is `CANVAS_THEME_PORT_BASELINE_EVIDENCE.md`. They do not
load the archived theme CSS, introduce new artwork, register a built-in theme,
or claim perceptual acceptance. A first detail pass now gives every port its
own CSS-native material recipe, truthful focus/selection/playback treatment,
and matching mini-player companion. Those reactions use only product state
Pixelody already owns; no BPM, format, network, device, or analysis facts are
fabricated.

Pixelody Studio remains the only registered built-in presentation. Axis Break,
Tideplot, Counterform Choir, Aftergarden, and Vesperfold are later experimental
candidates and are deliberately outside this cohort. Every item under “Later
additions” is an idea bank, not implemented work or an approval decision.
Cartridge Quest is the first exception to the shallow-pass status: its
dedicated reconstruction is recorded in its section, while its remaining
“Later additions” list still names only unimplemented work.

Status vocabulary: **Baseline retained** records the archive-derived starting
point; **First detail pass (implemented)** records what is in the live Canvas
port now; **Later additions** remains the bounded feature queue.

## Dev Lab

**Baseline retained:** Studio-like geometry, pixel identity, quiet motion, and the swapped accent pair that marks this as an internal test surface.

**First detail pass (implemented):** Diagnostic grid material, explicit test-surface stamps, cyan playback confirmation, and focus-resolved module boundaries.

**Later additions:**

- Turn state inspection into a compact, optional diagnostic ribbon rather than decorative developer noise.
- Let active component boundaries briefly resolve on focus so the theme teaches its own anatomy.
- Give playback, selection, and error states distinct test-pattern signatures without changing their truth colors.
- Add a deterministic theme-specimen workspace for comparing controls, long labels, and empty states.

## Orbital Retro-Future

**Baseline retained:** Framed technical HUD language, retro-space palette, signal motion, and the safe linear list.

**First detail pass (implemented):** Clipped mission panels, concentric field lines, cyan/gold instrument seams, and an orbit-like transport lock shown only during real playback.

**Later additions:**

- Map track progress to a restrained orbital sweep around the active node.
- Let queue depth read as concentric mission rings without turning navigation into a novelty dial.
- Use short acquisition ticks for confirmed selections and a separate alert cadence for failures.
- Build an original instrument-panel vocabulary for bitrate, format, and device status.

## Bulkhead Terminal

**Baseline retained:** Industrial terminal framing, technical typography, mechanical motion, and dense arcade posture.

**First detail pass (implemented):** Scanlined equipment steel, hazard-field texture, inset chassis depth, and tactile two-pixel travel on actual button presses.

**Later additions:**

- Give major playback actions guarded mechanical travel and a clear released, armed, and confirmed sequence.
- Translate queue position into an original tactical-range strip rather than borrowed game iconography.
- Add low-frequency equipment vibration only during active playback and only when motion is allowed.
- Develop a legible damaged-terminal empty state that never obscures recovery actions.

## Graphite Loadout

**Baseline retained:** Graphite equipment-panel material, clipped geometry, technical-editorial type, and expressive drift.

**First detail pass (implemented):** Measured equipment grid, clipped bays, lime/cyan signal seams, and active-job emphasis through real keyboard or pointer focus.

**Later additions:**

- Introduce modular equipment bays whose emphasis follows the currently active product job.
- Let BPM influence a very slow panel-light cadence, bounded so reading remains stable.
- Give lossless and output-device facts engraved, hardware-like treatment with honest live status.
- Create a compact inspection mode for queue transitions and crossfade state.

## Obsession Mode

**Baseline retained:** Restrained thriller-poster composition, crimson state ownership, display type, and pulse motion.

**First detail pass (implemented):** Near-black poster field, a single crimson registration axis, editorial selection framing, and crimson confirmed-playback ownership.

**Obsession Mode reconstruction (implemented):** Canvas now declares an explicit Obsession Mode experience while retaining the standard Library / Stage / Inspector / Queue / Now Playing / Transport ownership graph. The archive's four fixed decorative registration seams are removed and replaced by one body-owned mark that travels to the attended object, with confirmed playback outranking selection and selection outranking keyboard focus; form carries the distinction, so an open mark is intent and a solid mark is playback. Repeated plays raise a coarse four-band typographic pressure on the track title only, derived from the existing local `state.playCounts` and never rendered as a number. Focus is treated as editorial reframing through crop and tracking rather than panel glow, and motion-off is authored as its own composition rather than the animated one with the animation removed. The mark and pressure sweeps are installed once against `#trackRows` and are navigation-mechanic agnostic, so no mechanic was forked. The retired `poster-themes.css` remains detached; the two existing Pixelody-declared assets are reused under their record in `THIRD_PARTY_ASSETS.md`.

**Later additions:**

- Give the mark a distinct resting form for an empty collection, so a library with nothing to attend to still reads as composed.
- Let the plate crop respond to artwork aspect ratio once a truthful source for it exists.
- Extend the pressure bands to collections once a per-collection play total is owned rather than derived.
- Design a static-print specimen for every selection, playback, error, empty and motion-off state before any further motion work.

## Crystal Audio

**Baseline retained:** Aqueous prism palette, soft geometry, calm drift, editorial type, and cover-flow navigation.

**First detail pass (implemented):** Layered aqueous facets, bounded caustic light, lilac glass seams, and a small saturation lift only while playback is active.

**Later additions:**

- Refract album color into a bounded caustic field behind, not over, readable controls.
- Couple playback energy to slow waterlight displacement with a strict reduced-motion substitute.
- Give selection and confirmed output separate facets so visual beauty does not blur state truth.
- Create original crystalline placeholders for tracks without artwork.

## Neon Burst

**October 3 listening refinement (implemented):** A fixed-footprint hover/focus
reveal replaces utility height expansion. Indexed section shortcuts and a
read-only source/progress strip share product state with Cosmic Cinema. The
hero is shorter, compact browsers remain usable, inherited cartridge captions
are suppressed, and strong row-hover shadows are contained to an inset marker.
Free desktop recipe selectors and local shop download/application tests are
recorded in the private development notes. Public delivery,
paid entitlements and packaged availability remain open.

**Baseline retained:** Blacklight print energy, pixel-cut controls, phosphor color, mechanical response, and linear navigation.

**First detail pass (implemented):** Halftone field, fluorescent overprint edges, offset print shadows, and distinct pressure travel for a real pressed control.

**Neon Burst reconstruction (implemented):** Canvas now declares an explicit Neon Burst experience while retaining the standard Library / Stage / Inspector / Queue / Now Playing / Transport ownership graph. The archive's fixed 9px and 12px coral offsets are replaced by one body-owned scalar, `--nb-slip`, that every surface in both sheets resolves through; no surface declares an offset distance of its own. Confirmed playback is the only state that brings it to zero, so registration reads as the absence of error rather than as a highlight colour. Following the October 3 owner review, hover uses a contained edge highlight and neutral depth, keyboard focus uses one clear ring, and press uses a 1px inset seat rather than split fluorescent wings. Drag retains the lifted print-plate spread; material registration remains tied to confirmed playback. Halftone pitch is derived from the confirmed playing track's real `track.bpm` tag through the existing `flowTempoValue()` accessor and Flow Shuffle's own `(bpm - 55) / 145` normalisation, banded to an 8–15px pitch; an untagged track gets a line screen at a fixed pitch and an explicit `data-nb-tempo="untagged"` state rather than a mid-density dot screen that would imply a measurement never taken. Pitch is recomputed only on a confirmed track change, so nothing oscillates and the check forbids keyframes or animation in the sheet outright. Motion-off is authored as a larger *fixed* slip with transitions removed — the press stopped mid-run rather than cleaned up — so fluorescent ink contrast survives with nothing moving. Neon Burst declares no assets, so every mark is CSS-generated; the retired `poster-themes.css` remains detached.

**Later additions:**

- Show tempo coverage for the visible collection the way Flow already reports it for the queue, once a collection-level figure is owned rather than derived.
- Give the untagged line screen an affordance that leads to the track editor, so the absence is actionable rather than only legible.
- Let a confirmed output device change register its own plate, once device identity is exposed to the theme layer.
- Design a static-print specimen for every selection, playback, drag, error, empty and motion-off state before any further work.

## Monument

**Baseline retained:** Museum restraint, square plinth geometry, editorial type, motion-off presentation, and carousel navigation.

**First detail pass (implemented):** Warm stone field, lifted paper plinths, collection-label stamps, and static slate confirmation for the current track.

**Later additions:**

- Treat the active album as an exhibited object with a concise, truthful conservation-style label.
- Use room-scale negative space and lighting shifts instead of animated decoration.
- Give queue changes the feel of deliberate re-curation with immediate accessible confirmation.
- Create material variants for stone, bronze, and paper that share one semantic state system.

## Analog Dossier

**Baseline retained:** Compact case-room layout, square paper geometry, editorial type, mechanical motion, and linear navigation.

**First detail pass (implemented):** Ruled dossier paper, red case margin, local-ledger labels, paper shadow, and a double-line catalog mark on confirmed playback.

**Later additions:**

- Turn metadata expansion into a layered file-folder reveal with keyboard-equivalent access.
- Stamp confirmed actions with an original catalog notation while keeping errors visually separate.
- Let playlist provenance and local file facts appear as concise ledger annotations.
- Add gentle paper-handling sounds only as an optional, user-controlled theme effect.

## Cosmic Cinema

**October 3 listening refinement (implemented):** Space Grotesk replaces inherited
retro control text, orbital section shortcuts accompany the existing carousel,
and a compact observatory strip reads confirmed playback, source format/rate/depth,
tagged tempo, queue length and actual progress. Steady seams replace activity-dot
pulsing and the persistent action flare. Library disclosure keeps a stable
footprint. A shorter hero and complete compact browser band keep music visible.
The mini player receives matching type and the existing original calibration
halo when artwork is absent. Free desktop recipe selectors and local shop tests
are recorded in the private development notes; this does not
promote Cosmic Cinema into the built-in registry.

**Baseline retained:** Black-hole observatory framing, technical type, orbital-gravity motion, silver light, and carousel navigation.

**First detail pass (implemented):** Sparse star field, observatory-well stage, silver instrument seams, and a transport orbit visible only during real playback.

**Later additions:**

- Make the active track the stable mass around which queue previews orbit.
- Use track duration and progress to shape a restrained lensing arc without distorting text.
- Give play/pause transitions a cinematic aperture response with an instant motion-off state.
- Develop original observatory readouts for sample rate, output, and upcoming transitions.

## Frosted Void

**Baseline retained:** Liquid-glass darkness, spectral film, square geometry, display type, pulse motion, and linear navigation.

**First detail pass (implemented):** Frosted spectral pools, thin-film edges, translucent black glass, and a focus-cleared reading window that does not cover content.

**Later additions:**

- Let pointer or focus proximity clear a small readable window through the frost.
- Use album color as a thin-film edge response rather than a full background wash.
- Tie playback presence to slow bubble tension while avoiding constant ambient churn.
- Design a high-contrast fallback that keeps the glass identity without transparency dependence.

## Obsidian Glass

**Baseline retained:** Premium black glass, soft geometry, display type, prism accents, calm drift, and linear navigation.

**First detail pass (implemented):** Obsidian depth layers, a restrained cyan prism seam, specular edges, and precise inner light on genuinely active controls and rows.

**Later additions:**

- Give active controls precise edge-lit depth instead of broad neon glow.
- Allow artwork color to produce one restrained prism seam around the playback surface.
- Use inertial panel settling for large navigation changes with an immediate reduced-motion alternative.
- Establish a high-contrast material mode for accessibility and lower-end GPUs.

## Dead Signal

**October 3 retirement:** Previous decorative image files and dedicated Oswald font are removed pending redesign. The implementation history below records the earlier pass; worn-shutter, scratched-metal, dead-tower and tape artwork are no longer bundled or loaded. Palette, code-defined geometry and shared sound behavior remain as a baseline.

**Baseline retained:** Haunted broadcast archive, bone/cyan/crimson ownership, square controls, signal motion, and linear navigation.

**First detail pass (implemented):** Receiver scanlines, haunted archive plate, cyan live trace, and crimson treatment reserved for actually missing media. Elevated with worn-shutter machine panel background, scratched-metal CRT cathode scanline overlay, transparent stage reveal with dead-tower transmission artwork, live carrier-wave RF oscilloscope trace with pulsating amplitude on playing tracks, crimson REC telemetry, tape deck player chassis with dual carrier wave lines, graticule-grid signal monitor inspector cards, 5-lamp receiver scintillation, and Flow Shuffle 3-pill toggle switch console.

**Later additions:**

- Translate playback into a narrow broadcast trace whose dropout indicates real buffering only.
- Give unavailable media a distinct dead-air plate rather than using atmospheric static as fake error state.
- Use original archival marks and transmitter diagrams for empty and loading surfaces.
- Let track transitions produce a brief tuning capture, bounded against flashing and motion sensitivity.

## Meme Machine

**Baseline retained:** Readable dark social layout, soft controls, display type, pulse motion, and intentionally chaotic color energy.

**First detail pass (implemented):** Channel-dark surfaces, blurple seams, clean reading column, and a compact message-like treatment for the truly playing queue item.

**Later additions:**

- Build an original reaction-sticker system driven by real playback events, never random attention theft.
- Let queue edits read like concise bot messages while remaining local and non-social by default.
- Give repeated interactions escalating comic timing with a user-visible calm switch.
- Preserve a clean reading column so jokes never displace metadata or recovery actions.

## Cartridge Quest

**Baseline retained:** Original console-adventure palette, pixel geometry/type, mechanical response, and carousel navigation.

**First detail pass (implemented):** Sixteen-bit grid, beveled chassis, pixel-cut corners, gold deck seam, green playback confirmation, and tactile control travel.

**Cartridge Quest reconstruction (implemented):** Canvas now declares an explicit Cartridge Quest experience while retaining the standard Library / Stage / Inspector / Queue / Now Playing / Transport ownership graph. The port restores the original cartridge rack and save-file hierarchy, title-screen stage, expandable pause/save/route/achievement cabinets, cartridge and loot treatments, truthful party-roster queue, real track-progress boss strip, listening XP/run/high-score/combo cabinet, encounter and import feedback, hardware output bay, optional interface sounds, deterministic action transitions, and the CQ-16 mini link deck. It uses Pixelody's existing locally authored cartridge, controller, console, and workbench assets; the retired built-in stylesheet remains detached. All counters and reactions are tied to owned local playback/library state, and the motion-off/reduced-motion routes preserve static state distinctions.

**Later additions:**

- Let listeners rename the three save slots without changing playlist identity or filesystem data.
- Add an optional per-playlist quest chapter title, stored locally and always editable.
- Give the party roster a compact keyboard-first formation view once queue reordering exposes stable positional receipts.
- Add a static-print specimen for every encounter, error, empty, and motion-off state before any further animation work.

## Sakura Bloom

**Baseline retained:** Washi, lacquer, blossom, and sage materials; soft geometry; calm drift; and linear navigation.

**First detail pass (implemented):** Washi panels, lacquer player deck, sparse fixed blossom marks, sage confirmation, and a soft capsule around the playing row.

**Later additions:**

- Let playback breathe through a sparse branch-and-petal field whose density responds gently to energy.
- Use lacquer depth for active controls and paper texture for informational surfaces.
- Make track transitions a single seasonal gesture rather than continuous falling petals.
- Provide a still composition with equivalent hierarchy for reduced motion.

## Lo-Fi Café

**Baseline retained:** Rainy walnut nook, paper-soft surfaces, moss status accents, calm drift, and linear navigation.

**First detail pass (implemented):** Walnut rails, paper listening stage, night-order labels, moss confirmation, and a warmer stage seam during actual playback.

**Lo-Fi Café reconstruction (implemented):** Canvas now declares an explicit Lo-Fi Café experience while retaining the standard Library / Stage / Inspector / Queue / Now Playing / Transport ownership graph. The reconstruction is built on the archive's own material inversion — dark walnut chrome carrying light paper content — and holds one rule: the room does not change, the paper on it does. Wood geometry is fixed under every action, and only paper surfaces respond to a choice or a play. A new bounded, durably persisted `state.cafeAnchors` list gives the listener a shelf: collections keep a stable place because they were chosen through an explicit menu action, never because recency was mistaken for significance. Paper wear states real plays and a real last-played time from the existing `state.playCounts` and `state.history`, in sentence case, with no superlative, streak or score — and because history is capped at 200 entries a collection with plays but no surviving record says "last time not recorded" rather than being dated. Rain is present only while audio is, behind the wood and never across paper or type. The lamp takes its warmth from the local hour at each confirmed track change rather than a timer, and is admitted into glow alphas only, so the contrast floor holds across its whole range; the check fails if it ever reaches a text colour. The queue becomes order tickets with honest drag and focus. The retired `lo-fi-cafe.css` remains detached and the two CC0 photographs are reused under their existing provenance record.

**Later additions:**

- Add Asher's set-aside space, so collections under consideration can rest somewhere visibly separate from the queue. It needs its own list and its own semantics against the queue, and was deliberately deferred out of this cycle.
- Once set-aside exists, offer the Collector's Table density alongside the current Evening Setting and Working Session arrangements — all three differ in how much paper is on the table, never in where the furniture sits.
- Let a collection's own artwork tint its paper without moving the ink's contrast ratio.
- Revisit room tone as an audio feature with a real mute and routing contract, which is not a theme change and does not belong in a stylesheet pass.

## ASCII Social

**Baseline retained:** AS2-era desktop posture, tactile framed panels, sparse character identity, expressive pulse, and linear navigation.

**First detail pass (implemented):** Character-grid desktop, inset window chrome, AS2 local labels, cyan playback confirmation, and dashed terminal-cursor focus.

**Later additions:**

- Use characters as semantic meters and separators, not as a blanket readability gimmick.
- Give focus traversal a visible terminal cursor that never conflicts with text entry.
- Turn playback events into short, deterministic system notices with no fake network activity.
- Create compact and spacious density modes using the same desktop-window grammar.

## Poster Pop

**Baseline retained:** Listening-party flyer composition, sticker softness, oversized display type, pulse motion, and linear navigation.

**First detail pass (implemented):** Three-color flyer field, pasted-paper modules, hard ink shadows, and a green playing sticker with a slight physical skew.

**Later additions:**

- Recompose the hero area per album using bounded color blocks rather than moving product controls.
- Give saved, queued, and playing states distinct original sticker shapes.
- Let transitions behave like physical paste-up swaps with a static alternative.
- Build a print-safe, high-contrast variant that retains the theme's graphic voice.

## Creator Layer

**Baseline retained:** Compact voice-room companion posture, soft controls, technical type, calm pulse, and linear navigation.

**First detail pass (implemented):** Voice-room graphite, blurple channel seams, compact local labels, and a green production tally driven only by real playback.

**Later additions:**

- Add an optional broadcast-safe now-playing card with explicit privacy boundaries.
- Surface mic, stream, and playback ownership only when those real integrations exist.
- Provide a second-monitor density that favors glanceable queue and output facts.
- Give scene changes a restrained live-production tally language with accessible labels.

## Modular Signal

**Baseline retained:** Lavender, blush, and black poster system; square modules; technical type; mechanical motion; and linear navigation.

**First detail pass (implemented):** Lavender/blush poster blocks, structural black ink, hard offset shadows, and explicit patch outlines only while Canvas composition editing is active.

**Later additions:**

- Let users rearrange a bounded set of visual modules without changing product ownership.
- Route playback state through visible signal paths that terminate at the real output indicator.
- Use module insertion/removal motion only during actual workspace changes.
- Create print-like blank modules for loading, empty, and unavailable states.

## Cut Sheet

**Baseline retained:** Mastering-sheet paper, circuit ink, terracotta routing, square technical controls, and linear navigation.

**First detail pass (implemented):** Session-sheet ruling, terracotta route margin, concentric groove field, and a bounded groove texture on confirmed playback without implying source mastering.

**Later additions:**

- Render track chapters and transitions as original lathe annotations tied to real timing.
- Give EQ changes a reversible pencil-mark layer without implying mastering changes to source files.
- Use groove density as a restrained progress texture with a plain accessible fallback.
- Build an exportable session-note view only after its data and privacy contract is defined.

## Acid Transit

**Baseline retained:** Holographic night-route system, clipped modules, strict two-color state ownership, expressive mechanical motion, and linear navigation.

**First detail pass (implemented):** Magenta/lime route field, clipped station modules, holographic seam, and a current-stop line on the actually playing queue item.

**Later additions:**

- Map the queue to a readable transit line with explicit current, next, skipped, and unavailable stops.
- Let playback progress move one vehicle marker rather than animating the whole map.
- Use access-tape gestures for temporary modes and clear them immediately when the mode ends.
- Create delay and reroute metaphors only for real buffering or queue changes, never decoration.

## Ghost Index

**Baseline retained:** Spectral archive palette, bone micrographics, rare green/coral depth, signal motion, and spectral-field navigation.

**First detail pass (implemented):** Bone index grid, restrained specimen traces, coral focus proximity, and stable green registration reserved for confirmed playback.

**Later additions:**

- Let nearby tracks resolve from faint index traces as focus approaches them.
- Give confirmed playback a stable green registration while coral remains reserved for interruption or conflict.
- Develop original specimen glyphs from library metadata without exposing private paths.
- Add a static indexed-grid fallback that preserves spectral hierarchy without atmospheric motion.

## Violet//Violent

**Baseline retained:** Violet intent, cyan confirmation, framed technical layers, expressive mechanical motion, and memory-cascade navigation.

**First detail pass (implemented):** Offset optical layers, violet intent framing, cyan playback confirmation, and matching state separation in the mini companion.

**Later additions:**

- Strengthen the distinction between remembered context, current intent, and confirmed output across every panel.
- Let navigation history leave short-lived optical echoes with a strict count and lifetime.
- Map strong beats to small interference changes only when audio analysis is active and trusted.
- Design a no-motion optical-layer variant based on contrast and offset rather than animation.

## Abyssal Press

**Baseline retained:** Pressure-printed oceanographic strata, square technical framing, expressive mechanics, and pressure-stack navigation.

**First detail pass (implemented):** Pressure-band field, cream plate seams, magenta record marks, stable current-item registration, and cyan confirmed playback.

**Later additions:**

- Let queue depth create legible pressure bands while the active track remains spatially stable.
- Use real loudness or spectral data to emboss one bounded print field, never the text layer.
- Give transitions a controlled plate-lift action with an immediate reduced-motion substitute.
- Develop original depth marks and specimen labels for metadata and playback status.

## Harmonic Registry

**Baseline retained:** Daylight specimen-book palette, technical display language, calm mechanics, separated intent/playback truth, and linear navigation.

**First detail pass (implemented):** Daylight specimen paper, ruled registry grid, black technical framing, violet intent, and a separate cyan confirmed-playback registry mark.

**Later additions:**

- Organize related tracks into visually quiet harmonic specimen families without claiming objective compatibility.
- Show key/BPM evidence with provenance and uncertainty when analysis data is available.
- Let confirmed playback apply a precise registry mark distinct from selection intent.
- Create comparison sheets for queue alternatives while keeping the chosen path obvious and reversible.
