# Multi-Output Speaker Systems Plan

Pixelody should support user-defined speaker systems where one track can play through more than one Windows output at the same time, with each output having its own gain, EQ, latency offset, stereo image, and calibration record.

## Target User Story

A user wants music playing through:

- Laptop or desktop speakers.
- Headphones.
- Nearfield speakers beside monitors.
- A second stereo/tower-speaker setup.
- Future trusted local devices, if J.A.M. evolves into synchronized local playback.

Each system should be independently tuned, then grouped into a named playback rig such as `Desk + Headphones`, `Monitor speakers + Towers`, or `Room Fill`.

## Honest Constraints

Chromium/Electron normally routes one media element to one sink with `setSinkId()`. Playing to multiple output devices at the same time requires one of these approaches:

1. **Browser multi-sink fan-out**
   - Duplicate playback elements or audio paths per output sink.
   - Apply per-output Web Audio EQ, gain, delay, mute, and balance.
   - Continuously correct drift between duplicate media clocks.
   - Useful as the first prototype because it stays inside Electron.
   - Risk: sync drift, doubled decode work, and inconsistent sink support.

2. **Native WASAPI multi-endpoint mixer**
   - Native helper owns the multi-output render path.
   - Can use WASAPI endpoint facts, resampling, latency offsets, and tighter clock coordination.
   - Best long-term quality path.
   - Must stay optional, signed, non-invasive, and no driver/service/registry changes.

3. **Windows virtual audio device**
   - Out of scope for Pixelody release goals.
   - Too invasive because it usually means a driver or third-party virtual cable.

Pixelody should start with option 1 as a guarded experimental foundation, while designing the data model so option 2 can replace the engine later.

## Relationship To System Tuning Mode

Multi-output speaker systems and Windows-wide System Tuning Mode share the same long-term native backbone, but they are different user promises.

- Multi-output playback means Pixelody plays one track through more than one output at the same time.
- System Tuning Mode means Pixelody applies tuning to audio from other Windows apps when a supported shared-mode route is active.

The same output profiles, latency reports, microphone calibration records, and per-output EQ can serve both features. The UI still needs to label them separately so users know whether they are tuning Pixelody playback, outside-app playback, or a grouped speaker system.

## Data Model

### Output Profile

Already exists today:

- Output device id / label.
- System EQ.
- Advanced parametric EQ.
- Stereo image.
- Headphone/DAC library profile.
- Calibration metadata.
- Latency measurements.

### Speaker System

New layer to add:

```json
{
  "id": "speaker-system-...",
  "name": "Desk speakers + Towers",
  "enabled": true,
  "mode": "multi-output",
  "outputs": [
    {
      "deviceId": "default",
      "label": "Nearfield speakers",
      "role": "main",
      "enabled": true,
      "gainDb": 0,
      "delayMs": 0,
      "polarity": "normal",
      "eqMode": "advanced",
      "systemProfileId": "default"
    },
    {
      "deviceId": "device-id-2",
      "label": "Tower speakers",
      "role": "room-fill",
      "enabled": true,
      "gainDb": -3,
      "delayMs": 14,
      "polarity": "normal",
      "eqMode": "advanced",
      "systemProfileId": "device-id-2"
    }
  ],
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

## Per-Output Controls

Each output inside a speaker system needs:

- Enable / mute / solo.
- Volume trim in dB.
- Delay offset in milliseconds.
- Polarity flip for phase checks.
- Simple and advanced EQ.
- Balance and mono-sum.
- Latency measurement assignment.
- Speaker test tone routing.
- Optional role label: `main`, `sub`, `headphones`, `nearfield`, `tower`, `room-fill`, `monitor`, `other`.

## User's Two-Stereo-Setup Case

The requested setup can be represented as:

- Output A: desk speakers beside monitor, with bass/tweeter physical system.
- Output B: stereo tower/all-in-one speakers.

If Windows exposes these as two separate output devices, Pixelody can tune them independently and play to both in a grouped speaker system.

If both are connected behind one analog output or one receiver input, Pixelody can only tune the combined output unless the hardware exposes separate channels or endpoints. Pixelody should state this honestly in the UI.

## Calibration Flow

The existing latency profiler and microphone calibration should become multi-output aware:

1. Select a speaker system.
2. Mute all outputs except one.
3. Run software latency profiler.
4. Run mic acoustic calibration.
5. Store measured latency for that output.
6. Repeat for each output.
7. Suggest delay offsets so arrivals align at the listening position.
8. Let user manually fine-tune by ear.

## Implementation Checklist

- [x] Add persisted `pixelody.speakerSystems` data model.
- [x] Add speaker-system selector in Audio Systems.
- [x] Add create/rename/delete speaker system controls.
- [x] Add output members list with add/remove/reorder.
- [x] Reuse existing per-output tuning profiles for each member.
- [x] Add per-member trim, mute, solo, and delay controls.
- [x] Add per-member calibration assignment from latency/mic reports.
- [x] Add browser multi-sink prototype with duplicate hidden audio elements.
- [x] Add drift monitor comparing primary and secondary media clocks.
- [x] Add automatic correction for large drift and visible warning for unstable routes.
- [x] Add grouped diagnostics snapshot.
- [ ] Add physical test matrix for two stereo setups, headphones + speakers, Bluetooth + wired, HDMI + USB DAC, and unplug/replug behavior.
- [ ] Decide whether native WASAPI mixer is required before release.

## Release Gate

This feature must not be called release-ready until:

- Two physical outputs can play the same track without obvious drift for at least 30 minutes.
- Per-output EQ and gain are audibly and diagnostically independent.
- Latency offsets persist and survive app restart.
- Unavailable outputs fail closed without stopping normal single-output playback.
- Bluetooth routes show warning labels when sync confidence is low.
- Mini-player and media-key controls still control one shared playback state.
