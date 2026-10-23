<#
User-invoked updater for unpacked Brave/Chromium Project Dashboard installations.
Downloads ONLY a published stable release from kurichon/project_dashboard; checks the
published SHA-256 and uses the locally bundled in-place updater. Does not touch
browser storage, Google Sheets, tokens, or any browser profile.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = ''
)
$ErrorActionPreference = 'Stop'
$repo = 'kurichon/project_dashboard'
$releaseApi = 'https://api.github.com/repos/kurichon/project_dashboard/releases/latest'
$pathFolder = Join-Path $env:LOCALAPPDATA 'ProjectDashboard'
$savedPathFile = Join-Path $pathFolder 'updater-location.txt'
$downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) ('ProjectDashboardRelease-' + [guid]::NewGuid().ToString('N'))

function Test-InstallationPath([string]$dir) {
    if ([string]::IsNullOrWhiteSpace($dir)) { return $false }
    $manifestFile = Join-Path $dir 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { return $false }
    try {
        $m = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
        return ($m.manifest_version -eq 3 -and @('Project Pulse', 'Project Dashboard') -contains $m.name)
    } catch { return $false }
}

try {
    if (-not $InstallDir -and (Test-Path -LiteralPath $savedPathFile -PathType Leaf)) {
        $stored = (Get-Content -LiteralPath $savedPathFile -Raw).Trim()
        if (Test-InstallationPath $stored) { $InstallDir = $stored }
    }
    if (-not (Test-InstallationPath $InstallDir)) {
        Write-Host 'Locate the existing extension folder (it contains manifest.json).'
        Write-Host 'Find it under brave://extensions > Details > Loaded from, when available.'
        $InstallDir = (Read-Host 'Existing Project Pulse / Project Dashboard extension folder').Trim('"').Trim()
    }
    if (-not (Test-InstallationPath $InstallDir)) { throw 'Not a supported existing extension folder; nothing was changed.' }
    $installed = (Resolve-Path -LiteralPath $InstallDir).Path
    $oldManifest = Get-Content -LiteralPath (Join-Path $installed 'manifest.json') -Raw | ConvertFrom-Json

    Write-Host 'Checking published Project Dashboard releases on GitHub...'
    $headers = @{ Accept='application/vnd.github+json'; 'User-Agent'='ProjectDashboardUpdater' }
    $release = Invoke-RestMethod -Uri $releaseApi -Headers $headers -TimeoutSec 30
    $tag = [string]$release.tag_name
    $versionMatch = [regex]::Match($tag, '^v([0-9]+)\.([0-9]+)\.([0-9]+)$')
    if ($release.draft -or $release.prerelease -or -not $versionMatch.Success) {
        throw 'The latest GitHub release is not a stable vX.Y.Z release.'
    }
    $newVersion = $versionMatch.Groups[1].Value + '.' + $versionMatch.Groups[2].Value + '.' + $versionMatch.Groups[3].Value
    if ([version]$newVersion -le [version]$oldManifest.version) {
        Write-Host ('Already up to date (installed: {0}; latest stable: {1}).' -f $oldManifest.version, $newVersion)
        New-Item -ItemType Directory -Path $pathFolder -Force | Out-Null
        [IO.File]::WriteAllText($savedPathFile, $installed, (New-Object System.Text.UTF8Encoding($false)))
        return
    }

    $archiveName = 'project-dashboard-v' + $newVersion + '.zip'
    $checksumName = 'SHA256SUMS.txt'
    $assets = @($release.assets)
    $archiveAsset = @($assets | Where-Object { $_.name -ceq $archiveName })
    $checksumAsset = @($assets | Where-Object { $_.name -ceq $checksumName })
    if ($archiveAsset.Count -ne 1 -or $checksumAsset.Count -ne 1) { throw 'Release is missing the exact ZIP or checksum assets.' }
    foreach ($asset in @($archiveAsset[0],$checksumAsset[0])) {
        $address = [uri]([string]$asset.browser_download_url)
        $expectedPath = '/kurichon/project_dashboard/releases/download/' + $tag + '/' + [string]$asset.name
        if ($address.Scheme -ne 'https' -or $address.Host -ne 'github.com' -or
            $address.AbsolutePath -cne $expectedPath -or $address.Query -or $address.Fragment) {
            throw 'Release asset URL does not point to the official GitHub repository.'
        }
    }

    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
    $zipPath = Join-Path $downloadDir $archiveName
    $checksumPath = Join-Path $downloadDir $checksumName
    Write-Host ('Downloading release ' + $tag + '...')
    Invoke-WebRequest -Uri $archiveAsset[0].browser_download_url -Headers $headers -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
    Invoke-WebRequest -Uri $checksumAsset[0].browser_download_url -Headers $headers -OutFile $checksumPath -UseBasicParsing -TimeoutSec 30
    $pattern = '^([A-Fa-f0-9]{64})  ' + [regex]::Escape($archiveName) + '$'
    $validLines = @(Get-Content -LiteralPath $checksumPath | Where-Object { $_ -match $pattern })
    if ($validLines.Count -ne 1) { throw 'Checksum file has no unique matching hash for this ZIP.' }
    $expectedSha = [regex]::Match($validLines[0],$pattern).Groups[1].Value
    $actualSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    if ($actualSha -ine $expectedSha) { throw 'SHA-256 mismatch. No files were changed.' }

    $localUpdater = Join-Path $PSScriptRoot 'upgrade-local.ps1'
    if (-not (Test-Path -LiteralPath $localUpdater -PathType Leaf)) { throw 'Required local upgrade-local.ps1 is missing.' }
    & $localUpdater -InstallDir $installed -Package $zipPath -ExpectedSha256 $expectedSha

    New-Item -ItemType Directory -Path $pathFolder -Force | Out-Null
    [IO.File]::WriteAllText($savedPathFile, $installed, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'Update completed. Reload the same extension under brave://extensions.'
} finally {
    if (Test-Path -LiteralPath $downloadDir) { Remove-Item -LiteralPath $downloadDir -Recurse -Force }
}
