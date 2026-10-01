# Cartridge Quest Mini-Player Design System

## Window Contract

- Default size: `500 x 200` (`5:2`), large enough to show the complete player without resizing.
- Resize range: `340-820px` wide and `148-460px` tall.
- The outer window edge owns native resizing.
- The top 24px hardware strip owns window dragging, excluding the restore/close bay.
- Artwork, metadata, progress, stats, and transport are always `no-drag` content.

## Placement Ratio

At the default size, the usable row is divided into three bays:

| Bay | Width | Responsibility |
| --- | --- | --- |
| Cartridge | 86px | Active artwork, cartridge label, and playback signal |
| Save label | Flexible, 170px minimum | Quality, title, artist, progress, time, all four Quest stats |
| Transport | 118px | Previous, play/pause, next in a dedicated hardware deck |

The transport bay is fixed because its controls must never shrink beneath their hit targets. Metadata absorbs width changes first.

## Responsive Priority

1. Previous, play/pause, next, restore, and close always remain interactive.
2. Title and progress remain visible at every supported size.
3. Artist and all four Quest stats appear when height permits.
4. Under 430px wide, stats reflow to two columns before transport or title compresses.
5. Under 170px tall, artist and Quest stats yield before progress or controls.
6. Expanded widths restore four stats in one row and increase artwork without enlarging transport excessively.

## Theme Rules

- Decorative glow, signal layers, LEDs, and corner marks must remain absolutely positioned and cannot become grid items.
- Only `.mini-drag-strip` may use `-webkit-app-region: drag`.
- Every button and control bay explicitly uses `no-drag` and `pointer-events: auto`.
- Corner marks communicate resizing but remain pointer-transparent so Electron receives native edge input.
- Reduced motion and performance-conserve behavior remain unchanged.
