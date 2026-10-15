# Getting started with Pixelody for Windows

Start by listening on Windows. If you want your library on your phone too, connect the [Android app](https://github.com/varText-dragen-develiper/Pixelody-android) later.

## Choose source or a published build

Check [Windows Releases](https://github.com/varText-dragen-develiper/Pixelody/releases) for an artifact and its instructions. As of October 10, 2026, the Windows 0.1.1 x64 preview is published under `unsigned-main` and is unsigned. Read that release’s installation notes if you’re trying the preview. The steps below are for building from source.

## Run from source

Install Git, Node.js 22 or 24 and pnpm. The package declares pnpm 11.9.0; use the project lockfile without updating dependency versions.

~~~powershell
git clone https://github.com/varText-dragen-develiper/Pixelody.git
cd Pixelody
pnpm install --frozen-lockfile
pnpm start
~~~

For source checks run **pnpm run check** and **pnpm run check:themes**. A passing source check does not verify installer signing or audible playback on your device.

## Try ordinary listening first

Import a small folder of music you have permission to use. Play a track, change the queue, and try the mini-player. Reopen the app and check your library and settings. If you get stuck, tell me where it first went wrong and what you tried.

Studio is the built-in layout. Canvas layouts are development work, and older designs are archived. Check your build's release notes for availability.

## Connect Android later

Keep Windows Pixelody running on the same supported private network as your phone. Follow the Android pairing instructions and keep credentials private. The host sets J.A.M. permissions; shared controls don't establish synchronized audio output.

## Optional modules and help

The player does not need a shop module for listening. See [Downloaded modules](OPTIONAL_MODULES.md) for the supported notebook/shop importer. Report a problem using [SUPPORT.md](../SUPPORT.md). Release engineering instructions are in [Windows release and signing](release/WINDOWS_RELEASE_AND_SIGNING.md).
