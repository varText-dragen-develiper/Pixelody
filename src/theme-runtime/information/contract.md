# Theme Information Bundle Contract

Theme information is a projection layer between Pixelody's authoritative state and a theme's visual composition. It exists so a theme can reorganize, reveal, omit, or restyle information without copying the default theme's DOM or taking ownership of playback/library data.

The dependency direction is fixed:

`authoritative application state -> registered information bundles -> registered theme profile -> product-owned composition slots`

## What stays constant

- Application domains remain the only truth owners. A bundle is read-only.
- A bundle key has one stable meaning across every theme.
- Bundle results contain literal data or explicitly derived summaries; they do not invent telemetry.
- Profiles may request only the bundles they use and may mount only in registered product slots.
- Switching profiles removes the previous profile's roots. A theme never leaves hidden HUDs in the shared baseline DOM.
- Missing or unselected profiles produce no extra presentation. Core Pixelody controls remain the fallback.

## Standard bundle keys

- `collection.summary`: active collection identity and track count.
- `playback.neighborhood`: host-confirmed previous/current/next projection, position, total, and playback phase.
- `playback.technical`: current track's literal format/depth/rate/duration projection.
- `output.route`: current effective output label.
- `queue.summary`: queue count.
- `artwork.summary`: active-collection artwork availability.

New reusable bundles belong in `bundles.js`. A theme-specific feature may register an extension bundle only when its truth owner is named and its result remains read-only. Do not add a bundle merely to rename labels; labels belong in the profile.

## Product slots

The v1 slots are `hero.overlay`, `hero.content-end`, `stage.overlay`, `player.overlay`, and `inspector.content-start`. Profiles reference these keys, never arbitrary selectors. Add a shared slot only when at least one product job needs that ownership boundary and its fallback is understood.

## Adding a profile

1. Create `information/profiles/<profile-key>.js`.
2. Declare only the bundle keys the profile consumes.
3. Put theme-owned static structure in its `regions`; use `data-theme-info-field` for projected values.
4. Keep interaction controls in application-owned or separately contracted mechanics. Information profile markup is not an event-handler escape hatch.
5. Register the script before `renderer.js`, add the runtime mapping, and declare `information.profile` in the theme manifest.
6. Run `npm run check:theme-information`, `npm run check:themes`, and the theme's focused check.

Counterform Choir is the first migrated example. Its hero and player readouts consume `playback.neighborhood`; those HUDs no longer exist in `index.html` when another theme is active.

## Security and future community themes

Built-in profiles are trusted, shipped JavaScript. A manifest can select only an already registered profile key. Community manifests must never supply HTML or JavaScript through `information.profile`; future community support can expose a reviewed closed set of profiles or a separate declarative template format.
