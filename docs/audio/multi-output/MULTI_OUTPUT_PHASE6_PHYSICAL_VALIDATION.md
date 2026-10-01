# Multi-Output Phase 6 Physical Validation

This document records the release-gate workflow for proving that two physical outputs can play the same track without obvious drift for at least 30 minutes.

It is not a pass record by itself. The Phase 6 roadmap checkbox may be marked complete only after a real hardware run is completed and summarized here or in an attached run log.

The paired wired and Bluetooth evidence ledger for the Multi-output Calibration
Phase C gate is `MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md`. It starts pending and
must contain actual checkpoint observations before that calibration checkbox can
be checked.

## Scope

Roadmap item:

```text
Two physical outputs can play the same track without obvious drift for at least 30 minutes.
```

This gate can be tested with the current browser multi-sink prototype or a future native mixer route, but the result must say which engine was used.

## Required Setup

- Two real, independently addressable Windows output endpoints.
- One grouped speaker rig with exactly those two endpoints active.
- Both rig members enabled, unmuted, available, and not resolving to the same route.
- One local track, album, or playlist that can play for at least 35 minutes without source changes.
- Pixelody output refresh run immediately before the test.
- Grouped rig `Self-test` run immediately before the test.
- `Copy diagnostics` captured before playback starts.
- `Copy diagnostics` captured around 15 minutes.
- `Copy diagnostics` captured at 30 minutes before stopping.
- `Copy diagnostics` captured after stopping or recovery.

## Test Matrix For This Gate

At minimum, complete one wired + wired run before checking this gate.

Recommended order:

1. Wired + wired.
2. Wired + Bluetooth.
3. USB + HDMI or USB + built-in.
4. Native mixer route, when implemented.

Bluetooth can be documented as degraded or caveated, but a clean wired + wired run is the baseline for this release gate.

## Procedure

1. Open Audio Systems.
2. Refresh outputs.
3. Select the target grouped speaker rig.
4. Confirm both physical outputs are listed as separate endpoints.
5. Confirm both members are enabled, unmuted, available, and unique.
6. Confirm no duplicate-route, same-primary, unavailable-member, or unsupported-route warning is visible.
7. Set trim, delay, EQ, and polarity to the intended test values.
8. Start the selected grouped playback engine.
9. Start playback and wait 60 seconds.
10. At `T+00:01`, confirm both physical outputs are audible.
11. Start the 30-minute validation timer.
12. Do not seek, change tracks, change output selection, change rig membership, change Windows default output, or reconnect devices during the run.
13. Every 5 minutes, record stability, drift/correction status if available, and audible impression.
14. At `T+15:00`, copy grouped rig diagnostics.
15. At `T+30:00`, copy grouped rig diagnostics before stopping playback.
16. Stop playback or use the recovery control.
17. Copy grouped rig diagnostics again.

## Data Table

| Time | Engine | Both audible | Stability | Worst drift ms | Corrections | Audible result | Notes |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| T+00:01 |  | yes/no |  |  |  |  |  |
| T+05:00 |  | yes/no |  |  |  |  |  |
| T+10:00 |  | yes/no |  |  |  |  |  |
| T+15:00 |  | yes/no |  |  |  |  | diagnostics copied |
| T+20:00 |  | yes/no |  |  |  |  |  |
| T+25:00 |  | yes/no |  |  |  |  |  |
| T+30:00 |  | yes/no |  |  |  |  | diagnostics copied |

## Pass Criteria

This gate may pass only if all are true:

- Both physical outputs are audible at `T+00:01`.
- Both physical outputs remain audible through `T+30:00`.
- No obvious drift, echo, slapback, smeared vocals, smeared drums, or distracting comb-filter feel develops by ear.
- No output drops, reconnects, or silently falls back to the primary output.
- No duplicate-route, same-primary, unavailable-member, unsupported, unstable, or route-failed state appears.
- Recovery to normal primary-output playback works after the run.
- Diagnostics remain path-hidden.
- The run summary is recorded with date, engine, endpoints, track/source format, rig name, and verdict.

## Fail Criteria

This gate fails if any are true:

- Either output is inaudible at any required checkpoint.
- The route falls back to one physical output.
- Drift becomes obvious by ear.
- Repeated seek corrections or instability are needed.
- Bluetooth reconnects or switches mode during a Bluetooth run.
- The recovery button is needed before 30 minutes.
- Diagnostics expose private track paths or source paths.
- The run cannot be reproduced or lacks enough detail to identify hardware and engine.

## Required Run Summary

Fill this in after a real hardware run:

```text
Date:
Pixelody build/thread:
Windows version:
Engine: browser prototype / native mixer / other
Primary endpoint:
Secondary endpoint:
Endpoint types: wired+wired / wired+Bluetooth / other
Track/source format:
Rig name:
Prototype/native status at start:
Self-test passed before run: yes/no
Both outputs audible at T+00:01: yes/no
Both outputs audible at T+30: yes/no
Worst drift at T+30 if available:
Total corrections if available:
Seek corrections if available:
Rate nudges if available:
Decode/load errors:
Route failures:
Recovery used before T+30: yes/no
Recovery worked after run: yes/no
Diagnostics path-hidden: yes/no
Audible verdict:
Decision: pass / fail / retry required
Notes:
```

## Current Result

```text
Status: pending physical run
Decision: not passed
Reason: workflow is documented, but no completed 30-minute two-output hardware run has been recorded in this file.
```
