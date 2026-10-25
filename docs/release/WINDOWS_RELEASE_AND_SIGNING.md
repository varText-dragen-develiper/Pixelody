# Building and signing Windows releases

## Identity used for upgrades

`release/windows-identity.json` owns the Windows identity: app/AppUserModelID `io.pixelody.desktop`, product/executable `Pixelody`, NSIS GUID `df122149-511d-4684-b109-b8df7214441f`, per-user x64 installation at `%LOCALAPPDATA%\Programs\pixelody-lossless-player` and data at `%APPDATA%\Pixelody`. Version comes from `package.json`.

Keep those identity values stable after release; changing them needs a migration for upgrades, uninstall records, shortcuts, taskbar, notifications and data. The controlled 0.1.0 → 0.1.1 fixture isn't a product version override. Publisher display name is Pixelody; trusted release signing must match the privately supplied exact `PIXELODY_WINDOWS_PUBLISHER_SUBJECT`.

## What goes in a package

The locked tools are Electron 43.4.1, electron-builder 26.11.1 and @electron/asar 3.4.1. Use the lockfile and project packager. The recorded Electron support assessment belongs to its audit date; check [the release timeline](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) before a later toolchain decision.

NSIS provides a per-user one-click installer without elevation. `deleteAppDataOnUninstall` and `packElevateHelper` are false. The generated original icon is applied with version metadata and asInvoker execution.

The production ASAR permits the minimal package manifest, centralized identity, src, production dependencies and notices. Native helpers aren't bundled without their signing/evidence. Development pages/docs, probes, scripts, notes, source-control data, Android/driver trees, private media, fixtures and reports stay out. The separately labeled instrumented layout includes test probes and is never publishable.

`scripts/windows-package-policy.js` supplies the common source/content boundary. Audits compare source/identity/version, vendor runtime bytes and relative hashes, and scan app/extra resources for configured path/secret forms. They don't establish arbitrary-secret detection or asset rights; full build-tool auditing is separate from `pnpm audit --prod`. The workspace allows Electron's install script and rejects unused electron-winstaller; it doesn't replace dependency review.

## Commands

- `pnpm run check:release-config`: identity and fail-closed configuration.
- `pnpm run release:windows:instrumented`, then `pnpm run check:release-integration`: test-only production layout and scenarios.
- `pnpm run release:windows:unsigned`: explicitly unsigned development installer and hash manifest.
- `pnpm run release:windows:upgrade-fixture`: controlled unsigned lifecycle fixtures.
- `pnpm run release:windows:signed`: trusted release path, requiring credentials and exact publisher subject before packaging.
- `node scripts/inspect-windows-pe-dependencies.js --target=<exe>`: local/System32 import diagnosis for STATUS_DLL_NOT_FOUND, not a clean-machine launch check.

PFX signing takes CSC_LINK or WIN_CSC_LINK, CSC_KEY_PASSWORD or WIN_CSC_KEY_PASSWORD, plus PIXELODY_WINDOWS_PUBLISHER_SUBJECT through secrets or ephemeral environment. Never put their values in repository files or output. Verify SHA-256, RFC3161 timestamp, Authenticode Valid, exact signer and timestamp certificate on installer and installed executable. See [SignTool](https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe), [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution/) and [electron-builder signing](https://www.electron.build/docs/features/code-signing/code-signing-win/).

The wrapper refuses dirty/untracked signing inputs and signed version overrides, fingerprints before/after and records source/input hashes. It suppresses raw provider output and strips signing variables only from unsigned child processes. It doesn't alter stored credentials or the parent environment. A working-tree manifest isn't a frozen candidate.

## Installer lifecycle tests

Use a disposable Windows VM or ephemeral hosted runner, never the normal install/profile. Set `PIXELODY_DISPOSABLE_WINDOWS=1` and run `scripts/test-windows-installer-lifecycle.ps1` with `-ConfirmDisposableEnvironment`, resolved fixture installers and an owned .artifacts evidence directory. It refuses existing installs/profiles/shortcuts and out-of-root inputs. A signed tag run also verifies exact subject and artifact hashes.

The test installs, seeds generated state/WAV, repairs, upgrades, checks versions/shortcuts/uninstall identity and preserves library, playlists, favorites, tuning, queue and session. It opens the installed window, uninstalls while retaining data, then reinstalls and verifies restore. Exit 0 is required. The final install stays for inspection until the environment is discarded.

Run both prior-to-current upgrade and `-CleanCurrent` in separate fresh environments. Only the latter establishes clean installation of the current artifact. Use `scripts/resolve-windows-lifecycle-inputs.ps1` (`-Signed` where applicable); the tag job consumes the exact signing-job artifact. `check-windows-installer-guards.ps1` tests refusal/parser/tamper behavior without executing an installer, so its pass isn't lifecycle evidence.

`test-windows-release-surface.ps1` compares services, drivers, firewall rules and default-audio/MMDevices state. It rejects Pixelody-attributable additions/changes and any default-audio change, while reporting unrelated hosted-runner drift. Only expected install files, shortcuts, uninstall metadata and preserved profile may change. Downgrade is unsupported and doesn't roll back schemas; future schemas open read-only.

## Evidence to publish

A trusted release needs source checks, instrumented integration, clean/upgrade/repair/uninstall/reinstall results, a clean production allowlist and valid timestamped signatures on both executables. The manifest carries relative names, sizes, hashes, identity, architecture and verification results without credentials/host paths. Workflow configuration alone isn't a passed job.

Failed signing output stays non-publishable. Diagnose and rerun without relaxing trust/subject/timestamp rules. For install failures, preserve sanitized evidence and revert the disposable environment. A valid signature can still receive SmartScreen reputation warnings; those are separate checks.
