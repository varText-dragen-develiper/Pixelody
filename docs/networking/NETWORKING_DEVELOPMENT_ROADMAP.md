# Pixelody Networking Development Roadmap

This is the execution roadmap for the networking side of Pixelody. It turns the broader planning notes into six bounded development sequences that can be completed one at a time with short review cycles.

Read this with:

- `docs/ARCHITECTURE.md`
- `docs/design/DESIGN_NORTH_STAR.md`
- `docs/networking/NETWORKING_CAPABILITIES_IMPLEMENTATION_MAP.md`
- `docs/networking/LOCAL_NETWORK_JAMS_AND_DEVICE_HOSTING.md`
- `docs/networking/NETWORKING_BACKBONE_CHECKLIST.md`
- `docs/networking/ANDROID_PERSONAL_SERVER_PLAN.md`
- [ANDROID_APP_DEVELOPMENT_PLAN.md](https://github.com/varText-dragen-develiper/pixelody-android/blob/main/docs/ANDROID_APP_DEVELOPMENT_PLAN.md)

The six sequences are ordered. Do not start a later sequence merely because part of it looks easy. At the end of each sequence, run its checks, record residual risks, update only the roadmap items actually completed, and hand the user the prompt for the next sequence.

## Progress Tracker

Active sequence: **Sequence 5**

- [x] Sequence 1: Stable Desktop Host Identity And Lifecycle
- [x] Sequence 2: Trusted-Device Permissions And Credential Safety
- [x] Sequence 3: Accurate Live State And Efficient Library Sync
- [x] Sequence 4: Authenticated Android Playback Vertical Slice
- [ ] Sequence 5: Honest Single-Host J.A.M. V1
- [ ] Sequence 6: Push Sync, Resilience, And Release Gate

Sequence 1 completed 2026-07-18: the desktop host now persists a stable identity, rotates the owner credential per server run, clears stopped-session pairing state, terminates active/stalled connections promptly, preserves active trusted-device credentials and revocation across recreation, and advertises only implemented capabilities. The server audit covers each lifecycle boundary. Manual desktop playback and real-device LAN smoke checks remain part of the later release gate rather than automated completion claims.

Sequence 2 completed 2026-07-18: owners can grant or remove implemented browse, stream, playback-state, playback-control, and queue-write permissions without re-pairing; desktop pairing can explicitly grant Android controller authority; invite creation no longer falls back to the owner token; durable mutations rollback and report storage failure; last-seen writes are batched; pairing/command state is bounded and throttled; and invalid, expired, and revoked credentials produce distinct structured diagnostics. Server and Android contract tests cover the permission/auth matrix. Manual desktop interaction and real-device LAN checks remain deferred to the release gate.

Sequence 3 completed 2026-07-18: live/library responses expose coherent overall and library/playback/queue/favorites/permissions/device-refresh revisions; equivalent renderer exports remain revision-stable; playback is projected from a current timing anchor; `sinceRevision` returns minimal unchanged payloads; Android loads metadata separately and consumes revisioned paged/filtered track APIs; and its foreground-only poll loop resumes conditionally with bounded backoff, cancellation propagation, and structured credential/network/host states. Server and Android timing/revision/paging/reconnect tests pass. Android still assembles all fetched pages into an in-memory snapshot, and physical-device background/network-transition behavior remains a Sequence 4/6 verification gate.

Sequence 4 implementation checkpoint 2026-07-18: Android media and artwork URLs no longer contain reusable trusted-device credentials; server API authentication now accepts bearer headers rather than query credentials; Media3 audio, notification artwork, and Compose artwork use exact-origin authenticated data sources; saved credentials are encrypted with a non-exportable Android Keystore AES-GCM key and are cleared on forget or structured revocation/expiry/invalid-auth failures. The MediaSession service now owns an explicit FLAC/WAV/MP3-capable queue, byte-range-friendly HTTP data source, audio focus/noisy-route handling, notification/lock-screen session, and credential-free playback restoration. Server audit, desktop syntax checks, theme audit, Android unit tests, and `assembleDebug` pass. Sequence 4 remains unchecked because no physical device was connected: APK installation and the complete phone/LAN/media/route/failure matrix are unverified.

Physical-device record for that checkpoint: `adb devices -l` returned no devices/emulators, so device model and Android version are unavailable and APK installation failed with `no devices/emulators found`. No format received an on-device claim (FLAC, WAV, and MP3 are contract/build verified only). Skipped device checks: private-LAN pairing and browse, authenticated artwork, playback and seek for all three formats, background/foreground continuity, notification and lock-screen controls, audio-focus interruption, wired-headphone disconnect, Bluetooth route change, process restoration, host shutdown/restart, credential revocation, missing media, Wi-Fi loss/reconnect, stale-address recovery, and UI/path/credential leak inspection.

Sequence 4 closure attempt 2026-07-19: the required preflight and post-build `adb devices -l` checks again returned no connected devices. Desktop syntax checks, server audit, theme audit, Android `testDebugUnitTest`, and `assembleDebug` passed; installation again failed with `no devices/emulators found`. Device model, Android version, and physically played formats therefore remain unavailable. The full physical-device matrix listed above was skipped for lack of a connected phone, so Sequence 4 remains active and unchecked and Sequence 5 must not start.

Sequence 4 physical-device continuation 2026-07-19: a Samsung SM-S721U running Android 16 (API 36) was authorized over USB, the current debug APK installed, and private-LAN pairing/browse plus authenticated artwork passed. Real FLAC (28,542,706 bytes), WAV (26,829,714 bytes), and MP3 (9,387,136 bytes) played through Media3; FLAC/WAV/MP3 seeking, a large-file range seek, foreground/background and screen-off continuity, notification and lock-screen controls, pause/resume, process restoration, host shutdown/restart, visible missing-media diagnostics, Wi-Fi loss/reconnect, revocation with protected-credential erasure, stale-address detection/fresh-pair/playback recovery, and credential/private-path leak scans passed. Device testing exposed and fixed a stale global connection chip and added explicit current-origin rebasing when rebuilding Media3 queues after host-address changes; the recovered-address FLAC retest reached `PLAYING` with buffered audio and no network/auth error.

Sequence 4 physical audio closure continuation 2026-07-19: USB-only stay-awake mode prevented screen timeout during the run and was restored afterward. A real Samsung ringtone preview requested `GAIN_TRANSIENT`; Pixelody paused FLAC, retained position, regained focus, and resumed automatically when the preview closed. YouTube Music requested sustained `GAIN`; Pixelody paused and remained paused after the competitor stopped until the user explicitly resumed it. A physical Bluetooth audio device connected, played recovered-address FLAC, disconnected while playing, caused a safe pause without speaker spill, reconnected, and resumed FLAC without playback/network/auth errors. Bluetooth was restored to its original off state. Sequence 4 remains unchecked only because the user has no wired/USB-C headphones or adapter available, so a physical wired-headphone disconnect could not be performed. No code failure is currently known in that path; Media3's noisy-route handling remains unit/configuration verified but not physically verified for wired hardware.

Sequence 4 wired-route final-gate attempt 2026-07-19: the current debug APK rebuilt and installed on the Samsung SM-S721U running Android 16 (API 36). Desktop syntax checks, server audit, theme audit, Android `testDebugUnitTest`, and `assembleDebug` passed. The bounded private-LAN host reconnected, and a live-library refresh renewed the expired short-lived media grant before recovered-address FLAC reached `PLAYING` with buffered audio and no playback error. No compatible wired headphones or USB-C audio adapter were available, as confirmed by the user, so wired-route selection and physical disconnect behavior (safe pause, no speaker spill, position retention, visible state, and explicit resume) were skipped. The temporary USB-only stay-awake value and 30-minute screen timeout were restored to their original values (`0` and 30 seconds), wireless ADB was returned to USB mode, playback was paused, and the smoke host exited. At that checkpoint Sequence 4 remained active; the later 2026-07-21 scope decision moved the accessory-only check to the release matrix.

Sequence 4 scope decision 2026-07-21: the user explicitly deferred the unavailable wired-headset accessory check so networking feature development can continue. Sequence 4 is complete based on its implemented credential/media contract, automated gates, and the documented Samsung private-LAN, playback, focus, Bluetooth, failure and recovery matrix. Physical wired disconnect remains an honest deferred item in the Sequence 6/release-device matrix; it is not claimed as verified.

Sequence 5 implementation checkpoint 2026-07-21: the Windows server now owns an explicit ephemeral single-host J.A.M. session with start/inspect/policy/join/approve/remove/stop, participant, source-aware queue, playback and diagnostics routes under `/api/v1/jam/session`. Library Host, J.A.M. Coordinator, Playback Device, Controller and Guest roles remain distinct; owner policy grants session-scoped view, suggest, add, queue-edit and playback-control rights without granting device administration. Every playable item resolves to the Windows host library and preserves `queueItemId`, `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, availability, host-owned cache state, playback status, fallback and diagnostics fields. Federated sources fail closed. The validated Electron bridge and Windows J.A.M. drawer expose explicit session lifecycle, policy, pending approvals, participants and queue state; Android can request to join and parses/displays the same session contract. The server audit covers pending/approval, guest escalation, suggestion/add/edit/control boundaries, missing media, revocation, revisions and stop cleanup; desktop/Electron/security/theme checks and Android `testDebugUnitTest`/`assembleDebug` pass. Sequence 5 remains active because no Android device was visible through `adb` for the real private-LAN join/owner-approval/queue/stop gate.

Sequence 5 physical-closure attempt 2026-07-21: preflight ADB discovery, an ADB daemon restart, the previously recorded private-LAN ADB address, and the required post-build discovery all returned no devices or emulators. The current APK therefore could not be installed, and device model/Android version could not be re-verified. Code inspection found and closed one Sequence 5 testability gap: the Android Single-host J.A.M. card now exposes session-scoped Suggest host track, Add host track, Move first, Clear queue, and Play/pause actions, displays the participant role/permissions and source-aware first queue record, and reports host permission denials visibly. These calls use `/api/v1/jam/session/queue` and `/api/v1/jam/session/playback`, not broader trusted-device command authority. Desktop checks, Electron security audit, server audit, theme audit, Android `testDebugUnitTest`, and `assembleDebug` pass. Installation, Windows-drawer/Android join and approval, restricted and expanded permission behavior, missing-track UI, participant revoke/remove, stop/restart cleanup, and physical UI/diagnostic leak inspection were all skipped because no physical device was reachable. Sequence 5 remains active and unchecked.

Sequence 5 connected-device continuation 2026-07-21: Samsung SM-S721U on Android 16 (API 36) was authorized over USB, the rebuilt debug APK installed, Wi-Fi temporarily restored to the same private LAN, and a temporary administrator-approved inbound TCP rule scoped to the exact development Electron executable and selected host port made the bounded Windows host reachable. Physical pairing, browse/reconnect, Android join request, Windows pending-participant display and Guest approval passed. With view/suggest only, suggestion succeeded while add, move, clear, and playback were visibly denied; Android exposed no trusted-device administration, guest-policy controls, or federated source submission. Windows then granted add/edit/control and applied the policy to the active participant; Android added host-owned tracks, moved and cleared the queue, and sent an accepted playback toggle. Live queue inspection preserved `queueItemId`, Android `addedByDeviceId`, Windows `sourceDeviceId`/`sourceLibraryId`, availability, `host-owned` cache state, queued/playing/suggested status, and empty fallback candidates. A reversible missing-path snapshot produced a physical Android unavailable-item record and actionable missing-host-track diagnostic. Participant removal made Android leave the session; the current trusted-device credential was then revoked from Windows. Explicit stop cleared all participants/queue, and a full host stop/restart returned with no session, participant, or queue state. The run fixed three Sequence 5 issues: blocked prototype-like keys are stripped from network snapshots so the Windows host can start, active participants can receive an owner policy update, and Android selects a non-duplicate host track while surfacing unavailable queue items and accurate action titles. Desktop checks, the 60-contract Electron security audit, server audit, theme audit, Android `testDebugUnitTest`, `assembleDebug`, repeated installation, and the physical matrix above passed. The phone's original Wi-Fi-off and 30-second display settings were restored and hosting is off. Sequence 5 remains active and unchecked because the privileged-tool quota ended immediately after Windows revocation: Android's final structured revoked-state capture and the requested final device UI/log credential/private-path scan were not recorded, and automatic deletion of `Pixelody Sequence 5 Temporary Private LAN` could not obtain a second administrator process. That temporary firewall rule must be removed and its absence verified before closure.

Change a sequence to `[x]` only after its completion gate passes. If implementation is useful but incomplete, leave it unchecked and add a short dated note beneath it describing the remaining gate. After completion, move **Active sequence** to the next unchecked item.

## Fixed Rules For Every Sequence

- Local playback remains accountless and fully usable with networking off.
- Hosting remains off until the user explicitly starts it.
- LAN exposure, pairing, permissions, and revocation remain visible and understandable.
- Public APIs never expose private file paths or renderer-private track IDs.
- J.A.M. Guests never receive import, delete, metadata-edit, backup, export, or device-management authority by default.
- Existing playback, imports, playlists, metadata, tuning, navigation, settings, and mini-player behavior must remain working.
- Every sequence must include its required Windows server core, validated Electron IPC, desktop J.A.M. UI, packaging/security boundary, and Windows sleep/network lifecycle work instead of treating Windows as an already-finished host.
- J.A.M. means **Joined Audio Mesh** in user-facing text and documentation.
- Android portable hosting, public-distance access, and federated source streaming remain deferred until their prerequisites below are complete.

## Completion Protocol

For every sequence:

1. Re-read the files listed by its prompt.
2. Inspect the current implementation before editing; do not trust an old status paragraph over current code.
3. Implement only the sequence in scope.
4. Add or strengthen automated tests for every changed contract or lifecycle rule.
5. Run the required checks.
6. Report completed behavior, changed contracts, skipped manual checks, and residual risks.
7. Update `ROADMAP.txt` and checklist markers only for behavior that now exists and has been verified.
8. Give the user the next sequence prompt from this document, adjusted for any newly discovered constraints.

---

## Sequence 1: Stable Desktop Host Identity And Lifecycle

### Outcome

Make the existing desktop personal server predictable across restart, safe to stop, and honest about what it can currently do.

### Scope

- Persist one stable local host identity instead of generating a new `hostId` each Electron process.
- Separate stable host identity from short-lived runtime secrets.
- Rotate or invalidate owner/invite credentials at clear lifecycle boundaries.
- Clear expired and stopped-session pairing state.
- Ensure Stop Hosting closes or aborts active HTTP connections promptly instead of waiting indefinitely for long streams.
- Make restart behavior explicit for trusted-device tokens: preserved if still trusted, rejected if revoked.
- Report capability flags honestly; do not claim complete J.A.M. coordination while only the personal-library session exists.
- Keep localhost as the server-core default and LAN binding behind the existing explicit private-network action.
- Add lifecycle tests for start, stop, restart, stale owner credentials, persistent host identity, active streams, and pending pairings.

### Out Of Scope

- Permission editing.
- Android credential transport changes.
- WebSocket push.
- New J.A.M. session endpoints.
- Remote broker or relay work.

### Completion Gate

- Stable `hostId` survives app/server recreation using the same user-data directory.
- Owner and temporary invite secrets have tested invalidation rules.
- Stop Hosting returns promptly with an active or stalled client connection.
- Trusted device persistence and revocation still work.
- Capability payloads match implemented behavior.
- `npm run check`, `npm run check:server`, and relevant desktop smoke checks pass.

## Sequence 2: Trusted-Device Permissions And Credential Safety

### Outcome

Make a paired device's authority understandable, editable, revocable, and no broader than intended.

### Scope

- Add an owner-only way to inspect and edit trusted-device permissions.
- Add the corresponding owner-authenticated API/core operation and desktop IPC/UI controls.
- Make the normal Android pairing flow capable of receiving explicit controller permissions when the owner chooses them.
- Remove any fallback that silently replaces a scoped device token with the owner token.
- Surface trusted-device persistence errors instead of returning an apparently durable token when storage failed.
- Throttle and batch `lastSeenAt` persistence so one-second polling does not synchronously rewrite the device store every second.
- Add basic pairing/command abuse controls appropriate for a LAN host: expiry pruning, bounded pending records, and request throttling where needed.
- Return structured auth error codes that distinguish invalid, expired, and revoked credentials without revealing secrets.
- Add permission-matrix tests for browse, stream, playback control, queue write, owner operations, and revocation.

### Out Of Scope

- Replacing HTTP polling.
- Removing URL tokens from Android media playback; that is Sequence 4.
- Full J.A.M. guest/session policy; that is Sequence 5.

### Completion Gate

- Owner can grant and remove controller/queue permissions without re-pairing.
- A normal paired Android device can exercise only the permissions visibly granted to it.
- No error path hands out an owner token as a fallback.
- Polling no longer causes a synchronous trusted-device file write per request.
- Revoked/invalid/expired states are distinguishable in tests and client-facing diagnostics.
- Desktop, server, and Android contract tests pass.

## Sequence 3: Accurate Live State And Efficient Library Sync

### Outcome

Make polling a trustworthy synchronization contract before adding push transport.

### Scope

- Define revision semantics for library, queue, playback, permissions, and device refresh state.
- Keep playback position current or provide a tested timing-anchor contract that clients can interpolate correctly.
- Ensure pause, seek, track change, queue change, favorite change, permission change, and host stop produce coherent revisions/state.
- Add conditional or revision-aware refresh behavior so clients do not repeatedly download unchanged full snapshots.
- Make Android consume the paged/filtered track endpoint for large libraries instead of always requiring the full track array.
- Add polling backoff, recovery, and cancellation behavior for app backgrounding, host shutdown, Wi-Fi change, and repeated failures.
- Map server error codes to explicit Android connection states rather than inferring solely from message text.
- Expand fixtures and cross-language tests for timing, revision changes, pagination, refresh, and reconnect.

### Out Of Scope

- WebSocket transport.
- Media3 credential-header changes.
- Real-device completion claims.
- J.A.M. sessions.

### Completion Gate

- Polling clients see accurate or correctly interpolated playback progress.
- State revisions change for documented reasons and remain stable when nothing changed.
- Large-library Android browsing uses paging/filtering.
- Android reconnect/backoff does not create a tight failure loop.
- Revoked, permission-denied, offline, and unreachable states are based on structured responses.
- Server and Android contract/unit tests pass.

## Sequence 4: Authenticated Android Playback Vertical Slice

### Outcome

Complete and verify the first real cross-device product slice: pair a phone, browse the host, and play one real track reliably.

### Scope

- Stop embedding long-lived trusted-device tokens in artwork and stream query URLs.
- Configure Media3 and artwork loading to send credentials through controlled request headers or short-lived stream grants.
- Store long-lived trusted-device credentials with appropriate Android private/secure storage and clear them on forget/revocation.
- Ensure range seeking works for large FLAC, WAV, and a common compressed format.
- Verify foreground playback, notification, lock-screen controls, audio focus, headphone/Bluetooth changes, background playback, and process restoration.
- Handle host shutdown, token revocation, missing media, Wi-Fi loss/reconnect, and stale host addresses visibly.
- Add test hooks/logging needed to diagnose Android playback failures without exposing secrets or host file paths.
- Keep the Android portable host disabled or clearly experimental during this sequence.

### Completion Gate

- A physical Android device pairs with the Windows host on a private LAN.
- It browses sanitized metadata/artwork and streams real media without a reusable token in the URL.
- Seek, background playback, notification, and lock-screen controls work on device.
- Shutdown, revocation, missing media, and Wi-Fi reconnect have verified recovery behavior.
- No secret or private Windows path appears in normal UI or diagnostics.
- Server audit, Android unit tests, assemble, install, and documented real-device smoke test pass.

## Sequence 5: Honest Single-Host J.A.M. V1

### Outcome

Turn the personal-library connection into an explicit single-host J.A.M. session with roles, participants, guest policy, and a source-aware shared queue.

### Scope

- Define J.A.M. session create/start, inspect, join/approve, stop, participant, queue, and diagnostics contracts under `/api/v1`.
- Keep Library Host, J.A.M. Coordinator, Playback Device, Controller, and Guest roles distinct.
- Implement owner-controlled guest permissions for viewing state, suggesting/adding host-owned tracks, queue editing, and playback control.
- Return queue items with `queueItemId`, `addedByDeviceId`, `sourceDeviceId`, `sourceLibraryId`, availability, cache state, playback status, and fallback diagnostics.
- Keep V1 strictly single-host: every playable track must resolve to the coordinator's host-owned library.
- Make unavailable/missing/revoked states visible and recoverable.
- Add desktop and Android J.A.M. session/participant/queue surfaces sufficient to exercise the contract.
- Add session stop cleanup and tests proving guest permissions cannot reach admin/library mutation operations.

### Out Of Scope

- Guest-owned uploads.
- Temporary contribution cache.
- Multi-source stream handoff.
- Broker, relay, or public-distance access.

### Completion Gate

- Owner can start and stop one explicit single-host J.A.M. session.
- A paired Android device can join with a visible role and scoped guest/controller permissions.
- Shared queue records preserve future source ownership fields while resolving only host-owned audio.
- Missing tracks, revoked participants, and host stop are reflected in diagnostics and UI.
- Guest escalation tests pass.
- The product does not claim federated or remote J.A.M. behavior.

## Sequence 6: Push Sync, Resilience, And Release Gate

### Outcome

Replace high-frequency polling as the normal live path while retaining a reliable fallback, then close the first networking milestone with repeatable diagnostics and regression coverage.

### Scope

- Add authenticated WebSocket push for versioned live events.
- Use the same reducer/state contract as polling; do not create a second source of truth.
- Retain polling as reconnect/bootstrap/fallback behavior.
- Implement heartbeat, reconnect backoff, duplicate/out-of-order event handling, and snapshot recovery after gaps.
- Push playback, queue, session, participant, permission, device refresh, shutdown, and revocation changes.
- Add connection and stream diagnostics: route, latency, buffer/retry health, last handshake, last revision, and recovery action.
- Add bounded resource behavior for HTTP/WebSocket connections and streams.
- Run desktop playback/network regression tests and Android background/reconnect tests.
- Reconcile `docs/ARCHITECTURE.md`, Android README, networking notes, backbone checklist, fixtures, and `ROADMAP.txt` with verified reality.

### Completion Gate

- Android uses authenticated push for normal live state and polling for bootstrap/fallback.
- Disconnect/reconnect and revision-gap recovery work without duplicate commands or stale UI.
- Server shutdown and token revocation reach connected clients promptly.
- Connection/resource limits and diagnostics are tested.
- The six-sequence desktop-to-Android single-host milestone passes its release checklist.
- Documentation no longer describes implemented Android/networking behavior as merely planned.

## What-Next Roadmap After The Main Six

These are the next major programs, in recommended order. Re-evaluate their order after Sequence 6 based on real-device evidence and user priorities.

### 7. Durable Shared Core State And Windows Host Hardening

- Move network-facing library, playlist, queue, identity, permission, and J.A.M. state away from renderer-only `localStorage` into a crash-safe store.
- Add migration, backup, rollback, and corruption recovery.
- Give Electron renderer, desktop host, future Linux host, and Android sync one explicit service boundary.
- Make Windows hosting resilient across renderer reloads, app sleep/resume, adapter changes, upgrade/restart, malformed state, and unexpected process termination.
- Decide whether optional tray/background hosting is appropriate; keep it opt-in, visibly active, bounded, and independently stoppable.
- Extend Windows integration/package tests for firewall guidance, host lifecycle, J.A.M. persistence boundaries, upgrades, uninstall preservation, and crash recovery without introducing routine admin prompts.

### 8. Android Offline And Resilient Cache

- Add Room-backed metadata/cache state.
- Add explicit user-selected offline audio with storage limits and permission enforcement.
- Separate owned offline downloads from temporary J.A.M. contribution cache.

### 9. Android Portable Hosting

- Replace the in-Compose socket prototype with a foreground hosting service.
- Add persistent notification, Stop Hosting, stable identity, pairing/revocation, connection limits, URI permission durability, network/battery warnings, and hotspot/Wi-Fi tests.
- Add mDNS/local discovery only after explicit host identity and pairing are stable.

### 10. Linux Host Parity

- Extract or package the shared Node/core host for Linux.
- Add durable service lifecycle, file/import adapters, firewall guidance, removable-storage behavior, and Android interoperability tests.

### 11. Optional Remote Access

- Define device public-key identity, short-lived session credentials, rendezvous, broker, direct-route negotiation, encrypted relay fallback, abuse controls, and self-hosted compatibility.
- Keep host connections outbound and remote mode opt-in.
- Do not use manual public port forwarding as the default product path.

### 12. Federated J.A.M. Type 2

- Add source-device availability, multi-host queue resolution, trusted-device stream handoff, fallback candidates, and failure recovery.
- Add temporary encrypted, session-scoped contribution caching only after legal/security review.
- Never merge contributed session audio into permanent libraries, playlists, imports, or backups automatically.
