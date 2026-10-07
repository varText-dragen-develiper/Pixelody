const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guards measured performance fixes. Each assertion names the cost it
// prevents; for the measurements.
const root = path.resolve(__dirname, '..');
// Windows checkouts may use CRLF; the source patterns below assume LF.
const readSource = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const renderer = readSource('src', 'renderer.js');

// Top-level renderer functions end with a closing brace in column 0.
function functionSource(name) {
  const match = renderer.match(new RegExp(`\\n(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `renderer function ${name} was not found`);
  return match[0];
}

{
  const rawWrites = renderer.split('\n').filter((line) => /localStorage\.setItem\(/.test(line) && !/^\s*\/\//.test(line));
  assert.equal(rawWrites.length, 1, 'localStorage writes must go through setLocalStorageItem(); a raw quota error aborts the caller');
}

{
  const code = functionSource('persist').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.ok(!/localStorage\.|setLocalStorageItem\(|JSON\.stringify/.test(code), 'persist() must not serialize the library synchronously; the durable store is authoritative');
  assert.ok(code.includes("scheduleDurableStatePersist(DURABLE_PERSIST_AFTER_RESPONSE_MS, 'core-state-persist')"), 'persist() must always schedule the durable save, after the frames that answer the click');
}

{
  // Trimmed durable payloads may only stand in for requests that allow them;
  // otherwise a frequent trimmed save could replace a pending library save.
  const merge = functionSource('mergeDurableWriteReasons');
  assert.ok(/DURABLE_LIBRARY_OMITTED_REASONS\.has\(next\) && !DURABLE_LIBRARY_OMITTED_REASONS\.has\(pending\)\) return pending;/.test(merge), 'combining a trimmed save with a full one must keep the full reason');
  assert.ok(/mergeReasons: mergeDurableWriteReasons/.test(renderer), 'the durable-state controller must use the renderer reason-merge rule');
}

{
  const restore = renderer.match(/\$\('#importBackup'\)\.onclick = async \(\) => \{[\s\S]*?\n\};/);
  assert.ok(restore, 'backup restore handler was not found');
  assert.ok(/durableStateController\.suspend\(\);[\s\S]*?importBackupToState\(/.test(restore[0]), 'restore must suspend saves before sending the import, or a stale save can land after it');
  assert.ok(/durableStateController\.resume\(\);/.test(restore[0]), 'a refused restore must resume saving');
}

assert.ok(!functionSource('broadcastPlayerState').includes('getComputedStyle'), 'broadcastPlayerState() runs up to 4x/s; getComputedStyle forces a full-document style recalc');

{
  const update = functionSource('updateDiagnostics');
  assert.ok(update.includes('requestAnimationFrame') && !/^\s*return diagnosticsController\.render\(\)/m.test(update), 'updateDiagnostics() must coalesce renders to one per frame');
  assert.ok(/LOCAL_STORAGE_BYTES_TTL_MS/.test(functionSource('localStorageBytes')), 'localStorageBytes() must cache the full localStorage scan');
}

assert.ok(/queueDrawer\?\.classList\.contains\('hidden'\)[\s\S]{0,120}queueListStale = true;[\s\S]{0,80}return;/.test(functionSource('renderQueue')), 'renderQueue() must not rebuild up to 200 rows twice per track start while the drawer is closed; openQueue() flushes it');
assert.ok(/flushQueueRender\(\);/.test(functionSource('openQueue')), 'openQueue() must render a stale queue before showing it');

assert.ok(/function drawCurve\([^\n]*\{\n  drawCurveArgs = \[trackEq, systemEq\];\n  if \(drawCurveFrame\) return;\n  drawCurveFrame = requestAnimationFrame/.test(renderer), 'drawCurve() must defer to one frame; reading layout and style inside a track-change handler forces a layout the frame repeats (~22 ms per skip)');
assert.ok(/persistSignalJournalSoon\(\);\s*return event;/.test(functionSource('recordSignalEvent')), 'recordSignalEvent() runs on every play and skip and must not write the journal and refresh the dashboard synchronously');

for (const name of ['syncQuestMiniMap', 'syncQuestCollectionPanel']) {
  assert.ok(/\{\s*if \(!cartridgeQuestExperienceActive\(\)\) return;/.test(functionSource(name)), `${name}() runs on every timeupdate and must skip work while Cartridge Quest is hidden`);
}
assert.ok(/if \(cartridgeQuestExperienceActive\(\) && !motionDisabled\(\)\) \{\s*void element\.offsetWidth;/.test(functionSource('setQuestBootMessage')), 'the boot-message flash forces layout and must only restart when visible');

{
  const addPaths = functionSource('addPaths');
  assert.ok(/tracksById\.get\(id\)/.test(addPaths) && !/state\.tracks\.find\(/.test(addPaths), 'import must look tracks up through an index; a linear search per file is quadratic');
  assert.ok(/destinationIds\.has\(id\)/.test(addPaths) && !/destination\.trackIds\.includes\(/.test(addPaths), 'import must check playlist membership through a set');
}

{
  // Every row of the library used to stay in the DOM, so each body-level
  // state change restyled all of them (~800 ms per play/pause at 10,000
  // tracks). scripts/check-linear-list.js drives the behaviour; these hold
  // the design in place.
  const linearList = readSource('src', 'theme-runtime', 'navigation', 'linear-list.js');
  const paint = linearList.match(/\n    function paint\(container, tracks, activeId, options = \{\}\) \{[\s\S]*?\n    \}\n/)?.[0] || '';
  assert.ok(paint, 'linear-list paint() was not found');
  assert.ok(/if \(measurable\(container\)\) \{\s*syncPendingSpace\(container\);\s*scheduleFill\(\);/.test(paint), 'in a browser, paint() must materialize rows on demand, not append the whole list');
  assert.ok(/!animateRows && !options\.forceFull && refreshInPlace\(/.test(paint), 'repaints must refresh materialized rows in place');
  assert.ok(/AHEAD_PX/.test(linearList) && /FRAME_BUDGET_MS/.test(linearList), 'row materialization must be viewport-driven and frame-budgeted');
  assert.ok(/addEventListener\('scroll', onViewportChange, \{ capture: true, passive: true \}\)/.test(linearList), 'rows must be materialized from scrolls in any theme scroll container');
  assert.ok(/ensureRendered\(index\);\s*const changed = id !== selectedId;/.test(linearList), 'keyboard selection must materialize its target row before selecting it');
  assert.ok(/index < near\.first \|\| index > near\.last\)\) \{ staleRows\.add\(index\); continue; \}/.test(linearList), 'a refresh must re-render only rows near the viewport, or it costs every materialized row');
  const css = readSource('src', 'playback-performance.css');
  assert.ok(/@property --track-rows-pending-height\{syntax:"<length>";inherits:false/.test(css), 'the pending-row spacer height must be non-inherited so updating it restyles only the spacer');
  assert.ok(/#trackRows::after\{[^}]*overflow-anchor:none/.test(css), 'the pending-row spacer must never be the scroll anchor');
  // Row templates escape three fields per row on every repaint.
  assert.ok(!/createElement/.test(functionSource('escapeHtml')), 'escapeHtml() must not create an element per call');
}

{
  // planSession() runs over the whole library for Daily Curated at startup.
  // Copying the remaining-candidate list per expansion made it quadratic
  // (~19 s at 3,000 tracks); expansions are now scored from cached features
  // and only survivors get detailed breakdowns.
  const planner = require('../src/flow-shuffle-planner');
  let seed = 4242;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const candidates = Array.from({ length: 1500 }, (_, index) => ({
    id: `plan-${index}`, artist: pick(['A', 'B', 'C', '']), album: pick(['One', 'Two', '']), genre: pick(['Jazz', 'Rock', '']),
    energy: random() < 0.3 ? undefined : random(), bpm: pick([undefined, 96, 120, 128]), musicalKey: pick(['C', 'Am', 'F#', '']),
  }));
  for (const shape of ['steady', 'rise', 'wave']) {
    const plan = planner.planSession({ candidates: candidates.slice(0, 60), current: candidates[61], shape, horizon: 8, beamWidth: 6, baseScores: { 'plan-3': 5, 'plan-9': 2 } });
    const stepTotal = plan.steps.reduce((sum, step) => sum + step.totalPoints, 0);
    assert.equal(Math.round(stepTotal), plan.score, 'plan scores must match the detailed breakdowns reported for each step');
    plan.steps.forEach((step) => assert.equal(step.transitionPoints, planner.transitionBreakdown(plan.steps[step.position - 2] ? { ...candidates.find((track) => track.id === step.previousTrackId) } : candidates[61], candidates.find((track) => track.id === step.trackId), { shape, position: step.position - 1, horizon: 8, sessionStartEnergy: candidates[61].energy ?? null }).totalPoints, 'fast transition scoring must match transitionBreakdown()'));
  }
  const startedAt = performance.now();
  planner.planSession({ candidates, horizon: 10, beamWidth: 8 });
  const elapsed = performance.now() - startedAt;
  // ~60 ms locally; the quadratic version took ~4.5 s at this size.
  assert.ok(elapsed < 3000, `planSession() over 1,500 candidates took ${Math.round(elapsed)} ms; it must stay linear in library size`);
}

{
  // Baseline rankings include metadata ties, Unicode/delimiter IDs and album
  // units truncated at the horizon. Optimization must preserve the plan.
  const planner = require('../src/flow-shuffle-planner');
  const fixtures = [{"albumPolicy":"track","horizon":5,"rich":false,"ids":["a|b12","a|b17","a|b2","a|b22","a|b27"],"score":0},{"albumPolicy":"track","horizon":5,"rich":true,"ids":["a|b17","E26","track-34","track-79","a|b7"],"score":52},{"albumPolicy":"track","horizon":7,"rich":false,"ids":["a|b12","a|b17","a|b2","a|b22","a|b27","a|b32","a|b42"],"score":0},{"albumPolicy":"track","horizon":7,"rich":true,"ids":["a|b17","A8","é70","é25","track-34","a|b52","track-44"],"score":69},{"albumPolicy":"track","horizon":10,"rich":false,"ids":["a|b12","a|b17","a|b2","a|b22","a|b27","a|b32","a|b42","a|b37","a|b47","a|b52"],"score":0},{"albumPolicy":"track","horizon":10,"rich":true,"ids":["a|b17","A8","é70","track-79","track-34","E26","a|b32","é15","a|b7","a|b52"],"score":95},{"albumPolicy":"album","horizon":5,"rich":false,"ids":["a|b12","a|b17","a|b2","a|b22","a|b27"],"score":0},{"albumPolicy":"album","horizon":5,"rich":true,"ids":["a|b17","E26","track-34","track-79","a|b7"],"score":52},{"albumPolicy":"album","horizon":7,"rich":false,"ids":["a|b12","a|b17","a|b2","a|b22","a|b27","a|b32","a|b42"],"score":0},{"albumPolicy":"album","horizon":7,"rich":true,"ids":["a|b17","A8","é70","é25","track-34","a|b52","track-44"],"score":69},{"albumPolicy":"album","horizon":10,"rich":false,"ids":["a|b12","a|b17","a|b2","a|b22","a|b27","a|b32","a|b42","a|b37","a|b47","a|b52"],"score":0},{"albumPolicy":"album","horizon":10,"rich":true,"ids":["a|b17","A8","é70","track-79","track-34","E26","a|b32","é15","a|b7","a|b52"],"score":95}];
  for (const fixture of fixtures) {
    const { albumPolicy, horizon, rich } = fixture;
    const candidates = Array.from({ length: 80 }, (_, i) => ({
      id: ['é', 'E', 'a|b', 'A', 'track-'][i % 5] + i,
      artist: 'Artist ' + i % 7, album: 'Album ' + Math.floor(i / 3), trackNumber: i % 3 + 1,
      genre: rich ? ['Jazz', 'Rock', 'Folk'][i % 3] : '', energy: rich ? (i % 9) / 8 : undefined,
      bpm: rich ? 80 + i % 70 : undefined, musicalKey: rich ? ['Am', 'C', 'F#'][i % 3] : undefined,
    }));
    const plan = planner.planSession({ candidates, current: candidates[17], horizon, beamWidth: 8, albumPolicy, preserveAlbumRuns: albumPolicy === 'album', shape: 'wave' });
    assert.deepEqual(plan.ids, fixture.ids, 'cached tie keys must preserve the baseline ranking');
    assert.equal(plan.score, fixture.score, 'cached tie keys must preserve the baseline score');
  }
}

console.log('Performance audit passed: Flow planning is linear in library size and its fast scoring matches the detailed breakdowns, and the renderer save path, player broadcasts, diagnostics, hidden Cartridge Quest panels, imports and track rows stay off their measured hot paths.');
