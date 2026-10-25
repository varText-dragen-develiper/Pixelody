# Workspace composition

The kernels validate a semantic layout and apply reversible edits without DOM, Electron, files, browser storage, audio or marketplace dependencies. The main-process store supplies durable authority; hosts paint the result. C2–C7 kernels, isolated C4–C6 specimens and the Canvas C8 slice have recorded evidence, with broader human/parity checks still open. Current packaged presentation admission is governed by [runtime gates](../../docs/architecture/CANVAS_AND_STUDIO_GATES.md).

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

## Graph and capabilities

```text
root(schemaVersion, children[1])
  split(axis, weights, children[2])
  stack(activeChildId, children[2..n])
  grid(columns, rowPolicy, children[1..n])
  dock(edge, sizePolicy, size?, children[1])
  overlay(anchor, boundsPolicy, children[1])
  module(moduleKey, shape, configuration)
```

Every node has a unique stable ID and root has one child. Pixel coordinates aren't the saved authority. Direct grid children can use bounded column/row starts and spans; packing avoids saved overlap and responsive projections can return to semantic flow. Focus follows tree order, normally including only a stack's active child. The host must match painted order and own focus entry/return.

A trusted moduleCatalog or resolveModule supplies required jobs, shapes, instance policy, target shape and defaults. Graphs can't declare their own capabilities. The registry passes a frozen context:

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

Undeclared reads/commands fail, and snapshots/payloads are bounded frozen JSON. No raw app state, IPC, file handles or Electron objects enter that context. Factories supply mount, update, setLayout, setVisibility, focus, serializeConfiguration and destroy. Wrappers normalize inputs, enforce instances and make destruction idempotent.

A non-fallback names a product-owned terminal fallback preserving its jobs/shapes. Construction failure selects that fallback before mount; post-mount error containment remains separate work. Foundry material/choreography recipes aren't automatically composition modules, and trusted-runtime provenance doesn't load arbitrary package scripts.

## Edits and sessions

Supported operations include insert/remove optional, move before/after, split/stack/unstack/replace, active stack child, split resize, placement/shape/configuration, ambient/preset, reset and restore. They return normalized graphs with signatures and inverse receipts; failures leave source untouched. Required jobs are revalidated after every edit.

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

Composition Mode captures the committed graph, keeps bounded undo/redo and refuses accidental exit from a dirty draft. Use the same session for pointer, menu, keyboard, save/cancel and creator restore. The C5 lab's Save/Save As are session-only, with at most 24 named layouts. Alt+E, Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y and Ctrl+S route through it; status uses a live region.

The C4 lab paints deterministic modules in wide 12-column, intermediate 8-column and narrow single-flow projections. It can remount and inject factory failures, but has no production persistence, network or audio. The C6 hybrid adapter combines reorder gutters, directional split edges and stack centers. Drag previews never mutate the graph; release commits one legal operation or nothing. A fitted placeholder survives transient hover gaps, unchanged targets reuse previews, and expensive gestures can reduce detail while preserving the final operation.

Split resizing clamps to 20/80 and offers pointer, arrows, ratio and Equal panes. Autoscroll respects nested scrollers. Reduced/off motion keeps targets and commits without requiring animated reflow.

## Saving and recovering

C7 stores pixelody.workspaceComposition with graph/signature, revision, creator/last-good graphs, theme, bounded substitutions and startup health. The renderer receives load, compare-and-swap commit, no-write cancel and health reporting. Workspace state isn't mirrored to browser storage. Atomic store rotation protects it alongside the library; domain corruption/future schemas recover without erasing playback/library data.

Candidates substitute with an exact receipt or reject atomically. Three failed/unconfirmed starts select the creator-safe graph. The host owns invoking that watchdog before declaring startup healthy.

## Canvas host and remaining limits

C8 relocates real product roots through first-party adapters rather than making another library or player. The recorded authoring slice supports move, grid/split resize, local fallbacks, click destinations, save/discard and return to Studio. Stable topology uses incremental painting. Root policy distinguishes independent, embedded-fallback and shared-shell members.

The workspace-canvas-studio scenario records captured-pointer targeting, reflow/persistence, hover stability, cancel, split/stack/recombine, resizing, keyboard routes, relocation, required-job rejection, atomic save and restore. Broader split/stack preview topology, coupled edge relationships, live analyser input, large-library/zoom/breakpoint evidence, post-mount failures, screen readers, touchpad comfort and independent acceptance remain open. Signal is a deterministic preview, not live analysis.

Contracts reject unknown keys/types, duplicate IDs, unsupported schemas, invalid counts/geometry, excessive depth/size/configuration, non-JSON/sparse/nonfinite values, forbidden prototype keys, missing jobs and duplicate singletons. Package signing, IPC, isolation and marketplace admission are separate boundaries. Run `node scripts/check-workspace-composition.js` for the focused kernel checks.
