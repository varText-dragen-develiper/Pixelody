'use strict';

// Can the person reach a pane's edit controls -- and only when they should?
//
// Every control is a 42px target positioned absolutely in the same corners, so
// adding one is enough to bury another: a top-left resize grip once landed
// exactly on the Move grip and silently stopped it being clickable. Nothing
// about that is visible in a diff.
//
// Since 2026-09-26 the resize corners appear only on a chosen pane, so this
// checks four things rather than one:
//
//   1. On a selected pane, every control is reachable and none overlap.
//   2. On an unselected pane the corners are gone -- not hit, not painted --
//      while the Move grip and the pane menu stay.
//   3. Where a pane fills a section (the track browser inside the Stage), the
//      corners that show are the ones for whatever was chosen. Before the
//      gate, the section's grips painted over the pane's on every corner.
//   4. Tab still reaches the corners of a pane nobody clicked.
//
//   node scripts/probe-pane-controls.js
//   node scripts/probe-pane-controls.js --before <path/to/old/foreground.css>
//
// Needs `playwright`. Not in `npm run check` -- it needs a browser.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONTROLS = [
  ['Move grip', '.cw-pane-drag-handle'],
  ['Resize, top-left', '.cw-pane-resize-handle[data-cw-resize-corner="start"]'],
  ['Resize, bottom-right', '.cw-pane-resize-handle[data-cw-resize-corner="end"]'],
  ['Pane menu', '.cw-pane-actions'],
];
const CORNERS = CONTROLS.filter(([label]) => label.startsWith('Resize'));

const controls = () => `
  <button class="cw-pane-drag-handle">Move</button>
  <button class="cw-pane-resize-handle" data-cw-resize-corner="start">Resize</button>
  <button class="cw-pane-resize-handle" data-cw-resize-corner="end">Resize</button>
  <button class="cw-pane-actions cw-pane-menu-button">Pane menu</button>`;

function page(css) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
    <style>html,body{margin:0;height:100%}.cw-surface{position:absolute;inset:0}</style></head>
    <body data-theme="foreground" data-composition-mode="edit" data-cw-studio="open" style="--canvas-port-gutter:8px">
      <div class="cw-surface"><div class="cw-canvas"><div class="cw-root">
        <div class="cw-grid" data-cw-node-id="field" style="--cw-columns:96">
          <div class="cw-node cw-module" tabindex="0" data-cw-node-id="narrow" data-cw-placed="true" data-cw-positioned="true"
               style="--cw-column-start:1;--cw-row-start:1;--cw-column-span:20;--cw-row-span:12">${controls()}<p>narrow</p></div>
          <div class="cw-node cw-grid" data-cw-node-id="stage" data-cw-placed="true" data-cw-positioned="true"
               style="--cw-column-start:21;--cw-row-start:1;--cw-column-span:56;--cw-row-span:12;--cw-columns:96;--cw-grid-gutter:0px">
            <button class="cw-pane-resize-handle" data-cw-resize-corner="start">Resize</button>
            <button class="cw-pane-resize-handle" data-cw-resize-corner="end">Resize</button>
            <div class="cw-node cw-module" tabindex="0" data-cw-node-id="tracks" data-cw-placed="true" data-cw-positioned="true"
                 style="--cw-column-start:1;--cw-row-start:1;--cw-column-span:96;--cw-row-span:12;--cw-pane-gutter:0px">${controls()}<p>tracks</p></div>
          </div>
          <div class="cw-node cw-module" tabindex="0" data-cw-node-id="utility" data-cw-placed="true" data-cw-positioned="true"
               style="--cw-column-start:77;--cw-row-start:1;--cw-column-span:20;--cw-row-span:12">${controls()}<p>utility</p></div>
        </div>
      </div></div></div>
    </body></html>`;
}

// Put the page in a selection state, then report on every control of one owner.
async function inspect(tab, { selected = null, group = null }, ownerId, list) {
  return tab.evaluate(({ selected, group, ownerId, list }) => {
    document.querySelectorAll('[data-cw-studio-selected],[data-cw-studio-group-selected]').forEach((n) => {
      n.removeAttribute('data-cw-studio-selected'); n.removeAttribute('data-cw-studio-group-selected');
    });
    if (selected) document.querySelector(`[data-cw-node-id="${selected}"]`).setAttribute('data-cw-studio-selected', '');
    if (group) document.querySelector(`[data-cw-node-id="${group}"]`).setAttribute('data-cw-studio-group-selected', 'true');
    return new Promise((resolve) => setTimeout(() => {
      const owner = document.querySelector(`[data-cw-node-id="${ownerId}"]`);
      resolve(list.map(([label, selector]) => {
        const node = owner.querySelector(`:scope > ${selector}`);
        if (!node) return { label, missing: true };
        const rect = node.getBoundingClientRect();
        const centre = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const hit = node === centre || node.contains(centre);
        const style = getComputedStyle(node);
        return {
          label,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          shown: style.visibility === 'visible' && Number(style.opacity) > 0.5,
          reachable: hit,
          covering: hit ? null : (centre?.closest?.('[data-cw-node-id]')?.dataset.cwNodeId || '?') + ' ' + (centre?.className || centre?.tagName || 'nothing'),
        };
      }));
    }, 250));
  }, { selected, group, ownerId, list });
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.error('probe-pane-controls needs playwright: npm install playwright');
    process.exit(2);
  }
  const beforeAt = process.argv.indexOf('--before');
  const sheet = beforeAt > 0 ? path.resolve(process.argv[beforeAt + 1]) : path.join(ROOT, 'src/foreground.css');
  const css = [fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8'), fs.readFileSync(sheet, 'utf8')].join('\n');

  const browser = await chromium.launch();
  const tab = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await tab.setContent(page(css), { waitUntil: 'load' });

  const failures = [];
  const line = (control) => {
    if (control.missing) return 'MISSING';
    return `${control.shown ? 'shown ' : 'hidden'}  ${control.reachable ? 'reachable' : `not hit (${control.covering})`}`;
  };

  console.log(`Pane controls against ${path.relative(ROOT, sheet)}\n`);

  console.log('1. A selected pane: everything reachable, nothing overlapping');
  for (const id of ['narrow', 'utility']) {
    const found = await inspect(tab, { selected: id }, id, CONTROLS);
    found.forEach((c) => {
      console.log(`   ${id.padEnd(8)} ${c.label.padEnd(22)} ${line(c)}`);
      if (c.missing || !c.reachable) failures.push(`${id} selected: ${c.label} is not reachable`);
    });
    const placed = found.filter((c) => !c.missing);
    for (let a = 0; a < placed.length; a += 1) for (let b = a + 1; b < placed.length; b += 1) {
      const x = placed[a].rect; const y = placed[b].rect;
      if (x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom) failures.push(`${id}: ${placed[a].label} overlaps ${placed[b].label}`);
    }
  }

  console.log('\n2. An unselected pane: corners gone, Move and menu still there');
  {
    const found = await inspect(tab, { selected: 'utility' }, 'narrow', CONTROLS);
    found.forEach((c) => {
      console.log(`   narrow   ${c.label.padEnd(22)} ${line(c)}`);
      const corner = c.label.startsWith('Resize');
      if (corner && (c.shown || c.reachable)) failures.push(`narrow unselected: ${c.label} is still ${c.reachable ? 'hittable' : 'painted'}`);
      if (!corner && !c.reachable) failures.push(`narrow unselected: ${c.label} should stay reachable`);
    });
  }

  console.log('\n3. A pane that fills its section: the corners belong to what was chosen');
  {
    const inner = await inspect(tab, { selected: 'tracks' }, 'tracks', CORNERS);
    const outer = await inspect(tab, { selected: 'tracks' }, 'stage', CORNERS);
    inner.forEach((c) => { console.log(`   tracks chosen   tracks ${c.label.padEnd(22)} ${line(c)}`); if (!c.reachable) failures.push(`tracks chosen: its ${c.label} is buried`); });
    outer.forEach((c) => { console.log(`   tracks chosen   stage  ${c.label.padEnd(22)} ${line(c)}`); if (c.shown) failures.push(`tracks chosen: the Stage's ${c.label} is still up`); });
    const group = await inspect(tab, { group: 'stage' }, 'stage', CORNERS);
    group.forEach((c) => { console.log(`   Stage grouped   stage  ${c.label.padEnd(22)} ${line(c)}`); if (!c.reachable) failures.push(`Stage group-selected: its ${c.label} is not reachable`); });
  }

  console.log('\n4. Keyboard: Tab reaches the corners of a pane nobody clicked');
  {
    await inspect(tab, {}, 'narrow', []);
    await tab.evaluate(() => document.activeElement?.blur?.());
    const visits = [];
    for (let step = 0; step < 8; step += 1) {
      await tab.keyboard.press('Tab');
      await tab.waitForTimeout(160);
      visits.push(await tab.evaluate(() => {
        const el = document.activeElement;
        const owner = el?.closest?.('[data-cw-node-id]')?.dataset.cwNodeId || '-';
        const kind = el?.matches?.('.cw-pane-resize-handle') ? `corner:${el.dataset.cwResizeCorner}` : el?.matches?.('.cw-module') ? 'pane' : (el?.className || el?.tagName || '').split(' ')[0];
        const start = document.querySelector('[data-cw-node-id="narrow"] > .cw-pane-resize-handle[data-cw-resize-corner="start"]');
        return { owner, kind, cornerShown: getComputedStyle(start).visibility === 'visible' };
      }));
    }
    visits.forEach((v, i) => console.log(`   Tab ${i + 1}  ${v.owner.padEnd(8)} ${v.kind.padEnd(22)} narrow's corner ${v.cornerShown ? 'shown' : 'hidden'}`));
    if (!visits.some((v) => v.owner === 'narrow' && v.kind === 'corner:start')) failures.push('keyboard: Tab never reached narrow\'s top-left corner');
    if (!visits.some((v) => v.owner === 'narrow' && v.kind === 'corner:end')) failures.push('keyboard: Tab never reached narrow\'s bottom-right corner');
  }

  await browser.close();
  console.log('');
  if (failures.length) { failures.forEach((f) => console.log(`  ${f}`)); console.log(`\n${failures.length} problem(s).`); process.exit(1); }
  console.log('Corners appear on the chosen pane, stay reachable there, and Tab still finds them.');
})();
