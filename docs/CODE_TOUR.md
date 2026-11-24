# Finding your way around the code

If you're here to fix something, start with the bit that owns the behavior. The main renderer is large, but it is not where every change belongs. The [architecture map](ARCHITECTURE.md) goes further into storage, audio and networking.

## Following a click

The main window starts in `src/index.html`. `src/renderer.js` connects its controls to the controllers in `src/renderer-domains/`. For example, a queue bug usually means following the renderer binding into `playback-controller.js`, rather than changing the list on screen and hoping playback follows it.

Navigation has its own controller, `navigation-controller.js`. Settings, dialogs and Back need to agree about what is open. If a panel closes to the wrong place, check the saved surface history before adding another close-button exception.

## What the page is allowed to do

`src/preload.js` exposes named operations to the main window. `src/mini-preload.js` does the same for the mini player, with a smaller set of controls. `src/main.js` handles the privileged work, including windows, native file dialogs and the host service. Security checks are shared with `src/electron-security.js`.

A new preload method needs matching validation in the main process. Being callable from the app's own page is not permission to read an arbitrary path. The [Electron boundary](architecture/ELECTRON_SECURITY_BOUNDARY.md) explains the grants and IPC rules.

## Library, queue and saved state

Import work starts in `src/library-scan.js` and the library controllers. Queue ordering and session decisions belong in the playback controller. `src/state-store.js` writes the durable data; the state controller serializes renderer saves. Keep those responsibilities separate, especially when a change looks right on screen but disappears after reopening.

Use a throwaway profile for recovery tests. A test that damages a real library to prove recovery works has missed the point somewhat.

## Sound and appearance

`src/renderer-domains/audio-controller.js` contains shared audio calculations and normalization. Follow its callers in the renderer for the live audio graph. Track tuning and output tuning serve different jobs, so check both when changing gain or EQ behavior.

For appearance, start with `src/themes/built-in-themes.json`, then follow the selected theme into `src/theme-runtime/` and the stylesheets loaded by `index.html`. Workspace composition also supplies presentation recipes; its development tools are not a list of themes promised in an installer. A layout change still needs to work with long titles, large text and motion off.

## Phone connections and optional modules

`src/server/index.js` owns the desktop host API. Android is maintained in the [companion repository](https://github.com/varText-dragen-develiper/Pixelody-android). Start with the API fixtures when changing a response, then check both ends. A successful desktop request alone does not establish that the phone can reconnect.

`src/module-shop/` validates and stores optional module packages. A package is data for supported module types; it does not get to add executable code to the app.

## Before sending a fix

[CONTRIBUTING.md](../CONTRIBUTING.md) has the local checks and contribution terms. Describe the failure, what changes for someone using the app, and what you actually tested. If you only checked the source, say so. Installer and device testing are separate jobs.
