# Pixelody Theme System

## Current Reality

The 2026-08-25 Studio foundation reset remains active. Pixelody Studio is the only
registered and selectable built-in presentation. `STUDIO_REBUILD_MODE` in
`src/renderer.js` is `true`, stale durable theme selections fail closed to Studio,
and the Settings picker contains one Studio card.

The live main and mini shells load shared product styles plus
`src/studio-rebuild.css` / `src/mini-studio-rebuild.css`. Retired per-theme and
community-package stylesheets are detached. The Canvas sheets
remain linked but disabled, and may be enabled only by the development-only
runtime profile.

Development builds add an explorer to Settings > Themes: Studio under "Ready to
use", then Canvas Studio, the two Singularity routes under
"In development", grouped Active / Paused. They are launch entries, not
registrations, and Singularity sessions never write Studio's
appearance or layout. See `CANVAS_AND_STUDIO_GATES.md`.

The owner-authorized 2026-09-20 baseline port pass adds 27 Canvas-only
presentation recipes in `src/theme-runtime/canvas-theme-ports.js`. A Canvas port
reuses the existing palette plus the source manifest's HUD, typography, motion,
and navigation choices inside Canvas-owned topology. Every port also defines a
complete stock composition graph reconstructed from its detached host version:
the archive's Library / Stage / Inspector order and proportions, measured gap
and padding, Stage-contained signal field, Inspector/Queue utility relationship,
and player height/column sizing. The evidence and translation boundary are in
`CANVAS_THEME_PORT_BASELINE_EVIDENCE.md`. Port switching commits that stock graph
atomically; later user edits remain graph-authoritative and Restore Creator
returns to the selected port's stock arrangement. It does not register a
built-in theme or load the archived implementation. The five later experimental
candidates (Axis Break, Tideplot, Counterform Choir, Aftergarden, and Vesperfold)
remain outside this cohort. Future identity additions are recorded, but not
implemented, in `CANVAS_THEME_PORT_BACKLOG.md`.

The Windows V1 local theme-package parser and store remain implemented, but their
My Themes presentation/application surface is deliberately unavailable during the
reset. Installed packages remain preserved on disk; the community main/mini CSS is
not linked and the manager remains hidden.

V1 is intentionally limited to normalized semantic colors and product-owned HUD, typography, motion, navigation, and information recipes. It rejects package assets, fonts, raw CSS, scripts, URLs, and executable content. Arbitrary community folders, archive extraction, creator export, contained preview/revert, signed gallery delivery, public uploads, and behavior-changing mods remain future work.

A future rebuilt theme still requires coordinated HTML, JavaScript, CSS,
mini-player CSS, and manifest changes, plus an explicit decision about which
Studio mechanics are inherited, recomposed, or replaced.

`src/themes/built-in-themes.json` is the authoritative source map. `src/themes/*.theme.json` records design intent and asset choices. Runtime palette values currently live in `paletteDefinitions` inside `src/renderer.js`.

The visual thesis, motifs, and non-goals for retired themes remain preserved in
`THEME_CATALOG.md`; catalog presence does not currently mean runtime availability.

**How a theme browses tracks/playlists is now a separate, pluggable concern from its colors.** A theme can assign a registered *navigation mechanic* (`linear-list`, the plain scrolling row list; `carousel`, a focus-driven horizontal strip; `cover-flow`, a reflective depth shelf; `spectral-field`, a perspective event corridor; `pass-deck`, a single-confirmed-position information-pass stack; `memory-cascade`, a vertically layered optical-media field; or `pressure-stack`, vertical typographic strata around one confirmed depth datum) instead of being hardcoded to one layout. This is documented in full in `src/theme-runtime/navigation/contract.md` — read that before building a new mechanic or wiring one to a theme. This file covers just enough to add a theme using an *existing* mechanic; it does not re-explain the contract.

Status of the broader platform work (token/palette semantics, lazy per-theme CSS loading) is tracked in `docs/themes/THEME_RUNTIME_ARCHITECTURE.md`, including what's actually live versus built-but-not-wired versus reverted after breaking in real use. Don't assume something described in that doc is active in the running app without checking its status there — several pieces (the semantic `tokens` shim, lazy CSS loading) are real, tested code that intentionally isn't wired into `index.html`/`renderer.js` yet.

**How truthful information is grouped and displayed is also separate from the shared baseline DOM.** `src/theme-runtime/information/` now exposes stable, read-only bundles such as `collection.summary`, `playback.neighborhood`, `playback.technical`, `output.route`, `queue.summary`, and `artwork.summary`. A built-in theme can select a registered information profile that mounts only the regions it needs into product-owned slots. Read `src/theme-runtime/information/contract.md` before adding a profile or a reusable bundle. Counterform Choir is the first migrated example; its hero/player HUD is no longer prepackaged in `index.html` for every other theme.

The broader reusable-building-block roadmap is cataloged in `THEME_ASSET_INFRASTRUCTURE_CATALOG.md`. It covers aesthetic, functional, and hybrid theme instruments—materials, artwork treatments, progress, status, controls, atmosphere, choreography, sound, composition slots, and supporting registries—while distinguishing live infrastructure from partial foundations and genuine gaps.

## Cascade Order

When a retired theme is deliberately reconstructed and re-admitted, its styles
must load after shared component styles. The archived cascade was:

1. Shared UI and behavior styles.
2. Core theme files.
3. `acid-tech-terminal.css`, the final Graphite Loadout refinement.
4. `poster-themes.css`, the Poster Collection.
5. `settings-streamlined.css`, cross-theme settings normalization.
6. `playback-performance.css`, the final adaptive performance safety layer.

Do not use this archived ordering as permission to relink retired stylesheets.
Re-admission requires an explicit owner decision and coordinated registry, picker,
main/mini CSS, runtime, manifest, and evidence changes. Prefer a focused selector
such as `body[data-theme="theme-key"]` and avoid global rules in theme files.

The renderer normally runs at `body[data-performance="balanced"]`: theme choreography remains active, while large backdrop blurs and redundant stacked signal-glow layers are reduced. A window-wide frame-health monitor (not playback-only) temporarily sets `body[data-performance="conserve"]` when repeated slow frames or long main-thread tasks are detected, pauses decorative animation, and removes expensive filters until delivery stabilizes. Hidden main and mini windows pause animation work. Themes must remain readable and fully operable in balanced, conserve, motion-off, and OS reduced-motion states.

## Add A Built-In Theme

1. Define a short visual thesis and non-goals.
2. Choose a lowercase runtime key, for example `crystal`.
3. Add a `paletteDefinitions` entry in `src/renderer.js`.
4. Add the key to `alternateThemes` in `selectTheme()`.
5. Add a selector card in `src/index.html` with `data-theme-option`, `data-theme-tags`, name, summary, and preview class. Note: this preview class (e.g. `.meme-machine-preview`) is unscoped CSS deliberately — it has to render in the theme picker regardless of which theme is currently active, unlike everything else in the theme's stylesheet. Don't move it under `body[data-theme="..."]`, and don't assume it's safe to lazy-load away with the rest of the file (see `docs/themes/THEME_RUNTIME_ARCHITECTURE.md`'s Phase 4 section for the real incident this caused).
6. Add main-window CSS scoped to `body[data-theme="..."]`.
7. Add mini-player CSS scoped to the same key. `mini-player.css` now exposes a `--mini-*` custom-property baseline (shell radius/border/background/shadow, art size/radius/border/background/glyph color, copy eyebrow/title/meta/time colors and fonts, progress geometry/fill, transport-button and play-button size/radius/border/color/shadow) — override only the properties your theme actually changes on `body[data-theme="key"]` instead of re-declaring whole selector blocks. Add bespoke selectors/pseudo-elements only for motifs the tokens don't express (image-layer overlays, clip-path silhouettes, gradients, animations). `mini-cut-sheet.css` (the newest built-in theme as of this writing) and `mini-dead-signal.css`/`mini-ascii-social.css`/`mini-bulkhead-theme.css`/`mini-retro-theme.css` (orbital) are worked examples of this pattern — start from one of those rather than an older un-migrated file.

   **Two pitfalls found migrating the first batch of themes onto tokens, worth knowing before you touch another:**
   - `--mini-btn-color` / `--mini-btn-hover-color` drive **both** `.mini-controls button` (the transport row) and `.window-actions button` (close/restore) at once, because the base rule styles them together. Most existing themes only ever recolored the transport row and left window-actions at its default gray — if you set these tokens to match a theme's transport color, you will also silently recolor its window-action buttons, which is a real visual change, not a no-op refactor. When a theme should only touch the transport row (the common case), keep using a scoped selector — `body[data-theme="key"] .mini-controls button { color: ... }` — instead of the token. Only reach for the token when a theme actually wants both button groups to share a color.
   - `--mini-play-size` assumes a **square** play button (it sets both width and height). Several themes give the play button a rectangular shape (e.g. 44×38); for those, set `width`/`height` directly on `body[data-theme="key"] .mini-controls .mini-play` instead of `--mini-play-size`, and use the other play tokens (`--mini-play-border`, `--mini-play-bg`, `--mini-play-color`, `--mini-play-shadow`, `--mini-play-radius`) as normal.

   A theme file that still fully re-declares shell/art/copy/controls blocks instead of using these tokens isn't broken — it just hasn't been migrated yet. Migrating one is a good, low-risk task on its own; do it by diffing the theme's current computed values in a running mini player against the token defaults, moving only the properties that have a matching token, and leaving genuinely bespoke selectors (backgrounds with images, clip-paths, keyframe animations) alone. Also check for duplicate/competing rule blocks for the same selector while you're in a file — `mini-cartridge-quest.css` and `mini-graphite-loadout-theme.css` both had two full copies of their shell/art/copy rules stacked back to back (an apparent leftover from an earlier edit), where the second silently won on every shared property and the first was dead code; both were consolidated down to one block each. If you see this pattern elsewhere, consolidate it the same way rather than adding a third layer on top.
8. **Make an explicit navigation-mechanic decision.** `linear-list` is the runtime
   safety fallback when no enhanced mechanic can load; it is not the automatic
   creative choice for a serious reference-based theme. Evaluate the registered
   mechanics (`linear-list`, `carousel`, `cover-flow`, `spectral-field`, `pass-deck`,
   `memory-cascade`, and `pressure-stack`) against the frozen spatial topology. If
   none expresses the concept's governing relationships, specimen and build the
   least-invasive new pluggable mechanic instead of forcing the concept into the
   easiest existing option. Retaining `linear-list` requires rendered evidence that
   its sequencing, selection model, density, and motion are conceptually strongest,
   not merely cheapest. Add the selected runtime key to `themeNavigationMechanics`
   in `src/renderer.js` and the matching `"navigation": { "trackBrowser":
   "<mechanic-key>" }` block to the theme manifest (step 10); `npm run check:themes`
   fails if these disagree. Put mechanic-specific visual treatment under the
   theme-scoped selector in the theme CSS.
9. **Make an explicit information-bundle decision.** Reuse the baseline DOM when its grouping is conceptually strongest. Otherwise, request existing read-only bundles from a theme-owned information profile and mount that profile into registered product slots. Do not add another theme's full HUD to `index.html`, duplicate state projection in `renderer.js`, or invent factual-looking CSS content because the needed field is inconvenient to reach. Add a shared bundle only when its truth owner and cross-theme meaning are stable.
10. Create or update a schema-valid manifest in `src/themes`; declare `information.profile` when the theme uses a registered profile.
11. Register every implementation file in `src/themes/built-in-themes.json`.
   Add licensed assets only under `src/assets/themes/<theme>/` and update `THIRD_PARTY_ASSETS.md`.
12. Verify settings, library, systems view, inspector, track editor, queue, player bar, mini player, narrow width, and motion-off mode — and verify the selected navigation mechanic separately: full keyboard operation, a visible single-selected-item indicator, and that clicking/keying through it actually changes what's playing and only ever shows what's actually playing as selected (this exact thing broke twice in real use before landing on `carousel.js`'s current design — see its module comment for why that class of bug happens and how the fix avoids it structurally).
13. Run `npm run check:themes` and `npm run check:theme-information`, plus `npm run check:navigation-platform` and whichever `check:<mechanic>` script exists if you touched anything under `theme-runtime/navigation/`.

## Required Design Brief

Every theme should answer these before implementation:

- Thesis: one sentence describing the experience.
- Use cases: genres, listening contexts, or user moods it complements.
- Palette: base, surfaces, text, muted text, primary/secondary accents, state color.
- Color discipline: where accents appear and where they must not.
- Typography: UI, display, and metadata roles.
- Geometry: cards, corners, borders, artwork frame, button shape.
- Density: compact, balanced, or spacious.
- Motion: hover, press, selection, track change, panel reveal, reduced-motion substitute.
- Signature motifs: no more than three recurring decorative ideas.
- Non-goals: visual cliches or readability failures to avoid.

## Shared Runtime Contract

Theme palette objects support:

`gold`, `gold2`, `green`, `hero`, `bg`, `surface`, `surface2`, `surface3`, `line`, `edge`, and optional `text` and `muted`.

These historical token names remain for compatibility. Treat them semantically as primary accent, secondary accent, state accent, hero tone, canvas, three elevations, divider, frame, foreground, and secondary foreground. `src/theme-runtime/tokens.js` has the exact mapping to real semantic names (`accentPrimary`, `canvas`, `elevation1`, etc.) as a tested conversion function, for whenever manifests start declaring `tokens` directly — not consumed anywhere yet, but the names above aren't informal, they're this file's key set.

Theme state is applied as `body[data-theme="runtime-key"]`. Motion and detail are independent attributes: `data-motion` and `data-detail`. Individual animation classes also follow the persisted motion-effect settings.

How tracks/playlists render is a separate contract from the above — see `src/theme-runtime/navigation/contract.md`. In short: `mount(container, tracks, {onSelect, onActivate, onContextMenu, activeId})` / `update(tracks, activeId)` / `destroy()`, plus six non-negotiable requirements every mechanic must meet (full keyboard operation, exactly one visible selected item, the shared lifecycle callbacks, motion-off compliance, narrow-width legibility, leave the mini player alone) so switching a theme's mechanic never disorients a user who already knows the app.

Information presentation is a third separate contract; see `src/theme-runtime/information/contract.md`. Application state is normalized once into a host snapshot, reusable bundles project stable read-only meanings, and a registered profile decides which bundles appear in which product slots. A manifest may select a shipped profile key but may not provide executable markup. A theme with no profile receives no extra HUD and continues through the shared fallback presentation.

## Core Theme Additions

- Cartridge Quest: original 8/16-bit console hardware, cartridge storage, pixel landscapes, RPG selection states, and game-HUD playback feedback.
- Sakura Bloom: original calm hanami room with shaded washi surfaces, CSS floral overlays, and soft green signal state.
- Obsidian Glass: original premium black-glass default with frosted floating panels, rounded mobile-like controls, large glossy artwork, and soft prism/x-ray audio light.
- Lo-Fi Café: original rainy walnut listening nook with dark wood structure, paper-soft content surfaces, amber playback light, moss/nature status accents, muted rain-glass depth, CC0 StockSnap café/study-desk photo atmosphere, and slow low-noise motion.
- Violet//Violent: original layered optical-memory instrument; suspended hero core, transparent circuit planes and signal buses, edge-lit collection capsules, violet intent, cyan confirmed playback, and a dimensional single-position Memory Cascade.
- Abyssal Press: original pressure-printed oceanographic record; oversized typographic strata, explicit translucent signal volumes, cassette-like utility rails, magenta intent, cyan confirmed state, and a single-position Pressure Stack.

## Poster Collection Map

- Obsession: black/crimson psychological thriller; sharp fractures; dramatic red states.
- Crystal Audio: navy glass, cyan/lavender/pink refraction; soft reflective movement.
- Neon Burst: blacklight overprint-lab energy; dark ink, pressure-glow edges, registration marks, and controlled kinetic accents.
- Monument: private listening museum; stone plinths; conservation labels; measured light.
- Analog Dossier: personal audio case room; file-cabinet rail, ledger tracks, lab reports, black type, field green, burnt orange, catalog/seismograph language.
- Cosmic Cinema: deep-space poster hierarchy, orbital framing, cream/gold/blue signals.
- Frosted Void: opaque black acrylic, white glass artifacts, and spectral audio refraction.
- Dead Signal: black/bone/crimson analog horror; haunted tape and broken-transmission language.
- Meme Machine: dark social music-bot surfaces, licensed reaction stickers, channel-like library navigation, and playful state motion.
- Poster Pop: listening-party flyer UI with sticker-sheet graphics, thick ink outlines, oversized friendly controls, and bright print-color blocking.
- Creator Layer: dark voice-room media companion; community-app ergonomics, blurple action color, online-green playback state, channel-like music navigation, and in-hero cosmetic Room Style controls without copied brand assets.
- Modular Signal: lavender modular-design poster; blush signal routes, black structural ink, circular audio instrumentation.
- Cut Sheet: vinyl mastering cut sheet; deep aubergine field, terracotta signal routes, ink corner registration marks, lathe-groove turntable instrument.
- Acid Transit: holographic night-route system; fluorescent access tape, offset depth framing, pearlescent interference, acid-lime playback, and hot-magenta selection.
- Ghost Index: spectral systems archive; giant system identity, event-horizon aperture, source-tree collections, a perspective event corridor, editorial/mono evidence typography, and a persistent evidence bus.

## Licensing Rule

Reference does not equal permission. Never copy commercial poster art, game screenshots, logos, character art, weapons, album covers, or social-media images into the app. Use original CSS/SVG work or assets whose license explicitly permits redistribution and modification. Record creator, source, license, bundled files, and use in `THIRD_PARTY_ASSETS.md`.
