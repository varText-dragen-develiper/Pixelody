[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Target
)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
$resolved = [IO.Path]::GetFullPath($Target)
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw 'Authenticode target does not exist.' }
$signature = Get-AuthenticodeSignature -LiteralPath $resolved -ErrorAction Stop
if (-not $signature) { throw 'Windows did not return an Authenticode result.' }
[pscustomobject]@{
  status = $signature.Status.ToString()
  subject = ($signature.SignerCertificate.Subject -as [string])
  thumbprint = ($signature.SignerCertificate.Thumbprint -as [string])
  timestampSubject = ($signature.TimeStamperCertificate.Subject -as [string])
} | ConvertTo-Json -Compress
