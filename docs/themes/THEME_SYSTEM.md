# Working on themes

The August 25 Studio reset still defines desktop availability: Studio is the sole rebuilt-shell `themes` registration, while Obsession Mode and Cartridge Quest are separately allowlisted `compositionPresentations`. `STUDIO_REBUILD_MODE` stays true. Missing/stale selections return to Studio; the old 33-theme stylesheet runtime isn't restored.

Main/mini shells use shared styles and the Studio rebuild layer. Canvas sheets start disabled and activate only for a permitted presentation. Other ports and Canvas/Singularity launch profiles stay development-only. Follow [Canvas and Studio gates](../architecture/CANVAS_AND_STUDIO_GATES.md) before touching registry, picker, launch flags or head links.

Android has its own appearance rule: named themes are authored looks; Studio owns palette, type and per-screen background editing. Switching away preserves those choices without rendering them. Text size and high contrast remain available. This doesn't change desktop availability.

## Sources and saved layouts

`src/themes/built-in-themes.json` maps implementations. Manifests record intent/assets, while live palette values still come from `paletteDefinitions` in `renderer.js`. The app doesn't read arbitrary manifests at runtime.

The 27-port Canvas cohort uses current palettes and manifest traits inside Canvas-owned topology. Each has a complete stock graph translated from its archived host. A switch atomically restores that presentation's saved graph or stock graph; unsaved drafts block it. User graphs remain authoritative and Restore Creator returns to that port's stock. Axis Break, Tideplot, Counterform Choir, Aftergarden and Vesperfold sit outside that baseline cohort.

The V1 local package parser/store remain implemented and preserve installed packages, but My Themes is hidden during the reset. Packages can select normalized colors and shipped HUD/type/motion/navigation/information recipes. Assets, fonts, raw CSS, scripts, URLs, archive extraction, arbitrary folders, public uploads and executable mods aren't supported by that contract.

## Choosing presentation code

Track browsing, information grouping and color are separate concerns. Navigation mechanics have a registry and lifecycle; information profiles consume read-only bundles in product-owned slots. A theme mustn't create another playback owner or add a full private HUD to every other theme's markup.

Read [navigation](../../src/theme-runtime/navigation/contract.md), [information](../../src/theme-runtime/information/contract.md) and [runtime architecture](THEME_RUNTIME_ARCHITECTURE.md). Registered mechanics include linear-list, carousel, cover-flow, spectral-field, pass-deck, memory-cascade, pressure-stack and later experimental entries listed in the runtime reference. Choose the mechanism that fits the layout; linear-list is a safe fallback, not an automatic design decision.

The shared lifecycle is `mount(container, tracks, {onSelect, onActivate, onContextMenu, activeId})`, `update(tracks, activeId)`, `destroy()`. Keep keyboard access, one clear active state, host callbacks, narrow-width use and motion-off behavior. Browsing intent mustn't pretend a request has already changed playback. Mechanics don't own the mini-player.

## Implementing an admitted theme

Write the intended experience, palette roles, type, geometry, density, motion/static treatment and a few recurring motifs. Use the [catalog](THEME_CATALOG.md) for direction, not availability. Decide what Studio behavior is retained or replaced.

1. Choose a lowercase runtime key and coordinate palette, theme selection, picker, main/mini styles and a schema-valid manifest.
2. Scope theme styles to `body[data-theme="key"]`. Picker preview rules are an exception: they must render even when another theme is active. Don't hide them inside the active-theme scope or disable their sheet without moving previews into an always-loaded file.
3. Cross-check `themeNavigationMechanics` with `navigation.trackBrowser`, and declare `information.profile` only for a shipped registered profile. Reuse read-only bundles instead of inventing factual CSS content or duplicating state projection.
4. Register implementation files and licensed assets under `src/assets/themes/<theme>/`; update `THIRD_PARTY_ASSETS.md`. Adding an entry alone doesn't authorize it in the production picker.
5. Inspect settings, library, systems, inspector, editor, queue, transport and mini-player at normal/narrow widths, motion off and reduced motion. Test focus, keyboard, context menu and actual confirmed activation.

Run `npm run check:themes`, `check:theme-information`, `check:navigation-platform` and the mechanic-specific check when relevant, then `npm run check`. Visual behavior needs the running app too.

## Mini-player styling

Use the `--mini-*` baseline for shell, artwork, copy, progress and buttons where it matches the existing appearance. Keep bespoke overlays, clipping and animations scoped. Compare computed values before migrating a theme and consolidate dead duplicate blocks rather than layering another override.

`--mini-btn-color` and its hover counterpart affect transport and window-action buttons together. Use a transport-only selector when close/restore should remain unchanged. `--mini-play-size` makes a square; rectangular buttons need explicit width/height with the other play tokens.

## Shared state and performance

Legacy palette keys are `gold`, `gold2`, `green`, `hero`, `bg`, `surface`, `surface2`, `surface3`, `line`, `edge`, with optional `text` and `muted`. Treat them as semantic accents, canvas/elevations, dividers, frames and foreground. `tokens.js` has the tested conversion, but it isn't wired into live manifest reads.

Theme state uses `body[data-theme]`; motion/detail are independent. Balanced mode trims expensive blur/glow. Repeated slow frames/long tasks trigger conserve; hidden windows pause decoration. All controls remain readable and usable in those states.

The archived cascade ended with settings normalization and `playback-performance.css`. It isn't permission to relink retired files. See [the runtime history](THEME_RUNTIME_ARCHITECTURE.md) for the lazy-CSS rollback and [instrument catalog](THEME_ASSET_INFRASTRUCTURE_CATALOG.md) for reusable presentation pieces.

Use original or redistribution-compatible assets and record creator, source, license, files and modifications. Reference images, commercial posters, game screenshots and logos don't become usable assets just because they inspired a theme.
