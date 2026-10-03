# Electron Security Boundary

Pixelody loads only repository-packaged local documents in its privileged desktop windows. The main renderer is treated as a UI client of explicit main-process capabilities, and Pixelody Mini is a separate, narrower client rather than a second copy of the full bridge.

## Window capabilities

| Window | Preload | Allowed responsibilities |
| --- | --- | --- |
| Main | `src/preload.js` | User-invoked dialogs/imports/exports, durable state, playback-state broadcast, J.A.M. owner controls, bounded diagnostics, output helpers, navigation state, opening Pixelody Mini, choosing the window icon from the fixed logo-colour list (`app:set-brand-icon`, enum-validated against `src/brand-mark.js`), and restarting into a development presentation (`app:relaunch-development-profile`, enum-validated against `src/development-profiles.js`; refused outside development builds and under the integration harness). |
| Mini | `src/mini-preload.js` | Receive sanitized player state, send previous/toggle/next, restore the main window, and close itself. |
| Hostile integration probe | `src/security-probe-preload.js` | Item 5 test-only attempts. It has no production creation path and every production capability must reject it. |

All renderer processes use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, disabled webviews, safe dialogs, and drag/drop navigation denial. `app.enableSandbox()` enforces the renderer sandbox globally. The main process permits only the expected top-frame `file:` document for each known `webContents`; a matching `webContents` with a changed page or subframe is not authorized.

Unexpected top-level/frame navigation, redirects, popups, and webview attachment are denied. User-facing discovery links use `shell.openExternal` only after URL parsing, HTTPS enforcement, credential rejection, and an exact hostname allowlist for MusicBrainz, Bandcamp, and Discogs.

MusicBrainz metadata repair is the one main-process network request on behalf of the renderer (`metadata:musicbrainz-search`). The renderer sends only a title, artist, album and duration (validated and size-bounded in `src/electron-security.js`); the main process builds the URL itself from `src/musicbrainz.js`, refuses anything but `https://musicbrainz.org/ws/2/recording`, does not follow redirects, identifies Pixelody in the User-Agent, and spaces requests at least 1.1 s apart. The renderer CSP stays closed to the network.

## IPC contract registry

`src/electron-security.js` is the authoritative inventory for every `ipcMain.handle` and `ipcMain.on` channel. Each entry declares:

- the only authorized window type;
- the accepted payload and bound;
- its side effect;
- its privacy classification.

The same module validates argument counts, plain JSON shape/depth/size, strings, enums, IDs, options, paths, URLs, native-helper requests, state/backups, and J.A.M. snapshots before a handler runs. Unknown channels have no registration path, and a registered channel without a contract causes startup/source-audit failure. Additions require a registry entry, a narrow preload method only in the owning window, and positive plus hostile regression cases.

## Filesystem capability model

The renderer does not receive arbitrary filesystem methods. The main process grants canonical paths only after one of these user or durable-state events:

- a file/folder/image dialog;
- an OS-backed dropped `File` converted inside the isolated preload;
- the explicit top-level Downloads scan;
- a validated legacy/backup import;
- the already validated durable startup state;
- an app-owned cached artwork/profile output.

The preload mirrors those grants so `fileUrl`, `exists`, `inspect`, and artwork operations fail before IPC for unknown paths; the main process independently enforces the canonical grant and file type/size. Image copies stay under app-owned profile/artwork directories. Backup/tuning/report writes use save-dialog destinations; reads use open-dialog selections with fixed JSON size ceilings. Folder imports are capped at 100,000 supported audio files and do not follow non-directory entries as directories.

## Content Security Policy

Both production documents default to `none`, allow scripts only from local packaged files, prohibit `unsafe-eval`, plugins, frames, forms, and base rewriting, and limit images/media/fonts/worklets to the schemes required by Pixelody. Loopback HTTP is allowed only for explicit localhost J.A.M. behavior. Existing theme swatches, generated artwork backgrounds, and progress geometry require `style-src 'unsafe-inline'`; this is a documented style-only exception and does not weaken `script-src`.

## Verification

`scripts/check-electron-security.js` proves registry/registration parity, exact mini capability count, CSP and BrowserWindow settings, URL/path/payload rejection, prototype/cycle rejection, and package inclusion. The integration `security` scenario then proves the actual unpackaged and packaged renderer sandbox flags, CSP eval/inline blocking, malformed payload rejection, unauthorized-window IPC denial, popup/navigation denial, and absence of privileged side effects.

The implementation follows Electron's official [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [process sandboxing guidance](https://www.electronjs.org/docs/latest/tutorial/sandbox), [WebPreferences contract](https://www.electronjs.org/docs/latest/api/structures/web-preferences), and [`webContents` navigation/window controls](https://www.electronjs.org/docs/latest/api/web-contents/).
