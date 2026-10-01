#pragma once

// Design contract only. This file is not a WDK driver implementation.
#define PIXELODY_VIRTUAL_AUDIO_DRIVER_BINARY "PixelodyVirtualAudio.sys"
#define PIXELODY_VIRTUAL_AUDIO_RENDER_ENDPOINT "Pixelody Virtual Output"
#define PIXELODY_VIRTUAL_AUDIO_CAPTURE_ENDPOINT "Pixelody Virtual Monitor"
#define PIXELODY_VIRTUAL_AUDIO_CHANNELS 2
#define PIXELODY_VIRTUAL_AUDIO_SAMPLE_RATE_HZ 48000

#if defined(PIXELODY_ENABLE_DRIVER_BUILD)
#error PixelodyVirtualAudio has no build target yet. Use the VM-only WDK validation milestone.
#endif
