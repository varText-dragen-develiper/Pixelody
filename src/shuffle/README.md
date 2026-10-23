# Universal shuffle v2 reference

Policy `universal-shuffle-v2.1`, config 1. The executable machine contract,
JSON schemas and replay traces live in
`docs/api-contract-fixtures/shuffle-universal-v2/`. That directory's manifest
hashes every shared input. Schema and policy changes need compatibility review.

CommonJS: `require('./src/shuffle')` exports the scheduler. Browser scripts load
`universal.js`, `learning.js`, then `scopes.js`; their globals are
`PixelodyUniversalShuffle`, `PixelodyShuffleLearningV2`, `PixelodyShuffleScopesV2`.
Legacy engine/planner `universalPolicy` exports resolve this same scheduler.
Legacy track-ID functions remain migration compatibility; active platform
adapters must use occurrence-aware universal calls.

## Activation transaction

1. Create a session with explicit stable `scopeId`, unique `sessionId`,
   `authorityId`, seed and source occurrences `{entryId,trackId,...}`. A library
   ordinarily has one source entry per catalog item. Playlist duplicates retain
   separate entry IDs. Select a saved mode, or use the default Balanced mode.
2. Call `stage(state,{attemptId,advanceId,direction,entryId,naturalEnd},context)`.
   Persist the staged state before starting activation. Context supplies an
   injected `nowMs` and an array of integer learning `signals`. Staging reserves
   an offer; it does not change committed RNG, history or entitlement.
3. On actual playback success call `commit(staged,{attemptId,decisionId,
   authorityId,authorityEpoch,positionMs})` with identifiers from the reservation.
   On decode/route/permission/network failure call `abort` with those same
   identifiers. Keep one `advanceId` through the bounded failed-candidate chain,
   while each distinct playback attempt gets its own `attemptId`.
4. Duplicate/stale callbacks return unchanged state. Do not fabricate activation
   or listening events from painting, preloading, source preparation or seeking.
   A position checkpoint includes current actual `occurrenceId`; it teaches no
   listening. Cold `restore(snapshot)` returns paused, clears unconfirmed
   pending activation and preserves the original unsupported/corrupt snapshot.

`reduce` routes versioned commands through these same functions. For durable
exactly-once command replay, include `eventId`, `producerId` and contiguous
positive `sequence`. Persist the emitter sequence with its commands. Missing
commands must replay in order; rotate producer identity only at an explicit
authority/producer checkpoint. Convenience calls still require serialized
adapter mutation and activation guards.

## Queue authority and control

`project(state,{horizon,context})` returns the authoritative future's entry IDs
and actual receipts without modifying the live state. Existing pending
reservations are retained. Supply the same clock/signals to staging, projection,
mode change and public projection. Store/cache a projection with its state
revision and input context; invalidate when either changes.

Foreground adapters should use `createProjection` plus `advanceProjection` and
yield between calls. Each batch plans one selection; `context.cancelled=true`
stops before another batch. The synchronous `project` helper is bounded to 32
entries and is intended for tests, workers and small queues. Normal transport
stages only one candidate.

Use entry IDs for `mutate` priority/move/remove/insert/clear/exclude/include/undo.
Move indexes count successful future advances; their entries are reserved from
automatic choice until that position, then append if the queue is shorter.
Explicit Play Now/Next outranks forward history and forks it on confirmed
activation. Ordinary Previous/Next keeps actual occurrences and tombstones.

`setMode(state,mode,options,context)` preserves remaining entitlement. Off
freezes the existing projection/permutation and source tail using that same
authority context. `reshuffle-remaining` preserves the tail; explicit `newCycle`
is the only deliberate early entitlement reset. Keep `scopeId` stable across
sorting, restarts, mode changes and ordinary queue edits. `scopes.js` retains
32 scopes and refuses new scopes at capacity until explicit eviction. An
eviction reports unfinished entitlement and does not claim completion.

## Learning and privacy

Pass actual service/audio intervals to `learning.reduce`, with an independent
boot clock ID, monotonic bounds, observed media bounds and true playing state.
Close boundaries at pause, seek, speed/buffer/focus/source changes and process
exit. Track unique coverage separately from wall time. Attach personal/remote
provenance and infrastructure reason to outcomes. The shared learning contract
pins all event, decay, confidence, coverage and retention rules.

Compute `context.signals` as one `{trackId,...learning.trackSignals(ledger,
trackId,{nowMs})}` row per known catalog item. Reuse this normalized immutable
snapshot while projecting a horizon. Never serialize platform paths, credentials
or synthetic features into these signals.

`publicSnapshot(state,identityMappers,context)` requires explicit safe mappings
for track, entry, occurrence, decision and authority IDs plus the real authority
context. Map private IDs to safe public identifiers; never return private IDs
unchanged. No private learning, feature evidence or journal is exported. The
coordinator owns connected handoff and host-epoch integration acceptance.

## Checks

Run `node scripts/check-shuffle-universal.js`,
`node scripts/check-shuffle-universal-learning.js --write-receipt`,
`node scripts/check-shuffle-universal-simulations.js`, and
`node scripts/check-flow-shuffle.js`. Regeneration with `--write-fixtures` is a
policy-maintainer action, followed by ordinary drift-check execution.

Core test/simulation results are local reference evidence. Platform adoption,
Kotlin parity, filesystem durability, renderer scheduling, connected handoff,
audible output, physical devices and human preference remain separate gates.
