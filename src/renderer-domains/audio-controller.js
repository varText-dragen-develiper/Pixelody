(function pixelodyAudioControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyAudioController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAudioControllerApi() {
  'use strict';
  function clampNumber(value, minimum, maximum, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback; }
  function optionalFiniteNumber(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
  function decibelsToGain(value) { return 10 ** (Number(value || 0) / 20); }
  function gainToDecibels(value) { const gain = Number(value); return gain > 0 ? 20 * Math.log10(gain) : -Infinity; }
  function normalizeParametricBand(value = {}, fallbackFrequency = 1000, index = 0, limits = {}) {
    return {
      id: String(value.id || `p${index + 1}`), enabled: value.enabled === true,
      frequency: clampNumber(value.frequency, limits.frequencyMin || 20, limits.frequencyMax || 20000, fallbackFrequency),
      q: clampNumber(value.q, limits.qMin || 0.1, limits.qMax || 12, 1),
      gain: clampNumber(value.gain, -(limits.gainLimit || 12), limits.gainLimit || 12, 0),
    };
  }
  function parametricDefaults(frequencies = [], count = frequencies.length) { return frequencies.slice(0, count).map((frequency, index) => ({ id: `p${index + 1}`, enabled: false, frequency, q: 1, gain: 0 })); }
  function normalizeParametricBands(values = [], options = {}) {
    const source = Array.isArray(values) ? values : [];
    return parametricDefaults(options.frequencies || [], options.count).map((fallback, index) => normalizeParametricBand(source[index], fallback.frequency, index, options));
  }
  function normalizeTuning(values = {}, bands = [], options = {}) {
    const original = values && typeof values === 'object' ? values : {};
    const normalized = { ...original };
    bands.forEach((band) => { normalized[band.id] = clampNumber(original[band.id], -(options.gainLimit || 12), options.gainLimit || 12, 0); });
    normalized.parametric = normalizeParametricBands(original.parametric, options);
    return normalized;
  }
  function makeFilter(context, band) { const node = context.createBiquadFilter(); node.type = band.type; node.frequency.value = band.frequency; node.Q.value = 0.7; return node; }
  function makeParametricFilters(context, defaults = []) { return defaults.map((band) => { const node = context.createBiquadFilter(); node.type = 'peaking'; node.frequency.value = band.frequency; node.Q.value = band.q; node.gain.value = 0; return node; }); }
  function configureProtectiveLimiter(node) { node.threshold.value = -1; node.knee.value = 0; node.ratio.value = 20; node.attack.value = 0.003; node.release.value = 0.08; return node; }
  function createSpatialNodes(context) {
    const input = context.createGain(); input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
    return { input, splitter: context.createChannelSplitter(2), merger: context.createChannelMerger(2), leftToLeft: context.createGain(), leftToRight: context.createGain(), rightToLeft: context.createGain(), rightToRight: context.createGain() };
  }
  function wireSpatialNodes(nodes) {
    nodes.input.connect(nodes.splitter); nodes.splitter.connect(nodes.leftToLeft, 0); nodes.splitter.connect(nodes.leftToRight, 0); nodes.splitter.connect(nodes.rightToLeft, 1); nodes.splitter.connect(nodes.rightToRight, 1);
    nodes.leftToLeft.connect(nodes.merger, 0, 0); nodes.rightToLeft.connect(nodes.merger, 0, 0); nodes.leftToRight.connect(nodes.merger, 0, 1); nodes.rightToRight.connect(nodes.merger, 0, 1);
  }
  function calculateCrossfadeGains(progress, mode = 'equal-power') {
    const p = clampNumber(progress, 0, 1, 0);
    if (mode === 'off' || mode === 'gapless') {
      return { outGain: p >= 1 ? 0 : 1, inGain: p >= 1 ? 1 : 0 };
    }
    if (mode === 'linear') {
      return { outGain: 1 - p, inGain: p };
    }
    // Equal-power crossfade: out = cos(p * pi/2), in = sin(p * pi/2)
    // Preserves total energy: out^2 + in^2 = 1.0
    const angle = p * (Math.PI / 2);
    const outGain = Math.cos(angle);
    const inGain = Math.sin(angle);
    return { outGain: Math.max(0, Math.min(1, outGain)), inGain: Math.max(0, Math.min(1, inGain)) };
  }
  function normalizePlaybackTransitions(values = {}) {
    const original = values && typeof values === 'object' ? values : {};
    const validModes = new Set(['off', 'gapless', 'equal-power', 'linear']);
    const mode = validModes.has(original.mode) ? original.mode : 'gapless';
    const duration = clampNumber(original.duration, 0.5, 12, 5);
    const gaplessEnabled = original.gaplessEnabled !== false;
    return { mode, duration, gaplessEnabled };
  }
  function buildAudioGraph(context, mediaElement, bands = [], parametricBands = []) {
    if (!context || !mediaElement) throw new Error('Audio graph requires a context and media element.');
    const source = context.createMediaElementSource(mediaElement);
    const deckAGain = context.createGain(); deckAGain.gain.value = 1;
    const deckBGain = context.createGain(); deckBGain.gain.value = 0;
    const transitionSum = context.createGain(); transitionSum.gain.value = 1;
    source.connect(deckAGain);
    deckAGain.connect(transitionSum);
    deckBGain.connect(transitionSum);
    const eqNodes = bands.map((band) => makeFilter(context, band));
    const parametricNodes = { track: makeParametricFilters(context, parametricBands), system: makeParametricFilters(context, parametricBands) };
    const calibrationInput = context.createGain(); calibrationInput.gain.value = 1;
    const masterGain = context.createGain();
    const spatialNodes = createSpatialNodes(context);
    const limiter = configureProtectiveLimiter(context.createDynamicsCompressor());
    const chain = [transitionSum, ...eqNodes, ...parametricNodes.track, ...parametricNodes.system, masterGain, spatialNodes.input];
    chain.slice(0, -1).forEach((node, index) => node.connect(chain[index + 1]));
    calibrationInput.connect(eqNodes[0]);
    wireSpatialNodes(spatialNodes);
    spatialNodes.merger.connect(limiter);
    limiter.connect(context.destination);
    return { source, deckAGain, deckBGain, transitionSum, eqNodes, parametricNodes, calibrationInput, masterGain, spatialNodes, limiter };
  }
  function applyParametricNodes(nodes = [], bands = [], context) {
    if (!context || !nodes?.length) return;
    bands.forEach((band, index) => { const node = nodes[index]; if (!node) return; node.frequency.setTargetAtTime(band.frequency, context.currentTime, 0.018); node.Q.setTargetAtTime(band.q, context.currentTime, 0.018); node.gain.setTargetAtTime(band.enabled ? band.gain : 0, context.currentTime, 0.015); });
  }
  function applySpatialNodes(nodes, profile = {}, context) {
    const balance = clampNumber(profile.balance, -1, 1, 0); const leftOut = balance > 0 ? 1 - balance : 1; const rightOut = balance < 0 ? 1 + balance : 1; const mix = profile.mono ? 0.5 : 1; const time = context.currentTime;
    nodes.leftToLeft.gain.setTargetAtTime(leftOut * mix, time, 0.012); nodes.rightToRight.gain.setTargetAtTime(rightOut * mix, time, 0.012); nodes.leftToRight.gain.setTargetAtTime(profile.mono ? rightOut * mix : 0, time, 0.012); nodes.rightToLeft.gain.setTargetAtTime(profile.mono ? leftOut * mix : 0, time, 0.012);
    return { balance, mono: Boolean(profile.mono) };
  }
  function estimateBellGain(frequency, center, q, gain) { if (!gain) return 0; const distance = Math.log2(Math.max(20, frequency) / center); const width = Math.max(0.12, 1.4 / q); return gain * Math.exp(-(distance * distance) / (2 * width * width)); }
  return Object.freeze({ applyParametricNodes, applySpatialNodes, buildAudioGraph, calculateCrossfadeGains, clampNumber, configureProtectiveLimiter, createSpatialNodes, decibelsToGain, estimateBellGain, gainToDecibels, makeFilter, makeParametricFilters, normalizeParametricBand, normalizeParametricBands, normalizePlaybackTransitions, normalizeTuning, optionalFiniteNumber, parametricDefaults, wireSpatialNodes });
}));
