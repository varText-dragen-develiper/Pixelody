'use strict';

// Move a pane away, then drop it back on exactly the cell it came from. Does
// the canvas return to what it was?
//
// The owner's words: "If I move one thing, everything shifts around, and now
// it's impossible to put that thing back where I found it." That is a
// reversibility property, and this is it as a number.
//
// This check currently FAILS, deliberately. It is the bar from
// invariant I1 of the Edit Canvas rebuild criteria, and
// it is meant to stay red until Edit Canvas is rebuilt to meet it. Do not
// relax the threshold to make it pass; that is the one change that would make
// this file worthless.
//
//   node scripts/check-composition-reversibility.js
//   node scripts/check-composition-reversibility.js --report   (no exit code)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COLUMNS = 96;
const MAX_ROWS = 576;
const STUDIO = path.join(__dirname, '..', 'src', 'workspace-composition', 'canvas-studio.js');
const source = fs.readFileSync(STUDIO, 'utf8');

// The packing loop lives in a closure and cannot be imported, so it is
// replicated below. Same guard as check-grid-packing.js: if the lines it
// copies are gone, this file is stale and says so rather than measuring a
// fiction.
for (const line of [
  'const pushedDown = (preferred, footprint) => {',
  'if (!child.placement?.columnStart || !child.placement?.rowStart) continue;',
  'const moved = pushedDown(preferred, footprint);',
]) {
  if (!source.includes(line)) {
    console.error(`check-composition-reversibility.js replicates canvas-studio.js, and a line it copies is gone:\n  ${line}\nUpdate the replication to match the real packing loop.`);
    process.exit(2);
  }
}

function pack(spatial, sourceId, desired) {
  const occupied = new Set();
  const fits = (p) => {
    if (p.columnStart < 1 || p.rowStart < 1 || p.columnStart + p.columnSpan - 1 > COLUMNS || p.rowStart + p.rowSpan - 1 > MAX_ROWS) return false;
    for (let row = p.rowStart; row < p.rowStart + p.rowSpan; row += 1)
      for (let column = p.columnStart; column < p.columnStart + p.columnSpan; column += 1)
        if (occupied.has(`${column}:${row}`)) return false;
    return true;
  };
  const occupy = (p) => {
    for (let row = p.rowStart; row < p.rowStart + p.rowSpan; row += 1)
      for (let column = p.columnStart; column < p.columnStart + p.columnSpan; column += 1) occupied.add(`${column}:${row}`);
  };
  const normalize = (candidate, footprint) => ({
    columnStart: Math.max(1, Math.min(COLUMNS - footprint.columnSpan + 1, Math.round(candidate?.columnStart) || 1)),
    rowStart: Math.max(1, Math.min(MAX_ROWS - footprint.rowSpan + 1, Math.round(candidate?.rowStart) || 1)),
    columnSpan: footprint.columnSpan,
    rowSpan: footprint.rowSpan,
  });
  const pushedDown = (preferred, footprint) => {
    for (let rowStart = preferred.rowStart; rowStart <= MAX_ROWS - footprint.rowSpan + 1; rowStart += 1) {
      const candidate = { columnStart: preferred.columnStart, rowStart, ...footprint };
      if (fits(candidate)) return candidate;
    }
    return null;
  };
  const out = {};
  const moved = normalize(desired, { columnSpan: desired.columnSpan, rowSpan: desired.rowSpan });
  out[sourceId] = moved;
  occupy(moved);
  for (const child of spatial) {
    if (child.id === sourceId) continue;
    if (!child.placement?.columnStart || !child.placement?.rowStart) continue;
    const footprint = { columnSpan: child.placement.columnSpan, rowSpan: child.placement.rowSpan };
    const preferred = normalize(child.placement, footprint);
    const placement = fits(preferred) ? preferred : pushedDown(preferred, footprint);
    if (!placement) return null;
    out[child.id] = placement;
    occupy(placement);
  }
  return out;
}

// The archive frame every theme ships, plus a second row, in fine cells.
const FRAME = [
  { id: 'library', placement: { columnStart: 1, rowStart: 1, columnSpan: 20, rowSpan: 12 } },
  { id: 'stage', placement: { columnStart: 21, rowStart: 1, columnSpan: 56, rowSpan: 12 } },
  { id: 'utility', placement: { columnStart: 77, rowStart: 1, columnSpan: 20, rowSpan: 12 } },
  { id: 'queue', placement: { columnStart: 1, rowStart: 13, columnSpan: 32, rowSpan: 6 } },
  { id: 'lyrics', placement: { columnStart: 33, rowStart: 13, columnSpan: 32, rowSpan: 6 } },
];

const signature = (arrangement) => Object.keys(arrangement).sort()
  .map((id) => `${id}:${arrangement[id].columnStart},${arrangement[id].rowStart},${arrangement[id].columnSpan}x${arrangement[id].rowSpan}`)
  .join(' | ');
const asList = (arrangement) => FRAME.map((entry) => ({ id: entry.id, placement: arrangement[entry.id] || entry.placement }));
const ORIGINAL = Object.fromEntries(FRAME.map((entry) => [entry.id, entry.placement]));

let tried = 0;
let returned = 0;
const failures = [];
for (const mover of FRAME) {
  const home = mover.placement;
  for (let columnStart = 1; columnStart <= 70; columnStart += 7) {
    for (const rowStart of [1, 7, 13, 19, 25]) {
      const away = pack(FRAME, mover.id, { columnStart, rowStart, columnSpan: home.columnSpan, rowSpan: home.rowSpan });
      if (!away) continue;
      const back = pack(asList(away), mover.id, { ...home });
      tried += 1;
      if (back && signature(back) === signature(ORIGINAL)) returned += 1;
      else if (failures.length < 5) failures.push(`${mover.id} to column ${columnStart} row ${rowStart}: ${back ? 'a different arrangement' : 'refused outright'}`);
    }
  }
}

const rate = returned / tried;
console.log('Move a pane away, then drop it back on the cell it came from.\n');
console.log(`  round trips tried:  ${tried}`);
console.log(`  canvas returned:    ${returned}  (${(rate * 100).toFixed(0)}%)`);
console.log(`  did not return:     ${tried - returned}  (${((1 - rate) * 100).toFixed(0)}%)`);
if (failures.length) {
  console.log('\n  for example:');
  failures.forEach((line) => console.log(`    ${line}`));
}

if (process.argv.includes('--report')) process.exit(0);

console.log('');
assert.equal(returned, tried,
  `Invariant I1, reversibility: every gesture must be undoable by hand. ${tried - returned} of ${tried} round trips did not return the canvas to where it started. `
  + 'This check is expected to fail until Edit Canvas is rebuilt to the criteria in '
  + 'invariant I1. Do not relax it to make it pass.');
console.log('Reversibility passed: every move can be undone by hand.');
