# Flow Shuffle development notes

These notes summarize the July 20, 2026 review. The wording was revised on
October 22; this isn't a new check of the current build. The earlier plan and its
full implementation checklist are still in the repository's history.

## What needed to change

I want Flow Shuffle to put together a listening session that feels varied and
fits what someone likes. The listener should still be able to change the queue
without having to work around it, and see why a track was picked when they're
curious.

At the July review, there was already quite a bit behind it: six presets, local
listening history, artist and genre spacing, metadata and preference signals,
and a Signal Journal for inspecting and managing what it learned. The presets
were Flow, Discovery, Comfort, Energy Curve, Genre Weave, and Deep Library.

The problem was that it still chose one track at a time. There wasn't a settled
upcoming order, and going back removed entries from history rather than letting
someone move back and forward through the same session. Manual queue choices
also went into the selection pool instead of getting their own priority. Those
are fairly basic things to get right before spending more time tuning what the
engine thinks someone wants to hear.

There were a couple of concrete limits too. The cycle kept 500 track IDs and
history kept 80, so a queue over 500 tracks could repeat before everything had
played. A selection counted toward the cycle before playback was confirmed.
The interface called a raw weighted score `confidence`, even though it wasn't a
probability. Small samples, time tags that didn't match the actual context, and
mode calibration could all give a signal more influence than it deserved.
Android still had separate, simpler shuffle behavior at that review.

## Where I want it to go

Standard Shuffle should go through every eligible track once per cycle, in a
random order we can reproduce from its seed. Flow can use local listening
signals to shape that order, but it still needs to respect exclusions, repeat
settings and manual choices. The six presets don't need to become a lesson
someone has to sit through just to turn on shuffle.

The work starts with keeping an order that survives queue edits, Previous and
Next, and a restart. After that, there's room to improve how the learning deals
with sparse history and to plan a few tracks ahead. Energy Curve, for example,
could shape a session rather than mostly rewarding an increase from the current
track. Missing BPM or key information shouldn't keep a track out of the queue.

All of this should work locally with the listener's music. It doesn't need a
licensed cloud catalog, outside tracks slipped into the queue, or listening
history uploaded to make its decisions. The main player, mini-player, media
keys, J.A.M. and Android should agree on the behavior, without breaking ordinary
playback, repeat, restore or audio tuning.

## References behind the plan

Spotify's Fewer Repeats approach leaves room for randomness while reducing how
often recently heard tracks come back: it generates several orders and chooses
the freshest one, with Standard Shuffle available separately. That was worth
looking at alongside the queue rules. Media3's shuffle order and Apple Music's
handling of manual additions give useful references for what should happen when
someone goes back, moves a track or chooses `Play Next`.

Audio analysis can come later. Plex shows what it could offer when tags don't
tell us much about the music, but there's processing time and platform support
to account for. There's enough to work on with the queue, history and metadata
before taking that on. Pixelody imported BPM at this review; musical key could
be added separately using the tag mappings documented by Picard.

- [Spotify Engineering: Shuffle, Making Random Feel More Human](https://engineering.atspotify.com/2025/11/shuffle-making-random-feel-more-human/)
- [Spotify: Shuffle play](https://support.spotify.com/article/shuffle-play/)
- [Media3: ShuffleOrder](https://developer.android.com/reference/androidx/media3/exoplayer/source/ShuffleOrder)
- [Media3: Playlists](https://developer.android.com/media/media3/exoplayer/playlists)
- [Apple Music: Queue your songs](https://support.apple.com/guide/music/queue-your-songs-musb1e6d1c76/mac)
- [Plex: Sonic Analysis for Music](https://support.plex.tv/articles/sonic-analysis-music/)
- [MusicBrainz Picard: Tag mapping](https://picard-docs.musicbrainz.org/en/variables/variables.html)

## Working on shuffle

Start with the current implementation and tests rather than treating the July
inventory as today's defect list. A useful comparison records the order,
repeats, artist/album spacing and how much of the library gets heard, including
what happens after manual edits, an unavailable file or a restart. Include a
queue over 500 tracks and make sure a failed playback attempt doesn't use up a
track's turn.

The plan called for deterministic fixtures and a separate shuffle engine, with
`npm run check:shuffle` alongside `npm run check`, `npm run check:audio` and
`npm run check:themes`. Use the scripts available in your checkout and keep
automated results separate from what someone actually tried while listening.
These notes don't mark the later implementation or device checks complete.
