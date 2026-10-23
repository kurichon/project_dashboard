<#
Offline in-place updater for Project Dashboard (legacy name: Project Pulse).
Do not uninstall the extension or move its installed directory. No networking.
Requires Windows PowerShell 5.1+ or PowerShell 7+.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [Parameter(Mandatory=$true)][string]$Package,
    [string]$ExpectedSha256 = ''
)
$ErrorActionPreference = 'Stop'
$installed = (Resolve-Path -LiteralPath $InstallDir).Path
$archive = (Resolve-Path -LiteralPath $Package).Path
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('ProjectDashboardUpdate-' + [guid]::NewGuid().ToString('N'))
$backup = $installed + '.previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$copied = $false
$addedFiles = @()
$allowedNames = @('Project Pulse', 'Project Dashboard')
try {
    if (-not (Test-Path -LiteralPath (Join-Path $installed 'manifest.json') -PathType Leaf)) { throw 'Installed folder does not contain manifest.json.' }
    $old = Get-Content -LiteralPath (Join-Path $installed 'manifest.json') -Raw | ConvertFrom-Json
    if ($allowedNames -cnotcontains $old.name) { throw 'The selected installation is neither Project Pulse nor Project Dashboard.' }
    if ($old.manifest_version -ne 3) { throw 'The installed extension is not a supported Manifest V3 installation.' }
    if ($ExpectedSha256) {
        if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'ExpectedSha256 must contain 64 hexadecimal characters.' }
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        if ($actual -ine $ExpectedSha256) { throw 'Downloaded ZIP checksum differs from expected SHA256.' }
    }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
    $incoming = Join-Path $staging 'extension'
    $newManifest = Join-Path $incoming 'manifest.json'
    if (-not (Test-Path -LiteralPath $newManifest -PathType Leaf)) { throw 'ZIP must contain extension/manifest.json.' }
    $new = Get-Content -LiteralPath $newManifest -Raw | ConvertFrom-Json
    if ($new.name -ne 'Project Dashboard') { throw 'Release manifest must be Project Dashboard.' }
    if ($new.manifest_version -ne 3) { throw 'Release manifest is not Manifest V3.' }
    if ([version]$new.version -le [version]$old.version) { throw ('New version must be higher than installed version ({0}).' -f $old.version) }
    # Preserve the prior installed extension key, if present, not an invented key.
    if ($old.PSObject.Properties.Name -contains 'key' -and $old.key -and $old.key.Trim()) {
        $new | Add-Member -NotePropertyName 'key' -NotePropertyValue $old.key -Force
        [System.IO.File]::WriteAllText($newManifest, ($new | ConvertTo-Json -Depth 15), (New-Object System.Text.UTF8Encoding($false)))
    }
    # Preserve personal legacy source/OAuth config for first-use migration.
    $oldConfig = Join-Path $installed 'config.js'
    if (Test-Path -LiteralPath $oldConfig -PathType Leaf) {
        Copy-Item -LiteralPath $oldConfig -Destination (Join-Path $incoming 'config.js') -Force
    }
    # Full copy for recovery before changing a single installed application file.
    Copy-Item -LiteralPath $installed -Destination $backup -Recurse -Force
    $copied = $true
    # Copy nested bundled assets (icons/background) as well as top-level scripts.
    Get-ChildItem -LiteralPath $incoming -File -Recurse | Where-Object {$_.FullName -ne $newManifest} | ForEach-Object {
        $relative = $_.FullName.Substring($incoming.Length).TrimStart([char[]]@([char]'\',[char]'/'))
        $target = Join-Path $installed $relative
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        if (-not (Test-Path -LiteralPath $target)) { $script:addedFiles += $target }
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
    Copy-Item -LiteralPath $newManifest -Destination (Join-Path $installed 'manifest.json') -Force
    Write-Host ('Project Dashboard updated from {0} to {1}.' -f $old.version,$new.version)
    Write-Host ('Recovery backup: {0}' -f $backup)
    Write-Host 'In brave://extensions choose Reload for the same installed extension (do not remove/reinstall).'
} catch {
    if ($copied -and (Test-Path -LiteralPath $backup)) {
        Write-Warning 'Update failed. Restoring original extension files from recovery backup.'
        Get-ChildItem -LiteralPath $backup -File -Recurse | ForEach-Object {
            $relative = $_.FullName.Substring($backup.Length).TrimStart([char[]]@([char]'\',[char]'/'))
            $target = Join-Path $installed $relative
            $parent = Split-Path -Parent $target
            if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
        foreach ($file in $addedFiles) {
            if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
        }
    }
    throw
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}