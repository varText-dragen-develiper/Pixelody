# Speaker rigs: recorded progress

The recorded work established saved rigs, Audio Systems controls, the browser
prototype, calibration and diagnostics. Saved rigs use
`pixelody.speakerSystems` and `pixelody.activeSpeakerSystemId`; tuning and
stereo-image profiles stay in `state.systems` and `state.spatialProfiles`.
The controls included create, rename, delete, reorder and `Route + tune`, with
per-member settings carried through profile exports and full backups.

The browser prototype was kept off by default and limited to two outputs. It
mirrored playback commands to secondary media elements, applied each member's
tuning and reported drift, correction and route failures. Calibration could
isolate a member, attach software or microphone results and suggest delays.
The recovery action returned playback to the primary output.

The native-mixer work in this roadmap established contracts and mappings for
the same rig and profile data. That avoided having a separate native store with
different settings to keep in step. It also defined which status would count as
active playback and which conditions should block it. Defining that contract
didn't prove that a native bridge was rendering processed music.

The open part was physical validation. The older Phase 5 checklist marked the
measurement workflows and design documents complete, but the wired/wired and
wired/Bluetooth 30-minute results and FLAC/WAV/MP3 overhead comparisons were
still required. Those marks should not be read as hardware passes.

Before calling the feature ready, the checks still needed to cover independent
EQ and trim, saved delays, unplug/replug and route recovery, plus seek, repeat,
shuffle, queue edits, restart, mini-player and media-key behavior. Imports,
playlists, metadata, artwork, settings, J.A.M. and themes also had to keep
working. Normal playback shouldn't require a driver, service, registry change,
default-device change or administrator prompt just because grouped playback
exists.

For the feature itself, start with [the speaker-rig notes](MULTI_OUTPUT_SPEAKER_SYSTEMS_PLAN.md). The
[measurement log](MULTI_OUTPUT_PHASE5_MEASUREMENT_LOG.md),
[browser decision](MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md) and
[native mixer contract](MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md) keep the more
specific integration details and recorded validation limits.
