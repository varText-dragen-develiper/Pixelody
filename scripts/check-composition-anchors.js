'use strict';

// An anchor is the person telling the canvas which pane is not the one that
// should give. Everything here is about that promise being kept: a pane the
// person pinned does not move, does not resize, and does not quietly get
// relocated when the arrangement gets tight. What pushes against it yields
// instead -- including the pane being dragged.

const assert = require('node:assert/strict');
const contract = require('../src/workspace-composition/contract');

const COLUMNS = 24;
// The measured 5 / 14 / 5 archive frame every theme port ships.
const FRAME = [
  { id: 'library', placement: { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 2 } },
  { id: 'stage', placement: { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 2 } },
  { id: 'utility', placement: { columnStart: 20, rowStart: 1, columnSpan: 5, rowSpan: 2 } },
];
const anchoring = (map) => FRAME.map((entry) => (map[entry.id] ? { ...entry, pin: map[entry.id] } : entry));
const same = (a, b) => a.columnStart === b.columnStart && a.rowStart === b.rowStart
  && a.columnSpan === b.columnSpan && a.rowSpan === b.rowSpan;

// --- an unrecognised anchor reads as none, so old graphs stay mobile -------
// The graph key is `pin`; the interface word is "anchor". They differ because
// an overlay node already uses `anchor` for which corner it hangs from.
assert.equal(contract.anchorOf({}), 'none', 'A node with no anchor is mobile.');
assert.equal(contract.anchorOf({ anchor: 'firm' }), 'none', 'An overlay corner named anchor must not be read as a pin.');
assert.equal(contract.anchorOf({ pin: 'firm' }), 'firm');
assert.equal(contract.anchorOf({ pin: 'wobbly' }), 'none', 'An unrecognised anchor must read as none, not throw.');
assert.equal(contract.anchorOf({ pin: 7 }), 'none', 'A non-string anchor must read as none.');

// --- a firm pane is a wall: it never moves, never resizes ------------------
{
  const entries = anchoring({ stage: 'firm' });
  let planned = 0;
  for (let columnStart = 1; columnStart <= 20; columnStart += 1) {
    for (let rowStart = 1; rowStart <= 3; rowStart += 1) {
      const plan = contract.resolveWithAnchors(entries, 'library', { columnStart, rowStart, columnSpan: 5, rowSpan: 2 }, COLUMNS);
      if (!plan.ok) continue;
      planned += 1;
      const stage = plan.placements.stage;
      if (stage) {
        assert.ok(same(stage, FRAME[1].placement), `A firm pane moved: ${JSON.stringify(stage)} at drop ${columnStart},${rowStart}.`);
      }
    }
  }
  assert.ok(planned > 20, `Expected a broad sweep of successful drops, got ${planned}.`);
  console.log(`  ${planned} drops around a firm pane, and it never moved or resized.`);
}

// --- the dragged pane is what yields to a wall ----------------------------
{
  const entries = anchoring({ stage: 'firm' });
  // Dropping the library so it overlaps the stage's left edge.
  const plan = contract.resolveWithAnchors(entries, 'library', { columnStart: 4, rowStart: 1, columnSpan: 5, rowSpan: 2 }, COLUMNS);
  assert.equal(plan.ok, true, 'Overlapping a wall by a little must resolve, not refuse.');
  assert.equal(plan.moverCompressed, true, 'The dragged pane is what gives way to a wall.');
  assert.equal(plan.placements.library.columnStart, 4, 'The dragged pane keeps the edge it was dropped on.');
  assert.equal(plan.placements.library.columnSpan, 2, 'The dragged pane shrinks to exactly the gap it has.');
  assert.equal(plan.placements.stage, undefined, 'The wall is untouched.');
}

// --- a drop entirely on a wall is refused, not silently moved elsewhere ----
{
  const entries = anchoring({ stage: 'firm' });
  const plan = contract.resolveWithAnchors(entries, 'library', { columnStart: 10, rowStart: 1, columnSpan: 5, rowSpan: 2 }, COLUMNS);
  assert.equal(plan.ok, false, 'A drop with no room beside a wall must be refused.');
  assert.equal(plan.reason, 'BLOCKED_BY_ANCHOR', 'A refusal must say which rule stopped it.');
  assert.equal(plan.placements, undefined, 'A refused plan carries no placements.');
}

// --- a firm pane cannot itself be dragged ---------------------------------
{
  const entries = anchoring({ stage: 'firm' });
  const plan = contract.resolveWithAnchors(entries, 'stage', { columnStart: 1, rowStart: 1, columnSpan: 14, rowSpan: 2 }, COLUMNS);
  assert.equal(plan.ok, false, 'Dragging a firmly anchored pane must be refused.');
  assert.equal(plan.reason, 'MOVER_ANCHORED');
}

// --- the two halves of an anchor are independent --------------------------
{
  // position-anchored: may be compressed, may not be relocated.
  const positioned = anchoring({ stage: 'position' });
  const squeeze = contract.resolveWithAnchors(positioned, 'library', { columnStart: 1, rowStart: 1, columnSpan: 8, rowSpan: 2 }, COLUMNS);
  assert.equal(squeeze.ok, true);
  assert.deepEqual(squeeze.compressed, ['stage'], 'A position anchor still allows compression.');
  assert.equal(squeeze.placements.stage.rowStart, 1, 'A position-anchored pane stays on its row.');

  // size-anchored: may be relocated, may not be compressed.
  const sized = anchoring({ stage: 'size' });
  const shove = contract.resolveWithAnchors(sized, 'library', { columnStart: 1, rowStart: 1, columnSpan: 8, rowSpan: 2 }, COLUMNS);
  assert.equal(shove.ok, true);
  assert.deepEqual(shove.relocated, ['stage'], 'A size anchor forces relocation rather than compression.');
  assert.equal(shove.placements.stage.columnSpan, 14, 'A size-anchored pane keeps every column it had.');
  assert.equal(shove.placements.stage.rowSpan, 2, 'A size-anchored pane keeps every row it had.');
}

// --- with nothing anchored, nothing is refused ----------------------------
{
  let refused = 0;
  for (let columnStart = 1; columnStart <= 20; columnStart += 1) {
    const plan = contract.resolveWithAnchors(FRAME, 'library', { columnStart, rowStart: 1, columnSpan: 5, rowSpan: 2 }, COLUMNS);
    if (!plan.ok) refused += 1;
  }
  assert.equal(refused, 0, 'An unanchored canvas must never refuse a drop that fits the grid.');
}

// --- whatever comes back is a legal arrangement ---------------------------
{
  let planned = 0;
  for (const map of [{}, { stage: 'firm' }, { utility: 'firm' }, { stage: 'position' }, { stage: 'size' }, { stage: 'firm', utility: 'firm' }]) {
    const entries = anchoring(map);
    for (let columnStart = 1; columnStart <= 20; columnStart += 1) {
      for (const columnSpan of [1, 5, 10]) {
        const plan = contract.resolveWithAnchors(entries, 'library', { columnStart, rowStart: 1, columnSpan, rowSpan: 2 }, COLUMNS);
        if (!plan.ok) continue;
        planned += 1;
        const final = entries.map((entry) => ({ id: entry.id, placement: plan.placements[entry.id] || entry.placement }));
        for (let left = 0; left < final.length; left += 1) {
          for (let right = left + 1; right < final.length; right += 1) {
            assert.equal(
              contract.placementsOverlap(final[left].placement, final[right].placement), false,
              `Overlapping arrangement: ${final[left].id} and ${final[right].id}, anchors ${JSON.stringify(map)}, drop ${columnStart}+${columnSpan}.`,
            );
          }
        }
      }
    }
  }
  assert.ok(planned > 150, `Expected a broad sweep, got ${planned}.`);
  console.log(`  ${planned} arrangements across six anchor configurations, every one non-overlapping.`);
}

// --- bad input is refused, not guessed ------------------------------------
assert.equal(contract.resolveWithAnchors(null, 'library', {}, COLUMNS).ok, false);
assert.equal(contract.resolveWithAnchors(FRAME, 'nobody', { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 2 }, COLUMNS).ok, false);
assert.equal(contract.resolveWithAnchors(FRAME, 'library', { columnSpan: 5, rowSpan: 2 }, COLUMNS).ok, false);
assert.equal(contract.resolveWithAnchors(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 2 }, 0).ok, false);

console.log('Anchors passed: a firm pane never moves or resizes, the dragged pane is what yields to it, a drop with no room is refused rather than silently relocated, a firm pane cannot itself be dragged, position and size anchors constrain independently, an unanchored canvas refuses nothing, and every arrangement returned is free of overlaps.');
