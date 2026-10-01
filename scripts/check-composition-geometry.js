'use strict';

// Stage 1 of the direct-placement plan. These are the numbers a drop is made
// of, so they are proved here without a browser rather than discovered by
// dragging something and squinting at where it landed.

const assert = require('node:assert/strict');
const contract = require('../src/workspace-composition/contract');

// A 24-column grid 1200px wide with an 8px gutter: each track is
// (1200 - 23*8) / 24 = 42.333px, and the pitch is track + gap.
const GRID = { left: 100, top: 50, width: 1200, columns: 24, rowSize: 150, gap: 8, scale: 1 };

function cell(x, y, metrics = GRID) {
  return contract.placementFromPoint(metrics, { x, y });
}

// --- the origin and the far corner ----------------------------------------
assert.deepEqual(cell(100, 50), { columnStart: 1, rowStart: 1 }, 'The grid origin must resolve to the first cell.');
assert.deepEqual(cell(1299, 50), { columnStart: 24, rowStart: 1 }, 'The right edge must resolve to the last column, not past it.');
assert.deepEqual(cell(100, 50 + (150 + 8) * 3), { columnStart: 1, rowStart: 4 }, 'Row pitch must include the gutter.');

// --- a point outside the grid clamps rather than returning a bad cell ------
assert.deepEqual(cell(-9999, -9999), { columnStart: 1, rowStart: 1 }, 'A point above and left of the grid must clamp to the first cell.');
assert.deepEqual(cell(99999, 50), { columnStart: 24, rowStart: 1 }, 'A point right of the grid must clamp to the last column.');

// --- the middle of a track resolves to that track --------------------------
// Column 12 spans from 11*(42.333+8) = 553.67 to +42.33, so its centre is at
// x = 100 + 553.67 + 21.17 = 674.8.
assert.deepEqual(cell(674.8, 50), { columnStart: 12, rowStart: 1 }, 'The centre of a track must resolve to that track.');

// --- zoom is a divisor, not a second code path -----------------------------
// At 2x the same cell sits at twice the offset from the origin.
const zoomed = { ...GRID, width: 2400, scale: 2 };
assert.deepEqual(
  contract.placementFromPoint(zoomed, { x: 100 + (674.8 - 100) * 2, y: 50 }),
  { columnStart: 12, rowStart: 1 },
  'The same cell must resolve at any zoom level.',
);
for (const scale of [0.5, 1, 1.5, 2, 3]) {
  const metrics = { ...GRID, width: 1200 * scale, scale };
  assert.deepEqual(
    contract.placementFromPoint(metrics, { x: 100 + (674.8 - 100) * scale, y: 50 + 0 }),
    { columnStart: 12, rowStart: 1 },
    `Cell resolution drifted at ${scale}x zoom.`,
  );
}

// --- an exact cell boundary lands in the cell it starts, at any zoom -------
// Floor-based hit tests are at the mercy of the float round-trip through the
// zoom divisor. Probing the exact left edge of every cell is what catches it;
// probing cell centres never will.
for (const scale of [0.5, 0.67, 0.8, 1, 1.25, 1.5]) {
  const metrics = { ...GRID, width: 1200 * scale, scale };
  const pitch = ((1200 - 8 * 23) / 24) + 8;
  for (let column = 1; column <= 24; column += 1) {
    assert.deepEqual(
      contract.placementFromPoint(metrics, { x: 100 + (column - 1) * pitch * scale, y: 50 }),
      { columnStart: column, rowStart: 1 },
      `The exact left edge of column ${column} fell into the wrong cell at ${scale}x zoom.`,
    );
  }
  for (let row = 1; row <= 8; row += 1) {
    assert.deepEqual(
      contract.placementFromPoint(metrics, { x: 100, y: 50 + (row - 1) * (150 + 8) * scale }),
      { columnStart: 1, rowStart: row },
      `The exact top edge of row ${row} fell into the wrong cell at ${scale}x zoom.`,
    );
  }
}

// --- metrics that cannot describe a grid return null, never a guess --------
for (const bad of [
  null,
  {},
  { ...GRID, columns: 0 },
  { ...GRID, columns: 97 },
  { ...GRID, width: 0 },
  { ...GRID, rowSize: 0 },
]) {
  assert.equal(contract.placementFromPoint(bad, { x: 100, y: 50 }), null, 'Unusable metrics must return null rather than a guessed cell.');
}
assert.equal(contract.placementFromPoint(GRID, null), null, 'A missing point must return null.');

// --- clamping keeps a placement inside its parent --------------------------
assert.deepEqual(
  contract.clampPlacementToGrid({ columnStart: 20, columnSpan: 10, rowStart: 1, rowSpan: 1 }, 24),
  { columnSpan: 10, rowSpan: 1, columnStart: 15, rowStart: 1 },
  'A span that would overflow the grid must pull its start back, not be truncated.',
);
// The row ceiling is now 24 archive rows expressed in sixths.
assert.deepEqual(
  contract.clampPlacementToGrid({ columnStart: 1, columnSpan: 99, rowSpan: 999 }, 24),
  { columnSpan: 24, rowSpan: 144, columnStart: 1 },
  'Spans must clamp to the contract bounds.',
);
assert.equal(contract.clampPlacementToGrid({ columnSpan: 4 }, 0), null, 'An invalid column count must clamp to null.');
// An unplaced node has no start; clamping must not invent one.
assert.deepEqual(contract.clampPlacementToGrid({ columnSpan: 5, rowSpan: 2 }, 24), { columnSpan: 5, rowSpan: 2 }, 'Clamping must not give an unplaced node a coordinate.');

// --- overlap, which the occupancy work will be built on --------------------
const a = { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 };
assert.equal(contract.placementsOverlap(a, { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 1 }), false, 'Adjacent footprints must not count as overlapping.');
assert.equal(contract.placementsOverlap(a, { columnStart: 5, rowStart: 1, columnSpan: 4, rowSpan: 1 }), true, 'Footprints sharing a column must overlap.');
assert.equal(contract.placementsOverlap(a, { columnStart: 1, rowStart: 2, columnSpan: 5, rowSpan: 1 }), false, 'Footprints on different rows must not overlap.');
assert.equal(contract.placementsOverlap(a, { columnSpan: 5, rowSpan: 1 }), false, 'An unplaced node flows rather than occupying a coordinate, so it cannot collide.');

// --- the archive frame every port ships must remain non-overlapping --------
// This is the 5 / 14 / 5 measured frame. If the predicate ever disagrees with
// it, the predicate is wrong.
const FRAME = [
  { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 },
  { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 1 },
  { columnStart: 20, rowStart: 1, columnSpan: 5, rowSpan: 1 },
];
for (let left = 0; left < FRAME.length; left += 1) {
  for (let right = left + 1; right < FRAME.length; right += 1) {
    assert.equal(contract.placementsOverlap(FRAME[left], FRAME[right]), false, 'The measured archive frame must not self-overlap.');
  }
}

console.log('Composition geometry passed: cell resolution and exact cell boundaries at six zoom levels, clamping inside the parent grid, overlap against the measured archive frame, and null rather than a guess for unusable metrics.');
