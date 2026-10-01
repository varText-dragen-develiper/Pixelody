const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const renderer = read('src/renderer.js');
const audioDomain = read('src/renderer-domains/audio-controller.js');
const calibrationWorker = read('src/calibration-analysis-worker.js');
const index = read('src/index.html');
const main = read('src/main.js');
const preload = read('src/preload.js');
const mini = read('src/mini-player.js');
const micCaptureWorklet = read('src/mic-capture-worklet.js');
const nativeHelper = read('native/windows-wasapi-helper/Program.cs');
const nativeBridge = read('native/windows-system-audio-bridge/Program.cs');
const nativeBridgeInterop = read('native/windows-system-audio-bridge/AudioInterop.cs');
const nativeClockDiscipline = read('native/windows-system-audio-bridge/ClockDiscipline.cs');
const nativeWasapiBridge = read('src/native-wasapi-helper.js');
const releaseGate = read('docs/audio/AUDIO_RELEASE_GATE.md');
const errors = [];

function requireText(source, text, label) {
  if (!source.includes(text)) errors.push(`${label}: missing ${JSON.stringify(text)}`);
}

function rejectText(source, text, label) {
  if (source.includes(text)) errors.push(`${label}: forbidden ${JSON.stringify(text)}`);
}

const primaryAudioTags = index.match(/<audio\b/gi) || [];
if (primaryAudioTags.length !== 1) errors.push(`primary playback: expected one HTML audio element, found ${primaryAudioTags.length}`);

requireText(renderer, 'audioDomain.buildAudioGraph(state.context, audio, bands, parametricDefaultBands())', 'primary playback graph composition');
requireText(audioDomain, 'context.createMediaElementSource(mediaElement)', 'primary playback graph');
requireText(audioDomain, 'limiter.connect(context.destination)', 'primary playback graph');
requireText(renderer, 'PRIMARY_MEDIA_ELEMENT_DIRECT_OUTPUT', 'primary playback audibility guard');
requireText(renderer, 'await audio.setSinkId(targetId)', 'output switching');
requireText(renderer, 'await audio.setSinkId(outputState.activeId || \'\')', 'primary playback routing');
requireText(renderer, 'await state.context.setSinkId(targetId)', 'processed sink routing');
requireText(renderer, "await refreshOutputs({ requestLabels: false })", 'non-invasive startup output scan');
requireText(renderer, 'audio.muted = false', 'primary playback audibility');
requireText(renderer, "primaryPath: PRIMARY_MEDIA_ELEMENT_DIRECT_OUTPUT ? 'single-media-element-direct-output' : 'single-media-element-web-audio'", 'diagnostics truth');
rejectText(renderer, 'FORCE_DIRECT_PRIMARY_PLAYBACK', 'primary playback bypass');
rejectText(renderer, 'nativePrimaryAudio', 'parallel primary clock');
rejectText(renderer, 'audio.muted = true', 'primary graph input');

requireText(renderer, "issueSharedPlaybackCommand('play'", 'shared playback command model');
requireText(renderer, "issueSharedPlaybackCommand('pause'", 'shared playback command model');
requireText(renderer, "issueSharedPlaybackCommand('seek'", 'shared playback command model');
requireText(renderer, 'audio.onended =', 'natural advance');
requireText(renderer, 'navigator.mediaSession.setActionHandler', 'media keys');
requireText(preload, 'onPlayerCommand', 'mini-player command bridge');
requireText(mini, 'sendMiniCommand', 'mini-player controls');
requireText(mini, "outputId: state.outputId || ''", 'mini-player sound routing');

requireText(renderer, 'optionalFiniteNumber(currentTrack()?.replayGainDb)', 'ReplayGain application');
requireText(main, 'metadata.common.replaygain_track_gain', 'ReplayGain metadata');
requireText(audioDomain, 'configureProtectiveLimiter(context.createDynamicsCompressor())', 'protective limiter');
requireText(audioDomain, 'node.threshold.value = -1', 'protective limiter');
requireText(renderer, 'EQ_HEADROOM_MARGIN_DB', 'EQ headroom');
requireText(renderer, 'activeSpatialProfile()', 'spatial processing');
requireText(renderer, 'createMicCaptureRingBuffer', 'microphone capture ring buffer');
requireText(renderer, 'audioWorklet.addModule', 'microphone capture worklet loading');
requireText(renderer, "new AudioWorkletNode(context, 'pixelody-mic-capture'", 'microphone capture worklet node');
requireText(audioDomain, 'calibrationInput.connect(eqNodes[0])', 'primary calibration music-graph injection');
requireText(renderer, 'calibrationInput.connect(eqNodes[0])', 'secondary calibration music-graph injection');
requireText(renderer, 'resolveMicCalibrationMusicGraphRoute', 'microphone measurement music-graph route resolution');
requireText(renderer, 'createDeterministicBroadbandCalibrationBuffer', 'deterministic microphone measurement stimulus');
requireText(renderer, 'analyzeMicCalibrationInWorker', 'off-main-thread microphone analysis');
requireText(renderer, "new Worker('calibration-analysis-worker.js')", 'microphone analysis worker');
requireText(calibrationWorker, "importScripts('calibration-dsp.js')", 'worker loads shared calibration DSP');
requireText(calibrationWorker, 'dsp.deconvolve', 'worker deconvolution');
requireText(calibrationWorker, 'dsp.measureMember', 'worker first-arrival measurement');
requireText(renderer, 'deconvolution-first-arrival-with-gated-direct-sound', 'microphone first-arrival report evidence');
requireText(renderer, 'reflectionDominantTrials', 'microphone placement-confidence evidence');
requireText(renderer, 'analysisWorker: true', 'microphone report worker truth');
rejectText(renderer, 'correlateMicCalibrationTrial', 'legacy peak-picking microphone correlator');
rejectText(renderer, 'resampleCalibrationSequenceForCapture', 'legacy linear microphone resampling');
requireText(renderer, "const order = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A']", 'microphone A-B-B-A repeatability trials');
requireText(renderer, 'microphoneProcessingSettings', 'microphone processing capture');
requireText(renderer, 'residualVerification', 'microphone repeatability residual verification');
requireText(renderer, 'clippedFrames', 'microphone clipping detection');
requireText(renderer, 'normalizeRigCalibrationMicrophoneEvidence', 'rig microphone evidence persistence');
requireText(renderer, 'attachMicrophoneEvidenceToRigCalibration', 'rig microphone evidence attachment');
requireText(renderer, 'beforeListenerChoices', 'listener-choice preservation guard');
requireText(renderer, 'microphone-evidence-preserves-listening-choice', 'rig microphone evidence self-test');
requireText(renderer, "method: 'microphone-acoustic-worklet-exponential-sweep-first-arrival'", 'microphone measurement report truth');
requireText(renderer, 'musicGraph: true', 'microphone measurement route proof');
rejectText(renderer, 'createScriptProcessor', 'microphone capture legacy block processor');
rejectText(renderer, 'onaudioprocess', 'microphone capture legacy block processor');
rejectText(renderer, "method: 'microphone-acoustic-worklet-pulse'", 'legacy microphone chirp report');
rejectText(renderer, 'gain.connect(calibrationDestination)', 'microphone direct-output calibration bypass');
rejectText(renderer, 'detectMicPulseReturns', 'legacy microphone threshold detection');
requireText(micCaptureWorklet, "registerProcessor('pixelody-mic-capture'", 'microphone capture worklet registration');
requireText(micCaptureWorklet, 'postSnapshot', 'microphone capture ring buffer snapshot');

requireText(renderer, 'BROWSER_MULTI_SINK_PROTOTYPE_MAX_OUTPUTS = 2', 'multi-output guard');
requireText(renderer, 'markSecondaryGraphUnsupported', 'secondary fail-closed path');
requireText(renderer, 'secondaryRouteMatchesPrimarySink', 'duplicate-route protection');
requireText(renderer, 'context.createMediaElementSource(entry.element)', 'secondary audible graph source');
requireText(renderer, "captureGuard = 'media-element-source-reroute'", 'secondary direct-output suppression');
requireText(renderer, 'entry.element.volume = 1', 'secondary graph input audibility');
requireText(renderer, 'gain.gain.value = 0', 'secondary route-before-audio safety');
rejectText(renderer, 'entry.element.captureStream', 'secondary captured zero-volume path');
rejectText(renderer, 'entry.element.mozCaptureStream', 'secondary captured zero-volume path');
rejectText(renderer, "if (entry.element.src !== source) {\n      resetSecondarySpeakerOutputElement(entry);", 'secondary graph survives track changes');
requireText(renderer, 'const currentIsRigMember = audibleMembers.some', 'primary rig membership guard');
requireText(renderer, 'outputs: [{', 'new rig starts with current output');
requireText(renderer, 'entry.replayGainScalar || 1', 'secondary ReplayGain parity');
requireText(renderer, 'spatialNodes.merger.connect(limiter)', 'secondary spatial and limiter path');
requireText(renderer, "payload.src = payload.src ? '[local-media-source]'", 'audio diagnostics redaction');
requireText(renderer, "sourceTrackId: '[local-track]'", 'calibration diagnostics redaction');
requireText(renderer, 'const simultaneousActive = featureFlag.armed', 'grouped playback truth state');
requireText(renderer, 'SPEAKER_RIG_VALIDATION_SAMPLE_INTERVAL_MS = 5000', 'physical validation sampling cadence');
requireText(renderer, 'speakerRigValidationAnalysis', 'physical validation statistics');
requireText(renderer, 'physical-validation-recorder-analysis', 'physical validation recorder self-test');
requireText(renderer, 'rawEndpointIdsStored: false', 'physical validation privacy guard');
requireText(index, 'id="startSpeakerRigValidation"', 'physical validation recorder entry point');

requireText(nativeHelper, 'Pixelody Virtual Output', 'virtual endpoint contract');
requireText(nativeHelper, 'Pixelody Virtual Monitor', 'virtual endpoint contract');
requireText(nativeHelper, 'SystemAudioRouteState.BridgeMissing', 'native virtual bridge-missing route state');
requireText(renderer, "'bridge-missing'", 'renderer bridge-missing route state');
requireText(renderer, 'SYSTEM_AUDIO_ROUTE_STATES', 'renderer system audio route-state contract');
requireText(nativeBridge, 'audioEngineImplemented = false', 'bridge stub truth');
requireText(nativeBridge, '--dev-allow-pass-through', 'dev pass-through gate');
requireText(nativeBridge, '--dev-allow-virtual-route', 'virtual-route dev gate');
requireText(nativeBridge, 'VirtualRouteLab.Run', 'virtual-route bridge integration command');
requireText(nativeBridge, 'ListActiveCaptureEndpoints', 'virtual-monitor capture enumeration');
requireText(nativeBridge, 'GetCaptureEndpoint', 'virtual-monitor capture activation');
requireText(nativeBridge, 'AudioClientStreamFlags.NoPersist', 'shared virtual-monitor capture mode');
requireText(nativeBridge, 'RouteState.RealOutputMissing', 'explicit real-output requirement');
requireText(nativeBridge, 'Exactly one active Pixelody Virtual Output render endpoint and one active Pixelody Virtual Monitor capture endpoint', 'virtual endpoint uniqueness guard');
requireText(nativeBridge, 'Virtual-output loops are blocked', 'virtual-output loop guard');
requireText(nativeBridge, 'Capture and render endpoint IDs are identical', 'same-endpoint pass-through block');
requireText(nativeBridge, 'FormatsMatch', 'format-mismatch pass-through block');
requireText(nativeBridge, 'inputFrames > 0 && outputFrames > 0', 'pass-through active-route proof');
requireText(nativeBridge, 'captureWaits', 'pass-through capture wait metric');
requireText(nativeBridgeInterop, '0BD7A1BE-7A1A-44DB-8397-CC5392387B5E', 'correct IMMDeviceCollection interface id');
requireText(nativeBridgeInterop, 'CD63314F-3FBA-4A1B-812C-EF96358728E7', 'WASAPI endpoint-clock interface id');
requireText(nativeBridge, 'clock-discipline-lab', 'endpoint-clock monitoring command');
requireText(nativeBridge, '--dev-allow-clock-discipline', 'endpoint-clock monitoring gate');
requireText(nativeBridge, 'ClockDisciplineLab.Run', 'endpoint-clock monitoring integration');
requireText(nativeBridge, 'sourceAudioRendered = false', 'endpoint-clock prototype truth');
requireText(nativeClockDiscipline, 'MaximumCorrectionPpm = 300d', 'bounded follower correction');
requireText(nativeClockDiscipline, 'MaximumSlewPpmPerUpdate = 20d', 'bounded follower correction slew');
requireText(nativeClockDiscipline, 'BoundedAsyncResampler', 'follower asynchronous resampler');
requireText(nativeWasapiBridge, 'getNativeMixerStatus', 'native mixer status bridge');
requireText(nativeWasapiBridge, 'runtimeClock', 'native mixer runtime clock status');
requireText(nativeWasapiBridge, 'calibrationSeparate: true', 'native clock/calibration separation');
requireText(main, "'app:native-mixer-status'", 'native mixer status IPC');
requireText(preload, 'getNativeMixerStatus', 'native mixer status preload API');
requireText(renderer, 'normalizeNativeMixerStatus', 'native mixer diagnostics reducer');
requireText(renderer, 'native-clock-runtime-separate', 'native clock/acoustic alignment self-test');
requireText(renderer, 'nativeMixer,', 'native mixer diagnostics merge');
requireText(nativeHelper, 'rendered = false', 'native capture-only truth');
requireText(releaseGate, 'Physical output matrix must be manually verified', 'manual release gate');

if (errors.length) {
  console.error(`Audio audit failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Audio audit passed: the primary processed path, shared controls, safety stages, multi-output guards, and native-route truth markers are wired.');
