'use strict';

// Picking a pane up should not move it.
//
// That is the whole invariant. Press on a pane, move the pointer nowhere, and
// the pane must still be exactly where it was; move the pointer by one column
// and it must move by one column. Anything else means the place you grabbed
// the pane is not the place you are carrying it by, and a wide pane thrown
// half its own width sideways the instant you touch it is what "blocky" means.
//
// gridPlacementAtPoint is lifted out of canvas-studio.js and run against a
// real rendered grid, so this measures the shipped arithmetic rather than a
// description of it.
//
//   node scripts/probe-grab-offset.js
//
// Needs `playwright`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const studio = fs.readFileSync(path.join(ROOT, 'src/workspace-composition/canvas-studio.js'), 'utf8');

function lift(name) {
  const found = [...studio.matchAll(new RegExp(`^ {4}(?:function ${name}\\(|const ${name} = )`, 'gm'))];
  assert.equal(found.length, 1, `probe-grab-offset.js lifts \`${name}\` and found ${found.length} declarations of it.`);
  const lines = studio.slice(found[0].index).split('\n');
  if (/;\s*$/.test(lines[0]) && !/[{[(]\s*$/.test(lines[0])) return lines[0];
  for (let index = 1; index < lines.length; index += 1) {
    if (/^ {4}\}\)?;?\s*$/.test(lines[index])) return lines.slice(0, index + 1).join('\n');
  }
  throw new Error(`probe-grab-offset.js could not find the end of \`${name}\`.`);
}
const LIFTED = ['walk', 'findNode', 'parentOf', 'selectedGridPlacement', 'MAX_ROWS', 'MAX_COLUMNS', 'DEFAULT_COLUMNS', 'snapLines', 'SNAP_PIXELS', 'snappedStart', 'gridContentBox', 'gridPlacementAtPoint']
  .map(lift).join('\n\n');
// Gesture state the lifted code reads; no player bar in this fixture.
const LIFTED_STATE = 'let heroFold = null;';

// The archive frame, in fine units. The Stage is the wide one: 56 of 96.
const PANES = [
  { id: 'library', columnStart: 1, columnSpan: 20 },
  { id: 'stage', columnStart: 21, columnSpan: 56 },
  { id: 'utility', columnStart: 77, columnSpan: 20 },
];
const GRID_ID = 'workspace';

const markup = PANES.map((p) => `<div class="cw-node cw-module" data-cw-node-id="${p.id}" data-cw-placed="true" data-cw-positioned="true"
  style="--cw-column-start:${p.columnStart};--cw-row-start:1;--cw-column-span:${p.columnSpan};--cw-row-span:6"></div>`).join('');

(async () => {
  const { chromium } = require('playwright');
  const css = ['src/styles.css', 'src/foreground.css'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
    <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
    <body data-theme="foreground" data-composition-mode="edit" style="--canvas-port-gutter:8px">
      <div class="cw-surface"><div class="cw-canvas"><div class="cw-root" style="width:1200px">
        <div class="cw-grid" data-cw-node-id="${GRID_ID}" style="--cw-columns:96">${markup}</div>
      </div></div></div></body></html>`, { waitUntil: 'load' });

  const results = await tab.evaluate(({ source, state, panes, gridId }) => {
    const documentObject = document;
    // eslint-disable-next-line no-new-func
    const scope = new Function('documentObject', `${state}\n${source}\nreturn { gridPlacementAtPoint };`)(documentObject);
    const grid = document.querySelector(`.cw-grid[data-cw-node-id="${gridId}"]`);
    const graph = {
      id: gridId, type: 'grid', columns: 96,
      children: panes.map((p) => ({ id: p.id, type: 'module', moduleKey: `${p.id}.module`,
        placement: { columnStart: p.columnStart, rowStart: 1, columnSpan: p.columnSpan, rowSpan: 6 } })),
    };
    const out = [];
    for (const pane of panes) {
      const element = document.querySelector(`[data-cw-node-id="${pane.id}"]`);
      const box = element.getBoundingClientRect();
      // Three places to take hold of it: near the left edge, the middle, and
      // near the right edge.
      // The drag chip sits at 52px/10px inside the pane, and today it is the
      // only place a drag can start from. The other three are where a person
      // would take hold of the pane if the whole pane could be grabbed.
      const holds = [['drag chip', null], ['left edge', 0.05], ['middle', 0.5], ['right edge', 0.95]];
      for (const [where, ratio] of holds) {
        const x = ratio === null ? box.left + 62 : box.left + (box.width * ratio);
        const y = ratio === null ? box.top + 18 : box.top + (box.height * 0.5);
        const interaction = { sourceId: pane.id, startX: x, startY: y };
        const landed = scope.gridPlacementAtPoint(graph, interaction, grid, x, y);
        out.push({ pane: pane.id, where, was: pane.columnStart, landed: landed?.columnStart ?? null });
      }
    }
    // And the other half: the pane must follow the pointer one for one. Take
    // hold of the Stage at three places, push the pointer across the canvas a
    // column at a time, and the pane should move exactly as far.
    const tracking = [];
    {
      const element = document.querySelector('[data-cw-node-id="stage"]');
      const box = element.getBoundingClientRect();
      const gridBox = grid.getBoundingClientRect();
      const pitch = gridBox.width / 96;
      for (const [where, ratio] of [['drag chip', null], ['middle', 0.5], ['right edge', 0.95]]) {
        const x0 = ratio === null ? box.left + 62 : box.left + (box.width * ratio);
        const y0 = ratio === null ? box.top + 18 : box.top + (box.height * 0.5);
        const interaction = { sourceId: 'stage', startX: x0, startY: y0 };
        const from = scope.gridPlacementAtPoint(graph, interaction, grid, x0, y0);
        let worstSlip = 0;
        let steps = 0;
        for (let step = -20; step <= 20; step += 1) {
          // Aim at the middle of the target track, the way a person aiming at a
          // column does, rather than at its seam.
          const landed = scope.gridPlacementAtPoint(graph, interaction, grid, x0 + (step * pitch), y0);
          if (!landed) continue;
          const wanted = Math.max(1, Math.min(96 - from.columnSpan + 1, from.columnStart + step));
          worstSlip = Math.max(worstSlip, Math.abs(landed.columnStart - wanted));
          steps += 1;
        }
        tracking.push({ where, steps, worstSlip });
      }
    }
    return { out, tracking };
  }, { source: LIFTED, state: LIFTED_STATE, panes: PANES, gridId: GRID_ID });

  await browser.close();

  console.log('Picking a pane up, without moving the pointer at all\n');
  console.log('  pane       grabbed at    was at column   would land at   moved by');
  let worst = 0;
  for (const row of results.out) {
    const moved = row.landed === null ? NaN : row.landed - row.was;
    if (Number.isFinite(moved)) worst = Math.max(worst, Math.abs(moved));
    console.log(`  ${row.pane.padEnd(10)} ${row.where.padEnd(12)} ${String(row.was).padStart(13)} ${String(row.landed).padStart(15)} ${String(moved).padStart(10)}`);
  }
  console.log(`\n  worst jump on pick-up: ${worst} columns\n`);
  console.log('Pushing the pointer across the canvas, one column at a time\n');
  console.log('  held by       steps   worst slip from the pointer');
  let worstSlip = 0;
  for (const row of results.tracking) {
    worstSlip = Math.max(worstSlip, row.worstSlip);
    console.log(`  ${row.where.padEnd(13)} ${String(row.steps).padStart(5)} ${String(row.worstSlip).padStart(29)}`);
  }
  console.log(`\n  worst slip while dragging: ${worstSlip} columns`);
  if (worstSlip > 0) {
    console.log('\n  The pane does not follow the pointer one for one.');
    process.exit(1);
  }
  if (worst > 0) {
    console.log('\n  A pane moves the moment it is touched. The point it is carried by is its\n  top-left corner, not the point it was grabbed at.');
    process.exit(1);
  }
  console.log('\n  A pane stays where it is until the pointer moves.');
})();
