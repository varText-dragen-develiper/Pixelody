# Canvas and Studio runtime gates

Read this before changing the Canvas flags in `src/main.js`,
`STUDIO_REBUILD_MODE` in `src/renderer.js`, or the stylesheet and theme-picker
markup in `src/index.html` / `src/mini-player.html`.

## Active authority

The Studio foundation reset remains active. The live boundary is:

- `src/themes/built-in-themes.json` registers Studio only.
- `STUDIO_REBUILD_MODE` is `true`; stale saved built-in or package selections
  fail closed to Studio.
- Settings exposes one Studio card. Theme search/filter controls and My Themes
  remain present for future recovery but hidden.
- The main and mini windows load shared product CSS plus the Studio rebuild
  layer. Retired theme and community-package stylesheets are not linked.
- The pre-reset 33-theme implementation is retired; it is never a source to
  copy back into the live shell.
- Canvas may expose the separately registered 27-theme baseline port cohort
  from `src/theme-runtime/canvas-theme-ports.js`. These are Canvas presentation
  recipes, not built-in registrations: they reuse current palette data and
  manifest-authored traits without relinking the retired theme stylesheets.
  Each recipe also owns a normalized stock composition graph with explicit
  module placement and sizing. Switching ports atomically installs that stock
  graph; an unsaved Composition Mode draft blocks the switch rather than being
  discarded.

The September 10 next-theme plan and its platform audit both record this same
Studio-only registry. A historical family list in an older handoff was not
authorization to restore the archived runtime.

## Canvas is a separate development gate

`src/main.js` computes three independent inputs:

- `canvasRequested`: a Canvas argument/profile was supplied.
- `composableThemeExperimentEnabled`: the development workspace authority is
  seeded. Ordinary development launches may seed it so Settings can offer the
  Canvas entry without a relaunch.
- `composableThemeExperimentLaunchFlag`: the launch should open directly into
  Canvas.

The renderer activates Canvas only when its runtime authority is ready and the
launch flag or persisted opt-in is on. This does not register Canvas as a built-in
theme and does not weaken the Studio reset for ordinary or packaged operation.

Canvas CSS is linked disabled and enabled only while Canvas is active. The mini
player follows the broadcast theme/profile and toggles its disabled development
layers independently. `canvas-theme-ports.css` and its mini companion are also
disabled by default and remain inert unless Canvas is active with an explicitly
selected port.

## Theme explorer

In development builds, Settings > Themes lists Pixelody Studio under **Ready to
use** and the development presentations under **In development**, grouped by
status: **Active** (Canvas Studio, Singularity Graph, Singularity Proxy).
`src/development-profiles.js` is the list.
None of them is a registered theme, and packaged builds and the integration
harness do not show them.

- Canvas Studio opens and closes in place, as before. Its entry and port picker
  now sit in its row.
- The Singularity routes are chosen when the process starts, so
  their entries restart Pixelody (`app:relaunch-development-profile`) with the
  same arguments and environment as their `.cmd` launchers, keeping any other
  switches such as `--pixelody-dev-user-data`. "Return to Pixelody Studio",
  the Studio card and Canvas's own Return to Studio buttons restart back. A
  restart strips every profile selector first, so profiles never stack.
- Those sessions are **isolated**: they run on the owner's library, and
  library, playlist, queue and audio changes persist as usual, but the
  appearance, panel layout, motion-effect and settings-surface keys
  (`DEVELOPMENT_SESSION_PRESENTATION_KEYS` in `renderer.js`) are never written.
  Durable commits merge by key, so Studio's stored values survive untouched.
  This is what used to leak: an isolated session left Studio in expressive
  motion and a Singularity resize left narrowed panels.
- Leaving Canvas in place restores Studio's motion setting (kept as
  `appearance.studioMotion` while an alternate theme runs), turns off the
  sheets only the open canvas uses (a port's experience sheet), and clears the Composition Mode attributes from `<body>`.

`scripts/check-development-profiles.js` (in `npm run check`) ties each entry
to its launcher and guards the isolation and exit rules.

## Launchers

| Launcher | Result |
| --- | --- |
| `Pixelody.lnk`, `Start Pixelody.cmd` | Studio shell; Canvas is available from Settings in development |
| `Start Pixelody Canvas.cmd` | Opens Canvas Studio |
| `Start Pixelody Singularity Graph.cmd` / `Proxy.cmd` | Singularity probe modes |

The theme explorer's restart entries start exactly these profiles, and a
session opened from a launcher is isolated in the same way.

Every launch writes `Pixelody-console-log.txt`. The `Pixelody Canvas gate:` line
reports the runtime inputs and is the fastest way to distinguish a launcher or
persisted-opt-in issue from a host failure.

## Required checks

The archived theme registry, picker, and styles must never leak back into the live
shell. `scripts/check-theme-packages.js` must keep package
parsing/storage intact while the package UI remains unavailable. After a relevant
change run `npm run check`, `npm run check:themes`, and the appropriate
Canvas/Studio Electron scenario.

The checkout contains a month of unrelated uncommitted work. Never use checkout,
hard reset, clean, or broad replacement to enforce this boundary.
