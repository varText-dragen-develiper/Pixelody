# Pixelody

Pixelody is a music player for Windows. Organize albums and playlists, adjust the sound for individual tracks and outputs, and keep playback close with the mini-player. Pair [Pixelody for Android](https://github.com/varText-dragen-develiper/Pixelody-android) to browse and control your Windows library.

The idea is to bring library tools, playback, and sound adjustments together. A change for one recording belongs with that track; a correction for your speakers belongs with the output. Metadata, artwork, playlists, and saved settings help keep the collection useful as it grows.

This repository is the open-source edition of the Windows app. It is licensed under the GNU General Public License v3.0 only (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). If you fork or redistribute it, read the name and logo guidance in [TRADEMARKS.md](TRADEMARKS.md).

## Start here

- [Getting started](docs/GETTING_STARTED.md): requirements, source build and first listening session.
- [Windows releases](https://github.com/varText-dragen-develiper/Pixelody/releases): build files and their release notes. The Windows 0.1.2 testing preview is available under `v0.1.2`. Read its signing and installation notes before trying it.
- [Support](SUPPORT.md) and [shared discussions](https://github.com/varText-dragen-develiper/Pixelody/discussions): report problems or share listening ideas.
- [Release preparation](docs/RELEASE_PREPARATION.md): what still needs verification before distributing a binary.

## What it does

- Plays FLAC, WAV, MP3, AAC/M4A, OGG and Opus. What works depends on Chromium's decoders, and AIFF/ALAC support can vary.
- Processes audio in 32-bit floating point, with three EQ bands per track and per output, ReplayGain, and output switching on the selected device.
- Reads metadata and embedded artwork, and supports favorites, history, playlists with reordering and M3U8 export, queues, shuffle, repeat, media keys, session restore and JSON backups.
- Keeps a mini player on top while the main window is minimized.
- Offers Studio, Obsession Mode and Cartridge Quest through Settings. Other development layouts and local theme packages have their own availability limits.
- Installs optional modules, downloaded from the Pixelody website, from Settings (see [docs/OPTIONAL_MODULES.md](docs/OPTIONAL_MODULES.md)).
- Hosts the library for the Android companion over your local network.

Not available yet: bit-perfect exclusive WASAPI output (Windows shared mode may resample to the device's configured format), and a native playback engine beyond the browser audio stack.

## Build and run

You need Node.js and pnpm.

```powershell
pnpm install
pnpm start
```

Run the checks with `pnpm run check` and `pnpm run check:themes`. Other `check:*` scripts are listed in `package.json`.

Packaging for Windows (and the macOS and Linux builder configs) is described in the documents under [docs/](docs/README.md).

## Contributing and security

Want to help with a fix? Thanks for taking a look. Start with [CONTRIBUTING.md](CONTRIBUTING.md), including the Contributor License Agreement. Report security problems privately using [SECURITY.md](SECURITY.md).

## Third-party assets

Bundled fonts, icons and artwork keep their own licenses, recorded in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) with the full license texts in [licenses/](licenses/).
