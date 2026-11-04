# The Pixelody mark

The shipped mark is Sampled Disc (A), with the W1 wordmark and Ultraviolet brand color. It appears on desktop builds/windows/taskbar and Android launcher/splash, including adaptive and themed-icon layers.

![Pixelody logo sheet](pixelody-logo-sheet.png)

A stepped sine wave cuts through the disc. The cut is actual negative space, so it works over different backgrounds. Both halves match after a 180° rotation. Generate the geometry rather than editing individual paths.

## Geometry and color

| Part | Geometry |
| --- | --- |

| Disc | circle centred `12,12`, r 8 |
| Wave | one sine cycle over x 4→20, sampled at 12 points (`sin(2π(i+½)/12)`), amplitude 4.5, heights snapped to 0.5 units, entering and leaving at y 12 |

Only the mark carries brand color; the wordmark stays neutral. Don't add gradients, pair the purple with pink, rotate the mark, outline it or fill the wave cut. Leave one-quarter disc diameter clear on every side. Use the coarse small icon at 24px and below, and keep a lockup at least 20px high.

The lowercase wordmark uses outlined Space Grotesk Bold, weight 700, tracking −20/1000. In the lockup, the disc is 1.56 times cap height, centered on it with a 0.42-cap-height gap. The bundled OFL font record is in [the asset notice](../../THIRD_PARTY_ASSETS.md).

## Logo color controls

| Cut | wave stroked 1.25 wide with square joins and subtracted from the disc; slivers under 2 square units are dropped |
| Small cut (16–24 px) | 8 samples, cut 1.7 wide, so the steps survive tiny sizes |

Desktop Settings → Style → Logo color changes the in-app mark and running icon. Studio uses the saved purple; another theme can use its accent unless recoloring is disabled. An explicit color applies/saves immediately; a later explicit theme selection can resume theme following, and returning to Studio restores the saved purple.

On Android, Settings & Themes → Logo color follows the effective theme/palette by default. Six authored themes and nine presets have generated launcher colors. Arbitrary colors use the nearest baked shade for the launcher and exact color in-app. Studio's Home image supplies a stable Custom accent; changing pages doesn't change the alias. An explicit purple overrides following, and enabling following retains that manual choice. Older manual preferences stay manual. One of twenty aliases is enabled without stopping playback; wallpaper themes/icon packs may still alter the visible launcher icon.

## Windows icon updates

On Windows, Electron updates the main and mini window icons and supplies their taskbar relaunch details through `setAppDetails`. Per-color ICO files wrap the generated mark's PNG pixels under the profile's `brand-icons` directory. The executable and installer keep their baked icon.

Matching shortcuts are updated through Electron's `readShortcutLink` and `writeShortcutLink`. The target, app ID and arguments must match this installation. Separate profiles require the exact profile argument and use a stable profile-derived taskbar ID, so a preview doesn't modify the owner's links. Originals are backed up once under `brand-icons/shortcut-backups`; launch targets and arguments are preserved.

Window color transitions use `setIcon` for 66 eased frames over about 1.1 seconds, followed by the exact final icon and relaunch details. Startup, unchanged colors, reduced motion and disabled reactions use the immediate path. Animation failure falls back to the final icon. Superseded changes stop, and failed publication can be retried.

Icon updates no longer launch PowerShell or compile C# at runtime. They don't change pinning policy, remove taskbar groups or force a global Shell cache refresh. Windows can cache the grouped taskbar, pinned, Start or Search icon, so those surfaces may retain an earlier color until the Shell refreshes them. Window animation is retained; grouped taskbar animation isn't guaranteed.

## Regenerating assets

Use `tools/brand/generate_brand_assets.py` (shapely/fonttools), then `tools/brand/render_brand_pngs.js`. A color change must agree across LOGO_COLORS, `src/brand-mark.js`, generated `tools/brand/logo-colors.json`, Android `PixelodyLogoColor.kt`, Settings swatches and manifest aliases. Run the generators and `npm run check`. Windows `scripts/create-release-icon.ps1` can rebuild the 512px package input from the SVG.

| Role | Value | Notes |
| --- | --- | --- |

Generated copies also live in `build/icon.*`, `src/assets/brand/` and Android resources. Android automatic accents use `python tools/brand/generate_brand_assets.py --android-theme-icons-only`; ANDROID_THEME_COLORS, ThemeLauncherIcon and aliases must agree without changing geometry. Desktop's manual five-color list is independent.
