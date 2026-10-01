# Pixelody Networking Backbone Checklist

This checklist governs local hosting, trusted-device connection, streaming, remote control, and future J.A.M. work. It should be read with `LOCAL_NETWORK_JAMS_AND_DEVICE_HOSTING.md`, `ANDROID_PERSONAL_SERVER_PLAN.md`, and [ANDROID_APP_DEVELOPMENT_PLAN.md](https://github.com/varText-dragen-develiper/pixelody-android/blob/main/docs/ANDROID_APP_DEVELOPMENT_PLAN.md).

## Mission Objectives

- Preserve local-first ownership: normal playback must never require a cloud account or public server.
- Make hosting explicit: sharing is off until the user starts it, and LAN exposure remains gated until pairing and revocation are complete.
- Make remote access possible without casual public exposure: phones and trusted devices should eventually reach a user's library from outside the home, but only through an explicit remote-access mode with hardened identity, revocation, encryption, diagnostics, and abuse controls.
- Stream with the least practical loss: serve original local files through authenticated seekable HTTP range streams instead of transcoding by default.
- Keep device roles separate: Library Host, J.A.M. Coordinator, Playback Device, and Controller must be represented distinctly even when one device holds multiple roles.
- Build diagnostics with the feature: every route, device state, stream failure, token failure, and unavailable source should be explainable.
- Avoid unsafe product framing: this is trusted-device/private-network access, not broad music redistribution.

## Remote Access Target

Pixelody needs an eventual "away from home" path for personal library access and trusted J.A.M. That must not mean asking normal users to expose the desktop server directly to the public internet.

Preferred long-term shape:

- Local mode remains accountless, localhost/LAN-first, and usable without any Pixelody cloud service.
- Remote mode is separate, opt-in, and visibly active.
- The desktop or Linux host opens outbound connections only; inbound public ports are not required for normal users.
- A Pixelody broker/relay layer may help devices find each other, authenticate, and move encrypted traffic, but it should not become a central music library or permanent song-storage service.
- Pairing creates device identities, not just copied bearer tokens. Device access must be scoped and revocable.
- Audio and metadata traffic should be encrypted end-to-end between trusted devices where practical. If relay transport is needed, the relay should not need file-system paths or reusable library credentials.
- Remote sessions must use short-lived session credentials derived from a longer-lived trusted-device record.
- J.A.M. Guests get the narrowest permissions first: queue/session participation before library browsing, and library streaming only after explicit host approval.
- Diagnostics must distinguish: broker unavailable, relay unavailable, host asleep, host offline, source device unreachable, permission revoked, token expired, stream interrupted, and unsupported network.

Acceptable milestones:

1. Private-network remote access: Tailscale/WireGuard/ZeroTier-style addresses, already compatible with the LAN/private host mode.
2. Remote pairing contract: device identity, approval, revocation, scoped permissions, short-lived session tokens.
3. Connection broker prototype: host and phone both connect outbound, exchange reachability and session setup messages, no audio relay yet.
4. Encrypted relay prototype: fallback stream path for networks where direct peer/device access fails.
5. Remote J.A.M. V1: single host library, remote trusted devices as controllers/queue participants.
6. Federated J.A.M. remote source support only after legal, security, diagnostics, and reliability reviews.

Do not ship remote access through manual port forwarding as the default product path. It may exist as an expert-only diagnostic option later, but it should never be the main UX.

## Current Implementation

- [x] `src/server/` host core exists beside the Electron main process.
- [x] Personal server is off by default and starts on `127.0.0.1` only.
- [x] Main process owns server lifecycle through validated IPC.
- [x] Desktop host identity persists separately from runtime credentials, with migration from the earlier trusted-device store when present.
- [x] Owner credentials rotate for every server run, pending pairing state is discarded on stop/restart, and stopped credentials are rejected.
- [x] Renderer exports a sanitized library snapshot to the host core.
- [x] Public API responses omit desktop file paths.
- [x] Public track IDs are hashed from private renderer IDs so path-shaped internal IDs are not exposed.
- [x] Token auth protects library, track, artwork, and stream routes.
- [x] `GET /api/v1/health` and `GET /api/v1/server-info` exist for diagnostics.
- [x] `GET /api/v1/host/capabilities` reports host roles and limits without advertising unfinished J.A.M. coordinator behavior.
- [x] `GET /api/v1/library/snapshot` returns tracks, playlists, favorites, queue, playback, and audio profile metadata.
- [x] `GET /api/v1/library/tracks` returns paged and filtered public track results for large-library clients.
- [x] `GET /api/v1/live` returns a polling-friendly live state payload for playback, queue, favorites, device, command diagnostics, and universal `networkSession` metadata for connected devices.
- [x] Live and library contracts expose stable overall plus library/playback/queue/favorites/permissions/device-refresh revisions; no-op renderer exports do not advance them.
- [x] Playback payloads carry a current timing anchor and projected position suitable for Android interpolation.
- [x] `sinceRevision` returns a minimal unchanged response instead of retransmitting full live/library state.
- [x] `POST /api/v1/commands/playback` and `POST /api/v1/commands/queue` accept permission-gated remote control commands and bridge them to the renderer.
- [x] `GET /api/v1/tracks/:id/stream` supports byte-range streaming.
- [x] `GET /api/v1/tracks/:id/artwork` serves only known artwork paths from the current snapshot.
- [x] Dedicated J.A.M. drawer has start, stop, private-network, refresh, self-test, copy invite, short-code pairing, connect-detail, network-address, and trusted-device controls outside Appearance settings.
- [x] Server self-test verifies health, auth rejection, path-hidden snapshot, public IDs, and range streaming.
- [x] Trusted-device records persist as token hashes with permissions, status, last-seen metadata, and revocation state.
- [x] Owner-only core, HTTP `PATCH /api/v1/devices/:deviceId`, validated Electron IPC, and desktop controls can grant or remove implemented permissions without re-pairing.
- [x] Trusted-device creation, revocation, and permission edits rollback and report a structured failure when the device store cannot be written.
- [x] Authenticated polling batches `lastSeenAt` persistence instead of synchronously rewriting the device store on every request.
- [x] Missing, invalid, expired, and revoked credentials return distinct structured codes consumed by Android diagnostics.
- [x] Pending pairing records are pruned/bounded, pairing completion attempts are throttled, and playback/queue command bursts are rate-limited.
- [x] Copied Android/manual connection details create a revocable trusted-device token instead of reusing only the owner token.
- [x] Failed invite creation never substitutes the runtime owner token for a scoped trusted-device credential.
- [x] Trusted-device records distinguish owner-declared `personal-device` access from `jam-guest` access; Windows-created J.A.M. invites default to guest access.
- [x] J.A.M. guest records cannot receive `stream` or `cache`, guest library payloads omit original-file stream URLs, and direct original-stream requests fail closed even if a malformed record retains a permission.
- [ ] Replace owner-declared personal-device trust with optional account plus device-key proof before claiming same-account enforcement or protected remote playback.
- [x] `GET /api/v1/devices`, `DELETE /api/v1/devices/:deviceId`, `POST /api/v1/devices/refresh`, `POST /api/v1/pair/start`, and `POST /api/v1/pair/complete` exist for owner-managed device access, non-destructive J.A.M. device re-sync, and short-code pairing.
- [x] Desktop can create and copy a QR-ready pairing payload with short code, secret, expiry, scoped permissions, and candidate base URLs.
- [x] Desktop clears expired pairing codes from the QR/copy surface and lets active codes be refreshed.
- [x] Desktop renders standards-compliant QR codes through `qrcode-generator`, and Android scans/parses the short-lived Pixelody pairing QR payload on device.
- [x] Host status includes structured `networkDiagnostics` with reachability, address candidates, Windows Firewall guidance, warnings, and next steps.
- [x] Settings shows trusted devices with active/revoked state, permissions, last seen, and Revoke controls.
- [x] Shared contract fixtures exist for host capabilities, pairing payloads, library snapshots, live state, and future J.A.M. queue items.
- [x] Shared J.A.M. V1 fixture defines the current single-host session boundary, participant roles/permissions, queue ownership fields, soft-refresh diagnostics, and explicit federated-source-off state.
- [x] Android client can complete short-code pairing payloads, fetch capabilities, save the trusted host token locally, reconnect to the saved host, poll live state, parse universal `networkSession` and explicit single-host J.A.M. metadata, request owner-approved participation, request/observe soft refresh, and visibly exercise session-scoped suggestion, queue-edit, and playback-control routes with actionable permission denials.
- [x] Android connects through a metadata-only snapshot plus revision-consistent paged track requests, with query/playlist filtering available on the page client.
- [x] Android polling cancels on background/host changes, resumes from its last revision, uses bounded failure backoff, and maps structured HTTP/network failures to explicit connection states.
- [x] Android stream/artwork requests use exact-origin bearer headers; reusable trusted-device credentials are absent from media URLs and query-string credentials are rejected by the server audit.
- [x] Android saved-host credentials use Android Keystore AES-GCM protection with no plaintext fallback and are cleared on forget or structured revocation/expiry/invalid-auth failures.
- [x] Media3 is wired to the authenticated range-capable data source, explicit FLAC/WAV/MP3 media types, audio focus/noisy-route handling, MediaSession notification/lock-screen controls, queue transitions, and credential-free process restoration; compilation and unit contracts pass.

## Next Gates

- [x] Persist paired-device records and revocable tokens.
- [x] Add QR rendering/scanning for the short-lived pairing payload.
- [x] Keep LAN mode behind an explicit private-network action with token storage and revoke controls.
- [x] Add connected-device table with last seen, permissions, and revoke.
- [x] Add WebSocket `/api/v1/live` or a polling substitute for playback/library state. Polling substitute exists with universal `networkSession` metadata; WebSocket push remains future polish.
- [x] Add remote playback command routes only after permissions are enforced.
- [x] Add pagination or filtered snapshot routes before large-library mobile browsing. Android now consumes those pages instead of requiring one full track array response.
- [x] Add Windows firewall/network-interface messaging before LAN exposure. Candidate host URLs, structured reachability, adapter notes, and Windows Private-network guidance are visible.
- [ ] Add optional OS-level Windows firewall rule detection/repair later only if it stays non-invasive and does not require admin prompts during normal playback.
- [~] Build tiny mobile/web proof of concept against localhost/LAN contract. Android native APK builds and has host pairing, QR scanning, browse/live plumbing, command routes, and universal session metadata; real-device LAN streaming remains.
- [~] Add Android native client against the same DTOs after the host contract stabilizes. Shared fixtures, Android parsing tests, authenticated Media3 wiring, protected credentials, and a debug APK exist; Room/cache architecture and physical Media3 verification remain.
- [x] Verify Android real-device LAN streaming end-to-end: the 2026-07-19 Samsung SM-S721U matrix passed pairing, browse, authenticated artwork, real-track streaming/seeking, background and lock-screen controls, host shutdown/restart, token revocation, missing media, Wi-Fi reconnect, and stale-address recovery.
- [ ] Define remote-access device identity, broker, relay, and end-to-end encryption contracts before adding public-distance access.
- [~] Add single-host J.A.M. V1 only after browsing, streaming, auth, and queue sync are stable. Server/session lifecycle, Windows owner UI, Android join/approval plus restricted-and-expanded suggestion/queue/playback actions, source-aware ownership, missing-track diagnostics, participant removal, Windows credential revocation, explicit stop, and empty host restart were physically verified on Samsung SM-S721U/Android 16 on 2026-07-21. Closure still requires the Android-side structured revoked-state capture, final device UI/log credential/private-path scan, and verified removal of the temporary port-scoped Windows test firewall rule.
- [x] Add federated source-device queue fields before Type 2 J.A.M. streaming. Real single-host server responses and Android models preserve the future source fields while rejecting non-coordinator sources.
- [x] Add server queue responses that preserve `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, source availability, host-owned cache state, playback status, fallback and diagnostics fields. Multi-source stream handoff remains explicitly deferred.
- [ ] Replace or supplement polling with WebSocket push after the polling contract is stable on Android.
- [ ] Move host/library/network state toward a crash-safe database instead of depending on browser `localStorage`.

## Debug Matrix

- [ ] Server remains off after fresh app restart.
- [ ] Starting host does not interrupt desktop playback, mini-player, imports, metadata hydration, themes, or EQ.
- [ ] Opening and closing the J.A.M. drawer does not interrupt playback, settings, queue, mini-player, or theme transitions.
- [x] Server core remains off by default before a fresh host start.
- [x] Self-test passes with empty library and non-empty library.
- [x] Unauthorized snapshot/stream requests return `401`.
- [x] Snapshot never includes `path`, `artworkPath`, or Windows drive paths.
- [x] Stream route supports middle, open-ended, suffix, and invalid ranges.
- [x] Missing media returns a clear unavailable error.
- [x] Artwork route handles missing artwork without exposing paths.
- [x] Large FLAC/WAV files seek through byte ranges on the physical Android device; the 2026-07-19 matrix used 28,542,706-byte FLAC and 26,829,714-byte WAV files.
- [x] Stop host promptly aborts active streams and stalled clients, closes the listening socket, and invalidates runtime owner/pairing credentials.
- [x] Active trusted-device tokens survive host recreation while revoked tokens remain rejected.
- [~] Android `testDebugUnitTest`, `assembleDebug`, repeated `adb install -r`, and the documented Samsung SM-S721U private-LAN matrix passed on 2026-07-19. Real transient/sustained focus loss and physical Bluetooth connect/disconnect/reconnect also passed. A final-gate rerun rebuilt/installed the APK and replayed recovered-address FLAC successfully, but physical wired-headphone disconnect remains unavailable because the user confirmed no compatible wired headphones or USB-C audio adapter is available.
- [x] LAN exposure requires explicit user action, scoped/revocable token details, and visible network diagnostics.
- [x] Limited devices cannot send playback or queue commands without the matching permission.
- [x] Permission-matrix coverage verifies browse, stream, playback state/control, queue write, owner-only operations, permission removal, expiry, and revocation.
- [x] Revision tests cover no-op stability plus library, queue, favorite, playback/seek, permission, and device-refresh changes.
- [x] Conditional live/library refresh, playback timing anchors, paged filtering, bounded Android backoff, and cancellation propagation have contract/unit coverage.
- [x] Remote playback and queue commands map public track IDs back to private renderer IDs before dispatch.
- [x] Single-host J.A.M. audit covers explicit lifecycle, pending/approved participants, owner guest policy, suggestion/add/edit/control permissions, guest escalation denial, host-only source enforcement, missing media, participant revocation, J.A.M. revision visibility, and stop cleanup.
