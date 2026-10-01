# Workspace Composition Kernel

Status: C2-C7 kernels and main-process durability authority, isolated C4-C6 Dev Lab specimens, and a development-only Canvas Studio C8 production-host slice with direct manipulation; full C8 human/parity evidence remains open

This folder contains the deterministic, presentation-free authority for the
future Pixelody composable workspace. Its kernels intentionally have no DOM,
Electron, filesystem, localStorage, audio, or marketplace dependency. C7 is
integrated by the existing main-process state store and a least-privilege IPC
bridge; the composition host itself remains isolated from production.

## Files

- `contract.js` normalizes and validates the versioned composition graph,
  enforces hostile-input bounds, verifies registered module shapes and instance
  policies, derives required product-job reachability from a trusted module
  catalog, produces deterministic signatures, and resolves invalid candidates
  to a separately validated fallback.
- `operations.js` applies pure graph transformations, validates every result,
  rejects no-ops and invalid states, emits exact inverse restore receipts, and
  supports atomic batches.
- `composition-session.js` owns the C5 use/edit transaction, bounded undo/redo,
  cancel/save boundaries, creator restoration, and session-only named layouts.
- `interaction-adapter.js` is the presentation-free C6 route adapter. It ranks
  legal reorder/split/stack intents, emits canonical operations for pointer,
  click, menu, and keyboard routes, clamps split resizing, and calculates
  bounded autoscroll steps.
- `persistence.js` is the C7 trusted workspace authority. It normalizes schema
  versions, reconciles module/theme/shape identities, retains creator and
  last-known-good graphs, enforces compare-and-swap revisions, records bounded
  substitution receipts, and supplies repeated-failure safe mode plus the
  startup watchdog primitive.
- `module-contract.js` validates versioned module descriptors, responsive shape
  constraints, capability declarations, performance and motion behavior,
  accessibility obligations, product fallback declarations, layout/visibility
  contexts, and the complete lifecycle surface.
- `module-registry.js` seals trusted descriptors into a graph-compatible
  catalog, verifies product-owned fallbacks, creates capability-limited module
  instances, enforces instance policies, and contains factory failures with a
  separately registered fallback.
- `dev-lab-specimens.js` declares seven default deterministic neutral modules,
  two optional replacement modules, their terminal product fallbacks, the C4
  graph, and pure wide/intermediate/narrow projections with explicit
  non-overlapping grid placements.
- `dev-lab-host.js` paints root, split, grid, dock, stack, overlay, and module
  nodes into the standalone `workspace-composition-lab.html` proving ground. It
  exposes selection constraints, graph identity, responsive state, lifecycle
  remount, deliberate pre-mount factory failure, the C5 product-owned command
  adapters, and C6 pointer/resize previews that commit only through the session.
- `canvas-painter.js` relocates real product roots into graph containers,
  preserves nested product ownership, restores legacy DOM exactly, and applies
  placement/shape/ratio/stack changes incrementally while topology is stable.
- `canvas-studio.js` owns the development authoring rail, module tray, direct
  move and resize handles, addressable blank-canvas drops, collision-aware grid
  packing, split separators, keyboard alternatives, required-job save gate, and
  Composition Mode re-entry route.
- `first-party-modules.js` declares the real adapter registry and each module's
  `independent`, `embedded-fallback`, or `shared-shell-member` root policy.
- `production-host.js` reconciles lifecycles, funnels every authored edit through
  the canonical operations/session, and selects incremental versus full paint.
- `scripts/check-workspace-composition.js` supplies deterministic hostile,
  boundary, fallback, operation, undo, compaction, required-job, capability,
  lifecycle, layout, accessibility, and performance fixtures.

## Graph shape

The root has exactly one child. All nodes have a stable unique `id`.

```text
root(schemaVersion, children[1])
  split(axis, weights, children[2])
  stack(activeChildId, children[2..n])
  grid(columns, rowPolicy, children[1..n])
  dock(edge, sizePolicy, size?, children[1])
  overlay(anchor, boundsPolicy, children[1])
  module(moduleKey, shape, configuration)
```

This is a semantic tree. Absolute pixel x/y coordinates are not part of the
authority. Optional `placement.columnStart`, `placement.rowStart`,
`placement.columnSpan`, and `placement.rowSpan` give a direct grid child a
bounded semantic cell address and footprint. Canvas Studio packs sibling
footprints around the person's chosen cell so no authored overlap is persisted;
responsive themes may collapse those addresses back to semantic flow.

`deriveFocusOrder()` follows semantic tree order and includes only the active
child of each stack by default. Tests may request inactive stack children after
the active child. The later host remains responsible for focus entry/return and
for proving that painted visual order matches the derived semantic order.

## Trusted module catalog

The graph cannot claim that a module provides a required product job. The host
passes a trusted `moduleCatalog` or `resolveModule()` option to validation. A
descriptor may currently supply:

```js
{
  productJobs: ['playback-transport'],
  shapes: ['strip', 'mini'],
  instancePolicy: 'single',
  targetShape: 'strip',
  defaultConfiguration: {}
}
```

The C3 registry emits exactly this catalog subset from its fuller trusted
descriptors. Graph validation therefore depends on registry truth rather than a
module's own runtime claims.

## Module and capability boundary

A module declares namespaced read bundles and command adapters. Its factory
receives only a frozen capability context:

```js
{
  moduleKey,
  family,
  instanceId,
  read(key),
  subscribe(key, listener),
  command(key, payload),
  announce(message)
}
```

There is no raw renderer state, IPC object, filesystem handle, Electron object,
or host adapter on that context. Undeclared reads and commands fail with stable
codes. Read and subscription snapshots are normalized into frozen bounded JSON;
command payloads pass through the same hostile-input boundary.

Every factory must provide `mount`, `update`, `setLayout`, `setVisibility`,
`focus`, `serializeConfiguration`, and `destroy`. The registry wraps those calls,
normalizes their inputs and serialized configuration, enforces single-instance
policies, and makes destruction idempotent.

Non-fallback modules must name a registered fallback. A fallback can only be
registered with product origin, must identify itself as a terminal fallback,
and must preserve every product job and shape of the requesting module. Factory
or lifecycle-construction failure selects that fallback before mount. Later
painted-host work owns runtime error boundaries after mount.

Theme Instrument Foundry entries are not automatically composition modules.
Material, choreography, and treatment recipes remain theme-owned presentation
inputs. Only entries that own a coherent product job, can satisfy this lifecycle,
and can operate through declared bundles and commands should receive module
descriptors.

`trusted-runtime` is registry provenance for code already admitted and shipped
through a future isolation/review route; it is not a package loader and does not
authorize JavaScript from the current declarative theme-package format.

## C4 painted host

`workspace-composition-lab.html` is intentionally absent from `index.html` and
the Electron production script chain. It uses a deterministic local fixture and
has no persistence, IPC, network, filesystem, AudioContext, or production
renderer dependency.

The same normalized graph paints at three projection tiers:

- wide: 12-column grid, horizontal split, right dock;
- intermediate: 8-column grid, vertical split, bottom dock;
- narrow: one-column semantic flow, vertical split, bottom dock.

Projection changes alter shape and placement context without rewriting the
saved graph. Every projected module shape is checked against its descriptor and
every grid cell is checked for overlap. The lab mounts seven modules, allows the
stack's visible specimen to be inspected, can destroy/remount the full lifecycle,
and can deliberately fail any primary factory to demonstrate its product-owned
fallback.

## Operations

Supported operation types are exported as `OPERATION_TYPES`:

- `insertModule`
- `removeOptionalModule`
- `moveBefore` / `moveAfter`
- `splitWith`
- `stackWith` / `unstack`
- `replaceModule`
- `setActiveStackChild`
- `resizeSplit`
- `setNodePlacement`
- `setModuleShape`
- `setModuleConfiguration`
- `assignAmbient`
- `applyPreset`
- `resetModule`
- `resetComposition`
- `restoreGraph`

All input methods must eventually call these operations or later versioned
extensions of them. Pointer code must not rearrange persisted DOM directly.

Successful operations return a normalized frozen graph and a deterministic
receipt:

```js
{
  ok: true,
  graph,
  receipt: {
    version: 1,
    type: 'moveBefore',
    beforeSignature,
    afterSignature,
    inverse: { type: 'restoreGraph', graph: previousGraph }
  }
}
```

Failures return a stable error code and leave the caller's source graph
untouched. Required-job validation occurs after every operation, so removing or
replacing an optional module cannot accidentally strand transport, library,
track browsing, or another host-declared job.

## C5 transactional command surface

Composition Mode is an explicit in-memory transaction layered over the pure
operations. Entering captures the committed graph. Every accepted command adds
one bounded undo receipt; rejected commands leave both graph and history
untouched. A dirty transaction cannot be exited accidentally.

The product-owned inspector provides labeled single-pointer controls for move,
split, stack, replace, shape, reset, and optional-module hide. Undo, Redo,
Cancel, Save, Save As, Restore Creator, and Apply Named Layout use the same
session authority. Save commits only to the current page session; Save As keeps
at most 24 bounded, validated session layouts and does not imply durable
persistence.

Keyboard routes include Alt+E for Composition Mode, Ctrl+Z for Undo,
Ctrl+Shift+Z or Ctrl+Y for Redo, and Ctrl+S for Save. Status and rejection text
is emitted through the page's live status region. In Use Mode the composition
fieldset is disabled while ordinary specimen controls continue to dispatch
their declared product commands without mutating the graph.

## C6 ranked pointer and resize adapter

C6 selects the hybrid ranked R&D C adapter. A and B remain recorded comparison
fixtures rather than runtime branches:

- A, reorder-only, is predictable but cannot express spatial split or stack.
- B, spatial zones, expresses split and stack but removes the fast reorder
  gutter.
- C combines reorder gutters, four directional split edges, and a stack center
  while producing the same canonical operations as non-pointer routes.

Every module exposes a dedicated MOVE button only in Composition Mode. Pointer
movement ranks the live target rectangle from coordinate hit-testing even while
the handle owns pointer capture. After the
drag threshold, the real pane lifts into a bounded pointer-following surface and
a visible placeholder moves through valid grid slots. Compatible grid reorder
intents make every neighbour reflow around that slot before release; cancel
restores the authoritative order. The last valid fitted slot survives transient
hit-test gaps and placeholder hover. Pointer-up re-resolves only after meaningful
pointer movement, preventing the reflowed layout beneath a stationary pointer
from reversing the chosen relationship. Trusted pointer streams are coalesced to
the display cadence, lifted-pane motion uses a compositor transform, and an
unchanged target reuses its preview. If consecutive drag frames exceed the
interaction budget, that gesture automatically drops product-content detail and
neighbour animation while preserving the pane shell, slot, and final operation.
The
provisional path verifies connected roots, stable module count, and unique node
ids and falls back to the geometric preview if those invariants diverge. It does
not mutate the session graph. Pointer release still applies exactly one operation
through the C5 session, or applies nothing when no legal intent is active.
Clicking MOVE enters a pick state and exposes the complete before/after,
directional split, and stack vocabulary directly on the chosen destination pane
as well as in the authoring rail.

Every two-child split exposes a dedicated separator in Composition Mode. Pointer
movement previews clamped 20/80 weights locally; release commits one
`resizeSplit`. Arrow keys, the ratio control, and Equal panes call the same pure
weight adapter and session operation. Autoscroll uses the visible canvas edge,
selects the canvas only when it is scrollable, and refuses takeover from marked
nested scrollers and ordinary interactive descendants.

Full motion permits short preview reflow. Reduced motion removes neighboring
translation and simplifies the ghost. Motion Off removes all interaction
animation and transition while preserving targets, labels, and commits.

## C7 durable authority and recovery

The authoritative main-process state envelope now owns
`pixelody.workspaceComposition`. A normalized C7 snapshot includes the current
graph and signature, exact workspace revision, creator default, last-known-good
graph, active theme identity, bounded substitution receipts, recovery status,
and startup health state. The renderer receives only four validated operations:
load, compare-and-swap commit, no-write cancel, and startup health reporting.

Composition state is not mirrored to localStorage. Existing atomic pending,
current, previous, and backup rotation in `PixelodyStateStore` protects the
combined durable envelope. Workspace-only corruption or a future workspace
schema recovers inside that domain before paint, leaving library, queue, and
playback values available. A missing trusted module, shape, or theme is either
substituted with an exact receipt or rejects atomically; no candidate graph is
partially applied.

The startup watchdog is main-process owned. A future production host begins an
attempt through IPC and must report healthy before its bounded timer expires.
Three consecutive failed or unconfirmed starts select the creator-safe graph.
C8 owns activating those calls because C7 deliberately does not mount a
production module host.

## C8 Canvas Studio production slice

The production host remains development-only. The Studio-visible `Open Canvas
Studio` control activates the isolated Foreground proving-ground profile;
Foreground is not in the built-in theme catalog. `first-party-modules.js`
registers product-owned adapters for Library, Track browser, Queue, Now Playing,
Transport, Track Information, deterministic Signal preview, and optional
Artwork. They relocate the existing renderer roots and use compact capabilities;
they do not create another library, queue, playback engine, or audio authority.

The opening graph contains only Tracks. The tray can place the remaining real
modules. Every painted module exposes a dedicated move handle in Composition
Mode. Pointer zones rank reorder, four directional split intents, and stack;
moving a split/stack member beside its former sibling structurally compacts the
wrapper instead of deleting the module. Same-grid reorder lifts the real pane
under the pointer and paints a live placeholder-driven reflow before release.
Grid children expose one corner handle on
their shape-supported axes, with continuous block-size feedback before a
bounded span commit, and two-child splits expose a semantic separator. Both
resize surfaces support arrow keys. Each pane also exposes local reorder,
resize, theme-size, and return-to-tray fallbacks, while click-to-move
relationships can be completed on the canvas without visiting the rail. Each
completed gesture emits one graph operation and stable-topology changes use the
painter's incremental path.

Root policy remains explicit after relocation. Independent roots can stand
alone; Artwork and Signal are embedded fallbacks until placed; Transport and
Now Playing begin as members of the product-owned player shell. These policies
describe ownership/fallback provenance, not a fixed visual position.

The dedicated `workspace-canvas-studio` Electron scenario proves captured-pointer
hit testing, provisional grid reflow, committed reorder persistence,
placeholder-hover stability, cancellation rollback, direct split,
stack, recombination, grid/split pointer resize, continuous vertical preview,
keyboard resize, pane-local fallbacks, on-canvas click-to-move destinations,
large semantic hit targets, nested-root relocation, incremental canvas identity,
required-job save rejection, atomic save, no-write discard, re-entry, and Studio
restoration. The live analyser tap, full provisional split/stack topology,
edge-attachment relationships, painted breakpoint/zoom evidence, large-library
profile, screen-reader pass, touchpad comfort, and independent-human acceptance
remain open.

## Hostile-input bounds

The contract rejects or bounds:

- unknown node types and keys;
- duplicate/invalid IDs;
- unsupported schema versions;
- unknown modules and shapes when a catalog is supplied;
- invalid container child counts;
- invalid split, grid, dock, overlay, and placement values;
- graph depth, node count, and direct child count;
- per-module and total configuration bytes;
- non-JSON values, non-finite numbers, oversized strings/arrays, sparse arrays,
  and forbidden `__proto__`, `prototype`, and `constructor` keys;
- missing required product jobs;
- single-instance module duplication.

These checks protect the in-memory contract. Package admission, archive safety,
signature verification, IPC, process isolation, marketplace review, and resource
budgets remain separate gates.

## Deliberate C2-C8 limits

- The host exists only behind the development-runtime Canvas gate; ordinary
  Studio and packaged builds continue through legacy roots.
- Seven first-party adapters can mount real renderer roots; Artwork is optional
  and Signal remains deterministic preview data rather than a live analyser tap.
- No post-mount painted failure boundary has been implemented.
- C5/C6 Dev Lab Save and Save As remain page-session demonstrations and are not
  wired to the C7 production state bridge.
- Pointer targets are module nodes at arbitrary graph depth, but authority is a
  semantic tree rather than freeform x/y coordinates or overlapping windows.
- Same-grid reorder has live DOM reflow; split/stack wrapper creation remains a
  geometric preview until a lifecycle-safe ephemeral graph painter is proven.
- Edge/corner attachment that persists as a coupled scaling relationship is not
  yet part of the graph contract; splits are the current adjacency primitive.
- Direct manipulation has automated pointer/keyboard evidence, not physical
  touch/touchpad, assistive-technology, or independent-human acceptance.
- No theme or community-package schema has been widened.
- The Signal module is deterministic preview data, not a claimed live analyser
  connection.
- No third-party executable module is admitted.
- The existing theme/package manifests have not been widened; their future map
  to module descriptors remains a separate review and migration gate.
- Browser-painted command/pointer behavior and unpacked Electron persistence are
  recorded. No claim is made about screen-reader output, Windows high contrast,
  physical pointer/touch comfort, packaged/installed relaunch behavior, or
  independent-human acceptance.

Run the focused check with the bundled Node runtime when Node is absent from
PATH:

```powershell
node scripts/check-workspace-composition.js
```
