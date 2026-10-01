# Pixelody architecture

This is the map of the Windows desktop application: what each part owns, where
the boundaries are, and which document is authoritative for each subsystem. Read
it before your first change. It is deliberately short; the linked documents hold
the detail.

The Android companion is a separate repository,
[pixelody-android](https://github.com/varText-dragen-develiper/pixelody-android).
It talks to this application over the host API described under
[Networking and J.A.M.](#networking-and-jam).

## What Pixelody is

Pixelody is a local-first Windows desktop music player for lossless and common
music files. It combines a well-organized library with careful graphic design,
per-track tuning, output-system correction, personal artwork and themes that
differ in layout and behavior, not only in color.

Shared listening sessions are called **J.A.M.** (Joined Audio Mesh). Use that
name in user-facing text, documentation and API contracts.

The Windows app is the library host. It owns the music library, the desktop
audio engine and the host service the Android app connects to.

## Design principles

The full statement is [docs/design/DESIGN_NORTH_STAR.md](design/DESIGN_NORTH_STAR.md).
The parts that constrain code:

- Music and album art are the focus. Decoration supports information and never
  competes with it.
- Themes may change proportions, typography, framing, assets, motion and even
  how tracks are browsed. They may not hide core functions or reduce
  readability.
- All motion can be reduced or turned off, and every theme must still work
  with motion off.
- Main-player and mini-player controls stay aligned and symmetrical.
- User-chosen profile images, playlist backgrounds, track artwork and local
  metadata are first-class.

## Source map

| Path | Role |
| --- | --- |
| `src/main.js` | Electron main process: windows, file dialogs, media metadata, backups, mini-player lifecycle. |
| `src/preload.js`, `src/mini-preload.js` | The only bridge between a renderer and Electron. One preload per window, each exposing an explicit, validated IPC surface. |
| `src/renderer.js` | Browser-side composition root: DOM binding and cross-domain coordination, including staged startup, surface prewarming and idle background hydration. |
| `src/renderer-domains/` | Independently tested controllers for state, library and import, navigation, playback and session, diagnostics, J.A.M., appearance and the audio graph. [Ownership and dependency rules](architecture/RENDERER_DOMAIN_BOUNDARIES.md). |
| `src/state-store.js` | The durable, schema-versioned store behind the library, playlists, tunings, session and appearance. See [Durable state](#durable-state). |
| `src/server/` | Localhost-first personal server core: trusted-device browsing, artwork and range streaming for the Android app and J.A.M. guests. |
| `src/index.html`, `src/styles.css` … `src/playback-performance.css` | Main window structure and the cascading UI layers. The link order in `index.html` matters; the last sheet is an adaptive playback safety layer. |
| `src/mini-player.*` | The synchronized always-on-top mini player. |
| `src/theme-runtime/` | Theme runtime: semantic tokens, pluggable navigation mechanics, information profiles, composition. See [Theme runtime](#theme-runtime). |
| `src/themes/` | The theme source map (`built-in-themes.json`), per-theme design manifests and the manifest schema. |
| `src/theme-packages/` | Parser and store for local theme packages. |
| `src/audio-visualizers/`, `src/theme-instruments/` | Shared signal-frame visualizers and the instrument registry themes draw from. |
| `src/workspace-composition/` | Draggable, snap-to-grid workspace composition used by the development-only Canvas profile. |
| `src/module-shop/` | The optional-module importer and shop window. See [Modules](#modules). |
| `native/` | Native Windows helpers: a WASAPI helper, the system-audio bridge process and a source-only virtual-audio scaffold. |
| `scripts/` | Every automated check, plus build and release tooling. |
| `docs/` | Design, architecture, audio, networking, release and theme documentation. |

## Process and security boundary

Pixelody is an Electron application with a hardened renderer: context isolation
on, sandbox on, no Node integration, a content security policy per window and a
hand-maintained allowlist of IPC channels with validated payloads. File access
is granted per path by the main process rather than assumed.

Anything that adds an IPC channel, a preload method, a navigation target or a
file grant must go through the rules in
[ELECTRON_SECURITY_BOUNDARY.md](architecture/ELECTRON_SECURITY_BOUNDARY.md),
and `npm run check` runs the tests that enforce them. A theme or module never
gets to add executable code to this boundary.

## Durable state

User data lives in a file-backed store (`src/state-store.js`) under the app's
user-data directory, not in browser storage. Writes are atomic and fsynced, the
previous good file is kept as a fallback, damaged files are quarantined and a
crash during a write recovers on the next launch. `localStorage` is a legacy
read fallback only.

[DURABLE_STATE_AND_RECOVERY.md](architecture/DURABLE_STATE_AND_RECOVERY.md) is
authoritative for the recovery ladder, the difference between merge and replace
semantics, and how to add a persisted key without creating a data-loss path.
Read it before touching the store or anything that calls `localStorage.setItem`.

## Audio

[AUDIO_SYSTEM_OVERVIEW.md](audio/AUDIO_SYSTEM_OVERVIEW.md) is authoritative for
the Player Mode signal path, which component owns which piece of audio state,
the grouped-speaker-system and System EQ boundaries, the regression invariants
and the known gaps. Related planning lives alongside it:

- [Flow shuffle](audio/FLOW_SHUFFLE_DEVELOPMENT_PLAN.md) and the visualizer
  [foundation](audio/AUDIO_VISUALIZER_FOUNDATION.md).
- [Release gate](audio/AUDIO_RELEASE_GATE.md) for what must hold before audio
  changes ship.
- [Multi-output playback](audio/multi-output/MULTI_OUTPUT_SPEAKER_SYSTEMS_PLAN.md)
  for grouped speaker systems, per-output EQ, trim and delay.
- [Windows-wide System Tuning](audio/GLOBAL_SYSTEM_AUDIO_EQ_PLAN.md) and the
  [system-audio bridge protocol](audio/system-audio/WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md).
  The virtual audio endpoint is research and a source-only scaffold; nothing in
  the app installs a driver.

## Networking and J.A.M.

The host service in `src/server/` lets a trusted device browse the library,
fetch artwork and stream audio with range requests. It binds to the local or
private network, uses owner-editable permissions and protected credentials, and
supports a Windows-owned, single-host J.A.M. session with guest policy and a
source-aware queue.

Start with
[LOCAL_NETWORK_JAMS_AND_DEVICE_HOSTING.md](networking/LOCAL_NETWORK_JAMS_AND_DEVICE_HOSTING.md).
[NETWORKING_BACKBONE_CHECKLIST.md](networking/NETWORKING_BACKBONE_CHECKLIST.md)
and
[NETWORKING_CAPABILITIES_IMPLEMENTATION_MAP.md](networking/NETWORKING_CAPABILITIES_IMPLEMENTATION_MAP.md)
describe the current API contract and what remains planned (WebSocket push, and
remote or federated coordination). Contract fixtures that both apps test against
are in [`docs/api-contract-fixtures/`](api-contract-fixtures/).

## Theme runtime

Pixelody Studio is the only registered, selectable built-in presentation. That is
a deliberate foundation reset, not a gap: new themes are rebuilt on the runtime
described in
[THEME_RUNTIME_ARCHITECTURE.md](themes/THEME_RUNTIME_ARCHITECTURE.md).

- Canvas Studio and the named composition profiles are development-only. They
  are launch entries in development builds, not registered themes
  ([gates](architecture/CANVAS_AND_STUDIO_GATES.md)).
- Canvas also carries 27 baseline ports of earlier theme identities. Each is a
  presentation recipe with its own stock composition graph, not a registration
  ([evidence](themes/CANVAS_THEME_PORT_BASELINE_EVIDENCE.md),
  [backlog](themes/CANVAS_THEME_PORT_BACKLOG.md)).
- The local theme-package parser and store are implemented; the My Themes
  surface that applies them is unavailable during the reset.
  Packages are limited to normalized semantic colors and product-owned HUD,
  typography, motion, navigation and information recipes. They cannot carry
  assets, fonts, raw CSS, scripts or URLs.

[THEME_SYSTEM.md](themes/THEME_SYSTEM.md) is the working reference for theme
files, and [THEME_CATALOG.md](themes/THEME_CATALOG.md) records each theme's
visual thesis.

## Modules

Modules are optional downloads that extend the base app on both platforms. The
module manager ships in every build; the shop is not installed by default. A user
downloads a `.pixelody-module` package from the Pixelody website and imports it
from Settings, as described in [OPTIONAL_MODULES.md](OPTIONAL_MODULES.md).

Packages are small, strictly validated JSON (`src/module-shop/contract.js`):
a fixed field set, a size cap, a known platform list and no executable content.
The importer and shop window have their own preload and IPC surface, and
`npm run check` includes `scripts/check-module-shop.js`. Module content itself is
not part of this repository.

## Platform and licensing

- Windows is the primary platform. macOS and Linux packaging configs
  (`electron-builder.mac.cjs`, `electron-builder.linux.cjs`) are kept because the
  cross-platform check reads them, but they are not release targets.
- The source in this repository is GPL-3.0-only (see [LICENSE](../LICENSE)).
  Contributions need a signed CLA ([CONTRIBUTING.md](../CONTRIBUTING.md)). The
  "Pixelody" name and logos are covered by [TRADEMARKS.md](../TRADEMARKS.md), not
  by the GPL. Official store builds are distributed under separate terms.
- Third-party code and art are recorded in [NOTICE](../NOTICE) and
  [THIRD_PARTY_ASSETS.md](../THIRD_PARTY_ASSETS.md). Commercial artwork and
  reference screenshots are inspiration only and are never bundled.
- Release process: [WINDOWS_RELEASE_AND_SIGNING.md](release/WINDOWS_RELEASE_AND_SIGNING.md),
  [WINDOWS_INTEGRATION_HARNESS.md](release/WINDOWS_INTEGRATION_HARNESS.md) and
  [LEGAL_RELEASE_CHECKLIST.md](release/LEGAL_RELEASE_CHECKLIST.md).

## Definition of done

A change is done when:

1. The requested behavior or design is implemented, not described.
2. Playback, importing, playlists, metadata, queue, the mini player, audio
   tuning, panel resizing, settings and navigation still work and stay reachable
   and readable at common desktop widths.
3. Main and mini-player appearances are both handled where relevant.
4. Reduced and off motion still work.
5. New assets have compatible licenses and are recorded.
6. `npm run check` passes, along with `npm run check:audio` for audio changes and
   `npm run check:themes` for theme changes.
7. [ROADMAP.txt](../ROADMAP.txt) is updated only after the feature exists.

Broader audits live in
[BACKBONE_AUDIT_CHECKLIST.md](architecture/BACKBONE_AUDIT_CHECKLIST.md).
