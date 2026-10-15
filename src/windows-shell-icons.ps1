param(
    [Parameter(Mandatory = $true)][string]$DesktopRoot,
    [Parameter(Mandatory = $true)][string]$StartMenuRoot,
    [Parameter(Mandatory = $true)][string]$PinnedRoot
)

# A persistent, hidden Shell notifier. The caller has already checked shortcut
# targets, profile arguments and AppIDs. This worker checks path boundaries again
# and never writes a shortcut, changes a window identity, or deletes icon caches.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Resolve-AllowedRoot([string]$Value) {
    if (-not [IO.Path]::IsPathRooted($Value)) { throw 'Shortcut root must be absolute.' }
    return [IO.Path]::GetFullPath($Value).TrimEnd('\') + '\'
}

try {
    $allowedRoots = @(
        (Resolve-AllowedRoot $DesktopRoot),
        (Resolve-AllowedRoot $StartMenuRoot),
        (Resolve-AllowedRoot $PinnedRoot)
    )
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PixelodyShellIconNotifications {
    [DllImport("shell32.dll", ExactSpelling = true, EntryPoint = "SHChangeNotify")]
    private static extern void NotifyGlobal(int change, uint flags, IntPtr first, IntPtr second);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, EntryPoint = "SHChangeNotify")]
    private static extern void NotifyPath(int change, uint flags, string first, IntPtr second);
    public static void RefreshAssociations(bool animationFrame) {
        // SHCNE_ASSOCCHANGED + SHCNF_IDLIST | SHCNF_FLUSH. This supported Shell
        // notification invalidates cached icons without deleting cache files.
        // SHCNF_FLUSHNOWAIT is 0x3000 (it includes FLUSH), per the Windows SDK.
        NotifyGlobal(0x08000000, animationFrame ? 0x3000u : 0x1000u, IntPtr.Zero, IntPtr.Zero);
    }
    public static void RefreshShortcut(string path, bool animationFrame) {
        // Windows 11 also needs UPDATEITEM for the exact application shortcuts.
        // SHCNF_PATHW | SHCNF_FLUSH delivers that specific item notification.
        NotifyPath(0x2000, animationFrame ? 0x3005u : 0x1005u, path, IntPtr.Zero);
    }
}
'@
    while ($null -ne ($inputLine = [Console]::ReadLine())) {
        $requestId = $null
        try {
            if ($inputLine.Length -gt 32768) { throw 'Shell icon request is too large.' }
            $request = $inputLine | ConvertFrom-Json
            if ($null -eq $request.id -or $request.id -isnot [ValueType] -or $request.id -is [bool] -or [double]$request.id -lt 1 -or [double]$request.id -gt 2147483647 -or [double]$request.id -ne [Math]::Truncate([double]$request.id)) { throw 'Shell icon request ID is invalid.' }
            $requestId = [int]$request.id
            $animationFrame = $false
            if ($null -ne $request.animationFrame) {
                if ($request.animationFrame -isnot [bool]) { throw 'Invalid animation notification mode.' }
                $animationFrame = $request.animationFrame
            }
            $notifyAssociations = $true
            if ($null -ne $request.notifyAssociations) {
                if ($request.notifyAssociations -isnot [bool]) { throw 'Invalid association notification mode.' }
                $notifyAssociations = $request.notifyAssociations
            }
            $shortcuts = @()
            if ($null -ne $request.shortcuts) {
                foreach ($shortcut in @($request.shortcuts)) {
                    if ($shortcut -isnot [string] -or $shortcut.Length -gt 259 -or $shortcut.Contains([char]0) -or -not [IO.Path]::IsPathRooted($shortcut)) { throw 'Shortcut path is invalid.' }
                    $resolved = [IO.Path]::GetFullPath($shortcut)
                    if ([IO.Path]::GetExtension($resolved) -ine '.lnk') { throw 'Shortcut path must end in .lnk.' }
                    $insideAllowedRoot = $false
                    foreach ($root in $allowedRoots) {
                        if ($resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $insideAllowedRoot = $true; break }
                    }
                    if (-not $insideAllowedRoot) { throw 'Shortcut is outside the allowed Shell locations.' }
                    $shortcuts += $resolved
                    if ($shortcuts.Count -gt 64) { throw 'Too many shortcut paths.' }
                }
            }
            # All validation precedes the global notification. Missing links are
            # harmless: a shortcut can be removed after the caller discovered it.
            if ($notifyAssociations) { [PixelodyShellIconNotifications]::RefreshAssociations($animationFrame) }
            foreach ($shortcut in $shortcuts) { [PixelodyShellIconNotifications]::RefreshShortcut($shortcut, $animationFrame) }
            [Console]::WriteLine((@{ id = $requestId; ok = $true; refreshedShortcuts = $shortcuts.Count } | ConvertTo-Json -Compress))
        } catch {
            [Console]::WriteLine((@{ id = $requestId; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
        }
    }
} catch {
    [Console]::WriteLine((@{ id = $null; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    exit 1
}
