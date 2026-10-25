# Pixelody

I'm building Pixelody as a place to listen, organize a collection, and get the player looking and sounding how you want. It runs on Windows, with an [Android app](https://github.com/varText-dragen-develiper/Pixelody-android) for phone playback and connecting to your Windows library.

There are separate sound settings for a recording and for the speakers you're using, alongside playlists, artwork, metadata tools and a mini-player. I want those things to fit into ordinary listening, without having to keep moving between different tools.

This repository is the open-source edition of the Windows app. It is licensed under the GNU General Public License v3.0 only (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). If you fork or redistribute it, read the name and logo guidance in [TRADEMARKS.md](TRADEMARKS.md).

## Download or build it

- [Getting started](docs/GETTING_STARTED.md): requirements, source build and first listening session.
- [Windows releases](https://github.com/varText-dragen-develiper/Pixelody/releases): build files and their release notes. The Windows 0.1.4 testing preview is available under `v0.1.4`. Read its signing and installation notes before trying it.
- [Support](SUPPORT.md) and [shared discussions](https://github.com/varText-dragen-develiper/Pixelody/discussions): report problems or share listening ideas.
- [Release preparation](docs/RELEASE_PREPARATION.md): what still needs verification before distributing a binary.

## In the player

- Plays FLAC, WAV, MP3, AAC/M4A, OGG and Opus. What works depends on Chromium's decoders, and AIFF/ALAC support can vary.
- Processes audio in 32-bit floating point, with three EQ bands per track and per output, ReplayGain, and output switching on the selected device.
- Reads metadata and embedded artwork, and supports favorites, history, playlists with reordering and M3U8 export, queues, shuffle, repeat, media keys, session restore and JSON backups.
- Keeps a mini player on top while the main window is minimized.
- Offers Studio, Obsession Mode and Cartridge Quest through Settings. Other development layouts and local theme packages have their own availability limits.
- Installs optional modules, downloaded from the Pixelody website, from Settings (see [docs/OPTIONAL_MODULES.md](docs/OPTIONAL_MODULES.md)).
- Hosts the library for the Android companion over your local network.

Playback currently uses the browser audio stack. Windows shared mode may resample to the device's configured format; exclusive, bit-perfect WASAPI playback and a native replacement engine aren't available.

## Build and run

You need Node.js and pnpm.

```powershell
pnpm install
pnpm start
```

Run the checks with `pnpm run check` and `pnpm run check:themes`. Other `check:*` scripts are listed in `package.json`.

Packaging for Windows (and the macOS and Linux builder configs) is described in the documents under [docs/](docs/README.md).

## Contributing and security

For fixes and other contributions, read [CONTRIBUTING.md](CONTRIBUTING.md), including the CLA. Send security reports [privately](SECURITY.md).

## Third-party assets

Bundled fonts, icons and artwork keep their own licenses, recorded in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) with the full license texts in [licenses/](licenses/).
