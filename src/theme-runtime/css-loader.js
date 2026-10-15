(function pixelodyCssLoaderFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelodyCssLoader = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCssLoaderModule() {
  'use strict';

  // Phase 4 of docs/themes/THEME_RUNTIME_ARCHITECTURE.md: "only the active
  // theme's CSS is present in the DOM" -- implemented here as toggling the
  // native `disabled` property on each per-theme <link> element rather than
  // inserting/removing DOM nodes. Deliberate choice, not a shortcut:
  //   - A disabled <link rel="stylesheet"> that started disabled in the
  //     initial HTML is not fetched at all by Chromium, so the real cost
  //     this phase exists to remove (every theme's CSS parsed/cascaded
  //     always, per docs/themes/THEME_RUNTIME_ARCHITECTURE.md) is actually eliminated.
  //   - It sidesteps every failure mode of manual <link> insertion (href
  //     construction bugs, duplicate-insert bugs, accidentally removing a
  //     file another still-active theme also needs) for a change whose
  //     blast radius is all 20 themes and which cannot be visually
  //     re-verified in this environment. Flipping `.disabled` is a single
  //     boolean per file with no ordering or timing to get wrong.
  //   - The element itself stays in the DOM tree (inert). If that's ever a
  //     real problem (not just a literal reading of "present in the DOM"),
  //     swapping to insert/remove is a small change confined to this file --
  //     nothing else in the app knows or cares which technique is used.
  //
  // host: {
  //   themeStylesheets: { [runtimeThemeKey]: ['file.css', ...] } -- the
  //     per-theme file lists (basenames), NOT including shared/always-on
  //     files like styles.css. Themes with no entry (e.g. 'studio') need no
  //     extra files beyond the shared baseline, matching
  //     themeNavigationMechanics' same convention of omitting default keys.
  //   getStylesheetLink(fileName) -> the <link> element for that file, or
  //     null/undefined if not present (never throws on a miss).
  // }
  function createCssLoader(host) {
    if (!host) throw new Error('createCssLoader requires a host adapter object.');
    const themeStylesheets = host.themeStylesheets || {};

    function fileNamesFor(themeKey) {
      return themeStylesheets[themeKey] || [];
    }

    // The full set of files this loader manages, across every theme --
    // computed once per call rather than cached, since it's cheap (tens of
    // entries) and this way a themeStylesheets object built/replaced at
    // runtime (e.g. in tests) is always respected.
    function allManagedFileNames() {
      const names = new Set();
      Object.values(themeStylesheets).forEach((files) => files.forEach((file) => names.add(file)));
      return Array.from(names);
    }

    // Enables exactly the files the requested theme needs and disables
    // every other managed file -- including correctly leaving a file
    // enabled when it's shared between the outgoing and incoming theme
    // (e.g. poster-themes.css across obsession/crystal/cosmic-cinema/etc.),
    // since membership is recomputed fresh against the new theme's set
    // rather than diffed against whatever was previously active.
    function applyTheme(themeKey) {
      const active = new Set(fileNamesFor(themeKey));
      allManagedFileNames().forEach((fileName) => {
        const link = host.getStylesheetLink(fileName);
        if (!link) return;
        link.disabled = !active.has(fileName);
      });
    }

    return Object.freeze({
      applyTheme,
      __test__: { fileNamesFor, allManagedFileNames },
    });
  }

  return Object.freeze({ createCssLoader });
}));
