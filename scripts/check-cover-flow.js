const assert = require('node:assert/strict');

const { createCoverFlowMechanic } = require('../src/theme-runtime/navigation/cover-flow');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

// A minimal fake DOM sufficient for cover-flow.js specifically. Unlike
// carousel.js (which mounts cards directly into the container it's given),
// cover-flow.js creates two child elements of its own (a .cover-flow-stage
// it paints cards into, and a .cover-flow-caption it writes the centered
// track's text into) -- so the fake container needs createElement/
// appendChild, and the fake stage needs the same querySelectorAll/
// querySelector card-tracking behavior carousel's fake container has.
const CARD_OPEN_TAG = /<div class="(cover-flow-card[^"]*)" style="([^"]*)" tabindex="0" role="button" aria-selected="([^"]*)" data-id="([^"]*)" data-index="([^"]*)">/g;

function parseStyle(styleText) {
  const props = {};
  styleText.split(';').forEach((declaration) => {
    const [name, value] = declaration.split(':');
    if (name && value !== undefined) props[name.trim()] = value.trim();
  });
  return props;
}

function createFakeCard(container, { className, style, id, index }) {
  const classSet = new Set(className.split(' ').filter(Boolean));
  const styleProps = parseStyle(style);
  const attributes = {};
  const card = {
    dataset: { id, index },
    classList: {
      add: (name) => classSet.add(name),
      remove: (name) => classSet.delete(name),
      toggle: (name, on) => { if (on) classSet.add(name); else classSet.delete(name); },
      contains: (name) => classSet.has(name),
    },
    style: {
      setProperty: (name, value) => { styleProps[name] = String(value); },
      getPropertyValue: (name) => styleProps[name],
    },
    setAttribute: (name, value) => { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name],
    closest: (selector) => (selector === '.cover-flow-card' ? card : null),
    // Mirrors real focus event ordering (see carousel's fake for why this
    // matters): focusout on the outgoing element fires before focusin on
    // the incoming one.
    focus: () => {
      const previous = container._focused;
      if (previous && previous !== card) container._listeners.focusout?.({ target: previous, relatedTarget: card });
      container._focused = card;
      container._listeners.focusin?.({ target: card });
    },
    blur: () => {
      if (container._focused !== card) return;
      container._focused = null;
      container._listeners.focusout?.({ target: card, relatedTarget: null });
    },
    _classSet: classSet,
    _styleProps: styleProps,
    _attributes: attributes,
  };
  return card;
}

function createFakeStage() {
  const stage = {
    _cards: [],
    _focused: null,
    _listeners: {},
    className: '',
    get innerHTML() { return '[fake]'; },
    set innerHTML(html) {
      CARD_OPEN_TAG.lastIndex = 0;
      const cards = [];
      let match;
      while ((match = CARD_OPEN_TAG.exec(html))) {
        cards.push(createFakeCard(stage, { className: match[1], style: match[2], id: match[4], index: match[5] }));
      }
      stage._cards = cards;
    },
    querySelectorAll: (selector) => (selector === '.cover-flow-card' ? stage._cards : []),
    querySelector: (selector) => {
      const indexMatch = selector.match(/data-index="(\d+)"/);
      if (!indexMatch) return null;
      return stage._cards.find((card) => card.dataset.index === indexMatch[1]) || null;
    },
    addEventListener: (type, fn) => { stage._listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (stage._listeners[type] === fn) delete stage._listeners[type]; },
    dispatch: (type, event) => stage._listeners[type]?.(event),
  };
  return stage;
}

function createFakeCaption() {
  return { innerHTML: '' };
}

function createFakeContainer() {
  const classSet = new Set();
  const children = [];
  let nextStage = null;
  let nextCaption = null;
  const container = {
    classList: {
      add: (name) => classSet.add(name),
      remove: (name) => classSet.delete(name),
      contains: (name) => classSet.has(name),
    },
    set innerHTML(_value) { children.length = 0; },
    get innerHTML() { return ''; },
    appendChild: (child) => { children.push(child); },
    get _stage() { return nextStage; },
    get _caption() { return nextCaption; },
  };
  // document.createElement is stubbed globally below to hand back these
  // two fakes in order (stage first, then caption), matching mount()'s
  // creation order in cover-flow.js.
  container.__provideElements = (stage, caption) => { nextStage = stage; nextCaption = caption; };
  return container;
}

async function run() {
  const host = {
    format: {
      escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
      fileUrl: (path) => `file:///${path}`,
    },
  };
  const mechanic = createCoverFlowMechanic(host);
  const { valid, errors } = validateMechanic(mechanic);
  assert.equal(valid, true, `cover-flow must satisfy the contract: ${errors.join(', ')}`);

  function fakeTrack(id, overrides = {}) {
    return { id, title: `Track ${id}`, artist: 'Artist', album: 'Album', duration: 125, artworkPath: null, ...overrides };
  }

  // coverHtml/captionHtml: pure markup.
  const track = fakeTrack('a', { title: 'A & B', artworkPath: 'art.jpg' });
  const html = mechanic.__test__.coverHtml(track, 0, 0, true);
  assert.ok(html.includes('cover-flow-card is-playing'), 'active cover must get is-playing');
  assert.ok(html.includes("background-image:url('file:///art.jpg')"), 'artwork must resolve through host.format.fileUrl');
  assert.ok(html.includes('cover-flow-reflection'), 'each cover must carry a reflection element');
  assert.ok(html.includes('--card-offset:0'), 'offset must be written as a CSS custom property');
  assert.ok(html.includes('--card-distance:0'), 'distance must be written as a CSS custom property');

  const distant = mechanic.__test__.coverHtml(track, 5, 9, false);
  assert.ok(distant.includes('--card-distance:4'), 'distance must clamp at MAX_VISUAL_DISTANCE (4), not grow unbounded');

  const captionMarkup = mechanic.__test__.captionHtml(fakeTrack('a', { title: 'A & B' }));
  assert.ok(captionMarkup.includes('A &amp; B'), 'caption title must be escaped');
  assert.ok(captionMarkup.includes('cover-flow-caption-duration'), 'caption must include a duration element');
  assert.equal(mechanic.__test__.captionHtml(null), '', 'no active track must produce an empty caption');

  // centerIndexFor: pure function backing both paint() and recenterOn().
  const tracks3 = [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')];
  assert.equal(mechanic.__test__.centerIndexFor(tracks3, 'c'), 2);
  assert.equal(mechanic.__test__.centerIndexFor(tracks3, null), 0, 'nothing playing must fall back to the first cover');
  assert.equal(mechanic.__test__.centerIndexFor(tracks3, 'not-in-list'), 0, 'an activeId genuinely absent from the list must fall back to the first cover, not throw or return -1');

  // tracksEqual: id/order comparison, not reference or object identity.
  assert.equal(mechanic.__test__.tracksEqual(tracks3, [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')]), true);
  assert.equal(mechanic.__test__.tracksEqual(tracks3, [fakeTrack('a'), fakeTrack('b')]), false, 'different length must not be equal');
  assert.equal(mechanic.__test__.tracksEqual([fakeTrack('a')], [fakeTrack('b')]), false, 'same length, different id must not be equal');

  // mount()/update()/destroy() through the real DOM API surface this
  // mechanic actually calls (createElement/appendChild plus stage/caption
  // element behavior) rather than reimplementing container-level fakes,
  // since mount() builds its own children instead of writing straight into
  // the container the way carousel.js does.
  const stage = createFakeStage();
  const caption = createFakeCaption();
  let createElementCallCount = 0;
  global.document = {
    createElement: (tag) => {
      assert.equal(tag, 'div');
      createElementCallCount += 1;
      return createElementCallCount === 1 ? stage : caption;
    },
  };
  const container = createFakeContainer();

  const calls = { activated: [], contextMenu: [] };
  mechanic.mount(container, tracks3, {
    activeId: 'b',
    onActivate: (id) => calls.activated.push(id),
    onContextMenu: (id, event) => calls.contextMenu.push([id, event]),
  });
  assert.ok(container.classList.contains('cover-flow-mounted'), 'mount must mark the container cover-flow-mounted');
  assert.equal(stage._cards.length, 3, 'mount must paint all 3 covers into the stage');
  const cardB = stage._cards.find((card) => card.dataset.id === 'b');
  assert.equal(cardB._styleProps['--card-offset'], '0', 'the active track must be centered (offset 0) on mount');
  assert.ok(cardB._classSet.has('is-playing'));
  assert.ok(caption.innerHTML.includes('Track b'), 'caption must reflect the centered (active) track on mount');

  // Arrow keys request activation of the neighbor by data-index; nothing
  // moves until update() confirms it -- same "one source of truth" rule
  // carousel.js established, applied here on purpose (see the module
  // comment in cover-flow.js).
  stage.dispatch('keydown', { target: cardB, key: 'ArrowLeft', preventDefault: () => {} });
  assert.deepEqual(calls.activated, ['a']);
  assert.equal(cardB._styleProps['--card-offset'], '0', 'nothing must visually move just from pressing an arrow key');

  mechanic.update(tracks3, 'a');
  const cardA = stage._cards.find((card) => card.dataset.id === 'a');
  assert.equal(cardA._styleProps['--card-offset'], '0', 'once activation is confirmed via update(), the shelf recenters on the new activeId');
  assert.ok(cardA._classSet.has('is-playing'));
  assert.ok(caption.innerHTML.includes('Track a'), 'caption must follow a same-list recenter');

  // Click requests activation and focuses for keyboard continuity, exactly
  // once, without moving the shelf itself.
  const cardC = stage._cards.find((card) => card.dataset.id === 'c');
  stage.dispatch('click', { target: cardC });
  assert.deepEqual(calls.activated, ['a', 'c']);
  assert.equal(stage._focused, cardC);
  assert.equal(cardA._styleProps['--card-offset'], '0', 'clicking a cover must not move the shelf by itself');

  // Context menu.
  stage.dispatch('contextmenu', { target: cardA });
  assert.deepEqual(calls.contextMenu.map((entry) => entry[0]), ['a']);

  // Escape blurs without throwing.
  assert.doesNotThrow(() => stage.dispatch('keydown', { target: cardC, key: 'Escape', preventDefault: () => {} }));
  assert.equal(stage._focused, null);

  // A genuine track-list change forces a full repaint (new DOM nodes),
  // unlike the same-list case above.
  const cardsBeforeListChange = stage._cards;
  mechanic.update([fakeTrack('x'), fakeTrack('y'), fakeTrack('z')], 'z');
  assert.notEqual(stage._cards, cardsBeforeListChange, 'a genuine list change must rebuild the covers');
  assert.equal(stage._cards.length, 3);
  const cardZ = stage._cards.find((card) => card.dataset.id === 'z');
  assert.equal(cardZ._styleProps['--card-offset'], '0');
  assert.ok(caption.innerHTML.includes('Track z'));

  // destroy(): tears down listeners and the marker class.
  mechanic.destroy();
  assert.equal(stage._listeners.click, undefined);
  assert.equal(stage._listeners.keydown, undefined);
  assert.equal(stage._listeners.focusin, undefined);
  assert.equal(stage._listeners.focusout, undefined);
  assert.equal(stage._listeners.contextmenu, undefined);
  assert.equal(container.classList.contains('cover-flow-mounted'), false, 'destroy must remove the cover-flow-mounted marker');

  delete global.document;

  console.log('Cover Flow mechanic audit passed: contract-valid, markup/caption and offset math correct, keyboard/click/focus navigation and destroy all behave correctly.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
