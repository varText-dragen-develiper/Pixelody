# Device Hosting And Personal Server Plan

For the focused Android client implementation plan, see [ANDROID_APP_DEVELOPMENT_PLAN.md](https://github.com/varText-dragen-develiper/pixelody-android/blob/main/docs/ANDROID_APP_DEVELOPMENT_PLAN.md).

Use **J.A.M.** for shared listening features: **Joined Audio Mesh**. Avoid the unexpanded plain word "Jam" as the feature name in user-facing text and new API contracts.

## Goal

Bring Pixelody to Android, Linux, and Windows as a local-first personal music ecosystem where any capable user-owned device can host, browse, control, or play a private library according to that platform's strengths. The same Pixelody network model should feel consistent everywhere: one obvious Sharing surface, one pairing pattern, one device-permission model, and one live status language.

Windows and Linux should be treated as serious always-available hosts. Android should be both a strong client/playback surface and a limited portable host. Hosting is always opt-in. Pixelody should not quietly expose files, metadata, artwork, or listening state to the network.

Networking must remain user-chosen. Local playback should never require a Pixelody account, relay, public server, or remote-access setup. Any managed broker/relay should be blind infrastructure for encrypted routing and reachability only, not a Pixelody music catalog or required listening service. Open-source clients, server components, and protocols should make this claim auditable and should allow advanced users to self-host compatible infrastructure.

## Product Shape

Each app should feel like Pixelody, not like a generic streaming client or server utility. The first version should prioritize:

- Browsing playlists, albums, artists, favorites, recently played, and search.
- Playing local-network streams from a paired host library.
- Showing honest source metadata: format, codec, bit depth, sample rate, bitrate, ReplayGain, and channel count.
- Displaying cached artwork and playlist backgrounds from the host server.
- Queue, shuffle, repeat, favorite, seek, volume, and basic playlist membership controls.
- Respecting per-track EQ and system/output correction metadata, while initially applying only the playback controls that can be implemented reliably on the current device.
- Clear connected/disconnected/offline states.
- Clear hosting states: Off, Local only, Available on LAN, Paired devices active, and Guest session active.
- J.A.M. states that show who coordinates the session, which device owns the current source file, and what is unavailable.

Avoid implementing theme editing, desktop-grade audio calibration, broad guest file sharing, or library repair on Android in the first pass.

## Device Roles

The implementation should keep these roles separate even when one device holds all of them:

- Library Host: owns indexed music files, metadata, artwork, playlists, and stream URLs.
- J.A.M. Coordinator: owns shared queue/session timing and participant permissions.
- Playback Device: outputs audio and reports playback state.
- Controller: browses, searches, queues, pauses, skips, favorites, or edits according to permissions.

Federated J.A.M. sessions depend on this separation. The J.A.M. Coordinator owns session truth, but individual queue items may be sourced from different Library Hosts.

Examples:

```text
Windows PC = Library Host + J.A.M. Coordinator + Playback Device
Android phone = Controller + optional Playback Device
```

```text
Linux mini PC or NAS-like box = Library Host
Android phone = Playback Device + Controller
Windows desktop = Admin Controller
```

```text
Android phone = Temporary Library Host + Playback Device
Nearby paired tablet = Controller
```

## Consistent User Experience

Every platform should expose the same conceptual flow:

1. Open Sharing.
2. Choose this device's role: Host Library, Join Library, Remote Control, or J.A.M. Guest.
3. If hosting, choose visibility: Off, This device only, Local network.
4. Pair with QR code, short code, or manual address.
5. Review permissions before approving a device.
6. See active devices and revoke access from the same screen.

The controls should be native to each app:

- Windows: settings drawer section with firewall/status messaging, QR code, paired-device table, and server log details in diagnostics.
- Linux: same app-level Sharing surface, plus optional tray/background service controls where packaging supports them.
- Android: compact Sharing screen with foreground-service status, battery/network warnings, QR scanner, and an obvious Stop Hosting action.

Use the same labels everywhere: Host, Join, Pair, Trusted Device, Guest, Local Network, Revoke, Stop Hosting.

## J.A.M. Direction

Single-host J.A.M. sessions are an implementation milestone, not the final concept. They prove discovery, pairing, permissions, shared queue behavior, playback control, and guest restrictions while all playable tracks still come from one host library.

The long-term target is Type 2/federated J.A.M.:

- Every trusted participant can eventually contribute tracks from their own local library.
- Each contributing device can become a temporary source host for the tracks it adds.
- The J.A.M. Coordinator stores queue/session truth without needing to own every audio file.
- Queue items remember `addedByDeviceId`, `sourceDeviceId`, source availability, and recovery behavior.
- Diagnostics explain failures plainly: source asleep, source disconnected, permission revoked, file missing, buffer unhealthy, or stream retrying.

Build the early data model with this future in mind even when the first shippable J.A.M. only uses one host. Do not flatten tracks into anonymous stream URLs that lose source ownership.

### Default J.A.M. Experience

Normal users should experience J.A.M. networking as automatic:

```text
Start J.A.M.
Invite friends
Listen on PC or phone
Add music from any permitted device
Pixelody chooses the connection route
```

The UI should avoid exposing relay, NAT, IPv6, tunnel, hole-punching, or port-forwarding language in the primary flow. Those details belong in diagnostics and advanced network settings. The product should default to `Remote access: Auto`, where Pixelody tries local direct routes first, then safe remote direct routes, then a user-owned or managed encrypted relay if enabled.

### Federated Contribution Cache

When a phone, tablet, or friend's device contributes a track that is not already on the primary host, the J.A.M. session should not depend on that source device remaining continuously reachable for the entire playback window. The coordinator or primary host should be able to create a temporary encrypted J.A.M. cache for that item.

Implementation expectations:

- Queue items include `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, `sourceAvailability`, and `cacheState`.
- The source device uploads only after permission and J.A.M. policy checks.
- Cached contributions are stored outside the permanent library and cannot be scanned into playlists or backups.
- Cached audio is encrypted at rest with a session/item key and random blob identifiers.
- Cache keys expire with the J.A.M. session, contributor revocation, owner stop-hosting action, or configured retention limit.
- The host can stream from this temporary cache if the contributor briefly disconnects and the J.A.M. policy allows it.
- Diagnostics explain whether a queue item is `source-live`, `preparing-cache`, `cached-for-session`, `source-disconnected`, `permission-revoked`, `cache-expired`, or `unavailable`.

This cache is a reliability feature, not a redistribution feature. Pixelody should never claim perfect copy protection, because any playback device can theoretically record audio output. The goal is opt-in contribution, encrypted temporary storage, short retention, no export path, and clear permission boundaries.

## Platform Hosting Model

### Windows

Windows remains the first implementation target because the current app already owns imports, metadata inspection, playback, mini-player sync, settings, and backups.

- Best for: primary personal library host, playback device, admin controller, J.A.M. Coordinator.
- Server lifecycle: launched by Electron when enabled; off by default after fresh install.
- Storage: current `localStorage` bridge at first, then crash-safe database as soon as practical.
- UX concerns: Windows firewall prompts, sleep/lock behavior, network profile changes, and clear LAN exposure indicators.
- Implementation: `src/server/*` plus IPC controls in `src/main.js`, `src/preload.js`, and `src/renderer.js`.

### Linux

Linux should share the same core server and library services where possible, with a platform adapter for file watching, service lifecycle, and packaging.

- Best for: always-on library host, headless or semi-headless home server, admin-controlled playback endpoint.
- Server lifecycle: app-managed in desktop builds; optional background service later.
- Storage: same durable database and artwork cache format as Windows.
- UX concerns: firewall differences by distro, systemd/autostart optionality, file permission visibility, removable drives, and network interface selection.
- Implementation: reuse the Node/server core if the Linux desktop app remains Electron; later support a standalone server package if the app splits into core services plus clients.

### Android

Android hosting should be real but intentionally constrained.

- Best for: client, controller, playback device, portable temporary host.
- Server lifecycle: only while foregrounded, during active playback, or through an explicit foreground service with persistent notification.
- Storage: MediaStore/Storage Access Framework imports, app-private metadata cache, explicit offline cache.
- UX concerns: battery, sleep, background limits, local-network permission prompts, changing Wi-Fi/cellular state, scoped storage, and hotspot behavior.
- Implementation: native Kotlin server adapter only after the shared API contract is stable. Android should first consume the Windows/Linux host API, then host a subset of that API for portable libraries.

Android hosting should support browse, artwork, stream, queue, and simple playback state before it supports admin-heavy actions like full metadata editing or library repair.

## Repository Structure

Add Android code under a top-level `android/` directory so the current Electron app stays stable:

```text
android/
  settings.gradle.kts
  build.gradle.kts
  gradle/
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      java/com/pixelody/app/
        PixelodyApp.kt
        MainActivity.kt
        core/
          config/
          network/
          playback/
          storage/
          sync/
          theme/
        data/
          api/
          db/
          model/
          repository/
        feature/
          connection/
          library/
          collection/
          nowplaying/
          queue/
          settings/
        ui/
          components/
          navigation/
          theme/
      res/
        drawable/
        mipmap/
        values/
```

Recommended Android stack:

- Kotlin.
- Jetpack Compose for UI.
- Media3 ExoPlayer for playback.
- Room for offline cache and connection profiles.
- Retrofit or Ktor client for HTTP APIs.
- OkHttp WebSocket or Ktor WebSockets for live playback/server state.
- Coil for artwork loading.
- DataStore for small preferences.
- Hilt only if dependency wiring becomes noisy; otherwise keep constructors explicit at first.

## Shared Server Structure

Add server code beside the Electron main process first, but keep it modular enough to become the Windows/Linux shared host core:

```text
src/server/
  index.js
  config.js
  auth.js
  pairing.js
  library-store.js
  media-routes.js
  artwork-routes.js
  playback-routes.js
  websocket.js
  validators.js
```

Windows/Electron integration points:

- `src/main.js` owns starting/stopping the server and exposing settings through IPC.
- `src/preload.js` exposes only safe server controls to the renderer.
- `src/renderer.js` shows server status, pairing, connected devices, and stop/revoke controls.

Longer term, move the current `localStorage` library state into a crash-safe store so the renderer, server, backups, Linux host, and Android sync are not all depending on browser storage. Until then, the server should read a normalized snapshot exported by the renderer or a shared persistence module, not scrape DOM state.

## Network Model

Use a local-network personal server first:

- Bind to localhost by default.
- Require an explicit setting to expose on LAN.
- Show host, port, QR pairing code, and active devices.
- Use token-based pairing. The QR code should include server URL, server public identity, and a short-lived pairing secret.
- Store device tokens on the host and allow revocation.
- Require auth for every library, artwork, playback, and stream route.
- Prefer HTTPS when practical, but do not block early LAN development on certificate polish. Make insecure LAN mode visibly marked in settings.

No cloud relay, account system, or public internet exposure in the first implementation.

Longer-term remote access may add managed or self-hosted broker/relay infrastructure, but the implementation should preserve these rules:

- Local/offline listening remains fully functional without networking.
- LAN sharing remains available without a Pixelody cloud account.
- Remote access is opt-in and visibly active.
- Managed relay infrastructure is blind, encrypted, transient, and replaceable by a self-hosted relay where practical.
- Pixelody-owned infrastructure does not store permanent songs, public catalogs, reusable stream URLs, or user library exports.
- Users choose whether to use local-only, direct remote, self-hosted relay, or managed relay fallback modes.
- Diagnostics may report route health and abuse signals, but should avoid exposing private file paths or decrypted library contents.

## API Contract

Version all endpoints under `/api/v1`.

Core endpoints:

- `GET /api/v1/health`
- `GET /api/v1/server-info`
- `GET /api/v1/host/capabilities`
- `GET /api/v1/devices`
- `PATCH /api/v1/devices/:deviceId`
- `DELETE /api/v1/devices/:deviceId`
- `POST /api/v1/pair/start`
- `POST /api/v1/pair/complete`
- `GET /api/v1/library/snapshot`
- `GET /api/v1/tracks`
- `GET /api/v1/tracks/:id`
- `GET /api/v1/tracks/:id/stream`
- `GET /api/v1/tracks/:id/artwork`
- `GET /api/v1/playlists`
- `GET /api/v1/collections/albums`
- `GET /api/v1/collections/artists`
- `GET /api/v1/favorites`
- `PUT /api/v1/favorites/:trackId`
- `DELETE /api/v1/favorites/:trackId`
- `GET /api/v1/queue`
- `PUT /api/v1/queue`
- `POST /api/v1/playback/command`
- `GET /api/v1/playback/state`
- `GET /api/v1/settings/audio-profiles`
- `GET /api/v1/jams/:sessionId`
- `GET /api/v1/jams/:sessionId/devices`
- `GET /api/v1/jams/:sessionId/queue`
- `PUT /api/v1/jams/:sessionId/queue`
- `GET /api/v1/jams/:sessionId/diagnostics`

WebSocket:

- `/api/v1/live`
- Events: `library.updated`, `playback.state`, `queue.updated`, `track.updated`, `favorite.updated`, `jam.updated`, `source.availability`, `server.shutdown`, `auth.revoked`.

Minimum track DTO:

```json
{
  "id": "string",
  "title": "string",
  "artist": "string",
  "album": "string",
  "year": 2026,
  "trackNumber": 1,
  "duration": 180.2,
  "format": "flac",
  "codec": "FLAC",
  "lossless": true,
  "sampleRate": 96000,
  "bitDepth": 24,
  "bitrate": 2800000,
  "channels": 2,
  "replayGainDb": -4.2,
  "artworkUrl": "/api/v1/tracks/.../artwork",
  "streamUrl": "/api/v1/tracks/.../stream",
  "dateAdded": 1782864000000,
  "favorite": false,
  "missing": false
}
```

Do not send desktop file paths to Android unless a diagnostics setting explicitly requests them.

Minimum host capability DTO:

```json
{
  "hostId": "string",
  "hostName": "Pixelody on Studio PC",
  "platform": "windows",
  "roles": ["libraryHost", "jamCoordinator", "playbackDevice", "controller"],
  "visibility": "lan",
  "canBackgroundHost": true,
  "canImport": true,
  "canEditMetadata": true,
  "canStream": true,
  "canRemoteControl": true,
  "limits": {
    "requiresForegroundService": false,
    "batterySensitive": false
  }
}
```

As of 2026-07-21, the Windows host advertises `jamCoordinator` because explicit single-host session lifecycle, participant approval, scoped guest policy, source-aware queue records, diagnostics and cleanup are implemented. This role does not imply federated sources, relay access, Android production hosting or synchronized multi-device playback.

Current single-host, future-ready queue item DTO:

```json
{
  "queueItemId": "string",
  "trackId": "string",
  "title": "string",
  "artist": "string",
  "addedByDeviceId": "string",
  "sourceDeviceId": "string",
  "sourceLibraryId": "string",
  "availability": "available",
  "cacheState": "none",
  "cacheExpiresAt": 1782864000000,
  "playbackStatus": "queued",
  "fallbackCandidates": []
}
```

## Android Architecture

Use a simple layered shape:

- `data/api`: generated or hand-written DTOs and HTTP/WebSocket clients.
- `data/db`: cached tracks, playlists, artwork metadata, queue state, connection profiles.
- `data/repository`: combines network, cache, and sync conflict rules.
- `core/playback`: Media3 service, notification, audio focus, headset controls, route changes.
- `core/sync`: WebSocket session, reconnect, snapshot refresh, event reducer.
- `feature/*`: screen-level ViewModels and UI.
- `ui/theme`: Pixelody mobile design tokens, typography, icon wrappers, motion settings.

Keep the Android app read-mostly at first. Writes should be limited to favorites, queue, playback commands, and later playlist edits.

When Android becomes a host, mirror the same boundaries:

- `core/hosting`: local HTTP server lifecycle, foreground service, notification actions, network binding.
- `data/localmedia`: MediaStore/Storage Access Framework indexing and metadata extraction.
- `data/hostapi`: API routes backed by Android-local repositories.
- `feature/sharing`: host visibility, pairing, active devices, revoke, stop hosting.

## Playback Decisions

Phase 1 should stream from a Windows or Linux host using HTTP range requests and Media3. Every serious host must support:

- `Range` headers.
- Correct content length and MIME type.
- Stable auth on stream requests.
- Seekable streams for large FLAC/WAV files.
- Clear errors for missing files.

Android should:

- Use a foreground `MediaSessionService`.
- Expose lock-screen controls.
- Handle audio focus and becoming noisy events.
- Cache only artwork and small metadata by default.
- Offer explicit offline track caching later.

Advanced EQ and calibration should be staged after stable playback. Android audio pipelines vary too much to promise desktop-equivalent tuning immediately.

## Implementation Plan

### Phase 0: Contracts, Roles, And Storage Prep

- Define shared JSON schemas for tracks, playlists, queue, playback state, and server events.
- Define host capability, device permission, and role DTOs.
- Define J.A.M. queue DTOs with `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, availability, and diagnostics fields, even before federated streaming ships.
- Add a Windows library snapshot function that converts current state into API-safe DTOs.
- Add tests for snapshot shape, missing-track handling, hidden file paths, and artwork URL generation.
- Decide whether server state reads from a temporary renderer export or a new shared persistence module.

### Phase 1: Windows Personal Server MVP

- Add opt-in Sharing settings in desktop diagnostics/settings.
- Implement authenticated `/health`, `/server-info`, pairing, library snapshot, artwork, and stream routes.
- Implement range streaming for music files.
- Add a live WebSocket channel for playback and library events.
- Add connected-device listing and token revocation.
- Verify desktop playback, mini-player sync, imports, playlists, metadata, and audio tuning remain untouched.

### Phase 2: Android Client Skeleton

- Create the Gradle project and Compose shell.
- Build connection and pairing screens.
- Store server profiles and tokens in encrypted or private app storage.
- Implement API clients, DTO mapping, and Room cache.
- Build library, playlist, album, artist, search, and track detail screens against mocked API fixtures first.

### Phase 3: Android Playback Client MVP

- Implement Media3 service and notification.
- Stream tracks with auth and seeking.
- Build now-playing, queue, shuffle, repeat, favorite, and seek controls.
- Connect WebSocket updates to Android UI state.
- Handle disconnects, token revocation, server shutdown, and missing media.

### Phase 4: Linux Host Parity

- Reuse the shared server contract and storage format.
- Add Linux file/import adapters if the Linux app remains Electron.
- Add service lifecycle decisions: app-only first, optional background service later.
- Verify LAN discovery, pairing, range streaming, artwork, and WebSocket events against the Android client.

### Phase 5: Cross-Device State

- Sync favorites, play counts, recently played, queue edits, and current playback state.
- Add conflict rules: the Library Host wins for metadata and library structure; latest authenticated command wins for queue and playback state.
- Add host settings for per-device permissions: browse only, remote control, stream, cache, write favorites/playlists, admin.

### Phase 6: Android Portable Hosting

- Add Android foreground hosting service.
- Support Android-local library snapshot, artwork, stream, and playback state routes.
- Restrict hosting while battery saver, cellular-only, or background restrictions make serving unreliable.
- Show persistent notification and one-tap Stop Hosting.
- Test phone-as-host to tablet/PC client on the same Wi-Fi and hotspot.

### Phase 7: Offline, J.A.M., And Polish

- Add explicit offline cache for selected tracks/playlists with storage limits.
- Add background sync for changed metadata and artwork.
- Add Pixelody mobile visual themes derived from desktop tokens.
- Add Android diagnostics: server latency, stream format, cache usage, auth status, and playback errors.
- Add J.A.M. V1 only after host/client streaming is stable: shared queue from one host-owned library, guest permissions, and visible J.A.M. diagnostics.
- Add Type 2/federated J.A.M. layers after V1: source-device queue records, source availability checks, unavailable-item recovery, and first trusted-device stream handoff.
- Keep public/product language conservative around cross-user streaming until legal review, even though the architecture intentionally leaves room for federated local J.A.M.

## Verification

Desktop checks after server changes:

- `npm run check`
- `npm run check:themes`
- Manual playback of FLAC/WAV/MP3.
- Import, metadata hydration, playlist edit, favorite, queue, mini-player, backup export/import.
- Server off by default after restart.

Linux host checks:

- Pair from Android on same LAN.
- Stream FLAC/WAV/MP3 with seeking.
- Restart app/service without losing library database or paired-device permissions.
- Verify firewall and network-interface messaging is understandable.

Android checks:

- Unit tests for API mapping and repository reducers.
- Room migration tests.
- Media3 playback tests where feasible.
- Instrumented tests for pairing, browse, search, play, pause, seek, next, favorite, disconnect, reconnect.
- Real-device LAN test with screen locked and app backgrounded.
- Android host test with foreground service notification, device sleep, Wi-Fi change, hotspot, and Stop Hosting.

## Early Risks

- Current desktop state lives mostly in `localStorage`; server work should not deepen that coupling.
- Large libraries need paginated APIs before Android list rendering is considered done.
- Artwork can be large or path-bound; cache generated previews and avoid leaking source paths.
- LAN auth must be real from the first public route.
- Android playback should not claim bit-perfect or desktop-equivalent output processing.
- Windows firewall prompts and network binding must be clear to users.
- Linux packaging and service behavior can fragment by distro; keep the core host simple first.
- Android hosting is vulnerable to battery policy, sleep, and storage permission complexity; market it as portable/temporary hosting, not always-on hosting.
- Federated J.A.M. sessions are intentionally fragile because each source device can leave, sleep, revoke access, or lose network. This is acceptable only if diagnostics and recovery controls ship with the feature.

## First Concrete Milestone

Build a Windows host prototype that can:

1. Start only when enabled.
2. Pair one test client token.
3. Return a sanitized library snapshot.
4. Serve artwork previews.
5. Stream a selected track with range support.
6. Broadcast current playback state over WebSocket.
7. Report host capabilities and active devices.

After that works, Android client development can proceed against the real contract instead of guessing. Linux host parity and Android portable hosting should follow the same contract rather than introducing separate device-specific APIs.
