'use strict';

// A real Canvas Studio in a headless page: the production host, the studio,
// the painter, the composition session and its undo stack, all loaded exactly
// as the renderer loads them, with an in-memory stand-in for the main process.
// Gestures are driven with real pointer events, so hit testing, pointer
// capture, the drag proxy and the release path are the shipped ones.
//
// This exists because every probe before it tested a function lifted out of
// the studio or a hand-built DOM fixture, and three rounds of findings from
// the live app turned on behaviour that only exists when the whole thing runs.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SCRIPTS = [
  'src/workspace-composition/contract.js',
  'src/workspace-composition/operations.js',
  'src/workspace-composition/composition-session.js',
  'src/workspace-composition/interaction-adapter.js',
  'src/workspace-composition/module-contract.js',
  'src/workspace-composition/module-registry.js',
  'src/workspace-composition/first-party-modules.js',
  'src/workspace-composition/module-effects.js',
  'src/workspace-composition/player-controls.js',
  'src/workspace-composition/theme-experiment.js',
  'src/workspace-composition/foreground-experiment.js',
  'src/workspace-composition/canvas-painter.js',
  'src/workspace-composition/canvas-studio.js',
  'src/workspace-composition/production-host.js',
  'src/theme-runtime/canvas-theme-ports.js',
];

function pageHtml(theme) {
  const sheets = ['src/styles.css', 'src/foreground.css', 'src/canvas-theme-ports.css'].map(read).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${sheets}</style>
  <style>html,body{margin:0;height:100%}</style></head>
  <body data-theme="foreground">
    <div class="app-shell">
      <main class="workspace"><section class="library-rail">Library</section><section class="tracks">Tracks</section><aside class="details">Details</aside></main>
      <footer class="player">Player</footer>
    </div>
    <section id="workspaceProductionWorkbench" hidden>
      <span id="workspaceProductionProfileName"></span><span id="workspaceProductionIdentity"></span>
      <select id="workspaceProductionModule"></select>
      <button id="workspaceProductionMode">Mode</button><button id="workspaceProductionUndo">Undo</button>
      <button id="workspaceProductionRedo">Redo</button><button id="workspaceProductionRestore">Restore</button>
      <button id="workspaceProductionCancel">Cancel</button><button id="workspaceProductionLegacy">Legacy</button>
      <p id="workspaceProductionStatus"></p>
    </section>
    ${SCRIPTS.map((file) => `<script>${read(file)}</script>`).join('\n')}
  </body></html>`;
}

// Boot the host the way renderer.js does. `theme` is 'canvas-base' or a port
// key such as 'dev-lab'.
async function bootCanvas(browser, { theme = 'canvas-base', viewport = { width: 1600, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent(pageHtml(theme), { waitUntil: 'load' });
  const booted = await page.evaluate(async (theme) => {
    const contract = window.PixelodyWorkspaceCompositionContract;
    const profile = window.PixelodyForegroundStageExperiment;
    const ports = window.PixelodyCanvasThemePorts;
    const creator = profile.graphForVersion(1);
    const port = theme === 'canvas-base' ? null : ports.get(theme);
    if (port) {
      // What renderer.js publishes for a ported theme.
      document.body.dataset.canvasThemePort = port.key;
      document.body.dataset.canvasPortComposition = port.composition.layoutKey;
      const set = (k, v) => document.body.style.setProperty(k, v);
      set('--canvas-port-gutter', `${port.composition.gap}px`);
      set('--canvas-port-row-base', port.composition.rowBase);
      set('--canvas-port-workspace-padding', port.composition.workspacePadding);
      set('--canvas-port-workspace-height', port.composition.workspaceHeight);
      set('--canvas-port-player-height', `${port.composition.playerHeight}px`);
      set('--canvas-port-player-columns', port.composition.playerColumns);
      set('--canvas-port-player-padding', port.composition.playerPadding);
      set('--canvas-port-player-margin', port.composition.playerMargin);
    }
    const signature = (graph) => contract.stableStringify ? contract.stableStringify(graph) : JSON.stringify(graph);
    let state = { revision: 1, graph: creator, creatorDefaultGraph: creator, graphSignature: signature(creator), creatorSignature: signature(creator) };
    const saves = [];
    window.__harness = { saves };
    const desktop = {
      reportWorkspaceStartup: async () => ({ ok: true, state }),
      loadWorkspaceComposition: async () => ({ ok: true, state }),
      saveWorkspaceComposition: async (graph, meta = {}) => {
        saves.push({ graph, meta });
        state = { ...state, revision: state.revision + 1, graph, graphSignature: signature(graph) };
        return { ok: true, state };
      },
      cancelWorkspaceComposition: async () => ({ ok: true, state }),
    };
    const host = window.PixelodyWorkspaceProductionHost.createHost({
      document, desktop,
      read: () => ({}), subscribe: () => () => {}, command: () => true, announce: () => {},
      experimentProfile: { PROFILE_ID: profile.PROFILE_ID, LABEL: profile.LABEL, START_IN_USE_MODE: false },
      paintCanvas: true,
      canvasAnchors: [{ nodeId: 'playback-bottom-dock', selector: '.player' }],
      canvasStudio: true,
      canvasGridId: '',
      activeThemeId: port ? port.key : 'foreground',
      resolveThemePreset: () => (port ? { key: port.key, label: port.name, graph: ports.graphForPort(port.key) } : null),
    });
    window.__harness.host = host;
    const result = await host.setActive(true);
    return { result: JSON.parse(JSON.stringify(result || null)), mode: document.body.dataset.compositionMode || '' };
  }, theme);
  return { page, context, errors, booted };
}

// The model, the screen, and what the app said -- the three things a gesture
// can disagree about.
async function observe(page) {
  return page.evaluate(() => {
    const host = window.__harness.host;
    const session = host.snapshot().session;
    const graph = session?.graph;
    const model = {};
    const walk = (node, parent) => {
      if (!node) return;
      if (parent?.type === 'grid' && node.placement) {
        const p = node.placement;
        model[node.id] = `${p.columnStart ?? '-'}/${p.rowStart ?? '-'}/${p.columnSpan}/${p.rowSpan}`;
      }
      (node.children || []).forEach((child) => walk(child, node));
    };
    walk(graph, null);
    const screen = {};
    document.querySelectorAll('.cw-grid > .cw-node[data-cw-node-id]:not(.cw-drag-placeholder)').forEach((n) => {
      const v = (p) => n.style.getPropertyValue(p) || '-';
      if (n.style.getPropertyValue('--cw-column-start') || n.style.getPropertyValue('--cw-column-span')) {
        screen[n.dataset.cwNodeId] = `${v('--cw-column-start')}/${v('--cw-row-start')}/${v('--cw-column-span')}/${v('--cw-row-span')}`;
      }
    });
    const status = document.querySelector('.cw-studio-live-status');
    return {
      mode: session?.mode, canUndo: session?.canUndo, revision: session?.revision,
      model, screen,
      status: status ? { text: status.textContent, tone: status.dataset.tone } : null,
      selected: [...document.querySelectorAll('[data-cw-studio-selected]')].map((n) => n.dataset.cwNodeId),
    };
  });
}

async function rectOf(page, selector) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, right: r.right, bottom: r.bottom };
  }, selector);
}

// A real drag: press, move in steps (the studio coalesces into animation
// frames), release. Waits a frame between steps so every move is processed.
async function drag(page, from, to, { steps = 12, hold = null } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(20);
  }
  if (hold) await hold();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function enterEdit(page) {
  await page.evaluate(() => { if (document.body.dataset.compositionMode !== 'edit') document.querySelector('#workspaceProductionMode').click(); });
  await page.waitForTimeout(150);
  return page.evaluate(() => document.body.dataset.compositionMode);
}

module.exports = { bootCanvas, observe, rectOf, drag, enterEdit };
