# Working on Cartridge Quest

Cartridge Quest treats the library like a cartridge collection, with a title-screen stage, hardware controls, pixel feedback and modest listening rewards. Playback, queue, settings and tuning still need to be easy to use. Motion preferences take precedence over decorative score effects.

Start with the [current theme guide](../THEME_SYSTEM.md): the selectable composition uses the live Canvas host. The [implementation map](implementation-map.md) also preserves older file/animation references; don't relink those retired sheets to repair the current recipe.

The [hotbar guide](hotbar-design-system.md) covers the three control bays, and [mini-player guide](mini-player-design-system.md) covers window size, drag regions and responsive priorities. For behavior, inspect the renderer's score, shared commands, copy and transition code; mini synchronization uses `state.questStats` and `rewardSerial`.

Check the registry/manifest before asset or metadata changes. For a visual repair, inspect the active composition, shared performance layer and matching mini rules. Try it in the running app with long text, narrow width, motion off, reduced motion and conserve. Score state under `pixelody.cartridgeQuestStats` must survive while optional animation can stop.
