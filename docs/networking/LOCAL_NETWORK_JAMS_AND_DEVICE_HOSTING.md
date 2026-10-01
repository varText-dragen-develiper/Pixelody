# Local Network J.A.M. And Device Hosting Notes

These notes capture future Pixelody direction discussed on June 30, 2026. They are planning notes and should not be treated as implemented behavior.

## Product Intent

Pixelody may eventually become more than a Windows-only local music player. The long-term idea is a local-first personal music ecosystem where a user's own devices can access music they personally store, without depending on a commercial central catalog or permanent cloud library.

Use **J.A.M.** as the product abbreviation for shared listening: **Joined Audio Mesh**. Avoid using the unexpanded plain word "Jam" as the feature name in public UI, docs, API contracts, or future marketing copy.

The preferred framing is:

- Personal library access across trusted devices.
- Local-first ownership and storage.
- Optional private network sharing from a user's own host device.
- User-chosen networking: local playback, LAN sharing, self-hosted remote access, and optional relay infrastructure are choices, not requirements for listening to music.
- Blind infrastructure: any broker or relay should route encrypted session traffic without selecting music, storing a catalog, or needing to inspect audio content.
- Open-source transparency: clients, server components, and network protocols should be publicly auditable and self-hostable where practical.
- Federated local J.A.M. sessions where invited participants can eventually contribute from their own device libraries.
- Collaborative listening and queue control for invited devices.
- Strong separation between admin controls and guest participation.

Avoid framing Pixelody as a general tool for distributing music files to other people.

Do frame Pixelody as transparent user-owned music software. The user chooses whether to use networking at all. Offline/local listening should remain first-class. LAN and remote features should be opt-in additions for trusted-device access and private sessions, not the only way the product works.

The long-term J.A.M. target is Type 2/federated J.A.M.: every participant can bring music from their own local library, and each device can become a temporary source host for the tracks it contributes. Earlier single-host J.A.M. sessions are useful milestones, but they are not the final conceptual destination.

## Core Roles

Future networking features should separate these roles:

- Library Host: the device that owns music files and can stream them.
- J.A.M. Coordinator: the device that owns the shared session, queue, permissions, and timing.
- Playback Device: the device currently outputting audio.
- Controller: a device that browses, queues, pauses, skips, or edits settings according to permissions.

One device can hold every role, but the architecture should not assume that it always does.

Examples:

```text
PC = Library Host + J.A.M. Coordinator + Playback Device
Phone = Controller
Friends' phones = Guest queue contributors
```

```text
Linux box or NAS = Library Host
Android phone = Playback Device + Controller
PC = Admin Controller
```

```text
Android phone = temporary Library Host + Playback Device
Other nearby devices = Controllers or guests
```

## Host Feasibility By Platform

Desktop PC and Linux devices are the best serious hosts. They have stable storage, easier background processes, easier file indexing, and better always-on behavior.

Android can host in a limited but real way, especially while the app is foregrounded, playing media through a foreground service, or kept awake by the user. It is viable for portable hosting, but battery, OS background limits, network changes, and storage permissions should be treated as product constraints.

Chromebooks are plausible middle-ground hosts, depending on whether the application is implemented as Android, Linux, or web/PWA technology on that device.

iOS should be treated mainly as a possible client/controller/playback surface, not a reliable host. iOS background execution, file access, App Store policy, and local-network permission prompts make always-available personal serving much less dependable.

## Recommended Network Models

Start with LAN-first sharing:

```text
Same Wi-Fi / local network
Device discovery through mDNS/Bonjour-like advertisement
Pairing through QR code or short code
Local API over HTTP(S)
Realtime sync over WebSocket
Audio streaming through range requests or chunked streams
```

Remote access should come later and should be explicit. Prefer user-owned private-network approaches before public exposure:

- Best privacy: VPN/private tunnel such as WireGuard-style or Tailscale-style networking.
- Risky for normal users: manual port forwarding.
- Most convenient but less local-first: a small Pixelody relay only for discovery/connection brokering, not storing songs.

### Remote Access Direction

Pixelody should eventually support personal library access and trusted J.A.M. sessions even when a device is far from the host network. The product requirement is real remote reachability, but the security model should avoid turning every desktop app into a casually public server.

The preferred architecture is a layered remote-access mode:

```text
Trusted phone/client
  <-> Pixelody broker for identity, pairing, reachability, and session setup
  <-> Direct encrypted device connection when possible
  <-> Encrypted relay fallback when direct connectivity fails
  <-> User-owned Library Host
```

The broker/relay must be treated as connection infrastructure, not as a commercial music catalog or cloud library. It should not permanently store user songs, full library exports, private file paths, or admin credentials.

Security expectations:

- Remote access is off until the user enables it.
- The host opens outbound connections to the broker/relay; users should not need router port forwarding for the normal path.
- Pairing creates a trusted device record with a device public key, user-facing device name, permission scope, creation time, last-seen time, and revoke action.
- Long-lived trusted-device credentials should not be sent on every stream request. Use short-lived session tokens or signed requests for active sessions.
- Owner/admin, trusted device, J.A.M. Guest, and read-only guest permissions stay separate.
- Relayed traffic should be encrypted so the relay does not need to understand music files beyond routing/bandwidth metadata.
- Remote diagnostics should plainly name host asleep/offline, token expired, permission revoked, relay unavailable, direct path blocked, and source device disconnected.

This keeps Pixelody's local-first center intact: local playback and LAN/private-network use still work without cloud accounts, while remote access becomes an optional hardened layer for people who need it.

Remote infrastructure should be described as blind connection assistance, not a Pixelody music service. The preferred claim is that Pixelody provides optional encrypted routing, rendezvous, and diagnostics while users retain control over their own libraries, devices, permissions, and hosting choices.

### Hybrid Auto-Connection UX

The hybrid network model should be invisible during normal use. A broad-audience user should not need to understand NAT traversal, relays, IPv6, port forwarding, STUN, TURN, tunnels, or router configuration.

The default J.A.M. flow should be:

```text
Open Pixelody on PC
Start J.A.M.
Send invite link / QR / short code
Friends join
Owner can leave home and keep listening from phone
Trusted devices can add music according to permissions
Pixelody chooses the safest reachable route automatically
```

Normal UI should expose human controls:

- Start J.A.M.
- Invite.
- Who can join.
- Who can add music.
- Audio quality: Auto, Data Saver, High.
- Remote access: Auto.
- Stop J.A.M.

The connection engine can still try several routes under the hood:

```text
1. Same-device/local loopback.
2. Same LAN direct route.
3. IPv6 direct route.
4. Hole-punched direct route.
5. User-owned relay.
6. Pixelody-managed relay fallback, if enabled.
7. Advanced privacy route such as onion service mode, if explicitly enabled.
```

Advanced controls should live behind a deliberate `Network > Advanced` surface:

- Auto, Local Only, Direct Remote Only, Use My Relay, Use Pixelody Relay Fallback.
- LAN only, remote allowed, public IPv6 allowed, manual port, UPnP/PCP/NAT-PMP.
- Max listeners, upload cap, mobile-data quality cap, idle timeout, and diagnostics export.

The product promise should be: Pixelody connects trusted devices automatically and chooses the safest available path. The advanced promise should be: power users can fully control how connections are made.

## Authentication And Permissions

Do not model this like a cloud account first. Model it as a local library identity and trusted device pairing.

Potential flow:

```text
PC: Enable Library Sharing
PC: Shows QR code or pairing code
Phone: Scans code
Phone: Enters library password/passphrase
PC: User approves the device
Device receives a revocable token
```

Suggested permission levels:

- Owner/Admin: import, delete, edit metadata, manage devices, export backups, change sharing settings.
- Trusted Device: browse, stream, cache, control own playback, optionally control shared playback.
- J.A.M. Guest: add to queue, vote/suggest, see limited now-playing/session state.
- Read-only Guest: browse allowed collections and view now-playing state only.

Admin-level actions must never be exposed to J.A.M. Guests by default.

## Non-Destructive Device Refresh

J.A.M. devices need a host-mediated soft-refresh path for recovery and future maintenance hooks. This is not a remote wipe, forced app update, or license bypass. It is a small instruction that asks connected trusted devices to re-fetch live state, library/device metadata, permissions, and route assumptions without clearing saved pairing, local files, queues, or user data.

The current contract is:

```text
Device or owner -> POST /api/v1/devices/refresh
Host records a refresh id and sends a device-refresh command to the desktop renderer
Polling devices see deviceRefresh in GET /api/v1/live
Each device handles a refresh id once, then re-syncs safely
```

Future open-source builds can attach versioned maintenance actions to this hook, but every action must stay explicit, authenticated, non-destructive by default, and visible in diagnostics.

## J.A.M. Models

### Milestone: single-host J.A.M.

A safer early implementation is a shared queue for music available on one host library.

```text
Guest suggests or queues a track
Host checks whether the track exists in the host library
Host playback device plays from host-owned files
```

This is technically simpler, more reliable, and easier to explain legally. Treat it as a milestone that proves discovery, pairing, permissions, queue sync, and playback control before multi-source streaming exists.

Current V1 implementation boundary:

- One library host owns every playable remote track.
- The Windows owner can explicitly start/inspect/update/stop one ephemeral single-host session, approve or remove participants, and control the guest policy from the desktop J.A.M. drawer.
- Trusted devices can pair, request to join, receive a visible role and session-scoped view/suggest/add/queue-edit/playback-control permissions, browse, stream, poll live state, and send permission-gated commands.
- Device refresh is a non-destructive soft re-sync instruction exposed through `/api/v1/devices/refresh` and `/api/v1/live`.
- Real server queue records and fixtures include `queueItemId`, `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, availability, host-owned cache state, playback status, fallback candidates, and diagnostics so V1 does not erase future source ownership.
- Participant revocation, missing host media, stop cleanup, guest escalation denial, and federated-source rejection are covered by the server audit. Android unit/build contracts pass; the real-device join/approval gate remains pending.
- V1 does not yet support guest-owned audio uploads, encrypted contribution cache, relay networking, or multi-source playback handoff.

### Target: Federated J.A.M. Type 2

The intended long-term model lets participants contribute tracks from their own devices.

```text
Guest adds a track from their local library
Guest device becomes source host for that track
J.A.M. Coordinator stores queue state
Playback Device streams from whichever source owns the queued track
```

Example queue:

```text
Track 1: sourced from Alex's PC
Track 2: sourced from Jamie's Android phone
Track 3: sourced from Morgan's Chromebook
Track 4: sourced from Alex's PC again
```

In this model, the J.A.M. Coordinator is responsible for session truth, but it does not have to own every audio file. Queue items need to remember who added the track, which device owns the source file, whether the source is reachable, and what should happen if that source disappears.

This model is fragile by nature. If the source device leaves the network, sleeps, loses battery, loses permission, or revokes access, the queued track becomes unavailable. That fragility is acceptable only if Pixelody makes the state visible and recoverable instead of pretending the network is stable.

Federated J.A.M. sessions are the desired structure, but they should be implemented in careful layers with diagnostics from the beginning.

### Contributed Track Processing And Temporary Cache

Federated J.A.M. sessions should not require every listener to stream directly from the contributor's phone for the full duration of a track. Mobile devices sleep, leave coverage, switch networks, run out of battery, or lose permission. To make the experience reliable, the J.A.M. Coordinator or primary Library Host should be able to request a temporary encrypted contribution cache when a participant adds a local-only track.

Suggested flow:

```text
Phone adds a local track to the J.A.M. queue.
J.A.M. Coordinator creates a queue item with sourceDeviceId and addedByDeviceId.
Coordinator checks contributor permission, track size, format, and J.A.M. cache policy.
Phone uploads an encrypted temporary copy or compressed proxy to the coordinator/host.
Coordinator marks the item as cached-for-session once enough data is available.
Playback devices stream from the coordinator/host cache instead of relying on the phone.
If the contributor disconnects or permission expires, the cache is sealed or deleted according to policy.
```

This should be presented to users as reliability, not file sharing. Possible UI language:

```text
Preparing Jamie's track for the J.A.M. session
Ready for this J.A.M.
Contributor disconnected; cached copy expires when the J.A.M. session ends
Contributor left; track removed from upcoming queue
```

The first implementation can use full-track upload only for small files and local/private J.A.M. sessions. Later versions can support chunked upload, background preparation, compressed proxy generation, and resume after reconnect.

### Anti-Piracy And Ephemeral Cache Rules

Temporary J.A.M. caching must not become a library-copying feature. Cached contributed tracks should be session-scoped, encrypted at rest, permission-bound, and automatically removed.

Minimum rules:

- Cache only after the contributor explicitly adds the track to a J.A.M. session or approves the upload.
- Store contributed audio in a J.A.M. cache namespace, not the host's permanent library.
- Encrypt each cached item with a session-specific content key.
- Wrap the content key to the active J.A.M. session and approved playback devices, not to a general user account.
- Keep no normal file extension or user-visible exported audio file.
- Do not expose cached contribution paths through diagnostics, APIs, backups, or import tools.
- Delete cached contributed audio when the J.A.M. session ends, the owner stops hosting, the contributor revokes the item, permission expires, or retention policy is reached.
- If the contributor disconnects, either keep playback only until the current J.A.M./session expiry or remove the item, depending on the J.A.M. session's configured policy.
- Never add temporary contributed tracks to playlists, library scans, metadata repair, backup export, or permanent offline downloads unless a future legal/product review explicitly creates a separate licensed/owned import flow.

Possible cache policies:

```text
Strict: contributor must remain connected; cache is only a short buffer.
J.A.M. session: encrypted cache can survive brief contributor disconnects until the J.A.M. session ends.
Host Approved: owner can allow a temporary cache for the session with explicit size/time limits.
No Cache: stream directly from source device; unavailable if source drops.
```

Recommended default for broad users: `J.A.M. session` with short retention, clear status, and no export surface.

Recommended default for guests: guests can contribute only if the J.A.M. owner allows it, and their tracks are session-only by default.

### Cache Security Model Notes

The cache security goal is to reduce casual copying and accidental redistribution. It cannot create perfect DRM against a malicious device that can already hear the audio. Pixelody should avoid pretending otherwise.

Design guardrails:

- Use content-addressed blobs with random IDs, not artist/title filenames.
- Store metadata separately from encrypted audio blobs.
- Tie decryption keys to J.A.M. session state, device grants, and expiry.
- Keep keys in OS-protected storage where available.
- Require an active J.A.M. lease heartbeat before starting new streams from contributed cache.
- Allow already-buffered playback to finish only if the selected cache policy permits it.
- Wipe keys first, then schedule encrypted blob cleanup; key deletion should make orphaned blobs useless.
- Log cache lifecycle events without logging private file paths.
- Add a manual `Clear J.A.M. cache` action for owners and contributors.

Important limitation: if a listener can play a song, they can potentially record the output. The product should focus on permissioned access, temporary encrypted storage, short retention, and honest legal/product boundaries rather than claiming unbreakable copy protection.

## Federated J.A.M. Data Model Notes

Local tracks should eventually stop being treated as only file paths. Federated J.A.M. sessions need track and queue records that can describe source ownership and availability.

Potential track fields:

```text
trackId
title
artist
album
duration
artwork
sourceDeviceId
sourceLibraryId
sourceUri
availability
permissions
fingerprint/hash
```

Potential queue item fields:

```text
queueItemId
trackId
addedByDeviceId
sourceDeviceId
playbackStatus
fallbackCandidates
```

Fallback candidates could later allow the J.A.M. session to use another participant's matching copy of the same song, but this should not be required for the first federated implementation.

## Federated J.A.M. diagnostics

Debuggability is a core requirement for Type 2. The product should expose enough state that a user or developer can understand why a J.A.M. session failed without guessing.

Future J.A.M. diagnostics should show:

- Connected devices and their roles.
- Which devices are hosting tracks.
- Current source device for the playing track.
- Stream bitrate, latency, buffer health, and retry count.
- Last successful handshake per device.
- Permission failures.
- Unavailable queue items.
- Device sleep, disconnect, and reconnect events.
- Source revoked or file missing states.

The intended debugging posture is: if a friend's phone goes to sleep, Pixelody should be able to say that plainly and skip, pause, retry, or request another source according to J.A.M. settings.

## Legal And Product Caution

This project should be designed conservatively. Owning local files does not automatically mean the app should facilitate broad redistribution to other people. Copyright issues may involve copying, distribution, public performance, and jurisdiction-specific rules.

Open-source code and self-hostable infrastructure are important trust signals. They make the networking model auditable, show that official infrastructure is optional, and support the claim that Pixelody is not hiding a central music catalog. They are not substitutes for conservative architecture, careful product language, abuse handling, and legal review.

Safer product language:

- Access your personal library from your own trusted devices.
- Control playback and queues across your household or private network.
- Invite nearby devices to participate in a shared queue.
- Optional blind relay infrastructure helps trusted devices connect when direct routes are unavailable.
- Pixelody does not require remote networking for local listening.

Riskier product language to avoid:

- Share your full music library with friends anywhere.
- Stream your songs to anyone.
- Build a peer-to-peer replacement for commercial streaming catalogs.
- Upload your music to Pixelody.
- Pixelody hosts music for your friends.

Future implementation should get legal review before enabling cross-user file streaming beyond narrow private/trusted-device scenarios.

## Architectural Implications

Pixelody should eventually move from an Electron-only shape toward:

```text
Core Library Services
- durable track database
- metadata/artwork cache
- playlists and queue state
- playback state
- audio settings and tuning profiles

Platform Adapters
- Electron/Windows file dialogs and windowing
- Android storage, MediaStore, foreground playback, cache
- Linux desktop/background service
- possible iOS client/controller constraints

Local Server
- device pairing
- auth tokens and revocation
- library API
- stream API
- WebSocket session sync
- J.A.M. queue and permissions
```

The current Electron `window.desktop` bridge should eventually become a narrower platform interface rather than the only way the app thinks about file access and playback.

Potential platform interface:

```js
window.pixelodyPlatform = {
  chooseFiles,
  chooseFolder,
  scanLibrary,
  inspectTrack,
  cacheArtwork,
  fileUrl,
  exportBackup,
  importBackup,
  openSecondaryPlayerSurface
};
```

## Practical Roadmap For This Idea

1. Create a crash-safe local database for library, metadata, playlists, artwork, favorites, history, and settings.
2. Extract library operations out of the renderer into core services with platform adapters.
3. Add an internal localhost API used by the Electron UI.
4. Add opt-in LAN sharing with pairing, password/passphrase, device tokens, and revocation.
5. Build a tiny mobile/web proof of concept that browses the PC library and streams one track.
6. Add queue handoff between PC and phone.
7. Add LAN J.A.M. V1 with a host-owned library and guest queue permissions as a stepping stone.
8. Add device identity, device capability reporting, and J.A.M. diagnostics.
9. Add federated queue entries that remember source device and added-by device.
10. Add source availability checks and failure handling.
11. Add first federated stream handoff between two trusted devices.
12. Consider Android native client with Media3/ExoPlayer, temporary cache, local file playback, remote library playback, and limited portable hosting.
13. Harden Type 2 federated J.A.M. only after reliability, security, and legal risk are understood.
14. Add remote-access broker/relay only after trusted-device identity, revocation, short-lived credentials, and diagnostics are stable locally.

## Non-Negotiables

- Preserve local-first ownership.
- Make sharing opt-in and visibly active.
- Never expose import/delete/edit controls to guests by accident.
- Do not require a central Pixelody music server for normal local use.
- Treat Type 2/federated J.A.M. as the long-term structure, not as an afterthought.
- Build diagnostics with the networking feature rather than after it.
- Design for unreliable networks: device sleep, PC sleep, Wi-Fi changes, missing files, and revoked permissions.
- Keep PC/Linux as serious hosts, Android as both client and limited portable host, and iOS as client/controller unless constraints change.
