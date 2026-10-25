# Source scaffold

Only endpoint constants are present. There is no adapter/miniport implementation, registration code, vcxproj, solution or build target. PixelodyVirtualAudio.contract.h deliberately emits #error for a build opt-in so the scaffold can't accidentally become a driver. A reviewed VM packaging milestone must precede any buildable implementation. The intended binary is PixelodyVirtualAudio.sys; it doesn't exist here.
