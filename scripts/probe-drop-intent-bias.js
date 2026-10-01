'use strict';

// Where on the canvas can a pane actually be placed, rather than attached?
//
// updatePaneDrag decides between the two like this:
//
//   let target = pointElement.closest('.cw-module[data-cw-node-id]');
//   if (target === source) target = null;
//   if (!target) { ...free grid placement...  }
//   ...otherwise rank attach intents and take the first...
//
// So free placement is only reached when the pointer is over no other module,
// and attaching is what happens everywhere else. On a composition whose panes
// fill the canvas -- which the archive frame does by definition -- that is
// almost nowhere. gridPlacementAtPoint adds two more conditions: the pane's own
// parent must be a grid, and it must be the same grid the pointer is over.
//
// This probe does not judge the ranking. It only counts, position by position,
// which branch a drag would take.
//
//   node scripts/probe-drop-intent-bias.js
//
// Needs `playwright`.

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

// Read the band out of canvas-studio.js rather than restating it, so a change
// to the rule shows up here as a change in the numbers.
const studio = fs.readFileSync(path.join(ROOT, 'src/workspace-composition/canvas-studio.js'), 'utf8');
const constant = (name) => {
  const found = studio.match(new RegExp(`^ {4}const ${name} = ([0-9.]+);`, 'm'));
  if (!found) throw new Error(`probe-drop-intent-bias.js reads ${name} out of canvas-studio.js and could not find it.`);
  return Number(found[1]);
};
const BAND = constant('ATTACH_BAND');
const BAND_MAX = constant('ATTACH_BAND_MAX');

// Fixture one: the archive frame, three panes filling the workspace.
const FRAME = `
  <div class="cw-node cw-module" data-cw-node-id="library" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:1;--cw-row-start:1;--cw-column-span:20;--cw-row-span:6"></div>
  <div class="cw-node cw-module" data-cw-node-id="stage" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:21;--cw-row-start:1;--cw-column-span:56;--cw-row-span:6"></div>
  <div class="cw-node cw-module" data-cw-node-id="utility" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:77;--cw-row-start:1;--cw-column-span:20;--cw-row-span:6"></div>`;

// Fixture two: the same, but the utility pane has been stacked onto another --
// "collapse some things and attach some things to others". Its parent is now a
// stack, not the grid.
const ATTACHED = `
  <div class="cw-node cw-module" data-cw-node-id="library" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:1;--cw-row-start:1;--cw-column-span:20;--cw-row-span:6"></div>
  <div class="cw-node cw-module" data-cw-node-id="stage" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:21;--cw-row-start:1;--cw-column-span:56;--cw-row-span:6"></div>
  <div class="cw-node cw-stack" data-cw-node-id="right-stack" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:77;--cw-row-start:1;--cw-column-span:20;--cw-row-span:6">
    <div class="cw-node cw-module" data-cw-node-id="utility" data-cw-placed="true"></div>
  </div>`;

const CASES = [
  { name: 'the archive frame', markup: FRAME, sources: ['library', 'stage', 'utility'], parents: { library: 'grid', stage: 'grid', utility: 'grid' } },
  { name: 'after utility is stacked', markup: ATTACHED, sources: ['library', 'stage', 'utility'], parents: { library: 'grid', stage: 'grid', utility: 'stack' } },
];

(async () => {
  const { chromium } = require('playwright');
  const css = ['src/styles.css', 'src/foreground.css'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  console.log('For each pane being dragged, where on the canvas would a drop be free placement?\n');
  console.log('  composition                pane       free      attach   unreachable');
  let worstFree = 100;
  let worstGrid = 100;
  const trapped = [];
  for (const testCase of CASES) {
    await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
      <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
      <body data-theme="foreground" data-composition-mode="edit" style="--canvas-port-gutter:8px">
        <div class="cw-surface"><div class="cw-canvas"><div class="cw-root" style="width:1200px">
          <div class="cw-grid" data-cw-node-id="workspace" style="--cw-columns:96">${testCase.markup}</div>
        </div></div></div></body></html>`, { waitUntil: 'load' });

    const rows = await tab.evaluate(({ sources, parents, band, bandMax }) => {
      const grid = document.querySelector('.cw-grid[data-cw-node-id]');
      // Sample the band the panes actually occupy, not the whole grid. In edit
      // mode the grid is stretched to the artboard, so most of it is empty
      // space below the composition -- counting that as "free" would flatter
      // the result and say nothing about placing a pane next to another one.
      const boxes = [...grid.children].map((child) => child.getBoundingClientRect());
      const box = {
        left: Math.min(...boxes.map((b) => b.left)),
        top: Math.min(...boxes.map((b) => b.top)),
        right: Math.max(...boxes.map((b) => b.right)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      };
      box.width = box.right - box.left;
      box.height = box.bottom - box.top;
      const out = [];
      // The same band test the studio uses, lifted by value so this probe
      // reports the shipped rule rather than a guess at it.
      const inBand = (element, x, y) => {
        const r = element.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return false;
        const bx = Math.min(r.width * band, bandMax);
        const by = Math.min(r.height * band, bandMax);
        return (x - r.left) < bx || (r.right - x) < bx || (y - r.top) < by || (r.bottom - y) < by;
      };
      for (const sourceId of sources) {
        let free = 0; let attach = 0; let none = 0;
        // A 40 x 24 sample of the workspace the panes occupy.
        for (let ix = 0; ix < 40; ix += 1) {
          for (let iy = 0; iy < 24; iy += 1) {
            const x = box.left + ((ix + 0.5) / 40) * box.width;
            const y = box.top + ((iy + 0.5) / 24) * box.height;
            const at = document.elementFromPoint(x, y);
            let target = at?.closest?.('.cw-module[data-cw-node-id]') || null;
            if (target?.dataset.cwNodeId === sourceId) target = null;
            if (target && !inBand(target, x, y)) target = null;
            if (target) { attach += 1; continue; }
            // The free branch: over a grid, and the source's own parent is that
            // same grid.
            const gridSurface = at?.closest?.('.cw-grid[data-cw-node-id]');
            if (gridSurface && parents[sourceId] === 'grid') free += 1;
            else none += 1;
          }
        }
        const total = free + attach + none;
        out.push({ sourceId, free: (free / total) * 100, attach: (attach / total) * 100, none: (none / total) * 100 });
      }
      return out;
    }, { sources: testCase.sources, parents: testCase.parents, band: BAND, bandMax: BAND_MAX });

    for (const row of rows) {
      if (testCase.parents[row.sourceId] === 'grid') worstGrid = Math.min(worstGrid, row.free);
      else if (row.free === 0) trapped.push(`${row.sourceId} (${testCase.name})`);
      worstFree = Math.min(worstFree, row.free);
      console.log(`  ${testCase.name.padEnd(26)} ${row.sourceId.padEnd(10)} ${row.free.toFixed(1).padStart(5)}%  ${row.attach.toFixed(1).padStart(8)}%  ${row.none.toFixed(1).padStart(11)}%`);
    }
  }
  await browser.close();

  console.log(`\n  least free placement available to a pane the grid holds: ${worstGrid.toFixed(1)}%`);
  console.log(`  panes that cannot be placed anywhere at all: ${trapped.length ? trapped.join(', ') : 'none'}`);
  console.log('\n  "free" means the drop lands on the cell under the pointer.');
  console.log('  "attach" means the drop becomes a split, dock or stack onto whatever');
  console.log('  pane is under the pointer, whether or not that was the intention.');
  console.log('  "unreachable" means neither branch resolves -- the pane cannot be put there.');
  console.log(`  attach band: the outer ${(BAND * 100).toFixed(0)}% of a pane, up to ${BAND_MAX}px.`);
  let failed = false;
  if (worstGrid < 60) {
    console.log('\n  Attaching is still the common case for a pane the grid holds. Free placement\n  should be what a drop does unless the pointer is aimed at an edge.');
    failed = true;
  }
  if (trapped.length) {
    console.log('\n  A pane whose parent is a stack or a split cannot be placed anywhere on the\n  canvas -- gridPlacementAtPoint requires the pane\'s own parent to be the grid\n  under the pointer, so the only thing it can do is attach somewhere else.');
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('\n  A drop places; aiming at an edge attaches.');
})();
