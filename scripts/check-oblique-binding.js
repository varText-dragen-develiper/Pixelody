const assert = require('node:assert/strict');
const { createObliqueBindingMechanic, PROJECTION_WINDOW } = require('../src/theme-runtime/navigation/oblique-binding');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const TAG = /<button class="(oblique-territory[^"]*)"[^>]*aria-selected="([^"]*)"[^>]*aria-label="([^"]*)"[^>]*aria-posinset="([^"]*)"[^>]*aria-setsize="([^"]*)"[^>]*tabindex="([^"]*)" data-id="([^"]*)"/g;

function fakeContainer() {
  const classes = new Set();
  return {
    _listeners: {}, _nodes: [], _html: '',
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    set innerHTML(value) {
      this._html = value;
      this._nodes = [];
      TAG.lastIndex = 0;
      let match;
      while ((match = TAG.exec(value))) {
        const node = {
          dataset: { id: match[7] },
          classes: new Set(match[1].split(' ')),
          ariaSelected: match[2],
          ariaLabel: match[3],
          position: Number(match[4]),
          setSize: Number(match[5]),
          tabindex: match[6],
          closest: (selector) => selector === '.oblique-territory' ? node : null,
          focus: () => { this._focused = node; },
        };
        this._nodes.push(node);
      }
    },
    get innerHTML() { return this._html; },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener(type, fn) { if (this._listeners[type] === fn) delete this._listeners[type]; },
    querySelector(selector) {
      const id = selector.match(/data-id="([^"]+)"/)?.[1];
      return id ? this._nodes.find((node) => node.dataset.id === id) || null : null;
    },
    dispatch(type, event) { this._listeners[type]?.(event); },
  };
}

const track = (index, extra = {}) => ({
  id: `track-${String(index).padStart(3, '0')}`,
  title: index === 2 ? '静かな回路のための歌' : index === 3 ? 'Árvore / μετάβαση / انعكاس' : `Track ${index}`,
  artist: 'Hostile Fixture Artist',
  album: 'Nocturne for Multiple Rooms',
  duration: 180 + index,
  format: 'flac',
  bitDepth: 24,
  sampleRate: 96000,
  ...extra,
});

const tracks = Array.from({ length: 128 }, (_, index) => track(index + 1, index === 3 ? { missing: true } : {}));
const mechanic = createObliqueBindingMechanic();
assert.equal(validateMechanic(mechanic).valid, true);

const calls = { selected: [], activated: [], toggled: [], context: [], escaped: 0 };
const container = fakeContainer();
mechanic.mount(container, tracks, {
  geometryMode: 'projection',
  selectedId: 'track-002',
  activeId: 'track-005',
  playbackState: 'playing',
  onSelect: (id) => calls.selected.push(id),
  onActivate: (id) => calls.activated.push(id),
  onToggleCurrent: (id) => calls.toggled.push(id),
  onContextMenu: (id) => calls.context.push(id),
  onEscape: () => { calls.escaped += 1; },
});

assert.equal(container.classList.contains('oblique-binding-mounted'), true);
assert.equal(container._nodes.length, PROJECTION_WINDOW);
assert.equal(container._nodes.filter((node) => node.ariaSelected === 'true').length, 1);
assert.equal(container._nodes.find((node) => node.dataset.id === 'track-002').tabindex, '0');
assert.ok(container._nodes.find((node) => node.dataset.id === 'track-002').classes.has('is-selected'));
assert.ok(container._nodes.find((node) => node.dataset.id === 'track-005').classes.has('is-current'));
assert.match(container.innerHTML, /SELECTED \/ NOT PLAYING/);
assert.match(container.innerHTML, /CURRENT \/ PLAYING/);
assert.match(container.innerHTML, /aria-setsize="128"/);

const selected = container._nodes.find((node) => node.dataset.id === 'track-002');
container.dispatch('keydown', { target: selected, key: 'End', preventDefault() {} });
assert.equal(mechanic.__test__.getState().selectedId, 'track-128');
assert.equal(container._nodes.length, PROJECTION_WINDOW);
assert.ok(container._nodes.some((node) => node.dataset.id === 'track-128'));
assert.equal(container._focused?.dataset.id, 'track-128');
assert.equal(calls.selected.at(-1), 'track-128');

container.dispatch('keydown', { target: container._nodes.find((node) => node.dataset.id === 'track-128'), key: 'Enter', preventDefault() {} });
assert.equal(calls.activated.at(-1), 'track-128');

mechanic.update(tracks, 'track-005', { selectedId: 'track-002', activationPendingId: 'track-002', playbackState: 'playing' });
assert.ok(container._nodes.find((node) => node.dataset.id === 'track-002').classes.has('is-pending'));
assert.ok(container._nodes.find((node) => node.dataset.id === 'track-005').classes.has('is-current'), 'pending request must preserve the confirmed current territory');
assert.match(container.innerHTML, /Awaiting host confirmation/);

mechanic.update(tracks, 'track-005', { activationPendingId: null, activationFailedId: 'track-004', playbackState: 'playing' });
assert.ok(container._nodes.find((node) => node.dataset.id === 'track-004').classes.has('is-failed'));
assert.match(container.innerHTML, /FAILED \/ LOCATE FILE/);
assert.match(container.innerHTML, /Current playback retained/);

mechanic.update(tracks, 'track-005', { activationFailedId: null, playbackState: 'paused' });
assert.match(container.innerHTML, /CURRENT \/ PAUSED/);

mechanic.update(tracks, 'track-005', { geometryMode: 'flow', selectedId: 'track-002', playbackState: 'paused' });
assert.equal(container._nodes.length, 128, 'flow hypothesis must keep the complete semantic list mounted');
assert.equal(mechanic.__test__.getState().geometryMode, 'flow');

mechanic.update(tracks.slice(80), 'track-005', { authoritativeTracks: tracks, geometryMode: 'projection', selectedId: 'track-081', playbackState: 'paused' });
assert.match(container.innerHTML, /Track 5/);
assert.match(container.innerHTML, /CURRENT \/ PAUSED/);

const focused = container._nodes.find((node) => node.dataset.id === 'track-081');
container.dispatch('contextmenu', { target: focused });
assert.equal(calls.context.at(-1), 'track-081');
container.dispatch('keydown', { target: focused, key: 'Escape', preventDefault() {} });
assert.equal(calls.escaped, 1);

mechanic.update([], 'track-005', { authoritativeTracks: tracks, activationFailedId: 'track-004' });
assert.match(container.innerHTML, /ORDERED BINDING \/ EMPTY/);
assert.match(container.innerHTML, /Track 5/);
assert.match(container.innerHTML, /Playback request failed for Track 4/);

mechanic.destroy();
assert.equal(container.classList.contains('oblique-binding-mounted'), false);
assert.equal(container._listeners.click, undefined);
assert.equal(container.innerHTML, '');

console.log('Oblique Binding audit passed: virtualized and full-flow hypotheses preserve semantic order, selected/requested/failed/current ownership, 128-track traversal, filtered-current recovery, keyboard/context lifecycle, empty state, and teardown.');
