const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
const main = read('src/main.js');
const preload = read('src/preload.js');
const miniPreload = read('src/mini-preload.js');
const renderer = read('src/renderer.js');
const integrationRunner = read('src/integration-test-runner.js');
const harness = read('scripts/check-windows-integration.js');
const packager = read('scripts/package-windows-smoke.js');
const workflow = read('.github/workflows/windows-integration.yml');
const lifecycle = read('scripts/test-windows-installer-lifecycle.ps1');
const releaseSurface = read('scripts/test-windows-release-surface.ps1');

assert.match(main, /PIXELODY_TEST_MODE === '1' && integrationTestFlag/, 'Main-process test mode must require the environment and explicit launch flag.');
assert.match(main, /PIXELODY_TEST_LAUNCH === '1'/, 'Packaged test launch must retain an explicit second environment gate when Chromium omits custom arguments.');
assert.match(main, /additionalArguments: integrationTestMode \? \['--pixelody-preload-integration-test'\] : \[\]/, 'Sandboxed preloads must receive a main-authorized test sentinel.');
assert.match(main, /if \(!integrationTestMode\) return '';/, 'Integration environment fallbacks must remain behind the double test-mode gate.');
assert.match(main, /isKnownWindowSender\(event\)/, 'Test IPC must authorize a known Pixelody window.');
assert.doesNotMatch(main, /executeJavaScript\s*\(/, 'The harness must not add arbitrary renderer evaluation.');
assert.match(preload, /if \(integrationTestEnabled\)/, 'Test preload methods must be conditional.');
assert.match(miniPreload, /if \(integrationTestEnabled\)/, 'Mini test methods must be conditional.');
assert.match(preload, /process\.argv\.includes\('--pixelody-preload-integration-test'\)/, 'Main preload test methods must require the main-authorized sentinel.');
assert.match(miniPreload, /process\.argv\.includes\('--pixelody-preload-integration-test'\)/, 'Mini preload test methods must require the main-authorized sentinel.');
assert.doesNotMatch(miniPreload, /chooseFiles|saveStateSnapshot|startSharingHost|openExternal/, 'Mini preload must not inherit main-window capabilities.');
assert.match(renderer, /integration-test-runner\.js/, 'The renderer must load the bounded scenario runner only through the conditional bridge.');
assert.match(main, /appendIntegrationReport\('main-ready'/, 'Packaged startup must emit a privacy-safe main-process boundary record.');
assert.match(integrationRunner, /runner-bridge-ready/, 'The packaged runner must identify when its authorized preload bridge is available.');
assert.match(integrationRunner, /\['interactive', 'settled'\]\.includes\(document\.body\.dataset\.readiness\)/, 'The packaged runner must accept both usable renderer readiness states after a slow hosted launch.');
assert.match(harness, /mkdtemp\(path\.join\(os\.tmpdir\(\), `pixelody-integration-/, 'Profiles must use owned temporary roots.');
assert.match(harness, /fsp\.realpath\(targetDirectory\)/, 'Production launches must use a canonical path so ASAR sender URLs match on Windows.');
assert.match(harness, /assertInside\(resolvedTemp, target/, 'Temporary cleanup must validate its target.');
assert.match(harness, /PIXELODY_TEST_SCENARIO: scenario/, 'Packaged test parameters must have an environment fallback.');
assert.match(harness, /PIXELODY_TEST_LAUNCH: '1'/, 'The harness must opt into the packaged-launch fallback explicitly.');
assert.match(harness, /taskkill\.exe.*'\/T'.*'\/F'/s, 'Windows cleanup must terminate the owned Electron process tree.');
assert.match(harness, /maxRetries: 12, retryDelay: 250/, 'Production staging cleanup must retry transient Windows file locks.');
assert.match(harness, /sanitizeText/, 'Failure evidence must be sanitized before retention.');
assert.match(harness, /runSingle\('security'/, 'Both launch modes must run hostile-window security probes.');
assert.match(packager, /allowedTopLevel/, 'Packaged app content must be allowlisted.');
assert.match(packager, /personalMediaIncluded: false/, 'Package manifest must declare the verified personal-media boundary.');
for (const required of ['ubuntu-latest', 'macos-latest', 'windows-latest', 'node: [22, 24]', 'timeout-minutes:', 'pnpm run check:security', 'pnpm run check:smoke', 'pnpm run check:integration:all', 'release:windows:upgrade-fixture', 'test-windows-installer-lifecycle.ps1', 'test-windows-release-surface.ps1', 'actions/upload-artifact@v7']) {
  assert.ok(workflow.includes(required), `CI workflow is missing: ${required}`);
}
for (const required of ['PIXELODY_DISPOSABLE_WINDOWS', 'Assert-Child $fixtureRoot', 'Assert-Child $signedRoot', 'ExpectedPublisherSubject', 'Assert-SignedArtifact', 'TimeStamperCertificate', 'Assert-InstalledLaunch', 'MainWindowHandle', 'installPrefix', 'uninstallRemovedShortcuts', 'uninstallRemovedMetadata', 'uninstallPreservedUserData']) {
  assert.ok(lifecycle.includes(required), `Installer lifecycle guard is missing: ${required}`);
}
for (const required of ['PIXELODY_DISPOSABLE_WINDOWS', 'serviceConfigurationSha256', 'driverConfigurationSha256', 'firewallConfigurationSha256', 'defaultAudioConfigurationSha256', 'pathsIncluded=$false']) {
  assert.ok(releaseSurface.includes(required), `Windows release-surface guard is missing: ${required}`);
}

console.log('Windows harness source audit passed: double gate, owned profiles, bounded execution, installed lifecycle isolation, release-surface invariants, allowlisted packages, matrix CI, and sanitized artifacts.');
