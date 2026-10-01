# Pixelody for Windows 0.1.1

Pixelody for Windows is the primary local-library host and desktop playback engine for Pixelody. This release is a 64-bit per-user Windows installer for user-owned music libraries.

## Download

- File: `Pixelody-Setup-0.1.1-x64.exe`
- Platform: 64-bit Windows 10 or Windows 11
- Installer type: per-user `.exe`; administrator elevation is not required
- Installed application: `%LOCALAPPDATA%\Programs\pixelody-lossless-player`
- Durable user data: `%APPDATA%\Pixelody`
- Download size: `PENDING SIGNED ARTIFACT`
- SHA-256: `PENDING SIGNED ARTIFACT`
- Publisher: `PENDING AUTHENTICODE VERIFICATION`

Do not publish this draft until the placeholders above have been replaced from the exact signed, lifecycle-tested artifact and its `release-manifest.json`.

## What Pixelody does

Pixelody imports and plays music files selected by the user. Music, artwork, playlists, edits, tuning, listening intelligence, and settings remain local unless the user explicitly enables a local J.A.M. host session. No music is bundled with the installer.

The Windows app owns the main library, playback, queue, metadata editing, per-track and per-output tuning, themes, backups, mini player, Flow Shuffle, Daily Curated Rediscovery, and the opt-in local J.A.M. host used by the Android companion.

## Audio and metadata truth

Pixelody plays through Chromium and Web Audio into the selected Windows shared-mode output. Windows may resample to the device format. Pixelody does not claim bit-perfect or exclusive-mode output.

Flow Shuffle can use BPM, musical key, energy, diversity, history, and queue intent. BPM/key/energy values are tagged or manually edited metadata unless a specific local analysis profile says otherwise. Normal playback never waits for acoustic analysis.

## Known boundaries

- Codec support depends on the Chromium decoder shipped with Electron 43. AIFF and ALAC/M4A support can vary; unsupported files must fail visibly and recoverably.
- Studio is the only active built-in theme during the foundation reset. Earlier theme studies remain development material. Local community-theme import/application is unavailable in the current presentation surface. Automated checks do not establish independent perceptual, comfort, touchpad, or assistive-technology acceptance.
- The browser-based grouped/two-output path is an experimental prototype and is not release-quality synchronized playback.
- Windows-wide/System EQ, external-app audio processing, a Pixelody virtual-audio endpoint, and native audio helper binaries are not production features and are not included in the installer.
- Pixelody does not install a driver, service, firewall rule, protocol handler, file association, or background helper.
- Uninstall removes the application, shortcuts, and installer registration while preserving `%APPDATA%\Pixelody` so a later reinstall can recover the library and settings.
- A valid Authenticode signature proves publisher and artifact integrity. Microsoft SmartScreen reputation is separate and a newly established publisher may still receive a reputation warning.

## Verification status

This file is release copy, not evidence. Publication remains blocked until the exact `0.1.1` source commit passes the automated checks, Electron runtime/package matrix, unsigned and signed disposable installer lifecycles, physical output/codec matrix, exact-subject timestamped Authenticode checks, final legal/provenance review, and manifest/hash audit.
