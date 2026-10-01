param(
    [switch]$Canvas,
    [ValidateSet('', 'foreground-stage')]
    [string]$CanvasProfile = '',
    [ValidateSet('', 'proxy', 'graph')]
    [string]$SingularityProbe = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $project 'Pixelody-launch-error.txt'

try {
    $packagePath = Join-Path $project 'package.json'
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $electronVersion = [string]$package.devDependencies.electron
    if ([string]::IsNullOrWhiteSpace($electronVersion)) {
        throw "Electron version is missing from package.json devDependencies."
    }

    # pnpm names Electron's store folder with a peer suffix
    # (electron@43.4.1_supports-color@7.2.0), so match on the version prefix.
    $pnpmStore = Join-Path $project 'node_modules\.pnpm'
    $electronCandidates = @(Join-Path $project 'node_modules\electron\dist\electron.exe') + @(
        Get-ChildItem -LiteralPath $pnpmStore -Directory -Filter "electron@$electronVersion*" -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'node_modules\electron\dist\electron.exe' }
    )
    $findElectron = { $electronCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
    $electron = & $findElectron
    if (-not $electron) {
        # Electron 43 has no install script: pnpm install leaves dist\ empty and
        # the package downloads its binary the first time Node loads it. This
        # launcher starts electron.exe directly, so on a fresh clone nothing has
        # asked for it yet. Ask once; the first launch takes about a minute.
        $installer = Join-Path $project 'node_modules\electron\install.js'
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($node -and (Test-Path -LiteralPath $installer)) {
            Start-Process -FilePath $node.Source -ArgumentList "`"$installer`"" -WorkingDirectory $project -WindowStyle Hidden -Wait
            $electron = & $findElectron
        }
    }
    if (-not $electron) {
        throw "Desktop runtime not found. In this folder run 'pnpm install --frozen-lockfile', then 'node node_modules\electron\install.js'. Checked:`n$($electronCandidates -join "`n")"
    }

    $launchArguments = @('.')
    if ($Canvas) { $launchArguments += '--pixelody-canvas-foreground' }
    if ($CanvasProfile) { $env:PIXELODY_CANVAS_PROFILE = $CanvasProfile }
    if ($SingularityProbe) { $launchArguments += "--pixelody-singularity-probe=$SingularityProbe" }
    Start-Process -FilePath $electron -ArgumentList $launchArguments -WorkingDirectory $project
    Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
}
catch {
    $_ | Out-String | Set-Content -LiteralPath $log
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "Pixelody could not start. Details were saved to:`n$log",
        'Pixelody launch error',
        'OK',
        'Error'
    ) | Out-Null
    exit 1
}
