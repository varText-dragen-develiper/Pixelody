const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const audioDomain = require('../src/renderer-domains/audio-controller.js');
const playbackDomain = require('../src/renderer-domains/playback-controller.js');
const rendererSource = read('src/renderer.js');
const indexSource = read('src/index.html');
const audioDomainSource = read('src/renderer-domains/audio-controller.js');
const stateStoreSource = read('src/state-store.js');

const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

// 1. Equal-Power Energy Conservation Math Test
console.log('Testing equal-power crossfade energy conservation...');
for (let p = 0; p <= 1.0001; p += 0.01) {
  const progress = Math.min(1, Math.max(0, p));
  const gains = audioDomain.calculateCrossfadeGains(progress, 'equal-power');
  const totalPower = (gains.outGain * gains.outGain) + (gains.inGain * gains.inGain);
  assert(
    Math.abs(totalPower - 1.0) < 1e-5,
    `Equal-power energy conservation violated at progress ${progress.toFixed(2)}: outGain=${gains.outGain}, inGain=${gains.inGain}, power=${totalPower}`
  );
}

// 2. Boundary and Mode Testing
console.log('Testing crossfade curve boundaries and fallback modes...');
const epStart = audioDomain.calculateCrossfadeGains(0, 'equal-power');
assert(Math.abs(epStart.outGain - 1.0) < 1e-6 && Math.abs(epStart.inGain - 0.0) < 1e-6, 'Equal power start gains incorrect');
const epEnd = audioDomain.calculateCrossfadeGains(1, 'equal-power');
assert(Math.abs(epEnd.outGain - 0.0) < 1e-6 && Math.abs(epEnd.inGain - 1.0) < 1e-6, 'Equal power end gains incorrect');
const epMid = audioDomain.calculateCrossfadeGains(0.5, 'equal-power');
assert(Math.abs(epMid.outGain - Math.SQRT1_2) < 1e-5 && Math.abs(epMid.inGain - Math.SQRT1_2) < 1e-5, 'Equal power midpoint gains should equal sqrt(1/2) ~ 0.7071');

const linMid = audioDomain.calculateCrossfadeGains(0.5, 'linear');
assert(Math.abs(linMid.outGain - 0.5) < 1e-6 && Math.abs(linMid.inGain - 0.5) < 1e-6, 'Linear midpoint gains should equal 0.5');

const gaplessGains = audioDomain.calculateCrossfadeGains(0.5, 'gapless');
assert(gaplessGains.outGain === 1 && gaplessGains.inGain === 0, 'Gapless mode should maintain full deck A gain');

const offGains = audioDomain.calculateCrossfadeGains(0.5, 'off');
assert(offGains.outGain === 1 && offGains.inGain === 0, 'Off mode should maintain full deck A gain');

// 3. Normalization Tests
console.log('Testing playback transition normalization...');
const defaultTrans = audioDomain.normalizePlaybackTransitions(null);
assert(defaultTrans.mode === 'gapless', `Expected default mode 'gapless', got ${defaultTrans.mode}`);
assert(defaultTrans.duration === 5, `Expected default duration 5, got ${defaultTrans.duration}`);

const clampedTrans = audioDomain.normalizePlaybackTransitions({ mode: 'equal-power', duration: 99 });
assert(clampedTrans.duration === 12, `Expected duration clamped to 12, got ${clampedTrans.duration}`);
const lowClampedTrans = audioDomain.normalizePlaybackTransitions({ mode: 'linear', duration: 0.1 });
assert(lowClampedTrans.duration === 0.5, `Expected duration clamped to 0.5, got ${lowClampedTrans.duration}`);

// 4. Trigger and Progress Calculation Tests
console.log('Testing trigger points and progress calculation...');
assert(playbackDomain.shouldTriggerTransition(95, 100, 5) === true, 'Should trigger at 95s of 100s with 5s xfade');
assert(playbackDomain.shouldTriggerTransition(94.9, 100, 5) === false, 'Should not trigger at 94.9s of 100s with 5s xfade');
assert(playbackDomain.shouldTriggerTransition(50, 100, 0) === false, 'Should not trigger with 0s duration');

const prog0 = playbackDomain.calculateTransitionProgress(95, 100, 5);
assert(Math.abs(prog0 - 0.0) < 1e-6, `Expected progress 0.0 at trigger, got ${prog0}`);
const progMid = playbackDomain.calculateTransitionProgress(97.5, 100, 5);
assert(Math.abs(progMid - 0.5) < 1e-6, `Expected progress 0.5 at midpoint, got ${progMid}`);
const progEnd = playbackDomain.calculateTransitionProgress(100, 100, 5);
assert(Math.abs(progEnd - 1.0) < 1e-6, `Expected progress 1.0 at track end, got ${progEnd}`);

// 5. DOM & UI Presence Tests
console.log('Testing DOM structure for transition settings...');
assert(indexSource.includes('class="panel wide system-transition-panel"'), 'Missing .system-transition-panel in index.html');
assert(indexSource.includes('id="transitionModeSetting"'), 'Missing #transitionModeSetting in index.html');
assert(indexSource.includes('data-transition-mode="gapless"'), 'Missing gapless button in index.html');
assert(indexSource.includes('data-transition-mode="equal-power"'), 'Missing equal-power button in index.html');
assert(indexSource.includes('data-transition-mode="linear"'), 'Missing linear button in index.html');
assert(indexSource.includes('data-transition-mode="off"'), 'Missing off button in index.html');
assert(indexSource.includes('id="crossfadeDuration"'), 'Missing #crossfadeDuration slider in index.html');
assert(indexSource.includes('id="transitionPresets"'), 'Missing #transitionPresets in index.html');
assert(indexSource.includes('id="resetTransition"'), 'Missing #resetTransition button in index.html');

// 6. Audio Controller Web Audio Graph Composition
console.log('Testing Web Audio graph routing for dual decks...');
assert(audioDomainSource.includes('context.createGain()'), 'Missing GainNode creation for transitions');
assert(audioDomainSource.includes('source.connect(deckAGain)'), 'Source not routed to deckAGain');
assert(audioDomainSource.includes('deckAGain.connect(transitionSum)'), 'deckAGain not routed to transitionSum');
assert(audioDomainSource.includes('const chain = [transitionSum, ...eqNodes'), 'transitionSum not at the head of the downstream EQ chain');
assert(audioDomainSource.includes('calculateCrossfadeGains'), 'calculateCrossfadeGains not exported');

// 7. State Store & Persistence Verification
console.log('Testing state store keys and renderer integration...');
assert(stateStoreSource.includes("'pixelody.playbackTransitions'"), 'pixelody.playbackTransitions missing from state-store.js');
assert(rendererSource.includes("'pixelody.playbackTransitions': state.playbackTransitions"), 'pixelody.playbackTransitions missing from buildDurableStateValues');
assert(rendererSource.includes('syncTransitionSettingsUi'), 'syncTransitionSettingsUi missing from renderer.js');
assert(rendererSource.includes('maintainPlaybackTransition'), 'maintainPlaybackTransition missing from renderer.js');

if (errors.length > 0) {
  console.error(`\nCrossfade & Gapless playback audit failed with ${errors.length} error(s):`);
  errors.forEach((err) => console.error(` - ${err}`));
  process.exit(1);
}

console.log('\n[PASS] Crossfade & Gapless playback audit passed with 0 errors.');
