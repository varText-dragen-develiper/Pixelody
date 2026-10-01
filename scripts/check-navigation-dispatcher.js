const assert = require('node:assert/strict');

const { createNavigationDispatcher } = require('../src/theme-runtime/navigation/dispatcher');

// `calls` is captured by reference inside the closures returned by
// createFakeMechanic(). Resets MUST mutate it in place (calls.length = 0)
// rather than reassigning (`calls = []`) -- reassignment would only change
// what this module's own binding points at, not what the already-created
// mechanic closures write to, since they closed over the array object
// itself, not this variable.
const calls = [];
function resetCalls() { calls.length = 0; }

function createFakeMechanic(name) {
  return {
    mount: (container, tracks, options) => calls.push([name, 'mount', container, tracks, options]),
    update: (tracks, activeId, options) => calls.push([name, 'update', tracks, activeId, options]),
    destroy: () => calls.push([name, 'destroy']),
  };
}

function createFakeRegistry(mechanics) {
  return {
    hasMechanic: (key) => Object.prototype.hasOwnProperty.call(mechanics, key),
    getMechanic: (key) => mechanics[key],
  };
}

async function run() {
  // Constructor validation.
  assert.throws(() => createNavigationDispatcher(null), /requires a registry/);
  assert.throws(() => createNavigationDispatcher({}), /requires a registry/);

  // mount() throws if the fallback mechanic ('linear-list' by default)
  // isn't registered -- a dispatcher with no usable default is a bug, not
  // something that should silently do nothing.
  const emptyDispatcher = createNavigationDispatcher(createFakeRegistry({}));
  assert.throws(() => emptyDispatcher.mount({}, 'linear-list', [], {}), /fallback mechanic "linear-list" is not registered/);

  const mechanics = { 'linear-list': createFakeMechanic('linear-list'), carousel: createFakeMechanic('carousel') };
  const registry = createFakeRegistry(mechanics);
  const container = { id: 'fake-container' };
  const tracks = [{ id: 'a' }];
  const mountOptions = { activeId: 'a', onSelect: () => {} };

  // Normal mount(): resolves a valid requested key.
  resetCalls();
  const dispatcher = createNavigationDispatcher(registry);
  dispatcher.mount(container, 'carousel', tracks, mountOptions);
  assert.equal(dispatcher.getCurrentKey(), 'carousel');
  assert.deepEqual(calls, [['carousel', 'mount', container, tracks, mountOptions]]);

  // mount() falls back when the requested key isn't registered.
  resetCalls();
  const fallbackDispatcher = createNavigationDispatcher(registry);
  fallbackDispatcher.mount(container, 'not-a-real-mechanic', tracks, mountOptions);
  assert.equal(fallbackDispatcher.getCurrentKey(), 'linear-list');
  assert.deepEqual(calls, [['linear-list', 'mount', container, tracks, mountOptions]]);

  // setMechanic() before mount() throws.
  const unmounted = createNavigationDispatcher(registry);
  assert.throws(() => unmounted.setMechanic('carousel'), /called before mount/);

  // A single dispatcher instance walks through the rest of the lifecycle so
  // "currently mounted" state carries across assertions the way it would
  // in the real app across a sequence of theme switches.
  const stable = createNavigationDispatcher(registry);
  resetCalls();
  stable.mount(container, 'linear-list', tracks, mountOptions);
  assert.deepEqual(calls, [['linear-list', 'mount', container, tracks, mountOptions]]);

  // setMechanic() to the same key currently mounted is a no-op (no
  // destroy/mount calls) and returns false, so callers know not to
  // re-render.
  resetCalls();
  assert.equal(stable.setMechanic('linear-list'), false);
  assert.deepEqual(calls, []);

  // setMechanic() to a different registered key destroys the old mechanic
  // and mounts the new one with an EMPTY track list but the SAME
  // mountOptions remembered from mount() -- callers are expected to follow
  // with update() once they have real tracks.
  resetCalls();
  assert.equal(stable.setMechanic('carousel'), true);
  assert.equal(stable.getCurrentKey(), 'carousel');
  assert.deepEqual(calls, [
    ['linear-list', 'destroy'],
    ['carousel', 'mount', container, [], mountOptions],
  ]);

  // setMechanic() to an unregistered key resolves to the fallback; since a
  // different mechanic (carousel) is currently mounted, that's still a
  // real swap.
  resetCalls();
  assert.equal(stable.setMechanic('not-a-real-mechanic'), true);
  assert.equal(stable.getCurrentKey(), 'linear-list');
  assert.deepEqual(calls, [
    ['carousel', 'destroy'],
    ['linear-list', 'mount', container, [], mountOptions],
  ]);

  // update() forwards to whichever mechanic is currently mounted
  // (linear-list, after the swap above).
  resetCalls();
  const updateTracks = [{ id: 'b' }, { id: 'c' }];
  stable.update(updateTracks, 'b', { animateRows: true });
  assert.deepEqual(calls, [['linear-list', 'update', updateTracks, 'b', { animateRows: true }]]);

  // update() before any mount() is a safe no-op, not a throw.
  const neverMounted = createNavigationDispatcher(registry);
  assert.doesNotThrow(() => neverMounted.update([], null, {}));

  // destroy() tears down the current mechanic and resets state.
  resetCalls();
  stable.destroy();
  assert.deepEqual(calls, [['linear-list', 'destroy']]);
  assert.equal(stable.getCurrentKey(), null);

  console.log('Navigation dispatcher audit passed: mount/setMechanic/update/destroy all behave correctly, including fallback resolution and no-op swaps.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
