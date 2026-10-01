(function pixelodyCanvasStudioFactory(root, factory) {
  const moduleEffects = typeof module === 'object' && module.exports
    ? require('./module-effects')
    : root.PixelodyCanvasModuleEffects;
  const api = factory(moduleEffects);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCanvasStudio = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasStudioApi(moduleEffects) {
  'use strict';

  // Canvas Studio is the authoring surface for a navigation system.
  //
  // It owns no state. Every mutation it offers becomes one canonical
  // operation dispatched through the host's C5 session, so undo, redo,
  // cancel, and the atomic save keep working exactly as they do for the
  // pointer routes. It builds its own DOM rather than claiming markup in
  // index.html, so it can be added and removed without touching the
  // product shell.
  //
  // The rail holds the save floor: the durable authority runs with no
  // required-job requirement for this profile so a one-pane canvas can
  // exist at all, and the readiness list here is what refuses to commit an
  // incomplete composition.

  const SHAPE_ORDER = Object.freeze(['micro', 'strip', 'tile', 'panel', 'stage', 'ambient', 'mini']);
  const COMPOSITION_GESTURE_SELECTOR = '.cw-pane-drag-handle, .cw-pane-resize-handle, .cw-split-handle, .cw-production-drag-handle, .cw-drag-handle, .cw-resize-handle';
  if (!moduleEffects) throw new Error('Canvas Studio requires the module effects contract.');

  function createStudio(options = {}) {
    const documentObject = options.document;
    const bridge = options.bridge;
    if (!documentObject || !bridge) throw new Error('Canvas Studio requires a document and a host bridge.');

    let rail = null;
    let launcher = null;
    let legacyLauncher = null;
    let addLauncher = null;
    let serial = 1;
    let selectedId = '';
    let lastGraph = null;
    let selectionBound = false;
    let pointerInteraction = null;
    let controlDrag = null;
    let pickedSourceId = '';
    let keyboardTargetId = '';
    let selectedGroupId = '';
    let liveStatus = { message: '', tone: 'idle' };
    let suppressMoveClickUntil = 0;
    // The row line the player sits on during the current gesture, when the
    // grid being edited is docked above the player. See heroFoldFor.
    let heroFold = null;
    let wasEditing = false;
    let pointerFrame = 0;
    let queuedPanePoint = null;
    let queuedResizePoint = null;
    let moduleContextMenu = null;
    let moduleContextOrigin = null;
    let trayFilter = '';
    const stackViewState = new Map();
    const sections = {};

    function element(tag, className, text) {
      const node = documentObject.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(label, title, onClick, className = 'cw-studio-button') {
      const control = element('button', className, label);
      control.type = 'button';
      if (title) control.title = title;
      control.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
      return control;
    }

    function nextId(prefix) {
      let candidate = `${prefix}-${serial++}`;
      while (findNode(lastGraph, candidate)) candidate = `${prefix}-${serial++}`;
      return candidate;
    }

    function walk(node, visit, parent = null) {
      if (!node) return;
      visit(node, parent);
      (node.children || []).forEach((child) => walk(child, visit, node));
    }

    function findNode(graph, id) {
      let found = null;
      walk(graph, (node) => { if (node.id === id) found = node; });
      return found;
    }

    function parentOf(graph, id) {
      let found = null;
      walk(graph, (node, parent) => { if (node.id === id) found = parent; });
      return found;
    }

    function modulesIn(graph) {
      const list = [];
      walk(graph, (node) => { if (node.type === 'module') list.push(node); });
      return list;
    }

    function splitsIn(graph) {
      const list = [];
      walk(graph, (node) => { if (node.type === 'split') list.push(node); });
      return list;
    }

    function stacksIn(graph) {
      const list = [];
      walk(graph, (node) => { if (node.type === 'stack') list.push(node); });
      return list;
    }

    function placedCounts(graph) {
      const counts = new Map();
      modulesIn(graph).forEach((node) => counts.set(node.moduleKey, (counts.get(node.moduleKey) || 0) + 1));
      return counts;
    }

    function unplacedSpecs(graph) {
      const counts = placedCounts(graph);
      return bridge.moduleSpecs().filter((spec) => {
        const count = counts.get(spec.key) || 0;
        if (spec.instancePolicy !== 'multiple') return count === 0;
        return count < Math.max(1, Number(spec.maxInstances) || 4);
      });
    }

    function missingJobs(graph) {
      const reachable = new Set();
      modulesIn(graph).forEach((node) => {
        (bridge.specs()[node.moduleKey]?.jobs || []).forEach((job) => reachable.add(job));
      });
      return bridge.requiredJobs().filter((job) => !reachable.has(job));
    }

    // Tray placement always enters a grid. Inserting a new child directly into
    // a stack made it immediately invisible behind the current active child;
    // stacking is therefore an explicit, previewable relationship command.
    function insertionTarget(graph) {
      let candidate = selectedId ? parentOf(graph, selectedId) : null;
      while (candidate && candidate.type !== 'grid') candidate = parentOf(graph, candidate.id);
      if (candidate) return candidate.id;
      const selected = selectedId ? findNode(graph, selectedId) : null;
      if (selected?.type === 'grid') return selected.id;
      return bridge.canvasGridId();
    }

    function selectedModule(graph) {
      const node = selectedId ? findNode(graph, selectedId) : null;
      return node && node.type === 'module' ? node : null;
    }

    function moduleLabel(node) {
      if (node && node.type !== 'module') {
        const filler = soleFiller(node);
        if (filler) return moduleLabel(filler);
        // A group is named by what is in it: "Track information / Queue stack"
        // says which one on a canvas that has several.
        const inside = (node.children || []).filter((child) => child.type === 'module').slice(0, 2).map((child) => moduleLabel(child));
        return inside.length ? `${inside.join(' / ')} ${node.type === 'split' ? 'split' : node.type}` : groupLabel(node);
      }
      return bridge.specs()[node?.moduleKey]?.label || node?.moduleKey || node?.id || 'pane';
    }

    // A section holding exactly one pane that fills it -- the Stage in every
    // ported theme, a grid wrapped round the track browser -- is that pane as
    // far as anyone looking at the canvas can tell. It used to be two things
    // stacked in one place: the inner pane's Move grip and corners sat exactly
    // over the section's, so what looked like "move the Stage" moved the track
    // browser inside it (which fills it, so nothing happened, and the status
    // line reported an internal error), clicking the Stage selected the track
    // browser, the Stage's own corners never appeared because the Stage could
    // never be selected, and anchoring from its menu anchored the pane inside
    // rather than the one that gets pushed. Now the section is what the grip,
    // the corners and the layout half of the menu act on.
    function soleFiller(section) {
      if (section?.type !== 'grid') return null;
      const spatial = (section.children || []).filter((child) => child.type !== 'overlay');
      if (spatial.length !== 1 || spatial[0].type !== 'module') return null;
      const only = spatial[0];
      const columns = Math.max(1, Number(section.columns) || DEFAULT_COLUMNS);
      const held = only.placement;
      if (held && ((held.columnStart || 1) !== 1 || (held.rowStart || 1) !== 1 || (held.columnSpan || columns) < columns)) return null;
      return only;
    }

    // The section a pane stands for, when it is a section's sole filler and
    // that section is itself placed on a grid. Null otherwise.
    function layoutOwnerOf(graph, nodeId) {
      const parent = nodeId ? parentOf(graph, nodeId) : null;
      if (!parent || soleFiller(parent)?.id !== nodeId) return null;
      return parentOf(graph, parent.id)?.type === 'grid' ? parent : null;
    }

    // What is actually placed on the grid for a pane that is not placed there
    // itself: its stack, its split, or the section it fills. Selecting the pane
    // brings up that group's corners, and the Size, Position and Anchor parts
    // of its menu act on the group -- a pane inside a stack has no cells of its
    // own, so those used to be missing, and the stack's corners appeared only
    // when the stack was chosen from the rail.
    function placementOwnerOf(graph, nodeId) {
      const parent = nodeId ? parentOf(graph, nodeId) : null;
      if (!parent || parent.type === 'grid' && soleFiller(parent)?.id !== nodeId) return null;
      if (!['grid', 'stack', 'split'].includes(parent.type)) return null;
      return parentOf(graph, parent.id)?.type === 'grid' ? parent : null;
    }

    function selectSection(sectionId) {
      const section = findNode(bridge.snapshot().graph, sectionId);
      const filler = soleFiller(section);
      if (filler) select(filler.id);
      else if (section) selectGroup(section.id);
    }

    // Mirrors contract.stableStringify, which is what the session compares to
    // decide an operation changed nothing. The studio does not import the
    // contract.
    function stableText(value) {
      if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return 'null';
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map((item) => stableText(item)).join(',')}]`;
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableText(value[key])}`).join(',')}}`;
    }

    // Whether two graphs lay the canvas out the same way. The packer rewrites a
    // grid's children into reading order after every placement, so a pane put
    // back exactly where it was still came out as a different graph -- the
    // session took it as an edit, and an undo step was spent on nothing
    // visible. A grid's child order is reading order derived from placement,
    // so it is ignored here; a split's or stack's is not.
    function sameLayout(left, right) {
      const orderFree = (node) => {
        if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return node;
        const children = node.children.map(orderFree);
        if (node.type === 'grid') children.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
        return { ...node, children };
      };
      return stableText(orderFree(left)) === stableText(orderFree(right));
    }

    function groupLabel(node) {
      if (!node) return 'group';
      return node.type === 'split' ? `${node.axis} split` : node.type;
    }

    function directContainerAncestor(graph, nodeId, allowed = ['grid']) {
      let child = findNode(graph, nodeId);
      let parent = child ? parentOf(graph, child.id) : null;
      while (parent && !allowed.includes(parent.type)) {
        child = parent;
        parent = parentOf(graph, parent.id);
      }
      return parent ? { container: parent, child } : null;
    }

    function intentFor(kind, sourceId, targetId) {
      const labels = {
        'move-before': 'Move before',
        'move-after': 'Move after',
        'split-before-horizontal': 'Split left',
        'split-after-horizontal': 'Split right',
        'split-before-vertical': 'Split above',
        'split-after-vertical': 'Split below',
        stack: 'Stack together',
      };
      const split = kind.match(/^split-(before|after)-(horizontal|vertical)$/);
      return Object.freeze({ kind, label: labels[kind], sourceId, targetId, ...(split ? { position: split[1], axis: split[2] } : {}) });
    }

    /* ---- operations ---------------------------------------------------- */

    function placeModule(spec) {
      const graph = bridge.snapshot().graph;
      const id = nextId('pane');
      const ok = bridge.dispatch({
        type: 'insertModule',
        containerId: insertionTarget(graph),
        node: { type: 'module', id, moduleKey: spec.key, shape: spec.defaultShape, configuration: {} },
      }, `${spec.label} placed on the canvas.`);
      if (ok?.ok) select(id);
    }

    function splitSelected(axis) {
      const graph = bridge.snapshot().graph;
      const target = selectedModule(graph);
      if (!target) return;
      const spec = unplacedSpecs(graph)[0];
      if (!spec) { bridge.setStatus?.('Every module is already placed. Remove one first, or stack it instead.', 'warning'); return; }
      const id = nextId('pane');
      const ok = bridge.dispatch({
        type: 'splitWith',
        splitId: nextId('split'),
        axis,
        position: 'after',
        targetId: target.id,
        node: { type: 'module', id, moduleKey: spec.key, shape: spec.defaultShape, configuration: {} },
      }, `${spec.label} split ${axis === 'horizontal' ? 'beside' : 'below'} ${bridge.specs()[target.moduleKey]?.label || target.id}.`);
      if (ok?.ok) select(id);
    }

    function stackOnSelected() {
      const graph = bridge.snapshot().graph;
      const target = selectedModule(graph);
      if (!target) return;
      const spec = unplacedSpecs(graph)[0];
      if (!spec) { bridge.setStatus?.('Every module is already placed. Remove one first.', 'warning'); return; }
      const id = nextId('pane');
      const ok = bridge.dispatch({
        type: 'stackWith',
        stackId: nextId('stack'),
        targetId: target.id,
        position: 'after',
        activeChildId: id,
        node: { type: 'module', id, moduleKey: spec.key, shape: spec.defaultShape, configuration: {} },
      }, `${spec.label} stacked with ${bridge.specs()[target.moduleKey]?.label || target.id}.`);
      if (ok?.ok) select(id);
    }

    function removeSelected() {
      const graph = bridge.snapshot().graph;
      const target = selectedModule(graph);
      if (!target) return;
      if (modulesIn(graph).length <= 1) { bridge.setStatus?.('The canvas needs at least one pane. Place another module before removing this one.', 'warning'); return; }
      const label = bridge.specs()[target.moduleKey]?.label || target.id;
      const ok = bridge.dispatch({ type: 'removeOptionalModule', sourceId: target.id }, `${label} returned to the tray.`);
      if (ok?.ok) select('');
    }

    function withLocalSelection(nodeId, action) {
      selectedId = nodeId;
      bridge.select?.(nodeId);
      action();
    }

    function setShape(shape) {
      const target = selectedModule(bridge.snapshot().graph);
      if (!target) return;
      bridge.dispatch({ type: 'setModuleShape', moduleId: target.id, shape }, `Shape set to ${shape}.`);
    }

    function setSelectedEffect(key, value) {
      const target = selectedModule(bridge.snapshot().graph);
      if (!target || !moduleEffects.OPTIONS[key]?.includes(value)) return;
      const configuration = moduleEffects.mergeConfiguration(target.configuration, { [key]: value });
      bridge.dispatch({ type: 'setModuleConfiguration', moduleId: target.id, configuration }, `${moduleLabel(target)} ${key} set to ${value}.`);
    }

    function effectField(node, key, label) {
      const current = moduleEffects.fromConfiguration(node.configuration);
      const field = element('label', 'cw-studio-field cw-studio-effect-field');
      field.append(element('span', '', label));
      const control = documentObject.createElement('select');
      control.setAttribute('aria-label', `${label} for ${moduleLabel(node)}`);
      moduleEffects.OPTIONS[key].forEach((value) => {
        const option = documentObject.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = current[key] === value;
        control.append(option);
      });
      control.addEventListener('change', () => setSelectedEffect(key, control.value));
      field.append(control);
      return field;
    }

    function moveSelected(after) {
      const graph = bridge.snapshot().graph;
      const target = selectedModule(graph);
      if (!target) return;
      const parent = parentOf(graph, target.id);
      const siblings = (parent?.children || []).filter((child) => child.id !== target.id);
      const index = (parent?.children || []).findIndex((child) => child.id === target.id);
      const neighbour = after ? (parent?.children || [])[index + 1] : (parent?.children || [])[index - 1];
      if (!neighbour) { bridge.setStatus?.('No neighbour in that direction.', 'warning'); return; }
      if (!siblings.length) return;
      bridge.dispatch({ type: after ? 'moveAfter' : 'moveBefore', sourceId: target.id, targetId: neighbour.id }, 'Pane reordered.');
    }

    function resizeSplit(splitNode, ratio) {
      const clamped = Math.max(0.2, Math.min(0.8, ratio));
      bridge.dispatch({ type: 'resizeSplit', splitId: splitNode.id, weights: [clamped, 1 - clamped] }, `Split ${Math.round(clamped * 100)} / ${Math.round((1 - clamped) * 100)}.`);
    }

    function selectedGridPlacement(graph, node) {
      const parent = parentOf(graph, node.id);
      if (parent?.type !== 'grid') return null;
      const index = parent.children.findIndex((child) => child.id === node.id);
      return {
        parent,
        columnStart: node.placement?.columnStart,
        rowStart: node.placement?.rowStart,
        columnSpan: node.placement?.columnSpan || (index === 0 ? Math.min(parent.columns, 32) : Math.min(parent.columns, 16)),
        rowSpan: node.placement?.rowSpan || (index === 0 ? 12 : 6),
      };
    }

    // The interface word is "anchor"; the graph key is `pin`, because an
    // overlay node already uses `anchor` for which corner it hangs from.
    // The addressable canvas, in fine rows. Mirrors contract.MAX_ROWS; the
    // studio takes only moduleEffects and does not import the contract.
    const MAX_ROWS = 576;
    // The same across, and for a single pane. Mirrors contract.MAX_COLUMNS and
    // contract.MAX_ROW_SPAN. These two were left at the archive's own 24 when
    // the grid was divided, which is a quarter of the canvas and a sixth of a
    // pane's height -- scripts/check-studio-packing.js runs the real packer at
    // the real width so that cannot happen again quietly.
    const MAX_COLUMNS = 96;
    const MAX_ROW_SPAN = 144;
    // Fine rows per coarse band. Mirrors contract.ROW_DIVISIONS: a grid's rows
    // are always fine (the stylesheet divides the band base by six), whatever
    // its column count.
    const ROW_DIVISIONS = 6;
    // What a grid is worth when it declares nothing. foreground.css spells the
    // same fallback as `var(--cw-columns, 48)`; the two have to agree, or the
    // hit test aims at a grid the browser did not draw.
    const DEFAULT_COLUMNS = 48;

    const PIN_LABELS = Object.freeze({
      none: 'Free',
      position: 'Hold position',
      size: 'Hold size',
      firm: 'Anchored',
    });
    // Only these two are offered. Dragging currently relocates panes and never
    // resizes them, so 'size' would be inert and 'position' indistinguishable
    // from 'firm'. The graph stores all four and contract.resolveWithAnchors
    // already honours them; the other two surface when the drag path learns to
    // compress. Four buttons where two of them do nothing is worse than two.
    const PIN_CHOICES = Object.freeze(['none', 'firm']);

    function pinOf(node) {
      const value = typeof node?.pin === 'string' ? node.pin : 'none';
      return Object.prototype.hasOwnProperty.call(PIN_LABELS, value) ? value : 'none';
    }

    function pinHoldsPosition(pin) { return pin === 'position' || pin === 'firm'; }

    function setPin(nodeId, pin) {
      const node = findNode(bridge.snapshot().graph, nodeId);
      const label = node ? moduleLabel(node) : 'Pane';
      const message = pin === 'none'
        ? `${label} released. It can be moved and resized again.`
        : `${label} anchored: ${PIN_LABELS[pin].toLowerCase()}.`;
      return bridge.dispatch({ type: 'setNodePin', nodeId, pin: pin === 'none' ? null : pin }, message);
    }

    function defaultGridFootprint(grid, child, index) {
      return {
        columnSpan: Math.max(1, Math.min(grid.columns || 48, child?.placement?.columnSpan || (index === 0 ? Math.min(grid.columns || 48, 32) : Math.min(grid.columns || 48, 16)))),
        rowSpan: Math.max(1, Math.min(144, child?.placement?.rowSpan || (index === 0 ? 12 : 6))),
      };
    }

    // What the packer did to the panes around the one that moved, keyed by the
    // graph it returned, so previews and messages can say it.
    const packingNotes = new WeakMap();

    function packedGridGraph(sourceGraph, sourceId, desiredPlacement) {
      const graph = JSON.parse(JSON.stringify(sourceGraph));
      const source = findNode(graph, sourceId);
      const grid = source ? parentOf(graph, source.id) : null;
      if (!source || grid?.type !== 'grid') return null;
      const columns = Math.max(1, Math.min(MAX_COLUMNS, Number(grid.columns) || DEFAULT_COLUMNS));
      const spatial = grid.children.filter((child) => child.type !== 'overlay');
      const occupied = new Set();
      const fits = (placement) => {
        if (placement.columnStart < 1 || placement.rowStart < 1 || placement.columnStart + placement.columnSpan - 1 > columns || placement.rowStart + placement.rowSpan - 1 > MAX_ROWS) return false;
        for (let row = placement.rowStart; row < placement.rowStart + placement.rowSpan; row += 1) {
          for (let column = placement.columnStart; column < placement.columnStart + placement.columnSpan; column += 1) {
            if (occupied.has(`${column}:${row}`)) return false;
          }
        }
        return true;
      };
      const occupy = (placement) => {
        for (let row = placement.rowStart; row < placement.rowStart + placement.rowSpan; row += 1) {
          for (let column = placement.columnStart; column < placement.columnStart + placement.columnSpan; column += 1) occupied.add(`${column}:${row}`);
        }
      };
      const overlaps = (left, right) => left.columnStart < right.columnStart + right.columnSpan
        && right.columnStart < left.columnStart + left.columnSpan
        && left.rowStart < right.rowStart + right.rowSpan
        && right.rowStart < left.rowStart + left.rowSpan;
      // Shrink `box` off whichever edge `wall` is pushing on, keeping the far
      // edge. Returns null when there is nothing left to give.
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
      const notes = { compressed: [], swapped: [], pushed: [] };
      // The strip `box` gives up to clear `intruder`, keeping the far edge.
      // Never below half of what it had on the axis it loses, so a pane that
      // gives way stays usable; the side is the one facing away from the
      // intruder, so it does not flip as the pointer crosses the middle.
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
      const normalize = (candidate, footprint) => ({
        columnStart: Math.max(1, Math.min(columns - footprint.columnSpan + 1, Math.round(candidate?.columnStart) || 1)),
        rowStart: Math.max(1, Math.min(MAX_ROWS - footprint.rowSpan + 1, Math.round(candidate?.rowStart) || 1)),
        columnSpan: footprint.columnSpan,
        rowSpan: footprint.rowSpan,
      });
      // A pane that is in the way should move, not relocate. Walking down from
      // where it already sits keeps it in its own column and shifts it by the
      // minimum that clears, which is what "the rest conform to it" means.
      // There is no last resort any more. A pane that cannot clear by moving
      // down in its own column means the drop does not work, and saying so is
      // honest; relocating it somewhere nobody chose is not.
      const fold = heroFold && heroFold.gridId === grid.id ? heroFold.line : null;
      const acrossFold = (box) => Boolean(fold) && box.rowSpan < fold && box.rowStart < fold && box.rowStart + box.rowSpan > fold;
      const pushedDown = (preferred, footprint) => {
        if (!preferred) return null;
        for (let rowStart = preferred.rowStart; rowStart <= MAX_ROWS - footprint.rowSpan + 1; rowStart += 1) {
          const candidate = { columnStart: preferred.columnStart, rowStart, ...footprint };
          // Pushed past the player, it goes all the way past it.
          if (acrossFold(candidate)) continue;
          if (fits(candidate)) return candidate;
        }
        return null;
      };
      // An anchored pane is not a participant in packing, it is the ground
      // the packing happens on. Claiming its cells first is what makes that
      // true: everything after this simply cannot have them.
      const anchored = spatial.filter((child) => child.id !== sourceId && pinHoldsPosition(pinOf(child)));
      for (const child of anchored) {
        const index = spatial.findIndex((candidate) => candidate.id === child.id);
        const footprint = defaultGridFootprint(grid, child, index);
        const held = normalize(child.placement, footprint);
        if (!fits(held)) return null;
        child.placement = held;
        occupy(held);
      }

      const sourceIndex = spatial.findIndex((child) => child.id === sourceId);
      // Where the moving pane was, which it is about to leave.
      const home = Number.isInteger(source.placement?.columnStart) && Number.isInteger(source.placement?.rowStart)
        ? { ...source.placement }
        : null;
      const sourceFootprint = {
        columnSpan: Math.max(1, Math.min(columns, Math.round(desiredPlacement?.columnSpan) || defaultGridFootprint(grid, source, sourceIndex).columnSpan)),
        rowSpan: Math.max(1, Math.min(MAX_ROW_SPAN, Math.round(desiredPlacement?.rowSpan) || defaultGridFootprint(grid, source, sourceIndex).rowSpan)),
      };
      let sourcePlacement = normalize(desiredPlacement || source.placement, sourceFootprint);
      // "If it's to push up against that, they will compress to compensate."
      // The dragged pane is what gives way to something the person anchored,
      // shrinking off the edge it is pushing against until it clears.
      for (let pass = 0; pass < anchored.length + 1 && !fits(sourcePlacement); pass += 1) {
        const wall = anchored.find((child) => child.placement && overlaps(sourcePlacement, child.placement));
        if (!wall) break;
        const shrunk = shrinkClear(sourcePlacement, wall.placement);
        if (!shrunk) return null;
        sourcePlacement = shrunk;
      }
      if (!fits(sourcePlacement)) return null;
      source.placement = sourcePlacement;
      occupy(sourcePlacement);
      // Where a pane is put is the person's decision, not the layout's. This
      // loop used to re-derive every sibling's placement on every pointer
      // move, which meant a pane with no coordinates of its own got packed
      // into the top-left, and a pane that could not push down teleported into
      // whatever empty cell was found first. Both of those fill void that
      // somebody left on purpose.
      //
      // Now: a pane that is not actually in the way is not touched at all --
      // not moved, not normalised, not even re-read. A pane that is in the way
      // moves straight down by the least that clears, and if it cannot, the
      // whole arrangement is refused rather than something being relocated
      // somewhere nobody asked for.
      for (const child of spatial.filter((candidate) => candidate.id !== sourceId && !pinHoldsPosition(pinOf(candidate)))) {
        // No coordinates means the pane is flowing, and flowing is a position
        // too. Giving it one here is the layout deciding something the person
        // did not.
        if (!child.placement?.columnStart || !child.placement?.rowStart) continue;
        const index = spatial.findIndex((candidate) => candidate.id === child.id);
        const footprint = defaultGridFootprint(grid, child, index);
        const preferred = normalize(child.placement, footprint);
        if (fits(preferred)) {
          child.placement = preferred;
          occupy(preferred);
          continue;
        }
        // "They will compress to compensate." A pane in the way gives up the
        // strip it is being pushed on, from the side the moving pane is coming
        // from, as long as it keeps at least half its size on that axis.
        // Pushing it straight down instead was the only answer before, and in
        // a composition that fills the window it meant stretching the library
        // by a column threw the whole Stage below the fold.
        // A pane anchored in size (contract: may move, may not get smaller)
        // skips straight to moving.
        const squeezed = pinOf(child) === 'size' ? null : yieldTo(preferred, sourcePlacement);
        if (squeezed && fits(squeezed)) {
          child.placement = squeezed;
          occupy(squeezed);
          notes.compressed.push(child.id);
          continue;
        }
        // Too much to give: it takes the place the moving pane just left, if
        // it fits there. Dropping one side column on the other swaps them.
        const traded = home ? { columnStart: home.columnStart, rowStart: home.rowStart, ...footprint } : null;
        if (traded && fits(traded)) {
          child.placement = traded;
          occupy(traded);
          notes.swapped.push(child.id);
          continue;
        }
        const moved = pushedDown(preferred, footprint);
        if (!moved) return null;
        child.placement = moved;
        occupy(moved);
        notes.pushed.push(child.id);
      }
      const overlayOrder = grid.children.filter((child) => child.type === 'overlay');
      // Reading order follows placement -- but only when every pane has one. A
      // flowing pane is placed by the browser in document order (the first
      // one gets the large default span), so reordering around it moves it;
      // and it has no rowStart to sort by, which threw here on every drag in
      // a grid that still had one, so nothing in Canvas Base could be moved.
      const allPlaced = spatial.every((child) => Number.isInteger(child.placement?.rowStart) && Number.isInteger(child.placement?.columnStart));
      const spatialOrder = allPlaced
        ? spatial.slice().sort((left, right) => left.placement.rowStart - right.placement.rowStart || left.placement.columnStart - right.placement.columnStart)
        : spatial;
      grid.children = [...spatialOrder, ...overlayOrder];
      // A pane that stands for its section is as tall as the section. Without
      // this a Stage made shorter kept a track browser of the old height inside
      // it, which ran out of the bottom and over whatever was below.
      spatial.forEach((child) => {
        const filler = soleFiller(child);
        if (filler?.placement && child.placement && filler.placement.rowSpan !== child.placement.rowSpan) {
          filler.placement = { ...filler.placement, rowSpan: child.placement.rowSpan };
        }
      });
      packingNotes.set(graph, notes);
      return graph;
    }

    // What the panes around a move did, in the words the status line uses:
    // " Track browser got narrower to make room." Empty when nothing gave way.
    function describePacking(graph) {
      const notes = graph ? packingNotes.get(graph) : null;
      if (!notes) return '';
      const names = (ids) => ids.map((id) => moduleLabel(findNode(graph, id)));
      const list = (items) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
      const parts = [];
      if (notes.compressed.length) parts.push(`${list(names(notes.compressed))} ${notes.compressed.length === 1 ? 'gets' : 'get'} smaller to make room`);
      if (notes.swapped.length) parts.push(`${list(names(notes.swapped))} ${notes.swapped.length === 1 ? 'takes' : 'take'} the space it left`);
      if (notes.pushed.length) parts.push(`${list(names(notes.pushed))} ${notes.pushed.length === 1 ? 'moves' : 'move'} down to row ${Math.min(...notes.pushed.map((id) => findNode(graph, id)?.placement?.rowStart || 1))}`);
      if (!parts.length) return '';
      const sentence = parts.join('; ');
      return ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
    }

    // Commit messages are in the past tense.
    function describePacked(graph) {
      return describePacking(graph)
        .replace(/ gets smaller/g, ' got smaller').replace(/ get smaller/g, ' got smaller')
        .replace(/ takes the space/g, ' took the space').replace(/ take the space/g, ' took the space')
        .replace(/ moves down/g, ' moved down').replace(/ move down/g, ' moved down');
    }

    // ---- View: zoom -----------------------------------------------------
    //
    // Zoom is a property of looking at the canvas, not of the canvas, so it is
    // held here rather than in the graph: it is never dispatched, never
    // undone, and never saved into a composition. Leaving Composition Mode
    // always returns to 1:1, so nobody can end up listening to music through a
    // canvas someone shrank an hour ago.
    const ZOOM_STEPS = Object.freeze([0.5, 0.67, 0.8, 1, 1.25, 1.5]);
    let canvasZoom = 1;

    // The artboard is the composition at the size the player actually fills,
    // measured once while nothing is scaled. Everything else -- zoom, panning,
    // the space around it -- is arranged relative to that one rectangle, so
    // what you see at 50% is the real thing at half size rather than the same
    // thing spread differently.
    let artboard = null;

    function measureArtboard() {
      const canvas = documentObject.querySelector('.cw-canvas');
      const root = canvas?.querySelector(':scope > .cw-root');
      if (!canvas || !root) return null;
      // Measuring while the artboard model is applied would measure the
      // artboard, so this reads the plain canvas box: drop the attribute,
      // read, put it back.
      const applied = canvas.dataset.cwArtboard;
      // Performance "conserve" mode gives every element a 70ms transition on
      // every property, the canvas's padding included, so a read taken straight
      // after dropping the attribute got the padding mid-transition -- still
      // the artboard's own inset, or none at all just after the rail opened.
      // The rail's reserve then measured as nothing and the artboard was laid
      // out under the rail. Transitions are held off for the read and until
      // the attribute is back, so the read is the settled box.
      const held = [canvas, root].map((element) => [element, element.style.getPropertyValue('transition'), element.style.getPropertyPriority('transition')]);
      held.forEach(([element]) => element.style.setProperty('transition', 'none', 'important'));
      if (applied) delete canvas.dataset.cwArtboard;
      const width = Math.round(root.offsetWidth);
      const height = Math.round(root.offsetHeight);
      // The insets the width was measured inside. The studio rail is fixed
      // over the canvas and is reserved only by the canvas's own padding, so
      // the artboard has to be laid out between these same edges; centring it
      // across the whole canvas instead put its left edge under the rail.
      const computed = documentObject.defaultView?.getComputedStyle?.(canvas);
      const inset = (side) => `${Math.max(0, Math.round(Number.parseFloat(computed?.[`padding${side}`]) || 0))}px`;
      const insets = { left: inset('Left'), right: inset('Right'), bottom: inset('Bottom') };
      if (applied) canvas.dataset.cwArtboard = applied;
      // Settle the restored box while transitions are still held.
      void canvas.offsetWidth;
      held.forEach(([element, value, priority]) => {
        if (value) element.style.setProperty('transition', value, priority);
        else element.style.removeProperty('transition');
      });
      if (width < 1 || height < 1) return null;
      return { width, height, insets };
    }

    function applyCanvasZoom() {
      const canvas = documentObject.querySelector('.cw-canvas');
      if (!canvas) return;
      if (bridge.snapshot().mode !== 'edit') {
        canvas.style.removeProperty('--cw-zoom');
        canvas.style.removeProperty('--cw-artboard-width');
        canvas.style.removeProperty('--cw-artboard-height');
        canvas.style.removeProperty('--cw-canvas-height');
        canvas.style.removeProperty('--cw-artboard-inset-left');
        canvas.style.removeProperty('--cw-artboard-inset-right');
        canvas.style.removeProperty('--cw-artboard-inset-bottom');
        delete canvas.dataset.cwArtboard;
        delete canvas.dataset.cwZoom;
        artboard = null;
        return;
      }
      // At 100% the canvas is its own artboard, so the measurement is taken
      // fresh every time zoom returns to 1 -- which is also how a window
      // resize is picked up without watching for one.
      if (canvasZoom === 1 || !artboard) {
        const measured = measureArtboard();
        if (measured) artboard = measured;
      }
      if (!artboard) return;
      canvas.style.setProperty('--cw-artboard-width', `${artboard.width}px`);
      canvas.style.setProperty('--cw-artboard-height', `${artboard.height}px`);
      canvas.style.setProperty('--cw-artboard-inset-left', artboard.insets.left);
      canvas.style.setProperty('--cw-artboard-inset-right', artboard.insets.right);
      canvas.style.setProperty('--cw-artboard-inset-bottom', artboard.insets.bottom);
      canvas.style.setProperty('--cw-zoom', String(canvasZoom));
      canvas.dataset.cwArtboard = 'true';
      canvas.dataset.cwZoom = String(Math.round(canvasZoom * 100));
      // A composition may run past the bottom of the window. A transform does
      // not change layout, so the scroll extent has to be corrected by what the
      // composition actually grew to rather than by the artboard's own height,
      // or the part below the fold cannot be scrolled to. Reading offsetHeight
      // here is safe: the property it feeds is a margin, and a margin does not
      // change the height it was measured from.
      const root = canvas.querySelector(':scope > .cw-root');
      if (root) canvas.style.setProperty('--cw-canvas-height', `${Math.round(root.offsetHeight)}px`);
    }

    // ---- Panning ---------------------------------------------------------
    //
    // Middle-drag anywhere, or space-drag, moves the workspace under the
    // artboard. Both are deliberately buttons the composition drag path does
    // not use -- every one of its handlers filters to the left button -- so
    // panning cannot be confused with moving a pane.
    let panning = null;
    let spaceHeld = false;

    function panSurface() {
      return documentObject.querySelector('.cw-canvas[data-cw-artboard]');
    }

    function beginPan(event) {
      const surface = panSurface();
      if (!surface) return false;
      panning = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        scrollLeft: surface.scrollLeft,
        scrollTop: surface.scrollTop,
        surface,
      };
      surface.dataset.cwPanning = 'true';
      try { surface.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort */ }
      return true;
    }

    function movePan(event) {
      if (!panning || event.pointerId !== panning.pointerId) return;
      panning.surface.scrollLeft = panning.scrollLeft - (event.clientX - panning.originX);
      panning.surface.scrollTop = panning.scrollTop - (event.clientY - panning.originY);
    }

    function endPan(event) {
      if (!panning || (event && event.pointerId !== panning.pointerId)) return;
      try { panning.surface.releasePointerCapture?.(panning.pointerId); } catch { /* best effort */ }
      delete panning.surface.dataset.cwPanning;
      panning = null;
    }

    function handlePanPointerDown(event) {
      if (bridge.snapshot().mode !== 'edit') return;
      const wantsPan = event.button === 1 || (event.button === 0 && spaceHeld);
      if (!wantsPan) return;
      if (!event.target.closest?.('.cw-canvas')) return;
      if (!beginPan(event)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    function handlePanKeyDown(event) {
      if (event.key !== ' ' && event.code !== 'Space') return;
      if (bridge.snapshot().mode !== 'edit') return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], button')) return;
      event.preventDefault();
      spaceHeld = true;
      documentObject.body.dataset.cwPanReady = 'true';
    }

    function handlePanKeyUp(event) {
      if (event.key !== ' ' && event.code !== 'Space') return;
      releasePanArm();
    }

    // Arming makes the canvas pointer-transparent, so anything that can strip
    // the keyup -- losing focus, an alt-tab, a context menu -- has to disarm
    // it too, or the canvas is left looking normal and refusing every click.
    function releasePanArm() {
      if (!spaceHeld) return;
      spaceHeld = false;
      delete documentObject.body.dataset.cwPanReady;
    }

    function setCanvasZoom(value, message) {
      const next = ZOOM_STEPS.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best), ZOOM_STEPS[0]);
      if (next === canvasZoom) return;
      canvasZoom = next;
      applyCanvasZoom();
      renderZoom();
      if (message) bridge.setStatus?.(message, 'success');
    }

    function stepCanvasZoom(direction) {
      const current = ZOOM_STEPS.indexOf(canvasZoom);
      const from = current < 0 ? ZOOM_STEPS.indexOf(1) : current;
      const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, from + direction))];
      setCanvasZoom(next, `Canvas at ${Math.round(next * 100)}%.`);
    }

    function renderZoom() {
      if (!sections.view) return;
      sections.view.replaceChildren();
      sections.view.append(element('h3', '', 'View'));
      const row = element('div', 'cw-studio-row cw-studio-zoom-row');
      const out = button('Zoom out', 'Show more of the canvas at a smaller size', () => stepCanvasZoom(-1));
      out.disabled = canvasZoom <= ZOOM_STEPS[0];
      const readout = element('span', 'cw-studio-zoom-level', `${Math.round(canvasZoom * 100)}%`);
      readout.setAttribute('role', 'status');
      readout.setAttribute('aria-live', 'polite');
      readout.setAttribute('aria-label', `Canvas zoom ${Math.round(canvasZoom * 100)} percent`);
      const into = button('Zoom in', 'Show less of the canvas at a larger size', () => stepCanvasZoom(1));
      into.disabled = canvasZoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
      row.append(out, readout, into);
      const actual = button('Actual size', 'Return the canvas to 100%', () => setCanvasZoom(1, 'Canvas at 100%.'), 'cw-studio-button cw-studio-wide');
      actual.disabled = canvasZoom === 1;
      sections.view.append(row, actual);
    }

    function setPlacement(nodeId, columnSpan, rowSpan, message = 'Pane size updated.', starts = {}) {
      const snapshot = bridge.snapshot();
      const node = findNode(snapshot.graph, nodeId);
      const current = node ? selectedGridPlacement(snapshot.graph, node) : null;
      const desired = {
        columnStart: starts.columnStart || current?.columnStart || 1,
        rowStart: starts.rowStart || current?.rowStart || 1,
        columnSpan: Math.max(1, Math.min(current?.parent?.columns || DEFAULT_COLUMNS, Math.round(columnSpan))),
        rowSpan: Math.max(1, Math.min(MAX_ROW_SPAN, Math.round(rowSpan))),
      };
      const graph = packedGridGraph(snapshot.graph, nodeId, desired);
      if (!graph) {
        bridge.setStatus?.('The canvas could not find a non-overlapping fit for that size. Reduce the pane or free another grid area.', 'warning');
        return { ok: false, error: { code: 'CANVAS_GRID_FULL' } };
      }
      return bridge.dispatch({ type: 'restoreGraph', graph }, message, { layoutOnly: true });
    }

    function resetPlacement(nodeId) {
      return bridge.dispatch({ type: 'setNodePlacement', nodeId, placement: null }, 'Pane size returned to the theme default.');
    }

    function resetSelectedModule() {
      const node = selectedModule(bridge.snapshot().graph);
      if (!node) return;
      bridge.dispatch({ type: 'resetModule', moduleId: node.id }, `${moduleLabel(node)} shape and settings returned to their module defaults.`);
    }

    function duplicateSelected() {
      const graph = bridge.snapshot().graph;
      const node = selectedModule(graph);
      const spec = node ? bridge.specs()[node.moduleKey] : null;
      if (!node || spec?.instancePolicy !== 'multiple') return;
      const id = nextId('pane');
      const result = bridge.dispatch({
        type: 'insertModule',
        containerId: insertionTarget(graph),
        node: { type: 'module', id, moduleKey: node.moduleKey, shape: node.shape, configuration: JSON.parse(JSON.stringify(node.configuration || {})) },
      }, `${moduleLabel(node)} duplicated.`);
      if (result?.ok) select(id);
    }

    function canDuplicateSelected(graph = bridge.snapshot().graph) {
      const node = selectedModule(graph);
      const spec = node ? bridge.specs()[node.moduleKey] : null;
      if (!node || spec?.instancePolicy !== 'multiple') return false;
      return (placedCounts(graph).get(node.moduleKey) || 0) < Math.max(1, Number(spec.maxInstances) || 4);
    }

    function assignSelectedAmbient() {
      const node = selectedModule(bridge.snapshot().graph);
      const spec = node ? bridge.specs()[node.moduleKey] : null;
      if (!node || !(spec?.shapes || []).includes('ambient')) return;
      bridge.dispatch({ type: 'assignAmbient', sourceId: node.id, overlayId: nextId('ambient'), anchor: 'fill', boundsPolicy: 'contained' }, `${moduleLabel(node)} assigned as contained ambient content.`);
    }

    function replaceSelected(moduleKey) {
      const node = selectedModule(bridge.snapshot().graph);
      const spec = bridge.specs()[moduleKey];
      if (!node || !spec || node.moduleKey === moduleKey) return;
      const result = bridge.dispatch({ type: 'replaceModule', moduleId: node.id, moduleKey, shape: spec.defaultShape, configuration: {} }, `${moduleLabel(node)} replaced with ${spec.label}.`);
      if (result?.ok) select(node.id);
    }

    function applySelectedIntent(kind, targetId, route = 'menu') {
      const graph = bridge.snapshot().graph;
      const source = selectedModule(graph);
      const target = findNode(graph, targetId);
      if (!source || !target || target.type !== 'module' || source.id === target.id) {
        bridge.setStatus?.('Choose a different destination pane first.', 'warning');
        return false;
      }
      return bridge.applyDropIntent(intentFor(kind, source.id, target.id), route);
    }

    function recombineSelected() {
      const graph = bridge.snapshot().graph;
      const source = selectedModule(graph);
      const parent = source ? parentOf(graph, source.id) : null;
      if (!source || !parent || !['split', 'stack'].includes(parent.type)) {
        bridge.setStatus?.('This pane is not inside a split or stack.', 'warning');
        return;
      }
      const sibling = parent.children.find((child) => child.id !== source.id);
      if (!sibling) return;
      const sourceIndex = parent.children.findIndex((child) => child.id === source.id);
      const kind = sourceIndex === 0 ? 'move-before' : 'move-after';
      const result = bridge.applyDropIntent(intentFor(kind, source.id, sibling.id), 'menu');
      if (result) bridge.setStatus?.(`${moduleLabel(source)} removed from the ${parent.type}; both panes remain on the canvas.`, 'success');
    }

    function activateStackChild(stack, childId) {
      if (!stack?.children?.some((child) => child.id === childId)) return;
      if (bridge.snapshot().mode === 'edit') {
        const child = findNode(bridge.snapshot().graph, childId);
        const result = bridge.dispatch({ type: 'setActiveStackChild', stackId: stack.id, childId }, `${moduleLabel(child)} is now visible in this stack.`);
        if (result?.ok) {
          select(childId);
          documentObject.defaultView?.setTimeout?.(() => {
            const surface = [...documentObject.querySelectorAll('.cw-stack[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === stack.id);
            [...(surface?.querySelectorAll(':scope > .cw-stack-switcher > .cw-stack-tab') || [])].find((tab) => tab.getAttribute('aria-selected') === 'true')?.focus?.();
          }, 0);
        }
        return;
      }
      stackViewState.set(stack.id, childId);
      paintStacks();
      bridge.setStatus?.(`${moduleLabel(findNode(bridge.snapshot().graph, childId))} shown in this stack.`, 'success');
      documentObject.defaultView?.setTimeout?.(() => {
        const surface = [...documentObject.querySelectorAll('.cw-stack[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === stack.id);
        [...(surface?.querySelectorAll(':scope > .cw-stack-switcher > .cw-stack-tab') || [])].find((tab) => tab.getAttribute('aria-selected') === 'true')?.focus?.();
      }, 0);
    }

    function beginMove(sourceId) {
      const graph = bridge.snapshot().graph;
      const source = findNode(graph, sourceId);
      if (!source || source.type !== 'module') return;
      pickedSourceId = sourceId;
      keyboardTargetId = modulesIn(graph).find((node) => node.id !== sourceId)?.id || '';
      selectedId = sourceId;
      bridge.select?.(selectedId);
      paintSelection();
      render();
      bridge.setStatus?.(`${moduleLabel(source)} picked up. Choose another pane on the canvas; its placement choices will appear on that pane.`, 'success');
    }

    function cancelMove() {
      if (!pickedSourceId) return;
      pickedSourceId = '';
      keyboardTargetId = '';
      documentObject.querySelectorAll('[data-cw-pick-target]').forEach((node) => node.removeAttribute('data-cw-pick-target'));
      paintSelection();
      render();
      bridge.setStatus?.('Move cancelled. The canvas was not changed.', 'warning');
    }

    const TEMPLATE_DEFINITIONS = Object.freeze([
      Object.freeze({ key: 'focus', label: 'Focus', summary: 'Track browser first; supporting panes flow around it.' }),
      Object.freeze({ key: 'queue-session', label: 'Queue session', summary: 'Track browser and Queue share one emphasized split.' }),
      Object.freeze({ key: 'visual-listening', label: 'Visual listening', summary: 'Track browser and Signal field share one emphasized split when Signal is placed.' }),
      Object.freeze({ key: 'technical', label: 'Technical', summary: 'Track browser and Track information share one emphasized split.' }),
    ]);

    function templateGraph(graph, key) {
      const modules = modulesIn(graph).map((node) => {
        const clone = JSON.parse(JSON.stringify(node));
        delete clone.placement;
        return clone;
      });
      const byKey = new Map(modules.map((node) => [node.moduleKey, node]));
      const priority = key === 'queue-session' ? ['tracks.browser', 'queue.view']
        : key === 'visual-listening' ? ['tracks.browser', 'audio.visualizer']
          : key === 'technical' ? ['tracks.browser', 'track.information']
            : ['tracks.browser'];
      modules.sort((a, b) => {
        const left = priority.indexOf(a.moduleKey);
        const right = priority.indexOf(b.moduleKey);
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
      });
      const children = [...modules];
      if (priority.length === 2 && byKey.has(priority[0]) && byKey.has(priority[1])) {
        const first = byKey.get(priority[0]);
        const second = byKey.get(priority[1]);
        const pair = {
          type: 'split',
          id: nextId('template-split'),
          axis: 'horizontal',
          weights: key === 'queue-session' ? [0.65, 0.35] : [0.58, 0.42],
          placement: { columnSpan: 12, rowSpan: 2 * ROW_DIVISIONS },
          children: [first, second],
        };
        children.splice(children.indexOf(first), 1);
        children.splice(children.indexOf(second), 1);
        children.unshift(pair);
      } else if (children[0]) {
        children[0].placement = { columnSpan: 8, rowSpan: 2 * ROW_DIVISIONS };
      }
      children.forEach((child, index) => {
        // Template spans were written in coarse bands; rows are fine, so a
        // one-band pane is six rows, not one 27px row.
        if (!child.placement && index > 0) child.placement = { columnSpan: 4, rowSpan: ROW_DIVISIONS };
      });
      return {
        type: 'root',
        id: graph.id,
        schemaVersion: graph.schemaVersion,
        children: [{ type: 'grid', id: bridge.canvasGridId(), columns: 12, rowPolicy: 'flow', children }],
      };
    }

    function applyTemplate(key) {
      const graph = bridge.snapshot().graph;
      const definition = TEMPLATE_DEFINITIONS.find((item) => item.key === key);
      const result = bridge.dispatch({ type: 'restoreGraph', graph: templateGraph(graph, key) }, `${definition?.label || 'Canvas'} template applied. Every placed pane was preserved.`);
      if (result?.ok) select(modulesIn(result.snapshot.graph)[0]?.id || '');
    }

    function selectGroup(groupId) {
      selectedGroupId = groupId || '';
      documentObject.querySelectorAll('[data-cw-studio-group-selected]').forEach((node) => node.removeAttribute('data-cw-studio-group-selected'));
      if (selectedGroupId) {
        [...documentObject.querySelectorAll('[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === selectedGroupId)?.setAttribute('data-cw-studio-group-selected', 'true');
      }
      render();
    }

    function moveGroup(groupId, after) {
      const graph = bridge.snapshot().graph;
      const group = findNode(graph, groupId);
      const parent = group ? parentOf(graph, group.id) : null;
      const index = parent?.children?.findIndex((child) => child.id === groupId) ?? -1;
      const target = after ? parent?.children?.[index + 1] : parent?.children?.[index - 1];
      if (!group || !target) {
        bridge.setStatus?.('That group has no neighbour in this direction.', 'warning');
        return;
      }
      bridge.dispatch({ type: after ? 'moveAfter' : 'moveBefore', sourceId: group.id, targetId: target.id }, `${groupLabel(group)} moved ${after ? 'later' : 'earlier'} as one unit.`);
    }

    function dissolveGroup(groupId) {
      const graph = JSON.parse(JSON.stringify(bridge.snapshot().graph));
      const group = findNode(graph, groupId);
      const parent = group ? parentOf(graph, group.id) : null;
      if (!group || !parent || !['grid', 'stack'].includes(parent.type) || !['split', 'stack'].includes(group.type)) {
        bridge.setStatus?.('This group cannot be dissolved at its current level.', 'warning');
        return;
      }
      const index = parent.children.findIndex((child) => child.id === groupId);
      const children = group.children.map((child) => {
        const clone = JSON.parse(JSON.stringify(child));
        delete clone.placement;
        return clone;
      });
      if (group.placement && children[0] && parent.type === 'grid') children[0].placement = JSON.parse(JSON.stringify(group.placement));
      parent.children.splice(index, 1, ...children);
      if (parent.type === 'stack' && parent.activeChildId === group.id) parent.activeChildId = children[0]?.id || parent.children[0]?.id || '';
      const result = bridge.dispatch({ type: 'restoreGraph', graph }, `${groupLabel(group)} dissolved. Every pane remains on the canvas.`);
      if (result?.ok) {
        selectedGroupId = '';
        select(children[0]?.id || '');
      }
    }

    function select(nodeId) {
      releaseGroupFor(nodeId);
      selectedId = nodeId || '';
      bridge.select?.(selectedId);
      paintSelection();
      render();
    }

    function closeModuleContextMenu({ restoreFocus = false } = {}) {
      const origin = moduleContextOrigin;
      moduleContextMenu?.remove();
      moduleContextMenu = null;
      moduleContextOrigin = null;
      delete documentObject.body.dataset.cwModuleMenu;
      if (restoreFocus && origin?.isConnected) origin.focus?.({ preventScroll: true });
    }

    function contextMenuButton(label, title, action, className = '') {
      const control = button(label, title, () => {
        closeModuleContextMenu();
        action();
      }, `cw-module-context-action${className ? ` ${className}` : ''}`);
      control.setAttribute('role', 'menuitem');
      control.tabIndex = -1;
      return control;
    }

    function bindFloatingMenuKeyboard(menu) {
      menu.addEventListener('keydown', (event) => {
        const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        const current = items.indexOf(documentObject.activeElement);
        let next = -1;
        if (event.key === 'ArrowDown') next = (current + 1 + items.length) % items.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'Tab') closeModuleContextMenu({ restoreFocus: true });
        else return;
        if (next >= 0) {
          event.preventDefault();
          items.forEach((item, index) => { item.tabIndex = index === next ? 0 : -1; });
          items[next]?.focus();
        }
      });
    }

    function showFloatingMenu(menu, clientX, clientY, origin, kind = 'pane') {
      bindFloatingMenuKeyboard(menu);
      moduleContextMenu = menu;
      moduleContextOrigin = origin || null;
      documentObject.body.dataset.cwModuleMenu = kind;
      documentObject.body.append(menu);

      const bounds = menu.getBoundingClientRect();
      const view = documentObject.defaultView;
      const gutter = 10;
      const left = Math.max(gutter, Math.min(Number(clientX) || gutter, Math.max(gutter, (view?.innerWidth || bounds.width + gutter * 2) - bounds.width - gutter)));
      const top = Math.max(gutter, Math.min(Number(clientY) || gutter, Math.max(gutter, (view?.innerHeight || bounds.height + gutter * 2) - bounds.height - gutter)));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      const firstItem = menu.querySelector('[role="menuitem"]:not(:disabled)');
      if (firstItem) firstItem.tabIndex = 0;
      documentObject.defaultView?.requestAnimationFrame?.(() => firstItem?.focus?.({ preventScroll: true }));
    }

    function openAddPaneMenu(clientX, clientY, origin) {
      const snapshot = bridge.snapshot();
      if (snapshot.mode !== 'edit') return;
      closeModuleContextMenu();
      const available = unplacedSpecs(snapshot.graph);
      const menu = element('div', 'cw-module-context-menu cw-add-pane-menu');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Add pane to canvas');

      const heading = element('div', 'cw-module-context-heading');
      heading.append(
        element('small', '', 'ADD TO CANVAS'),
        element('strong', '', available.length ? `${available.length} panes available` : 'Everything is placed'),
        element('span', 'cw-add-pane-destination', selectedModule(snapshot.graph) ? 'Adds to the selected canvas section; drag afterward to refine placement.' : 'Adds to the main canvas; drag afterward to refine placement.'),
      );
      menu.append(heading);

      const group = element('div', 'cw-module-context-group cw-add-pane-options');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Available panes');
      if (available.length) {
        available.forEach((spec) => {
          const required = (spec.jobs || []).some((job) => bridge.requiredJobs().includes(job));
          const control = contextMenuButton(spec.label, `Place ${spec.label} on the canvas`, () => placeModule(spec), 'cw-add-pane-option');
          control.replaceChildren(
            element('strong', '', spec.label),
            element('small', '', `${required ? 'Required' : 'Optional'} · ${(spec.jobs || []).map((job) => job.replace(/-/g, ' ')).join(' · ') || 'decorative'}${spec.instancePolicy === 'multiple' ? ' · repeatable' : ''}`),
          );
          group.append(control);
        });
      } else {
        group.append(contextMenuButton('Close', 'Close the Add Pane menu', () => {}));
      }
      menu.append(group);
      showFloatingMenu(menu, clientX, clientY, origin, 'add');
    }

    function openModuleContextMenu(pane, clientX, clientY, origin = pane) {
      const snapshot = bridge.snapshot();
      const graphNode = findNode(snapshot.graph, pane?.dataset?.cwNodeId);
      if (snapshot.mode !== 'edit' || graphNode?.type !== 'module') return;

      closeModuleContextMenu();
      const restoreToVisibleTrigger = origin?.classList?.contains('cw-pane-menu-button');
      select(graphNode.id);
      const livePane = [...documentObject.querySelectorAll('.cw-module[data-cw-node-id]')].find((candidate) => candidate.dataset.cwNodeId === graphNode.id) || pane;
      const focusOrigin = restoreToVisibleTrigger ? livePane.querySelector(':scope > .cw-pane-menu-button') || livePane : livePane;

      const graph = bridge.snapshot().graph;
      const node = findNode(graph, graphNode.id);
      const spec = bridge.specs()[node.moduleKey] || {};
      const parent = parentOf(graph, node.id);
      // Size, position and anchor belong to what is placed on the grid. For a
      // pane standing for its section that is the section: anchoring the pane
      // inside it anchored something nothing ever pushes.
      const layoutNode = placementOwnerOf(graph, node.id) || node;
      const placement = selectedGridPlacement(graph, layoutNode);
      const siblings = parent?.children || [];
      const siblingIndex = siblings.findIndex((candidate) => candidate.id === node.id);
      const counts = placedCounts(graph);
      const menu = element('div', 'cw-module-context-menu');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `${moduleLabel(node)} pane menu`);
      menu.dataset.cwModuleContext = node.id;

      const heading = element('div', 'cw-module-context-heading');
      heading.append(
        element('small', '', 'SELECTED PANE'),
        element('strong', '', moduleLabel(node)),
      );
      menu.append(heading);

      const addGroup = (label, controls) => {
        const available = controls.filter(Boolean);
        if (!available.length) return;
        const group = element('div', 'cw-module-context-group');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        group.append(element('span', 'cw-module-context-label', label), ...available);
        menu.append(group);
      };
      const enabled = (control, value) => {
        if (control) control.disabled = !value;
        return control;
      };

      addGroup('Arrange', [
        enabled(contextMenuButton('Move relative to…', 'Choose another pane and then choose its relationship', () => beginMove(node.id)), modulesIn(graph).length > 1),
        enabled(contextMenuButton('Earlier', 'Move this pane one semantic position earlier', () => moveSelected(false)), siblingIndex > 0),
        enabled(contextMenuButton('Later', 'Move this pane one semantic position later', () => moveSelected(true)), siblingIndex >= 0 && siblingIndex < siblings.length - 1),
        ['split', 'stack'].includes(parent?.type)
          ? contextMenuButton(`Remove from ${parent.type}`, `Dissolve this ${parent.type} relationship while keeping both panes`, recombineSelected)
          : null,
      ]);

      if (placement) {
        const axes = new Set((bridge.shapes()[node.shape] || {}).resizeAxes || ['inline', 'block']);
        addGroup('Size', [
          axes.has('inline') ? enabled(contextMenuButton('Narrower', 'Reduce this pane by one grid column', () => setPlacement(layoutNode.id, placement.columnSpan - 1, placement.rowSpan)), placement.columnSpan > 1) : null,
          axes.has('inline') ? enabled(contextMenuButton('Wider', 'Increase this pane by one grid column', () => setPlacement(layoutNode.id, Math.min(placement.parent.columns, placement.columnSpan + 1), placement.rowSpan)), placement.columnSpan < placement.parent.columns) : null,
          axes.has('block') ? enabled(contextMenuButton('Shorter', 'Reduce this pane by one grid row', () => setPlacement(layoutNode.id, placement.columnSpan, placement.rowSpan - 1)), placement.rowSpan > 1) : null,
          axes.has('block') ? enabled(contextMenuButton('Taller', 'Increase this pane by one grid row', () => setPlacement(layoutNode.id, placement.columnSpan, placement.rowSpan + 1)), placement.rowSpan < 144) : null,
          contextMenuButton('Theme size', 'Return this pane to the theme default size', () => resetPlacement(layoutNode.id)),
        ]);

        // Dragging is not the only way to say where something goes. A pane
        // without an explicit coordinate is flowing, so the first nudge both
        // moves it and pins it; Theme size above lets it flow again.
        const columnStart = placement.columnStart || 1;
        const rowStart = placement.rowStart || 1;
        const nudge = (columnDelta, rowDelta, direction) => setPlacement(
          layoutNode.id,
          placement.columnSpan,
          placement.rowSpan,
          `${moduleLabel(node)} moved ${direction}.`,
          { columnStart: columnStart + columnDelta, rowStart: rowStart + rowDelta },
        );
        addGroup('Position', [
          enabled(contextMenuButton('Left', 'Move this pane one grid column left', () => nudge(-1, 0, 'left')), columnStart > 1),
          enabled(contextMenuButton('Right', 'Move this pane one grid column right', () => nudge(1, 0, 'right')), (columnStart + placement.columnSpan - 1) < placement.parent.columns),
          enabled(contextMenuButton('Up', 'Move this pane one grid row up', () => nudge(0, -1, 'up')), rowStart > 1),
          enabled(contextMenuButton('Down', 'Move this pane one grid row down', () => nudge(0, 1, 'down')), (rowStart + placement.rowSpan - 1) < MAX_ROWS),
        ]);

        // Anchoring says which pane is not the one that should give when
        // something is dragged into it. The state a pane is already in is
        // shown by disabling its own button, so the group reads as a setting
        // rather than four things that all look pressable.
        const currentPin = pinOf(layoutNode);
        const pinTitles = {
          none: 'Let this pane be moved and resized by what is dragged at it',
          firm: 'Keep this pane exactly where and as it is. Anything dragged into it gives way instead',
        };
        addGroup('Anchor', PIN_CHOICES.map((state) => {
          const control = contextMenuButton(PIN_LABELS[state], pinTitles[state], () => setPin(layoutNode.id, state));
          control.setAttribute('aria-pressed', String(currentPin === state));
          control.dataset.cwPinOption = state;
          return enabled(control, currentPin !== state);
        }));
      }

      const canDuplicate = spec.instancePolicy === 'multiple'
        && (counts.get(node.moduleKey) || 0) < Math.max(1, Number(spec.maxInstances) || 4);
      addGroup('Module', [
        contextMenuButton('Reset pane', 'Restore this module shape and configuration', resetSelectedModule),
        canDuplicate ? contextMenuButton('Duplicate pane', 'Add another independent instance of this module', duplicateSelected) : null,
        (spec.shapes || []).includes('ambient') && parent?.type !== 'overlay'
          ? contextMenuButton('Make ambient', 'Place this module in a contained ambient overlay', assignSelectedAmbient)
          : null,
        enabled(contextMenuButton('Return to tray', 'Remove this pane without deleting its module type', removeSelected, 'cw-module-context-danger'), modulesIn(graph).length > 1),
      ]);

      showFloatingMenu(menu, clientX, clientY, focusOrigin, 'pane');
    }

    // Pointer-down is latency-sensitive. The rail is graph-derived and does
    // not need to be rebuilt before a drag can begin; the normal session sync
    // refreshes it after commit or cancellation.
    // Choosing a pane after choosing a group means the pane now. Group selection
    // used to survive every later click, so a group's corners stayed up over a
    // pane the person had since picked, and the only way out was the rail.
    function releaseGroupFor(nodeId) {
      if (!selectedGroupId || nodeId === selectedGroupId) return;
      selectedGroupId = '';
      documentObject.querySelectorAll('[data-cw-studio-group-selected]').forEach((node) => node.removeAttribute('data-cw-studio-group-selected'));
    }

    function selectForPointer(nodeId, moduleElements = null) {
      releaseGroupFor(nodeId);
      selectedId = nodeId || '';
      (moduleElements || documentObject.querySelectorAll('.cw-module[data-cw-node-id]')).forEach((node) => {
        const selected = Boolean(selectedId) && node.dataset.cwNodeId === selectedId;
        node.toggleAttribute('data-cw-studio-selected', selected);
        node.toggleAttribute('aria-current', selected);
      });
    }

    function paintStacks() {
      const snapshot = bridge.snapshot();
      const liveStackIds = new Set();
      stacksIn(snapshot.graph).forEach((stack) => {
        liveStackIds.add(stack.id);
        const surface = [...documentObject.querySelectorAll('.cw-stack[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === stack.id);
        if (!surface) return;
        const activeChildId = snapshot.mode === 'edit'
          ? stack.activeChildId
          : stackViewState.get(stack.id) || stack.activeChildId;
        surface.dataset.activeChildId = activeChildId;
        stack.children.forEach((child) => {
          const childSurface = [...surface.children].find((node) => node.dataset?.cwNodeId === child.id);
          if (childSurface) childSurface.hidden = child.id !== activeChildId;
        });
        let switcher = surface.querySelector(':scope > .cw-stack-switcher');
        if (!switcher) {
          switcher = element('div', 'cw-stack-switcher');
          switcher.setAttribute('role', 'tablist');
          switcher.setAttribute('aria-label', 'Stacked panes');
          surface.prepend(switcher);
        }
        switcher.replaceChildren();
        stack.children.forEach((child, index) => {
          const tab = button(moduleLabel(child), `Show ${moduleLabel(child)} in this stack`, () => activateStackChild(stack, child.id), 'cw-stack-tab');
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-selected', String(child.id === activeChildId));
          tab.tabIndex = child.id === activeChildId ? 0 : -1;
          tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0
              : event.key === 'End' ? stack.children.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + stack.children.length) % stack.children.length;
            activateStackChild(stack, stack.children[nextIndex].id);
            surface.querySelectorAll(':scope > .cw-stack-switcher > .cw-stack-tab')[nextIndex]?.focus();
          });
          switcher.append(tab);
        });
      });
      [...stackViewState.keys()].forEach((id) => { if (!liveStackIds.has(id)) stackViewState.delete(id); });
    }

    function paintSelection() {
      const snapshot = bridge.snapshot();
      const editing = snapshot.mode === 'edit';
      paintStacks();
      documentObject.querySelectorAll('.cw-pane-actions, .cw-inline-target-menu').forEach((node) => node.remove());
      if (selectedGroupId && !findNode(snapshot.graph, selectedGroupId)) selectedGroupId = '';
      // Selecting the pane a section stands for selects the section too, so its
      // corners come up where the pane's would have been.
      const selectedOwnerId = editing && selectedId ? (placementOwnerOf(snapshot.graph, selectedId)?.id || '') : '';
      documentObject.querySelectorAll('[data-cw-node-id]').forEach((node) => {
        node.toggleAttribute('data-cw-studio-group-selected', editing && node.dataset.cwNodeId === selectedGroupId && Boolean(selectedGroupId));
        const selectable = node.classList?.contains('cw-module');
        const selected = Boolean(selectedId) && (node.dataset.cwNodeId === selectedId || node.dataset.cwNodeId === selectedOwnerId);
        node.toggleAttribute('data-cw-studio-selected', selected);
        if (selectable) {
          node.tabIndex = editing ? 0 : -1;
          node.setAttribute('role', 'group');
          node.setAttribute('aria-label', `${bridge.specs()[node.dataset.cwModuleKey]?.label || node.dataset.cwModuleKey || 'Canvas'} pane${selected ? ', selected' : ''}`);
          node.toggleAttribute('aria-current', selected);
          const spec = bridge.specs()[node.dataset.cwModuleKey] || {};
          node.dataset.cwRootPolicy = spec.rootPolicy || 'independent';
          if (spec.ownerKey) node.dataset.cwRootOwner = spec.ownerKey;
          else if (spec.ownerSelector) node.dataset.cwRootOwner = spec.ownerSelector;
          else delete node.dataset.cwRootOwner;
          // A pane that stands for its section hands its grip and corners to
          // the section, which draws them in the same place.
          const owner = editing ? layoutOwnerOf(snapshot.graph, node.dataset.cwNodeId) : null;
          let drag = node.querySelector(':scope > .cw-pane-drag-handle');
          if (editing && !drag && !owner) {
            drag = button('Move', 'Drag this pane, or press to choose a destination without dragging', () => {
              if (Date.now() >= suppressMoveClickUntil) beginMove(node.dataset.cwNodeId);
            }, 'cw-pane-drag-handle');
            drag.dataset.cwDragNode = node.dataset.cwNodeId;
            drag.setAttribute('aria-label', `Move ${bridge.specs()[node.dataset.cwModuleKey]?.label || node.dataset.cwModuleKey} pane`);
            node.prepend(drag);
          }
          if (!editing || owner) {
            drag?.remove();
            drag = null;
          }

          const graphNode = findNode(snapshot.graph, node.dataset.cwNodeId);
          const placement = graphNode && !owner ? selectedGridPlacement(snapshot.graph, graphNode) : null;
          let resize = node.querySelector(':scope > .cw-pane-resize-handle[data-cw-resize-corner="end"]');
          let resizeStart = node.querySelector(':scope > .cw-pane-resize-handle[data-cw-resize-corner="start"]');
          const paneLabel = bridge.specs()[node.dataset.cwModuleKey]?.label || node.dataset.cwModuleKey;
          if (editing && placement && !resize) {
            resize = resizeHandle('end', node.dataset.cwNodeId, paneLabel);
            node.prepend(resize);
          }
          if (editing && placement && !resizeStart) {
            resizeStart = resizeHandle('start', node.dataset.cwNodeId, paneLabel);
            node.prepend(resizeStart);
          }
          if (editing && placement && drag) node.prepend(drag);
          if (!editing || !placement) {
            resize?.remove();
            resizeStart?.remove();
            resize = null;
            resizeStart = null;
          }
          node.toggleAttribute('data-cw-pick-target', editing && Boolean(pickedSourceId) && node.dataset.cwNodeId !== pickedSourceId);

          if (editing) {
            let paneMenuButton = null;
            paneMenuButton = button('Pane menu', `Open all actions for ${moduleLabel(graphNode)}`, () => {
              const rect = paneMenuButton.getBoundingClientRect();
              openModuleContextMenu(node, rect.right - 8, rect.bottom + 6, paneMenuButton);
            }, 'cw-pane-actions cw-pane-menu-button');
            paneMenuButton.setAttribute('aria-haspopup', 'menu');
            paneMenuButton.setAttribute('aria-label', `Open actions for ${moduleLabel(graphNode)}`);
            node.prepend(paneMenuButton);
            if (resize) node.prepend(resize);
            if (drag) node.prepend(drag);
          }
        }
      });

      // A split or stack can itself be a direct child of the canvas grid. It
      // owns a real grid footprint just like a module, so it gets the same
      // corner affordance instead of forcing the person back to the rail.
      documentObject.querySelectorAll('.cw-grid > .cw-node[data-cw-node-id]:not(.cw-module):not(.cw-overlay)').forEach((surface) => {
        const graphNode = findNode(snapshot.graph, surface.dataset.cwNodeId);
        const placement = graphNode ? selectedGridPlacement(snapshot.graph, graphNode) : null;
        let resize = surface.querySelector(':scope > .cw-pane-resize-handle[data-cw-resize-corner="end"]');
        let resizeStart = surface.querySelector(':scope > .cw-pane-resize-handle[data-cw-resize-corner="start"]');
        if (editing && placement && !resize) surface.prepend(resize = resizeHandle('end', graphNode.id, moduleLabel(graphNode), 'canvas section'));
        if (editing && placement && !resizeStart) surface.prepend(resizeStart = resizeHandle('start', graphNode.id, moduleLabel(graphNode), 'canvas section'));
        // A section on a grid can be put anywhere on it, the same as a pane.
        // It had corners and no grip, so the only way to move one was the
        // rail's Earlier and Later -- and a nested grid such as the Stage is
        // not in the rail's group list at all.
        // A stack carries its grip at the end of its tab strip, the one place
        // on it that no pane inside draws anything; anything else keeps it on
        // its own top edge.
        const switcher = surface.querySelector(':scope > .cw-stack-switcher');
        let move = surface.querySelector(':scope > .cw-pane-drag-handle, :scope > .cw-stack-switcher > .cw-pane-drag-handle');
        if (editing && placement && !move) {
          const filled = Boolean(soleFiller(graphNode));
          move = button(filled ? 'Move' : 'Move group', `Drag this ${filled ? 'pane' : 'group'} anywhere on the canvas`, () => {
            if (Date.now() >= suppressMoveClickUntil) selectSection(graphNode.id);
          }, 'cw-pane-drag-handle cw-section-drag-handle');
          move.dataset.cwDragNode = graphNode.id;
          move.setAttribute('aria-label', `Move ${moduleLabel(graphNode)}`);
        }
        if (move && editing && placement) {
          if (switcher && move.parentElement !== switcher) switcher.append(move);
          else if (!switcher && move.parentElement !== surface) surface.prepend(move);
        }
        if (move) move.dataset.cwSectionFilled = String(Boolean(soleFiller(graphNode)));
        if (!editing || !placement) {
          resize?.remove();
          resizeStart?.remove();
          move?.remove();
        }
      });

      if (editing && pickedSourceId && keyboardTargetId && keyboardTargetId !== pickedSourceId) {
        const targetPane = [...documentObject.querySelectorAll('.cw-module[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === keyboardTargetId);
        if (targetPane) {
          const menu = element('div', 'cw-inline-target-menu');
          menu.setAttribute('role', 'toolbar');
          menu.setAttribute('aria-label', `Place ${moduleLabel(findNode(snapshot.graph, pickedSourceId))} relative to ${moduleLabel(findNode(snapshot.graph, keyboardTargetId))}`);
          const applyInline = (kind) => {
            const applied = applySelectedIntent(kind, keyboardTargetId, 'keyboard');
            if (!applied) return;
            pickedSourceId = '';
            keyboardTargetId = '';
            paintSelection();
            render();
          };
          [
            ['Before', 'move-before'], ['After', 'move-after'],
            ['Left', 'split-before-horizontal'], ['Right', 'split-after-horizontal'],
            ['Above', 'split-before-vertical'], ['Below', 'split-after-vertical'],
            ['Stack', 'stack'],
          ].forEach(([label, kind]) => menu.append(button(label, `${label} this pane`, () => applyInline(kind), 'cw-inline-target-action')));
          menu.append(button('Cancel', 'Cancel moving this pane', cancelMove, 'cw-inline-target-action cw-inline-target-cancel'));
          targetPane.prepend(menu);
        }
      }
    }

    function clearDropPreview() {
      documentObject.querySelectorAll('[data-cw-studio-drop]').forEach((node) => node.removeAttribute('data-cw-studio-drop'));
      documentObject.querySelectorAll('[data-cw-studio-source]').forEach((node) => node.removeAttribute('data-cw-studio-source'));
      documentObject.querySelectorAll('[data-cw-resize-preview]').forEach((node) => {
        node.removeAttribute('data-cw-resize-preview');
        node.style.removeProperty('--cw-preview-block-size');
      });
      documentObject.querySelectorAll('[data-cw-resize-live]').forEach((node) => {
        node.removeAttribute('data-cw-resize-live');
        ['--cw-preview-inline-size', '--cw-preview-block-size', '--cw-preview-x', '--cw-preview-y'].forEach((property) => node.style.removeProperty(property));
      });
      documentObject.querySelectorAll('.cw-resize-slot').forEach((node) => node.remove());
      pointerInteraction?.preview?.remove?.();
      pointerInteraction?.ghost?.remove();
      delete documentObject.body.dataset.cwStudioLivePreview;
      delete documentObject.body.dataset.cwStudioPreviewFallback;
    }

    // Two corners, because one is only half a resize. The bottom-right handle
    // pushes the far edge out and leaves the origin where it is; the top-left
    // handle pins the far edge and pulls the origin back, which is the only way
    // to grow a pane leftwards or upwards without first moving it.
    function resizeHandle(corner, nodeId, label, kind = 'grid pane') {
      const title = corner === 'start'
        ? `Drag or use arrow keys to move this ${kind}'s top-left corner`
        : `Drag or use arrow keys to move this ${kind}'s bottom-right corner`;
      const control = button('Resize', title, () => {}, 'cw-pane-resize-handle');
      control.dataset.cwResizeNode = nodeId;
      control.dataset.cwResizeCorner = corner;
      control.setAttribute('aria-label', `Resize ${label} from the ${corner === 'start' ? 'top-left' : 'bottom-right'} corner`);
      return control;
    }

    function prepareResizeVisuals(interaction) {
      if (!interaction || interaction.resizeVisuals) return;
      const candidates = [...documentObject.querySelectorAll('.cw-module > [data-cw-product-root]')]
        .map((root) => ({ root, pane: root.parentElement }))
        .filter(({ pane }) => pane?.classList?.contains('cw-module'));
      const measurements = candidates.map(({ root, pane }) => ({
        root,
        pane,
        rootRect: root.getBoundingClientRect(),
        paneRect: pane.getBoundingClientRect(),
      }));
      interaction.resizeVisuals = measurements.map(({ root, pane, rootRect, paneRect }) => ({
        root,
        pane,
        paneWidth: Math.max(1, paneRect.width),
        paneHeight: Math.max(1, paneRect.height),
      }));
      measurements.forEach(({ root, rootRect, paneRect }) => {
        root.dataset.cwResizeVisual = 'true';
        root.style.setProperty('--cw-resize-source-width', `${Math.max(1, rootRect.width)}px`);
        root.style.setProperty('--cw-resize-source-height', `${Math.max(1, rootRect.height)}px`);
        root.style.setProperty('--cw-resize-source-left', `${Math.max(0, rootRect.left - paneRect.left)}px`);
        root.style.setProperty('--cw-resize-source-top', `${Math.max(0, rootRect.top - paneRect.top)}px`);
        root.style.setProperty('--cw-resize-scale-x', '1');
        root.style.setProperty('--cw-resize-scale-y', '1');
      });
    }

    function updateResizeVisuals(interaction) {
      if (!interaction?.resizeVisuals?.length) return;
      // Read every changed pane in one batch, then write compositor-only scale
      // variables. The product subtree keeps its original layout and animation
      // state while the canvas geometry reacts at pointer cadence.
      const measurements = interaction.resizeVisuals.map((visual) => ({
        visual,
        rect: visual.pane.isConnected ? visual.pane.getBoundingClientRect() : null,
      }));
      measurements.forEach(({ visual, rect }) => {
        if (!rect || !visual.root.isConnected) return;
        visual.root.style.setProperty('--cw-resize-scale-x', String(Math.max(0.05, rect.width / visual.paneWidth)));
        visual.root.style.setProperty('--cw-resize-scale-y', String(Math.max(0.05, rect.height / visual.paneHeight)));
      });
    }

    function restoreResizeVisuals(interaction) {
      interaction?.resizeVisuals?.forEach(({ root }) => {
        if (!root) return;
        root.removeAttribute('data-cw-resize-visual');
        ['--cw-resize-source-width', '--cw-resize-source-height', '--cw-resize-source-left', '--cw-resize-source-top', '--cw-resize-scale-x', '--cw-resize-scale-y']
          .forEach((property) => root.style.removeProperty(property));
      });
      if (interaction) interaction.resizeVisuals = null;
    }

    function animateReflows(parents, mutate) {
      const containers = [...new Set((parents || []).filter(Boolean))];
      const children = containers.flatMap((parent) => [...parent.children].filter((node) => node.classList?.contains('cw-node')));
      const motionAllowed = documentObject.body.dataset.motion !== 'off'
        && documentObject.body.dataset.performance !== 'conserve'
        && documentObject.body.dataset.cwStudioDragConserve !== 'true'
        && documentObject.body.dataset.cwStudioDense !== 'true'
        && !pointerInteraction
        && children.length <= 4;
      if (!motionAllowed) {
        mutate();
        return;
      }
      children.forEach((node) => node.getAnimations?.().filter((animation) => animation.id === 'cw-live-reflow').forEach((animation) => animation.cancel()));
      const before = new Map(children.map((node) => [node, node.getBoundingClientRect()]));
      mutate();
      children.forEach((node) => {
        const first = before.get(node);
        const last = node.getBoundingClientRect();
        const x = first.left - last.left;
        const y = first.top - last.top;
        if ((!x && !y) || typeof node.animate !== 'function') return;
        const animation = node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
          duration: 150,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
        animation.id = 'cw-live-reflow';
      });
    }

    function animateReflow(parent, mutate) {
      animateReflows([parent], mutate);
    }

    function positionLiftedPane(event, interaction) {
      const movingSurface = interaction?.dragProxy;
      if (!interaction?.lifted || !movingSurface) return;
      const left = Math.round(event.clientX - interaction.grabOffsetX);
      const top = Math.round(event.clientY - interaction.grabOffsetY);
      if (left === interaction.visualLeft && top === interaction.visualTop) return;
      interaction.visualLeft = left;
      interaction.visualTop = top;
      // A fixed layer moved with transform stays on the compositor. Updating
      // left/top here forced layout and paint for the full product module on
      // every high-frequency mouse sample.
      movingSurface.style.transform = `translate3d(${left}px, ${top}px, 0) scale(.985) rotate(.25deg)`;
    }

    function recordDragCost(interaction, startedAt) {
      const now = documentObject.defaultView?.performance?.now?.bind(documentObject.defaultView.performance);
      if (!now || !Number.isFinite(startedAt)) return;
      const duration = now() - startedAt;
      interaction.slowFrames = duration > 20 ? (interaction.slowFrames || 0) + 1 : Math.max(0, (interaction.slowFrames || 0) - 1);
      if (interaction.slowFrames < 2 || interaction.conserve) return;
      interaction.conserve = true;
      documentObject.body.dataset.cwStudioDragConserve = 'true';
      bridge.setStatus?.('Canvas Studio reduced drag detail to keep this gesture responsive. Placement remains exact.', 'warning');
    }

    function liftPane(event, interaction) {
      if (interaction.lifted || !interaction.sourceElement?.isConnected) return interaction.lifted;
      const source = interaction.sourceElement;
      const parent = source.parentElement;
      const rect = source.getBoundingClientRect();
      if (!parent || rect.width < 1 || rect.height < 1) return false;
      const placeholder = element('div', 'cw-node cw-drag-placeholder');
      placeholder.dataset.cwNodeId = interaction.sourceId;
      placeholder.dataset.cwModuleKey = source.dataset.cwModuleKey || '';
      placeholder.setAttribute('aria-hidden', 'true');
      if (source.dataset.cwPlaced === 'true') placeholder.dataset.cwPlaced = 'true';
      if (source.dataset.cwPositioned === 'true') placeholder.dataset.cwPositioned = 'true';
      ['--cw-column-start', '--cw-row-start', '--cw-column-span', '--cw-row-span'].forEach((property) => {
        const value = source.style.getPropertyValue(property);
        if (value) placeholder.style.setProperty(property, value);
      });
      placeholder.style.setProperty('--cw-placeholder-height', `${Math.round(rect.height)}px`);
      parent.insertBefore(placeholder, source);
      // Where the slot started. When the pointer moves onto somewhere a pane
      // cannot go, the slot comes back here, because here is where release
      // will put the pane -- so the preview says what release will do.
      interaction.placeholderHome = {
        parent,
        placed: placeholder.dataset.cwPlaced || null,
        positioned: placeholder.dataset.cwPositioned || null,
        properties: ['--cw-column-start', '--cw-row-start', '--cw-column-span', '--cw-row-span']
          .map((property) => [property, placeholder.style.getPropertyValue(property)]),
      };
      interaction.homeParent = parent;
      interaction.homeNextSibling = source.nextElementSibling;
      interaction.placeholder = placeholder;
      const moduleElements = interaction.moduleElements || [...documentObject.querySelectorAll('.cw-module[data-cw-node-id]')];
      interaction.moduleCount = moduleElements.length;
      interaction.targetPanes = moduleElements.filter((pane) => pane !== source);
      interaction.lifted = true;
      // The proxy used to be capped at 520x360, so anything bigger was
      // dragged as a shrunken stand-in and what you picked up was not what you
      // put down. It carries no product subtree -- it is an empty div with a
      // label -- so it costs nothing to draw it at the pane's real on-screen
      // size. The viewport is the only ceiling, and it is there so a pane
      // larger than the window cannot swallow the screen.
      const view = documentObject.defaultView;
      const width = Math.min(rect.width, Math.max(120, view?.innerWidth || rect.width));
      const height = Math.min(rect.height, Math.max(120, view?.innerHeight || rect.height));
      // With the proxy at true size this mapping is the identity, so the pane
      // stays under the exact point it was grabbed by.
      interaction.grabOffsetX = Math.max(18, Math.min(width - 18, ((event.clientX - rect.left) / Math.max(1, rect.width)) * width));
      interaction.grabOffsetY = Math.max(18, Math.min(height - 18, ((event.clientY - rect.top) / Math.max(1, rect.height)) * height));
      const proxy = element('div', 'cw-module cw-drag-proxy');
      proxy.dataset.cwStudioLifted = 'true';
      proxy.dataset.cwModuleKey = source.dataset.cwModuleKey || '';
      proxy.dataset.cwDragLabel = interaction.sourceLabel || moduleLabel(findNode(interaction.graph, interaction.sourceId));
      proxy.setAttribute('aria-hidden', 'true');
      proxy.style.pointerEvents = 'none';
      proxy.style.setProperty('--cw-drag-width', `${Math.round(width)}px`);
      proxy.style.setProperty('--cw-drag-height', `${Math.round(height)}px`);
      documentObject.body.append(proxy);
      interaction.dragProxy = proxy;
      interaction.sourceInlineDisplay = source.style.display;
      source.dataset.cwStudioSource = 'true';
      // The real product subtree stays mounted but leaves layout and paint.
      // Only the tiny proxy is promoted and transformed during the gesture.
      source.style.display = 'none';
      positionLiftedPane(event, interaction);
      documentObject.body.dataset.cwStudioLifted = 'true';
      if (interaction.moduleCount > 4) documentObject.body.dataset.cwStudioDense = 'true';
      return true;
    }

    function restoreLiveReflow(interaction, animate = true) {
      if (!interaction?.lifted || !interaction.homeParent || !interaction.sourceElement) return;
      restoreGridPreview(interaction);
      const restore = () => {
        const reference = interaction.homeNextSibling?.parentElement === interaction.homeParent ? interaction.homeNextSibling : null;
        interaction.sourceElement.removeAttribute('data-cw-studio-source');
        interaction.sourceElement.style.display = interaction.sourceInlineDisplay || '';
        interaction.homeParent.insertBefore(interaction.sourceElement, reference);
        interaction.dragProxy?.remove();
        interaction.dragProxy = null;
        interaction.placeholder?.remove();
      };
      const currentParent = interaction.placeholder?.parentElement;
      if (animate) animateReflows([interaction.homeParent, currentParent], restore);
      else restore();
      interaction.liveReflow = false;
      interaction.lifted = false;
      delete documentObject.body.dataset.cwStudioLivePreview;
      delete documentObject.body.dataset.cwStudioLifted;
      delete documentObject.body.dataset.cwStudioDragConserve;
      delete documentObject.body.dataset.cwStudioDense;
    }

    // One column track plus its gutter, and one row plus its gutter, in layout
    // pixels. This is the conversion between the grid's cell coordinates and
    // the distance a pane has to travel to reach them.
    // Padding and border on each side of a grid, in layout pixels: where its
    // tracks actually start.
    function gridContentBox(computed) {
      const read = (property) => Number.parseFloat(computed?.[property]) || 0;
      return {
        left: read('paddingLeft') + read('borderLeftWidth'),
        right: read('paddingRight') + read('borderRightWidth'),
        top: read('paddingTop') + read('borderTopWidth'),
      };
    }

    // Where the player bar is, as a row line of the grid above it. Outside
    // Composition Mode the player is fixed at the bottom of the window and the
    // composition scrolls above it, so a pane may sit wholly above that line or
    // wholly below it (room past the window, reached by scrolling) -- but a
    // pane across it is behind the player at rest. That is what a pane
    // "stretched to the player" turned into once Composition Mode was left,
    // and a pane stopped just short of it was a whole row short. The line is
    // measured from the player dock itself, so it is wherever the theme puts
    // the player; a grid with no player docked below it has no line.
    function heroFoldFor(gridElement) {
      if (!gridElement || gridElement.parentElement?.closest?.('.cw-grid')) return null;
      const dock = gridElement.parentElement?.querySelector?.(':scope > .cw-dock[data-cw-anchored=".player"]');
      if (!dock) return null;
      const id = gridElement.dataset?.cwNodeId;
      const grid = id ? findNode(bridge.snapshot().graph, id) : null;
      const pitch = gridPitch(gridElement, grid?.columns || DEFAULT_COLUMNS);
      if (!pitch?.rowPitch) return null;
      const gridRect = gridElement.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      if (dockRect.top <= gridRect.top) return null;
      const zoom = gridElement.offsetWidth > 0 ? gridRect.width / gridElement.offsetWidth : 1;
      const box = gridContentBox(documentObject.defaultView?.getComputedStyle?.(gridElement));
      const line = Math.round(((dockRect.top - gridRect.top) / zoom - box.top) / pitch.rowPitch) + 1;
      return line > 1 ? { gridId: id, line, top: dockRect.top } : null;
    }

    function gridPitch(gridElement, columns) {
      const computed = documentObject.defaultView?.getComputedStyle?.(gridElement);
      const count = Math.max(1, Math.round(Number(columns)) || DEFAULT_COLUMNS);
      const columnGap = Number.parseFloat(computed?.columnGap) || 0;
      const rowGap = Number.parseFloat(computed?.rowGap) || 0;
      // grid-auto-rows is the track size the browser resolved. The custom
      // property behind it may still be an unresolved calc() -- it is in every
      // ported theme, since the row base is stated as a length expression --
      // and parseFloat of a calc() is NaN, which would quietly become the
      // default below and put every pane on the wrong row.
      const rowUnit = Number.parseFloat(computed?.gridAutoRows)
        || Number.parseFloat(computed?.getPropertyValue('--cw-grid-row-size'))
        || 26.333;
      // Tracks are laid out inside the content box. offsetWidth includes the
      // grid's own padding -- --cw-grid-inset, 8px in every ported theme -- and
      // dividing that by 96 made every column a sixth of a pixel too wide,
      // which by the right-hand side is a whole column: a pane aimed exactly at
      // the utility column landed one column short and shaved the Stage.
      const box = gridContentBox(computed);
      const layoutWidth = (gridElement.offsetWidth || 0) - box.left - box.right;
      const trackWidth = (layoutWidth - (columnGap * (count - 1))) / count;
      if (!(trackWidth > 0)) return null;
      // The grid is gapless and the gutter is drawn by pane margins, so a
      // pane's box starts half a gutter inside its cell. Measured origins
      // carry that inset and computed targets do not, so it has to come out
      // of one of them or every pane slides half a gutter as it moves.
      const inset = (Number.parseFloat(computed?.getPropertyValue('--cw-grid-gutter')) || 0) / 2;
      return { columnPitch: trackWidth + columnGap, rowPitch: rowUnit + rowGap, inset: inset + box.left, insetY: inset + box.top };
    }

    function rememberGridPreview(interaction, gridElement, columns) {
      if (interaction.gridPreview?.gridElement === gridElement) return interaction.gridPreview;
      restoreGridPreview(interaction);
      const originals = new Map();
      // Where every pane sits before the gesture starts, in the grid's own
      // layout coordinates. Measured once, here, so that a shift is always
      // computed against where the pane actually began rather than against
      // where the last frame put it -- which is how offsets compound and panes
      // drift off the canvas.
      const gridRect = gridElement.getBoundingClientRect();
      const layoutWidth = gridElement.offsetWidth || gridRect.width || 1;
      const zoom = gridRect.width > 0 ? gridRect.width / layoutWidth : 1;
      [...gridElement.children].filter((node) => node.classList?.contains('cw-node') && node !== interaction.sourceElement).forEach((node) => {
        const rect = node.getBoundingClientRect();
        originals.set(node, {
          placed: node.getAttribute('data-cw-placed'),
          positioned: node.getAttribute('data-cw-positioned'),
          columnStart: node.style.getPropertyValue('--cw-column-start'),
          rowStart: node.style.getPropertyValue('--cw-row-start'),
          columnSpan: node.style.getPropertyValue('--cw-column-span'),
          rowSpan: node.style.getPropertyValue('--cw-row-span'),
          originX: (rect.left - gridRect.left) / zoom,
          originY: (rect.top - gridRect.top) / zoom,
        });
      });
      interaction.gridPreview = { gridElement, originals, pitch: gridPitch(gridElement, columns) };
      return interaction.gridPreview;
    }

    // Move a pane without moving it. A grid placement is a layout change, so
    // every neighbour rewritten mid-drag costs a reflow and lands instantly;
    // a transform is compositor work that the stylesheet can transition, which
    // is the difference between panes teleporting and panes sliding.
    // A neighbour in a preview either slides (same size) or takes its new
    // size outright. A transform cannot show a pane getting narrower, and one
    // that got narrower in an earlier frame has to get its own size back when
    // the pointer moves on.
    function previewNeighbour(surface, placement, preview) {
      const origin = preview?.originals?.get(surface);
      if (!surface || !origin || !placement) return;
      const sameSize = String(placement.columnSpan) === origin.columnSpan && String(placement.rowSpan) === origin.rowSpan;
      if (!sameSize) {
        shiftNode(surface, 0, 0);
        applyDomPlacement(surface, placement);
        return;
      }
      [['--cw-column-start', origin.columnStart], ['--cw-row-start', origin.rowStart], ['--cw-column-span', origin.columnSpan], ['--cw-row-span', origin.rowSpan]].forEach(([property, value]) => {
        if (value) surface.style.setProperty(property, value); else surface.style.removeProperty(property);
      });
      if (!preview.pitch) return;
      // A pane with coordinates slides by exactly the cells it moves. Working
      // it out from its measured position instead picked up whatever margin
      // a theme gives it -- the archive host's top panes sit 4px higher than
      // the gutter says -- and every unmoved pane twitched by that much.
      const fromColumn = Number(origin.columnStart);
      const fromRow = Number(origin.rowStart);
      if (Number.isInteger(fromColumn) && fromColumn > 0 && Number.isInteger(fromRow) && fromRow > 0) {
        shiftNode(surface, (placement.columnStart - fromColumn) * preview.pitch.columnPitch, (placement.rowStart - fromRow) * preview.pitch.rowPitch);
        return;
      }
      shiftNode(
        surface,
        ((placement.columnStart - 1) * preview.pitch.columnPitch) - (origin.originX - preview.pitch.inset),
        ((placement.rowStart - 1) * preview.pitch.rowPitch) - (origin.originY - (preview.pitch.insetY ?? preview.pitch.inset)),
      );
    }

    function shiftNode(node, x, y) {
      if (!node) return;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
        node.style.removeProperty('--cw-shift-x');
        node.style.removeProperty('--cw-shift-y');
        delete node.dataset.cwShifted;
        return;
      }
      // Rounded to a hundredth rather than a whole pixel: a transform inside a
      // zoomed artboard is magnified, so whole-pixel rounding lands 1.5px out
      // at 150%. Two decimals is still stable enough not to churn the style
      // string on every frame.
      node.style.setProperty('--cw-shift-x', `${Math.round(x * 100) / 100}px`);
      node.style.setProperty('--cw-shift-y', `${Math.round(y * 100) / 100}px`);
      node.dataset.cwShifted = 'true';
    }

    function clearShifts(preview) {
      preview?.originals?.forEach((state, node) => shiftNode(node, 0, 0));
    }

    function restoreGridPreview(interaction) {
      const preview = interaction?.gridPreview;
      if (!preview) return;
      preview.originals.forEach((state, node) => {
        if (!node?.isConnected) return;
        shiftNode(node, 0, 0);
        if (state.placed === null) node.removeAttribute('data-cw-placed'); else node.setAttribute('data-cw-placed', state.placed);
        if (state.positioned === null) node.removeAttribute('data-cw-positioned'); else node.setAttribute('data-cw-positioned', state.positioned);
        [['--cw-column-start', state.columnStart], ['--cw-row-start', state.rowStart], ['--cw-column-span', state.columnSpan], ['--cw-row-span', state.rowSpan]].forEach(([property, value]) => {
          if (value) node.style.setProperty(property, value); else node.style.removeProperty(property);
        });
      });
      interaction.gridPreview = null;
    }

    function applyDomPlacement(node, placement) {
      if (!node || !placement) return;
      node.dataset.cwPlaced = 'true';
      node.dataset.cwPositioned = 'true';
      node.style.setProperty('--cw-column-start', String(placement.columnStart));
      node.style.setProperty('--cw-row-start', String(placement.rowStart));
      node.style.setProperty('--cw-column-span', String(placement.columnSpan));
      node.style.setProperty('--cw-row-span', String(placement.rowSpan));
    }

    // Lines worth landing on, along one axis of the grid `nodeId` sits in: the
    // grid's own edges, every other pane's edges, and where this pane started.
    // In grid-line numbers, so a pane from column 3 spanning 4 has lines 3 and 7.
    function snapLines(graph, nodeId, axis) {
      const grid = parentOf(graph, nodeId);
      const node = findNode(graph, nodeId);
      if (!grid || grid.type !== 'grid' || !node) return [];
      const lines = new Set([1]);
      if (axis === 'column') lines.add(Math.max(1, Number(grid.columns) || DEFAULT_COLUMNS) + 1);
      grid.children.forEach((child) => {
        if (child.type === 'overlay' || !child.placement) return;
        const start = child.placement[`${axis}Start`];
        const span = child.placement[`${axis}Span`];
        if (!Number.isInteger(start) || !Number.isInteger(span)) return;
        lines.add(start);
        lines.add(start + span);
      });
      if (axis === 'row' && heroFold && heroFold.gridId === grid.id) lines.add(heroFold.line);
      return [...lines];
    }

    // Within a few pixels on screen, an edge lands exactly on a line rather
    // than a cell short of it or a cell over. Without this, dropping one side
    // column on the other shaved one column off the Stage because the pointer
    // was a few pixels left, and pulling a corner back to where it was needed
    // four tries. Measured in screen pixels on the edge's true position, not in
    // cells, so a deliberate one-column move (wider than the reach) is never
    // pulled back. Alt held switches it off.
    const SNAP_PIXELS = 10;
    // `edge` is where the pane's leading edge really is, in fractional grid
    // lines; `pitch` is one cell on screen. Returns the start to use, or null.
    function snappedStart(edge, span, lines, pitch) {
      if (!(pitch > 0) || !Number.isFinite(edge)) return null;
      let best = null;
      let bestDistance = SNAP_PIXELS / pitch;
      lines.forEach((line) => {
        const byStart = Math.abs(line - edge);
        if (byStart <= bestDistance) { best = line; bestDistance = byStart; }
        const byEnd = Math.abs(line - (edge + span));
        if (byEnd < bestDistance) { best = line - span; bestDistance = byEnd; }
      });
      return best;
    }
    function snappedLine(edge, lines, pitch) {
      return snappedStart(edge, 0, lines, pitch);
    }

    function gridPlacementAtPoint(graph, interaction, gridElement, clientX, clientY, { snap = true } = {}) {
      const source = findNode(graph, interaction.sourceId);
      const grid = source ? parentOf(graph, source.id) : null;
      if (!source || grid?.type !== 'grid' || grid.id !== gridElement?.dataset?.cwNodeId) return null;
      const rect = gridElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const footprint = selectedGridPlacement(graph, source);
      const columns = Math.max(1, Number(grid.columns) || 48);
      const columnSpan = Math.max(1, Math.min(columns, footprint.columnSpan));
      const computed = documentObject.defaultView?.getComputedStyle?.(gridElement);
      // The pointer arrives in screen coordinates, so the client rect carries
      // whatever zoom the canvas is under; getComputedStyle reports the gutter
      // and the row height unzoomed. Mixing the two misplaces every drop at any
      // zoom but 1. offsetWidth is the unscaled layout width, so the ratio
      // between them is the scale actually in force -- whoever applied it, and
      // whether or not this function was told about it. At 100% it is exactly
      // 1 and the arithmetic below is what it has always been.
      const outerWidth = gridElement.offsetWidth || rect.width;
      const zoom = outerWidth > 0 && rect.width > 0 ? rect.width / outerWidth : 1;
      // Tracks start inside the grid's padding; see gridPitch.
      const box = gridContentBox(computed);
      const layoutWidth = outerWidth - box.left - box.right;
      // Dividing a screen coordinate back by the zoom does not always land on
      // the layout value it came from: at 0.67x the left edge of column 10
      // returns 452.99999999999994, which floors into column 9. A billionth of
      // a cell is far above that error and far below anything a pointer can
      // express, so it settles the seam cases without moving any other answer.
      const SEAM = 1e-9;
      // A column track is what is left of the width once every gutter between
      // tracks is removed. Dividing the full width by the column count instead
      // drifts by up to a track near the right edge, which lands the pointer in
      // the neighbouring column at roughly one position in twelve -- always
      // next to a gutter, which is exactly where someone aiming at an edge is
      // pointing. Falls back to the ratio when the track cannot be measured.
      const columnGap = Number.parseFloat(computed?.columnGap) || 0;
      const trackWidth = (layoutWidth - (columnGap * (columns - 1))) / columns;
      const columnAt = (clientPoint) => {
        const columnOffset = (clientPoint - rect.left) / zoom - box.left;
        return trackWidth > 0
          ? Math.floor(columnOffset / (trackWidth + columnGap) + SEAM) + 1
          : Math.floor((columnOffset / layoutWidth) * columns + SEAM) + 1;
      };
      const gap = Number.parseFloat(computed?.rowGap) || 0;
      // The resolved track, for the reason given in gridPitch.
      const rowUnit = Number.parseFloat(computed?.gridAutoRows)
        || Number.parseFloat(computed?.getPropertyValue('--cw-grid-row-size'))
        || 26.333;
      const rowAt = (clientPoint) => Math.floor(Math.max(0, (clientPoint - rect.top) / zoom - box.top) / Math.max(1, rowUnit + gap) + SEAM) + 1;
      // The pointer's position in fractional grid lines, for the snap.
      const columnPitch = trackWidth > 0 ? trackWidth + columnGap : layoutWidth / columns;
      const columnLine = (clientPoint) => ((clientPoint - rect.left) / zoom - box.left) / columnPitch + 1;
      const rowLine = (clientPoint) => Math.max(0, (clientPoint - rect.top) / zoom - box.top) / Math.max(1, rowUnit + gap) + 1;
      // A pane is carried by the point it was picked up at, not by its own top
      // left corner. Without this it moves the instant it is touched, by however
      // far into it the press landed -- five fine columns from the drag chip,
      // twenty if the middle of the Stage could be taken hold of -- and every
      // aim after that is off by the same amount, which is most of what makes
      // placing something feel like an argument.
      //
      // Worked out once, from the press, against the pane's committed origin,
      // and in cells rather than pixels because cells are what a drop lands on.
      // A pane with no origin of its own is carried by its corner, because
      // there is nothing else to carry it by.
      if (interaction && interaction.grabColumnOffset === undefined) {
        const held = source.placement;
        const pressX = Number.isFinite(interaction.startX) ? interaction.startX : clientX;
        const pressY = Number.isFinite(interaction.startY) ? interaction.startY : clientY;
        interaction.grabColumnOffset = Number.isInteger(held?.columnStart)
          ? Math.max(0, Math.min(columnSpan - 1, columnAt(pressX) - held.columnStart))
          : 0;
        interaction.grabRowOffset = Number.isInteger(held?.rowStart)
          ? Math.max(0, Math.min(footprint.rowSpan - 1, rowAt(pressY) - held.rowStart))
          : 0;
        // The same, unrounded, for the snap: how far into the pane, in cells
        // and fractions of a cell, the press landed.
        interaction.grabColumnFraction = Number.isInteger(held?.columnStart) ? columnLine(pressX) - held.columnStart : 0;
        interaction.grabRowFraction = Number.isInteger(held?.rowStart) ? rowLine(pressY) - held.rowStart : 0;
      }
      let aimedColumn = columnAt(clientX) - (interaction?.grabColumnOffset || 0);
      let aimedRow = rowAt(clientY) - (interaction?.grabRowOffset || 0);
      if (snap) {
        const columnSnap = snappedStart(columnLine(clientX) - (interaction?.grabColumnFraction || 0), columnSpan, snapLines(graph, source.id, 'column'), columnPitch * zoom);
        const rowSnap = snappedStart(rowLine(clientY) - (interaction?.grabRowFraction || 0), footprint.rowSpan, snapLines(graph, source.id, 'row'), Math.max(1, rowUnit + gap) * zoom);
        if (columnSnap !== null) aimedColumn = columnSnap;
        if (rowSnap !== null) aimedRow = rowSnap;
      }
      const columnStart = Math.max(1, Math.min(columns - columnSpan + 1, aimedColumn));
      let rowStart = Math.max(1, Math.min(MAX_ROWS - footprint.rowSpan + 1, aimedRow));
      // Across the player it would be behind the player at rest, so it lands
      // on whichever side of it is nearer: flush on top of it, or just past it.
      const fold = heroFold && heroFold.gridId === grid.id ? heroFold.line : null;
      if (fold && footprint.rowSpan < fold && rowStart < fold && rowStart + footprint.rowSpan > fold) {
        const above = fold - footprint.rowSpan;
        rowStart = (rowStart - above) <= (fold - rowStart) ? above : fold;
      }
      return { gridId: grid.id, columnStart, rowStart, columnSpan, rowSpan: footprint.rowSpan };
    }

    function previewGridPlacement(interaction, placement) {
      const graph = interaction.graph;
      const packed = packedGridGraph(graph, interaction.sourceId, placement);
      const packedGrid = packed ? findNode(packed, placement.gridId) : null;
      const gridElement = [...documentObject.querySelectorAll('.cw-grid[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === placement.gridId);
      if (!packedGrid || !gridElement || !interaction.placeholder) return false;
      const preview = rememberGridPreview(interaction, gridElement, packedGrid.columns);
      if (interaction.placeholder.parentElement !== gridElement) gridElement.append(interaction.placeholder);
      // The placeholder is the one thing that takes a real grid placement: it
      // is what shows where the drop lands, and it is a single element, so its
      // reflow is cheap. Every other pane keeps the placement it was committed
      // with and is moved by transform. Since all of them carry explicit
      // coordinates, the placeholder claiming cells does not disturb them.
      const byId = new Map([...gridElement.children]
        .filter((node) => node.dataset?.cwNodeId)
        .map((node) => [node.dataset.cwNodeId, node]));
      packedGrid.children.filter((child) => child.type !== 'overlay').forEach((child) => {
        if (child.id === interaction.sourceId) {
          applyDomPlacement(interaction.placeholder, child.placement);
          return;
        }
        const surface = byId.get(child.id);
        if (!surface || !child.placement) return;
        previewNeighbour(surface, child.placement, preview);
      });
      preview.applied = true;
      interaction.gridPlacement = placement;
      interaction.lastValidGridPlacement = placement;
      interaction.gridGraph = packed;
      interaction.liveReflow = true;
      documentObject.body.dataset.cwStudioLivePreview = 'grid-cell';
      return true;
    }

    function showResizeSlot(interaction, gridElement, placement) {
      let slot = interaction.resizeSlot;
      if (!slot) {
        slot = element('div', 'cw-node cw-resize-slot');
        slot.setAttribute('aria-hidden', 'true');
        interaction.resizeSlot = slot;
      }
      if (slot.parentElement !== gridElement) gridElement.append(slot);
      applyDomPlacement(slot, placement);
    }

    function previewPackedResize(interaction, placement) {
      const graph = packedGridGraph(interaction.graph, interaction.nodeId, placement);
      const grid = graph ? parentOf(graph, interaction.nodeId) : null;
      const gridElement = grid ? [...documentObject.querySelectorAll('.cw-grid[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === grid.id) : null;
      if (!graph || !grid || !gridElement) return false;
      const preview = rememberGridPreview(interaction, gridElement, grid.columns);
      const byId = new Map([...gridElement.children]
        .filter((node) => node.dataset?.cwNodeId)
        .map((node) => [node.dataset.cwNodeId, node]));
      grid.children.filter((child) => child.type !== 'overlay').forEach((child) => {
        const surface = byId.get(child.id);
        if (!surface || !child.placement) return;
        // The pane being resized has to change its real span -- that is the
        // whole gesture -- so it takes a placement. Its neighbours only move,
        // so they shift.
        if (child.id === interaction.nodeId) {
          // Where it will land is shown by a slot. The pane itself stays on the
          // cells it started on and follows the pointer (updatePaneResize), so
          // its far corner never moves.
          showResizeSlot(interaction, gridElement, child.placement);
          return;
        }
        previewNeighbour(surface, child.placement, preview);
      });
      preview.applied = true;
      interaction.packedGraph = graph;
      return true;
    }

    function previewGridReflow(interaction, target, intent) {
      const source = interaction.sourceElement;
      const marker = interaction.placeholder;
      if (!source || !marker || interaction.degraded) return false;
      const parent = target?.parentElement;
      const canReorder = Boolean(source && marker && target && parent?.classList?.contains('cw-grid') && ['move-before', 'move-after'].includes(intent.kind));
      if (!canReorder) {
        if (marker?.isConnected) animateReflow(marker.parentElement, () => marker.remove());
        interaction.liveReflow = true;
        documentObject.body.dataset.cwStudioLivePreview = intent.kind;
        return false;
      }
      const adjacent = (node, direction) => {
        let sibling = direction === 'next' ? node.nextElementSibling : node.previousElementSibling;
        while (sibling === source) sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
        return sibling;
      };
      const alreadyPlaced = intent.kind === 'move-before' ? adjacent(marker, 'next') === target : adjacent(marker, 'previous') === target;
      const reference = intent.kind === 'move-before' ? target : target.nextElementSibling;
      if (!alreadyPlaced && reference !== marker && !(reference === null && marker === parent.lastElementChild)) {
        animateReflows([marker.parentElement, parent], () => parent.insertBefore(marker, reference));
      }
      const modules = [...documentObject.querySelectorAll('.cw-module[data-cw-node-id]')];
      const ids = new Set(modules.map((node) => node.dataset.cwNodeId));
      const healthy = source.isConnected && marker.isConnected && marker.parentElement === parent && modules.length === interaction.moduleCount && ids.size === modules.length;
      if (!healthy) {
        restoreLiveReflow(interaction, false);
        interaction.degraded = true;
        documentObject.body.dataset.cwStudioPreviewFallback = 'true';
        bridge.setStatus?.('Live reflow could not be verified. The visual preview was cancelled; release still uses the validated placement operation.', 'warning');
        return false;
      }
      interaction.liveReflow = true;
      documentObject.body.dataset.cwStudioLivePreview = intent.kind;
      return true;
    }

    function placeholderIntent(interaction) {
      const marker = interaction?.placeholder;
      if (!marker?.isConnected || !marker.parentElement?.classList?.contains('cw-grid')) return null;
      let next = marker.nextElementSibling;
      while (next && (!next.classList?.contains('cw-module') || next.dataset.cwNodeId === interaction.sourceId)) next = next.nextElementSibling;
      if (next?.dataset.cwNodeId) return intentFor('move-before', interaction.sourceId, next.dataset.cwNodeId);
      let previous = marker.previousElementSibling;
      while (previous && (!previous.classList?.contains('cw-module') || previous.dataset.cwNodeId === interaction.sourceId)) previous = previous.previousElementSibling;
      if (previous?.dataset.cwNodeId) return intentFor('move-after', interaction.sourceId, previous.dataset.cwNodeId);
      return null;
    }

    function dropIntentSatisfied(graph, intent) {
      const source = findNode(graph, intent?.sourceId);
      const target = findNode(graph, intent?.targetId);
      if (!source || !target) return false;
      const sourceParent = parentOf(graph, source.id);
      const targetParent = parentOf(graph, target.id);
      if (!sourceParent || sourceParent !== targetParent) return false;
      const sourceIndex = sourceParent.children.findIndex((child) => child.id === source.id);
      const targetIndex = sourceParent.children.findIndex((child) => child.id === target.id);
      if (intent.kind === 'move-before') return sourceIndex === targetIndex - 1;
      if (intent.kind === 'move-after') return sourceIndex === targetIndex + 1;
      if (intent.kind === 'stack') return sourceParent.type === 'stack';
      if (intent.kind?.startsWith('split-')) {
        const before = intent.kind.includes('before');
        const axis = intent.kind.endsWith('vertical') ? 'vertical' : 'horizontal';
        return sourceParent.type === 'split' && sourceParent.axis === axis && (before ? sourceIndex < targetIndex : sourceIndex > targetIndex);
      }
      return false;
    }

    function previewRect(rect, intent) {
      const inset = 6;
      const result = { left: rect.left + inset, top: rect.top + inset, width: Math.max(20, rect.width - inset * 2), height: Math.max(20, rect.height - inset * 2) };
      if (intent.kind === 'split-before-horizontal') result.width /= 2;
      if (intent.kind === 'split-after-horizontal') { result.left += result.width / 2; result.width /= 2; }
      if (intent.kind === 'split-before-vertical') result.height /= 2;
      if (intent.kind === 'split-after-vertical') { result.top += result.height / 2; result.height /= 2; }
      if (intent.kind === 'move-before' || intent.kind === 'move-after') {
        result.width = Math.max(12, Math.min(30, rect.width * 0.12));
        result.left = intent.kind === 'move-before' ? rect.left + inset : rect.right - result.width - inset;
      }
      if (intent.kind === 'stack') {
        result.left += Math.min(16, result.width * 0.08);
        result.top += Math.min(16, result.height * 0.08);
        result.width -= Math.min(32, result.width * 0.16);
        result.height -= Math.min(32, result.height * 0.16);
      }
      return result;
    }

    function paintDropPreview(target, intent, interaction) {
      interaction.preview?.remove?.();
      const rect = target.getBoundingClientRect();
      const area = previewRect(rect, intent);
      const preview = element('div', 'cw-studio-drop-preview', intent.label);
      preview.setAttribute('aria-hidden', 'true');
      preview.style.left = `${Math.round(area.left)}px`;
      preview.style.top = `${Math.round(area.top)}px`;
      preview.style.width = `${Math.round(area.width)}px`;
      preview.style.height = `${Math.round(area.height)}px`;
      documentObject.body.append(preview);
      interaction.preview = preview;
    }

    function autoscroll(event, interaction) {
      const surface = interaction.scrollSurface;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const top = surface.scrollHeight > surface.clientHeight ? bridge.autoscrollDelta?.(y, rect.height, { edge: 56, maximum: 28 }) || 0 : 0;
      const left = surface.scrollWidth > surface.clientWidth ? bridge.autoscrollDelta?.(x, rect.width, { edge: 56, maximum: 28 }) || 0 : 0;
      if (top || left) surface.scrollBy?.({ top, left, behavior: 'auto' });
    }

    function finishPointer(message = '', options = {}) {
      if (pointerFrame) documentObject.defaultView?.cancelAnimationFrame?.(pointerFrame);
      pointerFrame = 0;
      queuedPanePoint = null;
      queuedResizePoint = null;
      if (options.restoreLive !== false) restoreLiveReflow(pointerInteraction);
      restoreResizeVisuals(pointerInteraction);
      clearDropPreview();
      pointerInteraction = null;
      heroFold = null;
      delete documentObject.body.dataset.cwStudioPointer;
      delete documentObject.body.dataset.cwStudioDragConserve;
      delete documentObject.body.dataset.cwStudioDense;
      if (message) bridge.setStatus?.(message, 'warning');
    }

    function startPaneDrag(event, handle) {
      const sourceId = handle.dataset.cwDragNode;
      if (!sourceId || event.button !== 0) return;
      const snapshot = bridge.snapshot();
      if (snapshot.mode !== 'edit') return;
      bridge.beginInteraction?.();
      event.preventDefault();
      event.stopPropagation();
      // The grip belongs to the node it moves, which is a section as often as
      // a pane now.
      const escapeId = documentObject.defaultView?.CSS?.escape || ((value) => value);
      const sourceElement = handle.closest(`[data-cw-node-id="${escapeId(sourceId)}"]:not(.cw-drag-placeholder)`)
        || handle.closest('.cw-module[data-cw-node-id]');
      const moduleElements = [...documentObject.querySelectorAll('.cw-module[data-cw-node-id]')];
      const sourceGraphNode = findNode(snapshot.graph, sourceId);
      if (!sourceGraphNode || sourceGraphNode.type === 'module') selectForPointer(sourceId, moduleElements);
      else if (soleFiller(sourceGraphNode)) selectForPointer(soleFiller(sourceGraphNode).id, moduleElements);
      else {
        releaseGroupFor(sourceId);
        selectedGroupId = sourceId;
        sourceElement?.setAttribute('data-cw-studio-group-selected', 'true');
      }
      const canvas = documentObject.querySelector('.cw-canvas');
      const workspace = canvas?.closest?.('.workspace');
      const scrollSurface = [canvas, workspace].find((surface) => surface && (surface.scrollHeight > surface.clientHeight || surface.scrollWidth > surface.clientWidth)) || workspace || canvas;
      pointerInteraction = {
        kind: 'pane', pointerId: event.pointerId, sourceId, startX: event.clientX, startY: event.clientY,
        intent: null, ghost: null, preview: null, scrollSurface,
        sourceLabel: moduleLabel(sourceGraphNode),
        sourceElement, graph: snapshot.graph, moduleElements,
        homeParent: null, homeNextSibling: null, placeholder: null, dragProxy: null, lifted: false, liveReflow: false, degraded: false,
        lastValidIntent: null, gridPlacement: null, lastValidGridPlacement: null, gridGraph: null, gridPreview: null,
      };
      heroFold = sourceElement?.parentElement?.classList?.contains('cw-grid') ? heroFoldFor(sourceElement.parentElement) : null;
      try { handle.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort */ }
      // Lift on press, not after the movement threshold. The moving surface is
      // a lightweight proxy, so this produces immediate grab feedback without
      // promoting the live product subtree.
      if (!liftPane(event, pointerInteraction)) {
        pointerInteraction.degraded = true;
        documentObject.body.dataset.cwStudioPreviewFallback = 'true';
      }
      documentObject.body.dataset.cwStudioPointer = 'picked';
    }

    function startSplitResize(event, handle) {
      if (event.button !== 0) return;
      const snapshot = bridge.snapshot();
      if (snapshot.mode !== 'edit') return;
      bridge.beginInteraction?.();
      const split = findNode(snapshot.graph, handle.dataset.cwSplitId);
      const surface = handle.closest('.cw-split');
      if (!split || split.type !== 'split' || !surface) return;
      event.preventDefault();
      event.stopPropagation();
      pointerInteraction = { kind: 'split', pointerId: event.pointerId, splitId: split.id, axis: split.axis, weights: [...split.weights], rect: surface.getBoundingClientRect(), startX: event.clientX, startY: event.clientY, preview: null, surface };
      prepareResizeVisuals(pointerInteraction);
      documentObject.body.dataset.cwStudioPointer = 'resizing-split';
      try { handle.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort */ }
    }

    function startPaneResize(event, handle) {
      if (event.button !== 0) return;
      const snapshot = bridge.snapshot();
      if (snapshot.mode !== 'edit') return;
      bridge.beginInteraction?.();
      const graph = snapshot.graph;
      const node = findNode(graph, handle.dataset.cwResizeNode);
      const placement = node ? selectedGridPlacement(graph, node) : null;
      const pane = handle.closest('.cw-node[data-cw-node-id]');
      const grid = pane?.parentElement?.classList?.contains('cw-grid') ? pane.parentElement : null;
      if (!node || !placement || !pane || !grid) return;
      event.preventDefault();
      event.stopPropagation();
      selectForPointer(soleFiller(node)?.id || node.id);
      const shape = bridge.shapes()[node.shape] || {};
      const gridRect = grid.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const startPitch = gridPitch(grid, placement.parent.columns || DEFAULT_COLUMNS);
      const columnWidth = startPitch?.columnPitch || (gridRect.width / Math.max(1, placement.parent.columns || DEFAULT_COLUMNS));
      const inferredColumnStart = Math.max(1, Math.min((placement.parent.columns || DEFAULT_COLUMNS) - placement.columnSpan + 1, Math.round((paneRect.left - gridRect.left) / Math.max(1, columnWidth)) + 1));
      const inferredRowHeight = startPitch?.rowPitch || Math.max(1, paneRect.height / Math.max(1, placement.rowSpan));
      const inferredRowStart = Math.max(1, Math.round((paneRect.top - gridRect.top) / inferredRowHeight) + 1);
      pointerInteraction = {
        kind: 'pane-resize', pointerId: event.pointerId, nodeId: node.id,
        corner: handle.dataset.cwResizeCorner === 'start' ? 'start' : 'end',
        startX: event.clientX, startY: event.clientY, initial: { ...placement, columnStart: placement.columnStart || inferredColumnStart, rowStart: placement.rowStart || inferredRowStart },
        gridRect, paneRect, pane, gridElement: grid,
        axes: new Set(shape.resizeAxes || ['inline', 'block']), shape, graph, preview: null,
        hadExplicitPlacement: pane.dataset.cwPlaced === 'true',
        // The pane's own box in layout pixels, which is what the live preview
        // sizes. offsetWidth is unscaled; the rect carries the zoom.
        liveOrigin: { width: pane.offsetWidth || paneRect.width, height: pane.offsetHeight || paneRect.height },
      };
      heroFold = heroFoldFor(grid);
      prepareResizeVisuals(pointerInteraction);
      documentObject.body.dataset.cwStudioPointer = 'resizing-pane';
      try { handle.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort */ }
    }

    function handlePointerDown(event) {
      if (moduleContextMenu && !moduleContextMenu.contains(event.target)) closeModuleContextMenu();
      bodyPress = null;
      if (startControlDrag(event)) return;
      const paneHandle = event.target.closest?.('.cw-pane-drag-handle');
      if (paneHandle) return startPaneDrag(event, paneHandle);
      const splitHandle = event.target.closest?.('.cw-split-handle');
      if (splitHandle) return startSplitResize(event, splitHandle);
      const resizeHandle = event.target.closest?.('.cw-pane-resize-handle');
      if (resizeHandle) return startPaneResize(event, resizeHandle);
      armBodyPress(event);
    }

    // ---- Moving a pane by the pane --------------------------------------
    //
    // Everybody reaches for the pane itself first: the usability run tried the
    // body before the grip every single time, the way a window is moved by its
    // title bar or a card by its face. A press on a pane's own surface -- not
    // on a control inside it -- that then travels a few pixels is taken as a
    // drag by that pane's grip. A press that does not travel is still a click
    // and still selects, and every button, field, tab and draggable inside the
    // product keeps working exactly as before.
    const BODY_DRAG_THRESHOLD = 6;
    const BODY_DRAG_EXCLUDED = [
      'button', 'input', 'select', 'textarea', 'a[href]', 'label', 'summary', 'video', 'audio',
      '[contenteditable="true"]', '[draggable="true"]',
      '[role="button"]', '[role="slider"]', '[role="tab"]', '[role="menuitem"]', '[role="checkbox"]', '[role="switch"]', '[role="option"]',
      '.cw-stack-switcher', '.cw-inline-target-menu', '.cw-module-context-menu', '[data-cw-no-body-drag]',
    ].join(', ');
    let bodyPress = null;
    let suppressBodyClickUntil = 0;

    // A press on a scrollbar is scrolling, not moving the pane.
    function onScrollbar(target, clientX, clientY) {
      for (let element = target; element && element !== documentObject.body; element = element.parentElement) {
        if (!(element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)) continue;
        const rect = element.getBoundingClientRect();
        const scale = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
        if (element.clientWidth && clientX > rect.left + (element.clientLeft + element.clientWidth) * scale) return true;
        if (element.clientHeight && clientY > rect.top + (element.clientTop + element.clientHeight) * scale) return true;
      }
      return false;
    }

    function armBodyPress(event) {
      if (event.button !== 0 || pointerInteraction || bridge.snapshot().mode !== 'edit') return;
      if (documentObject.body.dataset.cwPanReady) return;
      const pane = event.target.closest?.('.cw-module[data-cw-node-id]');
      if (!pane || !pane.closest('.cw-canvas') || pane.closest('.cw-drag-proxy')) return;
      if (event.target.closest(BODY_DRAG_EXCLUDED) || event.target.closest(COMPOSITION_GESTURE_SELECTOR)) return;
      if (onScrollbar(event.target, event.clientX, event.clientY)) return;
      // The grip that moves what this pane is on screen: its own, or its
      // section's when it stands for one.
      const owner = layoutOwnerOf(bridge.snapshot().graph, pane.dataset.cwNodeId);
      const holder = owner
        ? [...documentObject.querySelectorAll('[data-cw-node-id]')].find((node) => node.dataset.cwNodeId === owner.id && !node.classList.contains('cw-drag-placeholder'))
        : pane;
      const grip = holder?.querySelector(':scope > .cw-pane-drag-handle');
      if (!grip) return;
      bodyPress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, grip };
    }

    // Past the threshold, start exactly the drag the grip would have started,
    // from the point the press landed, so the pane is carried by where it was
    // taken hold of rather than jumping by the threshold.
    function promoteBodyPress(event) {
      const press = bodyPress;
      if (!press || press.pointerId !== event.pointerId || pointerInteraction) return false;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < BODY_DRAG_THRESHOLD) return false;
      bodyPress = null;
      if (!press.grip.isConnected || bridge.snapshot().mode !== 'edit') return false;
      startPaneDrag({
        button: 0, pointerId: press.pointerId, clientX: press.x, clientY: press.y,
        preventDefault() {}, stopPropagation() {},
      }, press.grip);
      if (!pointerInteraction) return false;
      pointerInteraction.fromBody = true;
      documentObject.getSelection?.()?.removeAllRanges?.();
      return true;
    }

    function suppressNativeCompositionGesture(event) {
      // The live pane is hidden as soon as a drag starts so the pointer can
      // move a cheap proxy. Chromium may then retarget its native selection or
      // HTML drag gesture to text/image content that was underneath the pane.
      // Keep the guard for the whole pointer interaction, not only the handle's
      // initial pointerdown, and also protect every dedicated composition grip.
      const fromHandle = Boolean(event.target?.closest?.(COMPOSITION_GESTURE_SELECTOR));
      if (!pointerInteraction && !fromHandle && !bodyPress) return;
      event.preventDefault();
      event.stopPropagation();
      documentObject.getSelection?.()?.removeAllRanges?.();
    }

    // How near a pane's edge the pointer has to be for a drop to mean "beside
    // this one" rather than "here". A share of the pane's own size, so a small
    // pane does not turn into one large attach target, and capped in pixels so a
    // very large one does not either: the Stage's own fifth would be 137px of
    // accidental relationship.
    // A frame of width b on a w by h pane covers 1 - ((w-2b)(h-2b))/(wh) of it,
    // which grows fast on a pane that is short. At a fifth, capped at 40px, the
    // archive's 240 by 150 library column was still 42% attach surface -- the
    // top and bottom bands alone were 40% of its height. These numbers put it
    // near a third, measured by scripts/probe-drop-intent-bias.js.
    const ATTACH_BAND = 0.12;
    const ATTACH_BAND_MAX = 16;
    function withinAttachBand(element, clientX, clientY) {
      const rect = element.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return false;
      const bandX = Math.min(rect.width * ATTACH_BAND, ATTACH_BAND_MAX);
      const bandY = Math.min(rect.height * ATTACH_BAND, ATTACH_BAND_MAX);
      return (clientX - rect.left) < bandX
        || (rect.right - clientX) < bandX
        || (clientY - rect.top) < bandY
        || (rect.bottom - clientY) < bandY;
    }

    // Why a drop would do nothing, in the words the status line uses. Each one
    // names the reason rather than telling the person what to try, because the
    // old fallback -- "drag onto a pane" -- was advice for a gesture that is no
    // longer the default.
    const DROP_REFUSALS = Object.freeze({
      'refused-cell': 'No room for the pane there: something in the way cannot move aside. Releasing here changes nothing.',
      'other-grid': 'A pane can only be placed inside the grid it belongs to. Releasing here changes nothing.',
      grouped: 'This pane is inside a group, so it cannot be placed freely yet. Use its menu, Move relative to, to take it out first.',
      'off-canvas': 'Not over the composition. Releasing here changes nothing.',
      'no-attach': 'That pane cannot be attached to from this edge. Releasing here changes nothing.',
    });

    function returnPlaceholderHome(interaction) {
      const home = interaction.placeholderHome;
      const placeholder = interaction.placeholder;
      if (!home || !placeholder || !home.parent?.isConnected) return;
      if (placeholder.parentElement !== home.parent) {
        const source = interaction.sourceElement;
        home.parent.insertBefore(placeholder, source?.parentElement === home.parent ? source : null);
      }
      if (home.placed) placeholder.dataset.cwPlaced = home.placed; else delete placeholder.dataset.cwPlaced;
      if (home.positioned) placeholder.dataset.cwPositioned = home.positioned; else delete placeholder.dataset.cwPositioned;
      home.properties.forEach(([property, value]) => {
        if (value) placeholder.style.setProperty(property, value); else placeholder.style.removeProperty(property);
      });
    }

    // The pointer is on nothing a pane can go to. Everything the gesture had
    // tentatively chosen is let go -- the attach it passed, the last cell the
    // packer accepted -- and the canvas goes back to looking exactly as it will
    // look if the pane is released here, which is unchanged.
    //
    // `previewKey` is kept for a refused cell so the packer is not rerun on
    // every frame the pointer spends over the same refusal.
    function abandonDropChoice(interaction, reason, previewKey = '') {
      interaction.intent = null;
      interaction.lastValidIntent = null;
      interaction.dropTarget?.removeAttribute('data-cw-studio-drop');
      interaction.dropTarget = null;
      interaction.preview?.remove?.();
      interaction.preview = null;
      if (interaction.gridPreview) restoreGridPreview(interaction);
      interaction.gridPlacement = null;
      interaction.lastValidGridPlacement = null;
      interaction.gridGraph = null;
      interaction.previewKey = previewKey;
      returnPlaceholderHome(interaction);
      if (interaction.refusal !== reason) {
        interaction.refusal = reason;
        bridge.setStatus?.(DROP_REFUSALS[reason] || DROP_REFUSALS['off-canvas'], 'warning');
      }
    }

    function updatePaneDrag(event, interaction) {
      if (Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) < 2 && !interaction.intent) return;
      const startedAt = documentObject.defaultView?.performance?.now?.() ?? Number.NaN;
      try {
      // Suppress only the synthetic click that immediately follows pointerup.
      // A long global lockout made a legitimate click-to-move on another pane
      // appear broken after a fast drag.
      suppressMoveClickUntil = Date.now() + 80;
      documentObject.body.dataset.cwStudioPointer = 'dragging-pane';
      if (!interaction.lifted && !interaction.degraded && !liftPane(event, interaction)) {
        interaction.degraded = true;
        documentObject.body.dataset.cwStudioPreviewFallback = 'true';
        bridge.setStatus?.('This pane could not be lifted safely. Use its Pane actions menu or click Move to choose a destination.', 'warning');
      }
      if (interaction.lifted) positionLiftedPane(event, interaction);
      interaction.lastPointerX = event.clientX;
      interaction.lastPointerY = event.clientY;
      autoscroll(event, interaction);
      const pointElement = documentObject.elementFromPoint?.(event.clientX, event.clientY);
      // Pointer capture retargets pointermove to the Move button. Hit testing
      // must therefore come from the pointer coordinates, not event.target;
      // otherwise every real captured drag appears to remain over its source.
      // Product roots and the lightweight proxy are pointer-transparent during
      // a composition gesture, so one hit test reaches the pane boundary. A
      // full elementsFromPoint walk scaled with every painted descendant.
      let target = pointElement?.closest?.('.cw-module[data-cw-node-id]') || null;
      if (target?.dataset.cwNodeId === interaction.sourceId) target = null;
      // Attaching is a deliberate aim, not the default. Dropping a pane onto
      // ground another pane is standing on means "put it here, and that one
      // moves" -- which is exactly what the packer does. Asking for a
      // relationship instead is said by aiming at the pane's edge.
      //
      // Until now any pointer over any other pane became an attach, so free
      // placement was reachable only over the pane being dragged: measured at
      // 20% of the composition for the library column and 0% for a pane that
      // had been stacked. The packer's own displacement could not be reached by
      // pointer at all.
      if (target && !withinAttachBand(target, event.clientX, event.clientY)) target = null;
      let noTargetReason = 'off-canvas';
      if (!target) {
        const overChosenSlot = Boolean(interaction.placeholder) && pointElement?.closest?.('.cw-drag-placeholder') === interaction.placeholder;
        // Over a chosen cell the pointer is still over the grid -- the slot is
        // one of its children -- so the cell is worked out again from where the
        // pointer is. Holding the last cell instead made the whole footprint of
        // the slot sticky: the pane could not move by less than its own width
        // or height, because every smaller move left the pointer inside the
        // slot it had just been given. Over a pane as tall as the artboard that
        // meant it could not be moved down at all. Only an attach, which the
        // slot stands in for, is held.
        if (overChosenSlot && interaction.lastValidIntent && !interaction.lastValidGridPlacement) {
          interaction.intent = interaction.lastValidIntent;
          return;
        }
        // A pane is placed against the grid it belongs to, wherever inside that
        // grid the pointer is. Taking the nearest grid instead meant that over
        // any pane which is itself a grid -- the Stage, in every ported theme --
        // the pointer resolved against that nested grid, which the dragged pane
        // does not belong to, and free placement quietly stopped working over
        // the largest pane on the canvas.
        if (interaction.ownGridId === undefined) {
          const ownGrid = parentOf(interaction.graph, interaction.sourceId);
          interaction.ownGridId = ownGrid?.type === 'grid' ? ownGrid.id : null;
        }
        const escapeId = documentObject.defaultView?.CSS?.escape || ((value) => value);
        const ownSurface = interaction.ownGridId
          ? pointElement?.closest?.(`.cw-grid[data-cw-node-id="${escapeId(interaction.ownGridId)}"]`)
          : null;
        const gridSurface = ownSurface || pointElement?.closest?.('.cw-grid[data-cw-node-id]');
        const gridPlacement = gridSurface ? gridPlacementAtPoint(interaction.graph, interaction, gridSurface, event.clientX, event.clientY, { snap: !event.altKey }) : null;
        if (gridSurface && !gridPlacement) noTargetReason = interaction.ownGridId ? 'other-grid' : 'grouped';
        if (gridPlacement) {
          const previewKey = `grid:${gridPlacement.gridId}:${gridPlacement.columnStart}:${gridPlacement.rowStart}:${gridPlacement.columnSpan}:${gridPlacement.rowSpan}`;
          interaction.intent = null;
          interaction.dropTarget?.removeAttribute('data-cw-studio-drop');
          interaction.dropTarget = null;
          interaction.preview?.remove?.();
          interaction.preview = null;
          // A cell is a choice of its own, so an attach the pointer passed on the
          // way here no longer counts.
          interaction.lastValidIntent = null;
          if (previewKey !== interaction.previewKey) {
            if (previewGridPlacement(interaction, gridPlacement)) {
              interaction.previewKey = previewKey;
              interaction.refusal = null;
              bridge.setStatus?.(`Grid column ${gridPlacement.columnStart}, row ${gridPlacement.rowStart}. Release to place it here.${describePacking(interaction.gridGraph)}`, 'success');
            } else {
              // The packer refused this cell. The slot used to stay frozen on
              // the last cell it accepted while release did nothing, so the
              // screen promised a drop that never came.
              abandonDropChoice(interaction, 'refused-cell', previewKey);
            }
          }
          return;
        }
      }
      if (!target || target.dataset.cwNodeId === interaction.sourceId) {
        // An intent belongs to the target the pointer is on. Reviving the last
        // one because the pointer is still somewhere over the canvas is what
        // made a pane flicker between the pasteboard and the composition while
        // it was being dragged near the edge: a pixel either way flipped the
        // preview between a stale attach and nothing at all. A pointer on no
        // target has no intent, and the placeholder path above already covers
        // holding still over a chosen slot.
        abandonDropChoice(interaction, noTargetReason);
        return;
      }
      if (interaction.gridPreview) restoreGridPreview(interaction);
      interaction.gridPlacement = null;
      interaction.gridGraph = null;
      // Otherwise holding still over the slot would revive an old cell under an
      // attach, and release would commit the cell.
      interaction.lastValidGridPlacement = null;
      const rect = target.getBoundingClientRect();
      const intents = bridge.rankDropIntents({
        graph: interaction.graph,
        sourceId: interaction.sourceId,
        targetId: target.dataset.cwNodeId,
        xRatio: (event.clientX - rect.left) / Math.max(1, rect.width),
        yRatio: (event.clientY - rect.top) / Math.max(1, rect.height),
        targetRect: { width: rect.width, height: rect.height },
      });
      interaction.intent = intents[0] || null;
      if (!interaction.intent) {
        abandonDropChoice(interaction, 'no-attach');
        return;
      }
      interaction.refusal = null;
      const previewKey = `${interaction.intent.kind}:${interaction.intent.targetId}`;
      interaction.lastValidIntent = interaction.intent;
      if (previewKey === interaction.previewKey) return;
      interaction.dropTarget?.removeAttribute('data-cw-studio-drop');
      interaction.preview?.remove?.();
      interaction.preview = null;
      previewGridReflow(interaction, target, interaction.intent);
      target.dataset.cwStudioDrop = interaction.intent.label;
      interaction.dropTarget = target;
      interaction.previewKey = previewKey;
      paintDropPreview(target, interaction.intent, interaction);
      bridge.setStatus?.(`${interaction.intent.label}. Release to place the pane.`, 'success');
      } finally {
        recordDragCost(interaction, startedAt);
      }
    }

    function updateSplitResize(event, interaction) {
      const extent = interaction.axis === 'horizontal' ? interaction.rect.width : interaction.rect.height;
      const delta = interaction.axis === 'horizontal' ? event.clientX - interaction.startX : event.clientY - interaction.startY;
      interaction.preview = bridge.resizeWeights(interaction.weights, delta, extent);
      interaction.surface.style.setProperty('--cw-split-template', interaction.preview.map((weight) => `minmax(0, ${weight}fr)`).join(' '));
      interaction.surface.querySelector(':scope > .cw-split-handle')?.setAttribute('aria-valuenow', String(Math.round(interaction.preview[0] * 100)));
      updateResizeVisuals(interaction);
    }

    function updatePaneResize(event, interaction) {
      const columns = Math.max(1, interaction.initial.parent.columns || DEFAULT_COLUMNS);
      // The pitch the grid is laid out at, not a guess from the pane's own
      // height. gridPitch reports it in layout pixels, so the pointer delta is
      // taken back out of zoom first -- the same order the drag path uses.
      const pitch = interaction.gridElement ? gridPitch(interaction.gridElement, columns) : null;
      const layoutWidth = interaction.gridElement?.offsetWidth || 0;
      const zoom = layoutWidth > 0 && interaction.gridRect.width > 0 ? interaction.gridRect.width / layoutWidth : 1;
      const columnWidth = pitch?.columnPitch || ((layoutWidth || interaction.gridRect.width) / columns);
      const rowHeight = pitch?.rowPitch || Math.max(1, interaction.paneRect.height / Math.max(1, interaction.initial.rowSpan));
      let columnDelta = interaction.axes.has('inline') ? Math.round(((event.clientX - interaction.startX) / zoom) / columnWidth) : 0;
      let rowDelta = interaction.axes.has('block') ? Math.round(((event.clientY - interaction.startY) / zoom) / rowHeight) : 0;
      const startColumn = interaction.initial.columnStart || 1;
      const startRow = interaction.initial.rowStart || 1;
      // The moving edge lands on a neighbour's edge, the grid's edge or where
      // it started when it is within a few pixels of one.
      if (interaction.graph && !event.altKey) {
        const start = interaction.corner === 'start';
        const columnEdge = start ? startColumn : startColumn + interaction.initial.columnSpan;
        const rowEdge = start ? startRow : startRow + interaction.initial.rowSpan;
        const columnReal = columnEdge + ((event.clientX - interaction.startX) / zoom) / columnWidth;
        const rowReal = rowEdge + ((event.clientY - interaction.startY) / zoom) / rowHeight;
        const columnSnap = interaction.axes.has('inline') ? snappedLine(columnReal, snapLines(interaction.graph, interaction.nodeId, 'column'), columnWidth * zoom) : null;
        const rowSnap = interaction.axes.has('block') ? snappedLine(rowReal, snapLines(interaction.graph, interaction.nodeId, 'row'), rowHeight * zoom) : null;
        if (columnSnap !== null) columnDelta = columnSnap - columnEdge;
        if (rowSnap !== null) rowDelta = rowSnap - rowEdge;
      }

      let preview;
      if (interaction.corner === 'start') {
        // The far edge is the anchor. Moving the near edge one column left
        // both moves the origin and lengthens the span, so the opposite edge
        // does not budge -- which is what "pull" means and what the
        // bottom-right handle can never express.
        const columnEnd = startColumn + interaction.initial.columnSpan;
        const rowEnd = startRow + interaction.initial.rowSpan;
        const columnStart = Math.max(1, Math.min(columnEnd - 1, startColumn + columnDelta));
        const rowStart = Math.max(1, Math.min(rowEnd - 1, startRow + rowDelta));
        preview = {
          columnStart,
          rowStart,
          columnSpan: Math.max(1, Math.min(columns, columnEnd - columnStart)),
          rowSpan: Math.max(1, Math.min(MAX_ROW_SPAN, rowEnd - rowStart)),
        };
      } else {
        preview = {
          columnStart: startColumn,
          rowStart: startRow,
          columnSpan: Math.max(1, Math.min(columns, interaction.initial.columnSpan + columnDelta)),
          rowSpan: Math.max(1, Math.min(MAX_ROW_SPAN, interaction.initial.rowSpan + rowDelta)),
        };
      }
      // A pane above the player stops flush on top of it; a pane below it stops
      // flush under it. Neither can be stretched across it.
      const fold = heroFold && heroFold.gridId === interaction.gridElement?.dataset?.cwNodeId ? heroFold.line : null;
      interaction.foldStop = null;
      if (fold) {
        const initialEnd = startRow + interaction.initial.rowSpan;
        if (initialEnd <= fold && preview.rowStart + preview.rowSpan > fold) {
          preview.rowSpan = Math.max(1, fold - preview.rowStart);
          interaction.foldStop = 'above';
        } else if (startRow >= fold && preview.rowStart < fold) {
          preview.rowSpan = Math.max(1, preview.rowStart + preview.rowSpan - fold);
          preview.rowStart = fold;
          interaction.foldStop = 'below';
        }
      }
      interaction.preview = preview;
      const previewKey = `${preview.columnStart}:${preview.rowStart}:${preview.columnSpan}:${preview.rowSpan}`;
      if (previewKey !== interaction.previewKey) {
        interaction.previewKey = previewKey;
        // Say what release will do, including to the neighbours, while there is
        // still time to change it. A resize used to say nothing until it had
        // already thrown the Stage below the fold.
        const fitted = previewPackedResize(interaction, { ...preview });
        const planned = fitted ? findNode(interaction.packedGraph, interaction.nodeId)?.placement : null;
        if (planned) bridge.setStatus?.(`${planned.columnSpan} columns by ${planned.rowSpan} rows. Release to resize.${describePacking(interaction.packedGraph)}`, 'success');
        else bridge.setStatus?.(interaction.packedGraph ? 'That size does not fit: something in the way cannot give way. Release keeps the last size that fitted.' : 'That size does not fit: something in the way cannot give way.', 'warning');
      }
      // The pane follows the pointer exactly, on both axes, and the corner
      // opposite the one being dragged does not move. This used to be a grid
      // placement snapped to whole cells for the width and the near edge plus
      // a continuous min-height for the height -- so dragging the top-left
      // corner moved the top by a whole row while the height tracked the
      // pointer, the bottom edge and its corner slid away from where they had
      // been, and on release everything jumped again. Now the box, its corners
      // and the (scaled) content always agree, and the slot behind it shows
      // the cells it will occupy on release.
      if (interaction.liveOrigin) {
        const origin = interaction.liveOrigin;
        const deltaX = interaction.axes.has('inline') ? (event.clientX - interaction.startX) / zoom : 0;
        const deltaY = interaction.axes.has('block') ? (event.clientY - interaction.startY) / zoom : 0;
        const minWidth = Math.max(40, columnWidth);
        const minHeight = Math.min(origin.height, Number(interaction.shape?.minBlock) || 60);
        const fromStart = interaction.corner === 'start';
        const width = Math.max(Math.min(origin.width, minWidth), fromStart ? origin.width - deltaX : origin.width + deltaX);
        let height = Math.max(minHeight, fromStart ? origin.height - deltaY : origin.height + deltaY);
        // Held at the player the same way the slot is: the box does not slide
        // behind it while the pointer does.
        if (heroFold && interaction.foldStop === 'above' && !fromStart) {
          const room = (heroFold.top - interaction.paneRect.top) / zoom;
          if (room > 0) height = Math.min(height, room);
        }
        const pane = interaction.pane;
        pane.dataset.cwResizeLive = 'true';
        pane.style.setProperty('--cw-preview-inline-size', `${Math.round(width * 100) / 100}px`);
        pane.style.setProperty('--cw-preview-block-size', `${Math.round(height * 100) / 100}px`);
        pane.style.setProperty('--cw-preview-x', `${fromStart ? Math.round((origin.width - width) * 100) / 100 : 0}px`);
        pane.style.setProperty('--cw-preview-y', `${fromStart ? Math.round((origin.height - height) * 100) / 100 : 0}px`);
      } else if (interaction.axes.has('block')) {
        interaction.pane.dataset.cwResizePreview = 'true';
        const minimum = Number(interaction.shape?.minBlock) || 60;
        // Dragging the top edge upwards makes the pane taller, so the height
        // moves against the pointer rather than with it.
        // The pane rect and the pointer are both on screen, so both carry the
        // zoom; the property is read inside the scaled artboard, in layout
        // pixels. Measured in the app at 0.5x, leaving the zoom in made the
        // edge trail the pointer by 120px over 130px of travel.
        const grown = (interaction.corner === 'start'
          ? interaction.paneRect.height - (event.clientY - interaction.startY)
          : interaction.paneRect.height + (event.clientY - interaction.startY)) / zoom;
        interaction.pane.style.setProperty('--cw-preview-block-size', `${Math.max(minimum, Math.round(grown))}px`);
      }
      updateResizeVisuals(interaction);
    }

    function updateResize(event, interaction) {
      if (interaction?.kind === 'split') updateSplitResize(event, interaction);
      else if (interaction?.kind === 'pane-resize') updatePaneResize(event, interaction);
    }

    function handlePointerMove(event) {
      if (controlDrag) {
        if (controlDrag.pointerId === event.pointerId) { event.preventDefault(); controlDrag.gesture.move(event); }
        return;
      }
      if (bodyPress && !pointerInteraction) promoteBodyPress(event);
      if (!pointerInteraction || pointerInteraction.pointerId !== event.pointerId) return;
      if (pointerInteraction.kind === 'pane') {
        // Move the compositor-only proxy before scheduling any graph, hit-test,
        // or reflow work. Writing the latest transform in the pointer task lets
        // the browser use it in the very next paint; doing this inside the RAF
        // callback can miss that paint and makes pickup feel one frame late.
        if (event.clientX !== pointerInteraction.startX || event.clientY !== pointerInteraction.startY) {
          positionLiftedPane(event, pointerInteraction);
          documentObject.body.dataset.cwStudioPointer = 'dragging-pane';
        }
        const displacement = Math.hypot(event.clientX - pointerInteraction.startX, event.clientY - pointerInteraction.startY);
        if (!pointerInteraction.firstPlacementUpdate && displacement >= 2) {
          pointerInteraction.firstPlacementUpdate = true;
          updatePaneDrag(event, pointerInteraction);
          return;
        }
        // Synthetic integration events remain synchronous. Real mouse and pen
        // streams are coalesced to the display cadence so a 500-1000 Hz device
        // cannot force an equal number of hit tests and layout reads.
        if (!event.isTrusted || typeof documentObject.defaultView?.requestAnimationFrame !== 'function') {
          updatePaneDrag(event, pointerInteraction);
          return;
        }
        queuedPanePoint = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, target: event.target, altKey: event.altKey };
        if (pointerFrame) return;
        pointerFrame = documentObject.defaultView.requestAnimationFrame(() => {
          pointerFrame = 0;
          const point = queuedPanePoint;
          queuedPanePoint = null;
          if (point && pointerInteraction?.kind === 'pane' && pointerInteraction.pointerId === point.pointerId) updatePaneDrag(point, pointerInteraction);
        });
      }
      else if (pointerInteraction.kind === 'split' || pointerInteraction.kind === 'pane-resize') {
        const updateNow = () => updateResize(event, pointerInteraction);
        if (!pointerInteraction.firstResizeUpdate) {
          pointerInteraction.firstResizeUpdate = true;
          updateNow();
          return;
        }
        if (!event.isTrusted || typeof documentObject.defaultView?.requestAnimationFrame !== 'function') {
          updateNow();
          return;
        }
        queuedResizePoint = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, altKey: event.altKey };
        if (pointerFrame) return;
        pointerFrame = documentObject.defaultView.requestAnimationFrame(() => {
          pointerFrame = 0;
          const point = queuedResizePoint;
          queuedResizePoint = null;
          if (point && pointerInteraction && ['split', 'pane-resize'].includes(pointerInteraction.kind) && pointerInteraction.pointerId === point.pointerId) {
            updateResize(point, pointerInteraction);
          }
        });
      }
    }

    function handlePointerEnd(event) {
      if (controlDrag?.pointerId === event.pointerId) {
        const drag = controlDrag;
        controlDrag = null;
        drag.gesture.end(event);
        return;
      }
      if (bodyPress?.pointerId === event.pointerId) bodyPress = null;
      if (!pointerInteraction || pointerInteraction.pointerId !== event.pointerId) return;
      const interaction = pointerInteraction;
      // The click that follows letting go of a pane moved by its body lands on
      // whatever product control is under the pointer. It must not play a
      // track because a pane was put down on top of it.
      // The click is dispatched straight after this handler, so the window is
      // short enough that a deliberate click a moment later is never eaten.
      if (interaction.fromBody) suppressBodyClickUntil = Date.now() + 60;
      if (interaction.kind === 'pane') {
        if (pointerFrame) documentObject.defaultView?.cancelAnimationFrame?.(pointerFrame);
        pointerFrame = 0;
        if (queuedPanePoint) {
          const point = queuedPanePoint;
          queuedPanePoint = null;
          updatePaneDrag(point, interaction);
        }
        // Layout animation, autoscroll, or a final one-pixel pointer movement can
        // change what is under the same screen coordinate between the last move
        // and pointerup. Re-resolve only when the pointer actually moved; the
        // placeholder's own reflow must never reverse the already chosen slot.
        // A chosen grid cell holds the same way as a chosen attach: re-resolving
        // it also ran autoscroll, so a release near the viewport edge scrolled
        // once more and committed the cell below the one on screen.
        const finalMovement = Math.hypot(event.clientX - Number(interaction.lastPointerX ?? event.clientX), event.clientY - Number(interaction.lastPointerY ?? event.clientY));
        const chosen = interaction.lastValidIntent || interaction.lastValidGridPlacement;
        if (!chosen || finalMovement > 4) updatePaneDrag(event, interaction);
      }
      if (interaction.kind === 'split' || interaction.kind === 'pane-resize') {
        if (pointerFrame) documentObject.defaultView?.cancelAnimationFrame?.(pointerFrame);
        pointerFrame = 0;
        if (queuedResizePoint) {
          const point = queuedResizePoint;
          queuedResizePoint = null;
          updateResize(point, interaction);
        }
      }
      if (interaction.kind === 'pane' && !interaction.gridPlacement && interaction.intent) {
        const intent = interaction.intent;
        const sourceId = interaction.sourceId;
        restoreLiveReflow(interaction, false);
        finishPointer('', { restoreLive: false });
        // Only the relationship on screen at release is attempted. A refused
        // one used to be retried as whatever the placeholder's neighbours
        // suggested -- a different kind, sometimes a different pane -- and
        // announced as a success. The host already reports why a refusal
        // happened, so a refusal is left as one.
        if (!bridge.applyDropIntent(intent, 'pointer')) return;
        // It was committed but did not come out as aimed. This used to claim
        // the canvas had been returned to its last layout, while the change sat
        // on the canvas and in the undo history.
        if (!dropIntentSatisfied(bridge.snapshot().graph, intent)) {
          bridge.setStatus?.('The pane was attached, but not exactly as aimed. Check it, or undo to put it back.', 'warning');
          return;
        }
        bridge.select?.(sourceId);
        return;
      }
      if (interaction.kind === 'pane' && interaction.gridPlacement) {
        const placement = interaction.gridPlacement;
        const graph = interaction.gridGraph || packedGridGraph(bridge.snapshot().graph, interaction.sourceId, placement);
        const sourceId = interaction.sourceId;
        restoreLiveReflow(interaction, false);
        finishPointer('', { restoreLive: false });
        // What the packer planned, which is not always what was asked for: a
        // pane pushed against an anchored one is shrunk to clear it. The message
        // names the plan, and the check compares against it, so a pane that
        // was trimmed is not reported as a failure that left things unchanged.
        const planned = graph ? findNode(graph, sourceId)?.placement : null;
        if (!planned) {
          bridge.setStatus?.(DROP_REFUSALS['refused-cell'], 'warning');
          return;
        }
        const trimmed = planned.columnSpan !== placement.columnSpan || planned.rowSpan !== placement.rowSpan;
        // Released where it started. Sending that to the session produced its
        // internal refusal -- 'Operation "restoreGraph" did not change the
        // composition.' -- as an error, for a gesture that had done nothing wrong.
        if (sameLayout(graph, bridge.snapshot().graph)) {
          bridge.setStatus?.('Released where it started. Nothing changed.', 'success');
          return;
        }
        const applied = bridge.dispatch({ type: 'restoreGraph', graph }, `Pane placed at grid column ${planned.columnStart}, row ${planned.rowStart}${trimmed ? `, resized to ${planned.columnSpan} by ${planned.rowSpan} to clear an anchored pane` : ''}.${describePacked(graph) || ' Nothing else moved.'}`, { layoutOnly: true });
        if (!applied?.ok) return;
        const committed = findNode(bridge.snapshot().graph, sourceId)?.placement;
        if (!committed || committed.columnStart !== planned.columnStart || committed.rowStart !== planned.rowStart) bridge.setStatus?.('The pane moved, but not to the planned cell. Check it, or undo to put it back.', 'warning');
        else bridge.select?.(sourceId);
        return;
      }
      if (interaction.kind === 'split' && interaction.preview) {
        const preview = interaction.preview;
        const splitId = interaction.splitId;
        // Commit beneath the still-visible compositor preview, then reveal the
        // product's authoritative responsive layout at its final dimensions.
        bridge.dispatch({ type: 'resizeSplit', splitId, weights: preview }, `Split resized to ${Math.round(preview[0] * 100)} / ${Math.round(preview[1] * 100)}.`);
        finishPointer();
        return;
      }
      if (interaction.kind === 'pane-resize' && interaction.preview) {
        const preview = interaction.preview;
        const nodeId = interaction.nodeId;
        // The top-left handle changes the origin as well as the span, so the
        // commit has to take the preview's coordinates rather than the ones the
        // gesture started from.
        const graph = interaction.packedGraph || packedGridGraph(interaction.graph, nodeId, {
          columnStart: preview.columnStart || interaction.initial.columnStart || 1,
          rowStart: preview.rowStart || interaction.initial.rowStart || 1,
          columnSpan: preview.columnSpan,
          rowSpan: preview.rowSpan,
        });
        // Name the size that was committed, which is the last one that fitted
        // -- not the pointer's final size when the pointer went further than
        // the packer would follow. And a resize that fitted nowhere says so;
        // it used to spring back in complete silence.
        const planned = graph ? findNode(graph, nodeId)?.placement : null;
        const trimmed = planned && (planned.columnSpan !== preview.columnSpan || planned.rowSpan !== preview.rowSpan);
        // The preview moved neighbours by transform. Those transforms have to
        // come off before the commit repaints the real placements; nothing else
        // on this path removed them, so a pane pushed down by a resize stayed
        // pushed down a second time on top of its new row -- visibly below the
        // player, through undo, in and out of Composition Mode, until reload.
        restoreGridPreview(interaction);
        if (planned && sameLayout(graph, bridge.snapshot().graph)) {
          finishPointer('');
          // Asked for more than it got back: say what stopped it.
          const grid = parentOf(interaction.graph, nodeId);
          const asked = { columnStart: preview.columnStart || interaction.initial.columnStart || 1, rowStart: preview.rowStart || interaction.initial.rowStart || 1, columnSpan: preview.columnSpan, rowSpan: preview.rowSpan };
          const wall = (grid?.children || []).find((child) => child.id !== nodeId && pinHoldsPosition(pinOf(child)) && child.placement
            && asked.columnStart < child.placement.columnStart + child.placement.columnSpan && child.placement.columnStart < asked.columnStart + asked.columnSpan
            && asked.rowStart < child.placement.rowStart + child.placement.rowSpan && child.placement.rowStart < asked.rowStart + asked.rowSpan);
          bridge.setStatus?.(wall ? `${moduleLabel(wall)} is anchored, so there is no room to grow into it. Nothing changed.` : 'Same size as before. Nothing changed.', wall ? 'warning' : 'success');
          return;
        }
        const applied = planned && bridge.dispatch({ type: 'restoreGraph', graph }, `Pane resized to ${planned.columnSpan} columns by ${planned.rowSpan} rows${trimmed ? ', the largest size that fits there' : ''}.${describePacked(graph)}`, { layoutOnly: true });
        if (!applied?.ok) restoreGridPreview(interaction);
        finishPointer(planned ? '' : 'That size does not fit: something in the way cannot move aside. The pane kept its size.');
        if (applied?.ok) bridge.select?.(nodeId);
        return;
      }
      if (interaction.kind === 'pane') {
        // A press on the grip that never moved is a click, and the click has
        // its own handler. Anything that moved and landed nowhere gets the
        // reason it landed nowhere.
        const moved = Number.isFinite(interaction.lastPointerX)
          && Math.hypot(interaction.lastPointerX - interaction.startX, interaction.lastPointerY - interaction.startY) >= 4;
        finishPointer(moved ? (DROP_REFUSALS[interaction.refusal] || 'Nothing changed: the pane was released where it cannot go.') : '');
        return;
      }
      finishPointer('Nothing changed. Drag onto a pane or move a resize handle farther.');
    }

    function handlePointerCancel(event) {
      if (controlDrag?.pointerId === event.pointerId) {
        const drag = controlDrag;
        controlDrag = null;
        drag.gesture.cancel();
        return;
      }
      if (bodyPress?.pointerId === event.pointerId) bodyPress = null;
      if (!pointerInteraction || pointerInteraction.pointerId !== event.pointerId) return;
      const interaction = pointerInteraction;
      if (interaction.kind === 'split') {
        const total = interaction.weights.reduce((sum, value) => sum + Number(value || 0), 0) || 1;
        const fractions = interaction.weights.map((value) => Number(value || 0) / total);
        interaction.surface.style.setProperty('--cw-split-template', fractions.map((weight) => `minmax(0, ${weight}fr)`).join(' '));
        interaction.surface.querySelector(':scope > .cw-split-handle')?.setAttribute('aria-valuenow', String(Math.round(fractions[0] * 100)));
      } else if (interaction.kind === 'pane-resize') {
        restoreGridPreview(interaction);
      }
      finishPointer('Gesture cancelled. The canvas was not changed.');
    }

    /* ---- rail ----------------------------------------------------------- */

    function buildRail() {
      rail = element('aside', 'cw-studio-rail');
      rail.setAttribute('aria-label', 'Canvas Studio');
      rail.tabIndex = -1;

      const head = element('div', 'cw-studio-head');
      head.append(element('small', '', 'CANVAS STUDIO'), element('strong', 'cw-studio-title', 'Untitled canvas'));
      sections.state = element('span', 'cw-studio-state', '');
      head.append(sections.state);
      rail.append(head);

      const shortcuts = element('p', 'cw-studio-shortcuts');
      shortcuts.append(
        element('span', '', 'Quick keys'),
        element('kbd', '', '/'), documentObject.createTextNode(' find'),
        element('kbd', '', 'Ctrl Z'), documentObject.createTextNode(' undo'),
        element('kbd', '', 'Ctrl D'), documentObject.createTextNode(' duplicate'),
        element('kbd', '', 'Shift F10'), documentObject.createTextNode(' pane menu'),
      );
      rail.append(shortcuts);

      sections.status = element('p', 'cw-studio-live-status', 'Canvas Studio ready.');
      sections.status.setAttribute('role', 'status');
      sections.status.setAttribute('aria-live', 'polite');
      rail.append(sections.status);

      sections.readiness = element('div', 'cw-studio-section cw-studio-readiness');
      rail.append(sections.readiness);

      sections.templates = element('div', 'cw-studio-section cw-studio-templates');
      rail.append(sections.templates);

      sections.tray = element('div', 'cw-studio-section cw-studio-tray');
      rail.append(sections.tray);

      sections.selection = element('div', 'cw-studio-section cw-studio-selection');
      rail.append(sections.selection);

      sections.splits = element('div', 'cw-studio-section cw-studio-splits');
      rail.append(sections.splits);

      sections.groups = element('div', 'cw-studio-section cw-studio-groups');
      rail.append(sections.groups);

      sections.view = element('div', 'cw-studio-section cw-studio-view');
      rail.append(sections.view);

      const history = element('div', 'cw-studio-section cw-studio-history');
      history.append(element('h3', '', 'History'));
      const historyRow = element('div', 'cw-studio-row');
      sections.undo = button('Undo', 'Undo the last composition edit', () => bridge.undo());
      sections.redo = button('Redo', 'Redo the last undone edit', () => bridge.redo());
      historyRow.append(sections.undo, sections.redo);
      history.append(historyRow, button('Restore starting canvas', 'Stage the creator default again', () => bridge.restore(), 'cw-studio-button cw-studio-wide'));
      rail.append(history);

      sections.commit = element('div', 'cw-studio-section cw-studio-commit');
      rail.append(sections.commit);
      return rail;
    }

    function buildLauncher() {
      launcher = button('Edit canvas', 'Enter Composition Mode', () => bridge.enter(), 'cw-studio-launcher');
      launcher.setAttribute('aria-label', 'Edit this canvas');
      legacyLauncher = button('Return to Studio', 'Leave the development Canvas and restore Studio', () => bridge.returnToLegacy?.(), 'cw-studio-legacy-launcher');
      addLauncher = button('+ Add pane', 'Add a module without opening the Canvas Studio sidebar', () => {
        const rect = addLauncher.getBoundingClientRect();
        openAddPaneMenu(rect.right - 310, rect.bottom + 8, addLauncher);
      }, 'cw-canvas-add-button');
      addLauncher.setAttribute('aria-haspopup', 'menu');
      addLauncher.setAttribute('aria-label', 'Add a pane to the canvas');
      return launcher;
    }

    function renderReadiness(graph) {
      const target = sections.readiness;
      target.replaceChildren();
      const missing = missingJobs(graph);
      target.append(element('h3', '', 'Required jobs'));
      const list = element('ul', 'cw-studio-jobs');
      bridge.requiredJobs().forEach((job) => {
        const item = element('li', '', job.replace(/-/g, ' '));
        item.dataset.met = String(!missing.includes(job));
        list.append(item);
      });
      target.append(list);
      const note = element('p', 'cw-studio-note', missing.length
        ? `${missing.length} still unplaced. The canvas can be saved once every job has a home.`
        : 'Every required job is reachable. This canvas can be saved.');
      target.append(note);
    }

    function renderTray(graph) {
      const target = sections.tray;
      target.replaceChildren();
      const available = unplacedSpecs(graph);
      const heading = element('h3', '', `Tray · ${available.length}`);
      target.append(heading);
      if (!available.length) {
        sections.traySearch = null;
        target.append(element('p', 'cw-studio-note', 'Everything is on the canvas. Remove a pane to put it back here.'));
        return;
      }
      const container = findNode(graph, insertionTarget(graph));
      target.append(element('p', 'cw-studio-note', `Placing into ${container ? `${container.type} · ${container.id}` : 'the canvas'}.`));
      const search = documentObject.createElement('input');
      search.type = 'search';
      search.className = 'cw-studio-tray-search';
      search.placeholder = 'Find a module';
      search.value = trayFilter;
      search.setAttribute('aria-label', 'Filter modules in the tray');
      sections.traySearch = search;
      target.append(search);
      const list = element('div', 'cw-studio-tray-list');
      const counts = placedCounts(graph);
      available.forEach((spec) => {
        const item = element('button', 'cw-studio-tray-item');
        item.type = 'button';
        const count = counts.get(spec.key) || 0;
        const instanceLabel = spec.instancePolicy === 'multiple' ? ` · ${count} of ${Math.max(1, Number(spec.maxInstances) || 4)} placed` : '';
        const boundary = spec.rootPolicy === 'embedded-fallback'
          ? `embedded in ${bridge.specs()[spec.ownerKey]?.label || spec.ownerKey} until placed`
          : spec.rootPolicy === 'shared-shell-member' ? 'shared playback shell until placed' : '';
        item.append(element('strong', '', spec.label), element('small', '', [(spec.jobs || []).join(' · ') || 'optional', boundary, instanceLabel].filter(Boolean).join(' · ')));
        item.dataset.cwSearchText = [spec.label, spec.key, ...(spec.jobs || [])].join(' ').toLocaleLowerCase();
        item.title = `Place ${spec.label} on the canvas`;
        item.addEventListener('click', (event) => { event.preventDefault(); placeModule(spec); });
        list.append(item);
      });
      const empty = element('p', 'cw-studio-note cw-studio-tray-empty', 'No tray modules match that search.');
      empty.hidden = true;
      empty.setAttribute('role', 'status');
      const applyFilter = () => {
        trayFilter = search.value.trimStart().slice(0, 80);
        const query = trayFilter.trim().toLocaleLowerCase();
        let visible = 0;
        list.querySelectorAll('.cw-studio-tray-item').forEach((item) => {
          const match = !query || item.dataset.cwSearchText.includes(query);
          item.hidden = !match;
          if (match) visible += 1;
        });
        heading.textContent = query ? `Tray · ${visible} of ${available.length}` : `Tray · ${available.length}`;
        empty.hidden = visible !== 0;
      };
      search.addEventListener('input', applyFilter);
      target.append(list, empty);
      applyFilter();
    }

    function renderTemplates(graph) {
      const target = sections.templates;
      target.replaceChildren();
      target.append(element('h3', '', 'Layout templates'));
      const preview = element('p', 'cw-studio-note', 'Focus or hover a template to see what it changes. Applying one preserves every currently placed pane.');
      const list = element('div', 'cw-studio-template-list');
      TEMPLATE_DEFINITIONS.forEach((definition) => {
        const control = button(definition.label, `Preview and apply ${definition.label}`, () => applyTemplate(definition.key), 'cw-studio-button cw-studio-template');
        const show = () => {
          const pairKey = definition.key === 'queue-session' ? 'queue.view' : definition.key === 'visual-listening' ? 'audio.visualizer' : definition.key === 'technical' ? 'track.information' : '';
          const availability = pairKey && !modulesIn(graph).some((node) => node.moduleKey === pairKey) ? ` ${bridge.specs()[pairKey]?.label || pairKey} is not placed yet, so the template will use the Focus fallback.` : '';
          preview.textContent = `${definition.summary}${availability}`;
          documentObject.body.dataset.cwTemplatePreview = definition.key;
        };
        const clear = () => { delete documentObject.body.dataset.cwTemplatePreview; };
        control.addEventListener('pointerenter', show);
        control.addEventListener('focus', show);
        control.addEventListener('pointerleave', clear);
        control.addEventListener('blur', clear);
        list.append(control);
      });
      target.append(list, preview);
    }

    function renderSelection(graph) {
      const target = sections.selection;
      target.replaceChildren();
      const node = selectedModule(graph);
      target.append(element('h3', '', 'Selected pane'));
      if (!node) {
        target.append(element('p', 'cw-studio-note', 'Click a pane on the canvas to select it.'));
        return;
      }
      const spec = bridge.specs()[node.moduleKey] || {};
      target.append(element('strong', 'cw-studio-selected-name', spec.label || node.moduleKey));
      const parent = parentOf(graph, node.id);
      target.append(element('p', 'cw-studio-note', `Location: ${parent?.type || 'canvas'}${parent?.id ? ` · ${parent.id}` : ''}. Drag the Move handle, or use the destination controls below.`));

      const alternatives = modulesIn(graph).filter((candidate) => candidate.id !== node.id);
      if (alternatives.length) {
        const destination = element('label', 'cw-studio-field cw-studio-target-field');
        destination.append(element('span', '', pickedSourceId === node.id ? 'Picked up · destination pane' : 'Arrange with pane'));
        const targetSelect = documentObject.createElement('select');
        targetSelect.setAttribute('aria-label', `Destination pane for ${moduleLabel(node)}`);
        alternatives.forEach((candidate) => {
          const option = documentObject.createElement('option');
          option.value = candidate.id;
          option.textContent = moduleLabel(candidate);
          if ((keyboardTargetId || alternatives[0].id) === candidate.id) option.selected = true;
          targetSelect.append(option);
        });
        keyboardTargetId = targetSelect.value;
        targetSelect.addEventListener('change', () => {
          keyboardTargetId = targetSelect.value;
          paintSelection();
          bridge.setStatus?.(`${moduleLabel(node)} will be arranged relative to ${moduleLabel(findNode(graph, keyboardTargetId))}. Choose a relationship to commit.`, 'success');
        });
        sections.targetSelect = targetSelect;
        destination.append(targetSelect);
        target.append(destination);

        const relative = element('div', 'cw-studio-target-actions');
        [
          ['Before', 'move-before'], ['After', 'move-after'],
          ['Split left', 'split-before-horizontal'], ['Split right', 'split-after-horizontal'],
          ['Split above', 'split-before-vertical'], ['Split below', 'split-after-vertical'],
          ['Stack with', 'stack'],
        ].forEach(([label, kind]) => relative.append(button(label, `${label} ${moduleLabel(findNode(graph, keyboardTargetId))}`, () => {
          const applied = applySelectedIntent(kind, targetSelect.value, pickedSourceId ? 'keyboard' : 'menu');
          if (applied) {
            pickedSourceId = '';
            keyboardTargetId = '';
            paintSelection();
            render();
          }
        })));
        if (pickedSourceId === node.id) relative.append(button('Cancel move', 'Cancel without changing the canvas', cancelMove));
        target.append(relative);
      }

      const grow = element('div', 'cw-studio-row');
      grow.append(
        button('Add next →', 'Place the next tray module beside this pane', () => splitSelected('horizontal')),
        button('Add next ↓', 'Place the next tray module below this pane', () => splitSelected('vertical')),
        button('Add next to stack', 'Stack the next tray module with this pane', () => stackOnSelected()),
      );
      target.append(grow);

      const arrange = element('div', 'cw-studio-row');
      arrange.append(
        button('One position earlier', 'Move this pane before its previous sibling', () => moveSelected(false)),
        button('One position later', 'Move this pane after its next sibling', () => moveSelected(true)),
      );
      if (['split', 'stack'].includes(parent?.type)) arrange.append(button(`Remove from ${parent.type}`, `Keep both panes but dissolve this ${parent.type} relationship`, recombineSelected));
      target.append(arrange);

      const shapeRow = element('label', 'cw-studio-field');
      shapeRow.append(element('span', '', 'Shape'));
      const select = documentObject.createElement('select');
      const allowed = (spec.shapes || []).length ? spec.shapes : SHAPE_ORDER;
      allowed.forEach((shape) => {
        const option = documentObject.createElement('option');
        option.value = shape;
        option.textContent = shape;
        if (shape === node.shape) option.selected = true;
        select.append(option);
      });
      select.addEventListener('change', () => setShape(select.value));
      shapeRow.append(select);
      target.append(shapeRow);

      const effectsPanel = element('fieldset', 'cw-studio-effects');
      effectsPanel.append(element('legend', '', 'Motion & particles'));
      effectsPanel.append(
        effectField(node, 'animation', 'Module animation'),
        effectField(node, 'particles', 'Particle field'),
        effectField(node, 'trigger', 'Activation'),
        effectField(node, 'intensity', 'Intensity'),
        effectField(node, 'speed', 'Speed'),
      );
      effectsPanel.append(element('p', 'cw-studio-note', 'Effects stay inside this pane and automatically stop for Motion Off, reduced motion, or Performance Conserve.'));
      target.append(effectsPanel);

      const counts = placedCounts(graph);
      const replacements = bridge.moduleSpecs().filter((candidate) => {
        if (candidate.key === node.moduleKey) return false;
        const count = counts.get(candidate.key) || 0;
        return candidate.instancePolicy === 'multiple' ? count < Math.max(1, Number(candidate.maxInstances) || 4) : count === 0;
      });
      if (replacements.length) {
        const replaceField = element('div', 'cw-studio-field');
        replaceField.append(element('span', '', 'Replace with'));
        const replaceSelect = documentObject.createElement('select');
        replaceSelect.setAttribute('aria-label', `Replacement module for ${moduleLabel(node)}`);
        replacements.forEach((candidate) => {
          const option = documentObject.createElement('option');
          option.value = candidate.key;
          option.textContent = candidate.label;
          replaceSelect.append(option);
        });
        replaceField.append(replaceSelect, button('Replace pane', 'Replace this pane while preserving its position', () => replaceSelected(replaceSelect.value)));
        target.append(replaceField);
      }

      const moduleActions = element('div', 'cw-studio-row');
      moduleActions.append(button('Reset pane settings', 'Restore this module shape and configuration', resetSelectedModule));
      if (spec.instancePolicy === 'multiple' && (counts.get(node.moduleKey) || 0) < Math.max(1, Number(spec.maxInstances) || 4)) moduleActions.append(button('Duplicate pane', 'Add another independent instance of this module', duplicateSelected));
      if ((spec.shapes || []).includes('ambient') && parent?.type !== 'overlay') moduleActions.append(button('Make ambient', 'Place this module in a contained ambient overlay', assignSelectedAmbient));
      target.append(moduleActions);

      // Size, position and anchor belong to what is placed on the grid. For a
      // pane standing for its section that is the section: anchoring the pane
      // inside it anchored something nothing ever pushes.
      const layoutNode = placementOwnerOf(graph, node.id) || node;
      const placement = selectedGridPlacement(graph, layoutNode);
      if (placement) {
        const axes = new Set((bridge.shapes()[node.shape] || {}).resizeAxes || ['inline', 'block']);
        const sizeRow = element('div', 'cw-studio-row cw-studio-size-row');
        if (axes.has('inline')) {
          const narrower = button('Narrower', 'Reduce pane width by one grid column', () => setPlacement(layoutNode.id, placement.columnSpan - 1, placement.rowSpan));
          narrower.disabled = placement.columnSpan <= 1;
          const wider = button('Wider', 'Increase pane width by one grid column', () => setPlacement(layoutNode.id, Math.min(placement.parent.columns, placement.columnSpan + 1), placement.rowSpan));
          wider.disabled = placement.columnSpan >= placement.parent.columns;
          sizeRow.append(narrower, wider);
        }
        if (axes.has('block')) {
          const shorter = button('Shorter', 'Reduce pane height by one grid row', () => setPlacement(layoutNode.id, placement.columnSpan, placement.rowSpan - 1));
          shorter.disabled = placement.rowSpan <= 1;
          const taller = button('Taller', 'Increase pane height by one grid row', () => setPlacement(layoutNode.id, placement.columnSpan, placement.rowSpan + 1));
          taller.disabled = placement.rowSpan >= 24;
          sizeRow.append(shorter, taller);
        }
        if (sizeRow.childElementCount) {
          sizeRow.append(button('Theme size', 'Clear the explicit grid size and return to the theme default', () => resetPlacement(layoutNode.id)));
          target.append(sizeRow);
        }

        const columnStart = placement.columnStart || 1;
        const rowStart = placement.rowStart || 1;
        const nudge = (columnDelta, rowDelta, direction) => setPlacement(
          layoutNode.id,
          placement.columnSpan,
          placement.rowSpan,
          `${moduleLabel(node)} moved ${direction}.`,
          { columnStart: columnStart + columnDelta, rowStart: rowStart + rowDelta },
        );
        const moveRow = element('div', 'cw-studio-row cw-studio-move-row');
        const left = button('Left', 'Move this pane one grid column left', () => nudge(-1, 0, 'left'));
        left.disabled = columnStart <= 1;
        const right = button('Right', 'Move this pane one grid column right', () => nudge(1, 0, 'right'));
        right.disabled = (columnStart + placement.columnSpan - 1) >= placement.parent.columns;
        const up = button('Up', 'Move this pane one grid row up', () => nudge(0, -1, 'up'));
        up.disabled = rowStart <= 1;
        const down = button('Down', 'Move this pane one grid row down', () => nudge(0, 1, 'down'));
        down.disabled = (rowStart + placement.rowSpan - 1) >= MAX_ROWS;
        moveRow.append(left, right, up, down);
        target.append(moveRow);

        const currentPin = pinOf(layoutNode);
        const anchorRow = element('div', 'cw-studio-row cw-studio-anchor-row');
        anchorRow.setAttribute('role', 'group');
        anchorRow.setAttribute('aria-label', 'Anchor');
        [
          ['none', 'Let this pane be moved and resized by what is dragged at it'],
          ['firm', 'Keep this pane exactly where and as it is. Anything dragged into it gives way instead'],
        ].forEach(([state, title]) => {
          const control = button(PIN_LABELS[state], title, () => setPin(layoutNode.id, state));
          control.setAttribute('aria-pressed', String(currentPin === state));
          control.dataset.cwPinOption = state;
          control.disabled = currentPin === state;
          anchorRow.append(control);
        });
        target.append(anchorRow);
      }

      const requiredJobs = (spec.jobs || []).filter((job) => bridge.requiredJobs().includes(job));
      if (requiredJobs.length) target.append(element('p', 'cw-studio-note cw-studio-warning', `Required pane: removing it will lock Save until ${requiredJobs.map((job) => job.replace(/-/g, ' ')).join(', ')} is restored.`));
      target.append(button('Return to tray', requiredJobs.length ? 'Remove this required pane; Save will remain locked until it is restored' : 'Remove this pane from the canvas', () => removeSelected(), 'cw-studio-button cw-studio-wide cw-studio-danger'));
    }

    function renderSplits(graph) {
      const target = sections.splits;
      target.replaceChildren();
      const splits = splitsIn(graph);
      target.append(element('h3', '', `Splits · ${splits.length}`));
      if (!splits.length) {
        target.append(element('p', 'cw-studio-note', 'No splits yet. Use Split → or Split ↓ on a selected pane.'));
        return;
      }
      splits.forEach((split) => {
        const row = element('label', 'cw-studio-field');
        const total = (split.weights || []).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
        const ratio = Number(split.weights?.[0] || 0.5) / total;
        row.append(element('span', '', `${split.axis === 'vertical' ? 'Vertical' : 'Horizontal'} · ${Math.round(ratio * 100)}%`));
        const range = documentObject.createElement('input');
        range.type = 'range';
        range.min = '20';
        range.max = '80';
        range.step = '1';
        range.value = String(Math.round(ratio * 100));
        range.setAttribute('aria-label', `${split.axis} split first pane percentage`);
        range.setAttribute('aria-valuetext', `${Math.round(ratio * 100)} percent and ${Math.round((1 - ratio) * 100)} percent`);
        range.addEventListener('change', () => resizeSplit(split, Number(range.value) / 100));
        row.append(range, button('Equal panes', 'Set this split to 50 / 50', () => resizeSplit(split, 0.5)));
        target.append(row);
      });
    }

    function renderGroups(graph) {
      const target = sections.groups;
      target.replaceChildren();
      const groups = [];
      walk(graph, (node) => { if (['split', 'stack'].includes(node.type)) groups.push(node); });
      target.append(element('h3', '', `Groups · ${groups.length}`));
      if (!groups.length) {
        target.append(element('p', 'cw-studio-note', 'No groups yet. Split or stack two panes to create one.'));
        return;
      }
      groups.forEach((group) => {
        const card = element('div', 'cw-studio-group-card');
        card.toggleAttribute('data-selected', group.id === selectedGroupId);
        card.append(element('strong', '', `${group.type === 'stack' ? 'Stack' : `${group.axis} split`} · ${group.id}`));
        card.append(element('small', '', group.children.map(moduleLabel).join(' · ')));
        if (group.type === 'stack') {
          const row = element('div', 'cw-studio-row');
          group.children.forEach((child) => row.append(button(`Show ${moduleLabel(child)}`, `Make ${moduleLabel(child)} the visible stack pane`, () => activateStackChild(group, child.id))));
          card.append(row);
        }
        const parent = parentOf(graph, group.id);
        const index = parent?.children?.findIndex((child) => child.id === group.id) ?? -1;
        const groupActions = element('div', 'cw-studio-row');
        groupActions.append(button(group.id === selectedGroupId ? 'Group selected' : 'Select group', `Select this ${groupLabel(group)} as one layout unit`, () => selectGroup(group.id)));
        const earlier = button('Group earlier', `Move this ${groupLabel(group)} before its previous neighbour`, () => moveGroup(group.id, false));
        earlier.disabled = index <= 0;
        const later = button('Group later', `Move this ${groupLabel(group)} after its next neighbour`, () => moveGroup(group.id, true));
        later.disabled = index < 0 || index >= (parent?.children?.length || 0) - 1;
        groupActions.append(earlier, later);
        if (['grid', 'stack'].includes(parent?.type)) groupActions.append(button('Dissolve group', `Remove the ${groupLabel(group)} relationship but keep every pane`, () => dissolveGroup(group.id)));
        card.append(groupActions);
        target.append(card);
      });
    }

    function renderCommit(graph) {
      const target = sections.commit;
      target.replaceChildren();
      const missing = missingJobs(graph);
      const snapshot = bridge.snapshot();
      const save = button(snapshot.dirty ? 'Save canvas' : 'Nothing to save', 'Commit this canvas atomically', () => {
        if (missing.length) return;
        bridge.save();
      }, 'cw-studio-button cw-studio-wide cw-studio-primary');
      save.disabled = Boolean(missing.length) || !snapshot.dirty;
      if (missing.length) save.title = `Place ${missing.join(', ')} before saving.`;
      target.append(save);
      target.append(button('Discard draft', 'Leave Composition Mode without a durable write', () => bridge.cancel(), 'cw-studio-button cw-studio-wide'));
      const leave = button('Return to Studio', 'Leave Canvas Studio and restore the Studio workspace', () => bridge.returnToLegacy?.(), 'cw-studio-button cw-studio-wide');
      leave.disabled = Boolean(snapshot.dirty);
      if (snapshot.dirty) leave.title = 'Save or discard this draft before returning to Studio.';
      target.append(leave);
    }

    function render() {
      if (!rail) return;
      const snapshot = bridge.snapshot();
      lastGraph = snapshot.graph;
      const editing = snapshot.mode === 'edit';
      const leavingEdit = wasEditing && !editing;
      wasEditing = editing;
      rail.hidden = !editing;
      if (launcher) launcher.hidden = editing;
      if (legacyLauncher) legacyLauncher.hidden = editing;
      if (addLauncher) addLauncher.hidden = !editing;
      documentObject.body.dataset.cwStudio = editing ? 'open' : 'closed';
      applyCanvasZoom();
      if (!editing) {
        bridge.playerControls?.()?.select('');
        closeModuleContextMenu();
        pickedSourceId = '';
        keyboardTargetId = '';
        selectedGroupId = '';
        if (leavingEdit) documentObject.defaultView?.setTimeout?.(() => launcher?.focus?.({ preventScroll: true }), 0);
        return;
      }
      sections.state.textContent = snapshot.dirty ? 'unsaved draft' : 'saved';
      sections.state.dataset.dirty = String(Boolean(snapshot.dirty));
      sections.status.textContent = liveStatus.message || 'Canvas Studio ready.';
      sections.status.dataset.tone = liveStatus.tone;
      sections.undo.disabled = !snapshot.canUndo;
      sections.redo.disabled = !snapshot.canRedo;
      renderReadiness(snapshot.graph);
      renderTemplates(snapshot.graph);
      renderTray(snapshot.graph);
      renderSelection(snapshot.graph);
      renderSplits(snapshot.graph);
      renderZoom();
      renderGroups(snapshot.graph);
      renderCommit(snapshot.graph);
    }

    function handleCanvasClick(event) {
      if (suppressBodyClickUntil && Date.now() < suppressBodyClickUntil) {
        suppressBodyClickUntil = 0;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (bridge.snapshot().mode !== 'edit') return;
      // A player-bar control is something being arranged while composing,
      // not pressed: the mini player does not open, the queue does not
      // toggle.
      if (event.target.closest?.('.cw-canvas [data-cw-control]')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (moduleContextMenu) {
        if (moduleContextMenu.contains(event.target)) return;
        closeModuleContextMenu();
      }
      const pane = event.target.closest?.('.cw-module[data-cw-node-id]');
      if (!pane) {
        const blankCanvas = event.target.closest?.('.cw-canvas');
        const interactive = event.target.closest?.('button, input, select, textarea, a, [contenteditable="true"]');
        if (blankCanvas && !interactive && selectedId) {
          select('');
          bridge.setStatus?.('Pane selection cleared. The canvas remains unchanged.', 'success');
        }
        return;
      }
      // Ordinary controls inside a module keep working in Composition Mode;
      // only a click on the pane's own surface changes the selection.
      if (event.target.closest('.cw-pane-drag-handle, .cw-pane-resize-handle, .cw-split-handle')) return;
      if (event.target.closest('button, input, select, textarea, a')) return;
      if (pickedSourceId && pane.dataset.cwNodeId !== pickedSourceId) {
        keyboardTargetId = pane.dataset.cwNodeId;
        paintSelection();
        render();
        documentObject.defaultView?.setTimeout?.(() => pane.querySelector('.cw-inline-target-action')?.focus?.(), 0);
        bridge.setStatus?.(`${moduleLabel(findNode(bridge.snapshot().graph, pane.dataset.cwNodeId))} selected as the destination. Choose a relationship directly on that pane.`, 'success');
        return;
      }
      select(pane.dataset.cwNodeId);
    }

    function handleCanvasContextMenu(event) {
      if (bridge.snapshot().mode !== 'edit') return;
      if (moduleContextMenu?.contains(event.target)) {
        event.preventDefault();
        return;
      }
      const pane = event.target.closest?.('.cw-module[data-cw-node-id]');
      if (!pane) {
        const canvas = event.target.closest?.('.cw-canvas');
        if (canvas) {
          event.preventDefault();
          event.stopPropagation();
          openAddPaneMenu(event.clientX, event.clientY, canvas);
        } else closeModuleContextMenu();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openModuleContextMenu(pane, event.clientX, event.clientY);
    }

    function handleCanvasKeydown(event) {
      const snapshot = bridge.snapshot();
      if (snapshot.mode !== 'edit') return;
      const editableTarget = Boolean(event.target.closest?.('input, textarea, select, [contenteditable="true"]'));
      if ((event.ctrlKey || event.metaKey) && !editableTarget && ['-', '_', '=', '+', '0'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '0') setCanvasZoom(1, 'Canvas at 100%.');
        else stepCanvasZoom(['-', '_'].includes(event.key) ? -1 : 1);
        return;
      }
      const heldControl = event.target.closest?.('.cw-canvas [data-cw-control]');
      if (heldControl && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const layout = bridge.playerControls?.();
        const transport = layout?.transportNode();
        if (!layout || !transport) return;
        const step = event.shiftKey ? 16 : 2;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        layout.nudge(heldControl.dataset.cwControl, dx, dy, {
          status: (message, tone) => bridge.setStatus?.(message, tone),
          commit: (configuration, message) => Boolean(bridge.dispatch({ type: 'setModuleConfiguration', moduleId: transport.id, configuration }, message)?.ok),
        });
        return;
      }
      if (event.key === 'Escape') {
        if (event.target === sections.traySearch) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (trayFilter) {
            trayFilter = '';
            renderTray(snapshot.graph);
            documentObject.defaultView?.setTimeout?.(() => sections.traySearch?.focus?.({ preventScroll: true }), 0);
          } else rail?.focus?.({ preventScroll: true });
          return;
        }
        if (editableTarget && !moduleContextMenu) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (moduleContextMenu) closeModuleContextMenu({ restoreFocus: true });
        else if (pickedSourceId) cancelMove();
        else if (selectedId) {
          select('');
          bridge.setStatus?.('Pane selection cleared. Press Escape again to leave Composition Mode.', 'success');
        }
        else if (snapshot.dirty) bridge.setStatus?.('This draft has unsaved changes. Save it or choose Discard draft before leaving Composition Mode.', 'warning');
        else bridge.cancel();
        return;
      }
      const pane = event.target.closest?.('.cw-module[data-cw-node-id]');
      if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && pane) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = pane.getBoundingClientRect();
        openModuleContextMenu(pane, rect.left + Math.min(rect.width - 12, Math.max(12, rect.width * 0.32)), rect.top + Math.min(rect.height - 12, Math.max(12, rect.height * 0.24)));
        return;
      }
      if (!editableTarget && !event.altKey && !event.ctrlKey && !event.metaKey && event.key === '/') {
        event.preventDefault();
        sections.traySearch?.focus?.({ preventScroll: true });
        sections.traySearch?.select?.();
        return;
      }
      if (!editableTarget && !event.altKey && (event.ctrlKey || event.metaKey)) {
        const key = event.key.toLocaleLowerCase();
        const undo = key === 'z' && !event.shiftKey;
        const redo = key === 'y' || (key === 'z' && event.shiftKey);
        if (undo || redo) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeModuleContextMenu();
          if (undo && snapshot.canUndo) bridge.undo();
          else if (redo && snapshot.canRedo) bridge.redo();
          else bridge.setStatus?.(undo ? 'Nothing to undo.' : 'Nothing to redo.', 'warning');
          return;
        }
        if (key === 'd' && selectedId) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeModuleContextMenu();
          if (canDuplicateSelected(snapshot.graph)) duplicateSelected();
          else bridge.setStatus?.('This pane cannot be duplicated, or it has reached its instance limit.', 'warning');
          return;
        }
      }
      const splitHandle = event.target.closest?.('.cw-split-handle');
      if (splitHandle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) {
        const split = findNode(bridge.snapshot().graph, splitHandle.dataset.cwSplitId);
        if (!split || split.type !== 'split') return;
        const total = split.weights.reduce((sum, value) => sum + Number(value || 0), 0) || 1;
        const current = Number(split.weights[0]) / total;
        const forward = ['ArrowRight', 'ArrowDown'].includes(event.key);
        const ratio = event.key === 'Home' ? 0.5 : current + (forward ? 0.05 : -0.05);
        event.preventDefault();
        resizeSplit(split, ratio);
        return;
      }
      const resizeHandle = event.target.closest?.('.cw-pane-resize-handle');
      if (resizeHandle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const graph = bridge.snapshot().graph;
        const node = findNode(graph, resizeHandle.dataset.cwResizeNode);
        const placement = node ? selectedGridPlacement(graph, node) : null;
        if (!node || !placement) return;
        const axes = new Set((bridge.shapes()[node.shape] || {}).resizeAxes || ['inline', 'block']);
        const step = event.shiftKey ? 2 : 1;
        const columnDelta = axes.has('inline') ? (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) : 0;
        const rowDelta = axes.has('block') ? (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) : 0;
        if (!columnDelta && !rowDelta) return;
        event.preventDefault();
        if (resizeHandle.dataset.cwResizeCorner === 'start') {
          // Same rule as the pointer: the far edge is the anchor, so an arrow
          // key moves the near edge and the span follows it.
          const columnEnd = (placement.columnStart || 1) + placement.columnSpan;
          const rowEnd = (placement.rowStart || 1) + placement.rowSpan;
          const columnStart = Math.max(1, Math.min(columnEnd - 1, (placement.columnStart || 1) + columnDelta));
          const rowStart = Math.max(1, Math.min(rowEnd - 1, (placement.rowStart || 1) + rowDelta));
          setPlacement(node.id, columnEnd - columnStart, rowEnd - rowStart, 'Pane size updated.', { columnStart, rowStart });
          return;
        }
        setPlacement(node.id, Math.min(placement.parent.columns, placement.columnSpan + columnDelta), placement.rowSpan + rowDelta);
        return;
      }
      if (!['Enter', ' '].includes(event.key)) return;
      if (!pane || event.target !== pane) return;
      event.preventDefault();
      if (pickedSourceId && pane.dataset.cwNodeId !== pickedSourceId) {
        keyboardTargetId = pane.dataset.cwNodeId;
        paintSelection();
        render();
        documentObject.defaultView?.setTimeout?.(() => pane.querySelector('.cw-inline-target-action')?.focus?.(), 0);
        bridge.setStatus?.(`${moduleLabel(findNode(bridge.snapshot().graph, pane.dataset.cwNodeId))} selected as the destination. Choose a relationship directly on that pane.`, 'success');
        return;
      }
      select(pane.dataset.cwNodeId);
    }

    // ---- Player-bar controls -----------------------------------------------
    //
    // The mini player, queue, mute, volume, format and audio systems controls
    // move freely along the player bar. player-controls.js owns the geometry
    // -- each control's box is whatever its theme draws -- and this only
    // routes the gesture and commits the result as the transport module's
    // configuration.
    function startControlDrag(event) {
      if (event.button !== 0 || pointerInteraction || controlDrag || bridge.snapshot().mode !== 'edit') return false;
      if (documentObject.body.dataset.cwPanReady || event.target.closest?.(COMPOSITION_GESTURE_SELECTOR)) return false;
      const layout = bridge.playerControls?.();
      if (!layout || !event.target.closest?.('.cw-canvas .player')) return false;
      if (!event.target.closest('[data-cw-control]') && !layout.hitTest(event.clientX, event.clientY)) return false;
      const transport = layout.transportNode();
      const gesture = layout.beginDrag(event, {
        status: (message, tone) => bridge.setStatus?.(message, tone),
        commit: (configuration, message) => {
          if (!transport) return false;
          return Boolean(bridge.dispatch({ type: 'setModuleConfiguration', moduleId: transport.id, configuration }, message)?.ok);
        },
      });
      if (!gesture) return false;
      event.preventDefault();
      event.stopPropagation();
      bridge.beginInteraction?.();
      controlDrag = { pointerId: event.pointerId, gesture };
      try { event.target.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort */ }
      return true;
    }

    // Double-click puts a control back where its theme draws it.
    function handleControlDoubleClick(event) {
      if (bridge.snapshot().mode !== 'edit') return;
      const layout = bridge.playerControls?.();
      if (!layout || !event.target.closest?.('.cw-canvas .player')) return;
      const key = event.target.closest('[data-cw-control]')?.dataset.cwControl || layout.hitTest(event.clientX, event.clientY)?.control.key;
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      const label = layout.labelOf(key);
      const transport = layout.transportNode();
      if (!transport || !layout.isPlaced(key)) {
        bridge.setStatus?.(`${label} is already where the theme draws it.`, 'idle');
        return;
      }
      bridge.dispatch({ type: 'setModuleConfiguration', moduleId: transport.id, configuration: layout.resetConfiguration(key) }, `${label} is back where the theme draws it.`);
    }

    function bindCanvasSelection() {
      if (selectionBound) return;
      selectionBound = true;
      documentObject.addEventListener('click', handleCanvasClick, true);
      documentObject.addEventListener('contextmenu', handleCanvasContextMenu, true);
      documentObject.addEventListener('keydown', handleCanvasKeydown, true);
      documentObject.addEventListener('pointerdown', handlePanPointerDown, true);
      documentObject.addEventListener('pointermove', movePan, true);
      documentObject.addEventListener('pointerup', endPan, true);
      documentObject.addEventListener('pointercancel', endPan, true);
      documentObject.addEventListener('keydown', handlePanKeyDown, true);
      documentObject.addEventListener('keyup', handlePanKeyUp, true);
      documentObject.defaultView?.addEventListener?.('blur', releasePanArm, true);
      documentObject.addEventListener('visibilitychange', releasePanArm, true);
      documentObject.addEventListener('pointerdown', handlePointerDown, true);
      documentObject.addEventListener('pointermove', handlePointerMove, true);
      documentObject.addEventListener('pointerup', handlePointerEnd, true);
      documentObject.addEventListener('pointercancel', handlePointerCancel, true);
      documentObject.addEventListener('dblclick', handleControlDoubleClick, true);
      documentObject.addEventListener('selectstart', suppressNativeCompositionGesture, true);
      documentObject.addEventListener('dragstart', suppressNativeCompositionGesture, true);
    }

    function mount(host) {
      if (rail) return rail;
      buildRail();
      buildLauncher();
      (host || documentObject.body).append(rail, addLauncher);
      const chrome = documentObject.createElement('div');
      chrome.className = 'cw-studio-chrome';
      chrome.append(launcher, legacyLauncher);
      (documentObject.querySelector('.topbar') || host || documentObject.body).append(chrome);
      bindCanvasSelection();
      render();
      return rail;
    }

    function sync() {
      closeModuleContextMenu();
      const graph = bridge.snapshot().graph;
      if (selectedId && !findNode(graph, selectedId)) selectedId = '';
      paintSelection();
      render();
    }

    function destroy() {
      if (selectionBound) {
        documentObject.removeEventListener('click', handleCanvasClick, true);
        documentObject.removeEventListener('contextmenu', handleCanvasContextMenu, true);
        documentObject.removeEventListener('keydown', handleCanvasKeydown, true);
        documentObject.removeEventListener('pointerdown', handlePanPointerDown, true);
        documentObject.removeEventListener('pointermove', movePan, true);
        documentObject.removeEventListener('pointerup', endPan, true);
        documentObject.removeEventListener('pointercancel', endPan, true);
        documentObject.removeEventListener('keydown', handlePanKeyDown, true);
        documentObject.removeEventListener('keyup', handlePanKeyUp, true);
        documentObject.defaultView?.removeEventListener?.('blur', releasePanArm, true);
        documentObject.removeEventListener('visibilitychange', releasePanArm, true);
        releasePanArm();
        endPan();
        documentObject.removeEventListener('pointerdown', handlePointerDown, true);
        documentObject.removeEventListener('pointermove', handlePointerMove, true);
        documentObject.removeEventListener('pointerup', handlePointerEnd, true);
        documentObject.removeEventListener('pointercancel', handlePointerCancel, true);
        documentObject.removeEventListener('dblclick', handleControlDoubleClick, true);
        documentObject.removeEventListener('selectstart', suppressNativeCompositionGesture, true);
        documentObject.removeEventListener('dragstart', suppressNativeCompositionGesture, true);
        selectionBound = false;
      }
      closeModuleContextMenu();
      finishPointer();
      rail?.remove();
      if (launcher?.parentElement?.classList.contains('cw-studio-chrome')) launcher.parentElement.remove();
      launcher?.remove();
      legacyLauncher?.remove();
      addLauncher?.remove();
      rail = null;
      launcher = null;
      legacyLauncher = null;
      addLauncher = null;
      selectedId = '';
      selectedGroupId = '';
      wasEditing = false;
      delete documentObject.body.dataset.cwStudio;
      delete documentObject.body.dataset.cwTemplatePreview;
      documentObject.querySelectorAll('[data-cw-studio-selected]').forEach((node) => node.removeAttribute('data-cw-studio-selected'));
    }

    function setStatus(message, tone = 'idle') {
      liveStatus = { message: String(message || ''), tone };
      if (sections.status) {
        sections.status.textContent = liveStatus.message;
        sections.status.dataset.tone = tone;
      }
    }

    function focusEntry() {
      if (rail?.hidden) return false;
      rail.focus?.({ preventScroll: true });
      return documentObject.activeElement === rail;
    }

    return Object.freeze({ mount, sync, render, destroy, select, setStatus, focusEntry, selectedId: () => selectedId });
  }

  return Object.freeze({ createStudio, SHAPE_ORDER });
}));
