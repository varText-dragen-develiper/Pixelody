# Personal hosting and J.A.M.

The June 30, 2026 direction was to make a library available across trusted devices without requiring a central music service. Later V1 additions are recorded here too. A host connection and a J.A.M. session are related, but starting one shouldn't silently expose every file or grant administration.

## What V1 does

Windows owns one ephemeral single-host J.A.M. session. The owner starts/stops it, approves/removes participants and sets guest policy. Trusted devices can pair, poll state and send only their permitted queue/playback actions. V1 tracks resolve to the coordinator's library; other source devices and guest audio uploads are rejected.

Queue records keep `queueItemId`, `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, availability, cache state, playback status and fallback/diagnostic information. Those fields leave room for later federation without making it available now. Current J.A.M. guests cannot receive original-file stream or cache access; a personal trusted device is a different permission class.

The non-destructive refresh route is `POST /api/v1/devices/refresh`. The host records a refresh ID, dispatches a desktop refresh command and exposes `deviceRefresh` through `GET /api/v1/live`. A client handles an ID once and resyncs state/permissions without wiping pairing, files, queues or user data. Future maintenance actions on that hook still need explicit versioned contracts.

## Keeping sources and controls separate

A Library Host owns files; the J.A.M. Coordinator owns shared session/queue truth; a Playback Device outputs audio; a Controller browses or sends allowed commands. A PC can do all four. A phone might only control or play, and a future Linux box might host while another device controls it.

Pairing should create revocable scoped access. Owner/admin operations such as import, deletion, metadata edits, backup export and device management mustn't leak into guest controls. Hosting stays off until enabled, with LAN exposure and active devices visible. The implemented API and fixture reference is [the backbone page](NETWORKING_BACKBONE_CHECKLIST.md).

## Away from the host network

The plan prefers LAN/private-network access first. A later remote mode would use device identities, approval, revocation, short-lived session/stream credentials and authenticated encryption. Both ends could connect outbound through a rendezvous broker, try a direct connection and use a blind encrypted relay if enabled. A broker isn't a music catalog or permanent library store.

The ordinary interface should offer start, invite, permissions, quality and stop, with route choices farther in. Manual port forwarding isn't the default. Advanced owners could select local-only, direct remote, their relay or managed fallback, with bandwidth/idle limits and diagnostics. Those are proposed controls, not instructions for the current build.

## Federated sessions and temporary cache

The longer-term goal lets participants contribute permitted music from their own libraries. Each item needs its source and a recoverable state when that device sleeps, disconnects, revokes access or loses the file. The coordinator keeps session truth without needing to own every source.

A proposed encrypted contribution cache could prepare an item on the host so playback doesn't depend on a phone staying awake. Upload only after contribution/permission checks. Use random blob IDs, separate metadata and per-item/session keys wrapped to approved devices. Keep it outside permanent libraries, scans, playlists, repairs, backups and offline downloads. Enforce leases, quotas and expiry; delete keys before blob cleanup and provide a manual clear action.

Possible policies were no cache, a short connected-only buffer, session retention through a brief disconnect, or owner-approved retention with limits. Stop, revoke and expiry must remove access. No playback system can promise unrecordable audio; encryption and short retention don't establish permission to redistribute it. Broader cross-user streaming needs legal and security review.

## Platform and failure handling

Windows is the current host. Linux is a plausible later always-on host using the same core. Phone hosting needs explicit foreground lifetime, battery/network/storage limits and stop controls; it isn't production hosting yet. Chromebook feasibility depends on its app environment, and iOS was considered mainly as a possible client/controller.

Keep stream bitrate, latency/buffer health, retries, last handshake, source availability and permission failures visible without private paths. A sleeping host, missing file, revoked token and failed relay need different recovery. Sharing queue controls doesn't establish synchronized sound: multi-device timing needs its own coordinator clock, buffered start and drift tests, separate from local multi-output speakers.

For recorded device results and unresolved checks, use [networking progress](NETWORKING_DEVELOPMENT_ROADMAP.md). [The capability map](NETWORKING_CAPABILITIES_IMPLEMENTATION_MAP.md) describes proposed extensions.
