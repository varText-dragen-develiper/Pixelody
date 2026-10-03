# Getting started with Pixelody for Windows

Pixelody for Windows is the player and primary library host. The [Android companion](https://github.com/varText-dragen-develiper/Pixelody-android) is a separate app. You can start with local Windows listening without enabling hosting.

## Choose source or a published build

Check [Windows Releases](https://github.com/varText-dragen-develiper/Pixelody/releases) for an artifact and its instructions. No GitHub release was published when checked on October 2, 2026; the steps below are for building public source, not installing a signed public release.

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

Import a small folder of music you have permission to use. Choose a track, confirm audible playback, change the queue, and try the mini-player. Close and reopen to check expected library, queue and settings behavior. Note the first confusing or broken step.

Studio is the currently registered built-in presentation. Development Canvas profiles and archived theme studies are separate from the normal built-in catalog. Keep customization claims tied to the build you are actually using.

## Connect Android later

Keep the Windows app running and follow its visible hosting/pairing controls on a supported private network. Use the companion's current pairing instructions. Do not publish credentials or enable internet exposure just to get local pairing working. J.A.M. permissions are controlled by the host; shared controls are not a guarantee of synchronized audio output.

## Optional modules and help

The player does not need a shop module for listening. See [Downloaded modules](OPTIONAL_MODULES.md) for the supported notebook/shop importer. Report a problem using [SUPPORT.md](../SUPPORT.md). Release engineering instructions are in [Windows release and signing](release/WINDOWS_RELEASE_AND_SIGNING.md).
