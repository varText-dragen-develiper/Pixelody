'use strict';

// Does a shift actually put a pane on the cell it was aimed at?
//
// The drag no longer rewrites a neighbour's grid placement; it translates the
// pane by (target cell - where it started). That arithmetic has to agree with
// what CSS grid would itself have done, to the pixel, or panes drift as they
// slide and land somewhere other than where the preview promised.
//
//   node scripts/probe-drag-motion.js            human-readable
//   node scripts/probe-drag-motion.js --json     machine-readable
//
// Needs `playwright`. Not in `npm run check` -- it needs a browser.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COLUMNS = 24;
const TOLERANCE = 1.0;

function page(css) {
  const panes = [
    { id: 'library', columnStart: 1, columnSpan: 5, rowStart: 1, rowSpan: 2 },
    { id: 'stage', columnStart: 6, columnSpan: 14, rowStart: 1, rowSpan: 2 },
    { id: 'utility', columnStart: 20, columnSpan: 5, rowStart: 1, rowSpan: 2 },
    { id: 'queue', columnStart: 1, columnSpan: 8, rowStart: 3, rowSpan: 1 },
  ].map((pane) => `<div class="cw-node cw-module" data-cw-node-id="${pane.id}" data-cw-placed="true" data-cw-positioned="true"
      style="--cw-column-start:${pane.columnStart};--cw-row-start:${pane.rowStart};--cw-column-span:${pane.columnSpan};--cw-row-span:${pane.rowSpan}"><p>${pane.id}</p></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
    <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
    <body data-theme="foreground" data-composition-mode="edit" data-cw-studio="open" data-cw-studio-lifted="true">
      <div class="cw-surface"><div class="cw-canvas" data-cw-canvas="true">
        <div class="cw-root"><div class="cw-grid" style="--cw-columns:${COLUMNS}">${panes}</div></div>
      </div></div>
    </body></html>`;
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.error('probe-drag-motion needs playwright: npm install playwright');
    process.exit(2);
  }
  const css = ['src/styles.css', 'src/foreground.css']
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const tab = await context.newPage();
  await tab.setContent(page(css), { waitUntil: 'load' });

  const results = await tab.evaluate(async ({ columns, zoomLevels }) => {
    // A transform that is being transitioned reads back as wherever the
    // transition has got to, so every measurement below waits for it to
    // settle. Measuring without this reports the pane's starting position and
    // calls it a drift.
    const settled = () => new Promise((resolve) => setTimeout(resolve, 260));
    const canvas = document.querySelector('.cw-canvas');
    const grid = document.querySelector('.cw-grid');
    const out = [];

    // Exactly what rememberGridPreview and gridPitch do in the studio.
    const measure = () => {
      const gridRect = grid.getBoundingClientRect();
      const layoutWidth = grid.offsetWidth || gridRect.width || 1;
      const zoom = gridRect.width > 0 ? gridRect.width / layoutWidth : 1;
      const computed = getComputedStyle(grid);
      const columnGap = Number.parseFloat(computed.columnGap) || 0;
      const rowGap = Number.parseFloat(computed.rowGap) || 0;
      const rowUnit = Number.parseFloat(computed.gridAutoRows)
        || Number.parseFloat(computed.getPropertyValue('--cw-grid-row-size'))
        || 150;
      const trackWidth = (layoutWidth - (columnGap * (columns - 1))) / columns;
      return {
        gridRect, zoom,
        columnPitch: trackWidth + columnGap,
        rowPitch: rowUnit + rowGap,
        inset: (Number.parseFloat(computed.getPropertyValue('--cw-grid-gutter')) || 0) / 2,
        origin: (node) => {
          const rect = node.getBoundingClientRect();
          return { x: (rect.left - gridRect.left) / zoom, y: (rect.top - gridRect.top) / zoom };
        },
      };
    };

    for (const zoom of zoomLevels) {
      if (zoom === 1) {
        delete canvas.dataset.cwArtboard;
        canvas.style.removeProperty('--cw-zoom');
      } else {
        canvas.style.setProperty('--cw-artboard-width', `${grid.offsetWidth}px`);
        canvas.style.setProperty('--cw-artboard-height', `${grid.offsetHeight}px`);
        canvas.style.setProperty('--cw-zoom', String(zoom));
        canvas.dataset.cwArtboard = 'true';
        canvas.dataset.cwZoom = String(Math.round(zoom * 100));
      }
      grid.getBoundingClientRect();

      const node = grid.querySelector('[data-cw-node-id="stage"]');
      // Changing the zoom re-transforms the artboard. Reading an origin before
      // that has settled measures the previous zoom and reports the difference
      // as drift, which is the probe lying about the code.
      await settled(node);
      // Snapshot where it starts, before any shift, exactly as the studio does.
      node.style.removeProperty('--cw-shift-x');
      node.style.removeProperty('--cw-shift-y');
      delete node.dataset.cwShifted;
      const before = measure();
      const origin = before.origin(node);

      for (const target of [{ columnStart: 3, rowStart: 1 }, { columnStart: 10, rowStart: 4 }, { columnStart: 1, rowStart: 6 }]) {
        const dx = ((target.columnStart - 1) * before.columnPitch) - (origin.x - before.inset);
        const dy = ((target.rowStart - 1) * before.rowPitch) - (origin.y - before.inset);
        node.style.setProperty('--cw-shift-x', `${Math.round(dx * 100) / 100}px`);
        node.style.setProperty('--cw-shift-y', `${Math.round(dy * 100) / 100}px`);
        node.dataset.cwShifted = 'true';
        await settled();

        // Where it actually landed, versus where CSS grid puts that cell.
        const landed = before.origin(node);
        const wantedX = ((target.columnStart - 1) * before.columnPitch) + before.inset;
        const wantedY = ((target.rowStart - 1) * before.rowPitch) + before.inset;
        out.push({
          zoom, target,
          driftX: landed.x - wantedX,
          driftY: landed.y - wantedY,
          transitioned: getComputedStyle(node).transitionDuration,
        });
      }
      node.style.removeProperty('--cw-shift-x');
      node.style.removeProperty('--cw-shift-y');
      delete node.dataset.cwShifted;
      await settled();
    }

    // And the ground truth: place a pane by real grid placement and check the
    // pitch predicts where CSS actually put it.
    const probe = grid.querySelector('[data-cw-node-id="queue"]');
    const m = measure();
    const truth = [];
    for (const columnStart of [1, 5, 12, 17]) {
      probe.style.setProperty('--cw-column-start', String(columnStart));
      grid.getBoundingClientRect();
      const actual = m.origin(probe).x;
      truth.push({ columnStart, predicted: ((columnStart - 1) * m.columnPitch) + m.inset, actual });
    }
    return { shifts: out, truth };
  }, { columns: COLUMNS, zoomLevels: [1, 0.5, 1.5] });

  await browser.close();

  const failures = [];
  for (const row of results.shifts) {
    if (Math.abs(row.driftX) > TOLERANCE || Math.abs(row.driftY) > TOLERANCE) failures.push(row);
  }
  for (const row of results.truth) {
    if (Math.abs(row.predicted - row.actual) > TOLERANCE) failures.push(row);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...results, ok: !failures.length }, null, 2));
  } else {
    console.log('Does the pitch arithmetic agree with what CSS grid actually does?\n');
    console.log('  column   predicted x   actual x   drift');
    for (const row of results.truth) {
      console.log(`  ${String(row.columnStart).padStart(6)}   ${row.predicted.toFixed(1).padStart(11)}   ${row.actual.toFixed(1).padStart(8)}   ${(row.predicted - row.actual).toFixed(2).padStart(6)}`);
    }
    console.log('\nDoes a shift land the pane on the cell it was aimed at?\n');
    console.log('  zoom   target cell   drift x   drift y   transition');
    for (const row of results.shifts) {
      console.log(`  ${String(Math.round(row.zoom * 100) + '%').padStart(5)}   `
        + `${`c${row.target.columnStart} r${row.target.rowStart}`.padEnd(11)}   `
        + `${row.driftX.toFixed(2).padStart(7)}   ${row.driftY.toFixed(2).padStart(7)}   ${row.transitioned}`);
    }
    console.log(failures.length
      ? `\n${failures.length} measurement(s) drifted more than ${TOLERANCE}px.`
      : `\nEvery shift landed within ${TOLERANCE}px of its target cell, at every zoom level.`);
  }
  process.exit(failures.length ? 1 : 0);
})();
