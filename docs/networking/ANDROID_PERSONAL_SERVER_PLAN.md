# Hosting a personal library across devices

I want someone to use the library from whichever of their devices suits them. A Windows PC can keep the files and play at the desk; a phone can browse or listen elsewhere. Longer term, a Linux host or a temporarily hosting phone could use the same contract. Local playback shouldn't require networking or a Pixelody account.

This is a plan with later recorded additions, not a platform support list. Windows hosting and the Android client are implemented; Linux host parity, production Android hosting, remote infrastructure and federated sources still need work. The Android [development notes](https://github.com/varText-dragen-develiper/Pixelody-android/blob/main/docs/ANDROID_APP_DEVELOPMENT_PLAN.md) cover that client.

## Roles and permissions

A Library Host owns indexed files and streams. A J.A.M. Coordinator owns session/queue truth. A Playback Device produces sound, and a Controller sends permitted commands. One device can do all four jobs, but queue records shouldn't assume it owns every future source. J.A.M. means Joined Audio Mesh.

Hosting is opt-in. Start on localhost, explicitly enable a private-network route, pair by QR/short code or manual address, approve permissions and show active devices with revoke/stop controls. Every library, artwork, playback and stream route needs auth. Keep private paths out of responses. The present guest policy is narrower than a trusted personal device: original streams and cache access are blocked for J.A.M. guests.

## Platform work

Windows owns server lifetime through main-process IPC, with status and pairing in the renderer. The modular `src/server/` core serves normalized state, never DOM scraping. Earlier browser-storage proposals are superseded by [the durable store](../architecture/DURABLE_STATE_AND_RECOVERY.md); a shared database may still be useful for further extraction.

Linux could reuse that core with file watching, permissions, firewall and lifecycle adapters. Start app-managed before offering a background service. That is a planned host, not a tested release target.

Android uses Kotlin/Compose and Media3. Keep API/network models, repositories, sync/reconnect policy, playback service and screen state separate. Room/offline caching remains work to finish; don't describe a proposed stack as if every library is installed. Phone hosting would need MediaStore/SAF access, bounded HTTP handling, stable identity, foreground notification, one-tap stop, capability limits and tests through battery saver, sleep, Wi-Fi changes and hotspots.

## Shared data

Use versioned `/api/v1` contracts and [shared fixtures](../api-contract-fixtures/). The original plan proposed routes beyond the implemented API; use [the backbone reference](NETWORKING_BACKBONE_CHECKLIST.md) and source for exact current paths. These DTO examples keep the intended information visible:

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

The July 21 Windows `jamCoordinator` capability covered a single-host lifecycle, approval, scoped policy and source-aware queue. It didn't establish federation, relay access, production phone hosting or synchronized device audio.

Authenticated range streams need correct length/MIME, seekable large files and useful missing-file errors. Android's media service owns focus, noisy-route behavior, notification/lock-screen controls and restoration. Artwork/small metadata can be cached; offline music needs explicit selection, storage/removal controls and permission.

## Later connections and contributions

Remote access should first work over an owner-configured private network. A future broker could coordinate outbound connections and direct encrypted routes, with an optional blind relay when needed. Keep keys/permissions/revocation and short-lived sessions established before exposing public-distance access. No central catalog, permanent song storage or reusable public stream URLs belongs in that infrastructure.

Federated J.A.M. would let permitted devices supply tracks, retaining `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, availability and cache state. A session-only encrypted cache could survive a brief contributor disconnect, but needs consent, quotas, expiry, key-first removal and no library/playlist/backup/export path. It doesn't make copying impossible. These proposals need legal/security review before enabling broader cross-user streaming.

## Verifying an implementation

Run desktop checks and exercise import, metadata, playlists, favorites, queue, mini-player, tuning, backups and default-off hosting after server changes. Test Android auth/range seeking, background/lock-screen playback, revocation, missing media, network recovery and actual device routes. A future Linux host and phone server need the same fixture suite plus their platform lifecycle tests. Don't infer bit-perfect output or desktop-equivalent tuning from a working stream.
