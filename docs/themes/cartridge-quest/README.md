# Cartridge Quest Notes

This folder is the working map for owning, editing, and refining the Cartridge Quest theme.

Cartridge Quest is Pixelody's original 8/16-bit console adventure skin. The theme should feel like a playable music cartridge: chunky controls, cabinet hardware, screen glow, pixel feedback, and score moments that reward listening without getting in the way of playback.

## North Star

- Keep the first read as a console: screen, cartridge, rack, controller deck, and status counters.
- Reward playback with visible but modest casino-style moments: flash, payout text, score roll, and soft upward drift.
- Make effects feel physical and pixel-native. Prefer step timing, hard edges, tabular score counters, and deliberate jitter.
- Preserve functional clarity. Imports, playback, queue, settings, mini-player, and tuning controls must remain easy to use.
- Respect motion settings. Reduced motion and `data-motion="off"` should silence nonessential animation.

## Fast Links

- Implementation map: `docs/themes/cartridge-quest/implementation-map.md`
- Refinement log: `docs/themes/cartridge-quest/refinement-log.md`
- Hotbar design system: `docs/themes/cartridge-quest/hotbar-design-system.md`

## Editing Checklist

1. Read the architecture overview and theme docs indexed in `docs/README.md`.
2. Check `src/themes/built-in-themes.json` and `src/themes/cartridge-quest.theme.json` before changing registration, assets, fonts, or theme metadata.
3. For visual/layout edits, inspect `src/cartridge-quest.css` and the matching mini file, `src/mini-cartridge-quest.css`.
4. For XP, payout, theme transitions, copy swaps, or playback state, inspect `src/renderer.js`.
5. For mini-player sync, inspect `src/mini-player.html`, `src/mini-player.js`, and `src/mini-signal-orbit.css`.
6. Check performance and reduced-motion overrides before declaring any animation visible.
7. Validate with the active app if the change affects animation placement. CSS-only animation can look correct in isolation and still disappear in Pixelody's actual layout.

## Known Risk Areas

- Footer/player ratio and minimum-width drift from `hotbar-design-system.md`.
- Global animation suppressors in `src/playback-performance.css`.
- Reduced motion, `data-motion="off"`, and performance conserve mode.
- CSS cascade order between theme CSS, playback performance CSS, and mini signal CSS.
- XP state persistence under `localStorage` key `pixelody.cartridgeQuestStats`.
- Mini-player reward sync via `rewardSerial`.
- Theme copy changes in `applyThemeCopy()` that make the same DOM read as a console/RPG UI.
