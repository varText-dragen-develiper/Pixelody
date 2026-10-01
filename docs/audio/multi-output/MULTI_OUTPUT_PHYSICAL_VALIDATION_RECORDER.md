# Multi-Output Physical Validation Recorder

## Purpose

The Audio Systems panel now includes a local `Physical validation` recorder for
the final Phase C and Phase 6 hardware work. It captures evidence while a real
two-output rig plays for 30 minutes; it does not simulate speakers, infer that
both speakers are audible, or change product-release language.

## Start Conditions

The recorder starts only when all of these are true:

1. A grouped rig is selected and the experimental browser multi-sink prototype
   is armed.
2. A real track is actively playing.
3. At least one secondary element is routed with no blocked secondary route or
   duplicate-primary route risk.

Changing the primary output or track stops the run as incomplete. This avoids
mixing two routes or two sources into one measurement record.

## Collection Subroutines

The recorder samples every five seconds for 30 minutes, for roughly 361
scheduled observations including the start sample. Each sample is bounded and
path-hidden and includes:

- playback, prototype-arm, route-ready, stability, and secondary route counts;
- worst browser clock drift and cumulative correction / seek / rate-nudge
  counters;
- blocked-route and secondary media-error counts.

At T+01, T+05, T+10, T+15, T+20, T+25, and T+30, the operator must record either
`Both audible` or `Report issue`. The final T+30 response is required before a
run can be finished. Five-second samples improve trend resolution over a few
manually copied snapshots, but adjacent samples share the same browser clocks;
they are not independent observations and must not be used to claim formal
statistical significance.

## Analysis

Finished evidence reports include coverage, listener checkpoint completion,
route-fault sample count, median drift, p95 drift, median absolute deviation
(MAD), maximum drift, least-squares drift slope in milliseconds per minute, and
the correction rate per ten minutes. The report also counts comparable completed
runs for the same rig and route category. Three completed runs are a useful
repeatability target, not a substitute for independent endpoint, room, and
listener validation.

The built-in speaker-rig self-test exercises the analyzer with a synthetic,
sanitized 30-minute fixture. That proves the recorder and privacy handling, not
the physical output behavior.

## Evidence Handling

`Copy evidence` produces a path-hidden JSON report suitable for attaching to a
task or transcribing into `MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md`. It excludes
local media paths and raw Windows endpoint IDs. Completed and interrupted runs
are stored locally in a bounded 12-run history; they are not exported through
the normal music library data.

No recorder result updates a roadmap checkbox automatically. The Phase C
physical-matrix checkbox can be changed only after a human reviews real wired
and Bluetooth hardware evidence against the pass criteria in the Phase 5 and
Phase 6 documents.
