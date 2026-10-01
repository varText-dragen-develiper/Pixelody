'use strict';

// Edit Canvas, driven the way a person drives it.
//
// Every other check here lifts one function out of canvas-studio.js or builds
// a DOM fixture by hand. Three rounds of usability findings turned on things
// only the whole running studio does -- the rail sitting over the canvas, a
// slot that would not let go of the pointer, a Stage whose grip belonged to
// the pane inside it -- so this one boots the real host, studio, painter and
// session (scripts/lib-canvas-harness.js) and presses, drags and releases with
// real pointer events. It asserts what the person would see: where things
// ended up, what the status line said, and whether undo put it back.
//
//   node scripts/check-canvas-gestures.js
//
// Needs `playwright`.

const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { bootCanvas, observe, rectOf, drag, enterEdit } = require('./lib-canvas-harness');

const sel = (id) => `[data-cw-node-id="${id}"]`;
const LIB = 'canvas-library';
const STAGE = 'canvas-port-dev-lab-stage';
const TRACKS = 'canvas-tracks';
const UTIL = 'canvas-port-dev-lab-utility-stack';
const FRAME = { [LIB]: '1/1/20/6', [STAGE]: '21/1/56/6', [UTIL]: '77/1/20/6' };
const results = [];
const failures = [];

async function devLab(browser, viewport = { width: 1600, height: 1000 }) {
  const { page, errors } = await bootCanvas(browser, { theme: 'dev-lab', viewport });
  assert.equal(await enterEdit(page), 'edit', 'Composition Mode did not start.');
  return { page, errors };
}
const frameOf = (o) => ({ [LIB]: o.model[LIB], [STAGE]: o.model[STAGE], [UTIL]: o.model[UTIL] });
async function clickPane(page, id) {
  const r = await rectOf(page, sel(id));
  await page.mouse.click(r.cx, r.top + Math.min(200, r.height / 2));
  await page.waitForTimeout(100);
}
async function undo(page) { await page.keyboard.press('Control+z'); await page.waitForTimeout(120); }

async function check(name, run) {
  try {
    await run();
    results.push(`  ok    ${name}`);
  } catch (error) {
    results.push(`  FAIL  ${name}\n        ${String(error.message).split('\n').join('\n        ')}`);
    failures.push(name);
  }
}

(async () => {
  const browser = await chromium.launch();

  await check('every Move grip can be pressed at every window width (the rail no longer covers the canvas)', async () => {
    for (const [width, height] of [[1100, 900], [1400, 1000], [1600, 1000], [2560, 1400]]) {
      const { page } = await devLab(browser, { width, height });
      const blocked = await page.evaluate(() => [...document.querySelectorAll('.cw-canvas .cw-node > .cw-pane-drag-handle')].map((grip) => {
        const box = grip.getBoundingClientRect();
        if (!box.width || !grip.offsetParent) return null;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit === grip || grip.contains(hit) ? null : `${grip.dataset.cwDragNode} (under ${hit?.closest('.cw-studio-rail') ? 'the rail' : hit?.className})`;
      }).filter(Boolean));
      assert.deepEqual(blocked, [], `At ${width}px these grips cannot be pressed: ${blocked.join(', ')}`);
      await page.close();
    }
  });

  await check('the slot follows the pointer one column at a time, including over the pane\'s own footprint', async () => {
    const { page } = await devLab(browser);
    const grip = await rectOf(page, `${sel(LIB)} > .cw-pane-drag-handle`);
    const pitch = await page.evaluate(() => {
      const grid = document.querySelector('[data-cw-node-id="canvas-field"]');
      const cs = getComputedStyle(grid);
      return (grid.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / 96;
    });
    await page.mouse.move(grip.cx, grip.cy);
    await page.mouse.down();
    const seen = [];
    // Alt switches edge snapping off, so every column is reachable.
    await page.keyboard.down('Alt');
    for (let column = 1; column <= 12; column += 1) {
      await page.mouse.move(grip.cx + column * pitch, grip.cy, { steps: 2 });
      await page.waitForTimeout(30);
      seen.push(Number(await page.evaluate(() => document.querySelector('.cw-drag-placeholder')?.style.getPropertyValue('--cw-column-start'))));
    }
    await page.keyboard.up('Alt');
    await page.mouse.up();
    assert.deepEqual(seen, Array.from({ length: 12 }, (_, index) => index + 2), `The slot did not track the pointer: ${seen.join(', ')}`);
    await page.close();
  });

  await check('the Stage is one pane: its own grip moves it, and the track browser inside has none', async () => {
    const { page } = await devLab(browser);
    assert.equal(await page.$(`${sel(TRACKS)} > .cw-pane-drag-handle`), null, 'The track browser still draws a grip on top of the Stage\'s.');
    const grip = await rectOf(page, `${sel(STAGE)} > .cw-pane-drag-handle`);
    await drag(page, { x: grip.cx, y: grip.cy }, { x: grip.cx + 100, y: grip.cy + 300 });
    const o = await observe(page);
    assert.notEqual(o.model[STAGE], FRAME[STAGE], 'The Stage did not move.');
    assert.equal(o.model[TRACKS], '1/1/96/6', 'The track browser moved inside the Stage instead of with it.');
    await page.close();
  });

  await check('clicking the Stage shows the Stage\'s corners, and its bottom corner resizes the Stage', async () => {
    const { page } = await devLab(browser);
    await clickPane(page, STAGE);
    const corner = await page.evaluate((stage) => {
      const handle = document.querySelector(`${stage} > .cw-pane-resize-handle[data-cw-resize-corner="end"]`);
      const box = handle.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { visible: getComputedStyle(handle).visibility === 'visible', pressable: hit === handle, x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, sel(STAGE));
    assert.ok(corner.visible, 'The Stage\'s corners stay hidden when the Stage is clicked.');
    assert.ok(corner.pressable, 'The Stage\'s bottom corner is covered by something else.');
    await drag(page, { x: corner.x, y: corner.y }, { x: corner.x - 200, y: corner.y });
    const o = await observe(page);
    assert.match(o.model[STAGE], /^21\/1\/\d+\/6$/, `Unexpected Stage placement ${o.model[STAGE]}`);
    assert.ok(Number(o.model[STAGE].split('/')[2]) < 56, 'The Stage did not get narrower.');
    assert.equal(o.model[TRACKS], '1/1/96/6', 'The track browser should still fill the Stage.');
    assert.match(o.status.text, /^Pane resized to/, `Status said: ${o.status.text}`);
    await page.close();
  });

  // What the person reported: shrink a pane from one corner and the corner on
  // the other side ends up somewhere other than where the pane visibly is.
  // Measured for every combination of pane and corner: while dragging, the far
  // corner must not move, the pane's content must fill the pane's box, and on
  // release the pane must land exactly on the slot it showed.
  for (const [id, corner, dx, dy] of [
    [LIB, 'start', 60, 100], [LIB, 'end', -60, -100],
    [STAGE, 'start', 120, 120], [STAGE, 'end', -150, -120],
    [UTIL, 'start', 60, 100],
  ]) {
    await check(`resizing ${id === LIB ? 'the library' : id === STAGE ? 'the Stage' : 'the utility stack'} from its ${corner === 'start' ? 'top-left' : 'bottom-right'} corner keeps the pane, its corners and its content together`, async () => {
      const { page } = await devLab(browser);
      await page.evaluate(() => document.querySelectorAll('.cw-module > .cw-product-fallback').forEach((n) => n.setAttribute('data-cw-product-root', '')));
      const pane = await rectOf(page, sel(id));
      await page.mouse.click(pane.cx, pane.top + 250);
      await page.waitForTimeout(100);
      const box = (selector) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; }, selector);
      const far = `${sel(id)} > .cw-pane-resize-handle[data-cw-resize-corner="${corner === 'start' ? 'end' : 'start'}"]`;
      const near = await rectOf(page, `${sel(id)} > .cw-pane-resize-handle[data-cw-resize-corner="${corner}"]`);
      const farBefore = await box(far);
      await page.mouse.move(near.cx, near.cy);
      await page.mouse.down();
      let slot = null;
      for (const f of [0.25, 0.5, 0.75, 1]) {
        await page.mouse.move(near.cx + dx * f, near.cy + dy * f, { steps: 3 });
        await page.waitForTimeout(40);
        const farNow = await box(far);
        const paneNow = await box(sel(id));
        assert.ok(Math.abs(farNow.left - farBefore.left) < 1.5 && Math.abs(farNow.top - farBefore.top) < 1.5, `The far corner moved from ${JSON.stringify(farBefore)} to ${JSON.stringify(farNow)} at ${Math.round(f * 100)}% of the drag.`);
        const edge = corner === 'start' ? [paneNow.left, paneNow.top] : [paneNow.right, paneNow.bottom];
        const aim = [near.cx + dx * f + (corner === 'start' ? -near.width / 2 : near.width / 2), near.cy + dy * f + (corner === 'start' ? -near.height / 2 : near.height / 2)];
        assert.ok(Math.abs(edge[0] - aim[0]) < 3 && Math.abs(edge[1] - aim[1]) < 3, `The dragged corner of the pane is at ${edge.map(Math.round)}, not under the pointer (${aim.map(Math.round)}).`);
        const content = await box(`${sel(id)} > [data-cw-product-root]`);
        if (content) assert.ok(Math.abs(content.right - paneNow.right) < 3 && Math.abs(content.left - paneNow.left) < 3, `The pane's content spans ${Math.round(content.left)}-${Math.round(content.right)} inside a pane spanning ${Math.round(paneNow.left)}-${Math.round(paneNow.right)}.`);
        slot = await box('.cw-resize-slot');
      }
      await page.mouse.up();
      await page.waitForTimeout(200);
      const landed = await box(sel(id));
      assert.ok(slot, 'No landing slot was shown.');
      for (const side of ['left', 'top', 'right', 'bottom']) {
        assert.ok(Math.abs(landed[side] - slot[side]) < 2, `On release the pane's ${side} edge landed at ${Math.round(landed[side])}, but the slot showed ${Math.round(slot[side])}.`);
      }
      await page.close();
    });
  }

  await check('anchoring from the Stage\'s menu anchors the Stage, and nothing is stretched into it', async () => {
    const { page } = await devLab(browser);
    await clickPane(page, STAGE);
    const menu = await rectOf(page, `${sel(TRACKS)} > .cw-pane-menu-button`);
    await page.mouse.click(menu.cx, menu.cy);
    await page.waitForTimeout(120);
    await page.click('.cw-module-context-menu [data-cw-pin-option="firm"]');
    await page.waitForTimeout(120);
    const pins = await page.evaluate(() => { const out = {}; const walk = (n) => { if (n.pin) out[n.id] = n.pin; (n.children || []).forEach(walk); }; walk(window.__harness.host.snapshot().session.graph); return out; });
    assert.deepEqual(pins, { [STAGE]: 'firm' }, `Pins: ${JSON.stringify(pins)}`);
    await clickPane(page, LIB);
    const corner = await rectOf(page, `${sel(LIB)} > .cw-pane-resize-handle[data-cw-resize-corner="end"]`);
    await drag(page, { x: corner.cx, y: corner.cy }, { x: corner.cx + 250, y: corner.cy });
    const o = await observe(page);
    assert.deepEqual(frameOf(o), FRAME, 'Something moved.');
    assert.match(o.status.text, /anchored, so there is no room/, `Status said: ${o.status.text}`);
    await page.close();
  });

  await check('a pane stretched into a neighbour squeezes it on its own row, says so, and undo restores both', async () => {
    const { page } = await devLab(browser);
    await clickPane(page, LIB);
    const corner = await rectOf(page, `${sel(LIB)} > .cw-pane-resize-handle[data-cw-resize-corner="end"]`);
    const stage = await rectOf(page, sel(STAGE));
    let live = '';
    await drag(page, { x: corner.cx, y: corner.cy }, { x: corner.cx + stage.width * 0.3, y: corner.cy }, { hold: async () => { live = (await observe(page)).status.text; } });
    const o = await observe(page);
    const [start, row, span] = o.model[STAGE].split('/').map(Number);
    assert.equal(row, 1, 'The Stage left its row.');
    assert.equal(start + span, 77, 'The Stage did not keep its far edge.');
    assert.ok(span < 56 && span >= 28, `The Stage span ${span} is not a squeeze.`);
    assert.match(live, /gets smaller to make room/, `Before release the status said: ${live}`);
    assert.match(o.status.text, /got smaller to make room/, `After release the status said: ${o.status.text}`);
    await undo(page);
    assert.deepEqual(frameOf(await observe(page)), FRAME, 'Undo did not put both panes back.');
    await page.close();
  });

  await check('dropping one side column on the other swaps them in one gesture', async () => {
    const { page } = await devLab(browser);
    const grip = await rectOf(page, `${sel(LIB)} > .cw-pane-drag-handle`);
    const lib = await rectOf(page, sel(LIB));
    const util = await rectOf(page, sel(UTIL));
    await drag(page, { x: grip.cx, y: grip.cy }, { x: util.left + (grip.cx - lib.left), y: grip.cy });
    const o = await observe(page);
    assert.deepEqual(frameOf(o), { [LIB]: '77/1/20/6', [STAGE]: '21/1/56/6', [UTIL]: '1/1/20/6' }, JSON.stringify(frameOf(o)));
    await page.close();
  });

  await check('releasing a pane where it started changes nothing and spends no undo step', async () => {
    const { page } = await devLab(browser);
    const grip = await rectOf(page, `${sel(STAGE)} > .cw-pane-drag-handle`);
    await drag(page, { x: grip.cx, y: grip.cy }, { x: grip.cx + 5, y: grip.cy + 3 });
    const o = await observe(page);
    assert.equal(o.canUndo, false, 'A no-op release was recorded as an edit.');
    assert.equal(o.status.text, 'Released where it started. Nothing changed.');
    assert.notEqual(o.status.tone, 'error');
    await page.close();
  });

  await check('a pane can be picked up by its body; a click still selects, and the drop does not click the product', async () => {
    const { page } = await devLab(browser);
    const clicks = [];
    await page.exposeFunction('__productClick', () => clicks.push('row'));
    const row = await page.evaluate(() => {
      const host = document.querySelector('[data-cw-node-id="canvas-library"] > .cw-product-fallback, [data-cw-node-id="canvas-library"] > [data-cw-product-root]');
      const element = document.createElement('div');
      element.textContent = 'a track row';
      element.style.cssText = 'position:relative;height:40px;margin:200px 20px 0';
      element.addEventListener('click', () => window.__productClick());
      host.append(element);
      const box = element.getBoundingClientRect();
      return { x: box.left + 30, y: box.top + 20 };
    });
    await page.mouse.click(row.x, row.y);
    await page.waitForTimeout(100);
    assert.deepEqual(clicks, ['row'], 'A plain click inside a pane no longer reaches the product.');
    await drag(page, row, { x: row.x + 150, y: row.y });
    const o = await observe(page);
    assert.notEqual(o.model[LIB], FRAME[LIB], 'Dragging the pane by its body did not move it.');
    assert.deepEqual(clicks, ['row'], 'Putting the pane down clicked the product under the pointer.');
    await page.close();
  });

  await check('a resize that pushes a neighbour leaves nothing behind: no pane is still shifted after the commit or after undo', async () => {
    const { page } = await devLab(browser);
    await clickPane(page, LIB);
    const corner = await rectOf(page, `${sel(LIB)} > .cw-pane-resize-handle[data-cw-resize-corner="end"]`);
    await drag(page, { x: corner.cx, y: corner.cy }, { x: corner.cx + 700, y: corner.cy });
    const leftover = () => page.evaluate(() => [...document.querySelectorAll('.cw-grid > .cw-node')]
      .filter((n) => n.hasAttribute('data-cw-shifted') || n.style.getPropertyValue('--cw-shift-y') || n.hasAttribute('data-cw-resize-live'))
      .map((n) => `${n.dataset.cwNodeId} shifted ${n.style.getPropertyValue('--cw-shift-y') || '(live size)'}`));
    assert.match((await observe(page)).status.text, /moved down/, 'This check needs a resize that pushes the Stage down.');
    assert.deepEqual(await leftover(), [], 'A preview transform survived the commit.');
    await undo(page);
    assert.deepEqual(await leftover(), [], 'A preview transform survived undo.');
    const stage = await rectOf(page, sel(STAGE));
    const lib = await rectOf(page, sel(LIB));
    assert.ok(Math.abs(stage.top - lib.top) < 6, `After undo the Stage is drawn at ${Math.round(stage.top)} while the library is at ${Math.round(lib.top)}; both are on row 1.`);
    await page.close();
  });

  // What was reported: stretched to the player bar in Composition Mode, a pane
  // sat behind the bar once Composition Mode was left; stopped just short, it
  // was high and not flush. The bar is where it will be in use, and a pane
  // stops flush on top of it.
  for (const theme of ['dev-lab', 'orbital']) {
    await check(`in ${theme}, a pane stretched to the player bar stops flush on top of it, and is still flush after saving`, async () => {
      const { page } = await bootCanvas(browser, { theme, viewport: { width: 1600, height: 1000 } });
      await enterEdit(page);
      const gap = () => page.evaluate((s) => {
        const pane = document.querySelector(s).getBoundingClientRect();
        const player = document.querySelector('.player').getBoundingClientRect();
        return player.top - pane.bottom;
      }, sel(LIB));
      await clickPane(page, LIB);
      let corner = await rectOf(page, `${sel(LIB)} > .cw-pane-resize-handle[data-cw-resize-corner="end"]`);
      await drag(page, { x: corner.cx, y: corner.cy }, { x: corner.cx, y: corner.cy - 160 });
      assert.ok(await gap() > 40, 'This check needs the library to start short of the player.');
      await clickPane(page, LIB);
      corner = await rectOf(page, `${sel(LIB)} > .cw-pane-resize-handle[data-cw-resize-corner="end"]`);
      let live = null;
      await drag(page, { x: corner.cx, y: corner.cy }, { x: corner.cx, y: corner.cy + 450 }, { hold: async () => { live = await gap(); } });
      assert.ok(Math.abs(live) <= 2, `While stretching past the player, the pane's edge was ${Math.round(live)}px from the bar instead of stopping at it.`);
      assert.ok(Math.abs(await gap()) <= 2, `After release the pane ends ${Math.round(await gap())}px from the player bar.`);
      await page.evaluate(() => document.querySelector('#workspaceProductionMode').click());
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.body.dataset.compositionMode), 'use', 'Saving did not leave Composition Mode.');
      assert.ok(Math.abs(await gap()) <= 2, `Outside Composition Mode the pane ends ${Math.round(await gap())}px from the player bar (negative is behind it).`);
      await page.close();
    });
  }

  await check('a pane moved onto the player bar lands flush above it or wholly past it; past it, use scrolls to it and nothing is ever under the bar', async () => {
    const { page } = await devLab(browser);
    const move = async (dy) => {
      const grip = await rectOf(page, `${sel(LIB)} > .cw-pane-drag-handle`);
      await drag(page, { x: grip.cx, y: grip.cy }, { x: grip.cx, y: grip.cy + dy });
      return (await observe(page)).model[LIB];
    };
    assert.equal(await move(300), FRAME[LIB], 'A pane pushed partly onto the player should stay flush above it.');
    const past = await move(700);
    assert.match(past, /^1\/7\/20\/6$/, `A pane pushed mostly past the player should land wholly past it, got ${past}.`);
    await page.evaluate(() => document.querySelector('#workspaceProductionMode').click());
    await page.waitForTimeout(400);
    const using = await page.evaluate(() => {
      const grid = document.querySelector('[data-cw-node-id="canvas-field"]');
      const region = grid.getBoundingClientRect();
      const player = document.querySelector('.player').getBoundingClientRect();
      grid.scrollTop = grid.scrollHeight;
      const lib = document.querySelector('[data-cw-node-id="canvas-library"]').getBoundingClientRect();
      return { overflowY: getComputedStyle(grid).overflowY, regionBottom: region.bottom, playerTop: player.top, scrolled: grid.scrollTop, libTop: lib.top, libBottom: lib.bottom };
    });
    assert.equal(using.overflowY, 'auto', 'The composition cannot scroll in use.');
    assert.ok(using.regionBottom <= using.playerTop + 5, `In use, the composition's region (bottom ${Math.round(using.regionBottom)}) runs under the player bar (top ${Math.round(using.playerTop)}).`);
    assert.ok(using.scrolled > 0, 'The pane past the fold cannot be scrolled to.');
    assert.ok(using.libBottom <= using.playerTop + 5 && using.libTop < using.playerTop, `Scrolled to it, the library spans ${Math.round(using.libTop)}-${Math.round(using.libBottom)} against the bar at ${Math.round(using.playerTop)}.`);
    await page.close();
  });

  await check('in Canvas Base, where panes start out flowing, dragging one works and throws nothing', async () => {
    const { page, errors } = await bootCanvas(browser, { theme: 'canvas-base', viewport: { width: 1600, height: 1000 } });
    await enterEdit(page);
    const grip = await rectOf(page, '[data-cw-node-id="library-module"] > .cw-pane-drag-handle');
    await drag(page, { x: grip.cx, y: grip.cy }, { x: grip.cx, y: grip.cy + 200 });
    assert.deepEqual(errors, [], `The page threw:\n${errors.join('\n')}`);
    assert.ok((await observe(page)).model['library-module'], 'The pane was not placed.');
    await page.close();
  });

  await browser.close();
  console.log('Edit Canvas, pressed and dragged:\n');
  console.log(results.join('\n'));
  if (failures.length) {
    console.log(`\n${failures.length} of ${results.length} failed.`);
    process.exit(1);
  }
  console.log('\nEvery gesture did what the screen said it would.');
})();
