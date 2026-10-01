# Multi-Output Phase C Hardware Run Log

Status: pending real hardware evidence

This is the evidence ledger for the final Multi-output Calibration Phase C item:

```text
Complete the physical wired and Bluetooth validation matrix before making any release-quality synchronization claim.
```

Use the detailed procedure in `MULTI_OUTPUT_PHASE5_MEASUREMENT_LOG.md` and the
release-gate requirements in `MULTI_OUTPUT_PHASE6_PHYSICAL_VALIDATION.md`.
For scheduled, path-hidden runtime collection, use the in-app recorder described
in `MULTI_OUTPUT_PHYSICAL_VALIDATION_RECORDER.md`, then copy its evidence into
the appropriate run record below. The recorder is evidence collection only; a
human must still enter the real endpoint identity and audible observations.
This file records only completed physical runs. Do not enter estimated values,
synthetic diagnostics, or results copied from another hardware configuration.

## Matrix Status

| Run | Required engine/status | Current evidence | Decision |
| --- | --- | --- | --- |
| Wired + wired, 30 minutes | Two real wired endpoints; both audible throughout | No completed run recorded | Pending |
| Wired + Bluetooth, 30 minutes | One wired and one Bluetooth endpoint; route behavior recorded throughout | No completed run recorded | Pending |

The Phase C roadmap checkbox remains unchecked until both rows have a real,
date-stamped result below. A Bluetooth failure may be a valid completed matrix
result, but it keeps Bluetooth grouped playback explicitly degraded or
experimental and blocks any broad all-route synchronization claim.

## Evidence Rules

For each run, retain these artifacts outside the repository or attach them to
the task in a path-hidden form:

1. Grouped-rig diagnostics from before start, around 15 minutes, at 30 minutes,
   and after stop/recovery.
2. The calibration report when it contains relevant drift, route, or tuning
   facts.
3. The completed checkpoint table below, including audible observations.
4. A short summary with the actual endpoint types, engine, source format, and
   final decision.

Do not include raw music paths, library directories, artwork paths, or raw
Windows endpoint IDs. Endpoint labels/types and the sanitized diagnostics
privacy marker are enough to reproduce the route safely.

## Run 1: Wired + Wired

### Identity

```text
Date:
Operator:
Pixelody build/thread:
Windows version:
Engine: experimental browser prototype / native mixer
Primary endpoint label and type:
Secondary endpoint label and type:
Rig name:
Track/source format:
Prototype/native state at start:
Rig self-test passed before run: yes/no
Diagnostics path-hidden before run: yes/no
```

### Checkpoints

| Time | Both audible | Stability | Worst drift ms | Total corrections | Seek corrections | Rate nudges | Audible result | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| T+00:01 |  |  |  |  |  |  |  |  |
| T+05:00 |  |  |  |  |  |  |  |  |
| T+10:00 |  |  |  |  |  |  |  |  |
| T+15:00 |  |  |  |  |  |  | diagnostics copied |  |
| T+20:00 |  |  |  |  |  |  |  |  |
| T+25:00 |  |  |  |  |  |  |  |  |
| T+30:00 |  |  |  |  |  |  | diagnostics copied |  |

### Result

```text
Both outputs audible through T+30: yes/no
Route failures or fallback:
Decode/load errors:
Recovery used before T+30: yes/no
Recovery worked after run: yes/no
Audible verdict:
Decision: pass / fail / retry required
Evidence references:
```

## Run 2: Wired + Bluetooth

### Identity

```text
Date:
Operator:
Pixelody build/thread:
Windows version:
Engine: experimental browser prototype / native mixer
Primary wired endpoint label and type:
Bluetooth endpoint label/type/model:
Bluetooth codec or mode if known:
Rig name:
Track/source format:
Prototype/native state at start:
Bluetooth caveat visible before run: yes/no
Rig self-test passed before run: yes/no
Diagnostics path-hidden before run: yes/no
```

### Checkpoints

| Time | Both audible | Stability | Worst drift ms | Total corrections | Seek corrections | Rate nudges | Bluetooth events | Audible result | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| T+00:01 |  |  |  |  |  |  |  |  |  |
| T+05:00 |  |  |  |  |  |  |  |  |  |
| T+10:00 |  |  |  |  |  |  |  |  |  |
| T+15:00 |  |  |  |  |  |  | diagnostics copied |  |  |
| T+20:00 |  |  |  |  |  |  |  |  |  |
| T+25:00 |  |  |  |  |  |  |  |  |  |
| T+30:00 |  |  |  |  |  |  | diagnostics copied |  |  |

### Result

```text
Both outputs audible through T+30: yes/no
Bluetooth glitches/reconnects/mode switches:
Route failures or fallback:
Decode/load errors:
Recovery used before T+30: yes/no
Recovery worked after run: yes/no
Audible verdict:
Decision: pass / borderline / fail / retry required
Allowed product language after this result:
Evidence references:
```

## Phase C Decision Record

Fill this only after both real run results above are complete.

```text
Wired + wired decision:
Wired + Bluetooth decision:
Can Pixelody claim release-quality synchronization for the tested wired route: yes/no
Can Pixelody claim release-quality synchronization for Bluetooth routes: yes/no
Required caveats or recovery changes:
Calibration roadmap checkbox updated: yes/no
Reviewed by:
Reviewed at:
```

Current decision: pending. No release-quality synchronization claim is allowed.

## Evidence Audit

Reviewed: 2026-07-20

The wired+wired and wired+Bluetooth identity blocks, checkpoint tables, result
summaries, and decision record are still blank. No path-hidden diagnostic
artifacts or completed 30-minute hardware observations were available in this
workspace for review. This is an evidence limitation, not a failed audio run:
the matrix remains pending until an operator records real observations.

Release-language decision after this audit: Pixelody may describe grouped
browser playback as an experimental prototype only. It must not claim
release-quality synchronization for wired or Bluetooth routes.
