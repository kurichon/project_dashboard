$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('PDGithubUpdateTest-'+[guid]::NewGuid().ToString('N'))
$originalLocal=$env:LOCALAPPDATA
$script:checkMode='valid'
try {
    $env:LOCALAPPDATA=Join-Path $tmp 'LocalAppData'
    $installed=Join-Path $tmp 'installed'
    $pkg=Join-Path $tmp 'mockrelease'
    New-Item -ItemType Directory $installed,$pkg -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $installed 'manifest.json'),(@{manifest_version=3;name='Project Pulse';version='1.2.0';key='OLD_EXTENSION_KEY'}|ConvertTo-Json))
    [IO.File]::WriteAllText((Join-Path $installed 'config.js'),"const PROJECT_PULSE_CONFIG = { spreadsheetId: 'PRIVATE_LOCAL_SENTINEL' };")
    [IO.File]::WriteAllText((Join-Path $installed 'newtab.js'),'OLD_APP')

    $bundle=Join-Path $tmp 'bundle'
    New-Item -ItemType Directory (Join-Path $bundle 'extension') -Force | Out-Null
    Copy-Item (Join-Path $root 'extension/*') -Destination (Join-Path $bundle 'extension') -Recurse -Force
    $archive=Join-Path $pkg 'project-dashboard-v1.4.0.zip'
    Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $archive -Force
    $digest=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $pkg 'SHA256SUMS.txt'),("$digest  project-dashboard-v1.4.0.zip`n"))

    $script:mockRelease=[pscustomobject]@{
        tag_name='v1.4.0';draft=$false;prerelease=$false;
        assets=@(
          [pscustomobject]@{name='project-dashboard-v1.4.0.zip';browser_download_url='https://github.com/kurichon/project_dashboard/releases/download/v1.4.0/project-dashboard-v1.4.0.zip'},
          [pscustomobject]@{name='SHA256SUMS.txt';browser_download_url='https://github.com/kurichon/project_dashboard/releases/download/v1.4.0/SHA256SUMS.txt'}
        )
    }
    function Invoke-RestMethod { param($Uri,$Headers,$TimeoutSec) return $script:mockRelease }
    function Invoke-WebRequest {
        param($Uri,$Headers,$OutFile,[switch]$UseBasicParsing,$TimeoutSec)
        if ($Uri -like '*/SHA256SUMS.txt') {
            if ($script:checkMode -eq 'bad') { [IO.File]::WriteAllText($OutFile,(('0'*64)+"  project-dashboard-v1.4.0.zip`n")) }
            else { Copy-Item -LiteralPath (Join-Path $pkg 'SHA256SUMS.txt') -Destination $OutFile }
        } else { Copy-Item -LiteralPath $archive -Destination $OutFile }
    }

    $updater=Join-Path $root 'tools/update-from-github.ps1'
    $tokens=$null;$parseErrors=$null
    [System.Management.Automation.Language.Parser]::ParseFile($updater,[ref]$tokens,[ref]$parseErrors)|Out-Null
    if ($parseErrors.Count -gt 0) { throw ('Update script syntax error: '+$parseErrors[0].Message) }

    $script:checkMode='bad'
    $failed=$false
    try { & $updater -InstallDir $installed | Out-Null } catch { $failed=$true }
    if (-not $failed) { throw 'Invalid SHA256 allowed an update' }
    if ((Get-Content (Join-Path $installed 'newtab.js') -Raw) -ne 'OLD_APP') { throw 'Checksum mismatch modified installation' }
    if (Test-Path (Join-Path $env:LOCALAPPDATA 'ProjectDashboard/updater-location.txt')) { throw 'Failed update persisted install location' }

    $script:checkMode='valid'
    & $updater -InstallDir $installed | Out-Null
    $m=Get-Content (Join-Path $installed 'manifest.json') -Raw | ConvertFrom-Json
    if ($m.version -ne '1.4.0' -or $m.key -ne 'OLD_EXTENSION_KEY') { throw 'Identity/version lost during GitHub update' }
    if ((Get-Content (Join-Path $installed 'config.js') -Raw) -notmatch 'PRIVATE_LOCAL_SENTINEL') { throw 'Private local config lost' }
    if ((Get-Content (Join-Path $env:LOCALAPPDATA 'ProjectDashboard/updater-location.txt') -Raw).Trim() -ne $installed) { throw 'Updater did not remember the existing folder' }
    $script:checkMode='bad'
    & $updater -InstallDir $installed | Out-Null
    $m2=Get-Content (Join-Path $installed 'manifest.json') -Raw | ConvertFrom-Json
    if ($m2.version -ne '1.4.0') { throw 'No-update check modified installation' }
    $script:mockRelease.assets[0].browser_download_url='https://attacker.example/download.zip'
    [IO.File]::WriteAllText((Join-Path $installed 'manifest.json'),(@{manifest_version=3;name='Project Pulse';version='1.2.0'}|ConvertTo-Json))
    $failed=$false
    try { & $updater -InstallDir $installed | Out-Null } catch { $failed=$true }
    if (-not $failed) { throw 'Untrusted asset URL was accepted' }
    Write-Host 'PASS GitHub updater: valid migration, verified checksum, cached path, no-op and untrusted URL rejection'
} finally {
    $env:LOCALAPPDATA=$originalLocal
    if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Force -Recurse }
}
