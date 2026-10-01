'use strict';
// Does the fine grid put the archive frame on the same pixels the coarse one
// did? That is the whole claim, and only a browser can answer it.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const GUTTER = 8;
const COARSE = [
  { id: 'library', columnStart: 1, columnSpan: 5 },
  { id: 'stage', columnStart: 6, columnSpan: 14 },
  { id: 'utility', columnStart: 20, columnSpan: 5 },
];

const body = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>__CSS__</style>
  <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
  <body data-theme="foreground" data-composition-mode="edit"
        style="--canvas-port-gutter:${GUTTER}px">
    <div class="cw-surface"><div class="cw-canvas" style="width:1200px;padding:0"><div class="cw-root" style="width:1200px">${inner}</div></div></div>
  </body></html>`;

(async () => {
  const { chromium } = require('playwright');
  const css = ['src/styles.css', 'src/foreground.css'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const render = async (columns, rowSize, panes) => {
    const html = `<div class="cw-grid" style="--cw-columns:${columns};--canvas-port-row-base:${rowSize}px">${panes}</div>`;
    await tab.setContent(body(html).replace('__CSS__', css), { waitUntil: 'load' });
    return tab.evaluate(() => [...document.querySelectorAll('.cw-node')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.cwNodeId, left: r.left, top: r.top, width: r.width, height: r.height };
    }));
  };

  const pane = (p, cs, rs, csp, rsp) => `<div class="cw-node cw-module" data-cw-node-id="${p}" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:${cs};--cw-row-start:${rs};--cw-column-span:${csp};--cw-row-span:${rsp}"></div>`;

  const fine = await render(96, 150,
    COARSE.map((p) => pane(p.id, ((p.columnStart - 1) * 4) + 1, 1, p.columnSpan * 4, 6)).join(''));

  // What the coarse grid produced, computed from its own geometry: 24 tracks
  // and 23 gutters across 1200px, one 150px row.
  const track = (1200 - GUTTER * 23) / 24;
  const expected = COARSE.map((p) => ({
    id: p.id,
    left: (p.columnStart - 1) * (track + GUTTER),
    width: (p.columnSpan * track) + ((p.columnSpan - 1) * GUTTER),
    height: 150,
  }));

  await browser.close();
  console.log('Archive frame on the fine grid (96 columns, gapless) vs the coarse geometry\n');
  console.log('  pane        expected left   actual    expected width   actual     drift');
  let worst = 0;
  expected.forEach((e, i) => {
    const a = fine[i];
    const dl = a.left - e.left;
    const dw = a.width - e.width;
    const dh = a.height - e.height;
    worst = Math.max(worst, Math.abs(dl), Math.abs(dw), Math.abs(dh));
    console.log(`  ${e.id.padEnd(10)} ${e.left.toFixed(2).padStart(13)} ${a.left.toFixed(2).padStart(8)}   ${e.width.toFixed(2).padStart(14)} ${a.width.toFixed(2).padStart(8)}   ${dl.toFixed(3)} / ${dw.toFixed(3)} / ${dh.toFixed(3)}`);
  });
  console.log(`\n  worst drift: ${worst.toFixed(4)}px`);
  console.log(`  column pitch: ${(1208 / 96).toFixed(3)}px (was ${(track + GUTTER).toFixed(3)}px)`);
  console.log(`  row pitch:    ${((150 + GUTTER) / 6).toFixed(3)}px (was ${(150 + GUTTER).toFixed(3)}px)`);
  if (worst > 1) { console.log('\n  The fine grid does not reproduce the archive frame.'); process.exit(1); }
  console.log('\n  The archive frame lands on the same pixels.');
})();
