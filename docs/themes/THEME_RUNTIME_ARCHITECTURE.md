# Theme runtime architecture

How Pixelody separates what a theme looks like from how the application works,
and the platform that lets a theme change how the app is navigated, not only how
it is colored. This is the design record for `src/theme-runtime/`.

Code comments throughout the repository cite the phase numbers below ("Phase 2
of the theme runtime plan"). The numbering is stable; do not renumber it.

## Why this exists

A theme used to be a color palette plus a stylesheet, and adding one meant a
manual checklist across six or more files. That undersold the goal. A developer
should be able to change how a theme fundamentally works, such as how a track
list is browsed, without reverse-engineering undocumented conventions, and
without every theme drifting into its own incompatible app.

The platform therefore has two halves:

- **Mechanics differ.** A linear list, a carousel and whatever is invented next
  are interchangeable parts, each assignable to any theme.
- **A common thread stays constant.** A person who knows Pixelody should not get
  lost when they switch themes. That constant set, not any single mechanic, is
  the product of the platform.

The bar for the documentation is that it is correct and complete, so the
contract is written down once and nobody has to relearn it from a vague summary.

## Current state

- Pixelody Studio is the only registered, selectable built-in presentation. This
  is the result of a deliberate foundation reset, and
  [THEME_SYSTEM.md](THEME_SYSTEM.md) describes the reset in detail.
- Canvas Studio and named composition profiles are development-only, and the
  [Canvas and Studio gates](../architecture/CANVAS_AND_STUDIO_GATES.md) say how
  they are kept out of the shipped theme list.
- The runtime below is built and tested independently of which themes are
  registered. Earlier theme identities are preserved as 27 Canvas baseline ports
  ([evidence](CANVAS_THEME_PORT_BASELINE_EVIDENCE.md)) that exercise the same
  navigation mechanics.
- Manifests are not read by the running app. See
  [the Phase 2 finding](#phase-2--registry-and-dispatcher-live) for why, because
  it shapes several decisions here.

## The platform

### Navigation mechanics

A navigation mechanic is how a theme lets the user browse and pick a track or
playlist in the main window. It is not a theme, and a theme can use any
registered mechanic. It is not arbitrary per-theme JavaScript either: a
mechanic is one of a small, reviewed, built-in set that a manifest selects by
key. Mini players have no browsing surface and never run mechanics.

The complete contract is
[`src/theme-runtime/navigation/contract.md`](../../src/theme-runtime/navigation/contract.md)
with the matching `contract.js`. If they ever disagree, the code wins and the
document is stale.

- **Interface.** Every mechanic exports `mount(container, tracks, { onSelect,
  onActivate, onContextMenu, activeId })`, `update(tracks, activeId)` and
  `destroy()`. This mirrors the capture/restore adapter pattern already used by
  `src/renderer-domains/navigation-controller.js`.
- **Registry.** Each mechanic registers once under a stable lowercase key
  (`registry.js`). Registering the same key twice throws. This is what makes a
  mechanic globally assignable: build it once, and any theme can select it.
- **Dispatcher.** `renderTracks()` and its playlist equivalent are a thin lookup
  from the active theme's mechanic key to the registry, then mount, update or
  swap (`dispatcher.js`). The dispatcher is DOM- and mechanic-agnostic.
- **Manifest wiring.** `navigation.trackBrowser` and `navigation.playlistBrowser`
  in a theme manifest are validated against the registry's keys by
  `npm run check:themes`. An unregistered key fails the check instead of falling
  back silently.

Registered mechanics: `linear-list`, `carousel`, `cover-flow`, `pass-deck`,
`memory-cascade`, `spectral-field`, `pressure-stack`, `current-weave`,
`chorus-fold`, `graftline`, `shared-strata` and `route-field`. `linear-list` is
the first one built and the fallback for any theme that does not name another.

### The common thread

Every mechanic, however it looks or moves, must:

- be operable from the keyboard (arrow and tab traversal, Enter to activate,
  Escape to back out); no mechanic is mouse-only;
- expose one active item at all times, with a visible selection state;
- fire the same lifecycle callbacks the rest of the app expects (select,
  activate, context menu), so callers never need to know which mechanic is
  mounted;
- degrade to a static, non-decorative state when motion is off, matching the
  convention every theme follows;
- stay legible at narrow widths.

Spatial layout, how many items are visible, motion style, decoration of the
focused item and pacing are free per mechanic.

### Semantic tokens

Theme palettes historically used non-semantic keys (`gold`, `gold2`, `green`,
`hero`, `bg`, `surface`…). `theme-runtime/tokens.js` defines the semantic names
and a lossless two-way shim:

| Legacy | Semantic |
| --- | --- |
| `gold` | `accentPrimary` |
| `gold2` | `accentSecondary` |
| `green` | `accentState` |
| `hero` | `heroTone` |
| `bg` | `canvas` |
| `surface`, `surface2`, `surface3` | `elevation1`, `elevation2`, `elevation3` |
| `line` | `divider` |
| `edge` | `frame` |
| `text`, `muted` | `foreground`, `foregroundMuted` |

The manifest schema accepts an optional `tokens` block. The shim is tested
(`npm run check:tokens`) but not wired to the live app, for the same reason as
the manifest reads below.

### Information profiles and composition

Two further layers follow the same select-by-key rule:

- **Information profiles** (`theme-runtime/information/`) let a theme reorganize
  or restyle information without owning any data. The direction is fixed:
  application state, then registered read-only bundles, then a registered theme
  profile, then product-owned slots. See its
  [contract](../../src/theme-runtime/information/contract.md) and
  `npm run check:theme-information`.
- **Composition** (`theme-runtime/composition/`) holds product-owned surfaces
  such as the context folio, which owns presentation lifecycle only, never
  queue, metadata, audio, output or playback state. A theme may style it and
  place its portals. See its [contract](../../src/theme-runtime/composition/contract.md).

In both layers a theme selects shipped code by key. It cannot supply HTML,
JavaScript, selectors or state owners, and a missing profile leaves the ordinary
product controls as the fallback.

## Implementation phases

Phases are sequential where marked and parallel-safe otherwise. Each has a
definition of done.

### Phase 0 — Contract and scaffolding

Wrote the navigation contract and its JavaScript interface, scaffolded the
registry, and added the `navigation` block to the manifest schema with a
registry-key validator in `check:themes`.

**Done when:** the contract exists, the schema validates a manifest with a
`navigation` block, and no runtime behavior had changed.

### Phase 1 — Reference mechanic: `linear-list`

Extracted the original `renderTracks()` row rendering, unchanged, into
`navigation/linear-list.js` and pointed every theme's implicit default at it.

**Done when:** every theme rendered pixel-identically to before, now routed
through the new module. This is the regression baseline for everything after it.
If a change here alters how anything looks, stop and fix it before continuing.

### Phase 2 — Registry and dispatcher live

Built the registry and the thin dispatcher in place of the direct call to the
list renderer.

**Finding.** The running app has no runtime path to `*.theme.json`: there is no
IPC channel, fetch or file access for it. Reading manifests live would add new
IPC surface to an Electron app that is deliberately hardened (context isolation,
sandbox, an explicit IPC allowlist; see the
[security boundary](../architecture/ELECTRON_SECURITY_BOUNDARY.md)). That is a
separate, security-reviewed piece of work.

**Decision.** The dispatcher ships now, fed by a small static
`themeNavigationMechanics` map in `renderer.js`, the same pattern as the palette
and theme lists. `scripts/check-themes.js` cross-checks that map against any
manifest declaring `navigation.trackBrowser`, so the two cannot silently
disagree. A theme package the user installed locally can select a registered
mechanic through the hostile-input package contract instead.

**Done when:** the dispatcher can mount, swap (destroy the old mechanic, mount
the new) and update, proven by `scripts/check-navigation-dispatcher.js` against
fake mechanics. Swapping is driven by the static map rather than a live manifest
read, which is the one deviation from the original wording.

### Phase 3 — Second mechanic: `carousel`

Built `navigation/carousel.js` from scratch against the contract, with no shared
code with `linear-list`, and assigned it to two visually different themes so the
"platform" claim is true rather than aspirational. It contains no
per-theme branches.

Lessons that now apply to every mechanic:

- **Keep exactly one position.** The first carousel tracked a browsing position
  and the confirmed playing track as separate variables, synced by hand. They
  drifted in four different ways: a skip looked like a reset, a skip played the
  wrong track, a click moved the strip without changing playback, and a click
  changed playback without the strip following. Each patch fixed one timing
  window and another appeared, because the structure still had two variables.
  The fix was to delete the second one. The center is always computed from the
  confirmed `activeId`. Clicking or arrow-keying only *requests* activation
  through `onActivate`; the mechanic moves only when `update()` reports a
  genuinely new `activeId`. A mechanic that wants a browsing position distinct
  from the active item must document why, or not split them at all.
- **Update in place.** When only `activeId` changes, `update()` recenters the
  existing nodes instead of rebuilding, so CSS transitions can actually animate.
- **Do not steal focus.** A confirmed recenter moves DOM focus only if the user
  is already engaged with the mechanic. An external change (skip button, track
  end, remote command) must never pull focus away from, say, a search field.
- **Look at it.** Structural checks cannot see geometry. Step sizes, rotation and
  depth are tuned by eye, and some defects (such as a static column-header row
  showing above a carousel that has no such columns) appear only in a rendered
  screenshot. That header is a sibling of the track container rather than part
  of any mechanic, so `renderer.js` toggles it after every mechanic swap.

Known gap: `linear-list` is a faithful extraction of the original list and has no
arrow, Enter or Escape handling, so it is not yet at keyboard parity with newer
mechanics. This should be closed in a dedicated pass.

Further built-in mechanics followed the same recipe, each with its own
`check:<mechanic>` script: `cover-flow`, `pass-deck`, `memory-cascade`,
`spectral-field`, `pressure-stack`, `current-weave`, `chorus-fold`, `graftline`,
`shared-strata` and `route-field`. `pass-deck` remains a registered, tested
mechanic that no current theme uses, kept as implementation lineage.

### Phase 4 — Tokens and lazy CSS loading

Partially done.

- **4.1 Token shim — done.** `tokens.js` and the schema `tokens` block, covered
  by `check:tokens`.
- **4.2 Lazy CSS loading — attempted and reverted.** `css-loader.js` toggles each
  per-theme stylesheet's `disabled` attribute so that only the active theme's
  files apply. Wired live, it broke the app: every one of the gated theme files
  mixes rules scoped to `body[data-theme="…"]` with an unscoped
  `.{theme}-preview` rule that the Settings picker uses to draw every theme's
  card, whichever theme is active. Disabling a file deleted the preview card of
  every inactive theme. All automated checks passed anyway, because none of them
  render CSS.

  The cutover was fully reverted: the stylesheet links are unconditional again.
  `css-loader.js` and `check:css-loader` stay as correct but inert
  infrastructure, and the `themeStylesheets` map stays as cross-checked
  reference data.

  **A correct retry** first extracts every `.{theme}-preview` rule into one
  always-loaded shared sheet, verifies the picker still renders, and only then
  gates the remaining, purely `body[data-theme]`-scoped remainder of each file.
  That is a CSS-editing pass across the theme files, not a renderer change.

- **Lesson for the platform.** A change whose failure mode is "the picker looks
  wrong" needs visual verification, or a check that parses each theme's CSS for
  rules outside its own `body[data-theme]` scope before any file is allowed to be
  gated.

**Done when:** every theme is visually unchanged (true today) and only the active
theme's CSS is present in the DOM (not yet achieved).

### Phase 5 — Documentation

Rewrite the "add a built-in theme" checklist in [THEME_SYSTEM.md](THEME_SYSTEM.md)
against what is true after the platform, and keep a standalone guide to building
a navigation mechanic. The guide is the mechanic contract's "Shipping a new
mechanic to the live app" section, and it is deliberately not a subsection of a
larger document.

**Done when:** a developer can build one new theme and one new mechanic using
only the documentation, with no tribal knowledge.

### Phase 6 — Theme-by-theme sweep

Go through the earlier theme identities and decide, per theme, whether to
reformulate or tweak, now that real mechanics exist beyond "everything is a
list". The 27 Canvas baseline ports and their
[backlog](CANVAS_THEME_PORT_BACKLOG.md) are the staging area for this pass.

### Phase 7 — Community theme loading

Explicitly later. Folder discovery, sandboxing, manifest-only content with no
JavaScript, and `navigation.*` restricted to the registry's public mechanic set.
It depends on Phases 0 to 5 being solid in production and on the real
manifest-reading IPC work flagged in Phase 2, which should happen before this
phase starts rather than as part of it. Local theme packages today are limited
to normalized semantic colors and product-owned HUD, typography, motion,
navigation and information recipes. They cannot carry assets, fonts, raw CSS,
scripts or URLs.

## Decisions on record

- The mini player is out of scope for navigation mechanics.
- The Phase 1 extraction is a pure refactor with zero visual difference.
- A mechanic needs two themes using it before the platform claim counts as
  proven.
- Manifests are documentation of intent, cross-checked against static runtime
  maps, until a security-reviewed manifest read exists.

## Open questions

- Whether a mechanic should ever be a user-facing setting within a theme, or
  always fixed by the theme author.
- Whether the token shim stays permanently or existing manifests migrate once.
  Nothing currently depends on the answer.
- Whether a grid, or any other shape, is worth building as an additional
  mechanic.

## Adding to the platform

1. Read the [mechanic contract](../../src/theme-runtime/navigation/contract.md),
   which lists every step needed to take a mechanic from a file to something a
   theme can select.
2. Build against the contract with one source of truth for position.
3. Write a `scripts/check-<mechanic>.js` and register it in the platform check.
4. Run `npm run check:navigation-platform`, `npm run check:themes`,
   `npm run check:linear-list` and the new mechanic's check, then `npm run check`.
5. Look at it in the running app, at a narrow width and with motion off.

See also [THEME_SYSTEM.md](THEME_SYSTEM.md), [THEME_CATALOG.md](THEME_CATALOG.md)
and [../ARCHITECTURE.md](../ARCHITECTURE.md).
