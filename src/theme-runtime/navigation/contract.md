# Navigation Mechanic Contract

This is the complete, authoritative explanation of what a "navigation mechanic" is and what it must do. It exists so nobody has to reverse-engineer the pattern from reading `linear-list.js` or guess at conventions from an out-of-date summary somewhere else. If this doc and the code (`contract.js`) ever disagree, `contract.js` wins and this doc is stale -- file a fix.

Background and the phased rollout plan live in `../../../docs/themes/THEME_RUNTIME_ARCHITECTURE.md`. This file only covers the contract itself.

## What a mechanic is

A navigation mechanic is how a theme lets the user browse and pick a track (or a playlist) in the main window's library surface. Registered mechanics today are `linear-list` (a plain scrolling row list), `carousel` (a focus-driven horizontal strip), `cover-flow` (a reflective depth shelf), `pass-deck` (a single-position information-pass deck), `memory-cascade` (a layered optical-media field), `spectral-field` (a perspective event corridor), and `pressure-stack` (vertical typographic strata around one confirmed depth datum). None is more "default" than another at the contract level; `linear-list` is just the first one built and the fallback every theme gets unless its manifest says otherwise.

A mechanic is **not**:
- A theme. A theme can use any registered mechanic; a mechanic can be used by any theme. They're independent axes.
- A place for arbitrary per-theme JavaScript. Per `src/themes/README.md`, theme packages cannot ship executable code -- a mechanic is one of a small, reviewed, built-in set that a manifest *selects by key*, not code a manifest supplies.
- Responsible for the mini player. Confirmed in `mini-player.html`: there is no track-browsing surface there at all, only now-playing/transport controls. Mechanics never run in that window.

## The interface

A mechanic module (see the UMD factory pattern used throughout `src/renderer-domains/*.js` for the wrapper shape) must export exactly these three functions:

```js
{
  mount(container, tracks, { onSelect, onActivate, onContextMenu, activeId }) {
    // Render tracks into `container` however this mechanic wants to.
    // Call onSelect(trackId) when the active/focused item changes.
    // Call onActivate(trackId) when the user commits (Enter, double-click, play button, etc).
    // Call onContextMenu(trackId, event) on right-click / context-menu key.
    // Must render with `activeId` already selected/focused if provided.
  },

  update(tracks, activeId) {
    // Called when the track list or the active id changes without a full
    // remount (e.g. queue reorder, now-playing change, library filter).
    // Must not require the caller to call mount() again.
  },

  destroy() {
    // Tear down listeners/observers/timers this mechanic created. Called
    // before a different mechanic mounts into the same container, or when
    // the surface is closed.
  },
}
```

`contract.js`'s `validateMechanic(module)` checks structurally that all three exist and are functions. It cannot check that you actually call the callbacks correctly or actually tear down what you created -- that's on the manual verification pass (`THEME_SYSTEM.md` step 11: settings, library, systems view, inspector, editor, queue, player bar, narrow width, motion-off).

A mechanic may accept additional arguments or expose extra methods beyond this minimum, as long as `mount`/`update`/`destroy` exist and behave per the common thread below. `linear-list.js` (Phase 1) is the example: its row template has inline favorite/find/edit buttons, so its `mount()` options accept an extra `onRowAction(action, id)` callback alongside the three required ones. A mechanic without inline row actions has no reason to add one.

## The common thread (non-negotiable, applies to every mechanic)

However different a mechanic looks or moves, it must:

1. Support full keyboard operation: arrow/tab traversal, Enter to activate, Escape to back out. No mechanic may be mouse-only.
2. Maintain exactly one active/selected item at all times, with a visible focus/selection indicator.
3. Use the lifecycle callbacks the host provides (`onSelect`, `onActivate`, `onContextMenu`) -- don't invent parallel ones the rest of the app doesn't know about.
4. Collapse to a fully static, non-decorative state when the host reports motion is off, matching the existing `motionDisabled()` convention every current theme already respects.
5. Stay legible at narrow window width.
6. Leave the mini player alone entirely.

These six items live as `COMMON_THREAD_REQUIREMENTS` in `contract.js` as a single array -- quote that array in docs/tooling rather than retyping the list, so it can't drift out of sync with itself.

What's genuinely free per mechanic: spatial layout, how many items are visible at once, transition/motion style, decorative treatment of the focused item, and pacing. That's the entire point of building more than one.

## Registering a mechanic

```js
const registry = require('./registry'); // or window.PixelodyNavigationRegistry in-browser
registry.registerMechanic('linear-list', linearListModule, { label: 'Linear List' });
```

A key is registered exactly once, ever, for the lifetime of the app session. Re-registering the same key throws -- that's almost always a copy-paste bug, not something to catch silently. Keys are lowercase kebab-case, matching the discipline already used for theme ids in `theme.schema.json`.

## Shipping a new mechanic to the live app

Writing a module that satisfies the interface above is necessary but not sufficient -- it also has to actually run. This is every step that was needed to take `carousel.js` from a file on disk to something a theme could use, in order:

1. Write `src/theme-runtime/navigation/<key>.js` using the UMD factory wrapper (`(function xFactory(root, factory) { ... }(typeof globalThis !== 'undefined' ? globalThis : this, function createXModule() { ... }));`) -- see `carousel.js` for the shape. Accept a `host` object of injected functions (format helpers, etc.) rather than reaching into globals, matching every other `renderer-domains/*.js` file.
2. Add its `<script src="theme-runtime/navigation/<key>.js"></script>` tag to `index.html`, after `registry.js` and before `renderer.js`. Order matters for the others too: `contract.js` → `registry.js` → mechanic modules → `dispatcher.js` → `renderer.js`. `npm run check:navigation-platform` asserts this order.
3. In `renderer.js`, add `const <key>MechanicDomain = window.Pixelody<Key>Mechanic;` next to the other navigation domain aliases near the top of the file, and add it to the `if (![...].every(Boolean))` guard a few lines below. If the script fails to load for any reason, this is what turns that into a loud startup failure instead of a silent, confusing one deep inside some later function.
4. Instantiate it and register it: `const <key>Mechanic = <key>MechanicDomain.create<Key>Mechanic({ ...host... }); navigationMechanicRegistry.registerMechanic('<key>', <key>Mechanic, { label: '...' });` -- alongside the existing `linear-list`/`carousel` registration block.
5. To actually assign it to a theme: add the theme's runtime key to `themeNavigationMechanics` in `renderer.js` (the Phase 2 stand-in for reading `navigation.trackBrowser` out of the manifest at runtime -- there's no IPC path to `*.theme.json` yet, see `docs/themes/THEME_RUNTIME_ARCHITECTURE.md`'s Phase 2 section for why), *and* add a matching `"navigation": { "trackBrowser": "<key>" }` to that theme's `*.theme.json`. `npm run check:themes` fails if these two disagree.
6. Write `scripts/check-<key>.js` with a hand-built fake DOM and add an `npm run check:<key>` script in `package.json`. There's no jsdom in this project (no npm registry access in the sandbox this was built in) -- `scripts/check-carousel.js` is the most complete example to copy from, including how to simulate `focus`/`blur`/`focusin`/`focusout` event ordering correctly, which matters more than it looks like it should (see the lesson below).
7. Add the new mechanic's registration and global-reference assertions to `scripts/check-navigation-platform.js` so a missing browser global, script tag, or registration fails loudly.

## Lesson learned: don't give a mechanic two positions to keep in sync

`carousel.js` shipped three times before this was stable, and every bug was the same shape wearing a different costume. The first version tracked `focusIndex` (where keyboard/click browsing currently sat) separately from `activeId` (whichever track was actually playing), synced by hand at each call site -- and they drifted: skip-next felt like a hard reset instead of a smooth move, then skip-next appeared to play the previous track, then clicking a card would sometimes visually move the carousel without changing playback, and sometimes change playback without the carousel catching up. Each fix patched the specific timing window that had just been found, and each time a new one turned up, because the *structure* still had two independent variables that could each change without the other.

The fix that actually held: delete the second variable. `carousel.js` now has exactly one position -- wherever `activeId` (the confirmed, actually-playing track) is -- computed fresh every time from `centerIndexFor(tracks, activeId)`, never stored as separate mutable state. Clicking or keying a card **only ever requests** activation (`onActivate`); the mechanic does not move anything until `update()` is called back with a genuinely new, confirmed `activeId`. If you're building a mechanic with any notion of "browsing" distinct from "what's active" -- hover preview, a cursor separate from the current selection, anything like that -- treat this as the standing warning: either make sure the two truly are meant to differ from the user's perspective (and document why), or don't split them into two variables at all. A contract requirement like #2 above ("maintain exactly one active/selected item") is easy to satisfy accidentally-wrongly by having one variable *display* as authoritative while a second one actually drives more of the behavior than it looks like. Prefer computing position from the source of truth on every read over caching it and trying to keep the cache in sync.

## Worked example: the smallest possible valid mechanic

This is deliberately trivial -- it satisfies the contract and nothing else -- to show the minimum shape before `linear-list.js` (Phase 1) adds real rendering:

```js
function createSingleFocusMechanic() {
  let root = null;
  let onSelectCb = null;

  function mount(container, tracks, { onSelect, onActivate, onContextMenu, activeId }) {
    root = container;
    onSelectCb = onSelect;
    root.innerHTML = '';
    tracks.forEach((track) => {
      const row = document.createElement('div');
      row.tabIndex = 0;
      row.dataset.id = track.id;
      row.textContent = track.title;
      row.setAttribute('aria-selected', String(track.id === activeId));
      row.addEventListener('focus', () => onSelect(track.id));
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter') onActivate(track.id); });
      row.addEventListener('contextmenu', (event) => onContextMenu(track.id, event));
      root.appendChild(row);
    });
  }

  function update(tracks, activeId) {
    // A real mechanic would diff; this one just remounts for clarity.
    mount(root, tracks, { onSelect: onSelectCb, onActivate: () => {}, onContextMenu: () => {}, activeId });
  }

  function destroy() {
    if (root) root.innerHTML = '';
    root = null;
  }

  return { mount, update, destroy, meta: { label: 'Single Focus (example only)' } };
}

module.exports = createSingleFocusMechanic();
```

This example is not registered anywhere and ships nowhere -- it exists only so this doc is self-sufficient. `linear-list.js` (Phase 1) is the real first registered mechanic, extracted verbatim from the current `renderTracks()` behavior so there is zero visual regression.

## Versioning

`MECHANIC_CONTRACT_VERSION` in `contract.js` is `1`. If the interface shape ever needs a breaking change, bump it and update every registered mechanic in the same change -- don't let mechanics silently disagree about which contract version they were built against.
