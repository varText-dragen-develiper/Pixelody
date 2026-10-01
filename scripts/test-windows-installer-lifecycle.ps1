[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PreviousInstaller,
  [Parameter(Mandatory=$true)][string]$CurrentInstaller,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
  [string]$ExpectedPublisherSubject = '',
  [switch]$CleanCurrent,
  [Parameter(Mandatory=$true)][switch]$ConfirmDisposableEnvironment
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmDisposableEnvironment -or $env:PIXELODY_DISPOSABLE_WINDOWS -ne '1') { throw 'Refusing installer mutation outside an explicitly marked disposable Windows environment.' }
$project = Split-Path -Parent $PSScriptRoot
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $project '.artifacts\windows-release\upgrade-fixture'))
$signedRoot = [IO.Path]::GetFullPath((Join-Path $project '.artifacts\windows-release\signed'))
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $project '.artifacts'))
$previous = [IO.Path]::GetFullPath($PreviousInstaller)
$current = [IO.Path]::GetFullPath($CurrentInstaller)
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
function Assert-Child([string]$Base, [string]$Target, [string]$Label) {
  $prefix = $Base.TrimEnd('\') + '\'
  if (-not $Target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "$Label is outside its owned root." }
}
Assert-Child $fixtureRoot $previous 'Previous installer'
if ($ExpectedPublisherSubject) { Assert-Child $signedRoot $current 'Signed current installer' }
else { Assert-Child $fixtureRoot $current 'Current installer' }
Assert-Child $artifactRoot $evidence 'Evidence directory'
if (-not (Test-Path -LiteralPath $previous -PathType Leaf) -or -not (Test-Path -LiteralPath $current -PathType Leaf)) { throw 'Both fixture installers must exist.' }
$fixture = Get-Content -LiteralPath (Join-Path $project 'release\upgrade-fixture.json') -Raw | ConvertFrom-Json
$identity = Get-Content -LiteralPath (Join-Path $project 'release\windows-identity.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
if ($package.version -cne $fixture.currentVersion) { throw 'Fixture current version must equal package.json.' }
foreach ($field in @('productName', 'executableName', 'userDataDirectoryName')) {
  if ([string]$identity.$field -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]*$') { throw 'Unsafe Windows identity path component.' }
}
$profile = [IO.Path]::GetFullPath((Join-Path $env:APPDATA $identity.userDataDirectoryName))
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$($identity.productName).lnk"
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$($identity.productName).lnk"
$executableFileName = "$($identity.executableName).exe"
$installDirectoryName = [string]$identity.installerDirectoryName
if ($installDirectoryName -notmatch '^[a-z0-9][a-z0-9._+-]*$') { throw 'Windows identity contains an invalid installer directory name.' }
$install = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA (Join-Path 'Programs' $installDirectoryName)))
if (Test-Path -LiteralPath $install) { throw 'Disposable environment is not clean: Pixelody install already exists.' }
if (Test-Path -LiteralPath $profile) { throw 'Disposable environment is not clean: Pixelody userData already exists.' }
$preexistingShortcuts = @($desktopShortcut, $startMenuShortcut) | Where-Object { Test-Path -LiteralPath $_ }
if ($preexistingShortcuts.Count -gt 0) { throw 'Disposable environment is not clean: a Pixelody shortcut already exists.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
function Assert-ManifestArtifact([string]$Path, [string]$Version, [bool]$Signed) {
  $manifest = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $Path) 'release-manifest.json') -Raw | ConvertFrom-Json
  $name = $identity.artifactName.Replace('${version}', $Version).Replace('${arch}', [string]$identity.architecture[0]).Replace('${ext}', 'exe')
  if ([IO.Path]::GetFileName($Path) -cne $name -or $manifest.version -cne $Version -or $manifest.identity.installerGuid -cne $identity.installerGuid -or $manifest.instrumented -or -not $manifest.allowlist.passed) { throw 'Installer manifest identity/version/payload does not match the exact lifecycle input.' }
  $record = @($manifest.artifacts | Where-Object { $_.name -ceq $name })
  if ($record.Count -ne 1 -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $record[0].sha256) { throw 'Installer hash does not match its manifest.' }
  if ($Signed -and ($manifest.signing -cne 'signed' -or -not $manifest.publishable -or $manifest.source.dirty -or -not $manifest.source.frozenCandidate)) { throw 'Signed lifecycle requires a clean signed-source manifest.' }
}
Assert-ManifestArtifact $previous $fixture.previousVersion $false
Assert-ManifestArtifact $current $package.version ([bool]$ExpectedPublisherSubject)
function Invoke-Installer([string]$Path) {
  $process = Start-Process -FilePath $Path -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)." }
}
function Wait-Until([scriptblock]$Condition, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}
function Assert-SignedArtifact([string]$Path) {
  if (-not $ExpectedPublisherSubject) { return }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -cne $ExpectedPublisherSubject -or -not $signature.TimeStamperCertificate) { throw 'Signed lifecycle artifact did not have the valid expected signer and trusted timestamp.' }
}
function Normalize-FileVersion([string]$Value) {
  $parts = @($Value.Split('.'))
  while ($parts.Count -lt 4) { $parts += '0' }
  return ($parts[0..3] -join '.')
}
function Get-UninstallEntry() {
  $root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  # A bare return emits nothing; `return $null` would emit one null that
  # @(...).Count reads as a registration on a runner with no per-user
  # uninstall key at all.
  if (-not (Test-Path -LiteralPath $root)) { return }
  return @(Get-ChildItem -LiteralPath $root | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.PSChildName.Trim('{}') -ieq $identity.installerGuid -or $_.DisplayName -like "$($identity.productName) *" })
}
if (@(Get-UninstallEntry).Count) { throw 'Disposable environment has preexisting installer registration.' }
function Assert-Installed([string]$ExpectedVersion) {
  $exe = Join-Path $install $executableFileName
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installed Pixelody.exe was not found.' }
  $version = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
  if ((Normalize-FileVersion $version) -ne (Normalize-FileVersion $ExpectedVersion)) { throw "Installed Pixelody.exe version $version did not match $ExpectedVersion." }
  if (-not (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) -or -not (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf)) { throw 'Expected per-user Pixelody shortcuts were not created.' }
  $uninstallEntries = @(Get-UninstallEntry)
  if ($uninstallEntries.Count -ne 1 -or $uninstallEntries[0].PSChildName.Trim('{}') -ine $identity.installerGuid -or $uninstallEntries[0].DisplayVersion -cne $ExpectedVersion -or $uninstallEntries[0].UninstallString -notlike "*$install*") { throw 'Expected per-user installer GUID/version/root was not found.' }
  $shortcutReader = New-Object -ComObject WScript.Shell
  foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
    if ($shortcutReader.CreateShortcut($shortcut).TargetPath -ine $exe) { throw 'Shortcut does not target the identity-derived installed executable.' }
  }
  return $exe
}
function Stop-OwnedProcess([int]$ProcessId) {
  # Electron child processes exit on their own once the main process closes, so
  # one can vanish between enumeration and Stop-Process. Only a process that is
  # still running after a failed stop is an error.
  try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop }
  catch { if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { throw } }
}
function Assert-InstalledLaunch([string]$Executable) {
  if ([IO.Path]::GetFullPath($Executable).ToLowerInvariant() -ne ([IO.Path]::GetFullPath((Join-Path $install $executableFileName))).ToLowerInvariant()) { throw 'Installed launch target escaped the approved install root.' }
  $installPrefix = $install.TrimEnd('\') + '\'
  $process = Start-Process -FilePath $Executable -PassThru -WindowStyle Normal
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $interactive = $false
  while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
    Start-Sleep -Milliseconds 200
    $process.Refresh()
    if ($process.MainWindowHandle -ne 0 -and $process.Responding) { $interactive = $true; break }
  }
  if (-not $interactive) {
    if (-not $process.HasExited) { Stop-OwnedProcess $process.Id }
    $failedChildren = @(Get-CimInstance Win32_Process -Filter "Name = '$executableFileName'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) })
    foreach ($ownedProcess in $failedChildren) { Stop-OwnedProcess $ownedProcess.ProcessId }
    throw 'Installed Pixelody did not expose a responsive main window within 30 seconds.'
  }
  $null = $process.CloseMainWindow()
  $null = $process.WaitForExit(5000)
  $remaining = @(Get-CimInstance Win32_Process -Filter "Name = '$executableFileName'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) })
  foreach ($ownedProcess in $remaining) { Stop-OwnedProcess $ownedProcess.ProcessId }
}
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$phase = 'preflight'
try {
  $initialInstaller = if ($CleanCurrent) { $current } else { $previous }
  $initialVersion = if ($CleanCurrent) { $package.version } else { $fixture.previousVersion }
  Assert-SignedArtifact $current
  $phase = 'clean-install'
  Invoke-Installer $initialInstaller
  $initialExe = Assert-Installed $initialVersion
  if ($CleanCurrent) { Assert-SignedArtifact $initialExe }
  $phase = 'seed-generated-state'
  & $node (Join-Path $PSScriptRoot 'seed-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Fixture seeding failed.' }
  $phase = 'repair'
  Invoke-Installer $initialInstaller
  $repairedInitialExe = Assert-Installed $initialVersion
  if ($CleanCurrent) { Assert-SignedArtifact $repairedInitialExe }
  & $node (Join-Path $PSScriptRoot 'verify-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Repair/reinstall did not preserve fixture state.' }
  $phase = if ($CleanCurrent) { 'current-repair' } else { 'upgrade' }
  if (-not $CleanCurrent) { Invoke-Installer $current }
  $currentExe = Assert-Installed $fixture.currentVersion
  Assert-SignedArtifact $currentExe
  & $node (Join-Path $PSScriptRoot 'verify-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Upgrade did not preserve fixture state.' }
  $phase = 'current-repair'
  Invoke-Installer $current
  $currentExe = Assert-Installed $package.version
  Assert-SignedArtifact $currentExe
  & $node (Join-Path $PSScriptRoot 'verify-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Current installer repair did not preserve state.' }
  $phase = 'launch-after-upgrade'
  Assert-InstalledLaunch $currentExe
  $phase = 'uninstall'
  $uninstaller = Join-Path $install "Uninstall $($identity.productName).exe"
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Expected uninstaller was not found inside the validated install root.' }
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)." }
  if (-not (Wait-Until { -not (Test-Path -LiteralPath $install) } 15)) { throw 'Uninstall left the application install directory behind.' }
  if (-not (Test-Path -LiteralPath $profile)) { throw 'Uninstall incorrectly removed Pixelody userData.' }
  if (-not (Wait-Until { -not (Test-Path -LiteralPath $desktopShortcut) -and -not (Test-Path -LiteralPath $startMenuShortcut) } 15)) { throw 'Uninstall left a Pixelody shortcut behind.' }
  if (-not (Wait-Until { @(Get-UninstallEntry).Count -eq 0 } 15)) { throw 'Uninstall left Pixelody installer metadata behind.' }
  & $node (Join-Path $PSScriptRoot 'verify-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Uninstall did not preserve readable fixture state.' }
  $phase = 'reinstall'
  Invoke-Installer $current
  $reinstalledExe = Assert-Installed $fixture.currentVersion
  Assert-SignedArtifact $reinstalledExe
  & $node (Join-Path $PSScriptRoot 'verify-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Reinstall did not reconnect to preserved state.' }
  $phase = 'launch-after-reinstall'
  Assert-InstalledLaunch $reinstalledExe
  & $node (Join-Path $PSScriptRoot 'verify-windows-upgrade-fixture.js') "--profile=$profile"
  if ($LASTEXITCODE -ne 0) { throw 'Reinstalled application launch did not preserve fixture state.' }
  $result = [ordered]@{ schemaVersion=2; passed=$true; failedPhase=''; previousVersion=$fixture.previousVersion; currentVersion=$fixture.currentVersion; signedCurrent=[bool]$ExpectedPublisherSubject; signatureAndTimestampVerified=([bool]$ExpectedPublisherSubject); cleanInstall=$true; repair=$true; upgrade=$true; installedLaunchAfterUpgrade=$true; uninstallRemovedApplication=$true; uninstallRemovedShortcuts=$true; uninstallRemovedMetadata=$true; uninstallPreservedUserData=$true; reinstall=$true; installedLaunchAfterReinstall=$true; fixtureOnly=$true; pathsIncluded=$false }
  $result.schemaVersion = 3
  $result.upgrade = -not [bool]$CleanCurrent
  $result.matrix = if ($CleanCurrent) { 'clean-current' } else { 'prior-to-current' }
  $result.cleanCurrentInstall = [bool]$CleanCurrent
  $result.currentRepair = $true
  $result.previousInstallerSha256 = (Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash.ToLowerInvariant()
  $result.currentInstallerSha256 = (Get-FileHash -LiteralPath $current -Algorithm SHA256).Hash.ToLowerInvariant()
  $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'installer-lifecycle.json') -Encoding utf8
  Write-Host 'Disposable Windows installer lifecycle passed. The final reinstall remains present for manual inspection.'
} catch {
  $failure = [ordered]@{ schemaVersion=2; passed=$false; failedPhase=$phase; failure='lifecycle-step-failed'; fixtureOnly=$true; pathsIncluded=$false }
  $failure | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'installer-lifecycle.json') -Encoding utf8
  throw
}
