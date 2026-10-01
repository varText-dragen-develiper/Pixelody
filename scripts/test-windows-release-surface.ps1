[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Capture','Verify')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
  [Parameter(Mandatory=$true)][switch]$ConfirmDisposableEnvironment
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmDisposableEnvironment -or $env:PIXELODY_DISPOSABLE_WINDOWS -ne '1') { throw 'Refusing Windows release-surface inspection outside an explicitly marked disposable environment.' }
$project = Split-Path -Parent $PSScriptRoot
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $project '.artifacts'))
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
$artifactPrefix = $artifactRoot.TrimEnd('\') + '\'
if (-not $evidence.StartsWith($artifactPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence directory is outside the owned artifact root.' }
$baselinePath = Join-Path $evidence 'release-surface-baseline.json'
$resultPath = Join-Path $evidence 'release-surface.json'

function Get-Hash([object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-RegistryProjection([string[]]$Roots) {
  $records = [Collections.Generic.List[object]]::new()
  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $keys = @((Get-Item -LiteralPath $root)) + @(Get-ChildItem -LiteralPath $root -Recurse -ErrorAction Stop)
    foreach ($key in $keys) {
      $properties = Get-ItemProperty -LiteralPath $key.PSPath
      foreach ($name in @($properties.PSObject.Properties.Name | Where-Object { $_ -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$' } | Sort-Object)) {
        $records.Add([ordered]@{ key=$key.Name; name=$name; value=$properties.$name })
      }
    }
  }
  return @($records | Sort-Object { $_.key }, { $_.name })
}

$identity = Get-Content -LiteralPath (Join-Path $project 'release\windows-identity.json') -Raw | ConvertFrom-Json
foreach ($field in @('installerDirectoryName', 'userDataDirectoryName')) {
  if ([string]$identity.$field -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._+-]*$') { throw 'Unsafe Windows identity path component.' }
}
# Anything a Pixelody install could leave behind points at one of these.
$ownedRoots = @(
  [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA (Join-Path 'Programs' $identity.installerDirectoryName))),
  [IO.Path]::GetFullPath((Join-Path $env:APPDATA $identity.userDataDirectoryName)),
  $project
)

function Test-PixelodyOwned([object]$Record) {
  foreach ($value in @($Record.Name, $Record.DisplayName, $Record.PathName, $Record.Program)) {
    $text = [string]$value
    if (-not $text) { continue }
    if ($text -match '(?i)pixelody') { return $true }
    foreach ($root in $ownedRoots) { if ($text.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true } }
  }
  return $false
}

function Get-EntryHashes([object[]]$Records) {
  $map = [ordered]@{}
  foreach ($record in $Records) { $map[[string]$record.Name] = Get-Hash $record }
  return $map
}

# Hosted runners change services and firewall rules on their own while a
# lifecycle runs (Defender platform updates move MsMpEng.exe to a new versioned
# folder, Windows Update flips start modes). So entries are compared one by one
# and only an added or changed entry attributable to Pixelody fails the gate;
# the rest is reported by name so drift stays visible without failing releases.
function Compare-SurfaceEntries([object]$Before, [object[]]$AfterRecords) {
  $beforeMap = @{}
  if ($Before -is [Collections.IDictionary]) { foreach ($key in $Before.Keys) { $beforeMap[[string]$key] = [string]$Before[$key] } }
  elseif ($Before) { foreach ($property in $Before.PSObject.Properties) { $beforeMap[$property.Name] = [string]$property.Value } }
  $afterMap = @{}
  $recordByName = @{}
  foreach ($record in $AfterRecords) {
    $afterMap[[string]$record.Name] = Get-Hash $record
    $recordByName[[string]$record.Name] = $record
  }
  $added = @($afterMap.Keys | Where-Object { -not $beforeMap.ContainsKey($_) } | Sort-Object)
  $removed = @($beforeMap.Keys | Where-Object { -not $afterMap.ContainsKey($_) } | Sort-Object)
  $changed = @($afterMap.Keys | Where-Object { $beforeMap.ContainsKey($_) -and $beforeMap[$_] -ne $afterMap[$_] } | Sort-Object)
  $owned = @(@($added) + @($changed) | Where-Object { $_ -and (Test-PixelodyOwned $recordByName[$_]) })
  return [ordered]@{ added=$added; removed=$removed; changed=$changed; owned=$owned }
}

function Get-Surface() {
  $services = @(Get-CimInstance Win32_Service | Select-Object Name,DisplayName,PathName,StartMode,StartName | Sort-Object Name)
  $drivers = @(Get-CimInstance Win32_SystemDriver | Select-Object Name,DisplayName,PathName,StartMode | Sort-Object Name)
  $programs = @{}
  try { foreach ($filter in @(Get-NetFirewallApplicationFilter -All -ErrorAction Stop)) { $programs[[string]$filter.InstanceID] = [string]$filter.Program } } catch { }
  $firewall = @(Get-NetFirewallRule | Select-Object Name,DisplayName,Direction,Action,Enabled,Profile,PolicyStoreSourceType,@{ Name='Program'; Expression={ $programs[[string]$_.Name] } } | Sort-Object Name)
  $audio = Get-RegistryProjection @(
    'Registry::HKEY_CURRENT_USER\Software\Microsoft\Multimedia\Sound Mapper',
    'Registry::HKEY_CURRENT_USER\Software\Microsoft\Multimedia\Audio',
    'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\MMDevices',
    'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices'
  )
  $pixelodyServices = @($services | Where-Object { "$($_.Name) $($_.DisplayName) $($_.PathName)" -match '(?i)pixelody' })
  $pixelodyDrivers = @($drivers | Where-Object { "$($_.Name) $($_.DisplayName) $($_.PathName)" -match '(?i)pixelody' })
  $pixelodyFirewall = @($firewall | Where-Object { "$($_.Name) $($_.DisplayName) $($_.Program)" -match '(?i)pixelody' })
  if ($pixelodyServices.Count -or $pixelodyDrivers.Count -or $pixelodyFirewall.Count) { throw 'Pixelody unexpectedly registered a service, driver, or firewall rule.' }
  return [ordered]@{ services=$services; drivers=$drivers; firewall=$firewall; audio=$audio }
}

New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$surface = Get-Surface
if ($Phase -eq 'Capture') {
  # The baseline stays on the disposable machine; only the boolean result below
  # is uploaded. It holds entry names and hashes, never paths.
  $baseline = [ordered]@{
    schemaVersion=2
    serviceConfigurationSha256=(Get-Hash $surface.services)
    driverConfigurationSha256=(Get-Hash $surface.drivers)
    firewallConfigurationSha256=(Get-Hash $surface.firewall)
    defaultAudioConfigurationSha256=(Get-Hash $surface.audio)
    entries=[ordered]@{
      services=(Get-EntryHashes $surface.services)
      drivers=(Get-EntryHashes $surface.drivers)
      firewall=(Get-EntryHashes $surface.firewall)
    }
    pixelodyServices=0
    pixelodyDrivers=0
    pixelodyFirewallRules=0
    pathsIncluded=$false
  }
  $baseline | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $baselinePath -Encoding utf8
  Write-Host 'Disposable Windows release-surface baseline captured as privacy-safe hashes.'
  return
}
if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) { throw 'Release-surface baseline is missing.' }
$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
if ($baseline.schemaVersion -ne 2 -or -not $baseline.entries) { throw 'Release-surface baseline predates per-entry capture; capture it again.' }
$comparisons = [ordered]@{
  services=(Compare-SurfaceEntries $baseline.entries.services $surface.services)
  drivers=(Compare-SurfaceEntries $baseline.entries.drivers $surface.drivers)
  firewall=(Compare-SurfaceEntries $baseline.entries.firewall $surface.firewall)
}
foreach ($category in $comparisons.Keys) {
  $comparison = $comparisons[$category]
  $drift = @($comparison.added.Count, $comparison.removed.Count, $comparison.changed.Count) | Measure-Object -Sum
  if ($drift.Sum -gt $comparison.owned.Count) {
    Write-Host "Unrelated $category drift during the lifecycle (not Pixelody): added [$($comparison.added -join ', ')]; removed [$($comparison.removed -join ', ')]; changed [$($comparison.changed -join ', ')]"
  }
}
$checks = [ordered]@{
  servicesUntouchedByPixelody=($comparisons.services.owned.Count -eq 0)
  driversUntouchedByPixelody=($comparisons.drivers.owned.Count -eq 0)
  firewallUntouchedByPixelody=($comparisons.firewall.owned.Count -eq 0)
  defaultAudioUnchanged=((Get-Hash $surface.audio) -eq $baseline.defaultAudioConfigurationSha256)
}
if (@($checks.Values | Where-Object { -not $_ }).Count) {
  $owned = @($comparisons.Keys | ForEach-Object { $category = $_; $comparisons[$category].owned | ForEach-Object { "${category}:$_" } })
  throw "Windows release surface changed in Pixelody's name: $($checks | ConvertTo-Json -Compress) entries [$($owned -join ', ')]"
}
$result = [ordered]@{
  schemaVersion=2
  checks=$checks
  unrelatedDrift=[ordered]@{
    services=($comparisons.services.added.Count + $comparisons.services.removed.Count + $comparisons.services.changed.Count)
    drivers=($comparisons.drivers.added.Count + $comparisons.drivers.removed.Count + $comparisons.drivers.changed.Count)
    firewall=($comparisons.firewall.added.Count + $comparisons.firewall.removed.Count + $comparisons.firewall.changed.Count)
  }
  pixelodyServices=0
  pixelodyDrivers=0
  pixelodyFirewallRules=0
  pathsIncluded=$false
}
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resultPath -Encoding utf8
Write-Host 'Disposable Windows release surface passed: nothing Pixelody-owned was added to services, drivers, or firewall rules, and default audio is unchanged.'
