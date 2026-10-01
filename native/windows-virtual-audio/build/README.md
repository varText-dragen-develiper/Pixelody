# VM-Only Build Gate

There is no WDK project, solution, build script, or package generation command
in this scaffold. Do not attempt to build it on a normal user machine.

The first WDK build validation is a future milestone and must occur only inside
the isolated VM prepared by
`../../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md`. Before that work begins,
take a snapshot and confirm the VM-only test-signing and recovery boundaries in
that document. This repository does not enable test signing, alter boot settings,
stage a package, or install a driver.
