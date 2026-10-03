# Release preparation

Public source is available under GPL-3.0-only. No GitHub release was published in this repository when checked on October 2, 2026. Source versions and test APKs are not a stable release announcement.

Before publishing a binary, record:

- source commit/tag, app version, exact filename and architecture;
- build/check results, artifact SHA-256 and signing/update identity;
- minimum requirements and Windows/Android host compatibility;
- clean installation, update, restart and preservation of user data;
- actual audible playback and supported device routes;
- known issues, recovery instructions, support and third-party asset notices.

Keep source checks, device checks, physical audio, signing and release approval as separate evidence. Publish the platform-specific artifact, checksum, instructions and accurate release notes together after those applicable gates pass.

Optional shop modules currently use a no-charge RevenueCat Test Store fixture. Do not describe this as a paid feature unlock or production checkout. J.A.M. shared queue/control does not establish tightly synchronized sound across devices.

## Release-note template

Version and channel:
Source commit/tag:
Platform/architecture and minimum requirements:
Compatible host/app versions:
Artifact filename and SHA-256:
Signing/publisher and update behavior:
What works in this build:
Checks performed on this exact artifact:
Known issues and recovery:
Installation/update instructions:
Support:

Replace every field with evidence. Keep a draft unpublished if a required field or gate is unresolved.
