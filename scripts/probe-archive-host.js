'use strict';
// A ported theme reconstructs the archived host: one band between the header
// and the player, three panes across it, and a nested grid inside the stage.
// The fine grid has to put all of that on the same pixels the coarse one did,
// and the fine-grid probe does not cover it -- that probe renders a bare grid
// with no theme sheet loaded, which is exactly why the archive-host block
// could override the row mechanism for weeks without a check going red.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const VIEW = { width: 1400, height: 900 };
const CANVAS = 1200;
const GUTTER = 8;
const WORKSPACE = 'calc(100vh - 146px)';
const BAND = VIEW.height - 146;
const HPAD = 8;

// The archive frame in archive units, and the nested pair inside the stage.
const FRAME = [
  { id: 'library', columnStart: 1, columnSpan: 5 },
  { id: 'stage', columnStart: 6, columnSpan: 14 },
  { id: 'utility', columnStart: 20, columnSpan: 5 },
];

const node = (id, klass, cs, csp, extra = '') =>
  `<div class="cw-node ${klass}" data-cw-node-id="${id}" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:${(cs - 1) * 4 + 1};--cw-row-start:1;--cw-column-span:${csp * 4};--cw-row-span:6${extra}"></div>`;

const stage = (inner) =>
  `<div class="cw-node cw-grid" data-cw-node-id="port-stage" data-cw-placed="true" data-cw-positioned="true"
    style="--cw-column-start:21;--cw-row-start:1;--cw-column-span:56;--cw-row-span:6;--cw-columns:96">${inner}</div>`;

(async () => {
  const { chromium } = require('playwright');
  const css = ['src/styles.css', 'src/foreground.css', 'src/canvas-theme-ports.css']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

  const inner = [
    node('port-library', 'cw-module', 1, 5),
    stage([
      node('port-tracks', 'cw-module', 1, 24),
      node('port-signal', 'cw-module', 1, 24),
    ].join('')),
    node('port-utility', 'cw-stack', 20, 5),
  ].join('');

  // Exactly what renderer.js publishes for an archive-host port.
  const vars = [
    `--canvas-port-gutter:${GUTTER}px`,
    `--canvas-port-row-base:calc(${WORKSPACE} - 0px)`,
    `--canvas-port-workspace-padding:0 ${HPAD}px`,
    `--canvas-port-workspace-height:${WORKSPACE}`,
  ].join(';');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
    <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
    <body data-theme="foreground" data-canvas-theme-port="dev-lab" data-canvas-port-composition="archive-host" style="${vars}">
      <div class="cw-surface"><div class="cw-canvas"><div class="cw-root" style="width:${CANVAS}px">
        <div class="cw-split" data-axis="vertical"><div class="cw-grid" data-cw-node-id="port-workspace" style="--cw-columns:96">${inner}</div>
        <div class="cw-dock" data-cw-node-id="port-dock"></div></div>
      </div></div></div></body></html>`;

  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: VIEW });
  await tab.setContent(html, { waitUntil: 'load' });
  const actual = await tab.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cw-node')].map((n) => {
    const r = n.getBoundingClientRect();
    return [n.dataset.cwNodeId, { left: r.left, top: r.top, width: r.width, height: r.height }];
  })));
  await browser.close();

  // The coarse geometry, computed from the archive's own numbers: 24 tracks
  // and 23 gutters inside the padded width, one row filling the band.
  const track = (CANVAS - (HPAD * 2) - (GUTTER * 23)) / 24;
  const expected = {};
  for (const pane of FRAME) {
    expected[`port-${pane.id}`] = {
      left: HPAD + ((pane.columnStart - 1) * (track + GUTTER)),
      top: 0,
      width: (pane.columnSpan * track) + ((pane.columnSpan - 1) * GUTTER),
      height: BAND,
    };
  }
  // The stage's own grid ran gapless, so its children fill it exactly.
  for (const id of ['port-tracks', 'port-signal']) expected[id] = { ...expected['port-stage'] };

  console.log(`Archive host on the fine grid -- canvas ${CANVAS}px, band ${BAND}px, gutter ${GUTTER}px\n`);
  console.log('  pane            left (want/got)          width (want/got)         height (want/got)      drift');
  let worst = 0;
  let missing = 0;
  for (const [id, want] of Object.entries(expected)) {
    const got = actual[id];
    if (!got) { console.log(`  ${id.padEnd(14)} not rendered`); missing += 1; continue; }
    const d = ['left', 'top', 'width', 'height'].map((k) => got[k] - want[k]);
    worst = Math.max(worst, ...d.map(Math.abs));
    console.log(`  ${id.padEnd(14)} ${want.left.toFixed(2).padStart(8)}/${got.left.toFixed(2).padStart(8)}  ${want.width.toFixed(2).padStart(9)}/${got.width.toFixed(2).padStart(9)}  ${want.height.toFixed(2).padStart(8)}/${got.height.toFixed(2).padStart(8)}   ${d.map((v) => v.toFixed(3)).join(' / ')}`);
  }
  console.log(`\n  worst drift: ${worst.toFixed(4)}px`);
  if (missing || worst > 1) {
    console.log('\n  The ported archive host does not land on the archive frame.');
    process.exit(1);
  }
  console.log('\n  The ported archive host lands on the archive frame.');
})();
