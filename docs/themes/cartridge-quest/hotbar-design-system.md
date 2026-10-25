# Cartridge Quest control deck

The footer has three bays: track identity, playback and output. The Quest cabinet shares identity's space; it mustn't compete with transport or make the footer grow. Play/skip and seek come first, then identity, output controls and quest detail.

| Bay | Ratio | Owns | Must not own |
| --- | ---: | --- | --- |

At full width the ratio is 27/46/27. Playback needs at least 440px, identity 260px and output 300px for its hardware modules. Medium widths use 25/50/25. Below 930px, the compact policy removes footer output and uses 38/62; below 560px only playback stays in the footer.

The normal deck is 128px tall. Identity sits above the Quest cabinet; playback and output span both rows. Reserve that full height in the workspace rather than clipping it into place.

## Stable cabinets

Hover/focus may reveal information inside a fixed footprint. CART LABEL opens upward for full metadata/special-track state without resizing the deck or covering neighbors. Underlays must contain borders, focus and static shadows with at least 3px clearance. The transport plate is 64px border-box, with a 58px socket around the 48px Play control and its 3px shadow. The timeline surrounds elapsed time, rail and duration together.

XP, RUN, HI and COMBO occupy four equal cells. Focus/hover replaces that readout with the stat explanation in the same bounds. QUEST reveals LOG, GAIN, TIER and CUE; clicking keeps that recap until focus leaves. POWER, READ and LINK remain compact LEDs with full meanings in titles/recap. Payouts use fixed positioning anchored to the actual XP counter, avoiding cabinet clipping.

Transport, seek, cabinet and output need separate grid areas and hit targets. Decorative underlays use pointer-events:none and sit behind controls. The center order remains SHUFFLE / PREVIOUS / PLAY / NEXT / REPEAT, with the timeline directly below. Hover mustn't move another target under the pointer.

Reduced/off motion removes transitions while retaining each information state. Further additions should consolidate an existing readout. A fourth bay or another vertical lane needs a new layout decision and evidence that the playback sequence remains clear.
