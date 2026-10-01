# Windows Integration Harness

Pixelody's Windows harness launches the real Electron application in both development/unpacked mode and an allowlisted portable application directory. It uses generated PCM tones and a separate temporary `userData` profile for each scenario; it never reads the normal Pixelody profile or the user's music library.

## Local prerequisites

- Windows 10 or 11.
- Node.js 22 or 24.
- pnpm 11.9.0 and dependencies restored from `pnpm-lock.yaml`.
- A desktop session in which Electron windows can launch.

Install dependencies with `pnpm install --frozen-lockfile`. Then run:

```powershell
pnpm run check:integration
pnpm run check:package
```

`check:integration` exercises the unpackaged app. `check:package` first assembles `.artifacts/windows-package/Pixelody-win32-x64`, verifies its application payload and SHA-256 content manifest, and then runs the same scenarios through `Pixelody.exe`. To run both in one invocation, use the exact CI command:

```powershell
pnpm run check:integration:all
```

If `pnpm` is unavailable, the harness can also be run with Node directly:

```powershell
node scripts/check-windows-integration.js --mode=all
```

## Scenarios and boundaries

Each launch has a 30-second harness deadline. The renderer must become usable and complete startup reveal within the asserted 3.2-second interaction budget; the separate 6.5-second reveal watchdog does not relax that assertion. The default matrix covers a fresh profile, playback/queue/repeat/shuffle/seek/volume controls, an actual mini-window command, full-process persistence, theme-package presentation boundaries, workspace persistence, invalid-output fallback, corrupt-current recovery, an authenticated localhost J.A.M. privacy check, and hostile-window Electron security probes. Unpackaged mode also exercises development workspace scenarios. J.A.M. must be stopped before and after the explicit privacy scenario. The scenario set in the runner is authoritative; retired theme experiments are separate from the default release matrix.

For focused diagnosis, append `--scenario=<name>` to `scripts/check-windows-integration.js`; `persistence-read` automatically performs its prerequisite write launch first. CI always runs the complete set.

The additional `flow-runtime` scenario exercises queue/commit behavior and each
currently selectable built-in theme. Its catalog comes from the product selector,
which the theme source checks reconcile with `built-in-themes.json`; archived
`alternateThemes` entries are not selectable product coverage.

The test bridge is fail-closed. It exists in the preload only when `PIXELODY_TEST_MODE=1`, while the main process additionally requires `--pixelody-integration-test`, an allowlisted scenario, an absolute isolated profile, and a report path inside that profile. There is no general script-evaluation IPC.

The portable directory is test infrastructure, not the signed installer planned for roadmap item 6. Its app payload contains only `src`, the production dependency tree, the minimal package manifest, and a relative-path SHA-256 manifest. Licensed theme UI sounds are allowed; personal music, generated test tones, private theme assets, screenshots, repository notes, and host development data are rejected.

Portable executable naming and the default production-layout target are derived
from `release/windows-identity.json`. `pnpm run check:release-integration` uses that
default; `--executable` remains available for an explicitly owned alternative.
Both packaging routes share the source/content boundary policy. Passing runtime
checks use generated fixtures and do not prove physical audio, perceptual quality,
human accessibility, Authenticode, or installed lifecycle behavior.

## Failure evidence

Test profiles are deleted only after their resolved paths are proven to be owned `pixelody-integration-*` directories under the operating-system temporary directory. Evidence from a failing profile is copied first to `.artifacts/windows-integration/<mode>-<scenario>` as bounded JSONL, process output, a summary, and an optional screenshot. Before copying, the harness removes Windows paths, file URLs, bearer credentials, and the test root. CI uploads only that sanitized failure directory and the package's relative-path content manifest, with seven-day retention; it does not upload profiles, media, tokens, or the full application directory.

The workflow runs the full repository audit set and both launch modes on Windows for Node.js 22 and 24. It uses the current Node-24-compatible major releases documented by the official action projects: `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v6`, and `actions/upload-artifact@v7`.
