# Multi-Output Speaker Systems Notes

These notes capture implementation reality and working decisions for Pixelody's grouped speaker rig feature.

## User Goal

The target user can plug in two stereo setups, choose both inside Pixelody, tune each setup independently, and eventually play one track through both at the same time. The feature should also support future room-fill setups, headphones plus speakers, HDMI plus USB DAC, and J.A.M.-adjacent playback devices.

## Important Naming

Use clear product language:

- "Grouped speaker rig" for the saved local configuration.
- "Output" for a Windows audio endpoint.
- "Rig member" for one output inside a grouped rig.
- "J.A.M." only for Joined Audio Mesh network/shared listening features.

Avoid saying "system-wide" unless discussing Windows-wide System Tuning Mode. Multi-output Pixelody playback and System Tuning Mode are related but separate promises.

## Current Implementation Reality

The app already had output-level tuning before grouped rigs:

- `state.systems`: per-output EQ and profile data.
- `state.spatialProfiles`: per-output balance and mono data.
- `currentSystemId()`: currently maps to `outputState.activeId || 'default'`.
- Main playback uses one `<audio id="audio">`.
- Output routing uses `audio.setSinkId(targetId)` where supported.
- Test tones use a separate generated stream and route to the active output.
- Latency and mic calibration operate against the active output.

The grouped rig layer now adds:

- `state.speakerSystems`
- `state.activeSpeakerSystemId`
- localStorage keys:
  - `pixelody.speakerSystems`
  - `pixelody.activeSpeakerSystemId`
  - `pixelody.speakerSystemPrototype`
- UI in Audio Systems for grouped rigs.
- Backup and tuning-profile support.
- Diagnostics and J.A.M. server snapshot exposure.

This is a control/data foundation. It does not yet play to multiple outputs simultaneously.

Phase 2 now has a disabled-by-default browser prototype guard:

```json
{
  "browserMultiSinkEnabled": false,
  "maxOutputs": 2,
  "updatedAt": "ISO date"
}
```

The Audio Systems panel exposes this as an experimental checkbox. Enabling it arms browser multi-sink work behind guard checks. The guard currently requires direct sink selection, at least two visible output endpoints, a selected rig, exactly two available unmuted/audible members, unique routes, no secondary member resolving to the current primary output, and the hard two-output prototype cap.

When the guard passes, Pixelody now prepares off-DOM secondary `Audio` elements for non-primary rig members and keeps their source aligned with the main player. Main playback controls now flow through one shared command model for primary and secondary elements, with command sequence diagnostics. Secondary elements mirror the primary source URL, current time, playback rate, volume base, pause/play, seek, ended, and error state. Secondary elements apply their member `gainDb` trim through the secondary graph. Member mute and solo are applied as an audible gate before trim, and diagnostics expose the gate state. Secondary elements also apply `delayMs` by targeting the primary clock minus the member delay and holding at track start until the delay has elapsed; this is an experimental media-element offset, not yet a native mixer delay line. Each secondary becomes a `MediaElementAudioSourceNode`, which reroutes its audio exclusively into a Web Audio graph. Pixelody then routes that graph with `AudioContext.setSinkId()` and applies current track EQ, the member's bound output EQ and spatial profile, ReplayGain, conservative headroom, a protective limiter, trim, and polarity. If Web Audio or context sink routing is unavailable, that member fails closed and diagnostics report the graph/EQ limitation. The primary path remains the single authoritative media element and clock. The prototype records drift by comparing each secondary media clock to the expected delayed target, classifying small, medium, and large drift and keeping a short diagnostic history. Medium drift gets a temporary playback-rate nudge capped within 0.97x-1.03x of the primary rate; large drift gets a seek correction. The Audio Systems panel shows route stability as stable, correcting, unstable, or unsupported. Track/source changes keep each secondary element's original Web Audio graph alive and replace only its media source. Secondary media elements and graphs are torn down when a member is removed or replaced, the feature is disabled, or the renderer closes. The prototype blocks duplicate routes and now also requires the selected primary output to be a member of the active rig. The primary output remains the playback anchor at the user's base volume; every member still needs physical independence and long-run validation before release.

## Rig Data Shape

Current member fields:

```json
{
  "id": "member-...",
  "deviceId": "default-or-browser-device-id",
  "label": "Nearfield speakers",
  "outputKey": "label:nearfield speakers",
  "role": "main",
  "enabled": true,
  "muted": false,
  "solo": false,
  "gainDb": 0,
  "delayMs": 0,
  "polarity": "normal",
  "eqMode": "simple",
  "systemProfileId": "default-or-browser-device-id",
  "calibrationReportId": "",
  "calibration": {
    "software": {
      "assignedAt": "ISO date",
      "measuredAt": "ISO date",
      "method": "web-audio-path-profiler",
      "estimateMs": 12.4,
      "confidence": "Medium",
      "routeMatch": true
    },
    "microphone": {
      "assignedAt": "ISO date",
      "measuredAt": "ISO date",
      "method": "microphone-acoustic-pulse",
      "estimateMs": 34.8,
      "confidence": "High",
      "routeMatch": true
    }
  }
}
```

`outputKey` is a duplicate-protection and device-ID-recovery key. It is `default` for System Default, `label:<normalized label>` when the browser exposes a meaningful output label, and `device:<deviceId>` as a fallback when labels are unavailable.

Member availability is computed after each output refresh instead of being treated as permanent saved state. A member is available when it is System Default, its saved browser `deviceId` is still present, or its `outputKey` matches a current output after a browser device-id rotation. Unavailable members remain in the rig, show a warning, and cannot be routed until the output returns or is replaced.

The rig panel also computes a route warning from the current browser output list. If direct sink selection is unavailable or Pixelody sees only one Windows output endpoint, the ROUTES readout explains that independent two-stereo tuning requires at least two visible endpoints. This warning is about what the app can address, not a guarantee about the user's physical wiring.

Per-member calibration assignment currently attaches compact snapshots from the latest software latency report and/or latest microphone acoustic report. It does not run member-isolated calibration yet. If the assigned report was measured on a different output route, `routeMatch` is false and the UI marks the assignment as route-questionable.

Each rig member now has a `Calibrate` action. It routes Pixelody to that member's output, starts the existing guided output-profile calibration wizard, labels the wizard with the rig member name, and stores the rig/member identifiers in the saved listening-profile calibration metadata. While the member calibration wizard is active, Pixelody snapshots the rig members' `enabled`, `muted`, and `solo` states, solos the selected member, mutes every other member, and restores the snapshot on save, cancel, or calibration restart. Generated speaker test tones and microphone-calibration chirps resolve their sink from the active calibration member instead of relying only on the current global output selector. Software latency reports created during member calibration include the rig/member route identifiers and are stored into that member's `calibration.software` snapshot automatically. Microphone acoustic reports created during member calibration are likewise stored into that member's `calibration.microphone` snapshot automatically. Once at least two rig members have usable calibration estimates, the rig panel shows each member's arrival relative to the earliest measured output and suggests a positive-only `delayMs` value that delays faster members to the slowest measured arrival; an `Apply delay` action writes that suggestion to the member, capped at 250 ms. Each member row now shows an explicit calibration confidence line, prefers microphone confidence when available, flags route-questionable reports, and uses a subtle row accent for high, medium, low/uncertain, or questionable states. Rows also show room/acoustic caveats, including whether timing is software-only, microphone placement/reflection sensitivity, route changes after measurement, and Bluetooth buffering risk. The delay control now includes by-ear nudge buttons for -5 ms, -0.5 ms, +0.5 ms, and +5 ms adjustments, clamped to the existing 0-250 ms member delay range and synced to active secondary output state. Each member also has a `Polarity` check action that requires one other available rig member as an anchor. It plays short low-frequency A/B pulses through the anchor plus the selected member using short-lived generated audio routes: the first pass uses the selected member's current polarity, the second temporarily inverts that member. The flow records a compact `polarityCheck` receipt on the member and leaves the actual `polarity` value user-controlled through the existing selector or the new `Flip` action. The rig panel now separates `Copy calibration` from broader diagnostics; the grouped calibration report is copyable JSON with the rig summary, member calibration snapshots, confidence/caveats, delay suggestions, current trim/delay/polarity controls, polarity-check receipts, profile binding summaries, route availability/duplicate risk, and browser-prototype stability summary. It intentionally avoids music file paths and library contents.

Current rig fields:

```json
{
  "id": "speaker-system-...",
  "name": "Desk + Towers",
  "enabled": true,
  "mode": "multi-output",
  "engineState": "Setup saved / dual-output engine not armed",
  "outputs": [],
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

## Existing Files To Know

- `src/renderer.js`: state, output routing, EQ graph, rig model, rig UI behavior.
- `src/index.html`: Audio Systems UI.
- `src/settings.css`: Audio Systems and rig panel styling.
- `src/native-wasapi-helper.js`: Electron bridge for native helper diagnostics.
- `native/windows-wasapi-helper/Program.cs`: WASAPI probe and capture-analysis helper.
- `docs/audio/multi-output/MULTI_OUTPUT_SPEAKER_SYSTEMS_PLAN.md`: original feature plan.
- `docs/audio/GLOBAL_SYSTEM_AUDIO_EQ_PLAN.md`: distinction between Pixelody playback and Windows-wide tuning.
- `docs/audio/AUDIO_RELEASE_GATE.md`: audio release constraints.

## Constraints And Risks

Browser route:

- `setSinkId()` routes a media element to one sink.
- Multi-output requires duplicate media elements or per-output media streams.
- Duplicate elements can drift.
- Duplicate decode work can be expensive.
- Browser device IDs can change when permissions/device labels change.
- Some runtimes may not support direct sink selection.
- Primary playback uses one authoritative media element through the processed Web Audio graph. If the graph or selected sink cannot be established, the app reports an error instead of silently bypassing the user's tuning.

Native route:

- Better long-term sync and clock control.
- Requires careful shared-mode WASAPI handling.
- Must remain optional and signed.
- Must not mutate system audio state for normal playback.
- Must not require a driver for normal Pixelody playback.

Hardware route:

- If two stereo setups are behind one analog output, Pixelody sees one endpoint and can only tune the combined output.
- Independent tuning requires separate Windows endpoints, multichannel hardware, or a future native channel-aware route.

## Near-Term Development Notes

The next best work is not "make the native mixer." It is:

1. Make the rig model more robust.
2. Add unavailable/duplicate output warnings.
3. Add per-member calibration assignment.
4. Build a guarded browser multi-sink prototype for two outputs only.
5. Measure drift and CPU before deciding how hard to push browser fan-out.

## Suggested Browser Prototype Shape

Use the current main `audio` element as the primary output. For each secondary member:

- Create a hidden `Audio` element.
- Set the same `src`.
- Set `preload = 'auto'`.
- Apply `setSinkId(member.deviceId)`.
- Keep it muted at the element level only if Web Audio supplies the audible output; otherwise manage gain through an output graph.
- Mirror play/pause/seek from the primary player.
- On track change, fully tear down old secondary elements.
- Maintain a drift monitor:
  - Compare `secondary.currentTime` to the expected delayed target, currently `audio.currentTime - member.delayMs / 1000` for positive intentional delay.
  - If drift is small, leave it alone.
  - If drift is medium, apply a temporary playback-rate nudge.
  - If drift is large, seek-correct and record the correction.
  - If repeated correction happens, mark route unstable.

Guardrails:

- Start with max 2 outputs. The browser prototype has a hard `BROWSER_MULTI_SINK_PROTOTYPE_MAX_OUTPUTS = 2` cap; rigs may store more members, but the prototype will not arm until the audible set is two or fewer, and the panel/diagnostics list excluded members.
- Disable for unsupported `setSinkId`.
- Disable if secondary route resolves to the same sink as primary.
- Show "experimental" state.
- Do not persist prototype as release-ready.

## Calibration Notes

Per-member calibration should reuse current latency/mic systems, but the UI needs a member-aware wrapper:

- Select member.
- Route to that member.
- Mute other rig members during the test.
- Run software latency.
- Run microphone acoustic calibration if available.
- Save report id or report summary against member.
- Suggest delay offset based on relative acoustic arrival time.

The delay stored in `member.delayMs` should represent intentional delay added to that member, not the measured total output latency.

## Diagnostics Notes

Grouped rig diagnostics should answer:

- Which rig is active?
- Which outputs are members?
- Which member is primary?
- Are any members unavailable?
- Are any members likely the same physical route?
- Which profile is each member using?
- What EQ/spatial profile is currently bound?
- What trim/delay/polarity values are set?
- Is simultaneous playback active?
- If active, what is the current drift?
- If not active, why not?

Diagnostics must avoid private file paths.

Phase 4 now adds a purpose-built `groupedRigSnapshot` inside `activeSpeakerSystemDiagnostics()`. It is separate from the copyable calibration report and is intended for runtime diagnostics, J.A.M. audio-profile snapshots, and future recovery/debug flows. The snapshot includes rig identity, route-warning state, browser sink support, prototype state, per-member route availability, resolved sink id, duplicate/same-as-primary/prototype-cap risk, sink support, secondary graph status, profile id, tuning/spatial profile presence, enabled/mute/solo/trim/delay/polarity controls, and compact software/microphone calibration confidence. It avoids music file paths and library contents.

Output `devicechange` events now debounce through the normal output refresh path and compare grouped-rig member availability before and after the browser device list refresh. Newly unavailable and recovered rig members are recorded in `diagnosticsState.lastSpeakerRigDeviceChange`, surfaced in diagnostics as `lastSpeakerRigDeviceChange`, and mirrored inside `groupedRigSnapshot.lastDeviceChange`. If a rig member becomes unavailable, Pixelody tears down experimental secondary outputs with a fail-closed reason and shows a compact toast while keeping normal single-output playback usable. If output enumeration becomes unavailable or errors, the browser-visible device list is cleared before availability is recomputed so stale routes do not appear healthy.

Duplicate-route warnings now compare both saved route keys and resolved browser sinks. Each member resolves through the current device list first, so if browser device IDs rotate but two rig members recover to the same current endpoint, Pixelody marks the affected rows, updates the ROUTES readout, blocks the experimental browser prototype, and includes `duplicateResolvedSink` / `duplicateResolvedRouteRisk` fields in the diagnostics and copyable calibration report. This is a browser-visible route risk, not proof that the user's physical wiring is duplicated.

The grouped rig panel now shows browser-prototype drift and correction history while secondary routes are active. It summarizes measured secondary routes, worst/max drift, sample count, total corrections, seek corrections, playback-rate nudges, recent per-member drift, and the latest correction events. The same compact rollup is included in grouped rig diagnostics and the copyable calibration report. This history is for experimental browser fan-out troubleshooting; it does not imply release-quality sync or native clock control.

Secondary media elements now keep their own load/decode status separate from route, command, and EQ graph errors. Each hidden secondary records compact media events such as load start, metadata loaded, can play, playing, waiting, stalled, aborted, and browser media error codes. A failed secondary row is visibly marked, member runtime text names the media failure, and diagnostics/calibration reports include per-member `secondaryMedia` plus a `browserPrototype.secondaryMedia` rollup. Media event history stays path-hidden and only describes browser media state.

The grouped rig panel now includes a `Primary only` recovery button. It disables the experimental browser dual-output flag, tears down hidden secondary media elements and Web Audio graphs, unmutes the visible primary player, re-routes it to the currently selected primary output, and resumes playback only if the track was already playing. The recovery action records a compact `lastRecovery` receipt in secondary-output diagnostics, grouped rig diagnostics, and the copyable calibration report.

Rig diagnostics and copyable grouped calibration reports now pass through a rig-specific sanitation layer before leaving the diagnostics builders. It hides local source keys such as `src`, `url`, `path`, `trackId`, artwork paths, and source-track IDs, and it also replaces path-like strings in error messages, including Windows paths, UNC paths, `file://` URLs, and common Unix-style home/media paths. Shared payloads include a `privacy` marker with `pathHidden: true` and `sanitizer: pixelody-rig-diagnostics-v1`.

The grouped rig panel now includes a debug `Self-test` action. It builds a synthetic two-member rig, runs it through normalization plus a JSON round trip without writing to `localStorage`, verifies member control clamping, checks that saved speaker rigs were not mutated, and exercises the diagnostics sanitizer against fake Windows paths, `file://` URLs, artwork paths, and source-track keys. The last pass/fail receipt is stored in rig diagnostics as `debugSelfTest`.

Phase 5 measurement work now starts with `docs/audio/multi-output/MULTI_OUTPUT_PHASE5_MEASUREMENT_LOG.md`. The wired+wired drift item has a documented 30-minute workflow, including hardware prerequisites, app setup, pre/mid/end diagnostics capture, five-minute drift/correction rows, suggested decision thresholds, and a run-summary template. The wired+Bluetooth drift item uses the same 30-minute structure with Bluetooth-specific route, codec/mode, buffering, reconnect, and audible-sync notes so wireless behavior is judged more conservatively than two wired endpoints. The FLAC/WAV/MP3 overhead item adds a baseline-versus-browser-prototype workflow for CPU, memory, decode/load errors, responsiveness, audible behavior, and drift corrections under codec load. These workflows document how to compare the browser prototype; they do not claim the browser prototype has passed the physical 30-minute release gate or the browser/native decision gate until real completed hardware runs are recorded.

`docs/audio/multi-output/MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md` records the current Phase 5 decision: browser fan-out is acceptable as a guarded, disabled-by-default, two-output experimental prototype, but it is not a release-quality multi-output engine yet. It can continue validating grouped rig controls, tuning, calibration, diagnostics, and recovery while the physical drift/overhead matrix is pending. Native WASAPI mixing remains the likely release-quality route if wired drift, Bluetooth stability, codec overhead, route recovery, more-than-two-output support, or user expectations exceed what browser primitives can honestly provide.

`docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md` defines the future native grouped-playback contract if the browser route is not enough. The contract keeps the renderer as the user-intent/control owner, the main process as the bridge discovery/IPC/process boundary, and a future `Pixelody.MultiOutput.Bridge.exe` as the real-time WASAPI renderer for multiple endpoints. It defines route states, probe/configure/load/play/pause/seek/tuning/recovery commands, path-hidden status snapshots, DSP/timing equivalence rules, and safety gates. The contract is not an implemented native renderer and does not change the current release claim.

`docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md` pins down the Phase 5 safety policy for the native grouped-playback path. Native grouped playback must stay optional, signed/trusted for release, uninstallable without deleting user data or breaking normal playback, and non-invasive: no default-device mutation, service, registry setting, driver, virtual endpoint, or external-app capture for normal grouped Pixelody playback. Unsigned native components are dev-only with explicit unpackaged overrides, and all native failures must fail closed with path-hidden diagnostics plus recovery to primary-output playback.

`docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md` defines how the future native `configureRig` command is derived from the existing normalized grouped speaker rig model. The saved rig remains the source of truth: native input maps `system.outputs` members through availability, duplicate-route, mute/solo, profile-binding, calibration, and safety gates. Native-specific status fields can be transient, but there should not be a second persisted native rig store.

`docs/audio/multi-output/MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md` defines how the future native grouped-playback bridge should reuse output profiles, spatial profiles, member calibration, and diagnostics. Native payloads should be derived from normalized `state.systems`, `state.spatialProfiles`, member calibration snapshots, `activeSpeakerSystemDiagnostics()`, and `groupedCalibrationReport()` instead of creating native-only profile or diagnostics stores. Native status can add route counters, endpoint timing, DSP mismatch warnings, and sanitized errors, but it must merge back into the existing grouped rig diagnostics path with path-hidden privacy markers.

`docs/audio/multi-output/MULTI_OUTPUT_NATIVE_STATUS_GATE.md` defines the status-state gate that must exist before any native grouped-playback release claim. It separates blocking states such as `bridge-missing`, `blocked-unsigned`, `blocked-incompatible`, `member-unavailable`, `duplicate-route-blocked`, and `unsupported-format`; degraded states such as high-latency or format-conversion routes; recovery states; and the proof required before a route can be called `active`. Even `active` is only a candidate state until Phase 6 physical runs pass.

The native bridge now also has an explicitly armed endpoint-clock discipline prototype in `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_CLOCK_DISCIPLINE_PROTOTYPE.md`. Its bounded development lab opens two selected non-virtual WASAPI render endpoints only long enough to sample `IAudioClock` against QPC while queueing silence, then reports a follower-only correction model capped at +/-300 ppm and 20 ppm per observation. The reusable float PCM resampler shares those bounds. It renders no Pixelody source audio, changes no routing or saved rig/calibration values, and reports `degraded` rather than `active` even when both clocks are observed. Runtime correction remains intentionally separate from saved acoustic alignment; the next calibration task merges it into sanitized grouped diagnostics.

Native mixer status is now reduced through one path-hidden renderer contract and merged into the grouped rig snapshot, grouped calibration report, active speaker-system diagnostics, and therefore the J.A.M. audio-profile snapshot. Its `runtimeClock` evidence is transient only: leader/follower rate estimates, ppm correction, ratio, buffer-fill error, and clamp state can appear in diagnostics after an explicit development lab, but cannot update a member's saved `delayMs` or calibration receipt. Missing, unsigned, incompatible, and bounded-lab-only components remain visible as native availability states without disturbing normal primary playback or the browser fan-out prototype.

The final calibration Phase C item has a paired hardware evidence ledger at `docs/audio/multi-output/MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md`. It requires actual 30-minute wired+wired and wired+Bluetooth checkpoint records plus path-hidden diagnostics before a release-quality synchronization statement can be considered. The ledger currently records no completed physical runs, so the Phase C checkbox remains open and all grouped playback language stays experimental or prototype-only.

Phase 6 physical validation now starts with `docs/audio/multi-output/MULTI_OUTPUT_PHASE6_PHYSICAL_VALIDATION.md`. The first release-gate item requires a real 30-minute two-output hardware run, not just a documented workflow. The workflow, pass/fail criteria, data table, and run-summary template are documented, but the current result is pending and the roadmap checkbox must remain unchecked until a completed physical run is recorded.

Physical validation exposed two browser-prototype audibility bugs. First, secondary routes could report as routed without actually feeding the second speaker because a hidden secondary media element was captured after its effective output had been reduced to zero. The secondary path now uses `AudioContext.createMediaElementSource()` instead. That API reroutes the element into the Web Audio graph, so the element can remain at unity while the graph owns volume, EQ, spatial processing, limiting, and sink routing without a parallel direct output. Second, changing the secondary element's track source used to tear down that graph and then attempt to attach the same media element to a new `AudioContext`, which Web Audio rejects. Track changes now retain the element's original graph and change only its media source. The graph gain stays at zero until `AudioContext.setSinkId()` confirms the secondary endpoint, and diagnostics expose `captureGuard`, `captureSourceMuted`, and `directElementAudible` so silent or unsafe states remain visible. New rigs also start with the current Windows output as their first member instead of opening as an empty container. The Phase 6 checkbox remains unchecked until a real two-output run confirms both speakers are audible for the full 30 minutes.

The Audio Systems panel now has a Physical validation recorder for the remaining
hardware evidence. It starts only on an armed, actively playing, unique
two-output browser route; takes a sanitized sample every five seconds for 30
minutes; requires seven manual audible/issue checkpoints; aborts on a primary
route or track change; and copies bounded trend evidence with median, p95, MAD,
drift slope, correction rate, and repeat-run count. The data is deliberately
not treated as independent statistical samples and cannot change release
language or the Phase C/Phase 6 checkboxes automatically. Its exact collection
and privacy contract is in `docs/audio/multi-output/MULTI_OUTPUT_PHYSICAL_VALIDATION_RECORDER.md`.

The consumer calibration proposal is documented in `docs/audio/multi-output/MULTI_OUTPUT_CALIBRATION_DESIGN.md`. It separates relative level, acoustic arrival, bass/crossover integration, and long-term clock drift; defines microphone and by-ear workflows; identifies the current 1,024-sample envelope detector and separate test route as insufficient for precision alignment; and recommends a staged implementation beginning with a guided perceptual wizard before sample-level microphone correlation and native WASAPI clock discipline.

Calibration implementation now has its own ordered handoff in `docs/audio/multi-output/MULTI_OUTPUT_CALIBRATION_ROADMAP.md`. Its first completed task adds a normalized version-2 rig calibration receipt to every grouped-speaker rig. The receipt is bounded and backward-compatible, keeps operational member `gainDb`, `delayMs`, and `polarity` as the live source of truth, records listening position / physical setup / level / timing / bass / verification / environment / invalidation evidence, appears in the path-hidden grouped calibration report, and is covered by the existing rig persistence self-test. The next task is the user-facing `Calibrate rig` entry point and method selection; no calibration values are automatically changed by the receipt foundation alone.

The grouped-rig panel now includes a compact `Calibrate rig` entry point. It opens the choice between `Guided by ear` (recommended, no microphone) and `Measure with microphone` (measurement evidence followed by listening confirmation). The choice is stored as `calibration.workflow.method` with a selection timestamp, is retained across restart/backup through the existing rig store, and is intentionally non-destructive: it does not route audio, play tones, change member controls, or mark a rig calibrated. The next route-identification preflight owns those safety decisions.

Rig calibration now has a route-identification preflight before any matching stage can begin. Starting it refreshes browser-visible outputs and blocks the flow when there are fewer than two members, direct test-tone routing is unavailable, a member is missing, a member uses `System Default` fallback, saved routes duplicate, or resolved browser sinks duplicate. When the preflight is clean, it walks members one at a time: Pixelody sends a short, quiet direct signal to the resolved member sink, then enables that member's confirmation. A route cannot be confirmed before its own signal starts. The persisted `calibration.workflow.routeCheck` receipt records safe route identifiers, availability state, fallback state, per-member confirmation times, and block/cancel/pass state; it does not alter member EQ, trim, delay, polarity, or grouped playback. The next calibration task is listening-position and physical-control notes.

After route identification passes, the calibration entry unlocks a listening-position and hardware-notes form. The user names the seat and records each member's repeatable volume, bass, crossover, phase, and DSP positions (blank fields can remain unrecorded where hardware has no such control). Saving creates or retains a stable listening-position id, writes the notes only into the rig calibration receipt, and records `calibration.workflow.preparationCompletedAt`. These notes are deliberately metadata only: Pixelody never attempts to move physical knobs or infer their values from audio. The next calibration task is the guided by-ear relative-level staircase.

The guided-by-ear relative-level stage now runs after method selection, route confirmation, and preparation are complete. It currently targets exactly two confirmed rig members. Each trial plays band-limited pink noise through the two independently resolved sinks using hidden direct route elements; the user only hears `A` then `B` in a shuffled physical order and answers `A louder`, `B louder`, or `They are equal`. A louder response attenuates only that member's draft trim by 1 dB, then 0.5 dB after the first equal result. Two fine-step equal answers produce a candidate, but member `gainDb` values are not written until the listener explicitly accepts. Cancel or route failure discards the draft trims and resumes normal playback. The accepted receipt stores the normalized listening trials plus initial/applied member trims in `calibration.workflow.levelMatch`, while `calibration.level` records the by-ear method, 500-4000 Hz band, adjustment history, and medium confidence.

The guided-by-ear arrival stage follows an accepted relative-level match and likewise supports exactly two confirmed members. It emits three short band-limited pulses for blinded A and B timing candidates, with the physical routes held constant while only the second member's provisional non-negative delay varies. Listener choices choose the tighter candidate; the comparison step narrows from 5 ms to 0.5 ms after the first equal result, and two fine equal results unlock a final simultaneous pulse pass. Pixelody does not write a member `delayMs` during comparisons. Only after that final pass plays and the listener confirms it does the selected second member receive the chosen positive delay. The accepted receipt retains the anchor/target IDs, blinded trials, initial/applied delay, and final step in `calibration.workflow.arrivalMatch`; `calibration.timing` records the 300-6000 Hz by-ear evidence with medium confidence. Cancel and blocked routes discard the draft without altering live delay.

The optional bass/crossover stage now follows accepted arrival alignment for a two-member guided rig. It uses independently resolved direct routes to play shuffled low-band (default 50-120 Hz, adjustable from 30-240 Hz) A/B comparisons. First the listener selects the fuller, less hollow polarity candidate, then compares the selected polarity at the current positive delay versus a further 0.5 ms delay. Both choices remain drafts until explicit confirmation; confirmation writes the selected target member's polarity and non-negative delay, while `calibration.bassIntegration` and `workflow.bassIntegration` retain the band, trials, and initial/applied values. The panel is intentionally explicit that Pixelody cannot set hardware bass, crossover, phase, volume, or DSP controls: those physical settings must be recorded in preparation and kept fixed for the result to remain meaningful.

The closing music-verification stage now follows accepted level and arrival alignment (the bass stage remains optional). It starts familiar music and measures a full 60 seconds of active playback; pausing music pauses the timer. The listener records centered, leading, louder, hollow, boomy, or no-difference findings while Pixelody snapshots secondary-route stability and the change in browser correction count. A result is saved only after both the observation and a listener response: `Aligned and stable`, `Aligned; occasional correction`, `Alignment may drift`, or `Recalibration required`. Unsupported or unrouted browser fan-out is never presented as stable. A saved result unlocks a 15-second Quick re-check for reconnects or physical-control changes. Receipts are bounded in `calibration.verification` and `workflow.verification`, and neither full nor quick verification changes member tuning.

Every calibration entry path now takes a shared in-memory recovery snapshot before it can pause music, isolate a member, create hidden direct-output media, preview EQ, or change the primary output for per-member tuning. The snapshot covers primary track position, volume, mute, rate, route; member enable/mute/solo, gain, delay, polarity, EQ mode/profile binding; and the touched EQ/spatial profile contents. Cancel and calibration-signal errors dispose temporary media and restore that state. A user-requested output or track change aborts calibration first, restores calibration-owned state, then performs the requested change; a playback error restores state without trying to restart failed playback. Only explicit acceptance releases the snapshot and retains the intended trim, delay, polarity, or profile result.

Microphone calibration no longer uses the 1,024-frame `ScriptProcessor` envelope path. `src/mic-capture-worklet.js` now receives the selected microphone in an `AudioWorklet`, maintains a bounded raw-sample ring buffer, and returns an ordered transferable snapshot with render-frame timing after the chirp window. The current acoustic-pulse report still applies its existing threshold evidence to smaller analysis windows derived from those samples, but its reported sample resolution is one capture frame rather than a 1,024-frame callback. No legacy fallback is used: runtimes without AudioWorklet report that microphone capture is unavailable, preserving honesty until the native capability exists. Deterministic sequence correlation is the next Phase B stage.

## Open Questions

- Should a rig member be allowed to use a different `systemProfileId` than `deviceId` for profile sharing?
- Should per-member EQ mode be independent, or should it always follow the output profile's existing simple/advanced mode?
- Should solo be one-at-a-time or multi-solo?
- Should delay allow negative values by internally delaying every other output, or should the UI only allow positive delay per member?
- Should browser fan-out be exposed as an experimental user option or stay developer-only until native direction is decided?
- How should Bluetooth warning levels be detected: label heuristics, WASAPI form factor, measured drift, or all three?

## Manual Test Matrix

Use real hardware before updating release checkboxes:

- System Default only.
- Built-in speakers only.
- USB DAC only.
- HDMI/DisplayPort audio only.
- Bluetooth only.
- Built-in + USB DAC.
- USB DAC + HDMI.
- Wired + Bluetooth.
- Two USB outputs.
- Output unplug/replug while paused.
- Output unplug/replug while playing.
- Seek while grouped playback is active.
- Track change while grouped playback is active.
- App restart with saved rig.
- Backup export/import with saved rig.
