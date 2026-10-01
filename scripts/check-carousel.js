const assert = require('node:assert/strict');

const { createCarouselMechanic } = require('../src/theme-runtime/navigation/carousel');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

// A minimal fake DOM sufficient for carousel.js specifically. Unlike
// linear-list.js (which only ever writes HTML and reads events via
// event.target.closest()), carousel.js also QUERIES the container it wrote
// to (querySelectorAll('.carousel-card'), querySelector('[data-index=...]'))
// to move focus and update --card-offset without a full repaint. That
// means the fake container has to actually track "elements", not just
// accumulate a string.
//
// innerHTML's setter is coupled to the exact opening-tag attribute order
// cardHtml() in carousel.js produces (class, style, tabindex, role,
// aria-selected, data-id, data-index) -- acceptable here because this test
// owns both sides and is verifying that exact contract, the same way
// check-linear-list.js's markup assertions are coupled to trackRowHtml()'s
// shape.
const CARD_OPEN_TAG = /<div class="(carousel-card[^"]*)" style="([^"]*)" tabindex="0" role="button" aria-selected="([^"]*)" data-id="([^"]*)" data-index="([^"]*)">/g;

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
    closest: (selector) => (selector === '.carousel-card' ? card : null),
    // Mirrors real focus event ordering: focusout on the outgoing element
    // fires before focusin on the incoming one, and blurring with nothing
    // taking focus next fires only focusout. carousel.js's hasFocusWithin
    // tracking depends on exactly this ordering (see its comment), so the
    // fake needs to get it right, not just fire focusin.
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

function createFakeContainer() {
  const classSet = new Set();
  const container = {
    _cards: [],
    _focused: null,
    _listeners: {},
    get innerHTML() { return '[fake]'; },
    set innerHTML(html) {
      CARD_OPEN_TAG.lastIndex = 0;
      const cards = [];
      let match;
      while ((match = CARD_OPEN_TAG.exec(html))) {
        cards.push(createFakeCard(container, { className: match[1], style: match[2], id: match[4], index: match[5] }));
      }
      container._cards = cards;
    },
    classList: {
      add: (name) => classSet.add(name),
      remove: (name) => classSet.delete(name),
      contains: (name) => classSet.has(name),
    },
    querySelectorAll: (selector) => (selector === '.carousel-card' ? container._cards : []),
    querySelector: (selector) => {
      const indexMatch = selector.match(/data-index="(\d+)"/);
      if (!indexMatch) return null;
      return container._cards.find((card) => card.dataset.index === indexMatch[1]) || null;
    },
    addEventListener: (type, fn) => { container._listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (container._listeners[type] === fn) delete container._listeners[type]; },
    dispatch: (type, event) => container._listeners[type]?.(event),
  };
  return container;
}

function fakeTrack(id, overrides = {}) {
  return { id, title: `Track ${id}`, artist: 'Artist', album: 'Album', duration: 125, artworkPath: null, ...overrides };
}

function createFakeHost() {
  return {
    format: {
      escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      durationText: (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--',
      fileUrl: (path) => `file:///${path}`,
    },
  };
}

async function run() {
  const host = createFakeHost();
  const mechanic = createCarouselMechanic(host);
  const { valid, errors } = validateMechanic(mechanic);
  assert.equal(valid, true, `carousel must satisfy the contract: ${errors.join(', ')}`);

  // cardHtml: pure markup.
  const track = fakeTrack('a', { title: 'A & B', artworkPath: 'art.jpg' });
  const html = mechanic.__test__.cardHtml(track, 0, 0, true);
  assert.ok(html.includes('carousel-card is-playing'), 'active card must get is-playing');
  assert.ok(html.includes('A &amp; B'), 'title must be escaped');
  assert.ok(html.includes("background-image:url('file:///art.jpg')"), 'artwork must resolve through host.format.fileUrl');
  assert.ok(html.includes('--card-offset:0'), 'offset must be written as a CSS custom property');
  assert.ok(html.includes('--card-distance:0'), 'distance must be written as a CSS custom property');

  const distant = mechanic.__test__.cardHtml(track, 3, 7, false);
  assert.ok(distant.includes('--card-distance:5'), 'distance must clamp at MAX_VISUAL_DISTANCE (5), not grow unbounded');

  // mount(): 3 tracks, activeId = 'b' -> the carousel opens centered on
  // whatever is currently playing, not always on the first track.
  const container = createFakeContainer();
  const calls = { selected: [], activated: [], contextMenu: [] };
  const tracks3 = [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')];
  mechanic.mount(container, tracks3, {
    activeId: 'b',
    onSelect: (id) => calls.selected.push(id),
    onActivate: (id) => calls.activated.push(id),
    onContextMenu: (id, event) => calls.contextMenu.push([id, event]),
  });
  assert.equal(container._cards.length, 3, 'mount must paint all 3 cards');
  assert.ok(container.classList.contains('carousel-mounted'), 'mount must mark the container carousel-mounted');
  const cardB = container._cards.find((card) => card.dataset.id === 'b');
  assert.equal(cardB._styleProps['--card-offset'], '0', 'the active track must be centered (offset 0) on mount');
  assert.ok(cardB._classSet.has('is-playing'), 'the active track card must carry is-playing');

  // Redesign (see docs/themes/THEME_RUNTIME_ARCHITECTURE.md's carousel
  // section): there is no more "browse without playing" state. Arrow keys
  // directly request activation of the neighboring track -- they do NOT
  // move anything visually by themselves. onSelect no longer exists as a
  // concept the mechanic fires.
  const cardA = container._cards.find((card) => card.dataset.id === 'a');
  container.dispatch('keydown', { target: cardB, key: 'ArrowLeft', preventDefault: () => {} });
  assert.deepEqual(calls.activated, ['a'], 'ArrowLeft from the centered card must request activation of its left neighbor');
  assert.equal(cardB._styleProps['--card-offset'], '0', 'nothing must visually move just from pressing an arrow key -- only update() (a confirmed activeId change) moves the carousel');

  // ArrowLeft is relative to the *pressed* card's own data-index (fixed at
  // paint time), not to whatever's currently centered -- pressing it again
  // on cardB (index 1) would just re-request 'a' again, not test the edge.
  // Genuinely test the edge by pressing it on the first card (index 0):
  // there's nothing at index -1, so this must be a no-op.
  const priorActivated = calls.activated.length;
  container.dispatch('keydown', { target: cardA, key: 'ArrowLeft', preventDefault: () => {} });
  assert.equal(calls.activated.length, priorActivated, 'ArrowLeft on the first card must not request activation of anything (no card at index -1)');

  // Now actually confirm the ArrowLeft-requested activation, the way the
  // app does after playTrack() succeeds: call update() with the new
  // activeId. Only now should the carousel visually move.
  mechanic.update(tracks3, 'a');
  assert.equal(cardA._styleProps['--card-offset'], '0', 'once activation is confirmed via update(), the carousel recenters on the new activeId');
  assert.ok(cardA._classSet.has('is-playing'));

  // ArrowRight from the (now actually) centered card 'a' requests 'b'.
  container.dispatch('keydown', { target: cardA, key: 'ArrowRight', preventDefault: () => {} });
  assert.deepEqual(calls.activated, ['a', 'b']);

  // Enter (re)activates whatever card currently holds focus.
  container.dispatch('keydown', { target: cardA, key: 'Enter', preventDefault: () => {} });
  assert.deepEqual(calls.activated, ['a', 'b', 'a']);

  // Click focuses (for keyboard continuity) and requests activation in one
  // gesture -- it does not itself move the carousel; matches linear-list's
  // click-to-play feel from the user's side, but per the redesign, the
  // visual move still only happens once update() confirms it.
  const cardC = container._cards.find((card) => card.dataset.id === 'c');
  container.dispatch('click', { target: cardC });
  assert.deepEqual(calls.activated, ['a', 'b', 'a', 'c']);
  assert.equal(cardA._styleProps['--card-offset'], '0', 'clicking a card must not move the carousel by itself -- it must still be centered on the last CONFIRMED activeId (a) until update() says otherwise');
  assert.equal(container._focused, cardC, 'the click must still focus the clicked card for keyboard continuity');

  // Escape blurs instead of throwing/doing something destructive.
  assert.doesNotThrow(() => container.dispatch('keydown', { target: cardC, key: 'Escape', preventDefault: () => {} }));
  assert.equal(container._focused, null);

  // Context menu.
  container.dispatch('contextmenu', { target: cardA });
  assert.deepEqual(calls.contextMenu.map((entry) => entry[0]), ['a']);

  // tracksEqual: id/order comparison, not reference or object identity.
  assert.equal(mechanic.__test__.tracksEqual(tracks3, [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')]), true);
  assert.equal(mechanic.__test__.tracksEqual(tracks3, [fakeTrack('a'), fakeTrack('b')]), false, 'different length must not be equal');
  assert.equal(mechanic.__test__.tracksEqual([fakeTrack('a')], [fakeTrack('b')]), false, 'same length, different id must not be equal');

  // centerIndexFor: pure function backing both paint() and recenterOn().
  assert.equal(mechanic.__test__.centerIndexFor(tracks3, 'c'), 2);
  assert.equal(mechanic.__test__.centerIndexFor(tracks3, null), 0, 'nothing playing must fall back to the first card');
  assert.equal(mechanic.__test__.centerIndexFor(tracks3, 'not-in-list'), 0, 'an activeId genuinely absent from the list must fall back to the first card, not throw or return -1');

  // update() with the SAME list (same ids, same order) but a different
  // activeId -- e.g. confirming a click/arrow-key activation, skip-next
  // from the transport button, or picking a track from elsewhere in the
  // app -- must NOT rebuild any card. Rebuilding would destroy and
  // recreate every DOM node instantly, which is exactly the "jump instead
  // of a slide" feeling. Recentering in place lets the existing CSS
  // transition on --card-offset/--card-distance actually animate.
  const cardsBeforeSameListUpdate = container._cards;
  const sameOrderTracks = [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')];
  mechanic.update(sameOrderTracks, 'a');
  assert.equal(container._cards, cardsBeforeSameListUpdate, 'a same-list update must not rebuild any DOM nodes');
  assert.equal(cardA._styleProps['--card-offset'], '0', 'recentering on the new activeId must move the visual center to it');
  assert.ok(cardA._classSet.has('is-playing'), 'the new activeId must carry is-playing');
  assert.equal(cardA._attributes['aria-selected'], 'true');
  assert.ok(!cardC._classSet.has('is-playing'), 'the previous activeId must lose is-playing');
  assert.equal(cardC._attributes['aria-selected'], 'false');
  // Escape (above) blurred out of the carousel before this update() ran, so
  // an external activeId change reaching recenterOn() here must NOT steal
  // focus back into the carousel -- the user deliberately backed out.
  assert.equal(container._focused, null, 'an external activeId change must not steal DOM focus when the user is not already engaged with the carousel');

  // Re-engage the carousel (click enters focus), then apply an external,
  // same-list activeId change to a *different* card -- confirm focus
  // follows the recenter so the next keyboard interaction continues from
  // what's actually shown as centered.
  container.dispatch('click', { target: cardA });
  assert.equal(container._focused, cardA);
  mechanic.update(sameOrderTracks, 'c');
  assert.equal(container._focused, cardC, 'once the user is engaged with the carousel, an external activeId change must move DOM focus to match the new visual center');
  assert.equal(cardC._styleProps['--card-offset'], '0');

  // update(): a track-list change (different ids) still does a full
  // repaint that re-centers on whatever activeId is now -- there's no
  // "existing card" to animate when the list itself changed.
  const cardsBeforeListChange = container._cards;
  const tracksAfterUpdate = [fakeTrack('x'), fakeTrack('y'), fakeTrack('z')];
  mechanic.update(tracksAfterUpdate, 'z');
  assert.notEqual(container._cards, cardsBeforeListChange, 'a genuine list change must rebuild the cards (unlike the same-list case above)');
  assert.equal(container._cards.length, 3);
  const cardZ = container._cards.find((card) => card.dataset.id === 'z');
  assert.equal(cardZ._styleProps['--card-offset'], '0', 'update() must re-center on the new activeId');

  // destroy(): tears down listeners and the marker class.
  mechanic.destroy();
  assert.equal(container._listeners.click, undefined);
  assert.equal(container._listeners.keydown, undefined);
  assert.equal(container._listeners.focusin, undefined);
  assert.equal(container._listeners.focusout, undefined);
  assert.equal(container._listeners.contextmenu, undefined);
  assert.equal(container.classList.contains('carousel-mounted'), false, 'destroy must remove the carousel-mounted marker');

  console.log('Carousel mechanic audit passed: contract-valid, markup and offset math correct, keyboard/click/focus navigation and destroy all behave correctly.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
