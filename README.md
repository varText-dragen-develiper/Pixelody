# Pixelody

Pixelody is a Windows music player for lossless libraries. It reports the signal path honestly, applies per-track and per-output EQ, and has correction profiles for different playback systems. It pairs with [Pixelody for Android](https://github.com/varText-dragen-develiper/Pixelody-android), which browses and controls the library on your Windows PC.

This repository is the open-source edition of the Windows app. It is licensed under the GNU General Public License v3.0 only (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). Official paid builds are also sold in the Windows and Android stores under the Pixelody name; see [TRADEMARKS.md](TRADEMARKS.md) for what that means if you fork or redistribute this code.

## What it does

- Plays FLAC, WAV, MP3, AAC/M4A, OGG and Opus. What works depends on Chromium's decoders, and AIFF/ALAC support can vary.
- Processes audio in 32-bit floating point, with three EQ bands per track and per output, ReplayGain, and output switching on the selected device.
- Reads metadata and embedded artwork, and supports favorites, history, playlists with reordering and M3U8 export, queues, shuffle, repeat, media keys, session restore and JSON backups.
- Keeps a mini player on top while the main window is minimized.
- Offers selectable themes, plus a local `.pixelody-theme` import for declarative theme packages.
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

Pull requests are welcome. Contributions need a signed Contributor License Agreement, which a bot checks on each pull request; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Third-party assets

Bundled fonts, icons and artwork keep their own licenses, recorded in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) with the full license texts in [licenses/](licenses/).
