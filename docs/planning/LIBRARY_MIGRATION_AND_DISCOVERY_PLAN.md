# Library Migration And Discovery Plan

These notes capture future Pixelody direction discussed on July 1, 2026. They are planning notes and should not be treated as implemented behavior.

## Product Intent

Pixelody should make it easy for a person to turn their existing music life into a local, owned, beautiful library.

The target is not "Spotify, but local." The target is:

- Bring over the user's playlists, saved-track memory, taste signals, and collection shape.
- Find and organize music files the user already owns or controls.
- Repair messy metadata and artwork.
- Make missing music visible and actionable instead of silently failing.
- Help users rediscover their own library and discover new music without pretending Pixelody hosts a licensed catalog.

The preferred product framing is:

```text
Bring your playlists.
Find your files.
Repair the mess.
Rediscover your taste.
Keep ownership.
```

Avoid framing Pixelody as a scraper, downloader, stream ripper, cloud catalog, or replacement for licensed streaming catalogs.

## Core User Problems

### 1. Library Creation Is Too Hard

Most users do not want to learn file scraping, provider export tools, metadata repair, folder structures, codec details, or artwork handling before listening to music.

Pixelody should replace raw file management with a guided Library Concierge flow:

```text
What do you already use?
Where is your music?
What do you want Pixelody to recreate?
Here is what we found.
Here is what matched.
Here is what is missing.
Here is what to do next.
```

### 2. Comfort And Familiarity Matter

Pixelody's visual personality is already a strength, but migration still loses behavioral comfort:

- liked songs
- recently played
- saved albums
- playlists
- search habits
- recommendation habits
- continuation from the user's old library

Pixelody should offer familiar collection surfaces while keeping its local-first identity.

### 3. Discovery Is A Streaming-Service Advantage

Spotify, Pandora, and similar services have licensed catalogs, recommendation data, and rights infrastructure. Pixelody should not imply that it can legally provide full-track catalog discovery unless an explicit future partnership or license exists.

Pixelody can still become strong at:

- local rediscovery
- open metadata discovery
- external link-out discovery
- wanted-music tracking
- optional listening-history integration with open services

## Non-Negotiables

- Do not scrape, rip, bypass DRM, or encourage users to download audio from streaming providers.
- Use provider APIs only within their terms, scopes, branding rules, and data-retention limits.
- Treat Spotify/Pandora/other provider data as migration metadata and user memory, not as playable audio.
- Do not bundle commercial artwork or provider artwork as Pixelody assets.
- Keep imported files, local metadata, playlists, tuning, backgrounds, and profiles local unless a future feature explicitly says otherwise.
- Keep local/offline listening first-class.
- Make every external integration optional and disconnectable.
- Show users what was imported, what was matched, what was missing, and what data remains stored locally.

## Library Concierge

Library Concierge should be the first-run and later-accessible migration assistant.

### Entry Points

- First-run empty library.
- Library rail action: `Build Library`.
- Settings action: `Migration & Discovery`.
- Empty playlist drop zone.
- Backup/restore flow.

### Suggested Flow

1. Choose source:
   - local folders
   - Downloads scan
   - external drive
   - Pixelody backup
   - playlist export file
   - provider account metadata import, if implemented

2. Scan and summarize:
   - tracks found
   - albums found
   - playlists found
   - duplicate paths skipped
   - duplicate content candidates
   - missing files
   - metadata quality issues
   - artwork coverage

3. Match imported playlist memory:
   - exact local file match
   - likely local match
   - ambiguous match
   - missing from local library

4. Review before applying:
   - create playlists
   - create missing-music lists
   - update metadata overrides
   - add watched folders when folder watching exists

5. Migration report:
   - percent matched
   - tracks needing attention
   - albums needing repair
   - next recommended action

## Provider Playlist And Taste Import

Provider migration should focus on metadata, not audio.

### Spotify-Style Metadata Import

Potential imported fields:

- playlist name
- playlist description
- playlist item order
- track title
- artist names
- album title
- duration
- ISRC, when available
- provider track ID
- provider album ID
- provider artist ID
- added-at timestamp
- saved/favorite state
- user's top artists/tracks, if terms and scopes allow

Potential local records:

```text
externalSourceId
externalProvider
externalTrackId
isrc
title
artist
album
durationMs
playlistSource
playlistPosition
matchStatus
localTrackId
confidence
lastCheckedAt
```

### Do Not Import

- Provider audio.
- DRM-protected files.
- Audio preview clips as a standalone listening feature.
- Cover art as a permanent local asset unless the license and provider terms allow it.
- Data for users who disconnect or revoke access beyond what is necessary and allowed.

### CSV And File-Based Imports

Support simple file imports before deeper OAuth integrations:

- CSV playlist exports.
- JSON exports.
- plain text track lists.
- m3u/m3u8 playlists that point to local files.
- Pixelody backup imports.

This gives users a low-risk path and avoids making provider API access a launch blocker.

## Matching And Repair

Pixelody should build a confidence-based matcher instead of requiring exact matches.

### Matching Signals

- file path
- file size
- duration
- title
- artist
- album
- album artist
- track number
- disc number
- ISRC
- MusicBrainz IDs
- embedded artwork hash
- audio fingerprint, later
- provider metadata, when imported

### Match States

- `matched`
- `likely_match`
- `ambiguous`
- `missing`
- `ignored`
- `needs_review`

### Repair Surfaces

- `Fix Album`
- `Fix Playlist Matches`
- `Review Duplicates`
- `Find Missing Files`
- `Apply Metadata`
- `Undo Last Repair`

Metadata repair should preview changes before applying local overrides or writing file tags. Pixelody should prefer local metadata overrides first, and only write back to files after an explicit future feature supports that safely.

## Metadata Sources

Potential sources:

- embedded tags read from the user's files
- MusicBrainz recording, release, artist, release-group, work, genre, ISRC, and relationship data
- Cover Art Archive only when terms and licensing are compatible with the use case
- ListenBrainz metadata, popularity, recommendations, playlists, and listening history where user-authenticated
- local user edits

MusicBrainz API clients must respect its meaningful User-Agent requirement and rate limits. Any commercial Pixelody use may need MetaBrainz commercial terms or another permitted access model.

ListenBrainz integrations should respect token auth, rate-limit headers, and user data controls.

## Missing Music

Missing music should be a first-class state, not a dead end.

When a playlist import references tracks that are not available locally, Pixelody should create a `Missing From Library` surface:

- missing by playlist
- missing by artist
- missing by album
- high-confidence duplicate title but wrong version
- unavailable because source file moved
- unavailable because no local file exists

Actions:

- search local folders again
- choose matching local file
- mark as wanted
- ignore
- open artist/release page
- open provider link, if stored and allowed
- add when imported later

## Local Discovery

Pixelody can compete strongly on rediscovery of a user's owned library.

Suggested shelves and smart collections:

- Recently Added
- Recently Played
- Forgotten Favorites
- Unplayed Albums
- Deep Cuts From Favorite Artists
- More Like Current Track
- Same Era
- Same Genre
- Same Label
- High-Resolution Finds
- Lossless Albums You Rarely Play
- Tracks Missing Artwork
- Albums Needing Cleanup

These should be generated from local metadata, play history, favorites, file quality, and optional open metadata relationships.

## External Discovery Without Hosting Music

Pixelody can expose music knowledge without pretending to provide full-track playback.

Suggested discovery surfaces:

- artist page from local library context
- albums missing from this artist
- new releases from artists in the user's library
- related artists
- works, covers, remixes, and alternate releases
- community/listening-data recommendations, when available
- wanted albums/tracks

Suggested actions:

- add to Wanted
- search local library
- open MusicBrainz
- open artist website
- open Bandcamp or store link when known
- open provider page if imported and allowed
- import local file after user obtains it

This preserves local-first ownership while reducing the "I cannot find new artists here" friction.

Current implementation note:

- Pixelody includes external search link-outs for MusicBrainz, Bandcamp, and Discogs from the local track editor.
- The editor now treats those links as a primary discovery lane: a prominent callout opens MusicBrainz for metadata, Bandcamp for purchase/search, and Discogs for release research.
- Tracks with incomplete local metadata show cleanup badges and a discovery action in the track list; missing imported songs in Wanted Music show Buy, Info, Discogs, and Import actions together.
- These are user-initiated browser links, not scraped catalog results, embedded audio, or Pixelody-hosted music.
- A future hosted Pixelody discovery site should start as metadata/link infrastructure only: artist/release/track pages, source links, availability notes, and wanted-list handoff. It must not host commercial audio unless licensing and rights are explicitly handled.
- Writing local edits back into source audio tags remains a separate format-specific feature. The current editor updates Pixelody's local metadata model live without mutating the original file.

## UX Requirements

- Empty library should not feel broken. It should offer build, restore, import, and scan actions immediately.
- Every migration job should be resumable and explainable.
- The user should see a clear migration score: matched, likely, missing, ignored.
- Never hide uncertainty. Ambiguous matches should be reviewable.
- Do not overwhelm first-run users with codec, API, or legal vocabulary.
- Advanced diagnostics can exist, but the normal language should be human:
  - "We found 1,248 tracks."
  - "84 playlist songs matched your files."
  - "12 songs are missing."
  - "3 albums need artwork."
  - "This track may be a live version."

## Implementation Layers

### Layer 1: Local Library Builder

- Guided first-run import.
- Multi-folder scan presets.
- Better scan progress and completion report.
- Missing-file repair entry point.
- Duplicate-content candidate report.

### Layer 2: File-Based Playlist Migration

- CSV parser with column mapping.
- m3u/m3u8 local playlist import.
- Playlist match report.
- `Missing From Library` virtual playlist.
- Wanted track records.

### Layer 3: Metadata Repair

- MusicBrainz lookup/search service wrapper.
- Rate-limited request queue.
- Local metadata candidate cache.
- Album repair preview.
- Track match confidence UI.

### Layer 4: Provider Metadata Import

- OAuth integration only after legal/product review.
- Provider disconnect and data deletion controls.
- Saved tracks and playlist metadata import.
- Imported provider IDs stored separately from local library records.
- Provider data retention policy in settings.

### Layer 5: Local Discovery

- Smart collection rule engine.
- Rediscovery shelves.
- "More Like This" from local metadata and history.
- Optional ListenBrainz scrobbling/import integration.

### Layer 6: External Discovery

- Artist/release knowledge pages.
- Missing albums by artist.
- Open metadata relationship browsing.
- Wanted music workflow.
- External link-out actions.

### Layer 7: Mobile And Trusted Device Continuity

Coordinate with the existing local-network and Android plans:

- browse local library from trusted devices
- stream owned local files from the user's host
- preserve playlists and wanted lists across trusted devices
- expose migration status and missing music on mobile clients later

## Data Model Notes

Potential new record groups:

```text
migrationJobs
externalSources
externalTracks
externalPlaylists
trackMatches
wantedTracks
metadataCandidates
repairSessions
smartCollections
```

Potential migration job fields:

```text
jobId
sourceType
sourceName
createdAt
completedAt
status
summary
errors
userDecisions
```

Potential wanted track fields:

```text
wantedId
title
artist
album
isrc
durationMs
sourceProvider
sourceUrl
reason
createdAt
resolvedTrackId
resolvedAt
```

## Safety And Legal Review Triggers

Require product/legal review before:

- OAuth provider launch.
- Any feature that uses provider artwork beyond transient, attributed display.
- Any feature that streams provider audio.
- Any feature that downloads, records, rips, or transforms provider audio.
- Any recommendation integration that stores user listening history remotely.
- Any monetized feature based on third-party provider data.
- Any catalog partnership, store integration, or affiliate link system.

## Practical First Build

The first implementation should be small and useful:

1. Add `Build Library` or `Migration` entry point.
2. Add scan summary and completion report.
3. Add CSV playlist import with column mapping.
4. Match CSV entries against local tracks by normalized artist/title/album/duration.
5. Create matched playlists.
6. Create `Missing From Library`.
7. Add wanted-track records for missing items.
8. Show migration report.

This gives users immediate relief without provider OAuth, scraping, or catalog licensing.
