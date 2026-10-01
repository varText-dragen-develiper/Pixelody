# Cartridge Quest Implementation Map

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

No commercial artwork should be bundled. Keep any inspiration external or recreate it as original art.

## Layout Zones

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

## Animation Systems

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

## XP And Score Runtime

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

### Current Visible Payout Strategy

The visible payout is intentionally driven by JavaScript `requestAnimationFrame`, not just CSS keyframes.

Reason: prior CSS-only attempts were not consistently visible in the live app due to stacking, layout, performance, and motion overrides. The working path anchors to `#questXpCounter`, creates floating payout elements near the actual XP counter, and manually animates pop, squash, waft, and fade over about three seconds.

The implementation creates a reliable visible layer and keeps a cell-local path for context. This is the path to refine first when the user asks for flashier score text.

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

## Theme Copy And Transitions

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

## Motion Constraints

Always check these before declaring an effect broken:

- `prefers-reduced-motion: reduce`
- `body[data-theme="cartridge-quest"][data-motion="off"]`
- `body[data-theme="cartridge-quest"][data-performance="conserve"]`
- `body[data-glow="false"]` for mini glow/signal effects

Reduced motion should remove nonessential movement. Score notifications can be suppressed there; the XP counter still updates.
