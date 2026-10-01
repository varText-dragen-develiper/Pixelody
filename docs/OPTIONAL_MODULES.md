# Downloaded modules

The module manager is part of the base Android and Windows apps. A shop is not
installed by default. Download a supported `.pixelody-module` package from the
Pixelody website, then import it using the module manager.

## Find the importer

- Windows: Settings → **Modules — import or manage** → **Import downloaded module**.
- Android: Settings & Themes → **Modules — import or manage** → **Import downloaded module**.

On Windows, Ctrl+, opens Settings. On Android, the import action opens the system
document picker; select the downloaded package from Downloads. Importing a music
file or a theme package through another screen will not install a module.

The free RevenueCat Shop package is available at
https://pixelody-web.pixelody101.workers.dev/shop. After importing it, select
**Open shop** in Modules. Removing the shop removes its entry; it does not remove
music or Listening Notes. Listening Notes can be imported independently.

Only the supported notebook and approved web-shop manifest formats are accepted.
Packages configure existing tools; they do not execute downloaded native code.
The shop uses an isolated website viewer without a native music-library bridge.
RevenueCat currently uses a no-charge Test Store consumable. This is not a paid
module entitlement or production checkout.

## Build and version troubleshooting

The importer was initially available only in an isolated candidate. Earlier main
builds and the old Pixelody Commerce Test app do not contain it. Updating source
does not update a running desktop process or an already installed Android APK.
Restart Windows Pixelody after updating, and install a newly compiled Android APK.

Normal Android debug builds keep `com.pixelody.app`. To build an isolated copy,
pass `-PmoduleTestBuild=true`; it uses `com.pixelody.app.modules`. Internal module
activities remain non-exported in both configurations.

## Verification on 2026-10-01

- Desktop `npm run check` and `npm run check:themes` passed, including module
  schema, origin, persistence, IPC and sandbox checks.
- A real isolated Windows app opened Settings, exposed the Modules button,
  opened the manager and dispatched Import through its file-dialog handler.
  The dialog response was stubbed to cancellation in that automated check.
- Android compiled successfully and passed 594 JVM tests. The regular app was
  updated in place on the test phone without clearing its data.
- Android device instrumentation opened Settings through its profile deep link,
  tapped Modules, tapped Import, verified the real system document picker and
  returned to Modules on cancellation.

These checks establish importer availability. They do not establish signed
release readiness or successful checkout inside either native shop viewer.
