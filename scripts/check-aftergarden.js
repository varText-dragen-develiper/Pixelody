const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGraftlineMechanic } = require('../src/theme-runtime/navigation/graftline');
const { validateMechanic } = require('../src/theme-runtime/navigation/contract');
const registry = require('../src/theme-runtime/information/registry');
require('../src/theme-runtime/information/bundles');
const { profile } = require('../src/theme-runtime/information/profiles/aftergarden');

const TAG = /<button class="(graftline-cutting[^"]*)"[^>]*aria-selected="([^"]*)"[^>]*tabindex="([^"]*)" data-id="([^"]*)"/g;
function fakeContainer() {
  return {
    _listeners: {}, _nodes: [], _html: '',
    set innerHTML(value) { this._html = value; this._nodes = []; TAG.lastIndex = 0; let match; while ((match = TAG.exec(value))) { const classes = new Set(match[1].split(' ')); const node = { dataset: { id: match[4] }, classes, closest: (selector) => selector === '.graftline-cutting' ? node : null, focus: () => { this._focused = node; } }; this._nodes.push(node); } },
    get innerHTML() { return this._html; },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener(type, fn) { if (this._listeners[type] === fn) delete this._listeners[type]; },
    querySelector(selector) { const id = selector.match(/data-id="([^"]+)"/)?.[1]; return id ? this._nodes.find((node) => node.dataset.id === id) || null : null; },
    dispatch(type, event) { this._listeners[type]?.(event); },
  };
}
const track = (id, extra = {}) => ({ id, title: `Track ${id}`, artist: 'Artist', album: 'Album', duration: 125, format: 'flac', bitDepth: 24, sampleRate: 48000, ...extra });

const mechanic = createGraftlineMechanic({ format: { escapeHtml: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), durationText: () => '2:05' } });
assert.equal(validateMechanic(mechanic).valid, true);
const tracks = [track('a'), track('b', { title: 'B & Beyond' }), track('c', { missing: true })];
const calls = { selected: [], activated: [], toggled: [], context: [], escaped: 0 };
const container = fakeContainer();
mechanic.mount(container, tracks, { activeId: 'b', playbackState: 'playing', onSelect: (id) => calls.selected.push(id), onActivate: (id) => calls.activated.push(id), onToggleCurrent: (id) => calls.toggled.push(id), onContextMenu: (id) => calls.context.push(id), onEscape: () => { calls.escaped += 1; } });
assert.equal(mechanic.__test__.getState().selectedId, 'b');
assert.ok(container._nodes.find((node) => node.dataset.id === 'b').classes.has('is-playing'));
container.dispatch('click', { target: container._nodes.find((node) => node.dataset.id === 'c') });
assert.deepEqual(calls.selected, ['c']); assert.deepEqual(calls.activated, []); assert.equal(mechanic.__test__.getState().activeId, 'b', 'focus cannot steal confirmed playback');
container.dispatch('click', { target: container._nodes.find((node) => node.dataset.id === 'c') });
assert.deepEqual(calls.activated, ['c']);
mechanic.update(tracks, 'c', { playbackState: 'paused', activationFailedId: 'a' });
assert.ok(container._nodes.find((node) => node.dataset.id === 'c').classes.has('is-playing'));
assert.ok(container._nodes.find((node) => node.dataset.id === 'a').classes.has('is-failed'));
const selected = container._nodes.find((node) => node.dataset.id === 'c');
container.dispatch('keydown', { target: selected, key: 'ArrowLeft', preventDefault() {} });
assert.equal(calls.selected.at(-1), 'b');
const b = container._nodes.find((node) => node.dataset.id === 'b');
container.dispatch('keydown', { target: b, key: 'Enter', preventDefault() {} }); assert.equal(calls.activated.at(-1), 'b');
container.dispatch('contextmenu', { target: b }); assert.equal(calls.context.at(-1), 'b');
container.dispatch('keydown', { target: b, key: 'Escape', preventDefault() {} }); assert.equal(calls.escaped, 1);
mechanic.destroy(); assert.equal(container._listeners.click, undefined); assert.equal(container.innerHTML, '');

assert.equal(registry.hasProfile('aftergarden'), true); assert.equal(require('../src/theme-runtime/information/contract').validateProfile(profile).valid, true);
const snapshot = { collection: { name: 'Hostile' }, tracks: { display: tracks, collection: tracks, all: tracks }, playback: { currentId: 'b', phase: 'playing' }, output: { label: 'USB DAC', active: true }, queue: { items: ['a'] } };
const resolved = Object.fromEntries(profile.bundles.map((key) => [key, registry.resolveBundle(key, snapshot)]));
const projection = profile.project(resolved);
assert.equal(projection.fields.playbackState, 'CONFIRMED PLAYING'); assert.equal(projection.fields.current, 'B & Beyond'); assert.equal(projection.fields.route, 'USB DAC');

const root = path.resolve(__dirname, '..'); const index = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'); const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8'); const mini = fs.readFileSync(path.join(root, 'src/mini-player.html'), 'utf8');
['aftergarden.css', 'theme-runtime/navigation/graftline.js', 'theme-runtime/information/profiles/aftergarden.js'].forEach((needle) => assert.ok(index.includes(needle), `${needle} must be wired`));
assert.ok(mini.includes('mini-aftergarden.css')); assert.ok(renderer.includes("aftergarden: 'graftline'")); assert.ok(renderer.includes("aftergarden: 'aftergarden'"));
console.log('Aftergarden vertical-slice audit passed: contract-valid Graftline preserves focus/confirmed/failure truth, keyboard/context lifecycle and teardown; the read-only information profile and main/mini wiring are present.');
