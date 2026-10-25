# Theme runtime

Themes can change browsing and information layout as well as colors. The runtime gives those choices shared contracts, so a different layout still uses the same playback state and host actions. This is the reference for `src/theme-runtime/`.

Settings currently offers Studio, Obsession Mode and Cartridge Quest. Canvas Studio, other baseline ports and named experiments have separate development gates. Manifests are checked against static runtime maps, not read live by the app. See [the theme guide](THEME_SYSTEM.md) and [runtime gates](../architecture/CANVAS_AND_STUDIO_GATES.md).

## Navigation

A mechanic is registered shipped code selected by a stable key. It mounts in the main browser, updates with tracks/confirmed `activeId`, and destroys cleanly when swapped. It doesn't run in the mini-player. The [navigation contract](../../src/theme-runtime/navigation/contract.md) and `contract.js` define the interface; fix documentation if it disagrees with the code.

Every mechanic exports `mount(container, tracks, {onSelect, onActivate, onContextMenu, activeId})`, `update(tracks, activeId)` and `destroy()`. The registry rejects duplicate keys; the dispatcher handles mount/update/swap without knowing the mechanic's DOM. Theme manifest keys and `themeNavigationMechanics` must agree under `check:themes`.

The registered set includes linear-list, carousel, cover-flow, pass-deck, memory-cascade, spectral-field, pressure-stack, current-weave, chorus-fold, graftline, shared-strata and route-field. Linear-list is the fallback; pass-deck remains tested lineage without a current theme consumer.

Keep keyboard traversal/activation/back, clear selection and confirmed playback, shared callbacks, narrow-width readability and a static motion-off state. A mechanic can arrange and pace those differently. Any separate browse position needs an explicit relationship to the confirmed item, rather than two variables being patched into agreement.

## Tokens, information and composition

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

`tokens.js` has a tested two-way conversion, and the schema accepts `tokens`, but neither creates live manifest reads. Information profiles instead consume registered read-only bundles in product-owned slots. Composition surfaces, such as the context folio, own presentation lifetime, never queue, metadata, audio or playback. Themes select keys, not arbitrary HTML, scripts, selectors or data owners. Missing profiles leave the normal controls available.

## Recorded implementation

The phase headings below stay stable because source comments refer to them. They summarize results and limitations rather than a new implementation sequence.

### Phase 0 — Contract and scaffolding

The navigation contract, interface, registry scaffold and manifest validation were added without changing runtime behavior.

### Phase 1 — Reference mechanic: `linear-list`

The original row renderer moved into its own module as the visual regression baseline. A change to that extraction shouldn't silently alter the existing list.

### Phase 2 — Registry and dispatcher live

Mount/update/swap moved through the registry/dispatcher. Runtime manifest loading was deliberately left out: the hardened renderer had no fetch/file/IPC path for `*.theme.json`. Adding one needs security review. The static `themeNavigationMechanics` map is cross-checked against manifests instead, and a bounded local package can select registered code through its own validated contract.

### Phase 3 — Second mechanic: `carousel`

Carousel established that one mechanic could serve different themes without per-theme branches. Early versions kept browse/current positions separately and could move the strip without playback, play the wrong track or reset on skip. The corrected center follows confirmed `activeId`: inputs request activation, and the host update confirms movement.

Update existing nodes when only the active ID changes so transitions can run. Recenter focus only if the person is already interacting with the mechanic; a remote command or natural advance mustn't steal it from search. The renderer also handles sibling column headers on a swap. Those geometry/focus problems need painted checks, beyond fake-module tests.

The recorded linear-list lacked arrow/Enter/Escape parity and still needed a dedicated pass. Check the current module before turning that historical finding into a present defect.

### Phase 4 — Tokens and lazy CSS loading

The token shim passed its checks. Lazy CSS was attempted and reverted because inactive sheets also contained unscoped picker previews; disabling them erased the inactive cards even while automated checks passed. The loader and cross-checked map remain inert reference infrastructure. A retry first needs an always-loaded preview sheet, followed by visual verification before gating active-theme-only rules.

That rollback doesn't authorize restoring the retired stylesheet runtime. Current admission rules are in the theme guide.

### Phase 5 — Documentation

Theme implementation uses the [theme guide](THEME_SYSTEM.md), with a separate mechanic shipping guide in the navigation contract. Both need to describe the live maps and gates.

### Phase 6 — Theme-by-theme sweep

The 27 Canvas ports provide a staging area for revisiting earlier identities. Their [baseline](CANVAS_THEME_PORT_BASELINE_EVIDENCE.md) and [future ideas](CANVAS_THEME_PORT_BACKLOG.md) don't establish acceptance of every theme.

### Phase 7 — Community theme loading

Folder discovery, contained previews, creator export and gallery delivery remain later work. V1 packages only select normalized colors and reviewed shipped recipes; they can't carry assets, fonts, raw CSS, scripts or URLs. A security-reviewed manifest path and production contracts need to precede broader loading.

## Extending it

Build against the relevant contract with a clear state owner, add the focused check and register it in the platform suite. Run `check:navigation-platform`, `check:themes`, `check:linear-list`, the new mechanic check and `npm run check`; then inspect the running app at narrow widths and motion off. Two credible theme consumers establish reuse better than a speculative universal component.

Whether a mechanic becomes a listener setting, whether legacy tokens eventually migrate and which new browsing forms deserve implementation remain design choices. They don't need an answer before maintaining the current contracts.
