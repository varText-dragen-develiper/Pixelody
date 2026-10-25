# Preparing a release

The Windows 0.1.4 testing preview is on the [release page](https://github.com/varText-dragen-develiper/Pixelody/releases/tag/v0.1.4). Its notes describe those files. New source changes don't update an installer that's already there.

A release needs an identifiable build: source tag or commit, app version, filename, architecture, minimum requirements, SHA-256, and signing identity. Include compatible phone/host versions where they matter. Put the download, checksum and instructions together so someone can tell what they're installing.

Check a clean install and an update over existing data, then reopen the app and try actual playback on the routes being supported. Record the exact artifact and what was tested. Source tests can't establish a working install, audible output or signing; a phone test doesn't establish the same result on a different device. Leave known problems and recovery steps in the release notes, with links to support and asset notices.

The optional shop currently uses a no-charge RevenueCat Test Store fixture. It doesn't provide a production paid unlock. J.A.M. queue and playback controls don't establish synchronized sound across devices.

## Release notes

Include these details when publishing:

- Version, channel and source tag/commit.
- Filename, SHA-256, platform, architecture and minimum requirements.
- Signing identity, update behavior and compatible host/app versions.
- Changes people will notice and checks performed on this artifact.
- Known issues, installation/recovery steps and support links.

If a required check is unresolved, keep the release as a draft.
