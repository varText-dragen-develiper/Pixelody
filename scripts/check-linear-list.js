const assert = require('node:assert/strict');

const { createLinearListMechanic } = require('../src/theme-runtime/navigation/linear-list');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

// A minimal fake of the one DOM element linear-list.js touches (#trackRows),
// implementing only what mount()/update()/destroy() actually call. No
// jsdom dependency -- this is enough to exercise the real streaming/paint
// logic and the real delegated-listener logic without a browser.
function createFakeContainer() {
  const classes = new Set();
  let container;
  const makeRow = (html, id, className = 'track-row', ariaSelected = 'false', tabIndex = '-1') => {
    const rowClasses = new Set(className.split(/\s+/).filter(Boolean));
    const attributes = new Map();
    const row = {
      html,
      dataset: { id },
      tabIndex: Number(tabIndex),
      focused: false,
      attributeWrites: 0,
      classList: {
        add: (name) => rowClasses.add(name),
        remove: (name) => rowClasses.delete(name),
        toggle: (name, enabled) => { if (enabled) rowClasses.add(name); else rowClasses.delete(name); },
        contains: (name) => rowClasses.has(name),
      },
      setAttribute: (name, value) => { row.attributeWrites += 1; attributes.set(name, String(value)); },
      getAttribute: (name) => name === 'aria-selected' && !attributes.has(name) ? ariaSelected : attributes.get(name),
      focus: () => { row.focused = true; if (container.ownerDocument) container.ownerDocument.activeElement = row; },
      getBoundingClientRect: () => container._rowRect(container._rows.indexOf(row)),
      get previousElementSibling() { return container._rows[container._rows.indexOf(row) - 1] || null; },
      contains: (node) => node === row,
      closest: (selector) => selector === '.track-row' ? row : null,
      // refreshInPlace() replaces a row by inserting its successor after it.
      insertAdjacentHTML: (position, markup) => {
        assert.equal(position, 'afterend');
        container._rows.splice(container._rows.indexOf(row) + 1, 0, ...rowsFromHtml(markup));
      },
      remove: () => { container._rows.splice(container._rows.indexOf(row), 1); },
    };
    return row;
  };
  const rowsFromHtml = (html) => html.split(/(?=<div class="[^"]*track-row)/).filter(Boolean).map((chunk) => {
    const match = chunk.match(/^<div class="([^"]*track-row[^"]*)"[^>]*aria-selected="([^"]+)"[^>]*tabindex="([^"]+)"[^>]*data-id="([^"]+)"/);
    return makeRow(chunk, match[4], match[1], match[2], match[3]);
  });
  container = {
    _rows: [],
    get innerHTML() { return this._rows.map((row) => row.html).join(''); },
    set innerHTML(value) {
      this._rows = rowsFromHtml(value);
    },
    get children() { return this._rows; },
    insertAdjacentHTML(position, html) {
      assert.equal(position, 'beforeend');
      this._rows.push(...rowsFromHtml(html));
    },
    querySelectorAll(selector) { return selector === '.track-row' ? this._rows : []; },
    setAttribute() {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    offsetWidth: 100,
    _listeners: {},
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener(type, fn) { if (this._listeners[type] === fn) delete this._listeners[type]; },
    dispatch(type, event) { this._listeners[type]?.(event); },
  };
  return container;
}

// The same fake with just enough layout for on-demand rows: uniform rows of
// `pitch` px in a list scrolled by `scrollTop`, a viewport of `innerHeight`,
// and frames that run when the test flushes them.
function createLayoutContainer({ innerHeight = 600, pitch = 50 } = {}) {
  const container = createFakeContainer();
  const frames = [];
  const documentListeners = {};
  const view = {
    innerHeight,
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame: (handle) => { frames[handle - 1] = null; },
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = {
    defaultView: view,
    activeElement: null,
    addEventListener: (type, fn) => { documentListeners[type] = fn; },
    removeEventListener: (type, fn) => { if (documentListeners[type] === fn) delete documentListeners[type]; },
  };
  view.document = doc;
  const properties = new Map();
  Object.assign(container, {
    ownerDocument: doc,
    scrollTop: 0,
    style: { setProperty: (name, value) => properties.set(name, value), removeProperty: (name) => properties.delete(name), getPropertyValue: (name) => properties.get(name) || '' },
    getBoundingClientRect: () => ({ top: -container.scrollTop, bottom: container._rows.length * pitch - container.scrollTop, width: 100, height: container._rows.length * pitch }),
    _rowRect: (index) => ({ top: index * pitch - container.scrollTop, bottom: (index + 1) * pitch - container.scrollTop, width: 100, height: pitch }),
    scrollTo(top) { container.scrollTop = top; documentListeners.scroll?.({}); },
    flushFrame() {
      const pending = frames.splice(0);
      pending.forEach((callback) => callback?.(0));
    },
    flushFrames() {
      while (frames.some(Boolean)) {
        const pending = frames.splice(0);
        pending.forEach((callback) => callback?.(0));
      }
    },
  });
  Object.defineProperty(container, 'firstElementChild', { get: () => container._rows[0] || null });
  Object.defineProperty(container, 'lastElementChild', { get: () => container._rows.at(-1) || null });
  return container;
}

function fakeTrack(id, overrides = {}) {
  return {
    id, title: `Track ${id}`, artist: 'Artist', album: 'Album', format: 'FLAC',
    duration: 125, sampleRate: 44100, bitDepth: 16, dateAdded: 0, missing: false,
    ...overrides,
  };
}

function createFakeHost(overrides = {}) {
  let arriveTimer = 0;
  const idleCalls = [];
  const streamingCalls = [];
  const statCalls = [];
  const favorites = new Set(['b']);
  const host = {
    format: {
      escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
      isLossless: (value) => ['FLAC', 'WAV', 'WAVE', 'AIFF', 'AIF'].includes(typeof value === 'object' ? value.format : value),
      isHiRes: (track) => host.format.isLossless(track) && (track.bitDepth >= 24 || track.sampleRate > 44100),
      fileUrl: (path) => `file:///${path}`,
    },
    tuning: { hasChanges: (values) => Boolean(values?.customized), default: () => ({ customized: false }), forTrack: () => undefined },
    isFavorite: (id) => favorites.has(id),
    metadataGaps: () => [],
    scheduleIdleWork: (callback) => { idleCalls.push(callback); callback({ didTimeout: true, timeRemaining: () => 0 }); return idleCalls.length; },
    cancelIdleWork: () => {},
    recordRenderStats: (stats) => statCalls.push(stats),
    onTrackTableStreaming: (streaming) => streamingCalls.push(streaming),
    onStreamComplete: () => {},
    getArriveTimer: () => arriveTimer,
    setArriveTimer: (value) => { arriveTimer = value; },
    ...overrides,
  };
  host.__calls = { idleCalls, streamingCalls, statCalls };
  host.__favorites = favorites;
  return host;
}

async function run() {
  // Structural: this must be a real, registerable mechanic.
  const host = createFakeHost();
  const mechanic = createLinearListMechanic(host);
  const { valid, errors } = validateMechanic(mechanic);
  assert.equal(valid, true, `linear-list must satisfy the contract: ${errors.join(', ')}`);

  // trackRowHtml: pure markup, hand-verified against the original
  // trackRowHtml() template in renderer.js (pre-extraction).
  const track = fakeTrack('a', { title: 'A & B', artworkPath: 'art.jpg' });
  const html = mechanic.__test__.trackRowHtml(track, 0, 'a', 'a');
  assert.ok(html.startsWith('<div class="track-row playing is-selected  " role="option" aria-selected="true" tabindex="0" style="--row-index:0" data-id="a">'), 'active track must start selected, focusable, and expose the correct row markup opening');
  assert.ok(html.includes('A &amp; B'), 'title must be escaped through host.format.escapeHtml');
  assert.ok(html.includes("background-image:url('file:///art.jpg')"), 'artwork must resolve through host.format.fileUrl');
  assert.ok(html.includes('class="favorite '), 'favorite button must be present');

  const notPlaying = mechanic.__test__.trackRowHtml(track, 0, 'different-id', 'different-id');
  assert.ok(!notPlaying.includes('track-row playing'), 'non-active track must not get the "playing" class');

  const favoriteTrack = mechanic.__test__.trackRowHtml(fakeTrack('b'), 1, null, 'b');
  assert.ok(favoriteTrack.includes('favorite active'), 'favorited tracks (host.isFavorite) must render the active favorite button state');

  // mount(): sets up delegated listeners, does an initial paint.
  const container = createFakeContainer();
  const calls = { selected: [], activated: [], contextMenu: [], rowAction: [], escape: 0 };
  const tracks3 = [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')];
  mechanic.mount(container, tracks3, {
    activeId: 'a',
    onSelect: (id) => calls.selected.push(id),
    onActivate: (id) => calls.activated.push(id),
    onContextMenu: (id, event) => calls.contextMenu.push([id, event]),
    onRowAction: (action, id) => calls.rowAction.push([action, id]),
    onEscape: () => { calls.escape += 1; },
  });
  assert.equal((container.innerHTML.match(/class="track-row/g) || []).length, 3, 'mount must paint all 3 tracks immediately (under IMMEDIATE_LIMIT)');
  assert.ok(container._listeners.click, 'mount must register a click listener');
  assert.ok(container._listeners.contextmenu, 'mount must register a contextmenu listener');
  assert.ok(container._listeners.focusin, 'mount must register a focus listener');
  assert.ok(container._listeners.keydown, 'mount must register a keyboard listener');
  assert.equal(container._rows.filter((row) => row.classList.contains('is-selected')).length, 1, 'mount must expose exactly one selected row');
  assert.equal(container._rows[0].getAttribute('aria-selected'), 'true', 'selected row must expose aria-selected');

  // Simulate a plain row click -> onSelect then onActivate.
  container.dispatch('click', { target: { closest: (selector) => (selector === '.track-row' ? { dataset: { id: encodeURIComponent('b') } } : null) } });
  assert.deepEqual(calls.selected, ['b']);
  assert.deepEqual(calls.activated, ['b']);

  // Keyboard browsing changes intent only: selection moves, but playback is
  // not requested until Enter. This is the regression test for MBA-001.
  const keyEvents = [];
  const keyboardEvent = (key, target, extras = {}) => ({
    key, target, shiftKey: false, preventDefault: () => keyEvents.push(`prevent:${key}`), stopPropagation: () => keyEvents.push(`stop:${key}`), ...extras,
  });
  container.dispatch('keydown', keyboardEvent('ArrowDown', container._rows[0]));
  assert.equal(container._rows.filter((row) => row.classList.contains('is-selected')).length, 1, 'arrow traversal must keep one selected row');
  assert.equal(container._rows[1].classList.contains('is-selected'), true, 'ArrowDown must select the next row');
  assert.equal(container._rows[1].getAttribute('aria-selected'), 'true', 'keyboard-selected row must be announced');
  assert.equal(calls.activated.length, 1, 'arrow traversal must not activate playback');
  container.dispatch('keydown', keyboardEvent('Enter', container._rows[1]));
  assert.deepEqual(calls.activated, ['b', 'b'], 'Enter must request activation for the selected row');
  container.dispatch('keydown', keyboardEvent('ContextMenu', container._rows[1]));
  assert.equal(calls.contextMenu.at(-1)[0], 'b', 'context-menu key must use the selected row');
  container.dispatch('keydown', keyboardEvent('Escape', container._rows[1]));
  assert.equal(calls.escape, 1, 'Escape must delegate the standard back behavior exactly once');

  // Simulate a favorite-button click -> onRowAction, NOT onActivate.
  container.dispatch('click', {
    target: {
      closest: (selector) => {
        if (selector === '.track-row') return { dataset: { id: encodeURIComponent('c') } };
        if (selector === '.favorite') return {};
        return null;
      },
    },
  });
  assert.deepEqual(calls.rowAction, [['favorite', 'c']]);
  assert.deepEqual(calls.activated, ['b', 'b'], 'favorite click must not also fire onActivate');

  // Simulate contextmenu.
  container.dispatch('contextmenu', { target: { closest: (selector) => (selector === '.track-row' ? { dataset: { id: encodeURIComponent('a') } } : null) } });
  assert.equal(calls.contextMenu.length, 2, 'pointer and keyboard context menus must each fire once');
  assert.equal(calls.contextMenu.at(-1)[0], 'a', 'onContextMenu must receive the decoded track id');

  // update(): repaint without re-registering listeners; also exercises the
  // chunked-streaming path (95 tracks vs. IMMEDIATE_LIMIT=90).
  const priorClickListener = container._listeners.click;
  const manyTracks = Array.from({ length: 95 }, (_, index) => fakeTrack(`t${index}`));
  mechanic.update(manyTracks, 't0', { animateRows: true });
  assert.equal(container._listeners.click, priorClickListener, 'update must not re-register listeners');
  assert.equal((container.innerHTML.match(/class="track-row/g) || []).length, 95, 'chunked streaming must eventually paint every track');
  assert.ok(host.__calls.streamingCalls.includes(true), 'streaming must be signaled true when immediate paint does not cover every track');
  assert.equal(host.__calls.streamingCalls.at(-1), false, 'streaming must be signaled false once the chunk chain completes');

  // One navigation intent must not dirty every row in a large library. A
  // subsequent focusin (as emitted by Chromium focus()) is the same intent.
  const library = Array.from({ length: 2000 }, (_, index) => fakeTrack(`large-${index}`));
  mechanic.update(library, 'large-0', { forceFull: true });
  container._rows.forEach(row => { row.attributeWrites = 0; });
  container.dispatch('keydown', keyboardEvent('ArrowDown', container._rows[0]));
  container.dispatch('focusin', { target: container._rows[1] });
  assert.ok(container._rows.reduce((sum, row) => sum + row.attributeWrites, 0) <= 4, 'One arrow key must update only the old and new selected rows, including its focusin event');
  assert.equal(container._rows[1].tabIndex, 0);
  assert.equal(container._rows.filter(row => row.classList.contains('is-selected')).length, 1);
  const retainedRow = container._rows[1];
  container._rows.forEach(row => { row.attributeWrites = 0; });
  mechanic.update(library, 'large-1');
  assert.equal(container._rows[1], retainedRow, 'Playback updates must preserve the keyboard DOM node');
  assert.equal(container._rows[1].classList.contains('playing'), true);
  assert.equal(container._rows.filter(row => row.classList.contains('is-selected')).length, 1);
  assert.equal(container._rows.reduce((sum, row) => sum + row.attributeWrites, 0), 0, 'Unchanged selection must not rewrite ARIA on a playback update');

  // A content change (here a favorite) replaces only the row it concerns.
  // A repaint that only toggled playing/selected state left the heart of a
  // newly favorited track empty until the list was rebuilt.
  const beforeFavorite = container._rows.slice();
  host.__favorites.add('large-5');
  mechanic.update(library, 'large-1');
  assert.equal(container._rows.length, library.length);
  assert.notEqual(container._rows[5], beforeFavorite[5], 'A favorited row must be re-rendered');
  assert.match(container._rows[5].html, /class="favorite active"/, 'The re-rendered row must show the favorite');
  assert.equal(container._rows.filter((row, index) => row !== beforeFavorite[index]).length, 1, 'Only the changed row may be replaced');
  assert.equal(container._rows[1], retainedRow, 'The selected row must keep its element across a content change elsewhere');
  container.dispatch('keydown', keyboardEvent('ArrowDown', container._rows[4]));
  assert.equal(container._rows[5].classList.contains('is-selected'), true, 'A replaced row must still take part in selection');
  assert.equal(container._rows[5].focused, true);
  assert.equal(container._rows.filter(row => row.classList.contains('is-selected')).length, 1);

  // On-demand rows (a container with layout). Rows are materialized only up
  // to AHEAD_PX below the viewport, the spacer stands in for the rest, and a
  // refresh re-checks only rows near the viewport.
  {
    const templated = { count: 0 };
    const layoutHost = createFakeHost({ isFavorite: (id) => { templated.count += 1; return layoutHost.__favorites.has(id); } });
    const listMechanic = createLinearListMechanic(layoutHost);
    const list = createLayoutContainer({ innerHeight: 600, pitch: 50 });
    const selections = [];
    listMechanic.mount(list, [], { onSelect: (id) => selections.push(id) });
    const bigLibrary = Array.from({ length: 3000 }, (_, index) => fakeTrack(`big-${index}`));
    const idleBefore = layoutHost.__calls.idleCalls.length;
    listMechanic.update(bigLibrary, null);
    list.flushFrames();
    assert.equal(list._rows.length, 40, 'a large library must paint only the viewport and nearby rows');
    assert.equal(layoutHost.__calls.idleCalls.length, idleBefore, 'with layout, the rest of the list must not be appended in idle time');
    assert.equal(list.style.getPropertyValue('--track-rows-pending-height'), `${2960 * 50}px`, 'the spacer must stand in for the rows not yet materialized');
    assert.equal(layoutHost.__calls.streamingCalls.at(-1), true);

    list.scrollTo(10000);
    const beforeScroll = list._rows.length;
    list.flushFrame();
    assert.ok(list._rows.length - beforeScroll <= 24, 'a scroll frame must not insert a large row burst');
    list.flushFrames();
    const afterScroll = list._rows.length;
    assert.ok(afterScroll >= 240 && afterScroll < 600, `scrolling must materialize rows up to the viewport and no further (got ${afterScroll})`);
    assert.equal(list._rows.at(-1).dataset.id, `big-${afterScroll - 1}`, 'rows must be materialized in order');

    // A playback change toggles state without replacing rows or re-rendering
    // rows far from the viewport.
    const elements = list._rows.slice();
    templated.count = 0;
    listMechanic.update(bigLibrary, 'big-200');
    assert.ok(templated.count < 80, `a refresh must re-render only rows near the viewport (re-rendered ${templated.count})`);
    assert.ok(list._rows.every((row, index) => row === elements[index]), 'a playback change must keep every row element');
    assert.equal(list._rows[200].classList.contains('playing'), true);

    // A change far from the viewport is applied when the row comes near it.
    layoutHost.__favorites.add('big-5');
    layoutHost.__favorites.add('big-200');
    listMechanic.update(bigLibrary, 'big-200');
    assert.notEqual(list._rows[200], elements[200], 'a changed row near the viewport must be replaced at once');
    assert.match(list._rows[200].html, /class="favorite active"/);
    assert.equal(list._rows[200].classList.contains('playing'), true, 'a replaced row must keep its playing state');
    assert.equal(list._rows[5], elements[5], 'a changed row far from the viewport is left until it comes near');
    list.scrollTo(0);
    list.flushFrames();
    assert.notEqual(list._rows[5], elements[5], 'scrolling a changed row near the viewport must bring it up to date');
    assert.match(list._rows[5].html, /class="favorite active"/);

    // Keyboard selection brings a far, changed row up to date before focusing
    // it, and End reaches a row that was never materialized.
    list.scrollTo(10000);
    list.flushFrames();
    layoutHost.__favorites.add('big-6');
    listMechanic.update(bigLibrary, 'big-200');
    list.dispatch('keydown', keyboardEvent('ArrowDown', list._rows[5]));
    assert.match(list._rows[6].html, /class="favorite active"/, 'a far row must be brought up to date when it is selected');
    assert.equal(list._rows[6].focused, true);
    list.dispatch('keydown', keyboardEvent('End', list._rows[6]));
    assert.equal(list._rows.length, 3000);
    assert.equal(list._rows[2999].focused, true, 'End must focus the last track, materializing it first');
    assert.equal(list._rows.filter((row) => row.classList.contains('is-selected')).length, 1);
    assert.deepEqual(selections.slice(-2), ['big-6', 'big-2999']);

    listMechanic.destroy();
    assert.equal(list.style.getPropertyValue('--track-rows-pending-height'), '');
  }

  // destroy(): tears down listeners.
  mechanic.destroy();
  assert.equal(container._listeners.click, undefined, 'destroy must remove the click listener');
  assert.equal(container._listeners.contextmenu, undefined, 'destroy must remove the contextmenu listener');
  assert.equal(container._listeners.focusin, undefined, 'destroy must remove the focus listener');
  assert.equal(container._listeners.keydown, undefined, 'destroy must remove the keyboard listener');

  console.log('Linear-list mechanic audit passed: contract-valid, markup matches the original template, mount/update/destroy behave correctly, including chunked streaming.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
