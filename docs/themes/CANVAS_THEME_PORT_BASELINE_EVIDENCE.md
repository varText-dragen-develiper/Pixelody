# Canvas theme port baseline evidence

## Decision

The stock preset for every first-pass Canvas port starts from the theme's
detached desktop host version. It does not invent a new dashboard arrangement.
The archive's shared frame was:

- workspace: `290px minmax(560px, 1fr) 292px`, ordered Library / Stage /
  Inspector;
- workspace height: `calc(100vh - 146px)` unless the theme overrode it;
- workspace gap and padding: `8px` and `0 8px` unless overridden;
- player: `88px`, `310px 1fr 310px`, padded `0 16px` unless overridden;
- Queue: a right-side drawer, not a permanent fourth workspace column;
- signal/visualizer: embedded in the Stage, not a separate dashboard tile.

The Canvas translation uses a 24-column field with spans `5 / 14 / 5`. At the
archive's common desktop width this closely reconstructs the two roughly 290px
side regions and the flexible center. Track information is the initially visible
right utility surface; Queue shares that region as a switchable stack. The
signal field is a contained overlay inside the center Stage. The product-owned
player remains whole in the bottom dock, so volume, Queue access, and mini-player
behavior are not separated from transport.

## Per-theme measurements

All source files below are the retired per-theme stylesheets.
“Shared” means the theme did not override that part of `src/styles.css`.

| Theme | Archived source styles | Workspace baseline | Player baseline |
| --- | --- | --- | --- |
| Dev Lab | `dev-lab.css` | Shared 3-column frame, 8px gap, 0 8px padding | Shared 88px deck |
| Orbital Retro-Future | `retro-future-theme.css` | Shared columns; 3px gap; 4px 8px 0 padding | 88px; shared columns |
| Bulkhead Terminal | `bulkhead-terminal-theme.css` | Shared columns; 4px gap; 6px 8px 0 padding | 88px; shared columns |
| Graphite Loadout | `graphite-loadout-theme.css`, `acid-tech-terminal.css` | Shared columns; final cascade is 7px gap; 5px 8px 0 padding | 88px; shared columns |
| Obsession Mode | `poster-themes.css` | Shared | Shared |
| Crystal Audio | `poster-themes.css`, `crystal.css` | Shared | Shared |
| Neon Burst | `poster-themes.css` | Shared | Shared |
| Monument | `poster-themes.css` | Shared | Shared |
| Analog Dossier | `poster-themes.css` | Shared | Shared |
| Cosmic Cinema | `poster-themes.css`, `cosmic-observatory.css` | Shared columns; 10px gap; 0 10px padding | Shared |
| Frosted Void | `frosted-void.css` | Shared columns; 10px gap; 0 10px padding | Shared |
| Obsidian Glass | `obsidian-glass.css` | Shared columns; 12px gap; 0 12px padding | 100px; 10px 12px 8px outer margin |
| Dead Signal | `dead-signal.css` | Shared columns; 3px gap; 0 7px padding | Shared height/columns; 0 18px padding |
| Meme Machine | `meme-machine.css` | Shared | Shared |
| Cartridge Quest | `cartridge-quest.css` | Shared columns; height `calc(100vh - 186px)` | 128px; 27/46/27 identity/playback/output deck; 8px 18px 12px padding |
| Sakura Bloom | `sakura-bloom.css` | Shared | Shared |
| Lo-Fi Cafe | `lo-fi-cafe.css` | Shared | Shared |
| ASCII Social | `ascii-social.css` | Shared | Shared |
| Poster Pop | `poster-themes.css` | Shared | Shared |
| Creator Layer | `poster-themes.css` | Shared columns; 0 gap and padding in its default mood | Shared |
| Modular Signal | `modular-signal.css` | Shared | Shared |
| Cut Sheet | `cut-sheet.css` | Shared | Shared |
| Acid Transit | `acid-transit.css` | Shared | Shared |
| Ghost Index | `ghost-index.css` | Shared side widths with 1px separators; 0 gap; height `calc(100vh - 170px)` | 112px; archived 27/19/34/20 four-region evidence deck |
| Violet//Violent | `violet-violent.css` | Shared side widths with 7px separators; 3px gap; 10px 10px 0 padding; height `calc(100vh - 184px)` | 112px; archived four-region signal chassis |
| Abyssal Press | `abyssal-press.css` | Shared side widths with 7px separators; 0 gap; 8px 8px 0 padding; height `calc(100vh - 174px)` | 112px; `minmax(220px,310px) minmax(330px,1fr) minmax(270px,340px)` |
| Harmonic Registry | `harmonic-registry.css` | Shared columns; 0 gap; 0 8px padding | 88px; shared columns |

## Deliberate translation limits

- The detached CSS is evidence, not runtime code. These ports do not relink it.
- Ghost Index and Violet//Violent each had a fourth theme-only player HUD. That
  dormant HUD remains suppressed in Canvas, so the live three product groups
  use the archived identity, transport, and output widths while the registry
  retains the original four-region string as evidence.
- The 1px/7px separator tracks in Ghost Index, Violet//Violent, and Abyssal Press
  become Canvas gaps rather than fake modules. Product jobs stay semantic and
  movable.
- Narrow widths continue to use the Canvas safety fallback. This ledger defines
  the stock desktop baseline; it does not claim pixel-identical reproduction at
  every archived media-query breakpoint.
- No new reactive behavior, artwork, or embellishment is authorized by this
  baseline. Those ideas remain in `CANVAS_THEME_PORT_BACKLOG.md`.
