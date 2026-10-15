'use strict';

// Renders the real Composition Mode stylesheet against a synthetic canvas and
// measures what it actually paints, at every zoom level.
//
// This exists because the artboard is the one part of the composition work
// that cannot be proved by arithmetic. The packing, the hit test and the
// displacement planner are all pure functions with their own checks; the
// artboard is a transform, two margins and a scroll container, and whether
// those three agree is a question only a browser can answer.
//
//   node scripts/probe-artboard-geometry.js            human-readable
//   node scripts/probe-artboard-geometry.js --json     machine-readable
//
// Needs `playwright`. Deliberately NOT wired into `npm run check`, because it
// needs a browser. Exits non-zero if any measurement disagrees with the model.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5];
const ARTBOARD = { width: 1200, height: 700 };
const PASTEBOARD = 56;
const GUTTER = 14;   // --fg-gutter, the non-port default
const TOLERANCE = 1.5; // sub-pixel layout rounding

function page(css, mode) {
  // Theme-port mode is where the pasteboard was lost: canvas-theme-ports.css
  // zeroes .cw-canvas padding for the archive host at equal specificity and
  // loads later, so it used to win.
  const portAttributes = mode === 'port'
    ? ' data-canvas-theme-port="dev-lab" data-canvas-port-composition="archive-host"'
    : '';
  // The 5 / 14 / 5 archive frame, which is what every theme port ships.
  const panes = [
    { id: 'library', columnStart: 1, columnSpan: 5 },
    { id: 'stage', columnStart: 6, columnSpan: 14 },
    { id: 'utility', columnStart: 20, columnSpan: 5 },
  ].map((pane) => `<div class="cw-node cw-module" data-cw-node-id="${pane.id}" data-cw-placed="true" data-cw-positioned="true"
      style="--cw-column-start:${pane.columnStart};--cw-row-start:1;--cw-column-span:${pane.columnSpan};--cw-row-span:3"><p>${pane.id}</p></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
    <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
    <body data-theme="foreground" data-composition-mode="edit" data-cw-studio="open"${portAttributes}>
      <div class="cw-surface"><div class="cw-canvas" data-cw-canvas="true">
        <div class="cw-root"><div class="cw-grid" style="--cw-columns:24">${panes}</div></div>
      </div></div>
    </body></html>`;
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.error('probe-artboard-geometry needs playwright: npm install playwright');
    process.exit(2);
  }

  const sheets = (mode) => (mode === 'port'
    ? ['src/styles.css', 'src/foreground.css', 'src/canvas-theme-ports.css']
    : ['src/styles.css', 'src/foreground.css'])
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const tab = await context.newPage();

  const results = [];
  for (const mode of ['base', 'port']) {
    await tab.setContent(page(sheets(mode), mode), { waitUntil: 'load' });
    for (const zoom of ZOOMS) {
    const measured = await tab.evaluate(({ zoom, artboard, pasteboard }) => {
      const canvas = document.querySelector('.cw-canvas');
      const root = canvas.querySelector(':scope > .cw-root');
      const grid = root.querySelector('.cw-grid');
      // Exactly what applyCanvasZoom writes.
      canvas.style.setProperty('--cw-artboard-width', `${artboard.width}px`);
      canvas.style.setProperty('--cw-artboard-height', `${artboard.height}px`);
      canvas.style.setProperty('--cw-zoom', String(zoom));
      canvas.style.setProperty('--fg-pasteboard-pad', `${pasteboard}px`);
      canvas.dataset.cwArtboard = 'true';
      canvas.dataset.cwZoom = String(Math.round(zoom * 100));
      canvas.getBoundingClientRect(); // force layout
      const rootRect = root.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const first = grid.querySelector('[data-cw-node-id="library"]').getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return {
        canvasPadding: { top: Number.parseFloat(style.paddingTop), left: Number.parseFloat(style.paddingLeft) },
        // Where the artboard sits inside the workspace, from the workspace's
        // own edges. Equal left and right means centred.
        gap: {
          left: rootRect.left - canvasRect.left,
          right: canvasRect.right - (rootRect.left + rootRect.width),
          top: rootRect.top - canvasRect.top,
          bottom: canvasRect.bottom - (rootRect.top + rootRect.height),
        },
        rootPainted: { width: rootRect.width, height: rootRect.height },
        rootLayout: { width: root.offsetWidth, height: root.offsetHeight },
        scroll: { width: canvas.scrollWidth, height: canvas.scrollHeight },
        client: { width: canvas.clientWidth, height: canvas.clientHeight },
        gridPainted: { width: gridRect.width, height: gridRect.height },
        gridLayout: { width: grid.offsetWidth, height: grid.offsetHeight },
        firstPaneWidth: first.width,
        derivedScale: gridRect.width / grid.offsetWidth,
      };
    }, { zoom, artboard: ARTBOARD, pasteboard: PASTEBOARD });

    const expectPaintedWidth = ARTBOARD.width * zoom;
    const expectPaintedHeight = ARTBOARD.height * zoom;
    // The scroll extent must cover the artboard as painted, plus pasteboard on
    // both sides -- never the unscaled box, which is the bug the margins fix.
    const expectScrollWidth = Math.max(measured.client.width, expectPaintedWidth + PASTEBOARD * 2);
    const expectScrollHeight = Math.max(measured.client.height, expectPaintedHeight + PASTEBOARD * 2);

    const checks = [
      ['artboard layout width is fixed', Math.abs(measured.rootLayout.width - ARTBOARD.width) <= TOLERANCE],
      ['artboard layout height is fixed', Math.abs(measured.rootLayout.height - ARTBOARD.height) <= TOLERANCE],
      ['artboard paints at artboard x zoom', Math.abs(measured.rootPainted.width - expectPaintedWidth) <= TOLERANCE],
      ['artboard paints at artboard x zoom (height)', Math.abs(measured.rootPainted.height - expectPaintedHeight) <= TOLERANCE],
      ['scroll extent matches what is painted', Math.abs(measured.scroll.width - expectScrollWidth) <= TOLERANCE + 2],
      ['scroll extent matches what is painted (height)', Math.abs(measured.scroll.height - expectScrollHeight) <= TOLERANCE + 2],
      // The grid deliberately overhangs the artboard by half a gutter on each
      // side: that is the missing-gutter correction that makes the fine grid
      // land on the coarse grid's pixels.
      ['grid fills the artboard', Math.abs(measured.gridLayout.width - (ARTBOARD.width + GUTTER)) <= TOLERANCE],
      ['grid does not overflow the artboard', measured.gridLayout.height <= ARTBOARD.height + GUTTER + TOLERANCE],
      ['derived scale equals the zoom', Math.abs(measured.derivedScale - zoom) <= 0.002],
      // The defect found: a theme port zeroed this padding and
      // pinned the artboard into the corner, under the rail.
      ['pasteboard padding survives', Math.abs(measured.canvasPadding.left - PASTEBOARD) <= TOLERANCE],
      // An artboard smaller than the workspace belongs in the middle of it.
      // "Fits" means fits inside the pasteboard, not inside the window -- the
      // padding is part of the workspace, so the space available to the
      // artboard is the client box less both gutters.
      ['artboard is centred horizontally when it fits',
        expectPaintedWidth > measured.client.width - PASTEBOARD * 2
        || Math.abs(measured.gap.left - measured.gap.right) <= TOLERANCE + 1],
      ['artboard is centred vertically when it fits',
        expectPaintedHeight > measured.client.height - PASTEBOARD * 2
        || Math.abs(measured.gap.top - measured.gap.bottom) <= TOLERANCE + 1],
      // Centring must never push the near edge out of scroll range.
      ['artboard start edge stays reachable', measured.gap.left >= -TOLERANCE && measured.gap.top >= -TOLERANCE],
    ];
    results.push({ mode, zoom, measured, checks, ok: checks.every(([, pass]) => pass) });
    }
  }

  await browser.close();

  const failures = results.filter((entry) => !entry.ok);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ artboard: ARTBOARD, pasteboard: PASTEBOARD, results, ok: !failures.length }, null, 2));
  } else {
    console.log(`Artboard ${ARTBOARD.width}x${ARTBOARD.height}, pasteboard ${PASTEBOARD}px, viewport 1400x900\n`);
    console.log('mode   zoom   painted        layout        pad   gap L/R         scale   verdict');
    for (const entry of results) {
      const m = entry.measured;
      console.log(
        `${entry.mode.padEnd(7)}${String(Math.round(entry.zoom * 100)).padStart(4)}%  `
        + `${`${Math.round(m.rootPainted.width)}x${Math.round(m.rootPainted.height)}`.padEnd(14)}`
        + `${`${Math.round(m.rootLayout.width)}x${Math.round(m.rootLayout.height)}`.padEnd(14)}`
        + `${String(Math.round(m.canvasPadding.left)).padEnd(6)}`
        + `${`${Math.round(m.gap.left)}/${Math.round(m.gap.right)}`.padEnd(16)}`
        + `${m.derivedScale.toFixed(3).padEnd(8)}`
        + `${entry.ok ? 'ok' : 'FAILED'}`,
      );
    }
    for (const entry of failures) {
      console.log(`\n  ${entry.mode} ${Math.round(entry.zoom * 100)}% failed:`);
      for (const [label, pass] of entry.checks) if (!pass) console.log(`    - ${label}`);
    }
    console.log(failures.length
      ? `\n${failures.length} of ${results.length} zoom levels disagree with the artboard model.`
      : `\nAll ${results.length} zoom levels agree with the artboard model.`);
  }
  process.exit(failures.length ? 1 : 0);
})();
