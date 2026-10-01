const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.join(root, 'notes', 'next-theme-2026-09-10', 'evidence', 'performance');
const routes = Object.freeze([
  Object.freeze({ mode: 'graph', label: 'folded-singularity-graph-500', tracks: 500, runs: 3, sample: 'comparison' }),
  Object.freeze({ mode: 'proxy', label: 'folded-singularity-proxy-500', tracks: 500, runs: 3, sample: 'comparison' }),
  Object.freeze({ mode: 'graph', label: 'folded-singularity-graph-2000-stress', tracks: 2000, runs: 1, sample: 'stress' }),
  Object.freeze({ mode: 'proxy', label: 'folded-singularity-proxy-2000-stress', tracks: 2000, runs: 1, sample: 'stress' }),
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function percentile(values, fraction) {
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function median(values) {
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function actionGroup(actions, prefix) {
  return actions.filter((action) => action.name === prefix || action.name.startsWith(`${prefix}:`));
}

function summarizeActions(actions, prefix) {
  const group = actionGroup(actions, prefix);
  const longTasks = group.flatMap((action) => action.longTasks || []);
  return Object.freeze({
    samples: group.length,
    handlerMedianMs: rounded(median(group.map((action) => action.handlerMs))),
    paintMedianMs: rounded(median(group.map((action) => action.paintMs))),
    paintP95Ms: rounded(percentile(group.map((action) => action.paintMs), 0.95)),
    paintMaxMs: rounded(Math.max(...group.map((action) => action.paintMs))),
    maxFrameMs: rounded(Math.max(...group.map((action) => action.maxFrameMs))),
    mutationMedian: rounded(median(group.map((action) => action.mutations))),
    longTaskCount: longTasks.length,
    longTaskMaxMs: longTasks.length ? rounded(Math.max(...longTasks.map((task) => task.ms))) : 0,
  });
}

function inspectRoute(route) {
  const reportPath = path.join(evidenceRoot, route.label, 'report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.error, undefined, `${route.label} retains a benchmark error.`);
  assert.equal(report.label, route.label);
  assert.equal(report.singularityMode, route.mode);
  assert.equal(report.evidenceClass, 'local-default-graphics-cdp-performance-benchmark');
  assert.equal(report.diagnosticDisableGpu, false);
  assert.equal(report.diagnosticInProcessGpu, false);
  assert.equal(report.diagnosticNoSandbox, false);
  assert.equal(report.diagnosticSingleProcess, false);
  assert.equal(report.diagnosticDisableTransitionTuning, false);
  assert.equal(report.count, route.tracks);
  assert.equal(report.ownerAcceptance, false);
  assert.equal(report.physicalHardwareEvidence, false);
  assert.equal(report.releaseCandidateEvidence, false);
  assert.equal(report.actionProfileEvidence, route.sample === 'stress', `${route.label} action-profile evidence class drifted.`);
  assert.equal(report.gpu?.featureStatus?.gpu_compositing, 'enabled');
  assert.equal(report.gpu?.auxAttributes?.inProcessGpu, false);
  assert.equal(report.gpu?.auxAttributes?.processCrashCount, 0);
  assert.match(report.gpu?.auxAttributes?.glRenderer || '', /ANGLE.+Direct3D11/i);
  assert.equal(report.runs.length, route.runs, `${route.label} run count drifted.`);

  for (const [relativePath, expectedHash] of Object.entries(report.sourceHashes || {})) {
    assert.equal(sha256(path.join(root, relativePath)), expectedHash, `${route.label} source hash drifted: ${relativePath}`);
  }

  const expectedCounts = Object.freeze({ keyboard: 24, search: 6, 'queue-open': 3, 'queue-close': 3, 'settings-open': 3, 'settings-close': 3, scroll: 3, 'theme-reapply': 1, play: 1, pause: 1, 'mini-open': 1 });
  report.runs.forEach((run, index) => {
    assert.equal(run.run, index);
    assert.equal(run.singularity?.mode, route.mode);
    assert.equal(run.singularity?.ready, 'true');
    assert.equal(run.singularity?.hostMode, route.mode);
    assert.equal(run.singularity?.tracksState, 'rectified-open');
    assert.equal(run.singularity?.tracksInert, false);
    assert.equal(run.singularityRelease?.snapshot?.presentation?.openId, 'tracks');
    assert.equal(run.singularityRelease?.root?.state, 'rectified-open');
    assert.equal(run.singularityRelease?.root?.inert, false);
    assert.equal(run.singularityRelease?.root?.ariaHidden, 'false');
    assert.equal(run.singularityRelease?.root?.hidden, false);
    assert.equal((run.exceptions || []).length, 0);
    assert(run.timings?.measurementFrames?.length > 0, `${route.label} run ${index} lacks bounded measurement frames.`);
    assert(Array.isArray(run.timings?.measurementLongTasks), `${route.label} run ${index} lacks bounded long-task evidence.`);
    assert.equal(run.selection?.selected, 1);
    assert.equal(run.selection?.current, run.confirmedBefore);
    assert.equal(run.mini?.buttons > 0, true);
    for (const [prefix, count] of Object.entries(expectedCounts)) {
      assert.equal(actionGroup(run.actions || [], prefix).length, count, `${route.label} run ${index} action count drifted: ${prefix}`);
    }
    for (const action of run.actions || []) {
      assert(Number.isFinite(action.handlerMs) && Number.isFinite(action.paintMs));
      assert(Number.isFinite(action.maxFrameMs) && Array.isArray(action.longTasks));
      assert(action.cdpMetricDeltas && Object.values(action.cdpMetricDeltas).every(Number.isFinite), `${route.label} run ${index} lacks per-action metric deltas.`);
      for (const state of [action.stateBefore, action.stateAfter]) {
        assert(state && ['full', 'balanced', 'conserve'].includes(state.performance), `${route.label} run ${index} lacks a valid action performance-state receipt.`);
        assert.equal(typeof state.playing, 'boolean', `${route.label} run ${index} lacks an action playback-state receipt.`);
        assert.equal(typeof state.legacyPlaying, 'boolean', `${route.label} run ${index} lacks a legacy playback-state receipt.`);
        assert.equal(typeof state.playbackPhase, 'string', `${route.label} run ${index} lacks a Singularity playback-phase receipt.`);
        assert.equal(typeof state.windowResizing, 'string', `${route.label} run ${index} lacks a resize-state receipt.`);
        assert.equal(typeof state.singularityModal, 'string', `${route.label} run ${index} lacks a modal-state receipt.`);
        assert.equal(typeof state.hostPointerEvents, 'string', `${route.label} run ${index} lacks a host pointer-boundary receipt.`);
        assert.equal(typeof state.hostAriaHidden, 'string', `${route.label} run ${index} lacks a host accessibility-boundary receipt.`);
        assert.equal(typeof state.hostInert, 'boolean', `${route.label} run ${index} lacks a host inert-state receipt.`);
      }
      if (action.name.startsWith('settings-open:')) {
        assert.equal(action.stateAfter.singularityModal, 'settings');
        assert.equal(action.stateAfter.hostPointerEvents, 'none');
        assert.equal(action.stateAfter.hostAriaHidden, 'true');
        assert.equal(action.stateAfter.hostInert, false);
      }
      if (action.name.startsWith('settings-close:')) {
        assert.equal(action.stateAfter.singularityModal, 'none');
        assert.equal(action.stateAfter.hostPointerEvents, '');
        assert.equal(action.stateAfter.hostAriaHidden, 'false');
        assert.equal(action.stateAfter.hostInert, false);
      }
    }
    const expectedProfileNames = route.sample === 'stress'
      ? ['queue-open:1440', 'settings-open:1440', 'scroll:1440', 'queue-open:1100', 'settings-open:1100', 'scroll:1100', 'queue-open:820', 'settings-open:820', 'scroll:820', 'theme-reapply', 'play', 'pause']
      : [];
    assert.deepEqual((run.actionProfiles || []).map((profile) => profile.name), expectedProfileNames, `${route.label} run ${index} action-profile sequence drifted.`);
    for (const profile of run.actionProfiles || []) {
      const absolutePath = path.join(root, profile.file);
      assert(absolutePath.startsWith(path.join(evidenceRoot, route.label) + path.sep), `${route.label} action profile escaped its evidence directory.`);
      assert.equal(sha256(absolutePath), profile.sha256, `${route.label} action profile hash drifted: ${profile.name}`);
      assert(Array.isArray(profile.hotspots) && profile.hotspots.length > 0, `${route.label} action profile lacks summarized hotspots: ${profile.name}`);
      const action = (run.actions || []).find((candidate) => candidate.name === profile.name);
      assert.equal(action?.cpuProfile?.file, profile.file, `${route.label} action receipt/profile path drifted: ${profile.name}`);
      assert.equal(action?.cpuProfile?.sha256, profile.sha256, `${route.label} action receipt/profile hash drifted: ${profile.name}`);
    }
  });

  const actions = report.runs.flatMap((run) => run.actions);
  const measuredFrames = report.runs.flatMap((run) => run.timings.measurementFrames).map((frame) => frame.ms);
  const measuredLongTasks = report.runs.flatMap((run) => run.timings.measurementLongTasks);
  const summaries = Object.fromEntries(Object.keys(expectedCounts).map((prefix) => [prefix, summarizeActions(actions, prefix)]));
  const wideScroll = summarizeActions(actions.filter((action) => action.name === 'scroll:1440'), 'scroll');
  const repairSignals = [];
  if (percentile(measuredFrames, 0.95) > 16.7) repairSignals.push('post-settle-frame-p95-over-16.7ms');
  if (summaries['theme-reapply'].longTaskCount > 0) repairSignals.push('theme-reapply-long-task-every-run');
  if (summaries.play.paintMedianMs > 100) repairSignals.push('confirmed-play-paint-median-over-100ms');
  if (wideScroll.paintMedianMs > 50) repairSignals.push('wide-full-list-scroll-paint-median-over-50ms');
  assert(repairSignals.length > 0, `${route.label} unexpectedly has no recorded performance repair signal; review thresholds before promoting it.`);

  return Object.freeze({
    mode: route.mode,
    sample: route.sample,
    report: path.relative(root, reportPath).replaceAll('\\', '/'),
    reportSha256: sha256(reportPath),
    runs: report.runs.length,
    tracks: report.count,
    launchToReadyMedianMs: rounded(median(report.runs.map((run) => run.launchToObservedReadyMs))),
    measuredFrameP95Ms: rounded(percentile(measuredFrames, 0.95)),
    measuredFrameMaxMs: rounded(Math.max(...measuredFrames)),
    measuredLongTaskCount: measuredLongTasks.length,
    measuredLongTaskMedianMs: rounded(median(measuredLongTasks.map((task) => task.ms))),
    actions: summaries,
    wideScroll,
    repairSignals: Object.freeze(repairSignals),
    gpu: Object.freeze({
      compositor: report.gpu.featureStatus.gpu_compositing,
      renderer: report.gpu.auxAttributes.glRenderer,
      driverVersion: report.gpu.devices?.[0]?.driverVersion || '',
    }),
  });
}

const results = routes.map(inspectRoute);
assert(results.every((result) => result.gpu.renderer === results[0].gpu.renderer), 'Route reports were not captured on the same graphics renderer.');
assert(results.every((result) => result.gpu.driverVersion === results[0].gpu.driverVersion), 'Route reports were not captured on the same graphics driver.');

console.log(JSON.stringify({
  integrityStatus: 'PASS',
  performanceDisposition: 'REPAIR',
  routeSelection: null,
  results,
  boundaries: Object.freeze({
    ownerAcceptance: false,
    controlledPhysicalHardwareAcceptance: false,
    releaseCandidateEvidence: false,
    routeWinnerInferred: false,
  }),
}, null, 2));
