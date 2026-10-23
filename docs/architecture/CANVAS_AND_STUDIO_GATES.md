# Canvas and Studio runtime gates

Read this before changing the Canvas flags in `src/main.js`,
`STUDIO_REBUILD_MODE` in `src/renderer.js`, or the stylesheet and theme-picker
markup in `src/index.html` / `src/mini-player.html`.

## Active authority

The Studio foundation reset remains active. The live boundary is:

- `src/themes/built-in-themes.json` keeps Studio in `themes` and the two
  released recipes in `compositionPresentations`.
- `STUDIO_REBUILD_MODE` is `true`; stale saved built-in or package selections
  fail closed to Studio.
- Settings exposes Studio plus Obsession Mode and Cartridge Quest. The two
  named presentations are separately allowlisted composition recipes. Theme
  search/filter controls and My Themes
  remain present for future recovery but hidden.
- The main and mini windows load shared product CSS plus the Studio rebuild
  layer. Retired theme and community-package stylesheets are not linked.
- The pre-reset 33-theme implementation is retired; it is never a source to
  copy back into the live shell.
- Canvas may expose the separately registered 27-theme baseline port cohort
  from `src/theme-runtime/canvas-theme-ports.js`. These are Canvas presentation
  recipes, not built-in registrations: they reuse current palette data and
  manifest-authored traits without relinking the retired theme stylesheets.
  Obsession Mode and Cartridge Quest are also available through the ordinary
  packaged picker. The other 25 ports remain development-only.
  Each recipe also owns a normalized stock composition graph with explicit
  module placement and sizing. Switching ports atomically restores that
  presentation's saved graph, or its stock graph on first use. An unsaved
  Composition Mode draft blocks the switch rather than being
  discarded.

The September 10 next-theme plan and its platform audit both record this same
Studio-only registry. A historical family list in an older handoff was not
authorization to restore the archived runtime.

## Production presentations and development gates

`src/main.js` computes three independent inputs:

- `canvasRequested`: a Canvas argument/profile was supplied.
- `composableThemeExperimentEnabled`: ordinary launches seed the composition
  authority so the packaged Settings picker can activate the two released
  presentations. Archived integration scenarios retain their own authorities.
- `composableThemeExperimentLaunchFlag`: the launch should open directly into
  Canvas.

The renderer activates Canvas only when its runtime authority is ready and the
launch flag or persisted opt-in is on. Packaged activation additionally requires
`desktopThemePresentations` to contain the selected key. No arbitrary port or
experimental launch flag bypasses that allowlist. Studio remains the fallback.
The registry records these recipes under `compositionPresentations`; the
rebuilt-shell `themes` registry still contains Studio only.

Canvas CSS is linked disabled and enabled only while Canvas is active. The mini
player follows the broadcast theme/profile and toggles its disabled development
layers independently. `canvas-theme-ports.css` and its mini companion are also
disabled by default and remain inert unless Canvas is active with an explicitly
selected port.

Ordinary Windows builds accept `--pixelody-profile-directory=<absolute-path>`
for a separate portable library/profile. This changes only storage location;
relative or empty paths are rejected. It allows release inspection without
opening an existing installation's data.

## Theme explorer

October 3, 2026: Modules can import the free Cosmic Cinema and Neon Burst
`theme-edition` test selectors. Apply sends an allowlisted request to this same
development Canvas host and uses its atomic preset/draft guard. It does not
register built-ins, enable arbitrary package CSS, restore My Themes, or activate
Canvas in packaged builds. Imported selectors are inert until Apply. The local
shop listing and evidence are in the private development notes;
public delivery and paid entitlements remain unverified.

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
| `Pixelody.lnk`, `Start Pixelody.cmd` | Saved presentation or Studio; Obsession Mode and Cartridge Quest are available in Settings |
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
change run `npm run check`, `npm run check:themes`,
`npm run check:desktop-presentations`, and the appropriate
Canvas/Studio Electron scenario.

The checkout contains a month of unrelated uncommitted work. Never use checkout,
hard reset, clean, or broad replacement to enforce this boundary.
