# Build the Windows app into build\win\jizura-sync.exe (x64, needs the .NET 10 Desktop Runtime and
# the WebView2 Runtime, which Windows 11 has).
#
#   powershell -ExecutionPolicy Bypass -File tools/build-win.ps1 [-Version 1.2.3]
#
# Needs the .NET 10 SDK. The first build downloads the WebView2 SDK, C#/WinRT and the Windows SDK
# metadata (Microsoft.Windows.SDK.Contracts) from NuGet. The output is jizura-sync.exe (one file, all
# managed code), WebView2Loader.dll and web\ -- move them together.
# -Version overrides the csproj's <Version> (the release workflow passes the tag).
param([string]$Version)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build/win'

if (-not (Test-Path (Join-Path $root 'web/vendor/JIZURA/src/01_util.js'))) {
    throw 'JIZURA submodule missing -- run: git submodule update --init'
}
# A syntax error blanks the whole page with no UI at all.
foreach ($f in 'app.js', 'lyrics.js', 'native.js', 'i18n.js') {
    # cmd's redirect, not a PowerShell pipe: Windows PowerShell re-encodes piped text and breaks UTF-8.
    cmd /c "node --input-type=module --check < `"$(Join-Path $root "web/$f")`""
    if ($LASTEXITCODE) { throw "node --check failed: web/$f" }
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
$props = @()
if ($Version) { $props += "-p:Version=$Version" }
dotnet publish (Join-Path $root 'win/jizura-sync.csproj') -c Release -r win-x64 --self-contained false -o $out -nologo -v quiet @props
if ($LASTEXITCODE) { throw 'dotnet publish failed' }

$web = Join-Path $out 'web'
robocopy (Join-Path $root 'web') $web /E /XD vendor /XF .DS_Store /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'copying web/ failed' }

# JIZURA's audio analysis (10_audio.js) and video / PNG export (11_export.js) serve its editor, not
# playback: the app never calls them, and the only outside use (02_fonts.js, uploaded faces) checks
# that they exist. They leave the copied index.html; the source stays as upstream has it.
$unused = '10_audio.js', '11_export.js'
$index = Join-Path $web 'index.html'
$utf8 = New-Object System.Text.UTF8Encoding $false
$html = [IO.File]::ReadAllText($index, $utf8)
foreach ($f in $unused) {
    $tag = "<script src=`"vendor/JIZURA/src/$f`"></script>"
    if (-not $html.Contains($tag)) { throw "index.html no longer loads $f -- update build-win.ps1" }
    $html = [regex]::Replace($html, "[ \t]*$([regex]::Escape($tag))\r?\n", '')
}
[IO.File]::WriteAllText($index, $html, $utf8)

# Of JIZURA, only the scripts that index.html loads (not 12_ui.js, its editor's UI) and its notices.
$jizura = Join-Path $web 'vendor/JIZURA'
New-Item -ItemType Directory -Force (Join-Path $jizura 'src') | Out-Null
$scripts = [regex]::Matches($html, '<script src="vendor/JIZURA/src/([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
if (-not $scripts) { throw 'index.html loads no JIZURA scripts -- update build-win.ps1' }
foreach ($f in $scripts) { Copy-Item (Join-Path $root "web/vendor/JIZURA/src/$f") (Join-Path $jizura 'src') }
Copy-Item (Join-Path $root 'web/vendor/JIZURA/LICENSE'), (Join-Path $root 'web/vendor/JIZURA/THIRD_PARTY_NOTICES.md') $jizura

Get-ChildItem $out -File | Format-Table Name, @{ n = 'KB'; e = { [math]::Ceiling($_.Length / 1KB) }; a = 'right' } -AutoSize | Out-Host
$size = (Get-ChildItem -Recurse -File $out | Measure-Object Length -Sum).Sum
Write-Host ("Built: {0} ({1:N1} MB in all)" -f (Join-Path $out 'jizura-sync.exe'), ($size / 1MB))
