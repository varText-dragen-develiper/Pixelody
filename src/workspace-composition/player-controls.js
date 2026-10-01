(function pixelodyPlayerControlsFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyPlayerControls = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPlayerControlsApi() {
  'use strict';

  // The small controls on the player bar -- mini player, queue, mute, volume,
  // the format badge and the audio systems button -- are movable pieces of
  // the bar rather than panes of the canvas.
  //
  // Each theme draws them differently: a 30px glyph in one, a bevelled 60px
  // cartridge bay in another. So nothing here states a size. A control's box
  // is whatever the active theme renders, and that box is what collides and
  // what is centred. What the composition stores is only where the centre
  // goes, so the same arrangement survives a theme drawing the control larger.
  //
  // The centre is held against whatever it was put beside. The bar is
  // narrower while composing (the studio rail takes 300px) and changes with
  // the window, and themes divide it differently -- fixed side columns in
  // most, proportional thirds in Cartridge Quest -- so a fraction of the bar
  // drifts away from the things a control was placed next to. Instead the
  // nearest of a few reference lines is kept: the bar's edges and middle, the
  // edges of the now-playing identity, and the edges and middle of the
  // transport buttons. "14px left of the shuffle button" stays that in every
  // width. Height is a fraction, because a theme's bar is one height in every
  // mode. A fraction of the bar's width is kept too, for a theme that does
  // not draw the line a control was held against.
  //
  // A control is moved with `translate` from the place its theme lays it out.
  // It never leaves the theme's flow, so its size, art and the controls
  // around it are exactly what the theme drew; only where it is drawn moves.
  //
  // Positions live in the transport module's configuration, under
  // `controls`, and change through the ordinary setModuleConfiguration
  // operation, so preview, undo, cancel and the atomic save all apply.

  const CONTROLS = Object.freeze([
    Object.freeze({ key: 'mini', label: 'Mini player button', selectors: Object.freeze(['#miniPlayerButton']) }),
    Object.freeze({ key: 'queue', label: 'Queue button', selectors: Object.freeze(['#queueButton']) }),
    Object.freeze({ key: 'mute', label: 'Mute button', selectors: Object.freeze(['#muteButton']) }),
    // Most themes flatten the volume meter wrapper (display: contents), so the
    // slider itself is the control; a theme that draws the meter as a box
    // moves the whole meter.
    Object.freeze({ key: 'volume', label: 'Volume', selectors: Object.freeze(['#questVolumeMeter', '#volume']) }),
    Object.freeze({ key: 'format', label: 'Format badge', selectors: Object.freeze(['#qualityBadge']) }),
    Object.freeze({ key: 'output', label: 'Audio systems button', selectors: Object.freeze(['#playerSystemsButton']) }),
  ]);
  const CONTROL_BY_KEY = Object.freeze(Object.fromEntries(CONTROLS.map((control) => [control.key, control])));
  const TRANSPORT_KEY = 'transport.controls';
  const BAR_SELECTOR = '.player';
  // The bar's own playback furniture that a control must not be dropped on:
  // the now-playing identity, the transport buttons and the timeline. Each is
  // measured as the union of what it actually draws, not the column it sits
  // in, so a control can sit in the empty part of a column.
  const OBSTACLES = Object.freeze([
    Object.freeze({ label: 'Now playing', selector: '[data-cw-product-root="now-playing"]' }),
    Object.freeze({ label: 'Transport buttons', selector: '.transport-buttons' }),
    Object.freeze({ label: 'Timeline', selector: '.timeline' }),
  ]);
  // The panes those live in. Most themes frame them, and a control is better
  // inside a frame (clear of what it holds) or outside it than across its
  // edge. That is a preference, not a wall: several themes already lay the
  // right-hand cluster across the transport frame, so when a drop has to be
  // moved, a spot clear of every edge is taken if one is close by.
  const FRAMES = Object.freeze([
    Object.freeze({ label: 'the Now playing frame', selector: '.cw-module[data-cw-module-key="now-playing"]' }),
    Object.freeze({ label: 'the Transport frame', selector: '.cw-module[data-cw-module-key="transport.controls"]' }),
  ]);
  const REFERENCES = Object.freeze(['bar-left', 'bar-center', 'bar-right', 'now-playing-left', 'now-playing-right', 'transport-left', 'transport-center', 'transport-right']);
  const PRECISION = 10000;
  const SNAP_PIXELS = 6;
  const DRAG_THRESHOLD = 4;
  // A range slider's box is its track, often 2-4px tall, with the thumb drawn
  // outside it. Nothing is pressed or collided at less than this.
  const MIN_BOX = 16;

  function plain(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function unit(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.round(Math.max(0, Math.min(1, number)) * PRECISION) / PRECISION;
  }

  function pixels(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.round(Math.max(-4096, Math.min(4096, number)) * 10) / 10;
  }

  function normalizePoint(point) {
    if (!plain(point) || !REFERENCES.includes(point.ref)) return null;
    const x = pixels(point.x);
    const y = unit(point.y);
    const fx = unit(point.fx);
    if (x === null || y === null || fx === null) return null;
    return Object.freeze({ ref: point.ref, x, y, fx });
  }

  // { key: { ref, x, y, fx } } for the controls a composition has placed. x is
  // the centre's distance in CSS pixels from the reference line (negative is
  // to its left), y a fraction of the bar's height, fx the centre as a
  // fraction of the bar's width. Anything unknown or malformed is dropped
  // rather than trusted.
  function fromConfiguration(configuration) {
    const source = plain(configuration) && plain(configuration.controls) ? configuration.controls : {};
    const points = {};
    CONTROLS.forEach(({ key }) => {
      const point = normalizePoint(source[key]);
      if (point) points[key] = point;
    });
    return Object.freeze(points);
  }

  // A point, from a centre in client pixels, the bar's box and the reference
  // lines drawn in it ({ ref: clientX }). The nearest line wins; the bar's
  // own lines only when nothing drawn is nearer.
  function pointFor(center, barRect, lines, zoom = 1, width = 0) {
    let best = null;
    REFERENCES.forEach((ref) => {
      const line = lines?.[ref];
      if (!Number.isFinite(line)) return;
      // Nearness is to the control's nearer edge as much as its centre: a
      // button put down 14px left of the shuffle button is held against the
      // shuffle button, even if its centre is closer to something else.
      const distance = Math.min(Math.abs(center.x - line), Math.abs(center.x - width / 2 - line), Math.abs(center.x + width / 2 - line))
        + (ref.startsWith('bar-') ? 0.5 : 0);
      if (!best || distance < best.distance) best = { ref, line, distance };
    });
    if (!best) best = { ref: 'bar-left', line: barRect.left };
    return normalizePoint({
      ref: best.ref,
      x: (center.x - best.line) / zoom,
      y: (center.y - barRect.top) / barRect.height,
      fx: (center.x - barRect.left) / barRect.width,
    });
  }

  // The centre, in client pixels, a point names in this bar.
  function centerFor(point, barRect, lines, zoom = 1) {
    const line = lines?.[point.ref];
    const x = Number.isFinite(line) ? line + point.x * zoom : barRect.left + point.fx * barRect.width;
    return { x, y: barRect.top + point.y * barRect.height };
  }

  // A new configuration with one control placed at `point`, or returned to
  // its theme's place when `point` is null. Everything else is kept.
  function mergeConfiguration(configuration, key, point) {
    const base = plain(configuration) ? { ...configuration } : {};
    const controls = { ...fromConfiguration(base) };
    if (!CONTROL_BY_KEY[key]) return base;
    const normalized = point ? normalizePoint(point) : null;
    if (normalized) controls[key] = { ...normalized };
    else delete controls[key];
    if (Object.keys(controls).length) base.controls = controls;
    else delete base.controls;
    return base;
  }

  function transportNode(graph) {
    let found = null;
    (function visit(node) {
      if (!node || found) return;
      if (node.type === 'module' && node.moduleKey === TRANSPORT_KEY) { found = node; return; }
      (node.children || []).forEach(visit);
    }(graph));
    return found;
  }

  function visibleBox(element, view) {
    if (!element?.isConnected) return null;
    const style = view?.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.display === 'contents' || style.visibility === 'hidden')) return null;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return rect;
  }

  function resolveControl(documentObject, control) {
    const view = documentObject.defaultView;
    for (const selector of control.selectors) {
      const element = documentObject.querySelector(`${BAR_SELECTOR} ${selector}`);
      if (element && visibleBox(element, view)) return element;
    }
    return null;
  }

  // The union of what an element draws: its visible children, or itself.
  function drawnBox(element, view) {
    if (!element) return null;
    const children = [...element.children].map((child) => visibleBox(child, view)).filter(Boolean);
    const boxes = children.length ? children : [visibleBox(element, view)].filter(Boolean);
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.right));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // A box no smaller than MIN_BOX either way, about the same centre.
  function inflated(rect) {
    const width = Math.max(rect.width, MIN_BOX);
    const height = Math.max(rect.height, MIN_BOX);
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2, width, height };
  }

  function overlaps(a, b, slack = 1) {
    return a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack;
  }

  function contains(outer, inner, slack = 1) {
    return inner.left >= outer.left - slack && inner.right <= outer.right + slack && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
  }

  // What a box at `box` runs into: an obstacle it overlaps or, when frames
  // are counted, a frame whose edge it crosses.
  // `slack` is how much overlap is forgiven; negative asks for clearance.
  function blockerOf(box, blockers, withFrames = false, slack = 0.5) {
    return blockers.find((blocker) => (blocker.frame
      ? withFrames && overlaps(box, blocker.box) && !contains(blocker.box, box)
      : overlaps(box, blocker.box, slack))) || null;
  }

  function boxAround(center, size) {
    return { left: center.x - size.width / 2, top: center.y - size.height / 2, right: center.x + size.width / 2, bottom: center.y + size.height / 2, width: size.width, height: size.height };
  }

  // Keep a box of `size` centred at `center` inside the bar.
  function clampCenter(center, size, bar) {
    const halfWidth = Math.min(size.width, bar.width) / 2;
    const halfHeight = Math.min(size.height, bar.height) / 2;
    return {
      x: Math.max(bar.left + halfWidth, Math.min(bar.right - halfWidth, center.x)),
      y: Math.max(bar.top + halfHeight, Math.min(bar.bottom - halfHeight, center.y)),
    };
  }

  function createLayout(options = {}) {
    const documentObject = options.document;
    if (!documentObject) throw new Error('Player controls require a document.');
    const view = documentObject.defaultView;
    // What was set on each element, so clearing restores the theme exactly.
    const applied = new Map();
    let lastGraph = null;
    let observer = null;
    let observed = new Set();
    let frame = 0;
    let dragging = '';

    function bar() {
      const element = documentObject.querySelector(`.cw-canvas ${BAR_SELECTOR}`);
      return element && visibleBox(element, view) ? element : null;
    }

    function zoomOf(barElement) {
      const rect = barElement.getBoundingClientRect();
      return barElement.offsetWidth > 0 ? rect.width / barElement.offsetWidth : 1;
    }

    // Every translate is measured and written with transitions held off.
    // Performance "conserve" mode gives every element a 70ms transition on
    // every property, so a read straight after clearing a translate would
    // read it half-cleared.
    function holdTransitions(elements, action) {
      const held = elements.map((element) => [element, element.style.getPropertyValue('transition'), element.style.getPropertyPriority('transition')]);
      held.forEach(([element]) => element.style.setProperty('transition', 'none', 'important'));
      try { return action(); } finally {
        elements.forEach((element) => { void element.offsetWidth; });
        held.forEach(([element, value, priority]) => {
          if (value) element.style.setProperty('transition', value, priority);
          else element.style.removeProperty('transition');
        });
      }
    }

    function record(element) {
      if (!applied.has(element)) {
        applied.set(element, {
          translate: element.style.getPropertyValue('translate'),
          position: element.style.getPropertyValue('position'),
          zIndex: element.style.getPropertyValue('z-index'),
          offset: { x: 0, y: 0 },
        });
      }
      return applied.get(element);
    }

    function restore(element) {
      const original = applied.get(element);
      if (!original) return;
      const put = (property, value) => (value ? element.style.setProperty(property, value) : element.style.removeProperty(property));
      put('translate', original.translate);
      put('position', original.position);
      put('z-index', original.zIndex);
      applied.delete(element);
      delete element.dataset.cwControlPlaced;
    }

    // Where each control is right now, and where its theme puts it.
    function controlEntries() {
      return CONTROLS.map((control) => {
        const element = resolveControl(documentObject, control);
        if (!element) return null;
        const rect = inflated(element.getBoundingClientRect());
        const offset = applied.get(element)?.offset || { x: 0, y: 0 };
        const barElement = bar();
        const zoom = barElement ? zoomOf(barElement) : 1;
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const home = { x: center.x - offset.x * zoom, y: center.y - offset.y * zoom };
        return { control, element, rect, center, home, size: { width: rect.width, height: rect.height } };
      }).filter(Boolean);
    }

    function referenceLines(barElement) {
      const bar = barElement.getBoundingClientRect();
      const lines = { 'bar-left': bar.left, 'bar-center': bar.left + bar.width / 2, 'bar-right': bar.right };
      const identity = drawnBox(barElement.querySelector(OBSTACLES[0].selector), view);
      if (identity) Object.assign(lines, { 'now-playing-left': identity.left, 'now-playing-right': identity.right });
      const buttons = drawnBox(barElement.querySelector(OBSTACLES[1].selector), view);
      if (buttons) Object.assign(lines, { 'transport-left': buttons.left, 'transport-center': buttons.left + buttons.width / 2, 'transport-right': buttons.right });
      return lines;
    }

    function obstacleBoxes(barElement) {
      const contents = OBSTACLES.map((obstacle) => {
        const element = barElement.querySelector(obstacle.selector);
        const box = drawnBox(element, view);
        return box ? { label: obstacle.label, box } : null;
      }).filter(Boolean);
      const frames = FRAMES.map((frame) => {
        const box = visibleBox(barElement.querySelector(frame.selector), view);
        return box ? { label: frame.label, box, frame: true } : null;
      }).filter(Boolean);
      return [...contents, ...frames];
    }

    function place(element, offsetX, offsetY) {
      const state = record(element);
      state.offset = { x: offsetX, y: offsetY };
      element.style.setProperty('translate', `${Math.round(offsetX * 100) / 100}px ${Math.round(offsetY * 100) / 100}px`);
      if (view?.getComputedStyle?.(element).position === 'static') element.style.setProperty('position', 'relative');
      element.style.setProperty('z-index', '3');
      element.dataset.cwControlPlaced = 'true';
    }

    function apply(graph = lastGraph) {
      lastGraph = graph || lastGraph;
      const barElement = bar();
      CONTROLS.forEach((control) => {
        const element = resolveControl(documentObject, control);
        if (element) element.dataset.cwControl = control.key;
      });
      if (!barElement) return;
      const points = fromConfiguration(transportNode(lastGraph)?.configuration);
      const elements = CONTROLS.map((control) => resolveControl(documentObject, control)).filter(Boolean);
      holdTransitions(elements, () => {
        // Measure every control where its theme puts it, then place.
        elements.forEach((element) => {
          if (applied.has(element) && element.dataset.cwControl !== dragging) element.style.setProperty('translate', applied.get(element).translate || 'none');
        });
        const barRect = barElement.getBoundingClientRect();
        const zoom = zoomOf(barElement);
        const homes = new Map(elements.map((element) => [element, element.getBoundingClientRect()]));
        const lines = referenceLines(barElement);
        elements.forEach((element) => {
          const key = element.dataset.cwControl;
          const point = points[key];
          if (!point || dragging === key) {
            if (!point) restore(element);
            return;
          }
          const home = inflated(homes.get(element));
          const size = { width: home.width, height: home.height };
          const target = clampCenter(centerFor(point, barRect, lines, zoom), size, barRect);
          place(element, (target.x - (home.left + home.width / 2)) / zoom, (target.y - (home.top + home.height / 2)) / zoom);
        });
      });
      // A control removed from the layout (or a stale element after a repaint)
      // goes back to exactly what the theme wrote.
      [...applied.keys()].forEach((element) => { if (!elements.includes(element)) restore(element); });
      watch(barElement, elements);
    }

    // Sizes change when the window does and when a theme draws a control
    // differently, and a centre stated as a fraction has to be re-measured
    // against both.
    function watch(barElement, elements) {
      if (typeof view?.ResizeObserver !== 'function') return;
      if (!observer) {
        observer = new view.ResizeObserver(() => {
          if (frame || dragging) return;
          frame = view.requestAnimationFrame(() => { frame = 0; apply(); });
        });
      }
      const wanted = new Set([barElement, barElement.querySelector('.volume'), ...elements].filter(Boolean));
      observed.forEach((element) => { if (!wanted.has(element)) observer.unobserve(element); });
      wanted.forEach((element) => { if (!observed.has(element)) observer.observe(element); });
      observed = wanted;
    }

    function clear() {
      if (frame) view?.cancelAnimationFrame?.(frame);
      frame = 0;
      observer?.disconnect();
      observer = null;
      observed = new Set();
      [...applied.keys()].forEach(restore);
      documentObject.querySelectorAll('[data-cw-control]').forEach((element) => {
        delete element.dataset.cwControl;
        delete element.dataset.cwControlSelected;
        delete element.dataset.cwControlDragging;
        delete element.dataset.cwControlColliding;
      });
      lastGraph = null;
    }

    // ---- Moving a control ------------------------------------------------

    // The nearest centre to `wanted` where a box of `size` fits inside the bar
    // without touching anything in `blockers`. Searched outwards in rings, so
    // a drop that just clips a neighbour lands just beside it.
    const FRAME_PREFERENCE_REACH = 48;
    const CLEARANCE = 3;

    // How far a drop may be nudged to sit clear of a frame's edge: at least
    // FRAME_PREFERENCE_REACH, and never less than the control itself, so a
    // control half across an edge can always settle to one side of it.
    function frameReach(size) {
      return Math.max(FRAME_PREFERENCE_REACH, size.width, size.height);
    }

    function nearestFree(wanted, size, barRect, blockers) {
      return search(wanted, size, barRect, blockers, true, frameReach(size))
        || search(wanted, size, barRect, blockers, false, Math.max(barRect.width, barRect.height));
    }

    function search(wanted, size, barRect, blockers, withFrames, reach) {
      // A control moved out of the way keeps a little air from what it
      // cleared rather than touching it.
      const fits = (center) => !blockerOf(boxAround(center, size), blockers, withFrames, -CLEARANCE);
      const start = clampCenter(wanted, size, barRect);
      if (fits(start)) return start;
      const step = 4;
      for (let radius = step; radius <= reach; radius += step) {
        let best = null;
        for (let angle = 0; angle < 360; angle += 10) {
          const radians = (angle * Math.PI) / 180;
          const candidate = clampCenter({ x: start.x + Math.cos(radians) * radius, y: start.y + Math.sin(radians) * radius }, size, barRect);
          if (!fits(candidate)) continue;
          const distance = Math.hypot(candidate.x - wanted.x, candidate.y - wanted.y);
          if (!best || distance < best.distance) best = { center: candidate, distance };
        }
        if (best) return best.center;
      }
      return null;
    }

    function snap(center, entries, key, disabled) {
      if (disabled) return center;
      let x = center.x;
      let y = center.y;
      let bestX = SNAP_PIXELS + 1;
      let bestY = SNAP_PIXELS + 1;
      entries.forEach((entry) => {
        if (entry.control.key === key) return;
        const dx = Math.abs(entry.center.x - center.x);
        const dy = Math.abs(entry.center.y - center.y);
        if (dx < bestX) { bestX = dx; x = entry.center.x; }
        if (dy < bestY) { bestY = dy; y = entry.center.y; }
      });
      return { x: bestX <= SNAP_PIXELS ? x : center.x, y: bestY <= SNAP_PIXELS ? y : center.y };
    }

    function select(key) {
      documentObject.querySelectorAll('[data-cw-control-selected]').forEach((element) => { delete element.dataset.cwControlSelected; });
      if (!key) return;
      const entry = controlEntries().find((candidate) => candidate.control.key === key);
      if (entry) entry.element.dataset.cwControlSelected = 'true';
    }

    // One gesture. The caller routes pointer events here while it returns
    // true; `commit` receives the control's new configuration, or null when
    // the control goes back where it was.
    // The control under a point, counting each control's box at no less than
    // MIN_BOX, so a hairline slider can still be picked up.
    function hitTest(clientX, clientY) {
      const barElement = bar();
      if (!barElement) return null;
      const entries = controlEntries();
      return entries.find((entry) => clientX >= entry.rect.left && clientX <= entry.rect.right && clientY >= entry.rect.top && clientY <= entry.rect.bottom) || null;
    }

    function beginDrag(event, handlers = {}) {
      const barElement = bar();
      if (!barElement) return null;
      const entries = controlEntries();
      const direct = event.target?.closest?.('[data-cw-control]');
      const entry = (direct && entries.find((candidate) => candidate.element === direct)) || hitTest(event.clientX, event.clientY);
      if (!entry) return null;
      const grab = { x: event.clientX - entry.center.x, y: event.clientY - entry.center.y };
      const start = { x: event.clientX, y: event.clientY };
      let moved = false;
      let last = null;

      function blockersFor(key) {
        return [
          ...entries.filter((other) => other.control.key !== key).map((other) => ({ label: other.control.label, box: other.rect })),
          ...obstacleBoxes(barElement),
        ];
      }

      function evaluate(clientX, clientY, altKey) {
        const barRect = barElement.getBoundingClientRect();
        const wanted = snap({ x: clientX - grab.x, y: clientY - grab.y }, entries, entry.control.key, altKey);
        const center = clampCenter(wanted, entry.size, barRect);
        const box = boxAround(center, entry.size);
        const blockers = blockersFor(entry.control.key);
        const hit = blockerOf(box, blockers);
        return { barRect, wanted, center, box, blockers, hit };
      }

      function show(result) {
        const zoom = zoomOf(barElement);
        place(entry.element, (result.center.x - entry.home.x) / zoom, (result.center.y - entry.home.y) / zoom);
        if (result.hit) entry.element.dataset.cwControlColliding = 'true';
        else delete entry.element.dataset.cwControlColliding;
      }

      return {
        key: entry.control.key,
        label: entry.control.label,
        move(moveEvent) {
          if (!moved && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD) return;
          if (!moved) {
            moved = true;
            dragging = entry.control.key;
            entry.element.dataset.cwControlDragging = 'true';
            select(entry.control.key);
          }
          last = evaluate(moveEvent.clientX, moveEvent.clientY, moveEvent.altKey);
          show(last);
          handlers.status?.(last.hit
            ? `${entry.control.label} would ${last.hit.frame ? 'cross the edge of' : 'overlap'} ${last.hit.label}. Release and it moves to the nearest free spot.`
            : `Release to place the ${entry.control.label.toLowerCase()}.`, last.hit ? 'warning' : 'idle');
        },
        end(endEvent) {
          delete entry.element.dataset.cwControlDragging;
          delete entry.element.dataset.cwControlColliding;
          dragging = '';
          if (!moved) {
            select(entry.control.key);
            try { entry.element.focus({ preventScroll: true }); } catch { /* focus is best effort */ }
            handlers.status?.(`${entry.control.label} selected. Drag it anywhere on the player bar, or use the arrow keys (Shift for bigger steps); double-click puts it back where the theme draws it.`, 'idle');
            return { moved: false };
          }
          const result = last || evaluate(endEvent.clientX, endEvent.clientY, endEvent.altKey);
          // A clear drop across a frame's edge settles just inside or outside
          // the frame when that is a short way off; otherwise it stays put.
          const straddling = !result.hit && blockerOf(result.box, result.blockers, true);
          const center = result.hit
            ? nearestFree(result.wanted, entry.size, result.barRect, result.blockers)
            : straddling ? search(result.center, entry.size, result.barRect, result.blockers, true, frameReach(entry.size)) || result.center : result.center;
          if (!center) {
            apply();
            handlers.status?.(`There is no room for the ${entry.control.label.toLowerCase()} there. It stayed where it was.`, 'warning');
            return { moved: false };
          }
          const point = pointFor(center, result.barRect, referenceLines(barElement), zoomOf(barElement), entry.size.width);
          const configuration = mergeConfiguration(transportNode(lastGraph)?.configuration, entry.control.key, point);
          const message = result.hit
            ? `${entry.control.label} moved to the nearest spot clear of ${result.hit.frame ? '' : 'the '}${result.hit.frame ? result.hit.label : result.hit.label.toLowerCase()}.`
            : `${entry.control.label} moved.`;
          const committed = handlers.commit?.(configuration, message);
          if (!committed) apply();
          return { moved: true, point };
        },
        cancel() {
          delete entry.element.dataset.cwControlDragging;
          delete entry.element.dataset.cwControlColliding;
          dragging = '';
          apply();
        },
      };
    }

    // Move a control by (dx, dy) CSS pixels from the keyboard. A step that
    // would land on something is refused rather than rerouted: from the
    // keyboard, the control goes exactly where it was asked to or nowhere.
    function nudge(key, dx, dy, handlers = {}) {
      const barElement = bar();
      if (!barElement) return false;
      const entries = controlEntries();
      const entry = entries.find((candidate) => candidate.control.key === key);
      if (!entry) return false;
      const barRect = barElement.getBoundingClientRect();
      const zoom = zoomOf(barElement);
      const center = clampCenter({ x: entry.center.x + dx * zoom, y: entry.center.y + dy * zoom }, entry.size, barRect);
      const blockers = [
        ...entries.filter((other) => other.control.key !== key).map((other) => ({ label: other.control.label, box: other.rect })),
        ...obstacleBoxes(barElement),
      ];
      const hit = blockerOf(boxAround(center, entry.size), blockers);
      if (hit) {
        handlers.status?.(`${entry.control.label} cannot move onto ${hit.frame ? hit.label : `the ${hit.label.toLowerCase()}`}.`, 'warning');
        return false;
      }
      const point = pointFor(center, barRect, referenceLines(barElement), zoom, entry.size.width);
      return Boolean(handlers.commit?.(mergeConfiguration(transportNode(lastGraph)?.configuration, key, point), `${entry.control.label} moved.`));
    }

    function resetConfiguration(key) {
      if (!CONTROL_BY_KEY[key]) return null;
      return mergeConfiguration(transportNode(lastGraph)?.configuration, key, null);
    }

    return Object.freeze({
      apply,
      clear,
      select,
      beginDrag,
      resetConfiguration,
      nudge,
      hitTest,
      entries: controlEntries,
      blockers: () => { const barElement = bar(); return barElement ? obstacleBoxes(barElement) : []; },
      transportNode: () => transportNode(lastGraph),
      isPlaced: (key) => Boolean(fromConfiguration(transportNode(lastGraph)?.configuration)[key]),
      labelOf: (key) => CONTROL_BY_KEY[key]?.label || 'Control',
    });
  }

  return Object.freeze({
    CONTROLS,
    CONTROL_BY_KEY,
    TRANSPORT_KEY,
    fromConfiguration,
    mergeConfiguration,
    pointFor,
    centerFor,
    transportNode,
    createLayout,
    geometry: Object.freeze({ overlaps, contains, blockerOf, boxAround, clampCenter }),
  });
}));
