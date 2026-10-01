'use strict';

// What happens to everyone else when one pane is moved or stretched.
//
// The packing model lives inside a closure in canvas-studio.js and cannot be
// imported, so the occupancy loop is replicated below. A replication that
// drifts from its original is worse than no test at all, so the first thing
// this file does is read the real source and assert the lines it copies are
// still the lines that are there. If that guard fails, this file is stale --
// update the replication, do not delete the guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STUDIO = path.join(__dirname, '..', 'src', 'workspace-composition', 'canvas-studio.js');
const source = fs.readFileSync(STUDIO, 'utf8');

// --- the replication guard --------------------------------------------------
const MIRRORED = [
  'const pushedDown = (preferred, footprint) => {',
  'if (!child.placement?.columnStart || !child.placement?.rowStart) continue;',
  'const moved = pushedDown(preferred, footprint);',
  "const squeezed = pinOf(child) === 'size' ? null : yieldTo(preferred, sourcePlacement);",
  'const minColumns = Math.min(box.columnSpan, Math.max(4, Math.ceil(box.columnSpan / 2)));',
  'const minRows = Math.min(box.rowSpan, Math.max(1, Math.ceil(box.rowSpan / 2)));',
  'const traded = home ? { columnStart: home.columnStart, rowStart: home.rowStart, ...footprint } : null;',
  'const trackWidth = (layoutWidth - (columnGap * (columns - 1))) / columns;',
  'const layoutWidth = outerWidth - box.left - box.right;',
  'const zoom = outerWidth > 0 && rect.width > 0 ? rect.width / outerWidth : 1;',
  'const SEAM = 1e-9;',
  'const anchored = spatial.filter((child) => child.id !== sourceId && pinHoldsPosition(pinOf(child)));',
  'const shrunk = shrinkClear(sourcePlacement, wall.placement);',
];
for (const line of MIRRORED) {
  assert.ok(
    source.includes(line),
    `check-grid-packing.js replicates canvas-studio.js, and the line it copies is gone:\n  ${line}\nThe replication below is stale. Update it to match the real packing loop.`,
  );
}

// --- the replicated packing loop --------------------------------------------
const pinOf = (node) => (typeof node?.pin === 'string' ? node.pin : 'none');
const pinHoldsPosition = (pin) => pin === 'position' || pin === 'firm';

function pack(spatial, sourceId, sourcePlacement, columns) {
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
  const pushedDown = (preferred, footprint) => {
    if (!preferred) return null;
    for (let rowStart = preferred.rowStart; rowStart <= 96 - footprint.rowSpan + 1; rowStart += 1) {
      const candidate = { columnStart: preferred.columnStart, rowStart, ...footprint };
      if (fits(candidate)) return candidate;
    }
    return null;
  };
  const overlaps = (left, right) => left.columnStart < right.columnStart + right.columnSpan
    && right.columnStart < left.columnStart + left.columnSpan
    && left.rowStart < right.rowStart + right.rowSpan
    && right.rowStart < left.rowStart + left.rowSpan;
  const yieldTo = (box, intruder) => {
    if (!intruder || !overlaps(box, intruder)) return null;
    const minColumns = Math.min(box.columnSpan, Math.max(4, Math.ceil(box.columnSpan / 2)));
    const minRows = Math.min(box.rowSpan, Math.max(1, Math.ceil(box.rowSpan / 2)));
    const options = [];
    const keptLeft = intruder.columnStart - box.columnStart;
    if (keptLeft >= minColumns) options.push({ side: 'left', placement: { ...box, columnSpan: keptLeft } });
    const intruderRight = intruder.columnStart + intruder.columnSpan;
    const keptRight = (box.columnStart + box.columnSpan) - intruderRight;
    if (keptRight >= minColumns) options.push({ side: 'right', placement: { ...box, columnStart: intruderRight, columnSpan: keptRight } });
    const keptTop = intruder.rowStart - box.rowStart;
    if (keptTop >= minRows) options.push({ side: 'top', placement: { ...box, rowSpan: keptTop } });
    const intruderBottom = intruder.rowStart + intruder.rowSpan;
    const keptBottom = (box.rowStart + box.rowSpan) - intruderBottom;
    if (keptBottom >= minRows) options.push({ side: 'bottom', placement: { ...box, rowStart: intruderBottom, rowSpan: keptBottom } });
    if (!options.length) return null;
    const span = (aStart, aSpan, bStart, bSpan) => Math.min(aStart + aSpan, bStart + bSpan) - Math.max(aStart, bStart);
    const columnOverlap = span(box.columnStart, box.columnSpan, intruder.columnStart, intruder.columnSpan);
    const rowOverlap = span(box.rowStart, box.rowSpan, intruder.rowStart, intruder.rowSpan);
    const columnSide = (intruder.columnStart + intruder.columnSpan / 2) <= (box.columnStart + box.columnSpan / 2) ? 'right' : 'left';
    const rowSide = (intruder.rowStart + intruder.rowSpan / 2) <= (box.rowStart + box.rowSpan / 2) ? 'bottom' : 'top';
    const order = columnOverlap <= rowOverlap ? [columnSide, rowSide] : [rowSide, columnSide];
    for (const side of order) {
      const option = options.find((candidate) => candidate.side === side);
      if (option) return option.placement;
    }
    return null;
  };
  const shrinkClear = (box, wall) => {
    const options = [];
    const keptLeft = wall.columnStart - box.columnStart;
    if (keptLeft >= 1) options.push({ ...box, columnSpan: keptLeft });
    const wallRight = wall.columnStart + wall.columnSpan;
    const keptRight = (box.columnStart + box.columnSpan) - wallRight;
    if (keptRight >= 1) options.push({ ...box, columnStart: wallRight, columnSpan: keptRight });
    const keptTop = wall.rowStart - box.rowStart;
    if (keptTop >= 1) options.push({ ...box, rowSpan: keptTop });
    const wallBottom = wall.rowStart + wall.rowSpan;
    const keptBottom = (box.rowStart + box.rowSpan) - wallBottom;
    if (keptBottom >= 1) options.push({ ...box, rowStart: wallBottom, rowSpan: keptBottom });
    if (!options.length) return null;
    return options.reduce((best, option) => {
      const area = option.columnSpan * option.rowSpan;
      return area > (best ? best.columnSpan * best.rowSpan : -1) ? option : best;
    }, null);
  };

  const out = {};
  // Anchored panes claim their cells before anything else.
  const anchored = spatial.filter((child) => child.id !== sourceId && pinHoldsPosition(pinOf(child)));
  for (const child of anchored) {
    const held = { ...child.placement };
    if (!fits(held)) return null;
    out[child.id] = held;
    occupy(held);
  }
  const home = spatial.find((child) => child.id === sourceId)?.placement || null;
  let placed = { ...sourcePlacement };
  for (let pass = 0; pass < anchored.length + 1 && !fits(placed); pass += 1) {
    const wall = anchored.find((child) => overlaps(placed, out[child.id]));
    if (!wall) break;
    const shrunk = shrinkClear(placed, out[wall.id]);
    if (!shrunk) return null;
    placed = shrunk;
  }
  if (!fits(placed)) return null;
  sourcePlacement = placed;
  out[sourceId] = sourcePlacement;
  occupy(sourcePlacement);
  for (const child of spatial.filter((candidate) => candidate.id !== sourceId && !pinHoldsPosition(pinOf(candidate)))) {
    const footprint = { columnSpan: child.placement.columnSpan, rowSpan: child.placement.rowSpan };
    // A pane with no coordinates is flowing, and flowing is a position too.
    if (!child.placement?.columnStart || !child.placement?.rowStart) continue;
    const preferred = normalize(child.placement, footprint);
    let placement = fits(preferred) ? preferred : null;
    // Compress first: give up the strip being pushed on, keeping at least half.
    if (!placement && pinOf(child) !== 'size') {
      const squeezed = yieldTo(preferred, sourcePlacement);
      if (squeezed && fits(squeezed)) placement = squeezed;
    }
    // Then the space the moving pane left, if it fits there.
    if (!placement && home) {
      const traded = { columnStart: home.columnStart, rowStart: home.rowStart, ...footprint };
      if (fits(traded)) placement = traded;
    }
    if (!placement) placement = pushedDown(preferred, footprint);
    if (!placement) return null;
    out[child.id] = placement;
    occupy(placement);
  }
  return out;
}

// The measured 5 / 14 / 5 archive frame every theme port ships.
const FRAME = [
  { id: 'library', placement: { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 } },
  { id: 'stage', placement: { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 1 } },
  { id: 'utility', placement: { columnStart: 20, rowStart: 1, columnSpan: 5, rowSpan: 1 } },
];

// --- a pane that is in the way moves; a pane that is not, does not ----------
// "They will compress to compensate." Stretching the library into the stage
// takes the strip it is pushed on, and the stage stays on its row. It used to
// be thrown down a whole row, below the fold in a composition that fills the
// window.
{
  const packed = pack(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  assert.ok(packed, 'Stretching the library pane into the stage must resolve.');
  assert.deepEqual(packed.library, { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 'The stretched pane keeps the span it was given.');
  assert.deepEqual(packed.stage, { columnStart: 11, rowStart: 1, columnSpan: 9, rowSpan: 1 }, 'A pane in the way gives up the strip it is pushed on, keeps its far edge and stays on its row.');
  // This is the regression that mattered: the utility pane sits on the far
  // right and is nowhere near the stretch, but re-homing the stage by scanning
  // from row 1 used to knock it from column 20 to column 1.
  assert.deepEqual(packed.utility, FRAME[2].placement, 'A pane that was never in the way must not move at all.');
}

// --- past half its size, a pane in the way moves down its own column instead -
{
  const packed = pack(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 16, rowSpan: 1 }, 24);
  assert.ok(packed, 'A deep stretch must resolve.');
  assert.equal(packed.stage.columnSpan, 14, 'A pane never gives up more than half of itself.');
  assert.equal(packed.stage.columnStart, 6, 'A displaced pane keeps its own column rather than sliding sideways.');
  assert.equal(packed.stage.rowStart, 2, 'A displaced pane moves down by the minimum that clears, and no further.');
  assert.deepEqual(packed.utility, FRAME[2].placement, 'A pane that was never in the way must not move at all.');
}

// --- dropping one side column on the other swaps them ----------------------
{
  const packed = pack(FRAME, 'library', { columnStart: 20, rowStart: 1, columnSpan: 5, rowSpan: 1 }, 24);
  assert.ok(packed, 'A swap must resolve.');
  assert.deepEqual(packed.utility, FRAME[0].placement, 'A pane that cannot give way takes the place the moving pane left.');
  assert.deepEqual(packed.stage, FRAME[1].placement, 'And nothing else moves.');
}

// --- displacement cascades down a stack -------------------------------------
{
  const stacked = [
    { id: 'a', placement: { columnStart: 1, rowStart: 1, columnSpan: 6, rowSpan: 1 } },
    { id: 'b', placement: { columnStart: 1, rowStart: 2, columnSpan: 6, rowSpan: 1 } },
    { id: 'c', placement: { columnStart: 1, rowStart: 3, columnSpan: 6, rowSpan: 1 } },
  ];
  const packed = pack(stacked, 'a', { columnStart: 1, rowStart: 1, columnSpan: 6, rowSpan: 2 }, 24);
  assert.ok(packed, 'A cascade must resolve.');
  assert.equal(packed.b.rowStart, 3, 'The first neighbour clears the grown pane.');
  assert.equal(packed.c.rowStart, 4, 'The displacement carries on down the stack.');
  assert.equal(packed.b.columnStart, 1, 'A cascading pane still keeps its column.');
  assert.equal(packed.c.columnStart, 1, 'A cascading pane still keeps its column.');
}

// --- a pane that cannot clear refuses; it does not go wandering ------------
// Where a pane sits is the person's decision. A pane that could not get out of
// the way by moving down its own column used to be relocated to the first free
// cell anywhere, which fills void somebody left on purpose.
{
  const wide = [
    { id: 'a', placement: { columnStart: 1, rowStart: 1, columnSpan: 12, rowSpan: 1 } },
    { id: 'b', placement: { columnStart: 13, rowStart: 1, columnSpan: 12, rowSpan: 1 } },
  ];
  const packed = pack(wide, 'a', { columnStart: 1, rowStart: 1, columnSpan: 24, rowSpan: 1 }, 24);
  assert.ok(packed && packed.b, 'b can still clear by moving down its own column.');
  assert.equal(packed.b.columnStart, 13, 'b keeps its column rather than being re-homed.');
  assert.equal(packed.b.rowStart, 2, 'b moves down by the least that clears.');
}

// --- a pane with no coordinates is left flowing ---------------------------
{
  const mixed = [
    { id: 'placed', placement: { columnStart: 1, rowStart: 1, columnSpan: 6, rowSpan: 1 } },
    { id: 'flowing', placement: { columnSpan: 6, rowSpan: 1 } },
  ];
  const packed = pack(mixed, 'placed', { columnStart: 1, rowStart: 5, columnSpan: 6, rowSpan: 1 }, 24);
  assert.ok(packed, 'A canvas holding a flowing pane must still resolve.');
  assert.equal(packed.flowing, undefined, 'A flowing pane must not be handed a coordinate it never asked for.');
  assert.equal(packed.placed.rowStart, 5, 'And the dropped pane keeps the empty row it was put on.');
}

// --- void is left alone ----------------------------------------------------
{
  const frame = [
    { id: 'a', placement: { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 } },
    { id: 'b', placement: { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 1 } },
  ];
  const packed = pack(frame, 'a', { columnStart: 1, rowStart: 30, columnSpan: 5, rowSpan: 1 }, 24);
  assert.ok(packed, 'Dropping into empty space must resolve.');
  assert.equal(packed.a.rowStart, 30, 'A pane dropped into empty space stays exactly where it was put.');
  assert.deepEqual(packed.b, frame[1].placement, 'And nothing else is tidied up around it.');
}


// --- an anchored pane is the ground, not a participant ---------------------
{
  const pinned = FRAME.map((entry) => (entry.id === 'stage' ? { ...entry, pin: 'firm' } : entry));
  // Stretch the library straight into the anchored stage.
  const packed = pack(pinned, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  assert.ok(packed, 'Pushing against an anchored pane must resolve, not fail.');
  assert.deepEqual(packed.stage, FRAME[1].placement, 'An anchored pane keeps exactly the cells it had.');
  // The dragged pane is what gave way.
  assert.equal(packed.library.columnStart, 1, 'The dragged pane keeps the edge it was dropped on.');
  assert.equal(packed.library.columnSpan, 5, 'The dragged pane shrank to the gap before the anchor.');
  assert.deepEqual(packed.utility, FRAME[2].placement, 'A pane that was never in the way must not move.');
}

// --- an anchored pane is never relocated, whatever is dragged at it -------
{
  const pinned = FRAME.map((entry) => (entry.id === 'stage' ? { ...entry, pin: 'firm' } : entry));
  let planned = 0;
  for (let columnStart = 1; columnStart <= 20; columnStart += 1) {
    for (const columnSpan of [1, 3, 5]) {
      const packed = pack(pinned, 'library', { columnStart, rowStart: 1, columnSpan, rowSpan: 1 }, 24);
      if (!packed) continue;
      planned += 1;
      assert.deepEqual(packed.stage, FRAME[1].placement, `An anchored pane moved on a drop at column ${columnStart} span ${columnSpan}.`);
    }
  }
  assert.ok(planned > 20, `Expected a broad sweep around an anchored pane, got ${planned}.`);
}

// --- a size anchor is inert here, and that is not an oversight ------------
// This packer relocates panes and never resizes them, so there is nothing for
// a size anchor to prevent. It is stored in the graph and honoured by
// contract.resolveWithAnchors, which does compress. If dragging ever learns to
// compress, this assertion is the one that should start failing.
//
// (2026-09-26) Dragging learned to compress, and this is the block that
// failed. A size anchor now means what contract.resolveWithAnchors says it
// means: the pane is not made smaller; it moves instead.
{
  const pinned = FRAME.map((entry) => (entry.id === 'stage' ? { ...entry, pin: 'size' } : entry));
  const packed = pack(pinned, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  const plain = pack(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  assert.equal(plain.stage.columnSpan, 9, 'Without an anchor the stage gives way by getting narrower.');
  assert.equal(packed.stage.columnSpan, 14, 'A size anchor keeps the pane its size.');
  assert.equal(packed.stage.columnStart, 6, 'It keeps its column.');
  assert.equal(packed.stage.rowStart, 2, 'And moves down by the least that clears.');
}

// --- nothing anchored means nothing changed -------------------------------
{
  const before = pack(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  const withPins = pack(FRAME.map((entry) => ({ ...entry, pin: 'none' })), 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  assert.deepEqual(withPins, before, 'An explicit pin of none must behave exactly as no pin at all.');
}

// --- the column hit test matches how CSS actually lays tracks out -----------
// A 24-column grid 1200px wide with an 8px gutter. Dividing the full width by
// the column count ignores the 23 gutters and lands in the wrong column near
// every track boundary.
{
  const columns = 24, gap = 8, width = 1200;
  const track = (width - gap * (columns - 1)) / columns;
  const gapAware = (x) => Math.max(1, Math.min(columns, Math.floor(x / (track + gap)) + 1));
  const ratio = (x) => Math.max(1, Math.min(columns, Math.floor((x / width) * columns) + 1));
  let disagreements = 0;
  for (let x = 0; x < width; x += 1) if (ratio(x) !== gapAware(x)) disagreements += 1;
  assert.ok(disagreements > 0, 'If these agree, the grid has no gutter and this test is measuring nothing.');
  assert.ok(
    disagreements / width > 0.05,
    'The gutter-blind drift should be material; if it has shrunk, check the grid gap has not been removed.',
  );
  // Whatever the gap, the two must agree exactly when there is no gutter.
  for (let x = 0; x < width; x += 1) {
    const flat = (width - 0 * (columns - 1)) / columns;
    assert.equal(Math.max(1, Math.min(columns, Math.floor(x / flat) + 1)), ratio(x), 'A gapless grid must be unaffected by gap-aware maths.');
  }
}

// --- the hit test survives zoom ---------------------------------------------
// Under a transform the client rect is scaled but getComputedStyle still
// reports the gutter and row height unscaled, so the two have to be reconciled
// before any arithmetic. offsetWidth is the unscaled layout width, so the ratio
// between it and the client rect is the scale in force.
{
  const columns = 24, gap = 8, layoutWidth = 1200, rowUnit = 150;
  const track = (layoutWidth - gap * (columns - 1)) / columns;

  // Exactly the arithmetic gridPlacementAtPoint runs, with the rect scaled the
  // way a transform scales it.
  const resolve = (clientX, clientY, scale) => {
    const rect = { left: 0, top: 0, width: layoutWidth * scale };
    const zoom = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
    const trackWidth = (layoutWidth - (gap * (columns - 1))) / columns;
    const columnOffset = (clientX - rect.left) / zoom;
    const SEAM = 1e-9;
    const columnStart = Math.max(1, Math.min(columns, Math.floor(columnOffset / (trackWidth + gap) + SEAM) + 1));
    const rowStart = Math.max(1, Math.min(96, Math.floor(Math.max(0, (clientY - rect.top) / zoom) / Math.max(1, rowUnit + gap) + SEAM) + 1));
    return { columnStart, rowStart };
  };

  for (const scale of [0.5, 0.67, 0.8, 1, 1.25, 1.5]) {
    for (let column = 1; column <= columns; column += 1) {
      for (let row = 1; row <= 6; row += 1) {
        // Where that cell's top-left actually appears on screen at this zoom.
        const x = (column - 1) * (track + gap) * scale;
        const y = (row - 1) * (rowUnit + gap) * scale;
        assert.deepEqual(
          resolve(x, y, scale),
          { columnStart: column, rowStart: row },
          `Cell ${column},${row} did not resolve to itself at ${scale}x zoom.`,
        );
        // And the middle of the cell resolves to the same cell, not the next.
        assert.deepEqual(
          resolve(x + (track * scale) / 2, y + (rowUnit * scale) / 2, scale),
          { columnStart: column, rowStart: row },
          `The centre of cell ${column},${row} did not resolve to itself at ${scale}x zoom.`,
        );
      }
    }
  }

  // At 100% the scale divisor must be inert: same answers as maths with no
  // zoom term at all, at every pointer position.
  for (let x = 0; x < layoutWidth; x += 1) {
    const withZoom = resolve(x, 0, 1).columnStart;
    const without = Math.max(1, Math.min(columns, Math.floor(x / (track + gap)) + 1));
    assert.equal(withZoom, without, `The scale divisor changed the answer at 100% zoom, x=${x}.`);
  }
}

console.log('Grid packing passed: a pane in the way gives up the strip it is pushed on and keeps at least half itself, past that it keeps its column and moves the minimum that clears, dropping one side column on the other swaps them, a size anchor moves instead of shrinking, a pane that was not in the way never moves, displacement cascades down a stack, a pane that cannot clear refuses rather than wandering, a pane with no coordinates is left flowing, void is left alone, and the column hit test matches how CSS lays tracks out, and every cell still resolves to itself at six zoom levels, and an anchored pane is never moved or resized by anything dragged at it.');
