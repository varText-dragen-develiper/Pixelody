# Pixelody documentation

For setup, use [Getting started](GETTING_STARTED.md) or the [website guides](https://pixelody-web.pixelody101.workers.dev/docs). The references below cover code, design and testing. Dated results belong to their recorded builds; plans may describe work that is still unfinished.

## Design

- [Designing Pixelody](design/DESIGN_NORTH_STAR.md)

## Architecture

- [Finding problems in the Windows app](architecture/BACKBONE_AUDIT_CHECKLIST.md)
- [Canvas and Studio runtime gates](architecture/CANVAS_AND_STUDIO_GATES.md)
- [Saving and recovering state](architecture/DURABLE_STATE_AND_RECOVERY.md)
- [What each Electron window can do](architecture/ELECTRON_SECURITY_BOUNDARY.md)
- [Renderer modules](architecture/RENDERER_DOMAIN_BOUNDARIES.md)

## Themes

- [Canvas ports and further ideas](themes/CANVAS_THEME_PORT_BACKLOG.md)
- [Measurements used for Canvas ports](themes/CANVAS_THEME_PORT_BASELINE_EVIDENCE.md)
- [Reusable theme instruments](themes/THEME_ASSET_INFRASTRUCTURE_CATALOG.md)
- [Theme ideas and recorded designs](themes/THEME_CATALOG.md)
- [Comparing theme instruments](themes/THEME_INSTRUMENT_FOUNDRY.md)
- [Theme runtime](themes/THEME_RUNTIME_ARCHITECTURE.md)
- [Working on themes](themes/THEME_SYSTEM.md)
- [Working on Cartridge Quest](themes/cartridge-quest/README.md)
- [Cartridge Quest control deck](themes/cartridge-quest/hotbar-design-system.md)
- [Cartridge Quest source references](themes/cartridge-quest/implementation-map.md)
- [Cartridge Quest mini-player](themes/cartridge-quest/mini-player-design-system.md)

## Audio

- [Checking audio before release](audio/AUDIO_RELEASE_GATE.md)
- [Audio in Pixelody](audio/AUDIO_SYSTEM_OVERVIEW.md)
- [Visualizer renderers](audio/AUDIO_VISUALIZER_FOUNDATION.md)
- [Flow Shuffle development notes](audio/FLOW_SHUFFLE_DEVELOPMENT_PLAN.md)
- [EQ for other Windows apps](audio/GLOBAL_SYSTEM_AUDIO_EQ_PLAN.md)
- [Keeping browser fan-out experimental](audio/multi-output/MULTI_OUTPUT_BROWSER_FANOUT_DECISION.md)
- [Calibrating a speaker rig](audio/multi-output/MULTI_OUTPUT_CALIBRATION_DESIGN.md)
- [Calibration: recorded progress](audio/multi-output/MULTI_OUTPUT_CALIBRATION_ROADMAP.md)
- [Testing endpoint-clock correction](audio/multi-output/MULTI_OUTPUT_NATIVE_CLOCK_DISCIPLINE_PROTOTYPE.md)
- [Connecting a native multi-output mixer](audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_CONTRACT.md)
- [Building native mixer input from a rig](audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_INPUT_MAPPING.md)
- [Rules for an optional native mixer](audio/multi-output/MULTI_OUTPUT_NATIVE_MIXER_SAFETY_POLICY.md)
- [Reusing profiles in the native mixer](audio/multi-output/MULTI_OUTPUT_NATIVE_REUSE_MAPPING.md)
- [Native mixer status](audio/multi-output/MULTI_OUTPUT_NATIVE_STATUS_GATE.md)
- [Measuring browser drift and overhead](audio/multi-output/MULTI_OUTPUT_PHASE5_MEASUREMENT_LOG.md)
- [Thirty-minute physical output check](audio/multi-output/MULTI_OUTPUT_PHASE6_PHYSICAL_VALIDATION.md)
- [Wired and Bluetooth hardware results](audio/multi-output/MULTI_OUTPUT_PHASEC_HARDWARE_RUN_LOG.md)
- [Recording a physical rig test](audio/multi-output/MULTI_OUTPUT_PHYSICAL_VALIDATION_RECORDER.md)
- [How speaker rigs work](audio/multi-output/MULTI_OUTPUT_SPEAKER_SYSTEMS_NOTES.md)
- [Playing through a speaker rig](audio/multi-output/MULTI_OUTPUT_SPEAKER_SYSTEMS_PLAN.md)
- [Speaker rigs: recorded progress](audio/multi-output/MULTI_OUTPUT_SPEAKER_SYSTEMS_ROADMAP.md)
- [System-audio bridge protocol](audio/system-audio/WINDOWS_SYSTEM_AUDIO_BRIDGE_PROTOCOL.md)
- [Research behind the virtual audio route](audio/system-audio/WINDOWS_VIRTUAL_AUDIO_DRIVER_RESEARCH.md)
- [What a simpler Windows EQ route could do](audio/system-audio/WINDOWS_VIRTUAL_AUDIO_OPPORTUNITY_AUDIT.md)
- [Windows-wide EQ: direction and progress](audio/system-audio/WINDOWS_VIRTUAL_AUDIO_ROADMAP.md)
- [Preparing a VM for driver tests](audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md)

## Networking and J.A.M.

- [Hosting a personal library across devices](networking/ANDROID_PERSONAL_SERVER_PLAN.md)
- [Personal hosting and J.A.M.](networking/LOCAL_NETWORK_JAMS_AND_DEVICE_HOSTING.md)
- [Host and client contract reference](networking/NETWORKING_BACKBONE_CHECKLIST.md)
- [Extending the network features](networking/NETWORKING_CAPABILITIES_IMPLEMENTATION_MAP.md)
- [Networking: recorded progress](networking/NETWORKING_DEVELOPMENT_ROADMAP.md)

## Release engineering

- [Reviewing a public release](release/LEGAL_RELEASE_CHECKLIST.md)
- [Running the Windows integration tests](release/WINDOWS_INTEGRATION_HARNESS.md)
- [Building and signing Windows releases](release/WINDOWS_RELEASE_AND_SIGNING.md)

## Planning

- [Bringing a music collection into Pixelody](planning/LIBRARY_MIGRATION_AND_DISCOVERY_PLAN.md)

## Brand

- [The Pixelody mark](brand/README.md)

## Other

- [Pixelody architecture](ARCHITECTURE.md)
- [Getting started with Pixelody for Windows](GETTING_STARTED.md)
- [Hardware and measured performance — October 5, 2026](MINIMUM_SPECS.md)
- [Downloaded modules](OPTIONAL_MODULES.md)
- [Preparing a release](RELEASE_PREPARATION.md)
