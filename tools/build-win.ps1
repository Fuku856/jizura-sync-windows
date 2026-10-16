# Build the Windows app into build\win\jizura-sync.exe (x64, needs the .NET 10 Desktop Runtime and
# the WebView2 Runtime, which Windows 11 has).
#
#   powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
#
# Needs the .NET 10 SDK. The first build downloads the WebView2 SDK package from NuGet.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build/win'

if (-not (Test-Path (Join-Path $root 'web/vendor/JIZURA/src/01_util.js'))) {
    throw 'JIZURA submodule missing -- run: git submodule update --init'
}
# A syntax error blanks the whole page with no UI at all.
foreach ($f in 'app.js', 'spotify.js', 'lyrics.js', 'native.js', 'i18n.js') {
    # cmd's redirect, not a PowerShell pipe: Windows PowerShell re-encodes piped text and breaks UTF-8.
    cmd /c "node --input-type=module --check < `"$(Join-Path $root "web/$f")`""
    if ($LASTEXITCODE) { throw "node --check failed: web/$f" }
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
dotnet publish (Join-Path $root 'win/jizura-sync.csproj') -c Release -r win-x64 --self-contained false -o $out -nologo -v quiet
if ($LASTEXITCODE) { throw 'dotnet publish failed' }

# Same selection as the Cloudflare deploy: the page loads only JIZURA's src/*.js.
$web = Join-Path $out 'web'
robocopy (Join-Path $root 'web') $web /E /XD vendor /XF .DS_Store /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'copying web/ failed' }
$jizura = Join-Path $web 'vendor/JIZURA'
New-Item -ItemType Directory -Force $jizura | Out-Null
Copy-Item -Recurse (Join-Path $root 'web/vendor/JIZURA/src') $jizura
Copy-Item (Join-Path $root 'web/vendor/JIZURA/LICENSE'), (Join-Path $root 'web/vendor/JIZURA/THIRD_PARTY_NOTICES.md') $jizura

# JIZURA's audio analysis (10_audio.js) and video / PNG export (11_export.js) serve its editor, not
# playback: the app never calls them, and the only outside use (02_fonts.js, uploaded faces) checks
# that they exist. They leave the build and the copied index.html; the source stays as upstream has it.
$unused = '10_audio.js', '11_export.js'
foreach ($f in $unused) { Remove-Item (Join-Path $jizura "src/$f") }
$index = Join-Path $web 'index.html'
$utf8 = New-Object System.Text.UTF8Encoding $false
$html = [IO.File]::ReadAllText($index, $utf8)
foreach ($f in $unused) {
    $tag = "<script src=`"vendor/JIZURA/src/$f`"></script>"
    if (-not $html.Contains($tag)) { throw "index.html no longer loads $f -- update build-win.ps1" }
    $html = [regex]::Replace($html, "[ \t]*$([regex]::Escape($tag))\r?\n", '')
}
[IO.File]::WriteAllText($index, $html, $utf8)

Write-Host "Built: $(Join-Path $out 'jizura-sync.exe')"
