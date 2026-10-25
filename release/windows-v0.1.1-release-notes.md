# Windows 0.1.1 — historical release draft

This draft never identified a verified signed artifact. Use the repository's current release page for downloads. The following fields remain incomplete for this historical candidate:

- Intended file: Pixelody-Setup-0.1.1-x64.exe, per-user Windows 10/11 x64.
- Install: %LOCALAPPDATA%\Programs\pixelody-lossless-player; data: %APPDATA%\Pixelody.
- Size and SHA-256: PENDING SIGNED ARTIFACT.
- Publisher: PENDING AUTHENTICODE VERIFICATION.

The draft described local imports, library/metadata tools, playlists, tuning, artwork, backups, mini-player, Flow Shuffle, Daily Curated Rediscovery and optional local hosting. It bundled no music. Windows playback used Chromium/Web Audio and shared-mode output, which can resample. Codec support depended on Electron 43; AIFF/ALAC could vary. Tagged/manual BPM, key and energy weren't automatically acoustic-analysis results, and listening didn't wait for analysis.

At that draft's checkpoint Studio was the only active built-in. Community package application was hidden. Browser grouped output was experimental, while native helpers, virtual audio and external-app EQ weren't production installer features. These historical limits don't describe later theme availability.

The installer wasn't intended to add a driver, service, firewall rule, protocol handler, file association or background helper. Uninstall retained the Pixelody data directory for reinstall. Source checks didn't establish installer lifecycle, accessibility, touchpad comfort or listener acceptance. Valid signing and SmartScreen reputation were separate requirements, and the signing/install checks in this draft were incomplete.
