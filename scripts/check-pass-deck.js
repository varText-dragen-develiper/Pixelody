const assert = require('node:assert/strict');

const { createPassDeckMechanic } = require('../src/theme-runtime/navigation/pass-deck');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const CARD_OPEN_TAG = /<div class="(pass-deck-card[^"]*)" style="([^"]*)" tabindex="0" role="button" aria-selected="([^"]*)" data-id="([^"]*)" data-index="([^"]*)">/g;

function parseStyle(styleText) {
  const props = {};
  styleText.split(';').forEach((declaration) => {
    const [name, value] = declaration.split(':');
    if (name && value !== undefined) props[name.trim()] = value.trim();
  });
  return props;
}

function createFakeCard(stage, match) {
  const classes = new Set(match.className.split(' ').filter(Boolean));
  const styleProps = parseStyle(match.style);
  const attributes = { 'aria-selected': match.selected };
  const stateLabel = { textContent: classes.has('is-playing') ? 'LIVE' : 'READY' };
  const card = {
    dataset: { id: match.id, index: match.index },
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
    },
    style: {
      setProperty: (name, value) => { styleProps[name] = String(value); },
      getPropertyValue: (name) => styleProps[name],
    },
    setAttribute: (name, value) => { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name],
    querySelector: (selector) => (selector === '.pass-deck-stub small' ? stateLabel : null),
    closest: (selector) => (selector === '.pass-deck-card' ? card : null),
    focus: () => {
      const previous = stage._focused;
      if (previous && previous !== card) stage._listeners.focusout?.({ target: previous, relatedTarget: card });
      stage._focused = card;
      stage._listeners.focusin?.({ target: card });
    },
    blur: () => {
      if (stage._focused !== card) return;
      stage._focused = null;
      stage._listeners.focusout?.({ target: card, relatedTarget: null });
    },
    _classes: classes,
    _styleProps: styleProps,
    _attributes: attributes,
    _stateLabel: stateLabel,
  };
  return card;
}

function createFakeStage() {
  const stage = {
    className: '',
    _cards: [],
    _focused: null,
    _listeners: {},
    set innerHTML(html) {
      CARD_OPEN_TAG.lastIndex = 0;
      const cards = [];
      let match;
      while ((match = CARD_OPEN_TAG.exec(html))) {
        cards.push(createFakeCard(stage, {
          className: match[1],
          style: match[2],
          selected: match[3],
          id: match[4],
          index: match[5],
        }));
      }
      stage._cards = cards;
    },
    get innerHTML() { return '[fake]'; },
    querySelectorAll: (selector) => (selector === '.pass-deck-card' ? stage._cards : []),
    querySelector: (selector) => {
      const indexMatch = selector.match(/data-index="(\d+)"/);
      return indexMatch ? stage._cards.find((card) => card.dataset.index === indexMatch[1]) || null : null;
    },
    addEventListener: (type, fn) => { stage._listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (stage._listeners[type] === fn) delete stage._listeners[type]; },
    dispatch: (type, event) => stage._listeners[type]?.(event),
  };
  return stage;
}

function createFakeContainer(stage, status) {
  const classes = new Set();
  const children = [];
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    set innerHTML(_value) { children.length = 0; },
    get innerHTML() { return ''; },
    appendChild: (child) => children.push(child),
    _stage: stage,
    _status: status,
  };
}

function fakeTrack(id, overrides = {}) {
  return { id, title: `Track ${id}`, artist: 'Artist', album: 'Album', duration: 125, artworkPath: null, ...overrides };
}

async function run() {
  const host = {
    format: {
      escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
      fileUrl: (path) => `file:///${path}`,
    },
  };
  const mechanic = createPassDeckMechanic(host);
  const { valid, errors } = validateMechanic(mechanic);
  assert.equal(valid, true, `pass-deck must satisfy the navigation contract: ${errors.join(', ')}`);

  const markup = mechanic.__test__.passHtml(fakeTrack('a', { title: 'A & B', artworkPath: 'art.jpg' }), 0, 0, true, true);
  assert.ok(markup.includes('pass-deck-card is-centered is-playing'));
  assert.ok(markup.includes('aria-selected="true"'));
  assert.ok(markup.includes('A &amp; B'));
  assert.ok(markup.includes("background-image:url('file:///art.jpg')"));
  assert.ok(markup.includes('--pass-offset:0'));
  assert.ok(markup.includes('<small>LIVE</small>'));
  assert.ok(mechanic.__test__.passHtml(fakeTrack('z'), 9, 9, false, false).includes('--pass-distance:4'), 'visual distance must clamp');

  const tracks = [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')];
  assert.equal(mechanic.__test__.centerIndexFor(tracks, 'b'), 1);
  assert.equal(mechanic.__test__.centerIndexFor(tracks, null), 0);
  assert.equal(mechanic.__test__.centerIndexFor([], null), -1);
  assert.equal(mechanic.__test__.tracksEqual(tracks, [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')]), true);
  assert.equal(mechanic.__test__.tracksEqual(tracks, [fakeTrack('a'), fakeTrack('c'), fakeTrack('b')]), false);
  assert.ok(mechanic.__test__.statusHtml(tracks, 'b').includes('PASS 02 / 03'));
  assert.ok(mechanic.__test__.statusHtml([], null).includes('NO PASSES'));

  const stage = createFakeStage();
  const status = { className: '', innerHTML: '' };
  let createCall = 0;
  global.document = {
    createElement: () => {
      createCall += 1;
      return createCall === 1 ? stage : status;
    },
  };
  const container = createFakeContainer(stage, status);
  const calls = { selected: [], activated: [], context: [] };
  mechanic.mount(container, tracks, {
    activeId: 'b',
    onSelect: (id) => calls.selected.push(id),
    onActivate: (id) => calls.activated.push(id),
    onContextMenu: (id) => calls.context.push(id),
  });
  assert.ok(container.classList.contains('pass-deck-mounted'));
  assert.equal(stage._cards.length, 3);
  const cardA = stage._cards[0];
  const cardB = stage._cards[1];
  const cardC = stage._cards[2];
  assert.ok(cardB._classes.has('is-centered'));
  assert.ok(cardB._classes.has('is-playing'));
  assert.equal(cardB._styleProps['--pass-offset'], '0');
  assert.ok(status.innerHTML.includes('CONFIRMED'));

  stage.dispatch('click', { target: cardC });
  assert.deepEqual(calls.selected, ['c']);
  assert.deepEqual(calls.activated, ['c']);
  assert.equal(stage._focused, cardC);
  assert.equal(cardB._styleProps['--pass-offset'], '0', 'click must not move before confirmation');

  stage.dispatch('keydown', { target: cardC, key: 'ArrowLeft', preventDefault() {} });
  assert.deepEqual(calls.activated, ['c', 'a'], 'arrow navigation must be relative to confirmed center, not stale focus');

  const cardsBefore = stage._cards;
  mechanic.update(tracks, 'c');
  assert.equal(stage._cards, cardsBefore, 'same-list recenter must preserve DOM nodes');
  assert.equal(cardC._styleProps['--pass-offset'], '0');
  assert.ok(cardC._classes.has('is-playing'));
  assert.equal(cardC._stateLabel.textContent, 'LIVE');
  assert.equal(cardB._stateLabel.textContent, 'READY');

  stage.dispatch('contextmenu', { target: cardC });
  assert.deepEqual(calls.context, ['c']);
  stage.dispatch('keydown', { target: cardC, key: 'Escape', preventDefault() {} });
  assert.equal(stage._focused, null);

  mechanic.update([fakeTrack('x'), fakeTrack('y')], 'y');
  assert.notEqual(stage._cards, cardsBefore, 'track-list change must repaint');
  assert.equal(stage._cards.length, 2);
  assert.ok(stage._cards[1]._classes.has('is-playing'));

  mechanic.destroy();
  assert.equal(container.classList.contains('pass-deck-mounted'), false);
  assert.equal(stage._listeners.click, undefined);
  assert.equal(stage._listeners.keydown, undefined);
  delete global.document;

  console.log('Pass Deck mechanic audit passed: contract, markup, single confirmed position, keyboard/click/focus, status, repaint, and destroy are correct.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
