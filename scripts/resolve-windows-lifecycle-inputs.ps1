[CmdletBinding()]
param([switch]$Signed)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$identity = Get-Content -LiteralPath (Join-Path $project 'release/windows-identity.json') -Raw | ConvertFrom-Json
$fixture = Get-Content -LiteralPath (Join-Path $project 'release/upgrade-fixture.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
if ($fixture.currentVersion -cne $package.version) { throw 'Controlled current fixture version must match package.json.' }
function Resolve-Artifact([string]$Directory, [string]$Version) {
  $name = $identity.artifactName.Replace('${version}', $Version).Replace('${arch}', [string]$identity.architecture[0]).Replace('${ext}', 'exe')
  if ($name -match '[\\/]|\$\{|\.\.') { throw 'Invalid artifact identity.' }
  return (Resolve-Path -LiteralPath (Join-Path $project (Join-Path $Directory $name)) -ErrorAction Stop).Path
}
@{
  PreviousInstaller = Resolve-Artifact '.artifacts/windows-release/upgrade-fixture/previous' $fixture.previousVersion
  CurrentInstaller = Resolve-Artifact $(if ($Signed) { '.artifacts/windows-release/signed' } else { '.artifacts/windows-release/upgrade-fixture/current' }) $package.version
}
