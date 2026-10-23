# Flow Shuffle Development Plan

This is the research and architecture plan reviewed on July 20, 2026, with the wording revised on October 22. The inventory below describes that earlier review, not a fresh check of the app.

## What I want from shuffle

I want Flow Shuffle to put together a listening session that feels varied and fits what someone likes. It should work locally with their music, and they should be able to see why it picked something. It doesn't need a licensed cloud catalog, and it shouldn't upload listening history or slip outside tracks into the queue.

There are two choices I want to keep clear:

1. **Standard Shuffle** goes through every eligible track once per cycle, in a random order we can reproduce from its seed.
2. **Flow Shuffle** uses local listening history to shape the order, while respecting what someone put in the queue, what they excluded, and when a track is allowed to repeat.

The six Flow modes can stay as advanced presets. Someone should be able to turn on shuffle and use it without having to learn all six first.

That work also needs to leave the rest of the player working: playback, queue edits, repeat, restore, the mini-player, media keys, J.A.M., and audio tuning.

## What was there at the July review

The implementation already had:

- Six modes: Flow, Discovery, Comfort, Energy Curve, Genre Weave, and Deep Library.
- Track selection from the queue, with a cycle intended to prevent repeats.
- A weighted choice from the best-scoring candidates, rather than always picking the one with the highest score.
- Signals for artist and genre fatigue, genre contrast, mood overlap, BPM/manual energy, listening roles, favorites, novelty, time of day, completions and skips, trust calibration, and learned transitions.
- A local Signal Journal with per-track statistics, import/export/merge/undo, learning progress, mode analytics, transition memory, explanations, near misses, and score details.
- Saved shuffle state: the toggle, Flow mode, cycle, history, and last pick.
- Previous-track history, with the main-player controls using the shared desktop playback state.

There were also some fairly important problems to work through:

- Selection was still inside the large renderer. There wasn't a separate shuffle module or dedicated test suite.
- It picked one track at a time. The queue couldn't show a settled upcoming order, and the engine couldn't work out whether a good next pick led to a poor session a few tracks later.
- The cycle kept only 500 IDs and history kept 80. With more than 500 tracks in the queue, a track could repeat before everything had played.
- Going back removed entries from history, so going forward again didn't follow a consistent rule.
- A selected track counted toward the cycle before playback was confirmed.
- `Play Next` and other manual queue choices didn't have their own priority. Everything went into the same selection pool.
- The UI called the raw weighted score `confidence`, even though it wasn't bounded or calibrated as a probability.
- Mode trust calibration changed an already accumulated score, which could amplify factors it wasn't meant to affect.
- Energy Curve mostly rewarded an increase from the current track. It didn't plan rises, plateaus, recovery, or an ending across the session.
- Tags like `morning`, `night`, and `workout` got a general boost just for being present. The engine didn't check whether they matched the situation.
- Completion and skip rates used small samples directly. One play or skip could have too much influence on a track with little history.
- Android used its own simpler random selection and state, rather than the same Flow Shuffle rules.

## What the research suggests

Spotify's **Fewer Repeats** approach makes several random orders, penalizes recently heard tracks near the start, and chooses the freshest order. It also keeps a pure Standard mode. That's a useful starting point for variety without giving up randomness.

Android Media3 treats shuffle as an immutable order. Next and Previous need to follow it consistently, including after tracks are inserted, moved, or removed. Those are useful rules for Pixelody even without using Media3 on desktop.

Apple Music keeps the upcoming queue, `Play Next`/`Add to Queue`, history, shuffle, repeat, and automatic recommendations distinct. I want that same clarity about which choices came from the listener and which came from the app.

Plex's sonic analysis shows what local audio embeddings can add when metadata is thin. It also comes with real processing time and platform costs. I'd get the repeat rules, saved order, and metadata/history-based selection working first.

MusicBrainz Picard's tag mapping supports BPM and musical key as local inputs. Pixelody already imported BPM at this review. Key could come later without waiting for full audio analysis.

Sources used for this research:

- Spotify Engineering, *Shuffle: Making Random Feel More Human*: https://engineering.atspotify.com/2025/11/shuffle-making-random-feel-more-human/
- Spotify Support, *Shuffle play*: https://support.spotify.com/article/shuffle-play/
- Android Media3, `ShuffleOrder`: https://developer.android.com/reference/androidx/media3/exoplayer/source/ShuffleOrder
- Android Media3, *Playlists*: https://developer.android.com/media/media3/exoplayer/playlists
- Apple Support, *Queue your songs in Music on Mac*: https://support.apple.com/guide/music/queue-your-songs-musb1e6d1c76/mac
- Plex Support, *Sonic Analysis for Music*: https://support.plex.tv/articles/sonic-analysis-music/
- MusicBrainz Picard documentation, tag mapping: https://picard-docs.musicbrainz.org/en/variables/variables.html

## Order of work

Work through these in order. Each stage has a check before moving on. These are the original plan's unchecked items, not a current completion report.

### Sequence 0 — Agree on the behavior and make it testable

Start here because tuning weights won't fix queue rules we haven't pinned down or tested.

- [ ] Write down how Standard Shuffle, Flow Shuffle, repeat off/all/one, Next/Previous, natural track endings, queue edits, restore, missing files, and one-track/empty queues should behave.
- [ ] Move normalization, eligibility, scoring, planning, and traversal into a pure module. Inject the clock and seeded random source, with renderer code acting as the adapter.
- [ ] Add `npm run check:shuffle` with repeatable fixtures for empty, one-track, small, large, duplicate-metadata, missing-file, and sparse-metadata libraries.
- [ ] Check that a cycle doesn't repeat or lose eligible IDs, the same seed gives the same output, forward/back traversal agrees, and insert/move/remove stays safe.
- [ ] Save fixtures for all six modes before changing their weights, so we can compare what changed.

Before moving on: repeated runs need to give the same results, queues over 500 tracks need to finish without an early repeat, and every playback entry point needs to use the shared desktop state.

### Sequence 1 — Keep a shuffle order that survives a restart

Get the order, traversal, and manual choices right before adding more personalization.

- [ ] Version the Flow state. Store the source queue IDs, planned order, cursor, seed, generation, played history, and manual overrides, rather than only `cycle`/`history`.
- [ ] Use seeded Fisher-Yates for Standard Shuffle, with every eligible item appearing once per cycle.
- [ ] For Flow's baseline, generate several seeded orders, score their freshness, and choose one. Keep some randomness instead of always choosing the highest-scoring next track.
- [ ] Make Previous and Next follow the same plan. After going back, Next should follow the known history before generating anything new.
- [ ] Give `Play Next`, user-added items, and manual reordering priority over Flow's generated order.
- [ ] Define what happens when the queue changes: keep the current track, leave unaffected history alone, place new items predictably, remove deleted/missing tracks, and count a candidate only after playback starts.
- [ ] Save and restore the exact plan/cursor. Include a safe migration from the existing state format.
- [ ] Keep repeat behavior explicit: off stops at the end of the eligible cycle, all starts a new generation, and one doesn't advance.

Before moving on: run the Sequence 0 checks through the main player, mini-player, media keys, natural endings, manual queue edits, restart, and remote desktop commands.

### Sequence 2 — Make the learning useful and checkable

Once the order is reliable, we can work on what the engine learns from listening.

- [ ] Record how much of a track played and why it ended. An early deliberate skip shouldn't mean the same thing as near-completion, seeking, a playback error, a missing file, shutdown, or a route failure.
- [ ] Use a prior/shrinkage model for completion and skip rates, so one play doesn't dominate. Show the amount of evidence separately from how well a track fits.
- [ ] Track freshness across sessions for tracks, artists, albums, and optionally recording identity. Let it fade over time, with cooldowns that scale to the queue size.
- [ ] Normalize artist/album/genre values and account for compilations, featured artists, alternate versions, and duplicate recordings.
- [ ] Give tracks with little history some exposure without letting exploration take over Comfort mode. Measure how much of the library gets heard.
- [ ] Match time tags to the actual time. Any later workout/focus setting should come from an explicit session choice, not a guess without evidence.
- [ ] Separate mode calibration from the accumulated candidate score. Calibrate individual signals or final rank percentiles, and limit how much they can influence the result.
- [ ] Call the raw score `fit score`. Use `confidence` only for a calibrated value that reflects the amount and quality of evidence.
- [ ] Let someone reset or disable learned shuffle data without deleting library metadata or playlists.

Before moving on: test cold starts, sparse history, heavy use, frequent skips, and long-unplayed libraries. Set targets for exposure, repeats, artist spacing, and manual choices, then check them. Every signal used in a decision needs an explanation we can trace.

### Sequence 3 — Plan a session a few tracks ahead

This is where I want Flow to do more than keep adjusting the next pick.

- [ ] Plan a rolling window, for example the next 5–10 tracks. After a queue or context change, replan only the generated part that hasn't been touched.
- [ ] Score the track and the transition into it. A good next pick shouldn't leave us with a poor third or fourth transition.
- [ ] Give Energy Curve steady, rise, wave, and wind-down shapes. Keep the simpler existing mode as a compatibility preset until migration is finished.
- [ ] Keep track shuffle as the default, with optional album shuffle and an opt-in way to preserve album runs.
- [ ] Import musical key where available and normalize BPM/key confidence. Treat them as soft transition inputs; missing metadata must never exclude a track.
- [ ] Set diversity budgets for artist, album, genre, mood, era, and user tags according to the pool size, rather than relying on fixed penalties.
- [ ] Show the planned upcoming order, including why a manual item takes priority over Flow.

Before moving on: compare multi-step simulations with Sequence 2 on repeats, artist/album spacing, exposure, abrupt energy changes, and the skip proxy. Improvements shouldn't come at the cost of diversity or reproducibility.

### Sequence 4 — Make the controls easy to follow

The interface needs to describe behavior we've checked, so this comes after the engine work.

- [ ] Keep the main choice to Off, Standard, and Flow. Put the six Flow presets in the advanced picker.
- [ ] Show whether the next item came from a manual choice, Standard, or Flow. Add `Why this track?` without implying more precision than we have.
- [ ] Add `Play sooner`, `Not this session`, and `Less like this`, with limited, undoable effects. A session choice shouldn't automatically become a permanent judgment about someone's taste.
- [ ] Show how much listening history and metadata are available, without implying that someone needs to share more private data.
- [ ] Keep the controls, labels, state, and explanations consistent across the main player, queue drawer, mini-player, desktop remote/J.A.M., and Android.
- [ ] Check keyboard access, screen-reader names, reduced motion, and every built-in theme.

Before moving on: someone should be able to tell what Standard and Flow will do, see where their manual choices take priority, and get the same state from each interface.

### Sequence 5 — Use the same rules across devices

Settle the desktop behavior before making other devices depend on it.

- [ ] Add a versioned shuffle snapshot/command contract to the personal server: mode, preset, generation, cursor, source, and explanation summary.
- [ ] Make ownership clear. The host plans remote-controlled desktop playback; standalone Android playback uses the same fixtures/algorithm version on its own queue.
- [ ] Replace Android's separate random pick with the shared contract, or a port checked against cross-platform golden fixtures.
- [ ] Define who has authority in J.A.M. and how to handle conflicting shuffle toggles, inserts, reorders, and simultaneous Next commands.
- [ ] Keep listening intelligence on its owning device unless someone explicitly exports or transfers it.

Before moving on: desktop, remote Android control, standalone Android playback, restore, and J.A.M. need to agree on order and traversal for the same versioned fixture and seed.

### Sequence 6 — Try optional local audio analysis

Leave this until last. It's expensive, varies by platform, and isn't needed to fix the earlier problems.

- [ ] Prototype offline analysis for loudness, tempo confidence, musical key, energy/dynamics, and a compact audio embedding. Leave the source files untouched.
- [ ] Make background analysis resumable and throttled. Include progress, pause/cancel, power/CPU limits, and opt-in for each library.
- [ ] Store feature versions and confidence, so replacing a model doesn't damage manual metadata.
- [ ] Use sonic distance as one limited signal, especially when metadata is sparse. It shouldn't quietly override manual tags or queue choices.
- [ ] Try Track Radio, bridge, and sonic-neighbor ideas only after checking coverage and resource costs.
- [ ] Check and document model/code licenses and asset provenance before bundling an analyzer.

Before moving on: measure large-library analysis and confirm it resumes, leaves playback latency unaffected, keeps data local, and has documented licenses. Flow still needs to work when no acoustic features are available.

## Where I'd start coding

Keep the first session to Sequence 0 and just enough state structure for Sequence 1:

1. Extract the pure shuffle engine, leaving the UI and current weights alone.
2. Add seeded RNG and a versioned plan-state format behind the adapter.
3. Add deterministic and invariant fixtures, including a 1,000-track queue.
4. Fix the early repeat above 500 tracks and the forward/back traversal problems.
5. Run `npm run check`, `npm run check:audio`, `npm run check:themes`, and the new `npm run check:shuffle`.

Save acoustic analysis, extra presets, and preference-weight tuning for later. Changing those at the same time would make it harder to tell what caused a regression.

## How I'd check the results

For each stage, compare fixed fixtures and opt-in real-library diagnostics using these local measurements:

- Early repeats and how much of the cycle played.
- Median spacing between tracks from the same artist and album.
- The percentage of eligible tracks heard across repeated sessions.
- Plays grouped by play-count decile, rather than just an average score.
- Manual queue choices that weren't respected; the target is zero.
- Forward/back/restore mismatches; the target is zero.
- Skip classifications and how many have linked outcomes.
- Abrupt energy/BPM/key changes, where the metadata exists and is reliable.
- Planning time and saved-state size at 100, 1,000, and 10,000 tracks.
- Whether every displayed explanation matches a signal actually used, with the intended limit on its influence.
