$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tmp=Join-Path ([System.IO.Path]::GetTempPath()) ('ProjectDashboardUpdaterTest-' + [guid]::NewGuid().ToString('N'))
$install=Join-Path $tmp 'installed'
$packageDir=Join-Path $tmp 'package'
$packageZip=Join-Path $tmp 'package.zip'
try {
    New-Item -ItemType Directory -Path $install -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $packageDir 'extension') -Force | Out-Null
    $old=@{manifest_version=3;name='Project Pulse';version='1.2.0';key='LEGACY_PUBLIC_KEY'}|ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $install 'manifest.json'),$old)
    [IO.File]::WriteAllText((Join-Path $install 'config.js'),"const PROJECT_PULSE_CONFIG = { spreadsheetId: 'LOCAL_EXAMPLE_ID' };")
    [IO.File]::WriteAllText((Join-Path $install 'newtab.js'),'OLD')
    Copy-Item (Join-Path $repo 'extension/*') -Destination (Join-Path $packageDir 'extension') -Force
    Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $packageZip -Force
    $hash=(Get-FileHash $packageZip -Algorithm SHA256).Hash
    & (Join-Path $repo 'tools/upgrade-local.ps1') -InstallDir $install -Package $packageZip -ExpectedSha256 $hash
    $new=Get-Content (Join-Path $install 'manifest.json') -Raw | ConvertFrom-Json
    if ($new.name -ne 'Project Dashboard' -or $new.key -ne 'LEGACY_PUBLIC_KEY' -or $new.version -ne '1.3.0') { throw 'Migration did not preserve identity or change version/name.' }
    if ((Get-Content (Join-Path $install 'config.js') -Raw) -notmatch 'LOCAL_EXAMPLE_ID') { throw 'Legacy local configuration was lost.' }
    if ((Get-Content (Join-Path $install 'newtab.js') -Raw) -eq 'OLD') { throw 'Source files did not upgrade.' }
    $backups=Get-ChildItem $tmp -Directory | Where-Object {$_.Name -like 'installed.previous-*'}
    if ($backups.Count -ne 1) { throw 'Expected exactly one recovery backup.' }
    if ((Get-Content (Join-Path $backups[0].FullName 'newtab.js') -Raw) -ne 'OLD') { throw 'Recovery backup lost original source.' }
    $failed=$false
    try { & (Join-Path $repo 'tools/upgrade-local.ps1') -InstallDir $install -Package $packageZip -ExpectedSha256 ('0' * 64) | Out-Null } catch { $failed=$true }
    if (-not $failed) { throw 'Wrong checksum was accepted.' }
    $still=Get-Content (Join-Path $install 'manifest.json') -Raw | ConvertFrom-Json
    if ($still.version -ne '1.3.0') { throw 'Checksum failure changed installed version.' }
    Write-Host 'PASS updater: rebrand, unchanged public key/config, backup, checksum rejection'
} finally {
    if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}