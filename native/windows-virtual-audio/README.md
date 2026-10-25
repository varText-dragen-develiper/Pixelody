# Virtual audio endpoint scaffold

This folder reserves the optional Windows-wide EQ component. It contains contracts and placeholders, not a WDK project, SysVAD source, binary, valid INF/catalog or installable driver. Normal listening, imports, playlists, metadata, EQ and themes work independently of it.

The intended route is external-app shared-mode PCM → **Pixelody Virtual Output** → virtual cable → **Pixelody Virtual Monitor** → **Pixelody.SystemAudio.Bridge.exe** → user-mode EQ/headroom/limiter/spatial processing → a distinct real output. Enabling/disabling it eventually needs clear installation consent and a way to restore normal Windows routing.

The first driver is limited to one render and one capture endpoint, stereo 48 kHz, minimal kernel transport and no APO, offload, Bluetooth or keyword sample extras. [SysVAD](https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad) is an architectural reference, not an imported implementation. A future import needs a pinned revision and the notices in [the provenance record](upstream/SYSVAD_PROVENANCE.md).

Never install silently, take over the default output, render back into a virtual endpoint, leave defaults pointing at removed endpoints or require test signing on a normal machine. Active external EQ needs received frames, actual processing/render and current recovery/watchdog facts.

Use [the roadmap](../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_ROADMAP.md), [bridge protocol](../../docs/audio/system-audio/WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md), [scaffold contract](DRIVER_SCAFFOLD.md) and [VM runbook](../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md). Build, test signing, endpoint visibility/capture and clean uninstall/restore remain VM gates. This scaffold supplies no build or installation command.
