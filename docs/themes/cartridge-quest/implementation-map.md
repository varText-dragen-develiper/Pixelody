# Cartridge Quest source references

The paths below record the older implementation. Current selectable Cartridge Quest uses `src/theme-runtime/canvas-theme-ports.js`; follow `docs/themes/THEME_SYSTEM.md` before applying an old stylesheet change.

## Registration

- `src/themes/built-in-themes.json`
  - Runtime key: `cartridge-quest`
  - Palette key: `cartridge-quest`
  - Main styles: `../cartridge-quest.css`
  - Mini styles: `../mini-cartridge-quest.css`
- `src/themes/cartridge-quest.theme.json`
  - Theme id: `pixelody.cartridge-quest`
  - Motion profile: `mechanical`
  - Intensity: `responsive`
  - Font: `../assets/fonts/GeistPixel-Circle.woff2`
  - Hero overlay: `../assets/themes/cartridge-quest/snes-workbench.png`
  - Panel frame: `../assets/themes/cartridge-quest/console-rack.svg`

## Assets

All bundled Cartridge Quest art lives in `src/assets/themes/cartridge-quest/`.

- `snes-workbench.png`: hero/systems screen background and preview screen.
- `music-cartridge.png`: playlist thumb, playlist cover fallback, track art fallback, drop-zone visual, action mark.
- `pixel-landscape.svg`: retired original hero/systems screen background.
- `music-cartridge.svg`: retired original cartridge fallback.
- `console-rack.svg`: registered panel frame asset.
- `controller-panel.svg`: controller/deck visual asset available for refinement.

Keep asset rights recorded. Reference material isn't permission to bundle it.

## Layout source

`src/cartridge-quest.css` owns the visual language:

- Body shell: CRT grid, scanline overlay, palette variables, Quest Pixel font.
- Topbar: console chrome, search, profile button, settings trigger.
- Library rail: cartridge rack, playlist cartridges, import buttons.
- Main stage: screen bezel, contained hero artwork, title-screen hero, cartridge cover.
- Track table: RPG-style menu rows and active-track cursor.
- Drop zone: "insert cartridge" import surface.
- Inspector: player stats, power-ups, EQ/status panels.
- Systems view: console setup screen/service bay.
- Player/footer: controller deck, playback buttons, timeline, `.quest-stats`.
- Settings and drawers: theme action overlays and stage wipe.

## Animation references

Primary theme animations live in `src/cartridge-quest.css`:

- Ambient/playback: `quest-screen-pulse`, `quest-blink`, `quest-cursor`, `quest-meter`, `quest-visible-signal`, `quest-row-signal`.
- Interaction feedback: `quest-impact-shake`, `quest-pixel-pop`.
- Score cabinet feedback: `quest-score-led`, `quest-jackpot-cabinet`, `quest-score-roll`, `quest-payout-lights`, `quest-score-halo`.
- Legacy/CSS payout classes: `.quest-score-floatup`, `.quest-score-milestone`, `quest-score-floatup`, `quest-score-milestone-float`.
- Theme action feedback: `quest-message`, `quest-wipe`.

Global signal orbit overrides live in `src/playback-performance.css`:

- Cartridge Quest signal colors/radius/speed.
- Orbit animations: `signal-quest-gate-snap`, `signal-quest-block-run`, `signal-quest-pixel-warp`.
- Performance conserve exception for visible score floatups.

Mini-player equivalents live in:

- `src/mini-cartridge-quest.css`
- `src/mini-signal-orbit.css`

## Listening counters

`src/renderer.js` owns the score mechanic.

- State key: `pixelody.cartridgeQuestStats`
- Award cadence: `QUEST_XP_SECONDS = 6`
- Award amount: `QUEST_XP_PER_AWARD = 1`
- XP increments only during actual playback.
- Streak/high counters are time-based.
- Manual track switches reset the run; natural advance preserves it.
- Player state broadcast includes `questStatsSnapshot()` so the mini-player can mirror counters.

Important functions:

- `persistQuestStats()`
- `questStatsSnapshot()`
- `updateQuestStatsUi()`
- `spawnQuestRewardFloat()`
- `triggerQuestReward()`
- `resetQuestStreak()`
- `tickQuestStats()`
- `startQuestStatsTicker()`
- `stopQuestStatsTicker()`

### Showing a payout

Payouts use `requestAnimationFrame`, anchored to `#questXpCounter`, to pop and fade for about three seconds. Earlier CSS-only attempts could disappear under stacking, layout and performance/motion overrides. Refine the live anchored path rather than adding another hidden keyframe effect.

## Mini-Player

- DOM: `src/mini-player.html`
  - `#miniQuestXp`
  - `#miniQuestRun`
  - `#miniQuestHi`
- Runtime: `src/mini-player.js`
  - Receives `state.questStats`.
  - Updates XP/RUN/HI labels.
  - Uses `rewardSerial` to trigger mini reward animation once per payout.
- Styling: `src/mini-cartridge-quest.css`
  - Mini shell/chassis.
  - Mini stats.
  - `#miniQuestXp.mini-quest-rewarding`.

## Labels and transitions

`src/renderer.js` makes Cartridge Quest read as its own world:

- Palette entry: `themePalettes['cartridge-quest']`.
- Copy swaps in `applyThemeCopy()`: Cartridge Rack, Insert music cartridge, Player stats, Power-ups, Console setup, 8-bit/16-bit/Arcade detail labels.
- Transition profile: `themeTransitionProfiles['cartridge-quest']`.
- Always-on action overlay: `alwaysOnThemeActionThemes`.
- Interface sound profile: `src/ui-sounds.js`.
- Prewarm behavior: `src/theme-prewarm.js`.
- Load screen: `src/theme-prep.css`.

## Background Fit

Cartridge Quest uses `background-size: contain` on `.playlist-hero` and `.systems-view`. User-selected collection backgrounds are injected by `renderer.js` as an inline `background-image`, so this theme CSS still controls sizing. Keep the contain-first behavior unless the user specifically asks for cinematic cropping; the theme should show most of the selected art instead of zooming into one corner.

## Motion settings to check

Always check these before declaring an effect broken:

- `prefers-reduced-motion: reduce`
- `body[data-theme="cartridge-quest"][data-motion="off"]`
- `body[data-theme="cartridge-quest"][data-performance="conserve"]`
- `body[data-glow="false"]` for mini glow/signal effects

Reduced motion should remove nonessential movement. Score notifications can be suppressed there; the XP counter still updates.
