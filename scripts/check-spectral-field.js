const assert = require('node:assert/strict');

const { createSpectralFieldMechanic } = require('../src/theme-runtime/navigation/spectral-field');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const CARD_OPEN_TAG = /<div class="(spectral-field-card[^"]*)" style="([^"]*)" tabindex="0" role="button" aria-selected="([^"]*)" data-id="([^"]*)" data-index="([^"]*)">/g;

function parseStyle(styleText) {
  const props = {};
  styleText.split(';').forEach((declaration) => {
    const [name, value] = declaration.split(':');
    if (name && value !== undefined) props[name.trim()] = value.trim();
  });
  return props;
}

function createFakeCard(stage, values) {
  const classSet = new Set(values.className.split(' ').filter(Boolean));
  const styleProps = parseStyle(values.style);
  const attributes = {};
  const card = {
    dataset: { id: values.id, index: values.index },
    classList: {
      toggle: (name, on) => { if (on) classSet.add(name); else classSet.delete(name); },
      contains: (name) => classSet.has(name),
    },
    style: {
      setProperty: (name, value) => { styleProps[name] = String(value); },
      getPropertyValue: (name) => styleProps[name],
    },
    setAttribute: (name, value) => { attributes[name] = String(value); },
    closest: (selector) => (selector === '.spectral-field-card' ? card : null),
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
    _classSet: classSet,
    _styleProps: styleProps,
    _attributes: attributes,
  };
  return card;
}

function createFakeStage() {
  return {
    _cards: [],
    _focused: null,
    _listeners: {},
    className: '',
    get innerHTML() { return '[fake]'; },
    set innerHTML(html) {
      CARD_OPEN_TAG.lastIndex = 0;
      this._cards = [];
      let match;
      while ((match = CARD_OPEN_TAG.exec(html))) {
        this._cards.push(createFakeCard(this, { className: match[1], style: match[2], id: match[4], index: match[5] }));
      }
    },
    querySelectorAll(selector) { return selector === '.spectral-field-card' ? this._cards : []; },
    querySelector(selector) {
      const match = selector.match(/data-index="(\d+)"/);
      return match ? this._cards.find((card) => card.dataset.index === match[1]) || null : null;
    },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener(type, fn) { if (this._listeners[type] === fn) delete this._listeners[type]; },
    dispatch(type, event) { this._listeners[type]?.(event); },
  };
}

function createFakeContainer() {
  const classes = new Set();
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    set innerHTML(_value) {},
    appendChild() {},
  };
}

function track(id, overrides = {}) {
  return { id, title: `Track ${id}`, artist: 'Artist', duration: 125, artworkPath: null, format: 'FLAC', quality: 'LOSSLESS', ...overrides };
}

async function run() {
  const mechanic = createSpectralFieldMechanic({
    format: {
      escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
      fileUrl: (path) => `file:///${path}`,
    },
  });
  const validation = validateMechanic(mechanic);
  assert.equal(validation.valid, true, validation.errors.join(', '));

  const sample = track('a', { title: 'A & B', artworkPath: 'art.jpg' });
  const cardMarkup = mechanic.__test__.cardHtml(sample, 0, 0, true, true);
  assert.ok(cardMarkup.includes('spectral-field-card is-playing is-centered'));
  assert.ok(cardMarkup.includes('A &amp; B'));
  assert.ok(cardMarkup.includes("background-image:url('file:///art.jpg')"));
  assert.ok(cardMarkup.includes('--field-distance:0'));
  assert.ok(mechanic.__test__.cardHtml(sample, 0, 12, false, false).includes('--field-distance:5'), 'visual depth must clamp');
  assert.ok(mechanic.__test__.captionHtml(sample, 0, 3, true).includes('EVENT 01 / 03'));
  assert.ok(mechanic.__test__.captionHtml(sample, 0, 3, true).includes('r-x LIVE'));

  const tracks = [track('a'), track('b'), track('c')];
  assert.equal(mechanic.__test__.centerIndexFor(tracks, 'b'), 1);
  assert.equal(mechanic.__test__.centerIndexFor(tracks, 'missing'), 0);
  assert.equal(mechanic.__test__.tracksEqual(tracks, [track('a'), track('b'), track('c')]), true);

  const stage = createFakeStage();
  const caption = { className: '', innerHTML: '' };
  let created = 0;
  global.document = { createElement: () => (++created === 1 ? stage : caption) };
  const container = createFakeContainer();
  const calls = { activated: [], context: [] };
  mechanic.mount(container, tracks, {
    activeId: 'b',
    onActivate: (id) => calls.activated.push(id),
    onContextMenu: (id) => calls.context.push(id),
  });
  assert.ok(container.classList.contains('spectral-field-mounted'));
  assert.equal(stage._cards.length, 3);
  const cardB = stage._cards.find((card) => card.dataset.id === 'b');
  assert.equal(cardB._styleProps['--field-offset'], '0');
  assert.ok(cardB._classSet.has('is-centered'));
  assert.ok(caption.innerHTML.includes('Track b'));

  stage.dispatch('keydown', { target: cardB, key: 'ArrowRight', preventDefault() {} });
  assert.deepEqual(calls.activated, ['c']);
  assert.equal(cardB._styleProps['--field-offset'], '0', 'requests must not move the field before confirmed update');
  mechanic.update(tracks, 'c');
  const cardC = stage._cards.find((card) => card.dataset.id === 'c');
  assert.equal(cardC._styleProps['--field-offset'], '0');
  assert.ok(caption.innerHTML.includes('Track c'));

  stage.dispatch('click', { target: cardB });
  assert.deepEqual(calls.activated, ['c', 'b']);
  assert.equal(stage._focused, cardB);
  stage.dispatch('contextmenu', { target: cardC });
  assert.deepEqual(calls.context, ['c']);
  stage.dispatch('keydown', { target: cardB, key: 'Escape', preventDefault() {} });
  assert.equal(stage._focused, null);

  const oldCards = stage._cards;
  mechanic.update([track('x'), track('y')], 'y');
  assert.notEqual(stage._cards, oldCards);
  assert.equal(stage._cards.length, 2);

  mechanic.destroy();
  assert.equal(container.classList.contains('spectral-field-mounted'), false);
  assert.equal(stage._listeners.click, undefined);
  assert.equal(stage._listeners.keydown, undefined);
  delete global.document;
  console.log('Spectral Field mechanic audit passed: contract, depth math, confirmed-position navigation, keyboard/click/context behavior, repaint, and teardown are sound.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
