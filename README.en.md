# jizura-sync for Windows

A Windows app that turns the lyrics of the song playing on your PC into real-time lyric motion.

It follows what plays through Windows' media controls (the media flyout by the volume control), fetches time-synced lyrics, and renders them as a lyric video (文字PV) with [JIZURA](https://github.com/852wa/JIZURA).
A look is picked for each song automatically; press `R` to switch to a different one.

> An unofficial fork of [Saqoosha/jizura-sync](https://github.com/Saqoosha/jizura-sync) (a macOS app).

[日本語](README.md)

## Features

- **Follows any player**\
  Spotify, Apple Music, browser tabs (YouTube and the like) and anything else in Windows' media controls. No permission prompt is needed.

- **Four lyric sources**\
  Looks in LRCLIB, [PetitLyrics](https://petitlyrics.com), [lrc.red](https://lrc.red) and NetEase. The bar shows which source was used.

- **Adaptive drawing quality**\
  When a heavy cut makes frames late, quality steps down one level at a time to keep motion smooth.

- **Lighter transitions**\
  Cut-to-cut transitions reuse what is already drawn, which lowers the load.

- **Playback controls in the bar**\
  Play / pause, previous / next and seek go to the player being followed.

- **Window niceties**\
  Drag the page to move the window; position and size are remembered; dark title bar.

- **Idle while minimized**\
  Drawing and reading stop and use no CPU.

## Using it

- It follows the player that is playing, and switches when you start playing in another one.
- Resize the window freely; when you let go, it snaps to the nearest shape JIZURA draws (16:9, 9:16, 4:3, 3:4, 1:1, 4:5, 21:9).
- Drag anywhere outside the bar at the bottom to move the window.
- When a song shows no lyrics, the middle of the window says why.
- The display stays awake while a song plays.
- The app is in Japanese when Windows' display language is.

The bar at the bottom shows the cover art, the track, the lyric source and playback controls. Press `?` or the `?` button for the list of controls.

| Key | |
|---|---|
| Click, `H` | Hide / show the bar |
| `R` | Switch to a different look |
| `U` | Unified look. On (the default): each block of the song (verse, chorus and so on) keeps one look, and a repeated chorus looks the same each time. Off: every lyric line is styled on its own |
| `K` | Motion: as the look picks → smooth → 12 fps → 8 fps |
| `[` / `]` | Lyrics 50 ms later / earlier |
| `Space` | Play / pause |
| `F`, double-click | Fullscreen |
| `?`, `Esc` | Open / close the help |

## Requirements

- Windows 10 version 2004 or later, or Windows 11 (x64)
- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0) (x64)
- WebView2 Runtime (Windows 11 already has it; otherwise install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/))

## Install

1. Download `jizura-sync-<version>-win-x64.zip` from [Releases](https://github.com/Fuku856/jizura-sync-windows/releases).
2. Extract it anywhere and run `jizura-sync.exe` (keep `WebView2Loader.dll` and the `web` folder next to the exe).
3. Play a song in any player (a browser tab works too).

The app is not code-signed, so SmartScreen may warn the first time; choose "More info" → "Run anyway".

To update, extract the new zip. Settings live in `%LOCALAPPDATA%\jizura-sync` and carry over.

## Limitations

- Songs with no synced lyrics in any source, or none within 4 seconds of the track's length, show a title card only.
- Anything that reports no song length (live streams and the like) gets no lyrics.
- A browser tab is followed correctly only when the page gives Windows the title and position.
- No beat sync (the player's audio cannot be read).
- Fonts load from Google Fonts, so offline the looks are not quite right.
- Not yet tried with Spotify for Windows or Apple Music for Windows (browser tabs are tested).
- No installer, auto-update or code signing.

## For developers

Notes on the code and design, and how to check changes, are in [AGENTS.md](AGENTS.md).

### Building

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download), [Node.js](https://nodejs.org/) (syntax check of the page) and [Git](https://git-scm.com/). In PowerShell:

```powershell
git clone --recursive https://github.com/Fuku856/jizura-sync-windows.git
cd jizura-sync-windows
powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
```

This makes `jizura-sync.exe`, `WebView2Loader.dll` and `web` in `build\win`. Cloned without `--recursive`? Run `git submodule update --init` before building.

### Debugging

Run `build\win\jizura-sync.exe` with these set:

| Variable | |
|---|---|
| `JIZURA_WEB_ROOT=<repo>\web` | Serve the page from the checkout's `web/`. Edit, then `F5` to reload |
| `JIZURA_QUERY=mock=Artist\|Title\|durationMs&t=30` | Play a fixed song on a local clock with no player |
| `JIZURA_LOG=<file>` | Log readings and session events |

For the page alone, start `./serve.sh` and open <http://127.0.0.1:5180/?mock> in a browser (needs bash and Python).

### Releases

`main` is the latest release and `dev` the version in development. Publishing a release on GitHub runs [`release-windows.yml`](.github/workflows/release-windows.yml), which builds that tag, attaches the zip and writes the release notes.

- The tag is the version (`v1.2.3`, or `v1.2.3-beta.1` for a pre-release).
- Create a release with Target `main` and a pre-release with Target `dev`.

### Merging upstream and JIZURA

```powershell
git fetch origin                # origin = Saqoosha/jizura-sync
git merge origin/main
```

An upstream change to `mac/`, `web/spotify.js` or `tools/deploy-cloudflare.sh` (deleted in this repo) comes in as a modify/delete conflict; keep the deletion. Keep it too when the Spotify or Tesla parts of `web/app.js` and the like conflict.

```bash
git -C web/vendor/JIZURA fetch --depth 1 origin main
git -C web/vendor/JIZURA checkout FETCH_HEAD
tools/update-jizura-scripts.sh      # regenerates the <script> tags in web/index.html
```

## Special Thanks

This repository is forked from Saqoosha's jizura-sync.\
https://github.com/Saqoosha/jizura-sync

All of the lyric motion is drawn by 852wa's JIZURA.\
https://github.com/852wa/JIZURA

## License

[MIT License](LICENSE) — Copyright (c) 2026 Fuku856
