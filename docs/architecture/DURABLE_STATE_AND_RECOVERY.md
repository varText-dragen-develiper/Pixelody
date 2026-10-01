# Durable state and recovery

Authoritative description of where Pixelody keeps a user's library, playlists,
tuning and session state, what happens to it when a write is interrupted, and
how to add a key without quietly creating a data-loss path.

Written 2026-09-20. Read this before changing `src/state-store.js`,
`buildDurableStateValues()` in `src/renderer.js`, or anything that calls
`localStorage.setItem` in the renderer.

## Two layers, one of which is legacy

**The durable store** (`src/state-store.js`, `PixelodyStateStore`) is the real
one. It is file-backed, schema-versioned and atomic, and it lives under
`userData/state`. Everything that matters -- the library, playlists, tunings,
systems, favorites, play counts, history, queue, watched folders, appearance,
speaker systems -- goes through it.

**`localStorage`** is the legacy layer. It is still read as a fallback and a few
keys are still written there, but it is not durable in any meaningful sense: it
has no atomicity, no versioning and no recovery, and a cleared browser profile
takes it with no trace.

Reads prefer the durable value and fall back to localStorage, via
`readPersistedJson` / `readPersistedString` / `readPersistedBoolean` /
`readPersistedNumber` near the top of `src/renderer.js`. Those helpers read
`durableInitialValues`, which is a **snapshot taken at load**. It does not
change during a session. That matters -- see the pitfall below.

## The write path

`writeEnvelopeAtomic()`:

1. Serialize the envelope; refuse anything over the 64 MB ceiling.
2. Write it to `pixelody-state.pending.json` and `fsync` the descriptor.
3. Re-read and validate the pending file. A failed read aborts the commit.
4. `pixelody-state.json` → `pixelody-state.previous.json`.
5. Rename pending → current.

Steps 3 and 4 are what make this survivable: a crash at any point leaves at
least one complete, valid file on disk.

## The recovery ladder

`loadSync()` tries, in order:

| Source | Outcome |
| --- | --- |
| `current` parses | `ready` |
| `current` is a future schema | `unsupported-future-schema`, **read-only**, commits refused |
| `pending` parses | `recovered`, `recoveredFrom: 'pending'` |
| `previous` parses | `recovered`, `recoveredFrom: 'previous'` |
| nothing parses | `recovery-defaults`, damaged files moved to `quarantine/` |

Damaged files are never deleted. They are renamed into `quarantine/` so a
library can still be recovered by hand after a total loss. `recovery-defaults`
is the only path that starts the app on empty state, and it only happens when
every candidate is unreadable.

## Merge versus replace

`commitSync(values, options)` merges by default: the supplied keys overwrite,
everything else is carried forward. That is required, because a debounced
renderer tick carries only the keys it touched and must not erase the rest.

`options.replaceKnownValues` makes the supplied values authoritative: every key
in `KNOWN_VALUE_KEYS` that the caller omits is **dropped**. Only
`importBackupV1` uses it, because restoring a backup has to be able to remove
things -- a playlist deleted before the backup was taken has to stay deleted.

The sweep is limited to `KNOWN_VALUE_KEYS` on purpose. Keys outside that set
survive a restore untouched, which covers profile-scoped workspace slots and
any key a later schema adds. The active workspace key is retained for the same
reason even though it is a known key: it has its own authority and commit path,
and a v1 backup taken before Canvas existed has nothing to say about it.

> Until 2026-09-20 both arms of that ternary were identical, so
> `replaceKnownValues` was accepted and silently ignored and every restore
> merged. Restores overlaid rather than restored. The existing coverage restored
> into an empty directory, which is the one case where merge and replace look
> the same.

## Failure coverage

`scripts/check-state-durability.js` (`npm run check:durability`, and part of
`npm run check`) injects real failures rather than asserting on source text.
Eleven scenarios: clean reopen, crash between fsync and rename, torn pending
with current intact, current and pending both damaged, corrupt current, a
zero-byte current, total corruption, a future-schema file, an oversized
envelope, concurrent queued commits, and a backup restore over populated state.

Each asserts the same thing in a different way: the library either comes back,
or it is sitting in `quarantine/`. It is never silently replaced with an empty
one.

## Still on localStorage, deliberately

- `pixelody.devLabMechanic` -- Dev Lab specimen selection.
- `pixelody.canvasStudioOptIn` -- development-only Canvas opt-in
  (`CANVAS_OPT_IN_KEY`); see `docs/architecture/CANVAS_AND_STUDIO_GATES.md`.

Both are development-only and neither is user data. Losing them costs a click.

`pixelody.lastAudibleVolume` and `pixelody.speakerRigValidationRuns` were
promoted to the durable store on 2026-09-20. The second one mattered: each run
is up to thirty minutes of captured evidence, kept twelve deep, and it was
living somewhere a cleared profile would erase without trace.

## Adding a durable key

1. Add the key to the matching set in `src/state-store.js` --
   `ARRAY_VALUE_KEYS`, `OBJECT_VALUE_KEYS`, `STRING_VALUE_KEYS`,
   `BOOLEAN_VALUE_KEYS` or `NUMBER_VALUE_KEYS`. An unlisted key is stored but
   never type-checked, and it is invisible to `replaceKnownValues`, so a restore
   will not clear it.
2. Add it to `buildDurableStateValues()` in `src/renderer.js`, reading from live
   renderer state.
3. Read it through the `readPersisted*` helpers, never `localStorage` directly.

**The pitfall.** Do not write `'pixelody.thing': readPersistedJson('pixelody.thing', x)`
in `buildDurableStateValues()` for anything that changes during a session.
Those helpers return the load-time snapshot, so you would persist the value the
session started with and overwrite whatever the user changed. It is only safe
for values fixed at startup -- `pixelody.signalOrbitRepair` is the one legitimate
case. Everything else must come from a live variable.

Large library keys (`DURABLE_LARGE_LIBRARY_SCOPED_KEYS`) are omitted from
commits whose reason is in `DURABLE_LIBRARY_OMITTED_REASONS`, so a volume nudge
does not rewrite the whole library. This is safe only because a plain commit
merges. If you ever make an ordinary commit replace, that optimization becomes a
library-deletion bug.
