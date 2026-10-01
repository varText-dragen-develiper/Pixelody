# Flow Shuffle Development Plan

Status: research and architecture background reviewed 2026-07-20.

## Product boundary

Flow Shuffle should be a local-first, explainable session planner for music the user owns. It must not depend on a licensed cloud catalog, upload listening history, silently insert outside content, or interfere with playback, queue edits, repeat, restore, mini-player, media-key, J.A.M., or audio-tuning behavior.

Pixelody should keep two distinct promises:

1. **Standard Shuffle**: every eligible track appears once per cycle in a reproducible random order.
2. **Flow Shuffle**: a varied, locally personalized order that still obeys queue intent, explicit exclusions, and a no-repeat contract.

The six current Flow modes can remain advanced presets, but the normal transport control should not force users to understand all six before shuffle behaves correctly.

## Current implementation inventory

Already present:

- Six modes: Flow, Discovery, Comfort, Energy Curve, Genre Weave, and Deep Library.
- Queue-scoped candidate selection and a cycle intended to avoid repeats.
- Weighted choice from a top candidate pool rather than always selecting the highest score.
- Artist and genre fatigue, genre contrast, mood overlap, BPM/manual energy, listening roles, favorites, novelty, time-of-day history, completion/skip history, trust calibration, and learned transition signals.
- Local Signal Journal events, per-track statistics, import/export/merge/undo, learning progress, mode analytics, transition memory, explanations, near misses, and score details.
- Persistence of shuffle toggle, Flow mode, cycle, history, and last pick.
- Previous-track history and shared desktop playback state for main-player controls.

Material gaps found during review:

- There is no dedicated shuffle test suite or pure shuffle module; selection logic is embedded in the large renderer.
- The engine chooses only the next track, so the visible queue is not a stable planned order and greedy choices cannot optimize a multi-track session.
- The cycle and history are truncated to 500 and 80 IDs respectively. A queue over 500 tracks can repeat before every eligible track plays.
- Back navigation destructively pops history and does not provide a consistent forward traversal contract.
- A selected track enters the cycle before successful playback is confirmed.
- Explicit user queue intent has no separate `Play Next`/manual-priority lane; all queued tracks become one smart-selection pool.
- The raw weighted score is presented as `confidence`, although it is neither bounded nor calibrated as a probability.
- Mode trust calibration modifies an already accumulated score, which can amplify unrelated factors.
- The Energy Curve mode generally rewards an increase from the current track; it does not yet plan rises, plateaus, recovery, or an endpoint over a session.
- Context tags such as `morning`, `night`, and `workout` currently receive a generic boost whenever present, without verifying that the tag matches the current context.
- Completion and skip rates use small samples directly. A single completion or skip can influence a low-sample track too strongly.
- Android has separate simple random selection/state rather than a shared Flow Shuffle contract.

## Research conclusions

- Spotify's documented **Fewer Repeats** approach generates several random sequences, penalizes recently heard tracks near the front of each sequence, and selects the freshest sequence. It also retains a pure Standard mode. This is a strong model for Pixelody's fairness baseline because it preserves randomness while improving perceived variety.
- Android Media3 models shuffle as an immutable order that must traverse consistently both forward and backward and remain valid when items are inserted, moved, or removed. Pixelody should adopt those behavioral invariants even if it does not use Media3 on desktop.
- Apple Music treats the upcoming queue, user-added `Play Next`/`Add to Queue` items, recent history, shuffle, repeat, and automatic recommendations as related but distinct concepts. Pixelody needs the same separation of user intent from generated order.
- Plex sonic analysis demonstrates the long-term value of local audio embeddings when metadata is sparse, but also documents substantial CPU/time and platform costs. Acoustic analysis belongs after the deterministic and metadata/behavior engine is proven.
- MusicBrainz Picard's tag model confirms that BPM and musical key are reasonable local metadata inputs. Pixelody already imports BPM; key can be added later without waiting for full sonic analysis.

Research sources:

- Spotify Engineering, *Shuffle: Making Random Feel More Human*: https://engineering.atspotify.com/2025/11/shuffle-making-random-feel-more-human/
- Spotify Support, *Shuffle play*: https://support.spotify.com/article/shuffle-play/
- Android Media3, `ShuffleOrder`: https://developer.android.com/reference/androidx/media3/exoplayer/source/ShuffleOrder
- Android Media3, *Playlists*: https://developer.android.com/media/media3/exoplayer/playlists
- Apple Support, *Queue your songs in Music on Mac*: https://support.apple.com/guide/music/queue-your-songs-musb1e6d1c76/mac
- Plex Support, *Sonic Analysis for Music*: https://support.plex.tv/articles/sonic-analysis-music/
- MusicBrainz Picard documentation, tag mapping: https://picard-docs.musicbrainz.org/en/variables/variables.html

## Priority tree

Work from top to bottom. A later sequence should not begin until the preceding gate is met.

### Sequence 0 — Freeze the contract and make it testable

Why first: further tuning is unsafe while selection lives inside renderer state and basic queue invariants are untested.

- [ ] Write the user-visible contract for Standard Shuffle, Flow Shuffle, repeat off/all/one, manual Next/Previous, natural track end, queue edits, restore, missing files, and one-track/empty queues.
- [ ] Extract normalization, eligibility, scoring, planning, and traversal into a pure module with injected clock and seeded random source. Keep renderer code as an adapter.
- [ ] Add `npm run check:shuffle` with deterministic fixtures for empty, one-track, small, large, duplicate-metadata, missing-file, and sparse-metadata libraries.
- [ ] Add property/invariant checks: no in-cycle repeats, no lost eligible IDs, deterministic output for a seed, consistent forward/back, and safe insert/move/remove.
- [ ] Capture fixtures for all six existing modes before changing weights so behavior changes are reviewable.

Gate: repeated test runs are deterministic; queues larger than 500 tracks complete without an early repeat; all playback entry points still use one shared desktop state.

### Sequence 1 — Build a correct persistent shuffle order

Why second: fairness, traversal, and user intent are the foundation on which personalization must sit.

- [ ] Version Flow state and store source queue IDs, planned order, cursor, seed, generation, played history, and manual overrides instead of only `cycle`/`history`.
- [ ] Implement Standard Shuffle as seeded Fisher-Yates with one appearance per eligible item per cycle.
- [ ] Implement Flow's baseline as several seeded candidate orders scored for freshness, then select one order. Preserve controlled randomness rather than selecting the maximum-scored track every time.
- [ ] Make Previous and Next traverse the same planned order. If the user goes back, Next should move forward through known history before generating anything new.
- [ ] Separate `Play Next`, user-added queue items, and user reordering from generated Flow items. Explicit user choices always win.
- [ ] Define queue mutation rules: preserve the current track, do not reshuffle unaffected history, place inserts predictably, remove deleted/missing tracks, and avoid consuming a candidate until playback actually starts.
- [ ] Persist and restore the exact plan/cursor across restart. Define a safe migration from the current state shape.
- [ ] Make repeat semantics explicit: repeat off stops after the eligible cycle; repeat all begins a new generation; repeat one never advances.

Gate: the contract from Sequence 0 passes for main player, mini-player, media keys, natural ending, manual queue edits, restart restoration, and remote desktop commands.

### Sequence 2 — Make learning statistically safe and auditable

Why third: personalized ranking becomes useful only after the base order is correct and reproducible.

- [ ] Classify outcomes by listening fraction and cause. Distinguish an early deliberate skip from near-completion, seek, playback error, missing file, app shutdown, and route failure.
- [ ] Replace raw small-sample completion/skip rates with a prior/shrinkage model and expose sample strength separately from fit.
- [ ] Add decaying cross-session freshness for track, artist, album, and optionally recording identity. Use cooldown windows that scale with queue size.
- [ ] Normalize artist/album/genre values and handle compilations, featured artists, alternate versions, and duplicate recordings deliberately.
- [ ] Add bounded exploration so low-sample tracks receive exposure without overwhelming Comfort mode. Track exposure coverage as a quality metric.
- [ ] Correct context matching: time tags must match actual time; future workout/focus signals must be explicit session inputs rather than inferred without evidence.
- [ ] Decouple mode calibration from the accumulated candidate score. Calibrate individual signals or final rank percentiles with bounded influence.
- [ ] Rename raw score UI to `fit score`; reserve `confidence` for a calibrated value based on evidence quantity/quality.
- [ ] Add a local reset/disable path for learned shuffle data without deleting library metadata or playlists.

Gate: synthetic cold-start, sparse-history, heavy-user, skip-heavy, and long-unplayed-library fixtures meet defined exposure, repeat, artist-spacing, and user-intent metrics; every applied signal remains explainable.

### Sequence 3 — Plan musical sessions, not isolated picks

Why fourth: this is the point where Flow can materially surpass ordinary shuffle rather than merely reweight it.

- [ ] Plan a rolling horizon (for example, the next 5–10 tracks) and replan only the untouched generated portion after queue or context changes.
- [ ] Score both track suitability and transition cost. Avoid locally good choices that create a poor third or fourth transition.
- [ ] Give Energy Curve explicit session shapes: steady, rise, wave, and wind-down. Keep the current simple mode as a compatibility preset until migration is complete.
- [ ] Add album-aware policies: default track shuffle, optional album shuffle, and an opt-in preserve-album-runs behavior.
- [ ] Parse/import musical key where available, normalize BPM/key confidence, and use them only as soft transition inputs. Missing metadata must never make a track ineligible.
- [ ] Add diversity budgets for artist, album, genre, mood, era, and user tags that scale with pool size rather than fixed penalties.
- [ ] Display the stable generated upcoming order and mark why manual items outrank Flow items.

Gate: multi-step simulations outperform the Sequence 2 baseline on repeats, artist/album spacing, exposure, abrupt energy changes, and skip proxy without collapsing diversity or determinism.

### Sequence 4 — Simplify control and explanation surfaces

Why fifth: UI should reflect proven semantics, not become a test bed for unstable behavior.

- [ ] Make the primary choice understandable: Off, Standard, and Flow. Keep the six Flow presets in an advanced mode picker.
- [ ] Show whether the next item is manual, Standard, or Flow-generated and allow `Why this track?` without exposing misleading precision.
- [ ] Provide `Play sooner`, `Not this session`, and `Less like this` controls with scoped, undoable effects; do not treat every action as a permanent taste judgment.
- [ ] Show learning readiness and missing-metadata coverage without suggesting that more surveillance is required.
- [ ] Keep controls, labels, state, and explanations coherent across main player, queue drawer, mini-player, desktop remote/J.A.M. surfaces, and Android.
- [ ] Verify keyboard access, screen-reader names, reduced motion, and every built-in theme.

Gate: a user can predict the difference between Standard and Flow, manual queue intent is visually obvious, and all surfaces report the same state.

### Sequence 5 — Share the engine and contract across devices

Why sixth: desktop semantics should be stable before they become a network/API compatibility promise.

- [ ] Add a versioned shuffle snapshot/command contract to the personal server: mode, preset, generation, cursor, source, and explanation summary.
- [ ] Decide ownership explicitly: host plans the order for remote-controlled desktop playback; a standalone Android-local session uses the same fixtures/algorithm version on its own queue.
- [ ] Replace Android's independent random pick with the shared contract or a port verified by cross-platform golden fixtures.
- [ ] Define J.A.M. authority and conflict rules for shuffle toggles, manual inserts, reorders, and simultaneous Next commands.
- [ ] Keep private listening intelligence on the owning device unless the user explicitly exports/transfers it.

Gate: desktop, remote Android control, standalone Android playback, restore, and J.A.M. agree on order/traversal for the same versioned fixture and seed.

### Sequence 6 — Optional local acoustic intelligence

Why last: it is expensive, platform-sensitive, and unnecessary for making the current engine correct and substantially better.

- [ ] Prototype offline analysis for loudness, tempo confidence, musical key, energy/dynamics, and a compact audio embedding. Never modify source files.
- [ ] Run analysis as resumable, throttled background work with visible progress, pause/cancel controls, power/CPU limits, and per-library opt-in.
- [ ] Store feature versions and confidence so models can be replaced without corrupting manual metadata.
- [ ] Blend sonic distance as one bounded signal, especially for sparse/obscure metadata; never let it silently override manual tags or queue choices.
- [ ] Add Track Radio, bridge, and sonic-neighbor experiments only after coverage and resource-cost gates pass.
- [ ] Document model/code licenses and asset provenance before bundling any analyzer.

Gate: large-library analysis is resumable and measured, playback latency is unaffected, privacy remains local, licenses are documented, and Flow degrades cleanly when no acoustic features exist.

## First implementation slice

The first coding session should do only Sequence 0 plus the smallest state scaffolding needed for Sequence 1:

1. Extract a pure shuffle engine without changing the UI or current weights.
2. Add seeded RNG and a versioned plan-state shape behind the adapter.
3. Add deterministic and invariant fixtures, including a 1,000-track queue.
4. Fix the 500-track early-repeat and forward/back traversal defects.
5. Run `npm run check`, `npm run check:audio`, `npm run check:themes`, and the new `npm run check:shuffle`.

Do not begin acoustic analysis, add more presets, or tune preference weights in the first slice. Those changes would make correctness regressions harder to isolate.

## Evaluation scorecard

Every sequence should report these locally computed measures against fixed fixtures and opt-in real-library diagnostics:

- Early-repeat count and full-cycle coverage.
- Median gap between the same artist and album.
- Percentage of eligible tracks exposed over repeated sessions.
- Distribution of plays by play-count decile, not only average score.
- Manual queue-intent violations (target: zero).
- Forward/back/restore mismatches (target: zero).
- Skip classifications and linked-outcome coverage.
- Transition abruptness for energy/BPM/key only when those fields are present and confident.
- Planning time and persistence size at 100, 1,000, and 10,000 tracks.
- Explanation fidelity: every displayed reason must correspond to a bounded signal actually used for that decision.
