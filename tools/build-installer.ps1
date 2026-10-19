# Build the Windows installer: build-win.ps1, then Inno Setup (win\jizura-sync.iss) into
# build\installer\jizura-sync-v<version>-win-x64.exe (the zip's name, jizura-sync-<tag>-win-x64, with .exe).
#
#   powershell -ExecutionPolicy Bypass -File tools/build-installer.ps1 [-Version 1.2.3-beta.1]
#
# Needs what build-win.ps1 needs, plus Inno Setup 6 (winget install JRSoftware.InnoSetup).
# -Version defaults to the csproj's <Version>; the exe's and setup's file versions drop its suffix.
param([string]$Version)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build/installer'

if (-not $Version) {
    $Version = ([xml](Get-Content -Raw (Join-Path $root 'win/jizura-sync.csproj'))).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
}
if ($Version -notmatch '^(\d+\.\d+\.\d+)(-[0-9A-Za-z.-]+)?$') { throw "Version '$Version' is not 1.2.3 or 1.2.3-beta.1" }
$fileVersion = $Matches[1]

# PATH, then the machine-wide and per-user (winget --scope user) install folders.
$iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw 'Inno Setup 6 not found -- run: winget install JRSoftware.InnoSetup' }

& (Join-Path $PSScriptRoot 'build-win.ps1') -Version $Version

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
$name = "jizura-sync-v$Version-win-x64"
& $iscc /Q "/DAppVersion=$Version" "/DFileVersion=$fileVersion" "/DOutputName=$name" "/O$out" (Join-Path $root 'win/jizura-sync.iss')
if ($LASTEXITCODE) { throw 'ISCC failed' }

$setup = Join-Path $out "$name.exe"
Write-Host ("Built: {0} ({1:N1} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))
