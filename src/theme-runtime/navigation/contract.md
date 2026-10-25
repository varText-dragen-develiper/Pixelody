# Navigation mechanic contract

A mechanic presents track/playlist browsing in the main window. A theme selects reviewed registered code by key; it doesn't supply executable JavaScript. The mini-player has no browser and never runs these mechanics. Use contract.js if this explanation disagrees with the interface, and correct the documentation.

Linear-list is the original fallback. Carousel, cover-flow, pass-deck, memory-cascade, spectral-field, pressure-stack and later entries use the same contract; [the runtime reference](../../../docs/themes/THEME_RUNTIME_ARCHITECTURE.md) lists the broader recorded set.

## Interface

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

validateMechanic checks the three functions exist. It can't establish callback semantics, listener cleanup or painted geometry. Extra host callbacks are allowed where needed: linear-list uses onRowAction for its inline controls. Keep dependencies injected as in the renderer-domain UMD modules.

Every mechanic needs keyboard traversal, Enter activation, Escape/back, one clear selection/active state, host lifecycle callbacks, static motion-off behavior and narrow-width legibility. It must leave the mini-player untouched. COMMON_THREAD_REQUIREMENTS in contract.js owns that list. Position, density, visual treatment and pacing can differ.

## Registration and wiring

```js
const registry = require('./registry'); // or window.PixelodyNavigationRegistry in-browser
registry.registerMechanic('linear-list', linearListModule, { label: 'Linear List' });
```

Register each lowercase kebab-case key once. Duplicate registration throws; don't hide it as a harmless retry.

1. Implement `navigation/<key>.js` with the UMD factory and injected host helpers.
2. Load contract → registry → mechanic modules → dispatcher → renderer. Add the script tag and global alias/startup guard.
3. Instantiate/register the mechanic, then map the theme in themeNavigationMechanics and its matching manifest navigation.trackBrowser. check:themes rejects disagreement; no live built-in manifest read exists yet.
4. Add a focused check and package script, plus registration/global assertions in check-navigation-platform.js. Use the project's fake DOM, including actual focus/blur ordering.
5. Run the platform, theme and focused tests, then try it in Electron at narrow widths and motion off, including actual playback and focus return.

## Selection versus confirmed playback

Earlier carousel versions kept focusIndex and activeId independently, producing wrong skips or movement without the corresponding playback. The corrected center is calculated from confirmed activeId. Input requests activation; the host update confirms a new position. If a mechanic intentionally allows separate browsing, document that distinction and don't let selection look like successful playback.

Update existing nodes for active changes and avoid stealing focus after remote controls/natural advance. Layout, sibling headers and animation need painted review as well as tests. The real modules are better examples than a minimal sketch that omits those behaviors.

MECHANIC_CONTRACT_VERSION is 1. A breaking interface change needs the version and every registered mechanic updated together. See [the theme guide](../../../docs/themes/THEME_SYSTEM.md) for admission, appearance and accessibility checks.
