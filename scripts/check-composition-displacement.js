'use strict';

// Compress first, relocate only when compression cannot clear it.
//
// The property that matters to a person watching: the pane you are pushing
// against gets thinner and stays where it is. It only goes somewhere else when
// it has run out of room to get thinner, and when it does, everything it then
// disturbs behaves the same way.

const assert = require('node:assert/strict');
const contract = require('../src/workspace-composition/contract');

// The measured 5 / 14 / 5 archive frame every theme port ships.
const FRAME = [
  { id: 'library', placement: { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 } },
  { id: 'stage', placement: { columnStart: 6, rowStart: 1, columnSpan: 14, rowSpan: 1 } },
  { id: 'utility', placement: { columnStart: 20, rowStart: 1, columnSpan: 5, rowSpan: 1 } },
];

// --- compressing alone, on the frame every theme ships ----------------------
{
  // The library grows from 5 columns to 10, eating the stage's first 4.
  const plan = contract.resolvePlacements(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  assert.equal(plan.ok, true, 'A stretch into a neighbour that can simply get thinner must resolve.');
  assert.deepEqual(plan.compressed, ['stage'], 'The stage is the only pane that should have been compressed.');
  assert.deepEqual(plan.relocated, [], 'Nothing should have relocated: compressing was enough.');
  assert.equal(plan.placements.stage.rowStart, 1, 'A compressed pane stays on its row.');
  assert.equal(plan.placements.stage.columnStart, 11, 'The stage keeps its right edge and yields its left.');
  assert.equal(plan.placements.stage.columnSpan, 9, 'The stage gives up exactly the 5 columns it lost, no more.');
  assert.equal(plan.placements.utility, undefined, 'A pane nowhere near the stretch must not be touched.');
}

// --- a compressed footprint is always a subset of the old one --------------
// This is the property that makes compression free: it cannot collide with
// anything its old footprint did not, so it never needs a second pass.
{
  const box = { columnStart: 4, rowStart: 2, columnSpan: 8, rowSpan: 3 };
  for (let columnStart = 1; columnStart <= 16; columnStart += 1) {
    for (let rowStart = 1; rowStart <= 6; rowStart += 1) {
      for (const columnSpan of [1, 3, 6]) {
        for (const rowSpan of [1, 2]) {
          const blocker = { columnStart, rowStart, columnSpan, rowSpan };
          const smaller = contract.compressedAway(box, blocker);
          if (!smaller) continue;
          assert.ok(smaller.columnStart >= box.columnStart, 'A compressed pane never starts left of where it was.');
          assert.ok(smaller.rowStart >= box.rowStart, 'A compressed pane never starts above where it was.');
          assert.ok(
            smaller.columnStart + smaller.columnSpan <= box.columnStart + box.columnSpan,
            'A compressed pane never extends past its old right edge.',
          );
          assert.ok(
            smaller.rowStart + smaller.rowSpan <= box.rowStart + box.rowSpan,
            'A compressed pane never extends past its old bottom edge.',
          );
          assert.equal(
            contract.placementsOverlap(smaller, blocker), false,
            'A compression that does not actually clear the blocker is not a compression.',
          );
        }
      }
    }
  }
}

// --- a floor forces relocation instead --------------------------------------
{
  // The same stretch, but the stage refuses to go below 12 columns. It cannot
  // get thin enough, so it has to move -- and it moves straight down.
  const floored = FRAME.map((entry) => (entry.id === 'stage' ? { ...entry, floors: { minColumnSpan: 12 } } : entry));
  const plan = contract.resolvePlacements(floored, 'library', { columnStart: 1, rowStart: 1, columnSpan: 10, rowSpan: 1 }, 24);
  assert.equal(plan.ok, true, 'A pane that cannot compress must still find a home.');
  assert.deepEqual(plan.compressed, [], 'Nothing could be compressed here.');
  assert.deepEqual(plan.relocated, ['stage'], 'The stage had to relocate.');
  assert.equal(plan.placements.stage.columnStart, 6, 'A relocated pane keeps its column.');
  assert.equal(plan.placements.stage.rowStart, 2, 'A relocated pane moves down by the minimum that clears.');
  assert.equal(plan.placements.stage.columnSpan, 14, 'A relocated pane keeps the size it was given.');
  assert.equal(plan.placements.utility, undefined, 'The utility pane was never in the way and must not move.');
}

// --- compression is preferred even when relocating would also work ---------
{
  // Both options are open here. Compressing must win, because it is the one
  // that leaves the pane where the person can still see it.
  const pair = [
    { id: 'a', placement: { columnStart: 1, rowStart: 1, columnSpan: 6, rowSpan: 1 } },
    { id: 'b', placement: { columnStart: 7, rowStart: 1, columnSpan: 12, rowSpan: 1 } },
  ];
  const plan = contract.resolvePlacements(pair, 'a', { columnStart: 1, rowStart: 1, columnSpan: 9, rowSpan: 1 }, 24);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.relocated, [], 'Relocation must not be chosen while compression is available.');
  assert.deepEqual(plan.compressed, ['b']);
  assert.equal(plan.placements.b.rowStart, 1, 'b stayed on its row.');
}

// --- relocation cascades, compression does not -----------------------------
{
  const stacked = [
    { id: 'a', placement: { columnStart: 1, rowStart: 1, columnSpan: 6, rowSpan: 1 }, floors: { minRowSpan: 1 } },
    { id: 'b', placement: { columnStart: 1, rowStart: 2, columnSpan: 6, rowSpan: 1 }, floors: { minColumnSpan: 6, minRowSpan: 1 } },
    { id: 'c', placement: { columnStart: 1, rowStart: 3, columnSpan: 6, rowSpan: 1 }, floors: { minColumnSpan: 6, minRowSpan: 1 } },
  ];
  // a grows downward into b, which cannot get narrower (floor 6 of 6) and
  // cannot get shorter (already 1 row), so it must move -- and hits c.
  const plan = contract.resolvePlacements(stacked, 'a', { columnStart: 1, rowStart: 1, columnSpan: 6, rowSpan: 2 }, 24);
  assert.equal(plan.ok, true, 'A cascade must resolve.');
  assert.equal(plan.placements.b.rowStart, 3, 'The first neighbour clears the grown pane.');
  assert.equal(plan.placements.c.rowStart, 4, 'The displacement carries on down the stack.');
  assert.deepEqual(plan.relocated, ['b', 'c'], 'Both moves were relocations, in order.');
}

// --- nothing is half-applied -------------------------------------------------
{
  const tight = [
    { id: 'top', placement: { columnStart: 1, rowStart: 575, columnSpan: 6, rowSpan: 1 }, floors: { minColumnSpan: 6 } },
    { id: 'bottom', placement: { columnStart: 1, rowStart: 576, columnSpan: 6, rowSpan: 1 }, floors: { minColumnSpan: 6 } },
  ];
  const plan = contract.resolvePlacements(tight, 'top', { columnStart: 1, rowStart: 575, columnSpan: 6, rowSpan: 2 }, 24);
  assert.equal(plan.ok, false, 'An arrangement that runs off the addressable canvas must be refused.');
  assert.equal(plan.reason, 'NO_ROOM', 'A refusal must say why.');
  assert.equal(plan.placements, undefined, 'A refused plan must carry no partial placements.');
}

// --- the result is always a legal arrangement --------------------------------
// Whatever the planner returns, no two panes may share a cell. This is the
// assertion that would catch a compression or a push that merely moved the
// collision somewhere else.
{
  let planned = 0;
  for (let columnStart = 1; columnStart <= 20; columnStart += 1) {
    for (const columnSpan of [1, 4, 8, 14]) {
      for (const rowSpan of [1, 2]) {
        const plan = contract.resolvePlacements(FRAME, 'library', { columnStart, rowStart: 1, columnSpan, rowSpan }, 24);
        if (!plan.ok) continue;
        planned += 1;
        const final = FRAME.map((entry) => ({ id: entry.id, placement: plan.placements[entry.id] || entry.placement }));
        for (let left = 0; left < final.length; left += 1) {
          for (let right = left + 1; right < final.length; right += 1) {
            assert.equal(
              contract.placementsOverlap(final[left].placement, final[right].placement), false,
              `The planner returned an overlapping arrangement: ${final[left].id} and ${final[right].id} for drop at column ${columnStart} span ${columnSpan}x${rowSpan}.`,
            );
          }
        }
      }
    }
  }
  assert.ok(planned > 100, `Expected a broad sweep of successful plans, got ${planned}.`);
  console.log(`  ${planned} planned arrangements, every one of them non-overlapping.`);
}

// --- bad input is refused, not guessed ---------------------------------------
assert.equal(contract.resolvePlacements(null, 'a', {}, 24).ok, false, 'Entries that are not a list must be refused.');
assert.equal(contract.resolvePlacements(FRAME, 'library', { columnSpan: 5, rowSpan: 1 }, 24).ok, false, 'A desired placement with no coordinate must be refused.');
assert.equal(contract.resolvePlacements(FRAME, 'nobody', { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 }, 24).ok, false, 'A mover that is not in the grid must be refused.');
assert.equal(contract.resolvePlacements(FRAME, 'library', { columnStart: 1, rowStart: 1, columnSpan: 5, rowSpan: 1 }, 0).ok, false, 'An impossible column count must be refused.');

console.log('Displacement passed: a pane in the way gets thinner and stays put, it only relocates when it cannot get thin enough, relocation moves by the minimum and cascades while compression never does, a compressed footprint is always a subset of the one it replaces, and every arrangement the planner returns is free of overlaps.');
