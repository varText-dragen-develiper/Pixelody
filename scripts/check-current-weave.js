const assert = require('node:assert/strict');

const { createCurrentWeaveMechanic } = require('../src/theme-runtime/navigation/current-weave');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const CARD_TAG = /<div class="(current-weave-card[^"]*)" role="option" aria-selected="([^"]*)" tabindex="([^"]*)" data-id="([^"]*)" data-index="([^"]*)" data-state="[^"]*" style="([^"]*)">/g;

function createCard(stage, match) {
  const classes = new Set(match[1].split(' ').filter(Boolean));
  const card = {
    dataset: { id: match[4], index: match[5] },
    classList: { contains: (name) => classes.has(name) },
    closest: (selector) => (selector === '.current-weave-card' ? card : null),
    focus: () => { stage._focused = card; stage._listeners.focusin?.({ target: card }); },
    _classes: classes,
    _ariaSelected: match[2],
    _tabIndex: match[3],
  };
  return card;
}

function createStage() {
  return {
    className: '', _listeners: {}, _cards: [], _focused: null,
    set innerHTML(html) {
      CARD_TAG.lastIndex = 0;
      this._cards = [];
      let match;
      while ((match = CARD_TAG.exec(html))) this._cards.push(createCard(this, match));
    },
    get innerHTML() { return '[fake]'; },
    querySelector(selector) {
      if (selector === '.current-weave-card.is-selected') return this._cards.find((card) => card._classes.has('is-selected')) || null;
      return null;
    },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener(type, fn) { if (this._listeners[type] === fn) delete this._listeners[type]; },
    dispatch(type, event) { this._listeners[type]?.(event); },
  };
}

function createContainer() {
  const classes = new Set();
  return {
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    style: { setProperty() {}, removeProperty() {} },
    set innerHTML(_value) {},
    appendChild() {},
  };
}

function track(id, overrides = {}) {
  return { id, title: `Track ${id}`, artist: 'Artist', album: 'Album', duration: 125, format: 'FLAC', artworkPath: null, ...overrides };
}

async function run() {
  const mechanic = createCurrentWeaveMechanic({
    format: {
      escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      durationText: (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`,
      fileUrl: (path) => `file:///${path}`,
    },
  });
  assert.equal(validateMechanic(mechanic).valid, true);
  const tracks = [track('a'), track('b', { title: 'B & Beyond' }), track('c', { missing: true })];
  assert.equal(mechanic.__test__.selectedIndexFor(tracks, 'c', 'b'), 2);
  assert.equal(mechanic.__test__.selectedIndexFor(tracks, 'missing', 'b'), 1);
  assert.ok(mechanic.__test__.cardHtml(tracks[1], 1, 2, 'b', { playbackState: 'playing' }).includes('is-playing'));
  assert.ok(mechanic.__test__.cardHtml(tracks[1], 1, 1, 'a', { activationPendingId: 'b' }).includes('is-pending'));
  assert.ok(mechanic.__test__.cardHtml(tracks[1], 1, 1, 'a', { activationPendingId: 'b' }).includes('AWAITING CONFIRMATION'));
  assert.ok(mechanic.__test__.fieldHtml({ activationPendingId: 'c' }).includes('has-pending-route'));
  assert.ok(mechanic.__test__.fieldHtml({ activeId: 'b', selectedId: 'b' }).includes('has-confirmed-clearing'));
  assert.ok(mechanic.__test__.fieldHtml({ activeId: 'b', selectedId: 'c' }).includes('has-confirmed-output'));
  assert.ok(mechanic.__test__.cardHtml(tracks[1], 1, 1, 'a', {}).includes('B &amp; Beyond'));
  assert.ok(mechanic.__test__.captionHtml(tracks[1], tracks[0], 1, 3, {}).includes('NO') === false);
  assert.equal(mechanic.__test__.semanticTransitionKind(null, { activeId: 'a' }), '');
  assert.equal(mechanic.__test__.semanticTransitionKind({ activeId: 'a', selectedId: 'a' }, { activeId: 'b', selectedId: 'b' }), 'confirmation');
  assert.equal(mechanic.__test__.semanticTransitionKind({ activeId: 'a', selectedId: 'a' }, { activeId: 'a', selectedId: 'b' }), 'selection');
  assert.equal(mechanic.__test__.semanticTransitionKind({ activeId: 'a', selectedId: 'a', pendingId: '' }, { activeId: 'a', selectedId: 'a', pendingId: 'a' }), 'request');
  assert.equal(mechanic.__test__.semanticTransitionKind({ activeId: 'a', selectedId: 'a', pendingId: '', playbackState: 'paused' }, { activeId: 'a', selectedId: 'a', pendingId: '', playbackState: 'playing' }), 'playback');
  assert.equal(mechanic.__test__.normalizedWheelDelta({ deltaX: 2, deltaY: 40, deltaMode: 0 }), 40);
  assert.equal(mechanic.__test__.normalizedWheelDelta({ deltaX: -3, deltaY: 1, deltaMode: 1 }), -48);

  const stage = createStage();
  const caption = { className: '', innerHTML: '' };
  let created = 0;
  global.document = { createElement: () => (++created === 1 ? stage : caption) };
  const container = createContainer();
  const calls = { selected: [], activated: [], context: [], escaped: 0 };
  mechanic.mount(container, tracks, {
    activeId: 'b', playbackState: 'playing',
    onSelect: (id) => calls.selected.push(id),
    onActivate: (id) => calls.activated.push(id),
    onContextMenu: (id) => calls.context.push(id),
    onEscape: () => { calls.escaped += 1; },
  });
  assert.ok(container.classList.contains('current-weave-mounted'));
  assert.equal(stage._cards.length, 3);
  assert.ok(stage._cards.find((card) => card.dataset.id === 'b')._classes.has('is-selected'));
  assert.ok(stage._cards.find((card) => card.dataset.id === 'b')._classes.has('is-playing'));

  stage.dispatch('click', { target: stage._cards.find((card) => card.dataset.id === 'c') });
  assert.deepEqual(calls.selected, ['c']);
  assert.deepEqual(calls.activated, []);
  assert.ok(stage._cards.find((card) => card.dataset.id === 'c')._classes.has('is-selected'));
  assert.ok(stage._cards.find((card) => card.dataset.id === 'b')._classes.has('is-playing'), 'focus must not steal confirmed playback');
  stage.dispatch('click', { target: stage._cards.find((card) => card.dataset.id === 'c') });
  assert.deepEqual(calls.activated, ['c']);

  const selectedC = stage._cards.find((card) => card.dataset.id === 'c');
  stage.dispatch('keydown', { target: selectedC, key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.selected.at(-1), 'b');
  const selectedB = stage._cards.find((card) => card.dataset.id === 'b');
  let wheelPrevented = 0;
  stage.dispatch('wheel', { deltaX: 0, deltaY: 52, deltaMode: 0, ctrlKey: false, preventDefault() { wheelPrevented += 1; } });
  assert.equal(calls.selected.at(-1), 'c', 'vertical wheel-down should move the horizontal current forward');
  assert.equal(calls.activated.at(-1), 'c', 'wheel browsing must not activate a track');
  assert.equal(wheelPrevented, 1, 'handled wheel navigation should not scroll the parent surface');
  stage.dispatch('wheel', { deltaX: -52, deltaY: 0, deltaMode: 0, ctrlKey: false, preventDefault() { wheelPrevented += 1; } });
  assert.equal(calls.selected.at(-1), 'b', 'horizontal wheel-left should move the current backward');
  stage.dispatch('keydown', { target: selectedB, key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.activated.at(-1), 'b');

  mechanic.update(tracks, 'c', { playbackState: 'paused', activationPendingId: null, activationFailedId: 'a' });
  assert.ok(stage._cards.find((card) => card.dataset.id === 'c')._classes.has('is-playing'));
  assert.ok(stage._cards.find((card) => card.dataset.id === 'a')._classes.has('is-failed'));
  assert.ok(caption.innerHTML.includes('CURRENT / PAUSED'));
  stage.dispatch('contextmenu', { target: stage._cards.find((card) => card.dataset.id === 'a') });
  assert.equal(calls.context.at(-1), 'a');
  const selectedA = stage._cards.find((card) => card.dataset.id === 'a');
  stage.dispatch('keydown', { target: selectedA, key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.escaped, 1);

  mechanic.destroy();
  assert.equal(container.classList.contains('current-weave-mounted'), false);
  assert.equal(stage._listeners.click, undefined);
  assert.equal(stage._listeners.wheel, undefined);
  delete global.document;
  console.log('Current Weave mechanic audit passed: contract, focus/playback separation, two-step pointer activation, keyboard, failure, context, repaint, and teardown are sound.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
