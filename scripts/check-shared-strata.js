const assert = require('node:assert/strict');
const { createSharedStrataMechanic } = require('../src/theme-runtime/navigation/shared-strata');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');

const TAG = /<button class="(shared-stratum[^"]*)"[^>]*aria-selected="([^"]*)"[^>]*tabindex="([^"]*)" data-id="([^"]*)"/g;
function fakeContainer() {
  const classes = new Set();
  return {
    _listeners: {}, _nodes: [], _html: '',
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    set innerHTML(value) {
      this._html = value; this._nodes = []; TAG.lastIndex = 0; let match;
      while ((match = TAG.exec(value))) {
        const nodeClasses = new Set(match[1].split(' '));
        const node = { dataset: { id: match[4] }, classes: nodeClasses, closest: (selector) => selector === '.shared-stratum' ? node : null, focus: () => { this._focused = node; } };
        this._nodes.push(node);
      }
    },
    get innerHTML() { return this._html; },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener(type, fn) { if (this._listeners[type] === fn) delete this._listeners[type]; },
    querySelector(selector) { const id = selector.match(/data-id="([^"]+)"/)?.[1]; return id ? this._nodes.find((node) => node.dataset.id === id) || null : null; },
    dispatch(type, event) { this._listeners[type]?.(event); },
  };
}

const track = (id, extra = {}) => ({ id, title: `Track ${id}`, artist: 'Artist', album: 'Album', duration: 125, format: 'flac', bitDepth: 24, sampleRate: 96000, ...extra });
const mechanic = createSharedStrataMechanic({ format: { escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), durationText: () => '2:05' } });
assert.equal(validateMechanic(mechanic).valid, true);

const tracks = [track('a'), track('b', { title: 'B & Beyond' }), track('c'), track('d', { missing: true })];
const calls = { selected: [], activated: [], toggled: [], context: [], escaped: 0 };
const container = fakeContainer();
mechanic.mount(container, tracks, { activeId: 'b', playbackState: 'playing', selectedId: 'a', onSelect: (id) => calls.selected.push(id), onActivate: (id) => calls.activated.push(id), onToggleCurrent: (id) => calls.toggled.push(id), onContextMenu: (id) => calls.context.push(id), onEscape: () => { calls.escaped += 1; } });
assert.equal(container.classList.contains('shared-strata-mounted'), true);
assert.equal(mechanic.__test__.getState().selectedId, 'a');
assert.ok(container._nodes.find((node) => node.dataset.id === 'a').classes.has('is-selected'));
assert.ok(container._nodes.find((node) => node.dataset.id === 'b').classes.has('is-confirmed'));
assert.match(container.innerHTML, /SELECTED \/ ENTER TO REQUEST/);
assert.match(container.innerHTML, /CONFIRMED \/ PLAYING/);
assert.match(container.innerHTML, /B &amp; Beyond/);

container.dispatch('click', { target: container._nodes.find((node) => node.dataset.id === 'c') });
assert.deepEqual(calls.selected, ['c']); assert.deepEqual(calls.activated, []);
assert.equal(mechanic.__test__.getState().activeId, 'b', 'focus cannot steal confirmation');
container.dispatch('click', { target: container._nodes.find((node) => node.dataset.id === 'c') });
assert.deepEqual(calls.activated, ['c']);

mechanic.update(tracks, 'b', { playbackState: 'playing', activationPendingId: 'c' });
assert.ok(container._nodes.find((node) => node.dataset.id === 'c').classes.has('is-pending'));
assert.match(container.innerHTML, /REQUESTED \/ AWAITING CONFIRMATION/);
mechanic.update(tracks, 'b', { playbackState: 'playing', activationPendingId: null, activationFailedId: 'c' });
assert.ok(container._nodes.find((node) => node.dataset.id === 'c').classes.has('is-failed'));
assert.ok(container._nodes.find((node) => node.dataset.id === 'b').classes.has('is-confirmed'), 'failure must preserve prior confirmed track');
mechanic.update(tracks, 'c', { playbackState: 'paused', activationFailedId: null });
assert.ok(container._nodes.find((node) => node.dataset.id === 'c').classes.has('is-paused'));
assert.match(container.innerHTML, /CONFIRMED \/ PAUSED/);

mechanic.update([tracks[0], tracks[2]], 'b', { authoritativeTracks: tracks, playbackState: 'paused' });
assert.equal(container._nodes.some((node) => node.dataset.id === 'b'), false, 'filtered confirmation need not be a visible stratum');
assert.match(container.innerHTML, /B &amp; Beyond/);
assert.match(container.innerHTML, /PAUSED \/ SUTURE HELD/);
mechanic.update([], 'b', { authoritativeTracks: tracks, activationFailedId: 'd' });
assert.match(container.innerHTML, /SHARED STRATA \/ EMPTY/);
assert.match(container.innerHTML, /B &amp; Beyond/);
assert.match(container.innerHTML, /Playback request failed for Track d\. Current playback retained\./);
mechanic.update(tracks, 'c', { authoritativeTracks: tracks, playbackState: 'paused', activationFailedId: null });

const selectedC = container._nodes.find((node) => node.dataset.id === 'c');
container.dispatch('keydown', { target: selectedC, key: 'ArrowLeft', preventDefault() {} });
assert.equal(calls.selected.at(-1), 'b');
const selectedB = container._nodes.find((node) => node.dataset.id === 'b');
container.dispatch('keydown', { target: selectedB, key: 'Enter', preventDefault() {} });
assert.equal(calls.activated.at(-1), 'b');
container.dispatch('contextmenu', { target: selectedB }); assert.equal(calls.context.at(-1), 'b');
container.dispatch('keydown', { target: selectedB, key: 'Escape', preventDefault() {} }); assert.equal(calls.escaped, 1);

mechanic.destroy();
assert.equal(container.classList.contains('shared-strata-mounted'), false);
assert.equal(container._listeners.click, undefined);
assert.equal(container.innerHTML, '');
console.log('Shared Strata mechanic audit passed: one semantic field preserves selected/requested/failed/confirmed truth, keyboard/context lifecycle, and teardown.');
