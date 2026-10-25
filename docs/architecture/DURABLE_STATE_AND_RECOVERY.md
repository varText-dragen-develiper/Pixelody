# Saving and recovering state

September 20, 2026 reference for `src/state-store.js`, `buildDurableStateValues()` and the renderer's persisted-value helpers.

`PixelodyStateStore` keeps the library, playlists, tuning, systems, favorites, play counts, history, queue, watched folders, appearance and speaker rigs under `userData/state`. It uses a versioned file envelope. Browser `localStorage` remains a legacy read fallback and still holds a few development choices; clearing it isn't a recovery strategy for user data.

Reads go through `readPersistedJson`, `readPersistedString`, `readPersistedBoolean` or `readPersistedNumber`. They prefer `durableInitialValues`, which is a snapshot from startup. They don't read the current session's changes.

## Writing a file

`writeEnvelopeAtomic()` rejects envelopes over 64 MB, writes `pixelody-state.pending.json`, fsyncs it, and rereads it for validation. Only then does it move the current file to `pixelody-state.previous.json` and rename pending to `pixelody-state.json`. The previous valid copy is available if a write is interrupted.

`loadSync()` tries the files in this order:

| Source | Outcome |
| --- | --- |
| `current` parses | `ready` |
| `current` is a future schema | `unsupported-future-schema`, **read-only**, commits refused |
| `pending` parses | `recovered`, `recoveredFrom: 'pending'` |
| `previous` parses | `recovered`, `recoveredFrom: 'previous'` |
| nothing parses | `recovery-defaults`, damaged files moved to `quarantine/` |

Unreadable files go to `quarantine/`, rather than being deleted. Only the final recovery-defaults path opens empty state. A future schema opens read-only and refuses commits; it mustn't be overwritten by an older app.

## Updating state and restoring a backup

A normal `commitSync(values, options)` merges supplied keys. Debounced changes often contain only a few settings, so replacing the whole store would erase unrelated data. Library-scale keys in `DURABLE_LARGE_LIBRARY_SCOPED_KEYS` are deliberately omitted for reasons in `DURABLE_LIBRARY_OMITTED_REASONS`; that optimization depends on merge behavior.

`importBackupV1` uses `options.replaceKnownValues` instead. It removes omitted keys from `KNOWN_VALUE_KEYS` so a restore can actually restore deleted playlists and settings. Unknown keys and profile-scoped workspace slots survive, as does the separately owned active workspace key. An old backup has no authority over a workspace it never recorded.

That option was silently ignored before September 20: both branches merged. Restoring into an empty directory hid the bug, so the regression check now also restores over populated state.

## Adding a saved setting

Add the key to its typed set in `state-store.js`: `ARRAY_VALUE_KEYS`, `OBJECT_VALUE_KEYS`, `STRING_VALUE_KEYS`, `BOOLEAN_VALUE_KEYS` or `NUMBER_VALUE_KEYS`. An unlisted key can be stored, but won't get type validation or be cleared by a replace restore. Add its live value to `buildDurableStateValues()`, and use a persisted-value helper when initializing it.

Don't call a `readPersisted*` helper from the snapshot builder for a setting that changes during the session. That writes the startup value back over the listener's change. `pixelody.signalOrbitRepair` was the intentional exception because it was fixed at startup.

`pixelody.devLabMechanic` and `pixelody.canvasStudioOptIn` can remain in browser storage: they're development selections. `pixelody.lastAudibleVolume` and `pixelody.speakerRigValidationRuns` moved to the durable store on September 20. Validation runs can contain thirty minutes of evidence, twelve runs deep, so losing them with a cleared browser profile wasn't acceptable.

Run `npm run check:durability` (also part of `npm run check`). Its eleven scenarios cover reopen, interrupted rename, torn/damaged/empty files, total corruption, future schemas, size limits, queued writes and populated-state restore. Check both recovered data and retained quarantine files.
