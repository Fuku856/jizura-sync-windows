# jizura-sync for Windows

A Windows app that turns the song playing on your PC into real-time lyric motion.

jizura-sync follows what plays on this PC through Windows' media controls (the media flyout by the volume control), fetches time-synced lyrics from [LRCLIB](https://lrclib.net), [PetitLyrics](https://petitlyrics.com), [lrc.red](https://lrc.red) and NetEase Cloud Music, and renders them with [JIZURA](https://github.com/852wa/JIZURA), an engine that assembles lyric videos (文字PV) from hundreds of small layout, motion and decoration parts. It follows Spotify, Apple Music, browser tabs (YouTube and the like) and any other player that shows up in Windows' media controls.

A look is picked for each song automatically. Press the `R` key in the window to switch to a different one.

[日本語](README.md)

> **This is an unofficial fork of [Saqoosha/jizura-sync](https://github.com/Saqoosha/jizura-sync) (a macOS app)** that adds a Windows app. It is not affiliated with the upstream author; please do not send questions about the Windows app upstream. For the macOS app, use [upstream](https://github.com/Saqoosha/jizura-sync).
>
> **A personal project, not a service.** The lyrics come from LRCLIB and other unofficial sources and are not licensed. Read the [disclaimer](#disclaimer) before sharing what you make with it.

## What the Windows app adds or improves

- **Follows any player.** Not only Spotify and Apple Music but also songs playing in a browser. A session that is playing wins; while nothing plays it stays on the one it followed last. Play / pause, previous / next and seek in the bar go back to that player. No permission prompt is needed.
- **More lyric sources.** Besides LRCLIB, it also looks in PetitLyrics, lrc.red and NetEase, which finds lyrics for many more Japanese songs. The bar shows which source was used.
- **Drawing quality adapts to the machine.** Some JIZURA cuts (cylinder, glitch grid and the like) take far longer than a frame to draw. While frames come late, the app steps down one level at a time: no blur or bloom → 0.75× resolution → no chromatic ghost passes → 0.5× resolution → 30 fps. After 3 s with no late frame it steps back up one level. In measurements, a heavy cut went from 18 fps to 68 fps. On high-refresh displays such as 120 Hz, it draws only on the plan's 60 fps grid.
- **Lighter transitions.** A cut-to-cut transition redrew the previous cut's resting frame on every frame; it is the same picture each time, so it is now kept and reused. The canvas is opaque, which saves compositing.
- **Covers that arrive late still show.** Browsers and some players send the cover after the title; the bar picks it up when it arrives.
- **The seek slider stays where you put it.** A browser applies a seek a little later, so readings that still carry the old position are ignored until the seek lands (1 s at most).
- **Drag the page to move the window.** A drag anywhere outside the bar becomes Windows' own window move (only once the pointer has moved 3 px, so a click stays a click).
- **Window position and size are remembered**, and the window opens there next time.
- **Dark title bar** and an app icon.
- **Links open in your default browser**, never inside the app.
- While minimized, drawing and reading stop and use no CPU.

## Requirements

- Windows 10 version 2004 or later, or Windows 11 (x64)
- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0) (x64)
- WebView2 Runtime (Windows 11 already has it; otherwise install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/))

## Install

1. Download `jizura-sync-<version>-win-x64.zip` from [Releases](https://github.com/Fuku856/jizura-sync-windows/releases) (pre-releases only for now).
2. Extract it anywhere and run `jizura-sync.exe`. Keep `WebView2Loader.dll` and the `web` folder next to the exe.
3. Play a song in Spotify, Apple Music or a browser. No permission prompt is needed.

The app is not code-signed, so Windows SmartScreen may warn the first time; choose "More info" → "Run anyway". To update, extract the new zip (settings live in `%LOCALAPPDATA%\jizura-sync` and carry over).

### Building from source

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download), [Node.js](https://nodejs.org/) (syntax check of the page) and [Git](https://git-scm.com/). In PowerShell:

```powershell
git clone --recursive https://github.com/Fuku856/jizura-sync-windows.git
cd jizura-sync-windows
powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
```

This makes `jizura-sync.exe`, `WebView2Loader.dll` and `web` in `build\win`. Cloned without `--recursive`? Run `git submodule update --init` before building.

## Using it

- It follows the player that is playing, and switches when you start playing in another one.
- Resize the window freely; when you let go, it snaps to the nearest shape JIZURA draws (16:9, 9:16, 4:3, 3:4, 1:1, 4:5, 21:9), keeping its size and the edges you did not drag.
- Drag anywhere in the window to move it, except on the bar at the bottom.
- When a song shows no lyrics, the middle of the window says why: not found, not time-synced, instrumental, the lookup failed, or no song position to time them to (a live stream and the like).
- The display stays awake while a song plays in a visible window.
- The app is in Japanese when Windows' display language is.

The bar at the bottom shows the cover art, the track, where the lyrics came from ("Lyrics: PetitLyrics" and the like), and play / pause, previous / next and seek. Press `?` or the `?` button for these controls:

| Key | |
|---|---|
| Click, `H` | Hide / show the bar (remembered). Errors still appear briefly while it is hidden |
| `R` | Switch to a different look: style, mood, colours, fonts and the parts used |
| `U` | Same style within each song section (on, the default) or every line styled on its own (off) |
| `K` | Motion: as the look picks → smooth → choppy 12 fps → choppier 8 fps, like hand-drawn animation |
| `[` / `]` | Lyrics 50 ms later / earlier, when they run ahead of or behind the song (remembered) |
| `Space` | Play / pause |
| `F`, double-click | Fullscreen |
| `?`, `Esc` | Open / close the help |

## Limitations

- Lyrics are only as good as the sources' data. Some tracks have none in any of them, or only unsynced text, or none within 4 seconds of the track's length; those show the title card and say why.
- Anything that reports no song length (live streams, pages that set no media position, players that report none) shows the "no song position" notice and gets no lyrics.
- A browser tab is followed correctly only when the page gives Windows the title, artist and position. While paused, the position is whatever the page reported last.
- There is no beat sync. JIZURA can snap cuts to beats detected from audio, but jizura-sync cannot read the player's audio.
- Fonts load from Google Fonts on demand, so the first songs need a network connection to look right.
- Not yet tried with Spotify for Windows or Apple Music for Windows (neither was installed on the dev PC). Browser tabs are tested.
- No installer, auto-update or code signing yet.

## Disclaimer

This project is a personal experiment. It is not affiliated with, endorsed by, or supported by Spotify, Apple, Microsoft, LRCLIB, PetitLyrics, lrc.red, NetEase, the JIZURA author or the upstream jizura-sync author. It is provided as is, without warranty (see [LICENSE](LICENSE)). Whoever runs it is responsible for how they use it.

- **The lyrics are not licensed.** Lyrics are copyrighted works of their writers and publishers. LRCLIB's lyrics are contributed by its users, and neither LRCLIB nor this project has cleared them with the rights holders. PetitLyrics, lrc.red and NetEase are reached through endpoints that are not public APIs (PetitLyrics through the app ID of its own Android SDK), which may break their terms of use. This project holds no rights to any lyrics; it fetches them at runtime and does not store or redistribute them.
- **The app uses no music service API.** It only reads what plays on the same PC from Windows' media sessions. That does not license anything: the recordings are still their services' and rights holders' to license.

## For developers

For building, see [Building from source](#building-from-source). Notes on the code and design, and how to check changes, are in [AGENTS.md](AGENTS.md).

### Debugging

Run `build\win\jizura-sync.exe` with these set:

| Variable | |
|---|---|
| `JIZURA_WEB_ROOT=<repo>\web` | Serve the page from the checkout's `web/`. Edit, then `F5` to reload |
| `JIZURA_QUERY=mock=Artist\|Title\|durationMs&t=30` | Play a fixed song on a local clock with no player |
| `JIZURA_LOG=<file>` | Log readings and session events |

### Releases

`main` is the latest release and `dev` the version in development. Publishing a release on GitHub runs [`release-windows.yml`](.github/workflows/release-windows.yml), which builds that tag, attaches the zip and writes the release notes.

- The tag is the version (`v1.2.3`, or `v1.2.3-beta.1` for a pre-release).
- Create a release with Target `main` and a pre-release with Target `dev`.

### Merging upstream and JIZURA

```powershell
git fetch origin                # origin = Saqoosha/jizura-sync
git merge origin/main
```

An upstream change under `mac/` (deleted in this repo) comes in as a modify/delete conflict; keep the deletion.

```bash
git -C web/vendor/JIZURA fetch --depth 1 origin main
git -C web/vendor/JIZURA checkout FETCH_HEAD
tools/update-jizura-scripts.sh      # regenerates the <script> tags in web/index.html
```

<a id="setup"></a>

### Web page for Spotify

As upstream, the page in `web/` also runs in a browser on its own through the Spotify Web API (it has nothing to do with the Windows app). It needs a Spotify **Premium** account and a Client ID from a developer app of your own.

1. Start the page with `./serve.sh` (`http://127.0.0.1:5180/`).
2. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), choose **Create app**. Under **Redirect URIs**, add exactly `http://127.0.0.1:5180/`, check **Web API**, save, and copy the **Client ID**.
3. Open <http://127.0.0.1:5180/>, paste the Client ID, then **Connect Spotify**.

Spotify's and Apple's terms do not allow publishing an app like this. Create your own Client ID, and do not host the page as a service for others.

## Special Thanks

This repository is forked from Saqoosha's jizura-sync.\
https://github.com/Saqoosha/jizura-sync

All of the lyric motion is drawn by 852wa's JIZURA.\
https://github.com/852wa/JIZURA

## License

MIT, see [LICENSE](LICENSE) (© Saqoosha, Fuku856). JIZURA is © 852wa, MIT licensed, and included as a submodule: see `web/vendor/JIZURA/LICENSE` and its `THIRD_PARTY_NOTICES.md`. The WebView2 SDK is under Microsoft's license and fetched from NuGet at build time. Lyrics are fetched at runtime from those sources and are not part of this repository.
