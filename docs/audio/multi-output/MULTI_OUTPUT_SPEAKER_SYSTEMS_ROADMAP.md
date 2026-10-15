# Multi-Output Speaker Systems Roadmap

This roadmap is for Pixelody's grouped speaker rig feature: one Pixelody playback state driving one or more Windows outputs, with independent tuning for each output.

Read with:

- `docs/audio/multi-output/MULTI_OUTPUT_SPEAKER_SYSTEMS_PLAN.md`
- `docs/audio/GLOBAL_SYSTEM_AUDIO_EQ_PLAN.md`
- `docs/audio/AUDIO_RELEASE_GATE.md`
- `docs/audio/multi-output/MULTI_OUTPUT_PHASE5_MEASUREMENT_LOG.md`
- `docs/audio/multi-output/MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md`
- `docs/audio/multi-output/MULTI_OUTPUT_NATIVE_STATUS_GATE.md`

## Current State

- Existing output tuning profiles are stored in `state.systems`.
- Existing stereo-image profiles are stored in `state.spatialProfiles`.
- The main player routes its processed Web Audio graph to one output through `AudioContext.setSinkId()` where supported.
- Speaker test tones can route to the selected output.
- Latency and microphone calibration foundations exist for the active output.
- Native WASAPI helper diagnostics and dev probes exist, but do not render processed audio.
- Grouped speaker rigs now persist in `pixelody.speakerSystems`.
- The Audio Systems view can create, rename, delete, select, and populate grouped rigs.
- Rig members can store role, enable, mute, solo, trim, delay, polarity, EQ mode, and profile binding.
- Rig diagnostics are included in local diagnostics and the J.A.M. server audio profile snapshot.

## Non-Negotiables

- Normal single-output playback must remain stable.
- Do not claim simultaneous multi-output playback is active until audio is actually rendered to more than one endpoint.
- Do not claim bit-perfect or native-quality sync from the browser prototype.
- Do not require drivers, services, registry edits, default-device changes, or admin prompts for normal playback.
- Unavailable outputs must fail closed and leave single-output playback usable.
- Bluetooth and wireless endpoints must show conservative sync warnings.
- Mini-player, media keys, queue, shuffle, repeat, and restore must still control one shared playback state.

## Phase 1: Rig Model And Control Surface

- [x] Persist `pixelody.speakerSystems`.
- [x] Persist `pixelody.activeSpeakerSystemId`.
- [x] Add grouped speaker rig panel in Audio Systems.
- [x] Add create, rename, delete, and select controls.
- [x] Add current output as a rig member.
- [x] Add per-member role, enable, mute, solo, trim, delay, and polarity controls.
- [x] Add `Route + tune` action for editing an individual member's existing output profile.
- [x] Include rigs in tuning profile export/import.
- [x] Include rigs in full backup export/import.
- [x] Include active rig diagnostics in runtime diagnostics.
- [x] Include active rig metadata in the local J.A.M. server snapshot.
- [x] Add reorder controls for rig members.
- [x] Add duplicate member protection that also handles changed browser device IDs.
- [x] Add unavailable-member status after output refresh.
- [x] Add a clear warning when a user only has one Windows output endpoint.
- [x] Add per-member calibration assignment from latest software/mic reports.

## Phase 2: Browser Multi-Sink Prototype

Goal: prove that Pixelody can play one track to two Windows outputs at the same time using Electron/browser primitives before investing in a native mixer.

- [x] Add a guarded experimental feature flag, disabled by default.
- [x] Create hidden secondary media elements for non-primary rig members.
- [x] Route each secondary element with `setSinkId()`.
- [x] Keep all elements on one shared playback command model.
- [x] Mirror source URL, current time, playback rate, volume base, pause, play, seek, ended, and error state.
- [x] Apply per-member gain trim.
- [x] Apply per-member mute and solo.
- [x] Apply per-member delay offset.
- [x] Apply per-member polarity flip if feasible in Web Audio.
- [x] Apply per-member EQ, track ReplayGain, bound balance/mono profile, headroom, and protective limiting by building one audio graph per secondary output.
- [x] Add drift monitor comparing primary and secondary media clocks.
- [x] Add correction for large drift with seek nudges or playback-rate nudges.
- [x] Add visible route stability state: stable, correcting, unstable, unsupported.
- [x] Add a hard max member count for the prototype, probably 2 outputs first.
- [x] Pause or tear down secondary outputs on track unload, app close, route change, or feature disable.
- [x] Prevent doubled playback when a secondary route falls back to the same output as the primary.

## Phase 3: Rig-Aware Calibration

- [x] Add "Calibrate member" action on each rig member.
- [x] Mute all other rig members during member calibration.
- [x] Route test tones and chirps to the selected member.
- [x] Store software latency report against the member.
- [x] Store microphone acoustic report against the member.
- [x] Suggest delay offsets relative to the earliest or selected anchor output.
- [x] Show calibration confidence per member.
- [x] Show room/acoustic caveats in the rig panel.
- [x] Add manual nudge controls for delay by ear.
- [x] Add polarity-check tone flow.
- [x] Add copyable grouped calibration report.

## Phase 4: Diagnostics And Recovery

- [x] Add grouped rig diagnostics snapshot with each member's route, sink support, profile id, trim, delay, mute/solo state, and calibration confidence.
- [x] Detect unavailable outputs after `devicechange`.
- [x] Show duplicate-route risk when two members resolve to the same sink.
- [x] Show drift and correction history during browser multi-sink playback.
- [x] Show decode/load errors per secondary element.
- [x] Add a "disable grouped playback and return to primary output" recovery button.
- [x] Keep rig diagnostics path-hidden and safe for sharing.
- [x] Add debug self-test for rig persistence and snapshot sanitation.

## Phase 5: Native WASAPI Mixer Decision

The browser prototype is useful, but release-quality multi-output may require a native Windows mixer.

- [x] Compare browser prototype drift after 30 minutes on wired + wired. Measurement workflow/log is documented; physical pass/fail result is still required before Phase 6 release claims.
- [x] Compare browser prototype drift after 30 minutes on wired + Bluetooth. Measurement workflow/log is documented with Bluetooth-specific caveats; physical pass/fail result is still required before Phase 6 release claims.
- [x] Compare browser prototype CPU and decode overhead on FLAC/WAV/MP3. Measurement workflow/log is documented; real baseline-versus-prototype results are still required before browser fan-out decisions.
- [x] Decide whether browser fan-out is acceptable as experimental only. Decision record keeps browser fan-out experimental-only unless future hardware measurements justify a narrower release claim.
- [x] Define native mixer contract if required. Contract document now defines native bridge ownership, route states, command/status schemas, DSP/timing rules, and safety gates.
- [x] Keep native mixer optional, signed, uninstallable, and non-invasive. Safety policy now defines release trust, uninstall, non-invasive scope, diagnostics, dev overrides, and recovery gates.
- [x] Reuse rig member model as native mixer input. Native input mapping now derives `configureRig` from the normalized saved rig/member model instead of introducing a second native rig store.
- [x] Reuse output profiles, spatial profiles, calibration, and diagnostics. Native reuse mapping now derives bridge tuning/spatial/calibration/diagnostic payloads from existing Pixelody profile and rig diagnostics sources.
- [x] Add native status states before enabling any release claim. Native status gate now defines blocking, degraded, recovery, active-proof, and release-claim states for future native grouped playback.

## Phase 6: Release Gate

Do not mark multi-output speaker systems release-ready until all of these pass:

- [ ] Two physical outputs can play the same track without obvious drift for at least 30 minutes.
- [ ] Per-output EQ is audibly and diagnostically independent.
- [ ] Per-output gain trim is audibly and diagnostically independent.
- [ ] Per-output delay offsets persist and survive restart.
- [ ] Unavailable outputs fail closed without stopping normal playback.
- [ ] Bluetooth routes show conservative warnings.
- [ ] Mini-player controls still affect one shared playback state.
- [ ] Media keys still affect one shared playback state.
- [ ] Queue, shuffle, repeat, seek, restore, and ended behavior stay correct.
- [ ] Import, playlists, metadata, artwork, settings, J.A.M., and themes are not regressed.
- [ ] `npm run check` passes.
- [ ] `npm run check:themes` passes.
- [ ] Physical matrix has been manually tested and recorded.
