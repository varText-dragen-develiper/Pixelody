# Windows Virtual Audio VM And WDK Setup

This runbook defines the only approved development environment for the first `PixelodyVirtualAudio.sys` experiments. It is a preparation and recovery document, not an installer guide for a normal Pixelody user.

Do not run the test-signing, Driver Store, install, uninstall, or reboot commands in this document on a daily-use workstation. Do not install a driver from Pixelody. Do not use this document as a release or public-support procedure.

## Scope And Decision

The first driver is a narrow, SysVAD-derived virtual audio endpoint with exactly these names:

- Render: `Pixelody Virtual Output`
- Capture: `Pixelody Virtual Monitor`
- Driver binary: `PixelodyVirtualAudio.sys`

It is a development-only component for a disposable VM or dedicated test computer. Pixelody Player Mode remains independent of it. The bridge's current two-endpoint lab is useful before this step, but it does not install or require a driver.

## Required Roles

Use two separate roles. They may be two VMs, or a physical development machine plus a VM target.

| Role | Allowed responsibilities | Must not do |
| --- | --- | --- |
| Build/signing machine | Source checkout, Visual Studio/WDK build, test certificate custody, package creation, signature verification. | Route normal daily audio through Pixelody, enable test-signing on a daily-use boot entry, or publish a package. |
| Test VM | Receive one immutable, test-signed package; enable test mode only for the VM; install, exercise, remove, and reboot. | Hold production certificates, personal media, credentials, or non-test Pixelody data. |

Prefer a fresh Windows VM generation that matches the intended x64 target. Use a local virtual disk, a standard virtual audio device, a non-production local account, and a private or disabled network unless a debugger needs connectivity. Do not pass through the host's daily audio hardware or personal library.

## VM Isolation And Snapshot Policy

Before any driver package reaches the VM:

1. Create `Clean OS` after Windows setup and updates.
2. Create `Tools Installed` after the debugging/tool prerequisites are verified.
3. Create `Pre Driver` immediately before the first test-signing or Driver Store action.
4. Record the VM Windows edition/build, architecture, VM platform/version, virtual audio endpoints, active default output ID/name, and a screenshot of Sound settings.
5. Confirm the VM can play ordinary shared-mode audio through its original output before proceeding.

Never merge or delete the `Pre Driver` snapshot until install, uninstall, reboot, and recovery checks all pass. Revert the snapshot rather than attempting repeated force-removal when a package leaves an unexpected endpoint or default-output state.

## Toolchain Prerequisites

Install these on the build/signing machine or on a dedicated build VM, not on the everyday Pixelody workstation:

- A supported Visual Studio edition with **Desktop development with C++**.
- The matching Windows SDK and Windows Driver Kit (WDK).
- The WDK Visual Studio component/VSIX.
- Debugging Tools for Windows / WinDbg, symbols configured only for kernel debugging when the driver phase begins.
- `MSBuild`, `Inf2Cat`, `SignTool`, and `PnPUtil` available from their supported kit/Windows locations.
- A test certificate and its private key held only by the development/signing role; the `.cer` public certificate is the only certificate material copied to the test VM.

Use a matching SDK/WDK build number. Microsoft currently recommends the latest released WDK with its compatible Visual Studio release; its WDK download guidance also describes the C++ workload, WDK component, EWDK alternative, and kit-version matching. [Download the WDK](https://learn.microsoft.com/en-us/windows-hardware/drivers/download-the-wdk) and [build a driver with the WDK](https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/building-a-driver) before choosing a version.

The WDK NuGet route is not the default for this first SysVAD-derived skeleton. It may be evaluated later for build reproducibility, but do not mix toolchain acquisition models in the same first-driver experiment.

## Test-Signing Boundary

Test-signing is for the test VM only. A test-signed package is never an end-user component and is never bundled with Pixelody.

Before enabling test mode in the VM:

- Verify `Pre Driver` exists and is restorable.
- Verify the VM is not a host, dual-boot, or shared daily-use image.
- Record whether Secure Boot, BitLocker/device encryption, and Memory Integrity/HVCI are enabled. Do not weaken those controls merely to make the prototype load; record the incompatibility and stop for a design decision.
- Verify the package has both a test-signed driver binary and the required signed catalog. Test mode does not turn an unsigned x64 kernel image into an acceptable test artifact.

Only inside the disposable VM, from an elevated prompt, the future test operator may use the Microsoft-documented test-signing workflow and then reboot. Microsoft warns that boot configuration changes can make a computer inoperable; the expected Test Mode watermark after reboot is evidence that this is a test-only environment. [Loading test-signed code](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/the-testsigning-boot-configuration-option) and [test-signing driver packages](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/test-signing-driver-packages) are the authority for that future action.

This runbook intentionally does not issue those commands. The assigned test operator must run them manually in the VM after reviewing the current Microsoft guidance and recording the snapshot name.

## Package Build And Signing Gate

When item 9 has a driver source scaffold, the build/signing role must produce a package directory containing only the intended architecture's:

```text
PixelodyVirtualAudio.sys
PixelodyVirtualAudio.inf
PixelodyVirtualAudio.cat
supporting package files required by the INF
SHA-256SUMS.txt
```

Before transfer to the VM:

1. Build the driver package in the WDK-supported Visual Studio/MSBuild environment.
2. Generate the catalog for the final package contents; do not alter any package file afterward.
3. Test-sign the driver and catalog with the VM-test certificate.
4. Verify both signatures with the kernel-policy option of the supported signing tool.
5. Create a SHA-256 manifest and copy the whole immutable package directory to the VM by a controlled channel.
6. On the VM, compare package hashes before any Driver Store action.

Never copy a private certificate key to the test VM. Never use a production certificate, a release-signing service, a public installer, or the Electron app for this phase.

## Pre-Install Checklist

All items must be true before staging a package:

- [ ] VM is booted from the `Pre Driver` snapshot or an equivalent clean checkpoint.
- [ ] Test Mode status and the test certificate state are recorded for the VM only.
- [ ] Package signatures and SHA-256 manifest are verified.
- [ ] Original default render endpoint ID/name is recorded.
- [ ] Original default output plays a short ordinary Windows test sound.
- [ ] Pixelody is closed; no Pixelody bridge process is running.
- [ ] The VM has no endpoint named `Pixelody Virtual Output` or `Pixelody Virtual Monitor` from a previous attempt.
- [ ] No Windows default device is changed automatically or manually by this procedure.
- [ ] A rollback action is selected: snapshot revert first, Driver Store uninstall second.

## Future VM-Only Driver Store Procedure

This section is a future test operator procedure, valid only after a test-signed INF exists. It does not authorize running it today.

1. Start a transcript that records commands, UTC timestamps, package hash, Windows build, and endpoint IDs. Do not record PCM or media metadata.
2. Enumerate the Driver Store before staging and retain the output in the VM test log.
3. Stage the package with the supported PnP utility, using the explicit package INF path.
4. Record the resulting published INF name (`oemNN.inf`) and package provider/class values.
5. Install only through the INF's intended root/PnP mechanism after its hardware IDs are reviewed. Do not invent a fallback device or switch the Windows default output.
6. Reboot whenever the package or device state requires it, then record the VM build and Test Mode state again.

`PnPUtil` is Windows' supported Driver Store management utility; Microsoft documents its add, enumerate, and delete-driver operations and current command examples. [PnPUtil reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pnputil) and [PnPUtil examples](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/pnputil-examples) are authoritative.

## Endpoint And Recovery Checks

After an install/reboot, the test operator must prove all of the following before routing any third-party app audio:

- `Pixelody Virtual Output` is visible and enabled as a render endpoint.
- `Pixelody Virtual Monitor` is visible and enabled as a capture endpoint.
- The existing physical/default output is still present and remains the Windows default unless the tester manually changes it for an isolated route experiment.
- Pixelody's helper and bridge diagnostics see endpoint IDs/names without reporting `loop-risk-blocked`.
- A non-Pixelody test app can target `Pixelody Virtual Output` only after the previous physical route is recorded.
- The bridge is configured with an explicit, distinct real output ID; rendering to either Pixelody virtual endpoint is blocked.
- Stopping the bridge leaves the operator able to restore the recorded physical output manually.

At this phase, the endpoint can exist without audible global EQ. Do not call the feature active until the bridge captures the paired monitor, processes data, renders it to a distinct real output, and reports current route proof.

## Post-Uninstall Checklist

Use the exact published INF recorded at staging time. Do not use `/force` as a routine recovery mechanism.

1. Stop/close the bridge and close Pixelody.
2. Manually restore the previously recorded physical output before removing the package if a test route was selected.
3. Remove the device/package through the VM-only test procedure, then remove the published INF from the Driver Store using the recorded `oemNN.inf` name and the supported uninstall option.
4. Reboot the VM.
5. Confirm both Pixelody virtual endpoints are gone or disabled exactly as expected.
6. Confirm the original physical/default output remains present, selected, and plays ordinary Windows audio.
7. Enumerate the Driver Store to confirm the published INF is gone.
8. If any step fails, stop experimentation, preserve non-audio logs, and revert `Pre Driver` rather than escalating to unrelated driver removal.

Microsoft documents that permanently removing a driver package requires removal from the Driver Store and cautions against deleting a package when no replacement supports the device. [Driver package uninstall guidance](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/using-device-manager-to-uninstall-devices-and-driver-packages)

## Diagnostics And Evidence

Keep only these artifacts:

- Build configuration, toolchain versions, package SHA-256 manifest, and signature-verification output.
- Driver Store published-INF identifier and install/uninstall command transcript.
- `setupapi.dev.log` excerpts relevant to the package, with user paths redacted when sharing.
- Endpoint IDs, friendly names, formats, period/buffer data, bridge counters, route state, and failure HRESULTs.
- VM snapshot names, Windows build, Test Mode state, reboot timestamps, and pass/fail checklist results.

Never collect or attach PCM buffers, loopback recordings, personal music paths, track metadata, album art, credentials, or private certificate keys. Support bundles must be counters and configuration facts only.

## Explicit Non-Goals

- No WDK installation, test-signing activation, boot configuration change, certificate installation, driver package staging, or driver installation is performed by Pixelody or this document.
- No driver source is imported by this setup phase.
- No public installer, release signing claim, attestation/HLK decision, APO, system effect, automatic default-device switching, or per-app EQ is introduced here.
- No test result on a VM is treated as a release-quality compatibility claim.

## Exit Gate For The Next Task

Item 9 may begin only when a developer can point to this runbook, a disposable VM snapshot policy, a chosen compatible WDK/SDK build pair, and the signed-package/recovery gates above. The first SysVAD-derived scaffold still has no installation path.
