'use strict';

// Publish only a handoff whose executable sources match passing receipts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const policy = require('../src/shuffle/universal');
const learning = require('../src/shuffle/learning');
const scopes = require('../src/shuffle/scopes');
const root = path.resolve(__dirname, '..');
const folder = '.artifacts/shuffle-universal/core/';
const fixtureFolder = 'docs/api-contract-fixtures/shuffle-universal-v2/';
const bytes = (file) => fs.readFileSync(path.join(root, file));
const digest = (file) => crypto.createHash('sha256').update(bytes(file)).digest('hex');
const read = (file) => JSON.parse(bytes(file));
const reference = read(folder + 'reference-tests.json');
const learningTests = read(folder + 'learning-tests.json');
const simulations = read(folder + 'simulation-longitudinal.json');
const legacy = read(folder + 'legacy-receipt.json');
const manifest = read(fixtureFolder + 'manifest.json');
assert.equal(reference.passed, true);
assert.equal(reference.sourceSha256, digest('src/shuffle/universal.js'), 'Reference test source drift');
assert.equal(reference.fixtureManifestSha256, digest(fixtureFolder + 'manifest.json'), 'Reference fixture drift');
assert.equal(learningTests.result, 'passed');
assert.equal(learningTests.productionSha256, digest('src/shuffle/learning.js'), 'Learning source drift');
assert.equal(learningTests.testSha256, digest('scripts/check-shuffle-universal-learning.js'), 'Learning test drift');
assert.equal(simulations.status, 'passed', 'Longitudinal scenarios must pass');
assert.equal(simulations.failures.length, 0);
for (const row of simulations.source.files) assert.equal(row.sha256, digest(row.file), 'Simulation source drift: ' + row.file);
for (const row of legacy.sourceHashes) assert.equal(row.sha256, digest(row.file), 'Legacy source drift: ' + row.file);
for (const row of legacy.tests) assert.equal(row.exitCode, 0, row.command);
for (const row of manifest.files) assert.equal(row.sha256, digest(fixtureFolder + row.name), 'Manifest drift: ' + row.name);
assert.equal(manifest.policyVersion, policy.POLICY_VERSION);
const sources = [
  'src/shuffle/universal.js', 'src/shuffle/learning.js', 'src/shuffle/scopes.js', 'src/shuffle/index.js', 'src/shuffle/README.md',
  'src/flow-shuffle-engine.js', 'src/flow-shuffle-planner.js', 'src/flow-shuffle-learning.js', 'src/flow-shuffle-decision.js', 'src/flow-shuffle-contract.js',
  'scripts/check-shuffle-universal.js', 'scripts/check-shuffle-universal-learning.js', 'scripts/check-shuffle-universal-simulations.js', 'scripts/check-shuffle-universal-ready.js', 'scripts/check-flow-shuffle.js',
];
const performance = simulations.results.find((row) => row.name.startsWith('ten-thousand')).metrics;
const output = {
  readinessVersion: 2, status: 'interfaces-stable-tests-passing', workspace: root,
  baseline: '6dcfe8ce8bcd7ba802a20af3923beec216b3eae6', planCommit: '71c95d4389b406279a201255e9214807538b393a',
  headAtReceipt: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  policyVersion: policy.POLICY_VERSION, schemaVersion: policy.VERSION, configVersion: policy.CONFIG.version,
  semanticRevision: 2, stableInterfaces: true,
  machineContract: fixtureFolder + 'machine-contract.json', schemas: fixtureFolder + 'schemas.json',
  fixtureManifest: fixtureFolder + 'manifest.json', fixtureManifestSha256: digest(fixtureFolder + 'manifest.json'), fixtures: manifest.files,
  entrypoints: { node: 'src/shuffle/index.js', scheduler: 'src/shuffle/universal.js', learning: 'src/shuffle/learning.js', scopes: 'src/shuffle/scopes.js', integrationGuide: 'src/shuffle/README.md' },
  browserLoadOrder: ['src/shuffle/universal.js', 'src/shuffle/learning.js', 'src/shuffle/scopes.js', 'src/flow-shuffle-engine.js', 'src/flow-shuffle-planner.js'],
  globals: { scheduler: 'PixelodyUniversalShuffle', learning: 'PixelodyShuffleLearningV2', scopes: 'PixelodyShuffleScopesV2' },
  functions: { scheduler: Object.keys(policy).filter((name) => typeof policy[name] === 'function'), learning: Object.keys(learning).filter((name) => typeof learning[name] === 'function'), scopes: Object.keys(scopes).filter((name) => typeof scopes[name] === 'function') },
  constants: policy.CONFIG, learningConstants: learning.CONFIG,
  activationRequiredFields: ['attemptId', 'decisionId', 'authorityId', 'authorityEpoch'],
  authorityContext: 'Same immutable {nowMs,signals:[{trackId,...learning.trackSignals(...)}]} for stage/project/mode-change/publicSnapshot. Actual service listening events have a separate monotonic boot clock.',
  tests: [
    { command: 'node scripts/check-shuffle-universal.js', passed: reference.checks, receipt: folder + 'reference-tests.json' },
    { command: 'node scripts/check-shuffle-universal-learning.js --write-receipt', passed: learningTests.cases, receipt: folder + 'learning-tests.json' },
    { command: 'node scripts/check-shuffle-universal-simulations.js', passed: simulations.results.length, assertions: simulations.invariantChecks, confirmedDecisions: simulations.confirmedDecisions, restoreComparisons: simulations.restoreComparisons, receipt: folder + 'simulation-longitudinal.json' },
    ...legacy.tests,
  ],
  sourceHashes: sources.map((file) => ({ file, sha256: digest(file) })),
  performance: { targetP95Ms: 50, measuredTargetMet: simulations.performanceTargetMet, metrics: performance, rendererGate: 'Open: Node stage/commit samples do not establish renderer main-thread or frame pacing.' },
  registrationRequests: {
    'check:shuffle-universal': 'node scripts/check-shuffle-universal.js',
    'check:shuffle-universal-learning': 'node scripts/check-shuffle-universal-learning.js',
    'check:shuffle-universal-simulations': 'node scripts/check-shuffle-universal-simulations.js',
    'check:shuffle-universal-ready': 'node scripts/check-shuffle-universal-ready.js',
  },
  unresolvedLimitations: [
    'Windows and Android production adapters must adopt universal entry/occurrence policy; legacy track-ID selection APIs are migration compatibility only.',
    'JS/Kotlin normalized fixture parity and both platform lifecycle/storage/runtime gates remain open.',
    'Root must update root-owned check-performance.js twelve frozen rankings using legacy-performance-fixtures.json; normal npm run check currently stops on the superseded ranking.',
    'Core supplies paused restore/unknown-schema isolation; actual atomic filesystem writes, backup recovery, DB migrations and URI grants are platform adapter acceptance.',
    'Root owns connected host handoff, safe public media identity mapping and authority-epoch integration at G3.',
    'Synchronous whole-horizon projection is for bounded offline/worker use; foreground adapters yield/cancel between advanceProjection batches.',
    'One measured Balanced first-stage Node sample was over100ms; keep the renderer long-task/tail gate open even when aggregate p95 meets50ms.',
    ...(simulations.performanceTargetMet ? [] : ['Measured 10k selection p95 exceeded the initial 50ms target in at least one mode; exact per-mode timings and concurrent-load/GC limitations are retained. Performance acceptance remains open for root review.']),
    'No audible-output, physical-device, human-listening, signing, release or publication acceptance is established here.',
  ],
};
const target = folder + 'core-ready.json';
if (process.argv.includes('--write-ready')) fs.writeFileSync(path.join(root, target), JSON.stringify(output, null, 2) + '\n');
else {
  const saved = read(target);
  assert.equal(saved.fixtureManifestSha256, output.fixtureManifestSha256);
  assert.deepEqual(saved.sourceHashes, output.sourceHashes);
}
console.log(JSON.stringify({ status: output.status, policyVersion: output.policyVersion, fixtureManifestSha256: output.fixtureManifestSha256, measuredPerformanceTargetMet: output.performance.measuredTargetMet }));
