# Comparing theme instruments

The August 24, 2026 Foundry is a standalone comparison page. Its instruments use fixtures; they aren't assigned to production themes or connected to live Electron state.

Open `src/theme-instrument-foundry.html` through a local static server to compare the set. Every card is created through `src/theme-instruments/registry.js`, receives the same deterministic fixture from `src/theme-instruments/fixtures.js`, and implements `mount`, `update`, and `destroy`.

## The fixture set

| Catalog category | Specimen 1 | Specimen 2 | Behavior shown |
| --- | --- | --- | --- |
| Visual material + atmosphere | Material Switchboard | Ambient Field | Interchangeable surface recipes; decorative orbit/rain/steam with motion and conserve substitutions |
| Artwork + identity | Artwork Treatment Prism | Playlist Sigil Generator | Artwork-preserving treatment modes; deterministic playlist identity and literal catalog code |
| Truthful reactive + information | Seek Timeline Deck | Truth Signal Bank | Real seek input over one position/duration fixture; literal phase/source/output/queue facts |
| Interaction + control | Transport Object Console | Focus-Safe Technical Cabinet | Canonical transport actions; disclosure with focus entry, Escape, close, and focus return |
| Motion + feedback language | Transition Choreography Stage | Recovery Receipt | Optional transition choreography with static receipts; pending/error/retry/undo/success language with next action |
| Composition + delivery | Product Slot Composer | Main / Mini Companion Profile | Placement compatibility and baseline fallback; distinct/shared/unsupported mini relationships over synchronized truth |

## Shared contract

Every descriptor declares a stable id, one of six categories, role, renderer, cost, jobs, read-only inputs, supported placements, fallback, accessibility behavior, and a lifecycle factory. Registration validates these fields, rejects duplicate keys, and probes the lifecycle. Unknown keys return no instance.

The fixture reaches the instrument through this host path:

`deterministic fixture -> host dispatch/reducer -> registered instrument -> foundry-owned stage`

Production promotion must replace the fixture with the appropriate product-owned read-only bundle and keep mutations behind existing host callbacks. An instrument must not read app selectors, infer theme identity, own audio nodes, fetch assets, or duplicate playback state.

## Comparison settings

- Palette changes test separation between visual recipe and semantic content.
- Motion offers full, reduced, and off conditions. Choreography becomes a named static receipt outside the full-motion balanced condition.
- Detail offers sparse, balanced, and rich density.
- Performance Conserve disables costly atmosphere animation, blur, and large card shadows.
- Narrow layout changes composition without removing any functional control or literal state.

## What these checks establish

The deterministic audit proves descriptor validation, duplicate rejection, two entries in each category, immutable fixture reduction, lifecycle shape, local-only implementation, declared motion/performance styles, and safe unknown-key behavior.

Painted browser review can prove the standalone page renders, reflows, and responds to keyboard/pointer input. It does not prove:

- Electron runtime integration or restoration across launches.
- Correct production-theme selection, placement, or fallback.
- Screen-reader or real Windows high-contrast acceptance.
- Playback-graph, output-route, or physical-device behavior.
- Independent-human comfort, comprehension, or aesthetic selection.

Before putting one in a theme, identify its consumer, slot and read-only input, then check it in Electron and through the relevant accessibility interactions. Missing assets or unsupported placements still need a plain usable fallback.
