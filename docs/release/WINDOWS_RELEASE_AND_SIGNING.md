# Pixelody Windows Release and Signing

## Immutable release identity

`release/windows-identity.json` is the only Windows identity contract. The app ID and AppUserModelID are `io.pixelody.desktop`; the product/executable are `Pixelody`; the NSIS GUID is `df122149-511d-4684-b109-b8df7214441f`; installation is per-user and x64 at `%LOCALAPPDATA%\Programs\pixelody-lossless-player`; durable data remains `%APPDATA%\Pixelody`.

After a public release, do not change the app ID/AppUserModelID, installer GUID, executable/product names, install scope, architecture policy, or userData directory without a separately designed migration. Those values join upgrades, uninstall metadata, shortcuts, taskbar identity, notifications, and durable state. The semantic version comes from `package.json`; the controlled `0.1.0 -> 0.1.1` fixture is test-only.

The publisher display name is Pixelody, but the authoritative release publisher is the exact Authenticode certificate subject supplied privately as `PIXELODY_WINDOWS_PUBLISHER_SUBJECT`. A final certificate subject must be chosen before the first public signed build and then treated as release identity.

## Toolchain and package boundary

The project locks Electron 43.4.1, electron-builder 26.11.1, and `@electron/asar` 3.4.1 in pnpm. Electron 43 is in Electron's supported three-major window as of this release audit; pinning it exactly keeps local, CI, smoke, and production builds on one reviewed runtime. Electron's [release timeline](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) defines that support window, and its [versioning policy](https://www.electronjs.org/docs/latest/tutorial/electron-versioning) explains why an unsupported major should not remain in a release toolchain. `pnpm-workspace.yaml` explicitly permits Electron's binary-install script and rejects the unused `electron-winstaller` build script. NSIS is used because it is the maintained electron-builder consumer `.exe` target and supports a stable per-user identity without elevation. The one-click installer writes application files under the current user's local application area. `deleteAppDataOnUninstall` is explicitly false.

The production payload is ASAR-backed and allowlisted to `package.json`, the centralized release identity JSON, `src`, production dependencies, license notices, and `THIRD_PARTY_ASSETS.md`. No native helper is released yet because the current native prototypes do not have the production signing/evidence required for bundling. Notes, scripts, source-control/agent data, Android/driver trees, personal/private assets, generated fixtures, reports, and the integration/security probes are excluded. A separately labeled instrumented production-layout directory includes only those probes for regression testing and is never publishable.

`scripts/windows-package-policy.js` classifies source files for both package paths.
Source documentation, standalone development pages, private/evidence directories,
credential files, and unlicensed audio locations are rejected or excluded; bundled
asset license notices are retained. The production audit scans application and
extra-resource contents for host-user paths and known secret forms, compares source
bytes and identity/version with the checkout, and compares vendor runtime bytes
with the locked Electron distribution. Public asset notices omit the private
user-file inventory. NSIS `packElevateHelper` is false for this per-user installer.
These checks do not replace human provenance review or establish arbitrary-secret
detection. Full build-tool auditing is separate from `pnpm audit --prod`.

`build/icon.svg` is the original, theme-neutral Pixelody mark; `scripts/create-release-icon.ps1` deterministically generates the 512-pixel `build/icon.png` packager input. electron-builder applies it with product/version metadata while retaining `asInvoker` execution level.

## Commands

Use the locked project dependency graph; do not substitute a global packager.

- `pnpm run check:release-config` validates identity and fail-closed configuration.
- `node scripts/inspect-windows-pe-dependencies.js --target=<exe>` recursively inventories application-local and System32 PE imports when a Windows child reports `STATUS_DLL_NOT_FOUND`; it is diagnostic evidence, not a substitute for a clean-VM launch test.
- `pnpm run release:windows:instrumented` builds the test-only production layout.
- `pnpm run check:release-integration` runs the item 1-5 scenarios against that layout.
- `pnpm run release:windows:unsigned` creates a clearly unsigned local-development installer and privacy-safe hash manifest.
- `pnpm run release:windows:upgrade-fixture` creates controlled unsigned `0.1.0` and `0.1.1` installers for disposable lifecycle testing.
- `pnpm run release:windows:signed` is the only release command. It fails before packaging unless certificate link/password and exact expected subject variables are present.

For PFX signing, provide `CSC_LINK` or `WIN_CSC_LINK`, `CSC_KEY_PASSWORD` or `WIN_CSC_KEY_PASSWORD`, and `PIXELODY_WINDOWS_PUBLISHER_SUBJECT` through a CI secret store or ephemeral process environment. Never put values in repository files or command output. The configuration uses SHA-256 only and an RFC 3161 timestamp. Signed verification requires Windows Authenticode status `Valid`, an exact signer subject, and a timestamp certificate for both the installed executable and installer.

The build wrapper now rejects dirty/untracked signing inputs and signed version
overrides, fingerprints inputs before and after packaging, and records source SHA,
input hashes, and dirty state in the manifest. Raw signing-provider output is not
printed. Unsigned child processes receive no signing-credential variables; stored
credentials and the parent environment are untouched. A working-tree manifest is
explicitly not a frozen candidate.

Microsoft documents that SignTool must specify file and timestamp digests and recommends SHA-256: <https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe>. Electron's packaging guidance recommends packaging/rebranding and ASAR for distribution: <https://www.electronjs.org/docs/latest/tutorial/application-distribution/>. The locked tool's content, NSIS, and Windows signing contracts are documented at <https://www.electron.build/docs/contents/>, <https://www.electron.build/nsis/>, and <https://www.electron.build/docs/features/code-signing/code-signing-win/>.

## Disposable lifecycle test

Never run installer automation on a normal profile. Use a clean disposable Windows VM snapshot or an ephemeral GitHub-hosted Windows runner with Node/pnpm dependencies installed, set `PIXELODY_DISPOSABLE_WINDOWS=1`, and invoke `scripts/test-windows-installer-lifecycle.ps1` with `-ConfirmDisposableEnvironment`, the two resolved fixture installers, and an evidence directory under `.artifacts`. The script rejects installers outside the controlled fixture root; the signed tag gate may instead use the exact signed release root only when it also receives the private expected publisher subject and verifies the current installer and installed executable.

The script refuses an existing Pixelody install/profile/shortcut, refuses input/output outside owned artifact roots, installs the previous version, checks exact executable versions, shortcuts, and per-user uninstall metadata, seeds generated WAV/state only, repairs, upgrades, verifies library/playlists/favorites/tunings/queue/session, and proves the installed production executable exposes a responsive window. It then uninstalls, proves binaries, shortcuts, and installer metadata are removed while userData remains, reinstalls, launches again, and revalidates state. The final reinstall intentionally remains for inspection until the VM or hosted runner is discarded. Installer success is exit code 0; any other code fails the gate.

Two fresh disposable environments are required: the default prior-to-current
upgrade run and a `-CleanCurrent` run that begins with the exact current installer.
Both exercise current-installer repair. Only `-CleanCurrent` proves current/signed
clean installation; the prior fixture is unsigned. Use
`scripts/resolve-windows-lifecycle-inputs.ps1` (add `-Signed` for the signed current
artifact) to derive names and versions from the contracts. Inputs must match their
manifest hashes. Receipts identify the matrix and installer hashes, and checks
include identity-derived shortcut targets, uninstall GUID/version, backups, and
previous recovery generations. The CI clean-current job downloads the exact signed
artifact from the signing job on tags, rather than rebuilding it.

`scripts/check-windows-installer-guards.ps1` safely exercises parser, refusal, and
manifest-tamper checks without executing an installer or accessing a real profile.
It is source/guard evidence, never installer-lifecycle evidence.

`scripts/test-windows-release-surface.ps1` captures privacy-safe per-entry hashes of services, drivers, and firewall rules (names and hashes only, never paths) plus the default-audio/MMDevices registry surface before installation. Afterward it fails on any added or changed service, driver, or firewall rule attributable to Pixelody -- its name, display name, binary path, or firewall program mentions Pixelody or points into the install root, the Pixelody profile, or the checkout -- and on any change to the default-audio surface. Other entries that change during the run are reported by name but do not fail it: hosted runners change services and firewall rules on their own (Defender platform updates, Windows Update start-mode changes), and a whole-surface hash failed about every other run on that drift alone. It also rejects any Pixelody-named service, driver, or firewall rule outright. Only the expected per-user install directory, shortcuts, uninstall metadata, and preserved Pixelody profile may change. Test an attempted downgrade separately: it is unsupported release behavior; never use it as schema rollback. The durable store already opens an unsupported future schema read-only instead of overwriting it.

The Windows CI workflow contains two isolated lifecycle gates. Pull requests use the controlled unsigned `0.1.0 -> 0.1.1` fixture and upload only sanitized boolean evidence. A tag build repeats the upgrade with the signed current installer, verifies the exact signer and timestamp on both installer and installed executable, and includes sanitized lifecycle evidence beside the intended signed distribution artifacts. Workflow configuration alone is not release evidence; the corresponding hosted-runner jobs must succeed.

## Release evidence and recovery

A build is release-ready only when all of these exist together:

1. Item 1-5 checks and instrumented production-layout integration pass.
2. A clean disposable VM passes install, repair, same-identity upgrade, uninstall, and reinstall, including generated-state preservation.
3. The distributable production ASAR allowlist passes with probes/private/host content absent.
4. The executable and installer have valid trusted, timestamped Authenticode signatures from the exact intended subject.
5. `release-manifest.json` contains relative names, sizes, SHA-256 hashes, identity, architecture, signature results, allowlist result, and no credentials or host paths.

If signing fails, treat the output as non-publishable, diagnose through the authorized signing operator, and rerun the affected gate without weakening `forceCodeSigning`, timestamp, or exact-subject validation. Do not expose or modify signing credentials during this audit. If install/upgrade fails, restore the VM snapshot, retain only sanitized evidence, and rebuild from the same locked source/version. Windows SmartScreen reputation is separate from cryptographic validity: a new valid standard certificate may still show reputation warnings until the signed publisher establishes reputation.
