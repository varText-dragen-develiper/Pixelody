'use strict';

// One pull of a resize grip should be one row of the grid.
//
// Both resize paths used to guess the row pitch from the pane's own height and
// then clamp the guess into a range sized for the coarse 150px row. A fine row
// is 26.33px and an archive band row is about 126px, so the clamp was wrong in
// both directions: the grip did nothing until the pointer had crossed two
// rows, then jumped. gridPitch measures the real pitch instead, and this probe
// is what says the measurement agrees with the browser.
//
//   node scripts/probe-resize-pitch.js
//
// Needs `playwright`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const studio = fs.readFileSync(path.join(ROOT, 'src/workspace-composition/canvas-studio.js'), 'utf8');

// The same lift check-studio-packing.js does: run the shipped function, do not
// re-describe it here.
function lift(name) {
  const found = [...studio.matchAll(new RegExp(`^ {4}(?:function ${name}\\(|const ${name} = )`, 'gm'))];
  assert.equal(found.length, 1, `probe-resize-pitch.js lifts \`${name}\` out of canvas-studio.js and found ${found.length} declarations of it.`);
  const lines = studio.slice(found[0].index).split('\n');
  if (/;\s*$/.test(lines[0]) && !/[{[(]\s*$/.test(lines[0])) return lines[0];
  for (let index = 1; index < lines.length; index += 1) {
    if (/^ {4}\}\)?;?\s*$/.test(lines[index])) return lines.slice(0, index + 1).join('\n');
  }
  throw new Error(`probe-resize-pitch.js could not find the end of \`${name}\`.`);
}
const GRID_PITCH = `${lift('gridContentBox')}\n\n${lift('gridPitch')}`;

const CASES = [
  { name: 'Canvas Base', rowBase: '150px', gutter: 8 },
  { name: 'a ported archive host', rowBase: 'calc(754px - 0px)', gutter: 8 },
];

const pane = (id, rowStart) => `<div class="cw-node cw-module" data-cw-node-id="${id}" data-cw-placed="true" data-cw-positioned="true"
  style="--cw-column-start:1;--cw-row-start:${rowStart};--cw-column-span:20;--cw-row-span:6"></div>`;

(async () => {
  const { chromium } = require('playwright');
  const css = ['src/styles.css', 'src/foreground.css'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  console.log('Does gridPitch report the row the browser actually drew?\n');
  console.log('  composition             measured    gridPitch      drift   old clamp would have said');
  let worst = 0;
  for (const testCase of CASES) {
    const vars = `--canvas-port-gutter:${testCase.gutter}px;--canvas-port-row-base:${testCase.rowBase}`;
    await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
      <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
      <body data-theme="foreground" data-composition-mode="edit" style="${vars}">
        <div class="cw-surface"><div class="cw-canvas"><div class="cw-root" style="width:1200px">
          <div class="cw-grid" id="grid" style="--cw-columns:96">${pane('a', 1)}${pane('b', 7)}</div>
        </div></div></div></body></html>`, { waitUntil: 'load' });

    const result = await tab.evaluate((source) => {
      const documentObject = document;
      // eslint-disable-next-line no-new-func
      const gridPitch = new Function('documentObject', `${source}\nreturn gridPitch;`)(documentObject);
      const grid = document.getElementById('grid');
      const a = document.querySelector('[data-cw-node-id="a"]').getBoundingClientRect();
      const b = document.querySelector('[data-cw-node-id="b"]').getBoundingClientRect();
      return { measured: (b.top - a.top) / 6, reported: gridPitch(grid, 96)?.rowPitch ?? null };
    }, GRID_PITCH);

    assert.ok(result.reported !== null, `${testCase.name}: gridPitch could not measure the grid.`);
    const drift = result.reported - result.measured;
    worst = Math.max(worst, Math.abs(drift));
    const clamped = Math.max(56, Math.min(96, result.measured));
    console.log(`  ${testCase.name.padEnd(22)} ${result.measured.toFixed(3).padStart(8)}  ${result.reported.toFixed(3).padStart(11)}  ${drift.toFixed(4).padStart(9)}   ${clamped.toFixed(3)}${Math.abs(clamped - result.measured) > 0.5 ? '  <- wrong by ' + (clamped - result.measured).toFixed(1) + 'px' : ''}`);
  }
  await browser.close();

  console.log(`\n  worst drift: ${worst.toFixed(4)}px`);
  if (worst > 0.05) {
    console.log('\n  The grip would not step by a row.');
    process.exit(1);
  }
  console.log('\n  One grip step is one row.');
})();
