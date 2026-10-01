# Pixelody Theme Records

Read `../../docs/themes/THEME_SYSTEM.md` before editing themes.

## What This Directory Does

- `built-in-themes.json` maps every selectable runtime key to its manifest and implementation files.
- `*.theme.json` records each theme's palette, assets, HUD, typography, and motion intent.
- `theme.schema.json` defines the portable manifest format.
- `template.theme.json` is the starting point for a new manifest.
- `starter-themes.json` is a legacy idea backlog, not a list of implemented or promised themes.

Pixelody Studio is the only selectable built-in presentation during the active foundation reset. The other manifests remain reconstruction records and their implementation is preserved in the pre-reset imprint archive, not linked into the live shell. On Windows, parsing and storage for the bounded declarative `community-theme-template.pixelody-theme` format remain implemented, but Settings > Themes > My Themes and package application are deliberately unavailable during the reset. Pixelody does not discover arbitrary community folders, read built-in `*.theme.json` files as installable packages, accept assets/fonts/CSS/scripts/URLs, or load executable mods.

Canvas has a separate 27-entry baseline port registry at `../theme-runtime/canvas-theme-ports.js`. It copies manifest-authored presentation traits into Canvas-owned recipes and gives every port a normalized stock composition with explicit module coordinates, spans, spacing, row scale, and playback split, while leaving this built-in registry Studio-only and every retired stylesheet detached. Future creative additions are kept separately in `../../docs/themes/CANVAS_THEME_PORT_BACKLOG.md`.

A manifest may optionally declare a `navigation` block to select how tracks/playlists are browsed. The registered mechanics are `linear-list` (the original scrolling row list and every theme's implicit default), `carousel`, `cover-flow`, `spectral-field`, `pass-deck`, and `memory-cascade`. Current non-default assignments are recorded in `built-in-themes.json`; Violet//Violent uses `memory-cascade`, while `pass-deck` remains tested infrastructure preserved from its rejected prototype rather than a current theme assignment. See `../theme-runtime/navigation/contract.md` for the full contract, including a step-by-step guide to building and shipping a new mechanic, and `../../docs/themes/THEME_RUNTIME_ARCHITECTURE.md` for the rollout history. The running app does not read built-in `*.theme.json` directly; those manifests remain documentation of intent cross-checked by `npm run check:themes`. Local `.pixelody-theme` packages pass through the separate hostile-input contract in `../theme-packages/contract.js` and may only select registered mechanics. If you add or reassign a mechanic, the built-in map and manifest have to agree or the check fails. Run `npm run check:linear-list` and whichever `check:<mechanic>` applies, plus `npm run check:navigation-platform`, `npm run check:themes`, and `npm run check:theme-packages` after touching the shared platform.

A manifest may also optionally declare a `tokens` block (semantic palette names) — see `theme.schema.json` and `../theme-runtime/tokens.js`. Unlike `navigation`, nothing reads `tokens` at runtime yet; it's schema-valid and tested infrastructure, not a live feature.

A manifest may optionally declare `information.profile` to select a registered, read-only information composition. The live profile modules and standard truth bundles are under `../theme-runtime/information/`; see its `contract.md`. As with navigation, the manifest is cross-checked against the current `themeInformationProfiles` runtime map because manifests are not read directly by the renderer yet. Profile keys select shipped code only: manifests cannot provide HTML, JavaScript, selectors, or state owners. Run `npm run check:theme-information` and `npm run check:themes` after adding or changing a profile.

## Safety

Manifest asset paths must be relative. Remote URLs and executable theme scripts are unsupported. This keeps future community themes portable and prevents visual packages from becoming arbitrary application code.

Run `npm run check:themes` after any theme change.
