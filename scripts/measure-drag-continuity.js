'use strict';

// How far does the worst-affected neighbour move when the pointer moves ONE
// cell? That number is what "blocky" means, measured.
//
//   node scripts/measure-drag-continuity.js
//
// A measurement, not a pass/fail, so it is not in `npm run check`. Run it
// before and after any change to how placement is resolved during a drag.
//
// What it established on 2026-09-23: the packing model already in
// canvas-studio.js is the most continuous of the three tried. Two attempts at
// a "smoother" resolver both measured worse -- see the ledger at the bottom.
// The jumpiness is not coming from the solver.

const fs = require('node:fs');
const path = require('node:path');

const STUDIO = path.join(__dirname, '..', 'src', 'workspace-composition', 'canvas-studio.js');
const source = fs.readFileSync(STUDIO, 'utf8');

// The packing loop lives in a closure and cannot be imported, so it is
// replicated below. Same guard as check-grid-packing.js: if the lines it
// copies are gone, this file is stale and says so rather than measuring a
// fiction.
for (const line of [
  'const pushedDown = (preferred, footprint) => {',
  'const firstAvailable = (footprint) => {',
  ': (pushedDown(preferred, footprint) || firstAvailable(footprint));',
]) {
  if (!source.includes(line)) {
    console.error(`measure-drag-continuity.js replicates canvas-studio.js, and a line it copies is gone:\n  ${line}\nUpdate the replication below to match the real packing loop.`);
    process.exit(2);
  }
}

const COLUMNS = 24;
// A six-pane canvas built on the measured 5 / 14 / 5 archive frame.
const FRAME = [
  { id: 'library', placement: { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 2 } },
  { id: 'stage', placement: { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 2 } },
  { id: 'utility', placement: { columnStart: 20, rowStart: 1, columnSpan: 5, rowSpan: 2 } },
  { id: 'queue', placement: { columnStart: 1, rowStart: 3, columnSpan: 8, rowSpan: 1 } },
  { id: 'lyrics', placement: { columnStart: 9, rowStart: 3, columnSpan: 8, rowSpan: 1 } },
  { id: 'meta', placement: { columnStart: 17, rowStart: 3, columnSpan: 8, rowSpan: 1 } },
];

function repack(entries, moverId, desired, columns) {
  const occupied = new Set();
  const fits = (p) => {
    if (p.columnStart < 1 || p.rowStart < 1 || p.columnStart + p.columnSpan - 1 > columns || p.rowStart + p.rowSpan - 1 > 96) return false;
    for (let r = p.rowStart; r < p.rowStart + p.rowSpan; r += 1)
      for (let c = p.columnStart; c < p.columnStart + p.columnSpan; c += 1)
        if (occupied.has(`${c}:${r}`)) return false;
    return true;
  };
  const occupy = (p) => {
    for (let r = p.rowStart; r < p.rowStart + p.rowSpan; r += 1)
      for (let c = p.columnStart; c < p.columnStart + p.columnSpan; c += 1) occupied.add(`${c}:${r}`);
  };
  const normalize = (candidate, footprint) => ({
    columnStart: Math.max(1, Math.min(columns - footprint.columnSpan + 1, Math.round(candidate?.columnStart) || 1)),
    rowStart: Math.max(1, Math.min(96 - footprint.rowSpan + 1, Math.round(candidate?.rowStart) || 1)),
    columnSpan: footprint.columnSpan,
    rowSpan: footprint.rowSpan,
  });
  const firstAvailable = (footprint) => {
    for (let rowStart = 1; rowStart <= 96 - footprint.rowSpan + 1; rowStart += 1)
      for (let columnStart = 1; columnStart <= columns - footprint.columnSpan + 1; columnStart += 1) {
        const candidate = { columnStart, rowStart, ...footprint };
        if (fits(candidate)) return candidate;
      }
    return null;
  };
  const pushedDown = (preferred, footprint) => {
    if (!preferred) return null;
    for (let rowStart = preferred.rowStart; rowStart <= 96 - footprint.rowSpan + 1; rowStart += 1) {
      const candidate = { columnStart: preferred.columnStart, rowStart, ...footprint };
      if (fits(candidate)) return candidate;
    }
    return null;
  };
  const out = {};
  const source_ = normalize(desired, { columnSpan: desired.columnSpan, rowSpan: desired.rowSpan });
  out[moverId] = source_;
  occupy(source_);
  for (const child of entries.filter((candidate) => candidate.id !== moverId)) {
    const footprint = { columnSpan: child.placement.columnSpan, rowSpan: child.placement.rowSpan };
    const preferred = normalize(child.placement, footprint);
    const placement = fits(preferred) ? preferred : (pushedDown(preferred, footprint) || firstAvailable(footprint));
    if (!placement) return null;
    out[child.id] = placement;
    occupy(placement);
  }
  return out;
}

const distance = (a, b) => (!a || !b) ? 0
  : Math.abs(a.columnStart - b.columnStart) + Math.abs(a.rowStart - b.rowStart)
  + Math.abs(a.columnSpan - b.columnSpan) + Math.abs(a.rowSpan - b.rowSpan);

let steps = 0;
let worst = 0;
let worstAt = null;
const histogram = new Map();
for (let row = 1; row <= 4; row += 1) {
  let previous = null;
  for (let column = 1; column <= 20; column += 1) {
    const packed = repack(FRAME, 'library', { columnStart: column, rowStart: row, columnSpan: 5, rowSpan: 2 }, COLUMNS);
    const now = packed && Object.fromEntries(FRAME.map((entry) => [entry.id, packed[entry.id]]));
    if (previous && now) {
      let biggest = 0;
      for (const id of Object.keys(now)) {
        if (id === 'library') continue;
        biggest = Math.max(biggest, distance(previous[id], now[id]));
      }
      steps += 1;
      histogram.set(biggest, (histogram.get(biggest) || 0) + 1);
      if (biggest > worst) { worst = biggest; worstAt = `column ${column - 1} to ${column}, row ${row}`; }
    }
    previous = now;
  }
}

const buckets = [...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join('  ');
const rough = [...histogram.entries()].filter(([d]) => d >= 3).reduce((n, [, c]) => n + c, 0);
console.log('Dragging one pane across a six-pane canvas, one column per step.');
console.log('A jump is how far the worst-affected neighbour moves in a single step.\n');
console.log(`  worst single-pane jump   ${worst} cells (${worstAt})`);
console.log(`  distribution (jump:steps) ${buckets}`);
console.log(`  steps with a jump of 3+   ${rough}/${steps}`);
console.log(`
Ledger, 2026-09-23. Three models measured on this same sweep:

  packedGridGraph (shipped)        worst 3    3+ jumps 7/76
  resolvePlacements (compress)     worst 13   3+ jumps 11/76
  stateful drag session            worst 28   3+ jumps 7/72, and refused two frames

The shipped model is the most continuous of the three. Both attempts to make
the solver smoother made it worse, each for its own reason: choosing the
compression side by remaining area swaps sides at the dragged pane's midpoint,
and holding the side instead only defers the swap until the side runs out,
where the pane recovers its width by giving up height instead.

The conclusion that survived: a discrete solver cannot be made to produce
continuous motion by local repair, because every transition between two
qualitatively different arrangements is a discontinuity and there is always
one more. Continuity belongs in a motion layer that animates panes toward
whatever the solver decides -- not in the solver.`);
