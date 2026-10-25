# Downloaded modules

Import a supported `.pixelody-module` from the [website](https://pixelody-web.pixelody101.workers.dev/shop). The shop is optional; listening doesn't require it.

- Windows: Settings → **Modules — import or manage** → **Import downloaded module**. Ctrl+, opens Settings.
- Android: Settings & Themes → **Modules — import or manage** → **Import downloaded module**, then choose the package in the document picker.

A music/theme importer won't install a module. After importing the free RevenueCat Shop package, use **Open shop** in Modules. Removing it removes the shop entry without deleting music or Listening Notes; the notebook can be installed separately.

Supported notebook and approved web-shop manifests configure existing tools. They don't download executable native code. The shop viewer is isolated from the native music library. Its current RevenueCat flow is a no-charge Test Store consumable, not a production paid entitlement. Offline/load failures show a message, with Reload on Android; installed modules remain available.

## If Modules is missing

Check the build's release notes. Older builds and the separate Commerce Test app lack this importer. Restart Windows Pixelody after updating, or install the newly compiled Android APK. Normal Android debug builds use `com.pixelody.app`; `-PmoduleTestBuild=true` makes an isolated `com.pixelody.app.modules` copy. Module activities stay non-exported.

## Recorded October 1 checks

Desktop source/theme checks passed, including schema, origin, persistence, IPC and sandbox cases. An isolated Windows run opened Modules and dispatched Import; automation canceled the file dialog, so it didn't prove a successful selected-file import.

Android compiled and passed 594 JVM tests. The test phone updated without clearing data. Device instrumentation opened Modules, reached the real system document picker and returned after cancellation. Those results establish access to the importer, not signed release readiness or checkout inside either native viewer.
