# Bringing a music collection into Pixelody

The original direction was discussed on July 1, 2026. This is a summary of that
plan and its later implementation notes, not a claim that the whole migration
system is available.

I don't want getting started to mean figuring out folder structures, metadata,
artwork and export tools before someone can listen. Someone might arrive with
years of playlists and favorite artists, even if they haven't put the music
files on that device yet. Bringing that collection along should help them keep
what mattered about it.

The proposed Library Concierge would start with what they already use and what
they want to bring over: local folders, a drive, a backup or a playlist export.
It would show what matched, what was uncertain and what was missing before
applying changes. A missing song shouldn't quietly disappear from a playlist.
Keep it available to match to a file later, mark as wanted or look up through an
artist or store link.

File-based playlist imports were the practical starting point: CSV with column
mapping, JSON, plain track lists, local m3u/m3u8 files and Pixelody backups. A
provider account could come later where its API and terms allow it. Importing
playlist metadata doesn't supply the audio, and the plan doesn't include ripping
streams, bypassing DRM or turning preview clips into a listening catalog.

## Matching and fixing the collection

A title alone isn't always enough to tell two recordings apart. The proposed
matcher would combine artist, album, duration, identifiers and local file facts,
then let someone review uncertain matches. The suggested states were `matched`,
`likely_match`, `ambiguous`, `missing`, `ignored` and `needs_review`.

Repair should show the changes first and keep a way to undo them. Local metadata
overrides come before writing tags into source files; safe tag writing is its
own format-specific feature. The plan also considered duplicate review, missing
file repair and artwork cleanup, without bundling someone else's artwork as
Pixelody's own assets.

MusicBrainz, compatible Cover Art Archive use, ListenBrainz and local edits were
possible sources. Each integration still needs its own permission, attribution,
rate-limit, retention and commercial-use checks. An external connection should
be optional and removable, with the listener able to see what stays stored.

## Finding something to listen to

There's a lot to do with the collection itself: forgotten favorites, unplayed
albums, deep cuts from an artist someone likes, or music that has been buried in
the library. Local metadata, favorites and listening history can support those
without pretending Pixelody has a licensed streaming catalog.

The implementation notes recorded MusicBrainz, Bandcamp and Discogs link-outs in
the track editor, with cleanup/discovery actions for incomplete metadata. Wanted
Music put Buy, Info, Discogs and Import actions beside missing songs. Those were
user-opened browser links, not scraped results, embedded audio or music hosted
by Pixelody. The editor changed the app's local metadata without writing into
the original audio file.

A later discovery site could make artist and release information easier to
browse and hand a wanted list back to the app. Hosting commercial audio would
need separate rights and licensing. Provider OAuth, remote listening history,
provider artwork and monetized third-party data also need review before launch.

The larger library-building, repair, provider-import and cross-device ideas
remain plans wherever no implementation result is recorded. The full proposed
schema and development sequence are in Git history. For current downloads and
setup, use the [website guide](https://pixelody-web.pixelody101.workers.dev/docs?doc=library-migration-discovery#reader)
and your build's release notes.
