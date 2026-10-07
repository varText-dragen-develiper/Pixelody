# Pixelody minimum specs (measured 2026-10-05)

## Paste-ready table (download page)

| | Minimum | Recommended |
| --- | --- | --- |
| OS | Windows 10 64-bit (x64) | Windows 11 64-bit |
| CPU | 2 cores, about 2 GHz (Intel Celeron N4000 class or better) | 4+ cores, any modern Ryzen 3 / Core i3 or better |
| RAM | 4 GB | 8 GB or more |
| Graphics | Any (no dedicated GPU needed) | Integrated or dedicated GPU with current driver |
| Disk | About 600 MB for the app, SSD not required | SSD, plus space for your music |
| Library size | Up to a few thousand tracks smoothly | 10,000+ tracks |
| Android | Android 8.0 (API 26) or newer | Android 10 or newer |

## What was measured

Electron 43.4.1 (the shipped runtime), Studio (the only built-in theme), in a Linux container with software rendering (GPU off, so a worst case for graphics). Generated libraries of 500, 2,000 and 10,000 tracks, with real playback through the Web Audio EQ graph (output muted). CPU limited with taskset; slower CPUs emulated with Chromium's CPU throttle (2.5x and 4x slower renderer). RAM was measured, not capped.

| Setup | Startup to ready | Frame rate idle / playing | Fast scroll p95 frame | RAM (PSS, all processes) |
| --- | --- | --- | --- | --- |
| 4 cores, 10k tracks, full speed | 1.4 s | 60 / 60 | 50 ms | 570-620 MB |
| 2 cores, 2k tracks, 4x slower | 1.9 s | 60 / 60 | 200 ms | 475-570 MB |
| 2 cores, 10k tracks, 4x slower | 2.0 s | 60 / 60 | 150 ms | 520-620 MB |
| 1 core, 2k tracks, 2.5x slower | 3.6 s | 60 / 60 | 370 ms | 475-550 MB |
| 1 core, 500 tracks, 4x slower | 7.0 s | 60 / 60 | 530 ms | 455-500 MB |
| 1 core, 10k tracks, 4x slower | 5.7 s | 33 idle / 54 playing | 650 ms | 500-660 MB |

- Playback with the EQ graph on stayed at 60 fps and used 10-20% of one full-speed core; the audio path never stuttered even on one throttled core (worst single frame 217 ms at 1 core, 4x slower, 10k tracks).
- The Canvas profile (the heavier foreground stage layout) cost the same as Studio at 500 and 2,000 tracks.
- Weak spot: dragging the scrollbar or very fast scrolling a long list on one slow core. Rows are already virtualized (about 90 in the DOM), so this is software-rendering paint cost; a real GPU removes most of it.

## Not covered

- Real Windows, a real GPU, real audio output and the other Canvas themes (only Studio plus the Canvas foreground profile were run).
- A hard RAM cap (no cgroups in the container). 4 GB is the minimum because the app uses about 0.5-0.7 GB and Windows 10 itself needs 2-3 GB.
- Android was code-read only: minSdk 26, targetSdk 35; artwork already uses an LRU cache with RGB_565 and sampled decoding. No device run.

## Measured on hosted CI runners (2026-10-05)

First `Spec budget` run, 2,000 tracks, software graphics, playback through the EQ graph:

| Runner | CPUs / RAM | Startup | Idle / playing fps | Fast scroll p95 | Memory (all processes) |
| --- | --- | --- | --- | --- | --- |
| Windows (x64) | 2 / 8 GB | 10.3 s | 64 / 64 | 172 ms | 805 MB (resident set) |
| macOS (Apple Silicon) | 5 / 14 GB | 4.1 s | 48 / 60 | 66 ms | 839 MB (resident set) |

The Windows runner is a real 2-core, 8 GB Windows machine, so the 2-core minimum holds on Windows itself. Resident set counts shared pages once per process, so it reads higher than the PSS figures above.

## Keeping it honest

`scripts/check-spec-budget.js` launches the app with a 2,000-track library, plays through the EQ graph and fails if startup, memory or playback break the budget. The `Spec budget` workflow runs it on Windows, macOS and Linux runners and writes the numbers to the run summary. Frame rate and scroll are reported but not enforced, because hosted runners use software graphics.
