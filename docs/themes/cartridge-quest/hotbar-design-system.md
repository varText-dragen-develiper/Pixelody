# Cartridge Quest Hotbar Design System

## Vision

The hotbar is the console control deck, not a shelf for every theme feature. It should feel like three hardware bays mounted in one chassis: identify the cartridge, control playback, and manage output. Quest information lives in a compact status cabinet attached to identity rather than competing with transport controls.

The visual priority is always:

1. Play/pause and previous/next.
2. Track progress and seek.
3. Current track identity.
4. Volume, queue, and output state.
5. Quest stats and decorative system feedback.

## Desktop Ratio

The full-width hotbar uses a `27 / 46 / 27` division:

| Bay | Ratio | Owns | Must not own |
| --- | ---: | --- | --- |
| Identity | 27% | Cover, track name, artist/format, rare cue, Quest cabinet | Playback or output controls |
| Playback | 46% | Shuffle, previous, play, next, repeat, timeline, seek | Quest recap, queue, or volume |
| Output | 27% | Mini player, queue, volume, quality, route | Track identity or score stats |

The playback bay is wider because it contains the primary action sequence and the only continuously adjustable horizontal control. Its minimum width is 440px. Identity has a 260px minimum; output has a 300px minimum because its four hardware modules require more fixed width than its ratio suggests.

At medium widths, the ratio becomes `25 / 50 / 25`, giving the playback deck more protection. Below 930px, output is removed from the footer under the existing compact-layout policy and the remaining space becomes `38 / 62`. Below 560px, only the playback deck remains in the footer.

## Vertical Ownership

The player is 128px tall on normal desktop layouts. Identity uses the upper-left row and the Quest cabinet uses the lower-left row. Playback and output each span both rows. This keeps the center controls vertically centered and prevents the score system from increasing the footer height.

The application workspace height must reserve the full footer height. Hotbar modules must never depend on clipping, negative margins, or overflow hidden to appear organized.

## Cabinet Rules

- A cabinet has one stable footprint. Hover and focus may replace content inside it but must not resize adjacent controls.
- The current-track `CART LABEL` is the identity bay's disclosure surface. It stays compact at rest and opens upward on hover or keyboard focus to reveal the full track metadata and special-track status without resizing the footer or covering neighboring hotbar controls.
- Every underlay must fully contain the visual bounds of the controls it groups, including borders, focus rings, and static shadows. It must provide at least 3px of visible clearance around the largest control.
- The transport plate is a 64px border-box surface. Its recessed socket is 58px tall, which contains the 48px Play control and its 3px static shadow with at least 3px of remaining vertical clearance.
- The timeline chassis surrounds the elapsed time, boss bar, and duration as one complete unit. It must never frame only the seek rail while leaving the time cells visually detached.
- Overlays must either communicate state, reveal contextual information, or reinforce a real interaction boundary. Purely redundant overlays should be removed instead of accumulated.
- The Quest cabinet shows XP, RUN, HI, and COMBO as four equal cells.
- Hovering or focusing a stat replaces the four-cell readout with that stat's contextual explanation inside the same bounds.
- The `QUEST` cabinet handle reveals LOG, GAIN, TIER, and CUE inside the same bounds. Clicking leaves the handle focused, which keeps the recap visible until focus moves away.
- POWER, READ, and LINK remain compact LEDs. Their full meaning is available through control titles and the recap context rather than expanding the layout.
- Dynamic score payouts remain fixed-position effects anchored to the real XP counter so cabinet overflow cannot clip them.

## Interaction Separation

Interactive regions may share a chassis but not a hit area. The transport button cluster, seek bar, Quest cabinet, and output module each have their own grid area and gap. Hover feedback must never move another control under the pointer. Decorative overlays use `pointer-events: none`.

Underlays do not create hit areas. Their pseudo-elements remain non-interactive and sit behind the controls they visually group.

The center control order is fixed: `SHUFFLE / PREVIOUS / PLAY / NEXT / REPEAT`, with play receiving the largest target. The progress bar is always directly below that sequence and never moves into a score or output cabinet.

## Motion And Density

Normal hover feedback may brighten, inset, or swap a cabinet readout. It may not expand the hotbar, shift columns, or overlap transport controls. Reduced motion and `data-motion="off"` remove cabinet transitions while preserving every information state.

Future hotbar additions must replace or consolidate an existing readout. They may not create a fourth desktop bay or add another vertical lane without revisiting this document and proving that the main playback sequence remains isolated.
