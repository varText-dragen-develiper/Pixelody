# Windows Local Theme Packages

This directory owns the hostile-input boundary for locally imported declarative
themes. The first format is deliberately a bounded JSON `.pixelody-theme` file.
It contains no archive extraction, executable code, arbitrary CSS, remote URLs,
fonts, or assets. Those capabilities remain future work.

The dependency direction remains:

`authoritative state -> registered capabilities -> normalized package descriptor -> product-owned presentation`

`contract.js` validates and normalizes bytes without filesystem authority.
`store.js` performs atomic, versioned installation under Pixelody `userData` and
returns path-free descriptors to the renderer. The renderer never receives the
source path or reads package files directly.

The separate Modules importer now also accepts two first-party `theme-edition`
test descriptors (Cosmic Cinema and Neon Burst). These select allowlisted recipes
already shipped with the Windows development Canvas host; they are not V1 local
theme packages and do not restore My Themes or the built-in registry. See
the private development notes for testing and compatibility.
