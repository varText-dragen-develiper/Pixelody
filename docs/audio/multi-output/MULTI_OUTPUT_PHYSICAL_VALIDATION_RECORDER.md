# Recording a physical rig test

Audio Systems has a local `Physical validation` recorder for thirty-minute Phase C/6 runs. It records route evidence while you listen; it can't determine whether both speakers are audible.

Start with an armed browser prototype, a real track playing and a routed secondary with no blocked/duplicate-primary risk. Changing the primary output or track ends the run as incomplete so one record doesn't mix sources or routes.

It takes a bounded path-hidden sample every five seconds, about 361 including the start: playback/arming/route/stability facts, secondary counts, worst clock drift, correction/seek/rate counters, blocked routes and media errors. At T+01, 05, 10, 15, 20, 25 and 30, choose `Both audible` or `Report issue`. The final response is required to finish.

The report calculates coverage, completed listening checkpoints, route faults, median/p95/MAD/max drift, drift slope in ms/minute and corrections per ten minutes. It also counts comparable completed runs. Three runs are a useful repeatability target, but adjacent samples share browser clocks and aren't independent statistical observations.

`Copy evidence` exports JSON for [the hardware ledger](MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md), excluding local media paths and raw endpoint IDs. Completed/interrupted runs remain in a bounded local history of twelve, outside normal library exports. The synthetic rig fixture checks analysis and sanitation, not physical sound.

A person still needs to review actual wired and Bluetooth results against the Phase 5/6 criteria. The recorder never updates release wording or roadmap completion automatically.
