'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const signal = require('../src/audio-visualizers/signal-frame.js');
const renderers = require('../src/audio-visualizers/renderers.js');
const runtime = require('../src/audio-visualizers/runtime.js');

const definitions = renderers.listRenderers();
assert.ok(definitions.length >= 12, 'The visualizer foundation must remain a sizeable set.');
assert.equal(new Set(definitions.map((entry) => entry.id)).size, definitions.length, 'Visualizer ids must be unique.');
assert.ok(new Set(definitions.map((entry) => entry.family)).size >= 7, 'The set must span at least seven visual processes.');
assert.ok(definitions.some((entry) => entry.channels === 'stereo'), 'At least one renderer must use genuine stereo data when available.');
assert.ok(definitions.some((entry) => entry.complexity === 'high'), 'The set must include ambitious high-cost specimens.');
assert.ok(definitions.some((entry) => entry.placements.includes('mini')), 'Compact placement must be represented.');
assert.ok(definitions.some((entry) => entry.placements.includes('background')), 'Ambient placement must be represented.');
definitions.forEach((entry) => {
  assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(entry.name && entry.process && entry.family && entry.complexity);
  assert.ok(['low', 'medium', 'high'].includes(entry.complexity));
  assert.ok(entry.placements.length >= 2);
  assert.equal(typeof entry.render, 'function');
});

const inputSpectrum = new Float32Array([0, 0.5, 1]);
const inputWaveform = new Float32Array([-1, 0, 1]);
const frame = signal.makeSignalFrame({ timestamp: 120, spectrum: inputSpectrum, waveform: inputWaveform, playing: true });
assert.equal(frame.version, signal.FRAME_VERSION);
assert.equal(frame.spectrum.length, signal.DEFAULT_BIN_COUNT);
assert.equal(frame.waveform.length, signal.DEFAULT_SAMPLE_COUNT);
assert.equal(frame.spectrum[0], 0);
assert.equal(frame.spectrum.at(-1), 1);
assert.equal(frame.waveform[0], 0);
assert.equal(frame.waveform.at(-1), 1);
assert.equal(inputSpectrum.length, 3, 'Normalization must not mutate analyser buffers.');
assert.ok(Object.values(frame.bands).every((value) => value >= 0 && value <= 1));
assert.ok([...signal.makeSignalFrame().waveform].every((value) => value === 0.5), 'An absent waveform must normalize to a centered silence line.');

const demoA = signal.makeDemoFrame(4321, 'stereo', 19);
const demoB = signal.makeDemoFrame(4321, 'stereo', 19);
assert.deepEqual([...demoA.spectrum], [...demoB.spectrum], 'Demo frames must be deterministic for repeatable visual review.');
assert.deepEqual([...demoA.left], [...demoB.left]);
assert.ok(demoA.stereoWidth > 0.5);

function createRecordingContext() {
  const operations = [];
  const gradient = { addColorStop(...args) { operations.push(['gradient', ...args]); } };
  const methods = ['save', 'restore', 'setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'ellipse', 'translate', 'rotate', 'scale', 'closePath'];
  const context = { operations, createLinearGradient() { operations.push(['createLinearGradient']); return gradient; } };
  methods.forEach((method) => { context[method] = (...args) => operations.push([method, ...args]); });
  return context;
}

definitions.forEach((definition) => {
  const recording = createRecordingContext();
  definition.render({ ctx: recording, width: 420, height: 220, frame: demoA, palette: runtime.DEFAULT_PALETTE, state: Object.create(null), delta: 16.67, timestamp: demoA.timestamp, quality: 'full' });
  assert.ok(recording.operations.length > 8, `${definition.id} must paint a meaningful frame.`);
  assert.ok(recording.operations.every((operation) => operation.slice(1).every((value) => typeof value !== 'number' || Number.isFinite(value))), `${definition.id} emitted a non-finite canvas operation.`);
});

const queuedFrames = [];
const context = createRecordingContext();
const canvas = {
  width: 0, height: 0, clientWidth: 320, clientHeight: 180, dataset: {}, attributes: {},
  getBoundingClientRect() { return { width: 320, height: 180 }; },
  getContext() { return context; },
  setAttribute(name, value) { this.attributes[name] = value; },
};
const scheduler = runtime.createScheduler({ requestFrame(callback) { queuedFrames.push(callback); return queuedFrames.length; }, cancelFrame() {} });
const handle = scheduler.add(canvas, definitions[0].id, { motion: 'off' });
assert.equal(scheduler.snapshot().instanceCount, 1);
assert.equal(queuedFrames.length, 1, 'A static visualizer should request one invalidation frame, not a continuous loop.');
queuedFrames.shift()(100);
assert.ok(context.operations.length > 20, 'A renderer must produce a meaningful canvas treatment.');
assert.equal(queuedFrames.length, 0, 'Motion-off mode must stop after its static diagnostic frame.');
handle.destroy();
assert.equal(scheduler.snapshot().instanceCount, 0);

const packageSource = ['signal-frame.js', 'renderers.js', 'runtime.js'].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'audio-visualizers', file), 'utf8')).join('\n');
assert.doesNotMatch(packageSource, /createMediaElementSource|new\s+AudioContext|webkitAudioContext/, 'Visualizer components must not own or duplicate the playback graph.');
assert.doesNotMatch(packageSource, /data-theme|built-in-themes|themeNavigationMechanics/, 'Visualizer components must remain unassigned to themes.');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer-lab.html'), 'utf8');
const labSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer-lab.js'), 'utf8');
assert.match(html, /No playback graph ownership/);
assert.match(html, /No theme mapping/);
assert.match(html, /id="motionMode"/);
assert.match(html, /id="performanceMode"/);
assert.match(labSource, /createScheduler\(/);
assert.match(labSource, /prefers-reduced-motion/);

console.log(`Audio visualizer foundation audit passed: ${definitions.length} renderers, ${new Set(definitions.map((entry) => entry.family)).size} process families, deterministic frames, one scheduler, and static safety fallback.`);
