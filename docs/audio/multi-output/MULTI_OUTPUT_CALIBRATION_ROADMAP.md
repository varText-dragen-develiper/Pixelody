# Calibration: recorded progress

The guided workflow, microphone analysis and native clock lab have different completion limits. Saved tuning remains in member `gainDb`, positive `delayMs`, polarity, EQ and spatial profiles; receipts record why a setting was chosen.

## Guided listening

The recorded implementation includes a bounded version-2 rig receipt, method selection, route identification, seat and physical-control notes, level/arrival matching, optional bass comparison, music verification and quick re-check. Selecting a method doesn't change playback or tuning. Each route needs its own quiet signal and confirmation; unavailable, duplicate and fallback routes block progress.

The two-member by-ear path compares randomized pink-noise level trials, attenuating by 1 dB then 0.5 dB. Arrival comparisons use blinded positive-delay candidates, narrowing from 5 ms to 0.5 ms and requiring a final simultaneous pass. Bass comparisons use polarity and 0.5 ms delay candidates, with a default 50–120 Hz band adjustable from 30–240 Hz. Draft controls are saved only after confirmation; physical knobs stay manual.

Music verification counts 60 seconds of active playback and a listener response, alongside route stability and correction counts. It reports stable/correcting/may-drift/recalibration-required and unlocks a 15-second quick check after a saved result. Full and quick verification don't change tuning.

Every calibration entry captures recovery state before temporary media, routing or isolation. Cancel, error, route change and track change restore playback, member controls and touched profiles; a requested change proceeds after that restoration. Accepted results release the snapshot without undoing the accepted adjustment.

## Microphone analysis

AudioWorklet capture replaced the old 1,024-frame ScriptProcessor path. It returns bounded raw samples with render-frame metadata and fails clearly when unavailable. Seeded broadband stimuli use the confirmed member music graph, including EQ, trim, spatial processing, limiter and sink; only playback delay is temporarily bypassed.

The initial coded correlation was then replaced by exponential-sweep deconvolution and first-arrival detection so a louder reflection wouldn't automatically become the timing result. Two A-B-B-A cycles retain median, MAD/spread, order bias and residual verification. Clipping, low SNR, poor sidelobe separation and reflection-dominant placement are rejected. Requested/reported mic processing and Worker analysis remain visible.

Versioned `microphoneEvidence` attaches only when method, route confirmation, member identity and music-graph proof agree, without changing listener-confirmed receipt fields. The rig panel and sanitized report expose it.

The physical gate remains open: repeated two-speaker delay within 0.5 ms, refusal of reflection-dominant placement, intentionally inverted polarity, negotiated capture/time-base mapping, endpoint latency and Worker wall time. Synthetic/static checks don't establish those results.

## Native clock work

The development bridge samples two explicit WASAPI endpoints against QPC using silence. Its 96-sample model and follower resampler are limited to ±300 ppm and 20 ppm change per observation. It doesn't render music or change saved calibration.

One path-hidden reducer merges availability and transient `runtimeClock` into existing rig/report/J.A.M. diagnostics. Tests keep ppm/ratio/fill facts separate from saved delay and receipts. Missing, unsigned, incompatible or lab-only components remain non-playing statuses.

Wired and Bluetooth long-run validation is still pending in [the hardware ledger](MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md). Never send a signal to an unconfirmed route or describe these checkpoints as perfect synchronization, absolute SPL, full-room correction or sample locking.
