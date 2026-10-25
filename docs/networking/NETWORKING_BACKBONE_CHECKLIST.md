# Host and client contract reference

Hosting is off by default, starts on `127.0.0.1`, and exposes a private-network route only after explicit action. The main process owns lifetime and validated IPC. A stable host identity is separate from rotating runtime owner credentials; stopping invalidates those credentials, pending pairing and active/stalled streams.

This page summarizes the recorded implementation and tests. It isn't a fresh device test of every release. See [networking progress](NETWORKING_DEVELOPMENT_ROADMAP.md) for the remaining recorded gaps.

## Library and live state

The renderer supplies a normalized snapshot; public track IDs are hashed and responses omit private paths. Library/track/artwork/stream access requires auth. Important routes include:

- `GET /api/v1/health`, `/api/v1/server-info`, `/api/v1/host/capabilities`.
- `GET /api/v1/library/snapshot` and paged/filtered `/api/v1/library/tracks`.
- `GET /api/v1/live` for polling, timing anchors, queue, favorites, permissions, commands, device refresh and `networkSession`.
- `GET /api/v1/tracks/:id/stream` for byte ranges and `/artwork` for known current-snapshot artwork.
- `POST /api/v1/commands/playback` and `/api/v1/commands/queue` for permitted commands mapped back to private renderer IDs.

Overall and typed library/playback/queue/favorites/permissions/refresh revisions remain stable on no-op exports. `sinceRevision` avoids full retransmission, and revision-consistent pages let Android browse large libraries. Polling backs off on failure and cancels across lifecycle/host changes. WebSocket push is still later work.

## Pairing and permission changes

Trusted devices store hashed tokens, scoped permissions, status, last seen and revocation. Owner-only `PATCH /api/v1/devices/:deviceId`, `DELETE /api/v1/devices/:deviceId` and device listing/IPC support management. `POST /api/v1/pair/start` and `/pair/complete` create bounded, expiring, throttled pairing. `POST /api/v1/devices/refresh` requests a soft resync.

QR/copy payloads include short code, secret, expiry, permissions and candidate URLs. Expired codes clear from the interface. A failed invite never falls back to the owner token. Device-store failures roll back changes, and last-seen writes are batched. Invalid, expired, revoked and missing credentials have distinct errors.

Owner-declared `personal-device` access differs from `jam-guest`; invitations default to guest. Guests can't receive stream/cache permission, don't get original stream URLs, and direct stream requests fail closed even if a malformed record retains permission. Optional account/device-key proof is still needed before claiming same-account enforcement or protected remote playback.

## Android and J.A.M.

Android uses exact-origin bearer headers for stream/artwork, with no reusable credentials in URLs. Saved hosts use Keystore AES-GCM with no plaintext fallback and clear on forget/revoked/expired/invalid auth. Media3 uses authenticated range sources, explicit media types, focus/noisy handling, media notification, queue transitions and credential-free process restore.

Windows controls the explicit single-host session and participant policy. Android can request to join, observe approval and exercise permitted suggestion/queue/playback actions. V1 preserves source fields but rejects federated sources. Shared fixtures cover capabilities, pairing, library/live data and session/queue semantics.

Network diagnostics include candidate addresses, reachability, adapter warnings and Windows Private-network firewall guidance. OS-level firewall repair isn't a normal-playback dependency. Remote identity, broker, encrypted relay, offline cache, phone hosting and federation still require separate contracts and tests.

## Recorded checks

Server tests cover empty/nonempty snapshots, 401s, path hiding, public IDs, middle/open/suffix/invalid ranges, missing artwork/media, stop cleanup, persisted/revoked tokens, permissions, stable revisions, filtering and command mapping. Session tests cover start/stop, approval, narrow/expanded permissions, guest escalation denial, source rejection, missing media and revocation.

The July 19 Samsung SM-S721U run covered pairing, browse, artwork, FLAC/WAV/MP3 streams and seeking, including 28,542,706-byte FLAC and 26,829,714-byte WAV files. Background/lock-screen behavior, restart/revocation, Wi-Fi/stale address recovery, focus and Bluetooth recovery were recorded. Wired-headphone disconnect wasn't available to test.

The July 21 Android 16 J.A.M. run recorded join/approval, restricted/expanded actions, source-aware queue, missing items, removal, Windows revocation, stop and empty restart. Its final Android revoked-state capture, credential/path UI/log check and temporary firewall-rule removal remained unverified. Keep those gaps with the result.

For a new change, run checks and repeat affected device/network cases. Verify fresh default-off startup and that hosting/drawer activity doesn't disturb playback, import, metadata, themes, tuning, queue or mini-player. Crash-safe desktop state now has [its own reference](../architecture/DURABLE_STATE_AND_RECOVERY.md); the old localStorage migration item isn't evidence of a current browser-backed store.
