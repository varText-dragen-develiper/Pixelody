# PixelodyVirtualAudio Source Boundary

This folder is a source-shape scaffold, not a driver implementation. It contains
only the endpoint constants that a future VM-only SysVAD-derived implementation
must honor. There is intentionally no `.vcxproj`, `.sln`, adapter source, miniport
source, registration code, or build target.

`PixelodyVirtualAudio.contract.h` contains `#error` when a build opt-in is
defined. That prevents this scaffold from accidentally becoming a driver build
without the explicit VM packaging milestone and review.

Expected future binary name: `PixelodyVirtualAudio.sys`. No such binary exists in
this repository.
