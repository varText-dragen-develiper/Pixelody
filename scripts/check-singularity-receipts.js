'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.join(root, '.artifacts', 'windows-integration');
const fixtureHash = '21f34edc598200f4329c4d0b199a92b2ae0277ea14248f76d4f39f1b0dd9def0';
const routes = [
  { scenario: 'singularity-stage3', hypothesisId: 'H-B R2 Graph', prefix: 'capture-singularity-', scrollKey: 'activePlaneScroll' },
  { scenario: 'singularity-stage3-proxy', hypothesisId: 'H-A Proxy/portal', prefix: 'capture-singularity-proxy-', scrollKey: 'activePortalScroll' },
];
const modes = [
  { suffix: '', evidenceClass: 'renderer-assertions-disabled-gpu', painted: false, reducedMotion: false, forcedColors: false },
  { suffix: '-visual', evidenceClass: 'painted-application-path', painted: true, reducedMotion: false, forcedColors: false },
  { suffix: '-reduced-motion', evidenceClass: 'renderer-assertions-os-reduced-motion-disabled-gpu', painted: false, reducedMotion: true, forcedColors: false },
  { suffix: '-forced-colors', evidenceClass: 'renderer-assertions-forced-colors-disabled-gpu', painted: false, reducedMotion: false, forcedColors: true },
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEvents(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function assertOwnedFile(relativePath) {
  assert.equal(typeof relativePath, 'string', 'Receipt source path must be a string.');
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Receipt source escaped the workspace: ${relativePath}`);
  return target;
}

function expectedCaptures(route) {
  const main = ['compact', 'failure', 'intermediate', 'narrow', 'playing', 'rest', 'restored-maximized', 'zoom-200']
    .map((state) => `${route.prefix}main-${state}.png`);
  return [...main, `${route.prefix}mini-compact.png`].sort();
}

function findEvent(events, name) {
  return events.filter((entry) => entry.event === name).at(-1);
}

const results = [];
let sharedBundle = '';
for (const route of routes) {
  for (const mode of modes) {
    const directoryName = `unpacked-${route.scenario}${mode.suffix}`;
    const directory = path.join(evidenceRoot, directoryName);
    const receipt = readJson(path.join(directory, 'receipt.json'));
    const events = readEvents(path.join(directory, 'report.jsonl'));

    assert.equal(receipt.mode, 'unpacked', `${directoryName} used the wrong package mode.`);
    assert.equal(receipt.scenario, route.scenario, `${directoryName} scenario identity drifted.`);
    assert.equal(receipt.hypothesisId, route.hypothesisId, `${directoryName} hypothesis identity drifted.`);
    assert.equal(receipt.candidateId, null, `${directoryName} silently minted a candidate.`);
    assert.equal(receipt.selectionStatus, 'unselected-comparison-hypothesis', `${directoryName} silently selected a route.`);
    assert.deepEqual(receipt.fixture, { id: 'singularity-hostile-eight-track-r1', sha256: fixtureHash }, `${directoryName} fixture identity drifted.`);
    assert.equal(receipt.status, 'PASS', `${directoryName} is not a passing receipt.`);
    assert.equal(receipt.evidenceClass, mode.evidenceClass, `${directoryName} evidence class drifted.`);
    assert.equal(receipt.paintedEvidence, mode.painted, `${directoryName} painted classification drifted.`);
    assert.equal(receipt.osReducedMotionRequested, mode.reducedMotion, `${directoryName} reduced-motion flag drifted.`);
    assert.equal(receipt.forcedColorsRequested, mode.forcedColors, `${directoryName} forced-colors flag drifted.`);
    assert.equal(receipt.gpuPerformanceEvidence, false, `${directoryName} overclaimed GPU performance.`);
    assert.equal(receipt.ownerAcceptance, false, `${directoryName} overclaimed owner acceptance.`);
    assert.deepEqual(receipt.privacy, { pathsHidden: true, fixtureOnly: true, credentialsIncluded: false }, `${directoryName} privacy boundary drifted.`);

    assert.equal(receipt.sourceScope?.algorithm, 'sha256', `${directoryName} source algorithm drifted.`);
    const sourceEntries = Object.entries(receipt.sourceScope?.files || {});
    assert.equal(sourceEntries.length, 26, `${directoryName} must bind the complete 26-file source scope.`);
    assert.ok(sourceEntries.some(([relativePath]) => relativePath === 'scripts/check-singularity-receipts.js'), `${directoryName} does not bind this verifier.`);
    for (const [relativePath, expectedHash] of sourceEntries) {
      assert.equal(sha256(fs.readFileSync(assertOwnedFile(relativePath))), expectedHash, `${directoryName} source hash drifted: ${relativePath}`);
    }
    const bundleHash = sha256(sourceEntries.map(([relativePath, hash]) => `${relativePath}:${hash}`).join('\n'));
    assert.equal(bundleHash, receipt.sourceScope.bundleSha256, `${directoryName} source bundle hash drifted.`);
    if (!sharedBundle) sharedBundle = bundleHash;
    assert.equal(bundleHash, sharedBundle, `${directoryName} does not share the exact source bundle.`);

    const captureNames = [...receipt.captures].sort();
    const captureEntries = Object.entries(receipt.captureIntegrity?.files || {});
    const geometryEntries = Object.entries(receipt.captureGeometry || {});
    assert.equal(receipt.captureIntegrity?.algorithm, 'sha256', `${directoryName} capture algorithm drifted.`);
    if (mode.painted) {
      assert.deepEqual(captureNames, expectedCaptures(route), `${directoryName} painted capture set drifted.`);
      assert.equal(captureEntries.length, 9, `${directoryName} must bind nine image hashes.`);
      assert.equal(geometryEntries.length, 9, `${directoryName} must bind nine geometry records.`);
      for (const [name, expectedHash] of captureEntries) {
        assert.ok(captureNames.includes(name), `${directoryName} hashed an undeclared capture: ${name}`);
        assert.equal(sha256(fs.readFileSync(path.join(directory, name))), expectedHash, `${directoryName} image hash drifted: ${name}`);
        const geometry = receipt.captureGeometry[name];
        assert.ok(geometry?.image?.width > 0 && geometry?.image?.height > 0, `${directoryName} omitted image geometry: ${name}`);
        if (geometry.kind === 'main') {
          assert.ok(geometry.rendererViewport?.width > 0 && geometry.rendererViewport?.height > 0 && geometry.rendererViewport?.devicePixelRatio > 0, `${directoryName} omitted renderer geometry: ${name}`);
          assert.equal(geometry.image.width, geometry.contentBounds?.width, `${directoryName} native-content/image width drifted: ${name}`);
          assert.equal(geometry.image.height, geometry.contentBounds?.height, `${directoryName} native-content/image height drifted: ${name}`);
          assert.ok(Math.abs(geometry.image.width - Math.round(geometry.rendererViewport.width * geometry.rendererViewport.devicePixelRatio)) <= 1, `${directoryName} renderer/image width drifted beyond device-pixel rounding: ${name}`);
          assert.ok(Math.abs(geometry.image.height - Math.round(geometry.rendererViewport.height * geometry.rendererViewport.devicePixelRatio)) <= 1, `${directoryName} renderer/image height drifted beyond device-pixel rounding: ${name}`);
          assert.deepEqual(geometry.minimumSize, [800, 700], `${directoryName} main minimum size drifted: ${name}`);
        } else {
          assert.equal(geometry.kind, 'mini', `${directoryName} capture kind drifted: ${name}`);
          assert.equal(geometry.rendererViewport, null, `${directoryName} invented a main renderer viewport for the mini.`);
          assert.deepEqual(geometry.image, { width: 500, height: 200 }, `${directoryName} mini image geometry drifted.`);
        }
      }
      const intermediate = receipt.captureGeometry[`${route.prefix}main-intermediate.png`];
      assert.equal(intermediate.bounds.width, 1440, `${directoryName} intermediate outer width drifted.`);
      assert.equal(intermediate.bounds.height, 800, `${directoryName} intermediate outer height drifted.`);
    } else {
      assert.deepEqual(captureNames, [], `${directoryName} non-painted mode retained captures.`);
      assert.deepEqual(captureEntries, [], `${directoryName} non-painted mode retained image hashes.`);
      assert.deepEqual(geometryEntries, [], `${directoryName} non-painted mode retained capture geometry.`);
    }

    const terminal = findEvent(events, 'terminal');
    assert.equal(terminal?.detail?.ok, true, `${directoryName} terminal event is not PASS.`);
    const summary = terminal.detail.summary;
    for (const key of ['electronPointerInput', 'electronWheelInput', 'wheelScrollOwnedByReleasedSurface', 'electronKeyboardInput', 'motionOffEquivalent', 'miniPlayerAgreement', 'lifecycleRestored', 'chromiumAccessibilityTree', 'zoom200']) {
      assert.equal(summary[key], true, `${directoryName} terminal summary lost ${key}.`);
    }
    assert.equal(summary[route.scrollKey], true, `${directoryName} terminal summary lost released-root scrolling.`);
    assert.equal(summary.registeredThemeChanged, false, `${directoryName} changed the registered theme.`);
    assert.equal(summary.perceptualAcceptance, false, `${directoryName} overclaimed perceptual acceptance.`);
    assert.equal(summary.osReducedMotionEquivalent, mode.reducedMotion ? true : 'not-requested', `${directoryName} reduced-motion terminal truth drifted.`);
    assert.equal(summary.forcedColorsEquivalent, mode.forcedColors ? true : 'not-requested', `${directoryName} forced-colors terminal truth drifted.`);

    const wheel = findEvent(events, 'singularity-wheel-scroll-result');
    assert.equal(wheel?.detail?.nativeScrollMoved, true, `${directoryName} lost native wheel scrolling.`);
    assert.equal(wheel.detail.scrollBefore, 0, `${directoryName} did not establish the wheel baseline.`);
    assert.ok(wheel.detail.scrollAfter > wheel.detail.scrollBefore && wheel.detail.scrollHeight > wheel.detail.clientHeight, `${directoryName} wheel geometry is invalid.`);
    assert.equal(wheel.detail.physicalInputEvidence, false, `${directoryName} overclaimed physical wheel evidence.`);
    assert.ok(events.some((entry) => entry.event === 'singularity-keyboard-observed' && entry.detail?.trusted === true && entry.detail?.physicalInputEvidence === false), `${directoryName} lost trusted bounded keyboard evidence.`);
    const zoomQueue = findEvent(events, 'singularity-zoom-queue-return');
    assert.equal(zoomQueue?.detail?.queueHidden, true, `${directoryName} did not close Queue at 200%.`);
    assert.equal(zoomQueue?.detail?.triggerFocused, true, `${directoryName} did not restore Queue trigger focus at 200%.`);

    const reduced = findEvent(events, 'singularity-os-reduced-motion');
    if (mode.reducedMotion) {
      assert.equal(reduced?.detail?.mediaMatches, true, `${directoryName} reduced-motion media query did not match.`);
      assert.deepEqual(reduced.detail.transitionDurations, ['0s'], `${directoryName} retained reduced-motion transitions.`);
      assert.equal(reduced.detail.willChange, 'auto', `${directoryName} retained reduced-motion layer promotion.`);
      assert.equal(reduced.detail.physicalPreferenceEvidence, false, `${directoryName} overclaimed physical reduced-motion evidence.`);
    } else assert.equal(reduced, undefined, `${directoryName} emitted unrequested reduced-motion evidence.`);

    const forced = findEvent(events, 'singularity-forced-colors');
    if (mode.forcedColors) {
      assert.equal(forced?.detail?.mediaMatches, true, `${directoryName} forced-colors media query did not match.`);
      assert.equal(forced.detail.center?.forcedColorAdjust, 'auto', `${directoryName} center blocked system color adjustment.`);
      assert.equal(forced.detail.center?.backgroundImage, 'none', `${directoryName} center retained authored imagery in forced colors.`);
      assert.equal(forced.detail.center?.borderStyle, 'solid', `${directoryName} center lost its forced-color boundary.`);
      assert.ok(Number.parseFloat(forced.detail.center?.borderWidth) >= 2, `${directoryName} center boundary is too weak.`);
      assert.equal(forced.detail.gate?.forcedColorAdjust, 'auto', `${directoryName} gate blocked system color adjustment.`);
      assert.equal(forced.detail.gate?.backgroundImage, 'none', `${directoryName} gate retained authored imagery in forced colors.`);
      assert.notEqual(forced.detail.gate?.color, forced.detail.gate?.backgroundColor, `${directoryName} gate foreground/background collapsed.`);
      assert.equal(forced.detail.physicalPreferenceEvidence, false, `${directoryName} overclaimed physical forced-colors evidence.`);
      const mini = findEvent(events, 'singularity-mini-state')?.detail?.material;
      assert.deepEqual(mini, {
        bodyBackgroundColor: 'rgb(255, 255, 255)',
        shellBackgroundImage: 'none',
        shellColor: 'rgb(0, 0, 0)',
        shellBorderTopColor: 'rgb(0, 0, 0)',
      }, `${directoryName} mini system-color material drifted.`);
    } else assert.equal(forced, undefined, `${directoryName} emitted unrequested forced-colors evidence.`);

    results.push({ directory: directoryName, sources: sourceEntries.length, captures: captureEntries.length, evidenceClass: mode.evidenceClass });
  }
}

console.log(JSON.stringify({
  status: 'PASS',
  routes: routes.map((route) => route.hypothesisId),
  evidenceModes: modes.map((mode) => mode.evidenceClass),
  receipts: results.length,
  sourceBundleSha256: sharedBundle,
  results,
  ownerAcceptance: false,
  gpuPerformanceEvidence: false,
  physicalPreferenceEvidence: false,
}, null, 2));
