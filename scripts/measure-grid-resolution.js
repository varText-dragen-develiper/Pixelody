'use strict';
// Can the grid be made N times finer without moving a single pixel?
//
// The blocker is the gutter. Today the grid has 24 columns and an 8px `gap`,
// so 23 gutters eat 184px of a 1200px grid. At 96 columns there would be 95
// gutters eating 760px, and the layout collapses. A fine grid has to be
// gapless, with the gutter coming from the panes themselves.
//
// This asks the browser whether that substitution is exact.
// Run:  node scripts/measure-grid-resolution.js
// Needs `playwright`. A measurement, not a pass/fail.
const { chromium } = require('playwright');

const WIDTH = 1200;
const GUTTER = 8;
const FRAME = [
  { id: 'library', columnStart: 1, columnSpan: 5 },
  { id: 'stage', columnStart: 6, columnSpan: 14 },
  { id: 'utility', columnStart: 20, columnSpan: 5 },
];

const build = (mode, factor) => {
  const columns = mode === 'today' ? 24 : 24 * factor;
  const gap = mode === 'today' ? GUTTER : 0;
  const half = GUTTER / 2;
  const panes = FRAME.map((p) => {
    const columnStart = mode === 'today' ? p.columnStart : ((p.columnStart - 1) * factor) + 1;
    const columnSpan = mode === 'today' ? p.columnSpan : p.columnSpan * factor;
    const style = mode === 'today'
      ? `grid-column:${columnStart} / span ${columnSpan}`
      : `grid-column:${columnStart} / span ${columnSpan};margin:0 ${half}px`;
    return `<div class="pane" data-id="${p.id}" style="${style}"></div>`;
  }).join('');
  // The fine grid pulls its own edges in by half a gutter, so the outermost
  // panes line up with where `gap` left them rather than being inset.
  const gridStyle = mode === 'today'
    ? `width:${WIDTH}px;display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:${gap}px`
    : `width:${WIDTH}px;display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:0;margin:0 -${half}px`;
  return `<div class="grid" style="${gridStyle}">${panes}</div>`;
};

(async () => {
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const measure = async (html) => {
    await tab.setContent(`<!doctype html><style>*{box-sizing:border-box;margin:0}.pane{height:60px;background:#345}</style><body style="width:${WIDTH}px">${html}</body>`);
    return tab.evaluate(() => [...document.querySelectorAll('.pane')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.id, left: r.left, width: r.width, right: r.right };
    }));
  };

  const today = await measure(build('today'));
  console.log(`Today: 24 columns, ${GUTTER}px gap\n`);
  console.log('  pane        left     width    right');
  today.forEach((p) => console.log(`  ${p.id.padEnd(10)} ${p.left.toFixed(2).padStart(7)} ${p.width.toFixed(2).padStart(8)} ${p.right.toFixed(2).padStart(8)}`));

  for (const factor of [2, 4, 8]) {
    const fine = await measure(build('fine', factor));
    let worst = 0;
    fine.forEach((p, i) => {
      worst = Math.max(worst, Math.abs(p.left - today[i].left), Math.abs(p.width - today[i].width));
    });
    console.log(`\n${24 * factor} columns, gapless, ${GUTTER / 2}px pane margins  (x${factor} resolution)\n`);
    console.log('  pane        left     width    right     drift');
    fine.forEach((p, i) => console.log(`  ${p.id.padEnd(10)} ${p.left.toFixed(2).padStart(7)} ${p.width.toFixed(2).padStart(8)} ${p.right.toFixed(2).padStart(8)}   ${(p.left - today[i].left).toFixed(2).padStart(6)} / ${(p.width - today[i].width).toFixed(2)}`));
    console.log(`  worst drift: ${worst.toFixed(3)}px   column pitch: ${(WIDTH / (24 * factor)).toFixed(2)}px`);
  }
  await browser.close();

  // ---- and what a finer grid costs the packer --------------------------
  console.log('\n' + '='.repeat(72) + '\n');
  packerCost();
})();

// fits() walks every cell of a footprint and firstAvailable() walks the grid,
// so both scale with area. Finer is not free.
function packerCost() {
  const track = (WIDTH - GUTTER * (COLUMNS - 1)) / COLUMNS;
  console.log('Why the 6.3px is irreducible\n');
  console.log(`  today: ${COLUMNS} tracks of ${track.toFixed(3)}px and ${COLUMNS - 1} gutters of ${GUTTER}px`);
  console.log(`  a pane spanning 5 columns is 5 tracks + 4 gutters = ${(5 * track + 4 * GUTTER).toFixed(2)}px`);
  console.log(`  its advance to the next pane is ${(5 * track + 5 * GUTTER).toFixed(3)}px\n`);
  console.log('  A gapless grid has no gutters inside a span, so one old column');
  console.log(`  must become an exact number of fine tracks of width W = ${WIDTH}/columns.`);
  for (const factor of [2, 4, 8, 16]) {
    const columns = COLUMNS * factor;
    const fine = WIDTH / columns;
    const needed = (track + GUTTER) / fine;
    console.log(`  x${String(factor).padStart(2)}: ${String(columns).padStart(3)} columns, track ${fine.toFixed(3)}px -> one old column = ${needed.toFixed(3)} fine tracks (needs to be a whole number)`);
  }
  console.log('\n  It never is, because 1016/24 is not commensurate with 1200/n.');
  console.log('  The residue is the same 6.3px at every factor: 0.53% of the canvas.\n');

  // What the packer pays for a finer grid. fits() walks every cell of a
  // footprint, and firstAvailable() walks the grid.
  function packCost(columns, rows, panes, factor) {
    const occupied = new Set();
    let cellTouches = 0;
    const fits = (p) => {
      for (let r = p.rowStart; r < p.rowStart + p.rowSpan; r += 1)
        for (let c = p.columnStart; c < p.columnStart + p.columnSpan; c += 1) {
          cellTouches += 1;
          if (occupied.has(`${c}:${r}`)) return false;
        }
      return true;
    };
    const occupy = (p) => {
      for (let r = p.rowStart; r < p.rowStart + p.rowSpan; r += 1)
        for (let c = p.columnStart; c < p.columnStart + p.columnSpan; c += 1) occupied.add(`${c}:${r}`);
    };
    const span = Math.max(1, Math.round((columns / panes) * 0.9));
    const rowSpan = 2 * factor;
    const started = process.hrtime.bigint();
    for (let i = 0; i < panes; i += 1) {
      const p = { columnStart: 1 + i * span, rowStart: 1, columnSpan: span, rowSpan };
      if (p.columnStart + span - 1 > columns) break;
      if (fits(p)) occupy(p);
    }
    // one firstAvailable scan, the worst case
    outer: for (let rowStart = 1; rowStart <= rows - rowSpan + 1; rowStart += 1)
      for (let columnStart = 1; columnStart <= columns - span + 1; columnStart += 1)
        if (fits({ columnStart, rowStart, columnSpan: span, rowSpan })) break outer;
    const micros = Number(process.hrtime.bigint() - started) / 1000;
    return { cellTouches, micros };
  }

  console.log('What a finer grid costs one pack (8 panes, worst-case scan):\n');
  console.log('  factor  columns   rows   cell touches      time');
  for (const [factor, rows] of [[1, 96], [2, 192], [4, 384], [8, 768]]) {
    const r = packCost(COLUMNS * factor, rows, 8, factor);
    console.log(`  ${`x${factor}`.padStart(6)}  ${String(COLUMNS * factor).padStart(7)}   ${String(rows).padStart(4)}   ${String(r.cellTouches).padStart(12)}   ${r.micros.toFixed(2).padStart(8)}us`);
  }
  console.log('\n  A profile measured a real drag frame at ~14us for the deep clone,');
  console.log('  in a 16600us budget. Compare the numbers above against that.');
}

