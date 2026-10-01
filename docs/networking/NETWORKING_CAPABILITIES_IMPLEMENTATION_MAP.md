# Pixelody Networking Capabilities Implementation Map

This document explains what must be built to finish Pixelody's current networking mechanics and what later networking capabilities would entail technically.

Execution status, sequence prompts, and completion checkboxes live in `docs/networking/NETWORKING_DEVELOPMENT_ROADMAP.md`. This implementation map does not duplicate those checkboxes. It describes the functional architecture behind them.

Read this with:

- `docs/ARCHITECTURE.md`
- `docs/design/DESIGN_NORTH_STAR.md`
- `docs/networking/NETWORKING_DEVELOPMENT_ROADMAP.md`
- `docs/networking/NETWORKING_BACKBONE_CHECKLIST.md`
- `docs/networking/LOCAL_NETWORK_JAMS_AND_DEVICE_HOSTING.md`
- `docs/networking/ANDROID_PERSONAL_SERVER_PLAN.md`
- [ANDROID_APP_DEVELOPMENT_PLAN.md](https://github.com/varText-dragen-develiper/pixelody-android/blob/main/docs/ANDROID_APP_DEVELOPMENT_PLAN.md)

## Product Boundary

Pixelody networking should grow through six maturity levels:

1. **Safe personal host:** explicit, authenticated access to one user-owned library.
2. **Reliable LAN client:** a trusted phone can pair, browse, stream, seek, reconnect, and control only what the owner permits.
3. **Single-host J.A.M.:** invited devices participate in one session whose playable tracks all belong to one host.
4. **Platform parity:** Windows/Linux serious hosts and Android portable hosting use the same versioned contract.
5. **Optional remote reachability:** trusted devices connect away from home through direct encrypted routes or blind relay fallback.
6. **Federated J.A.M.:** permitted participants contribute from separate user-owned libraries with explicit source ownership and failure handling.

Local playback must remain fully functional at every level without an account, broker, relay, or network connection.

---

# Part I: Mechanics To Finish First

The current desktop and Android code proves the basic LAN path, but the following mechanics must be completed before Pixelody should expand into new networking features.

## 1. Host Identity And Lifecycle

### Required behavior

- A host has a stable identity across application restarts.
- A server runtime has separate short-lived secrets that can rotate without changing host identity.
- Hosting remains off until explicitly started.
- Stop Hosting prevents new requests immediately and terminates active/stalled connections within a bounded time.
- Pending pairing grants and temporary invites expire and are cleared when their hosting session ends.
- Trusted-device records survive restart until revoked.
- Capability payloads advertise only implemented behavior.

### Implementation shape

The current `src/server/index.js` can remain the public factory during the first pass, but responsibilities should become explicit:

```text
src/server/
  index.js                 composition and public server API
  identity.js              stable host identity and runtime secret rotation
  lifecycle.js             start, stop, sockets, active streams, timeouts
  capabilities.js          truthful versioned capability payload
```

The Electron main process should own host identity storage under application user data. The renderer may display public identity and status but should not create or persist server secrets.

### Tests needed

- Recreate the server with the same user-data directory and verify the same host identity.
- Verify temporary owner/invite secrets are invalid after their defined lifecycle ends.
- Stop with an active range stream and with a client that opened a socket but sent no complete request.
- Restart and verify trusted active/revoked device behavior.
- Assert that capabilities do not claim J.A.M. V1, WebSocket, relay, or federation before those features exist.

## 2. Trusted Devices, Permissions, And Credential Safety

### Required behavior

- Pairing creates a distinct revocable trusted-device credential.
- The owner can grant or remove browse, stream, playback-control, queue-write, cache, and future J.A.M. permissions.
- A client can discover its current permission set without seeing owner-only device information.
- Invalid, expired, and revoked credentials have separate stable error codes.
- No failure path falls back from a scoped device token to a more privileged owner token.
- Pairing state is bounded, pruned, and resistant to simple LAN abuse.
- `lastSeenAt` updates are throttled/batched rather than synchronously persisted per poll or range request.

### Implementation shape

```text
src/server/
  auth.js                  token parsing, constant-time verification, auth errors
  pairing.js               short-lived grants, expiry, attempt limits
  device-store.js          hashed credentials, permissions, revocation, last-seen batching
  permission-policy.js     route/action authorization matrix
```

Desktop integration needs owner-only IPC handlers and a permission editor in the J.A.M. drawer. Android should receive permissions from the host and enable controls from the contract, never from optimistic local assumptions.

### Contract additions

- `PATCH /api/v1/devices/:deviceId/permissions`
- Structured errors such as `auth_invalid`, `auth_expired`, `auth_revoked`, and `permission_required`.
- A self/device identity section in authenticated live state.

### Tests needed

- Full route-by-permission matrix.
- Permission removal takes effect on the next request and connected clients refresh visibly.
- Device tokens cannot list/revoke devices unless explicitly elevated to an owner/admin role.
- Pairing attempt and pending-grant limits.
- Polling for several seconds causes bounded device-store writes.

## 3. Accurate State, Revisions, And Efficient Sync

### Required behavior

- Library, playback, queue, favorites, permissions, device refresh, and J.A.M. state have defined revision semantics.
- Playback position is current or derived from a tested timing anchor.
- Clients can detect unchanged state and revision gaps.
- Android does not redownload a full large library on every recovery.
- Polling backs off during repeated failure and cancels when its screen/process lifecycle no longer needs it.
- Host shutdown, permission change, token revocation, missing media, and network loss map to explicit client states.

### Implementation shape

```text
src/server/
  state-store.js           normalized public state and revision counters
  live-state.js            polling snapshot and timing anchors
  library-query.js         paging, filtering, revision-aware responses

android/.../core/sync/
  HostSyncCoordinator.kt   bootstrap, poll, backoff, cancellation, recovery
  LiveStateReducer.kt      ordered revision application
```

Renderer playback should publish a small live-state update rather than repeatedly exporting the entire library. Library mutation can still publish a normalized snapshot until durable shared storage exists.

### Contract additions

- `revision`, `libraryRevision`, `playbackRevision`, and `permissionsRevision`, or one documented global revision with typed changes.
- Conditional parameters/headers such as `sinceRevision` or `If-None-Match`.
- Page cursors or stable offset rules tied to a library revision.
- Timing fields with defined clock basis: position, update time, playing state, and estimated start time.

### Tests needed

- Position progression, pause, seek, track change, and natural end.
- No revision churn when state is unchanged.
- Gap recovery from a fresh snapshot.
- Large paged library with mutation between pages.
- Android cancellation, exponential backoff, reconnect, and structured error mapping.

## 4. Authenticated Android Playback

### Required behavior

- Media3 and artwork requests authenticate without exposing a long-lived token in URLs.
- Credentials are stored privately and cleared on forget/revocation.
- Large files support real seeking through range requests.
- Playback continues appropriately in the background with notification and lock-screen controls.
- Audio focus, becoming-noisy, Bluetooth/headphone route changes, process recreation, and network loss are handled.
- Diagnostics identify auth, host, stream, codec, range, and reconnect failures without logging secrets or private host paths.

### Implementation shape

```text
android/.../data/network/
  HostAuthProvider.kt      current credential/session grant
  PixelodyDataSource.kt    Media3 HTTP headers and response diagnostics
  ArtworkRequestFactory.kt authenticated artwork requests

android/.../core/playback/
  PixelodyPlaybackService.kt
  PlaybackQueueMapper.kt
  PlaybackDiagnostics.kt
```

Two credential strategies are acceptable:

1. Send the scoped trusted-device credential through an authorization header on private LAN connections.
2. Preferably, exchange it for a short-lived stream grant so the long-lived credential never enters media request plumbing.

The second strategy is a prerequisite for remote access.

### Tests needed

- Unit tests for authenticated data-source construction and secret-safe diagnostics.
- Real FLAC, WAV, and compressed-format seek tests.
- Physical-device background, notification, lock-screen, audio-focus, unplug, and Bluetooth tests.
- Host shutdown, revocation, missing file, Wi-Fi disconnect, and reconnect.

## 5. Single-Host J.A.M. V1 Mechanics

### Required behavior

- A J.A.M. session is distinct from merely starting the personal server.
- The session has an owner/coordinator, status, participants, roles, permissions, queue, and diagnostics.
- All playable V1 tracks resolve to the coordinator's one host-owned library.
- Queue records preserve future source ownership fields.
- Guests cannot escalate into library administration.
- Stop Session cleans participant leases and session-only state without deleting trusted-device relationships.

### Implementation shape

```text
src/server/
  jam-session-store.js     active session truth and lifecycle
  jam-permissions.js       owner/controller/guest policy
  jam-queue.js             source-aware queue records and validation
  jam-routes.js            versioned session API
  jam-diagnostics.js       participant/source/queue failures

android/.../feature/jam/
  session and participant surfaces

android/.../data/repository/
  JamRepository.kt
```

### Core contracts

- Start/stop/inspect the active session.
- Join/approve/remove participants.
- Read/update the shared queue according to permission.
- Report participant leases and diagnostics.
- Queue items include `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, `availability`, `cacheState`, `playbackStatus`, and `fallbackCandidates`.

### Tests needed

- Session start/stop and cleanup.
- Guest/controller/owner permission matrix.
- Queue add/move/remove with public-to-private host track validation.
- Missing track, revoked participant, sleeping client, and host shutdown.
- Proof that V1 rejects non-host source devices and audio uploads.

## 6. Push Transport And Resilience

### Required behavior

- Authenticated WebSocket events become the normal live path.
- Polling remains bootstrap and fallback, using the same state/reducer contract.
- Heartbeat, backoff, event ordering, deduplication, and revision-gap recovery are explicit.
- Shutdown and revocation reach connected clients promptly.
- Connection/stream counts and buffers are bounded.

### Implementation shape

```text
src/server/
  websocket.js             upgrade/auth/heartbeat/connection registry
  event-log.js             bounded typed events and revisions

android/.../core/sync/
  HostSocketSession.kt     authenticated socket and reconnect
  LiveStateReducer.kt      shared polling/push reducer
```

### Event families

- `library.updated`
- `playback.state`
- `queue.updated`
- `favorite.updated`
- `permissions.updated`
- `device.refresh`
- `jam.updated`
- `participant.updated`
- `source.availability`
- `auth.revoked`
- `server.shutdown`

### Tests needed

- Duplicate and out-of-order events.
- Dropped connection and revision-gap snapshot recovery.
- Background/foreground Android reconnect.
- Revocation and shutdown delivery.
- Connection caps, slow clients, stale heartbeats, and cleanup.

---

# Part II: Future Networking Capability Roadmap

Future work should begin only after the six mechanics sequences pass their completion gates.

## Future 1: Durable Shared Core State

### Capability

Make network state crash-safe and usable by the renderer, host, backups, Linux, and Android sync without treating browser `localStorage` as the system of record.

### What implementation entails

- Versioned database schema for tracks, playlists, queue, favorites, host identity, trusted devices, permissions, J.A.M. sessions, and revisions.
- Migration from existing localStorage with backup and rollback.
- Repository/service API used by Electron renderer and network host.
- Transactional queue/session changes and corruption recovery.
- Explicit separation between private file records and public API DTOs.

### Gate before moving on

Existing libraries and settings survive migration/restart, network state is crash-safe, and backup compatibility is verified.

## Future 2: Zero-Configuration LAN Discovery

### Capability

Let trusted clients find an active host on the same private network without typing an IP address.

### What implementation entails

- Desktop/Linux mDNS advertisement with service type, API version, host public identity, port, and capability hints—but no token or private library data.
- Android Network Service Discovery browser with lifecycle-safe start/stop.
- Manual URL and QR pairing remain available when multicast is blocked.
- Discovery results are untrusted until the known host identity is verified or pairing completes.
- Diagnostics for multicast blocked, guest Wi-Fi isolation, multiple interfaces, stale advertisements, and duplicate host names.

### Gate before moving on

Discovery works on normal Wi-Fi, fails safely on hostile/stale advertisements, and never grants trust by discovery alone.

## Future 3: Android Offline And Resilient Cache

### Capability

Allow users to explicitly retain selected owned tracks/playlists for offline Android playback.

### What implementation entails

- Room metadata/cache records and Media3 download integration.
- Host permission check for `cache`.
- Storage limits, Wi-Fi/mobile-data policies, progress, retry, removal, and clear-cache controls.
- Encryption/app-private storage decisions and token/session expiry handling.
- Separation between personal offline downloads and future temporary J.A.M. contribution cache.

### Gate before moving on

Downloads are explicit, removable, storage-bounded, permission-aware, and remain private to the Android app.

## Future 4: Android Portable Hosting

### Capability

Let an Android device temporarily act as a Library Host on Wi-Fi or hotspot.

### What implementation entails

- Foreground hosting service with persistent notification and one-tap Stop Hosting.
- Stable Android host identity and the same pairing, permission, revocation, range, paging, live-state, and diagnostics contracts as desktop.
- MediaStore/Storage Access Framework indexing and durable URI permissions.
- Bounded server threads/connections, request timeouts, range correctness, and efficient seeks.
- Battery saver, thermal, cellular, hotspot, sleep, and interface-change policies.
- Host subset capability flags that honestly exclude unsupported admin/edit operations.

### Gate before moving on

Phone-to-tablet/PC hosting works on Wi-Fi and hotspot with foreground-service, sleep, battery, network-change, revocation, and stop tests.

## Future 5: Linux And Headless Host Parity

### Capability

Run the same personal-library host reliably on Linux desktop, mini PC, or NAS-like hardware.

### What implementation entails

- Reusable Node/core host package separated from Electron renderer assumptions.
- Linux file indexing/watching adapters and durable database compatibility.
- App-managed lifecycle first, optional systemd/background service later.
- Firewall, removable-drive, file-permission, sleep, and service diagnostics.
- Admin surface through desktop UI or a narrowly scoped local management client.

### Gate before moving on

Android pairs, browses, streams, seeks, revokes, and reconnects against both Windows and Linux using the same fixtures and API version.

## Future 6: Private-Network Remote Access

### Capability

Support user-owned VPN/private-tunnel addresses without building Pixelody infrastructure.

### What implementation entails

- Recognize and prioritize trusted private-VPN interfaces.
- Enforce the same identity, short-lived session credential, revocation, and diagnostics rules as LAN.
- Route selection between local LAN and private VPN.
- Clear UI that remote reachability is user-configured and optional.
- Tests across address changes, host sleep, tunnel loss, and reconnect.

### Gate before moving on

Away-from-home access works over a user-owned private network without public inbound ports or reusable stream URLs.

## Future 7: Device Identity And Remote Session Credentials

### Capability

Prepare for Internet-distance connection without treating a copied bearer token as a durable device identity.

### What implementation entails

- Device public/private key pairs in OS-protected storage.
- Host approval binds a device public key to permissions and revocation state.
- Challenge-response authentication.
- Short-lived signed session and stream credentials derived from long-lived trust.
- Key rotation, device loss, clock skew, replay protection, and recovery UX.
- Protocol and threat-model documentation before broker deployment.

### Gate before moving on

Trusted devices authenticate cryptographically, sessions expire, replay attempts fail, and revocation works without exposing reusable library credentials.

## Future 8: Broker And Direct Remote Connection

### Capability

Let a host and trusted client find each other away from home while both initiate outbound connections.

### What implementation entails

- Minimal rendezvous broker storing device presence and opaque reachability/session setup data—not songs or library exports.
- Host/client outbound control channels.
- IPv6/direct candidates and carefully selected NAT traversal mechanisms.
- End-to-end authenticated key agreement before application traffic.
- Rate limits, abuse handling, privacy retention, self-hosted broker compatibility, and operational diagnostics.

### Gate before moving on

Two trusted devices establish an authenticated direct session through broker-assisted rendezvous while the broker cannot inspect library/audio payloads.

## Future 9: Encrypted Relay Fallback

### Capability

Carry encrypted metadata/control/audio traffic when direct connectivity fails.

### What implementation entails

- Blind byte relay with authenticated allocations, quotas, idle expiry, and bandwidth limits.
- End-to-end encryption whose content keys are unavailable to the relay.
- Stream resumption, backpressure, congestion, mobile-data quality, and cost controls.
- Self-hosted relay option and explicit managed-relay opt-in.
- Diagnostics that distinguish broker, direct route, relay, host, source, and credential failures.

### Gate before moving on

Relay fallback is interoperable, bounded, encrypted end to end, optional, and does not become permanent song storage.

## Future 10: Federated J.A.M. Type 2

### Capability

Allow permitted participants to add tracks from separate user-owned libraries while preserving source ownership.

### What implementation entails

- Each participant can advertise a limited source-host capability.
- Coordinator resolves every queue item to a source device/library and maintains source leases.
- Playback device receives a short-lived grant for the selected source.
- Source availability, sleep, disconnect, revocation, file missing, retry, fallback candidate, and skip/pause policies.
- Matching/fingerprint support may identify another permitted copy without merging libraries.
- Conservative product/legal framing and explicit owner/guest contribution permission.

### Gate before moving on

Two trusted source hosts can hand off successive queue tracks with visible ownership and reliable failure recovery. No contribution cache is implied yet.

## Future 11: Temporary Encrypted Contribution Cache

### Capability

Improve federated J.A.M. reliability when a contributing phone sleeps or disconnects briefly.

### What implementation entails

- Explicit contributor/session permission and cache policy.
- Random content-addressed encrypted blobs outside the permanent library.
- Per-item/session content keys wrapped only to active approved devices.
- Chunked upload, resume, readiness state, expiry, lease checks, quota, and key-first deletion.
- No filename export, library scanning, playlists, backup inclusion, metadata repair, or offline-download conversion.
- Manual Clear J.A.M. Cache and auditable lifecycle events without private paths.
- Legal and security review acknowledging that playable audio can still be recorded.

### Gate before moving on

Cached contributions are session-scoped, encrypted, automatically destroyed, impossible to import accidentally, and covered by disconnect/revocation/expiry tests.

## Future 12: Synchronized Multi-Device Playback

### Capability

Allow multiple playback devices to render the same J.A.M. timeline with controlled synchronization.

### What implementation entails

- Coordinator timebase and clock-offset estimation per playback device.
- Buffered start-at commands, drift measurement, bounded correction, and resync policy.
- Per-device latency/output-route diagnostics.
- Clear distinction between synchronized device playback and the separate native multi-output speaker-system engine.
- Honest limits for Bluetooth, mobile power saving, browser/audio engine timing, and mixed network quality.

### Gate before moving on

Two supported playback devices start and remain within a documented sync tolerance, recover from drift, and expose when synchronization cannot be maintained.

## Future 13: Protocol Governance And Interoperability

### Capability

Make Pixelody networking auditable and safely evolvable across Windows, Linux, Android, self-hosted brokers, and future clients.

### What implementation entails

- Published versioned schemas and compatibility policy.
- Capability negotiation and deprecation windows.
- Golden fixtures shared across Node and Kotlin tests.
- Threat model, privacy model, security response process, and release checklist.
- Interoperability test harness for host/client/broker/relay combinations.
- Diagnostics export with redaction guarantees.

### Gate

Independent compatible implementations can pass the contract suite without relying on private Pixelody infrastructure or undocumented behavior.

---

# Recommended Technical Extraction Order

Avoid a large speculative server rewrite. Extract modules only as each mechanic requires them:

```text
Sequence 1 -> identity + lifecycle + capabilities
Sequence 2 -> auth + pairing + device store + permission policy
Sequence 3 -> state store + live state + library query
Sequence 4 -> Android auth/data source/playback diagnostics
Sequence 5 -> J.A.M. session + permissions + queue + diagnostics
Sequence 6 -> event log + WebSocket + shared client reducer
Future 1   -> durable database repositories beneath those interfaces
```

The key architectural rule is one source of truth per kind of state. HTTP polling, WebSocket push, desktop UI, Android UI, and future relays should be transports or consumers—not separate owners of library, permission, queue, or J.A.M. truth.

# Definition Of Networking Capability Complete

A networking capability is complete only when:

- It is opt-in and visibly active.
- Its identity and permission model is explicit.
- Its API/event contract is versioned and fixture-tested.
- It behaves on failure, revocation, sleep, disconnect, and restart.
- It has useful secret-safe diagnostics.
- Desktop and Android agree on the same contract.
- Relevant automated checks pass.
- Required physical-device/network tests pass; code inspection is not a substitute.
- Product language describes only what is actually implemented.
- Roadmap and handoff documents are updated after verification, not before.
