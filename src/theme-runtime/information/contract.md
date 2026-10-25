# Information bundles and profiles

A profile arranges read-only application information in product-owned slots. It doesn't copy the default theme's DOM or take over playback/library state. The host projects state into registered bundles; the profile chooses only what it uses and removes its roots when replaced.

Bundle keys keep one meaning across themes. Results contain literal values or explicitly derived summaries, never invented telemetry. Missing/unselected profiles add no HUD and leave normal controls available.

## Standard inputs

- `collection.summary`: collection identity and track count.
- `playback.neighborhood`: confirmed previous/current/next, position, total and phase.
- `playback.technical`: format, depth, rate and duration.
- `output.route`: effective output label.
- `queue.summary`: queue count.
- `artwork.summary`: collection artwork availability.

Reusable inputs go in bundles.js. An extension needs a named data owner and a stable read-only meaning; changing a label belongs in the profile.

The v1 slots are hero.overlay, hero.content-end, stage.overlay, player.overlay and inspector.content-start. Profiles use these keys rather than arbitrary selectors. A new slot needs a real function and understood fallback.

## Adding a profile

Create `information/profiles/<profile-key>.js`, declare its inputs and regions, and use data-theme-info-field for projected values. Controls stay with host actions or separately contracted mechanics. Register the script before renderer.js, add the checked runtime map and declare information.profile in the manifest. Run check:theme-information, check:themes and the theme's focused check.

Counterform Choir was the first migrated example: its neighborhood HUD no longer sits in every theme's baseline markup. Built-in profiles are shipped code selected by key. A community manifest cannot supply HTML or JavaScript here; broader support needs a reviewed allowlist or separately designed declarative format.
