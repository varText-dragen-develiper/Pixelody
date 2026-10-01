'use strict';

// The packer, run exactly as it ships.
//
// check-grid-packing.js replicates the occupancy loop and guards the
// replication against drift, which is the right instinct. But a guard on
// copied lines cannot catch a number the copy never took: the real packer
// clamped the grid to 24 columns for a day after the canvas was divided into
// 96, while the replication took its column count as a parameter and was only
// ever handed 24. Every test passed. In the app, every pane wider than six
// archive columns, and every pane sitting right of the sixth, could not be
// moved at all -- the arrangement was refused and the drag did nothing.
//
// So this file replicates nothing. It lifts the real declarations out of
// canvas-studio.js and runs them. If the file is reformatted enough that the
// lift fails, this check fails loudly, which is the correct outcome.
//
//   node scripts/check-studio-packing.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STUDIO = path.join(__dirname, '..', 'src', 'workspace-composition', 'canvas-studio.js');
const source = fs.readFileSync(STUDIO, 'utf8');

// --- lift, don't copy -------------------------------------------------------
// Every one of these is declared at one indent inside createStudio, so a
// declaration runs from its opening line to the first line that closes at that
// indent. Formatting is load-bearing here and that is deliberate: a lift that
// silently grabbed the wrong text would be worse than no check.
function lift(name) {
  const opener = new RegExp(`^ {4}(?:function ${name}\\(|const ${name} = )`, 'gm');
  const found = [...source.matchAll(opener)];
  assert.equal(found.length, 1, `check-studio-packing.js lifts \`${name}\` out of canvas-studio.js and found ${found.length} declarations of it. Update the lift.`);
  const lines = source.slice(found[0].index).split('\n');
  if (/;\s*$/.test(lines[0]) && !/[{[(]\s*$/.test(lines[0])) return lines[0];
  for (let index = 1; index < lines.length; index += 1) {
    if (/^ {4}\}\)?;?\s*$/.test(lines[index])) return lines.slice(0, index + 1).join('\n');
  }
  throw new Error(`check-studio-packing.js could not find the end of \`${name}\` in canvas-studio.js.`);
}

const LIFTED = ['walk', 'findNode', 'parentOf', 'MAX_ROWS', 'MAX_COLUMNS', 'MAX_ROW_SPAN', 'DEFAULT_COLUMNS', 'PIN_LABELS', 'pinOf', 'pinHoldsPosition', 'defaultGridFootprint', 'soleFiller', 'packingNotes', 'packedGridGraph'];
// The player bar a gesture measures (canvas-studio.js heroFold) is state, not
// a declaration the lift can take; with no gesture in progress it is null.
const scope = new Function(`let heroFold = null;\n${LIFTED.map(lift).join('\n\n')}\nreturn { packedGridGraph, MAX_ROWS, MAX_COLUMNS, MAX_ROW_SPAN, DEFAULT_COLUMNS };`)();
const { packedGridGraph } = scope;

// The studio cannot import the contract, so it mirrors these. A mirror nobody
// checks is how the 24 survived the division in the first place.
const contract = require(path.join(__dirname, '..', 'src', 'workspace-composition', 'contract.js'));
assert.equal(scope.MAX_COLUMNS, contract.MAX_COLUMNS, 'canvas-studio.js mirrors contract.MAX_COLUMNS and the two have drifted.');
assert.equal(scope.MAX_ROW_SPAN, contract.MAX_ROW_SPAN, 'canvas-studio.js mirrors contract.MAX_ROW_SPAN and the two have drifted.');
assert.equal(scope.MAX_ROWS, contract.MAX_ROWS, 'canvas-studio.js mirrors contract.MAX_ROWS and the two have drifted.');
// foreground.css spells the same fallback; if one moves without the other the
// hit test aims at a grid the browser did not draw.
const foreground = fs.readFileSync(path.join(__dirname, '..', 'src', 'foreground.css'), 'utf8');
assert.ok(
  foreground.includes(`var(--cw-columns, ${scope.DEFAULT_COLUMNS})`),
  `canvas-studio.js falls back to ${scope.DEFAULT_COLUMNS} columns and foreground.css does not spell the same number.`,
);

// --- the canvas the app actually runs ---------------------------------------
const COLUMNS = 96;
const pane = (id, columnStart, columnSpan, rowStart, rowSpan) => ({
  id, type: 'module', moduleKey: `${id}.module`,
  placement: { columnStart, rowStart, columnSpan, rowSpan },
});
// The archive frame, in fine units: 5 / 14 / 5 of 24 becomes 20 / 56 / 20 of 96.
const archiveGrid = () => ({
  id: 'root', type: 'grid', columns: COLUMNS,
  children: [pane('library', 1, 20, 1, 6), pane('stage', 21, 56, 1, 6), pane('utility', 77, 20, 1, 6)],
});
const placementOf = (graph, id) => graph.children.find((child) => child.id === id)?.placement;

let failures = 0;
const check = (label, run) => {
  try { run(); console.log(`  ok    ${label}`); } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        ${error.message.split('\n')[0]}`);
  }
};

console.log('The packer, lifted from canvas-studio.js and run at the canvas\'s real width\n');

check('every column of the grid can be reached', () => {
  const unreachable = [];
  for (let columnStart = 1; columnStart <= COLUMNS - 20 + 1; columnStart += 1) {
    const graph = { id: 'root', type: 'grid', columns: COLUMNS, children: [pane('solo', 1, 20, 1, 6)] };
    const packed = packedGridGraph(graph, 'solo', { columnStart, rowStart: 1, columnSpan: 20, rowSpan: 6 });
    if (!packed || placementOf(packed, 'solo')?.columnStart !== columnStart) unreachable.push(columnStart);
  }
  assert.equal(unreachable.length, 0, `${unreachable.length} of ${COLUMNS - 19} column positions are unreachable, starting at column ${unreachable[0]}. A pane cannot be put there at all.`);
});

check('the archive frame survives being handed back to the packer', () => {
  const packed = packedGridGraph(archiveGrid(), 'library', { columnStart: 1, rowStart: 1, columnSpan: 20, rowSpan: 6 });
  assert.ok(packed, 'the packer refused the arrangement it was already in');
  assert.deepEqual(placementOf(packed, 'stage'), { columnStart: 21, rowStart: 1, columnSpan: 56, rowSpan: 6 }, 'the Stage moved');
  assert.deepEqual(placementOf(packed, 'utility'), { columnStart: 77, rowStart: 1, columnSpan: 20, rowSpan: 6 }, 'the utility column moved');
});

check('a pane dropped into empty space below stays there and disturbs nothing', () => {
  const packed = packedGridGraph(archiveGrid(), 'library', { columnStart: 1, rowStart: 13, columnSpan: 20, rowSpan: 6 });
  assert.ok(packed, 'the packer refused a drop into empty space');
  assert.deepEqual(placementOf(packed, 'library'), { columnStart: 1, rowStart: 13, columnSpan: 20, rowSpan: 6 });
  assert.deepEqual(placementOf(packed, 'stage'), { columnStart: 21, rowStart: 1, columnSpan: 56, rowSpan: 6 }, 'the Stage moved');
  assert.deepEqual(placementOf(packed, 'utility'), { columnStart: 77, rowStart: 1, columnSpan: 20, rowSpan: 6 }, 'the utility column moved');
});

check('a pane can be dropped into empty space on the right', () => {
  const graph = archiveGrid();
  graph.children.push(pane('queue', 1, 12, 7, 6));
  const packed = packedGridGraph(graph, 'queue', { columnStart: 80, rowStart: 13, columnSpan: 12, rowSpan: 6 });
  assert.ok(packed, 'the packer refused a drop on the right-hand side of the canvas');
  assert.deepEqual(placementOf(packed, 'queue'), { columnStart: 80, rowStart: 13, columnSpan: 12, rowSpan: 6 });
});

check('a pane may be taller than one archive row', () => {
  const graph = { id: 'root', type: 'grid', columns: COLUMNS, children: [pane('tall', 1, 20, 1, 6)] };
  const packed = packedGridGraph(graph, 'tall', { columnStart: 1, rowStart: 1, columnSpan: 20, rowSpan: 72 });
  assert.ok(packed, 'the packer refused a pane twelve archive rows tall');
  assert.equal(placementOf(packed, 'tall')?.rowSpan, 72, 'the row span was clamped');
});

check('a pane may be wider than six archive columns', () => {
  const graph = { id: 'root', type: 'grid', columns: COLUMNS, children: [pane('wide', 1, 20, 1, 6)] };
  const packed = packedGridGraph(graph, 'wide', { columnStart: 1, rowStart: 1, columnSpan: 96, rowSpan: 6 });
  assert.ok(packed, 'the packer refused a full-width pane');
  assert.equal(placementOf(packed, 'wide')?.columnSpan, 96, 'the column span was clamped');
});

// --- the graphs the app actually ships ------------------------------------
// Everything above is a hand-built fixture. The Stage bug was in the data: the
// port table declared the Stage's own grid 24 columns wide while its children
// spanned 96, and no fixture ever had that shape. So run the real port graphs.
const ports = require(path.join(__dirname, '..', 'src', 'theme-runtime', 'canvas-theme-ports.js'));
const findIn = (node, id) => {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) { const hit = findIn(child, id); if (hit) return hit; }
  return null;
};
const parentIn = (node, id, parent = null) => {
  if (!node) return null;
  if (node.id === id) return parent;
  for (const child of node.children || []) { const hit = parentIn(child, id, node); if (hit) return hit; }
  return null;
};
const refusedInside = [];
const oversized = [];
for (const key of ports.KEYS) {
  const graph = ports.graphForPort(key);
  // Every child of every grid must fit that grid. This is the invariant the
  // contract does not enforce -- it checks spans against MAX_COLUMNS, not
  // against the parent -- and it is exactly what went wrong.
  const visit = (node) => {
    if (node.type === 'grid') {
      for (const child of node.children || []) {
        const p = child.placement;
        if (p && Number.isInteger(p.columnSpan) && (p.columnStart || 1) + p.columnSpan - 1 > node.columns) {
          oversized.push(`${key}: ${child.id} spans to column ${(p.columnStart || 1) + p.columnSpan - 1} of a ${node.columns}-column grid (${node.id})`);
        }
      }
    }
    (node.children || []).forEach(visit);
  };
  visit(graph);
  // And the gesture itself, as a drag does it: the track browser keeps its
  // size and is moved one row down inside the Stage. Narrowing it first would
  // pass even against a 24-column Stage, which is how an earlier version of
  // this check passed while the drag was dead in the app.
  const tracks = findIn(graph, 'canvas-tracks');
  const stageGrid = tracks ? parentIn(graph, tracks.id) : null;
  if (tracks?.placement && stageGrid?.type === 'grid') {
    const packed = packedGridGraph(graph, tracks.id, { ...tracks.placement, rowStart: (tracks.placement.rowStart || 1) + 1 });
    const landed = packed ? findIn(packed, tracks.id)?.placement : null;
    // Against a 24-column Stage the packer does not refuse -- it quietly clamps
    // the span to 24, so the first touch shrinks a full-width pane to a quarter
    // in the model while the browser, having given the extra tracks no width,
    // keeps drawing it full width. A move must not change the size.
    if (!landed) refusedInside.push(`${key} (refused)`);
    else if (landed.columnSpan !== tracks.placement.columnSpan) refusedInside.push(`${key} (span ${tracks.placement.columnSpan} became ${landed.columnSpan})`);
  }
}
check('every child in every shipped port fits the grid it is in', () => {
  assert.equal(oversized.length, 0, `${oversized.length} placement(s) reach past their own grid, e.g. ${oversized[0]}`);
});
check('the track browser can be moved inside the Stage, at its own size, in every ported theme', () => {
  assert.equal(refusedInside.length, 0, `wrong in ${refusedInside.length} of ${ports.KEYS.length} themes, e.g. ${refusedInside[0]}`);
});

console.log('');
if (failures) {
  console.log(`${failures} of the packer's obligations are not met.`);
  process.exit(1);
}
console.log('The packer addresses the whole canvas.');
