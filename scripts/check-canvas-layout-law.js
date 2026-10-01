'use strict';

// The one structural rule of the Canvas rebuild:
//
//   Layout mechanics are GLOBAL. A theme sets appearance, never mechanics.
//
// A theme stylesheet may not set display, grid-*, gap, position, margin or
// padding on the canvas, the composition root, a grid, or a grid's direct
// pane children. Those properties decide where things are and how dragging
// behaves, and a rule that varies them per theme means an invariant that only
// holds in some themes -- which is not an invariant.
//
// This is enforced by parsing, not by review, because review is what let it
// happen: a theme port zeroing .cw-canvas padding at equal specificity quietly
// removed the artboard's pasteboard, and the fix was to add a redundant
// attribute to win the race. Winning specificity races is not architecture.
//
//   node scripts/check-canvas-layout-law.js
//   node scripts/check-canvas-layout-law.js --report   (lists, exits 0)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Mechanics: who owns them, and who may not touch them.
const MECHANICS = [
  'display', 'position', 'gap', 'row-gap', 'column-gap',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows',
  'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow',
  'grid-column', 'grid-row', 'grid-area',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'transform', 'inset', 'top', 'right', 'bottom', 'left', 'float', 'overflow',
];

// The surfaces the composition is laid out on.
const SURFACES = ['.cw-canvas', '.cw-root', '.cw-grid'];

// Which stylesheet owns mechanics, and which may only dress them.
const OWNER = 'src/foreground.css';
// Every sheet a theme may load, not just the shared one. A bespoke
// reconstruction is still a theme, and the one that was left out of this list
// turned out to be setting grid mechanics with !important.
const THEMES = [
  'src/canvas-theme-ports.css',
  'src/canvas-lo-fi-cafe.css',
  'src/canvas-neon-burst.css',
  'src/canvas-obsession.css',
  'src/canvas-cartridge-quest.css',
];

// Strip comments and strings, then walk rule by rule. Not a full CSS parser --
// it does not need to be. It needs to find declarations inside rules whose
// selector names a composition surface, and these stylesheets are hand-written
// and flat.
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  let index = 0;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    const line = clean.slice(0, match.index).split('\n').length;
    found.push({ selector, body: match[2], line, index: index += 1 });
  }
  return found;
}

function surfacesTouched(selector) {
  // The rule's subject is its last compound. A rule ending in a pane child of
  // a grid counts too, because that is where placement lives.
  const subject = selector.split(',').map((part) => part.trim()).filter(Boolean);
  const hit = new Set();
  for (const one of subject) {
    const last = one.split(/\s+|>/).filter(Boolean).pop() || '';
    // A pseudo-element is the theme's own ornament, not the surface. An
    // absolutely positioned ::after decorates a grid; it does not re-lay-out
    // the grid's children, and a law that cannot tell those apart is a law
    // people learn to ignore.
    if (/::(after|before|backdrop|marker|selection|first-line|first-letter)/.test(last)) continue;
    for (const surface of SURFACES) if (last.includes(surface)) hit.add(surface);
    // A direct .cw-node child of a grid carries the placement.
    if (/\.cw-grid\s*>\s*[^\s]*\.cw-node/.test(one)) hit.add('.cw-grid > .cw-node');
  }
  return [...hit];
}

function declarations(body) {
  return body.split(';').map((one) => one.trim()).filter(Boolean).map((one) => {
    const colon = one.indexOf(':');
    if (colon < 0) return null;
    return { property: one.slice(0, colon).trim().toLowerCase(), value: one.slice(colon + 1).trim() };
  }).filter(Boolean);
}

const violations = [];
for (const file of THEMES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  for (const rule of rules(fs.readFileSync(full, 'utf8'))) {
    const surfaces = surfacesTouched(rule.selector);
    if (!surfaces.length) continue;
    for (const declaration of declarations(rule.body)) {
      if (!MECHANICS.includes(declaration.property)) continue;
      violations.push({
        file, line: rule.line, surfaces: surfaces.join(' '),
        selector: rule.selector.replace(/\s+/g, ' ').slice(0, 96),
        declaration: `${declaration.property}: ${declaration.value}`,
      });
    }
  }
}

// And the other half: a rule that exists only to out-specify another is a
// symptom of the same disease. Flagged, not failed, because removing one is a
// layering change rather than a deletion.
const ownerCss = fs.readFileSync(path.join(ROOT, OWNER), 'utf8');
const races = (ownerCss.match(/\[data-cw-zoom\]/g) || []).length;

console.log('Layout law: mechanics are global, themes dress them.\n');
if (!violations.length) console.log('  No theme stylesheet sets layout mechanics on a composition surface.');
else {
  const byFile = new Map();
  for (const v of violations) byFile.set(v.file, (byFile.get(v.file) || 0) + 1);
  for (const [file, count] of byFile) console.log(`  ${file}: ${count} mechanic declarations on composition surfaces`);
  console.log('');
  // Grouped, because the shape of the fix matters more than the list.
  const byProperty = new Map();
  for (const v of violations) {
    const name = v.declaration.split(':')[0];
    byProperty.set(name, (byProperty.get(name) || 0) + 1);
  }
  console.log('  by property:');
  for (const [name, count] of [...byProperty.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(3)}  ${name}`);
  }
  console.log('\n  by surface:');
  const bySurface = new Map();
  for (const v of violations) bySurface.set(v.surfaces, (bySurface.get(v.surfaces) || 0) + 1);
  for (const [name, count] of [...bySurface.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(3)}  ${name}`);
  }
  console.log('');
  const shown = violations.slice(0, 8);
  for (const v of shown) {
    console.log(`  ${v.file}:${String(v.line).padStart(5)}  ${v.declaration}`);
    console.log(`  ${' '.repeat(v.file.length + 6)}  on  ${v.selector}`);
  }
  if (violations.length > shown.length) console.log(`\n  ... and ${violations.length - shown.length} more.`);
}
if (races) console.log(`\n  Also: ${races} selector(s) in ${OWNER} carry [data-cw-zoom], which exists to win a specificity race rather than to match anything. §6.3.`);

if (process.argv.includes('--report')) process.exit(0);

console.log('');
assert.equal(violations.length, 0,
  `Layout law, invariant I6: ${violations.length} declaration(s) in theme stylesheets set mechanics on a composition surface. `
  + 'Mechanics are global; a theme sets appearance. §2.1. '
  + 'This check is expected to fail until the separation is done. Do not narrow the property list to make it pass.');
console.log('Layout law passed: no theme stylesheet touches layout mechanics.');
