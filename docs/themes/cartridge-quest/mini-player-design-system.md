# Cartridge Quest mini-player

The default window is 500×200 (5:2), with a 340–820px width and 148–460px height range. Native resizing belongs to the outer edge. Only the top 24px hardware strip drags the window; exclude restore/close, and keep artwork, metadata, progress, stats and transport no-drag.

| Bay | Width | Responsibility |
| --- | --- | --- |

Transport stays fixed so its targets don't shrink; metadata absorbs width changes. Play/previous/next, restore and close remain interactive, with title and progress visible at every supported size. Below 430px, stats reflow to two columns. Below 170px height, artist and stats yield before progress/controls. More width restores four stats and larger artwork without oversized transport.

Glow, signals, lamps and corner marks are absolute decoration, never new grid items or hit areas. Controls explicitly keep no-drag and pointer-events:auto; corner marks remain transparent to native edge resizing. Preserve reduced-motion and conserve behavior.
