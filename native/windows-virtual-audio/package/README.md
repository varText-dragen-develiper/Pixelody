# Non-Installable Package Placeholders

This folder deliberately contains no valid `.inf`, `.cat`, or `.sys` file. The
files ending in `.placeholder` document future names only; Windows cannot stage
or install them. There is no installer, `pnputil` command, Driver Store action,
or default-device selection in this repository.

A future package may be created only after a disposable VM has passed the gates
in `../../../docs/audio/system-audio/WINDOWS_VIRTUAL_AUDIO_VM_WDK_SETUP.md`. That future work must
add its own reviewed install, uninstall, restart, endpoint-visibility, and
normal-audio recovery validation.
