'use strict';

// Can a pane live past the bottom of the player's window, and can the person
// reach it? The artboard is the window; it is meant to be a floor, not a
// ceiling. This is the measurement that says which one it is.
//
//   node scripts/probe-below-the-fold.js
// Needs `playwright`. Browser-only, so not in `npm run check`.

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const ARTBOARD = { width: 1200, height: 700 };
const GUTTER = 8;
const ROW = (150 + GUTTER) / 6;

const page = (css, farRow) => {
  const pane = (id, cs, rs, csp, rsp) => `<div class="cw-node cw-module" data-cw-node-id="${id}" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:${cs};--cw-row-start:${rs};--cw-column-span:${csp};--cw-row-span:${rsp}"><p>${id}</p></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
  <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
  <body data-theme="foreground" data-composition-mode="edit"
        style="--canvas-port-gutter:${GUTTER}px;--canvas-port-row-size:${ROW}px">
    <div class="cw-surface"><div class="cw-canvas" data-cw-artboard="true" data-cw-zoom="100"
      style="--cw-artboard-width:${ARTBOARD.width}px;--cw-artboard-height:${ARTBOARD.height}px;--cw-zoom:1">
      <div class="cw-root">
        <div class="cw-grid" style="--cw-columns:96">
          ${pane('inside', 1, 1, 20, 12)}
          ${pane('below', 40, farRow, 20, 12)}
        </div>
      </div></div></div>
  </body></html>`;
};

(async () => {
  const { chromium } = require('playwright');
  const css = ['src/styles.css', 'src/foreground.css'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const failures = [];

  for (const farRow of [12, 40, 90]) {
    await tab.setContent(page(css, farRow), { waitUntil: 'load' });
    const out = await tab.evaluate(() => {
      const canvas = document.querySelector('.cw-canvas');
      const root = canvas.querySelector(':scope > .cw-root');
      // What the studio does: publish the composition's real height.
      canvas.style.setProperty('--cw-canvas-height', `${Math.round(root.offsetHeight)}px`);
      const rootRect = root.getBoundingClientRect();
      const below = root.querySelector('[data-cw-node-id="below"]').getBoundingClientRect();
      canvas.scrollTop = canvas.scrollHeight;
      const reached = canvas.scrollTop;
      canvas.scrollTop = 0;
      return {
        rootHeight: root.offsetHeight,
        belowTop: below.top - rootRect.top,
        belowBottom: below.bottom - rootRect.top,
        scrollHeight: canvas.scrollHeight,
        clientHeight: canvas.clientHeight,
        maxScroll: reached,
      };
    });
    const expectedTop = (farRow - 1) * ROW;
    const pastFold = out.belowBottom > ARTBOARD.height;
    // Everything the composition reaches must be scrollable to.
    const reachable = out.maxScroll + out.clientHeight >= out.rootHeight - 2;
    console.log(`\n  pane at row ${farRow}`);
    console.log(`    sits ${Math.round(out.belowTop)}px down (arithmetic says ${Math.round(expectedTop)})   past the fold: ${pastFold ? 'yes' : 'no'}`);
    console.log(`    composition height ${out.rootHeight}px   scroll extent ${out.scrollHeight}px   reachable: ${reachable ? 'yes' : 'NO'}`);
    if (Math.abs(out.belowTop - expectedTop) > 5) failures.push(`row ${farRow}: pane is not where the grid says`);
    if (!reachable) failures.push(`row ${farRow}: the bottom of the composition cannot be scrolled to`);
    if (farRow >= 40 && !pastFold) failures.push(`row ${farRow}: expected this to sit past the fold`);
    if (farRow >= 40 && out.rootHeight <= ARTBOARD.height) failures.push(`row ${farRow}: the artboard did not grow`);
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.map((f) => '  ' + f).join('\n')}\n\n${failures.length} problem(s).`
    : '\n  A composition may run past the window, and every part of it can be reached.');
  process.exit(failures.length ? 1 : 0);
})();
