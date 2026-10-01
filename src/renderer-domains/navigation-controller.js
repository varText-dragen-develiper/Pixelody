(function pixelodyNavigationControllerFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyNavigationController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNavigationControllerApi() {
  'use strict';
  function equalSnapshot(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function hasSurface(snapshot = {}) { return snapshot.view !== 'library' || ['settings', 'jams', 'migration', 'supportOwn', 'editor', 'playlistCreator', 'queue', 'shortcuts', 'metadata', 'compactLibrary'].some((key) => Boolean(snapshot[key])); }
  function createNavigationController(options = {}) {
    const capture = options.capture;
    const restore = options.restore;
    const closeCurrent = options.closeCurrent;
    const notify = typeof options.notify === 'function' ? options.notify : () => {};
    if (typeof capture !== 'function' || typeof restore !== 'function' || typeof closeCurrent !== 'function') throw new Error('Navigation controller requires capture, restore, and closeCurrent adapters.');
    const history = [];
    const sync = () => notify(history.length > 0 || hasSurface(capture()));
    const push = () => { const snapshot = capture(); if (!history.length || !equalSnapshot(history[history.length - 1], snapshot)) history.push(snapshot); sync(); return snapshot; };
    const back = () => { const snapshot = history.pop(); if (snapshot) restore(snapshot); else closeCurrent(capture()); sync(); return snapshot || null; };
    const discard = () => { const snapshot = history.pop() || null; sync(); return snapshot; };
    return Object.freeze({ history, sync, push, back, discard, hasSurface });
  }
  return Object.freeze({ createNavigationController, equalSnapshot, hasSurface });
}));
