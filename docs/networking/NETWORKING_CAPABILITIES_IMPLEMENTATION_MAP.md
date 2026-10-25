# Extending the network features

The host and Android client already share pairing, permissions, paged library state, polling and stream contracts. This map describes the design needed for extensions. Check [the backbone reference](NETWORKING_BACKBONE_CHECKLIST.md) for implemented routes and [recorded progress](NETWORKING_DEVELOPMENT_ROADMAP.md) for tests; older proposed filenames and endpoint spellings aren't the current API.

## Preserve the existing owners

The main process owns stable host identity and runtime secrets. A restart can rotate temporary grants without erasing paired-device trust; stopping must terminate streams and partial/stalled clients. Auth must keep scoped tokens separate from owner credentials, bound pairing attempts and batch last-seen writes. Permission removal needs immediate enforcement and a visible client update.

Library, queue, playback, favorites, permissions, refresh and J.A.M. revisions need one owner each. Polling, push, desktop, Android and future relays consume that state. Don't create competing queue or permission truth in a transport. Use conditional refresh, current playback anchors and revision-bound pages; recover gaps from a fresh snapshot.

Android media/artwork requests need exact-origin authentication, private credential storage and secret-safe errors. A later short-lived stream grant is preferable before remote use. Media3 owns background playback, notifications, focus and route changes. Unit contracts don't replace physical seek/background/reconnect tests.

V1 J.A.M. keeps explicit lifecycle, owner approval, source-aware queues and guest limits. Stopping a session cleans its leases without erasing trusted devices. Non-host audio/uploads stay blocked until a different source model is deliberately implemented.

## Push and discovery

An authenticated WebSocket path could replace routine polling while retaining the same reducer, revisions and fallback. Define heartbeat, ordering, deduplication, gap recovery, connection/buffer caps and prompt shutdown/revocation. Event families include library, playback, queue, favorites, permissions, refresh, session/participant/source changes, auth revocation and shutdown.

mDNS/Android NSD could find a nearby host, but advertisements never establish trust. Advertise public identity/version/capabilities, not tokens or libraries. Keep QR/manual entry when multicast fails and diagnose isolation, stale hosts and multiple interfaces.

## Offline music and hosting

An explicit Android offline cache needs Room/Media3 download records, host cache permission, progress/retry/removal, quotas and Wi-Fi/mobile-data policy. Keep private storage and expiry rules clear. Personal offline downloads and temporary contributed session audio are different stores.

Portable Android hosting needs a foreground service, persistent notification, one-tap stop, SAF/MediaStore indexing, durable URI grants and the same auth/range/paging fixtures. Bound connections and test sleep, heat, battery saver, hotspot and interface changes. Capability flags must exclude unsupported edits/admin work.

Linux/headless parity needs the reusable host core, file watching/indexing, durable data and optional service lifecycle without renderer assumptions. Test Android interoperability, removable drives, file permissions, firewall, sleep and restart. Extract services when needed, rather than rewriting the server speculatively. Desktop state already uses [a file-backed store](../architecture/DURABLE_STATE_AND_RECOVERY.md); transactional shared repositories remain a possible later extension.

## Optional remote access

Owner-configured private tunnels are the first reachability case. Public-distance access needs device keys in protected storage, host approval, challenge-response, rotation/recovery, replay protection and short-lived session/stream credentials. Test clock skew, lost devices and revocation before deploying infrastructure.

A broker could exchange presence/reachability through outbound connections and help establish authenticated direct paths. A relay fallback must carry end-to-end encrypted bytes with quotas, expiry, backpressure, mobile-data/cost limits and self-hosted compatibility. Neither stores songs/library exports or receives content keys. Local listening and LAN access must work without those services.

## Contributions and synchronized playback

Federated J.A.M. needs source-host capability, coordinator leases, per-item grants, visible source ownership and handling for sleep, revoked access, missing files and fallback. Demonstrate successive tracks from two trusted sources before adding a cache.

An encrypted contribution cache needs consent, random IDs, per-item/session keys, bounded resumable preparation, lease/expiry checks, key-first cleanup and a clear action to remove it. Exclude it from library scans, playlists, repairs, backups and offline conversion. Legal/security review still matters; playable audio can be recorded.

Synchronized device playback is another feature: coordinator time, measured clock offsets, buffered start, drift correction and per-device latency. Publish the tolerance actually tested and expose inability to hold it. Don't confuse it with the separate Windows multi-output mixer.

## Adding a capability

Publish versioned schemas, capability negotiation, deprecation rules and Node/Kotlin fixtures. Include threat/privacy review and compatibility tests for relevant host/client/broker/relay combinations. Verify sleep, revocation, failure and restart on real devices, plus redacted diagnostics. Completion means the behavior works across the claimed contract and hardware, not that its planned modules exist.
