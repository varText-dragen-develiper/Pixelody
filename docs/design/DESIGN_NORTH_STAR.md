# Designing Pixelody

I want the music and album art to have room, the library to feel organized, and the sound controls to be there when someone wants them. Themes can change how the player works spatially, but finding and using it should still make sense.

## What needs to work

The current track, artwork, playback state, browsing and audio controls come before decoration. Advanced tools need grouping, spacing and a clear way back. Keep edits, playlists, tuning, backgrounds and profiles local unless a feature explicitly says otherwise. Source format and engine/output behavior need separate labels: a lossless file doesn't establish bit-perfect Windows output.

Check alignment at normal use and close up. Icons need centered hit targets, corners should match, and a state change should look deliberate. The main player and mini-player need to agree about what's happening.

## Making room for different themes

Library access, collection identity, browsing, now playing, queue, search, settings, inspection and transport are required functions. They don't have to occupy the same rectangles in every theme. A layout can move, combine, split or layer them if focus, navigation history, responsive behavior and recovery remain sound.

Use a small number of surface levels. Readable sans faces suit primary controls; pixel, mono, condensed or display type can give identity and metadata their own character. Palette roles still need contrast: base, surfaces, accents, text, muted text, lines and state. Textures such as paper, glass, stars, scanlines and grids belong to the theme that needs them, rather than becoming a layer over every theme. Personal artwork and playlist backgrounds must stay legible.

Hover can lift or brighten a control without moving the layout around. Press and selection need a visible response, with more than color where practical. Drawers may move differently between themes, but X, Escape and back history should remain predictable. Motion off disables transitions and animation while leaving labels, focus and controls usable.

Themes can change typography, licensed fonts, proportions, framing, textures, original/licensed art, interaction mechanics, mini-player layout and the overall order of information. They can't change what a control or saved value means, hide essential functions, break icon alignment, or require motion to explain the state.

## Looking at the result

At a glance, can someone find play, the current track, library, search, settings and info? During use, is text readable and feedback predictable? Up close, are edges, icons, spacing and overlaps right?

A reference-based theme should contribute something to ordinary use beyond a reskin or slight rearrangement. The difference needs to work in the app. An unusual animation or a complicated implementation doesn't establish that by itself.
