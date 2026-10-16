# jizura-sync for Windows

A Windows app that turns the song playing on your PC into real-time lyric motion.

jizura-sync follows what plays on this PC through Windows' media controls (the media flyout by the volume control), fetches time-synced lyrics from [LRCLIB](https://lrclib.net), and renders them with [JIZURA](https://github.com/852wa/JIZURA), an engine that assembles lyric videos (文字PV) from hundreds of small layout, motion and decoration parts. It follows Spotify, Apple Music, browser tabs (YouTube and the like) and any other player that shows up in Windows' media controls.

A look is picked for each song automatically. Press the `R` key in the window to switch to a different one.

[日本語](README.md)

> **This is an unofficial fork of [Saqoosha/jizura-sync](https://github.com/Saqoosha/jizura-sync) (a macOS app)** that adds a Windows app. It is not affiliated with the upstream author; please do not send questions about the Windows app upstream. For the macOS app, use [upstream](https://github.com/Saqoosha/jizura-sync).
>
> **A personal project, not a service.** The lyrics come from LRCLIB and are not licensed. Read the [disclaimer](#disclaimer) before sharing what you make with it.

## Differences from upstream

| | Upstream (macOS) | This fork (Windows) |
|---|---|---|
| OS | macOS 14 and later | Windows 10 (2004) and later / Windows 11 |
| Players it follows | Spotify and the Music app only | Anything in Windows' media controls (Spotify, Apple Music, browser tabs, others) |
| How it reads playback | Apple Events | Windows' media sessions (GSMTC) |
| Permission prompt | Automation, on first use | None |
| Distribution | Notarized builds, auto-update | Build from source (no installer or auto-update yet) |

### What the Windows app adds or improves

- **Follows any player.** Not only Spotify and Apple Music but also songs playing in a browser. A session that is playing wins; while nothing plays it stays on the one it followed last. Play / pause, previous / next and seek in the bar go back to that player.
- **Drawing quality adapts to the machine** (not in upstream). Some JIZURA cuts (cylinder, glitch grid and the like) take far longer than a frame to draw. While frames come late, the app steps down one level at a time: no blur or bloom → 0.75× resolution → no chromatic ghost passes → 0.5× resolution → 30 fps. After 3 s with no late frame it steps back up one level. In measurements, a heavy cut went from 18 fps to 68 fps. On high-refresh displays such as 120 Hz, it draws only on the plan's 60 fps grid.
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
- [.NET 10 SDK](https://dotnet.microsoft.com/download) to build (the .NET 10 Desktop Runtime is enough to run it)
- [Node.js](https://nodejs.org/) (syntax check of the page during the build)
- [Git](https://git-scm.com/)
- WebView2 Runtime (Windows 11 already has it; otherwise install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/))

## Install

There is no Windows release yet, so build it from source. In PowerShell:

```powershell
git clone --recursive -b windows https://github.com/Fuku856/jizura-sync.git
cd jizura-sync
powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
```

This makes `build\win\jizura-sync.exe`; run it. You can move the whole `build\win` folder anywhere (the `web` folder must stay next to the exe).

Cloned without `--recursive`? Run `git submodule update --init` before building.

Once it runs, play a song in Spotify, Apple Music or a browser. No permission prompt is needed.

## Using it

- It follows the player that is playing, and switches when you start playing in another one.
- Resize the window freely; when you let go, it snaps to the nearest shape JIZURA draws (16:9, 9:16, 4:3, 3:4, 1:1, 4:5, 21:9), keeping its size and the edges you did not drag.
- Drag anywhere in the window to move it, except on the bar at the bottom.
- When a song shows no lyrics, the middle of the window says why: not found, not time-synced, instrumental, the lookup failed, or no song position to time them to (a live stream and the like).
- The display stays awake while a song plays in a visible window.
- The app is in Japanese when Windows' display language is.

The bar at the bottom shows the cover art, the track, and play / pause, previous / next and seek. Press `?` or the `?` button for these controls:

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

- Lyrics are only as good as LRCLIB's community data. Some tracks have none, or only unsynced text, or none within 4 seconds of the track's length; those show the title card and say why.
- Anything that reports no song length (live streams, pages that set no media position, players that report none) shows the "no song position" notice and gets no lyrics.
- A browser tab is followed correctly only when the page gives Windows the title, artist and position. While paused, the position is whatever the page reported last.
- There is no beat sync. JIZURA can snap cuts to beats detected from audio, but jizura-sync cannot read the player's audio.
- Fonts load from Google Fonts on demand, so the first songs need a network connection to look right.
- Not yet tried with Spotify for Windows or Apple Music for Windows (neither was installed on the dev PC). Browser tabs are tested.
- No installer, auto-update or code signing yet.

## Disclaimer

This project is a personal experiment. It is not affiliated with, endorsed by, or supported by Spotify, Apple, Microsoft, LRCLIB, the JIZURA author or the upstream jizura-sync author. It is provided as is, without warranty (see [LICENSE](LICENSE)). Whoever runs it is responsible for how they use it.

- **The lyrics are not licensed.** Lyrics are copyrighted works of their writers and publishers. LRCLIB's lyrics are contributed by its users, and neither LRCLIB nor this project has cleared them with the rights holders. This project holds no rights to any lyrics; it fetches them at runtime and does not store or redistribute them.
- **The app uses no music service API.** It only reads what plays on the same PC from Windows' media sessions. That does not license anything: the recordings are still their services' and rights holders' to license.

## For developers

### Debugging environment variables

Run `build\win\jizura-sync.exe` with these set:

| Variable | |
|---|---|
| `JIZURA_WEB_ROOT=<repo>\web` | Serve the page from the checkout's `web/` instead of the built copy. Edit, then `F5` to reload |
| `JIZURA_QUERY=mock=Artist\|Title\|durationMs&t=30` | Play a fixed song on a local clock with no player. `quality=N` pins drawing quality at level N (0–5) |
| `JIZURA_LOG=<file>` | Log every reading and session event |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` | Open CDP on the page (`http://127.0.0.1:9333/json`) |

In the devtools console, `jizuraSync.perf` shows the quality level, canvas size and frame time; `jizuraSync.plan` / `.song` show the current plan and lyrics.

### How it works

- **Playback.** The app reads title, artist, cover, position and play state from Windows' Global System Media Transport Controls (the same sessions the volume flyout shows). It reads right away whenever a session announces a change of track, play state or timeline, and also once a second while something plays. Paused or idle, it only waits for events. Sessions belong to other processes, so every call has a 2 s timeout.
- **Lyrics.** Lyrics come from LRCLIB's synced LRC files, matched by artist, title and duration; a lookup that hits an LRCLIB outage is retried twice. LRC is close to JIZURA's own lyric format, so the conversion only escapes JIZURA's markup characters and marks song sections.
- **Rendering.** The window is WinForms + WebView2 running the page in `web/`, served from the virtual host `https://app.jizura-sync.test/` (that origin owns the page's localStorage, so do not change it). JIZURA builds a plan for the whole song once, and its renderer is a pure function of time, so drawing the current playback position every frame is all the sync there is.

Detailed notes on the code and design are in [AGENTS.md](AGENTS.md).

### Merging upstream

To keep upstream merges clean, this fork leaves the Mac, Spotify web page and Tesla code in place (the Windows build does not use them).

```powershell
git fetch origin                # origin = Saqoosha/jizura-sync
git merge origin/main
```

### Updating JIZURA

```bash
git -C web/vendor/JIZURA fetch --depth 1 origin main
git -C web/vendor/JIZURA checkout FETCH_HEAD
tools/update-jizura-scripts.sh      # regenerates the <script> tags in web/index.html (needs bash)
```

The page loads JIZURA's `src/*.js` directly, in filename order, and skips its editor UI `src/12_ui.js`. The Windows build also leaves out the audio analysis `10_audio.js` and the export `11_export.js`.

## Acknowledgements

All of the lyric motion is [JIZURA](https://github.com/852wa/JIZURA) by [852wa](https://github.com/852wa). Every layout, motion, decoration and random look on screen is JIZURA's work. You can try the original, with its editor and video export, at <https://852wa.github.io/JIZURA/>.

The app is built on [jizura-sync](https://github.com/Saqoosha/jizura-sync) by [Saqoosha](https://github.com/Saqoosha); this fork adds a Windows host and drawing improvements to it. Both are published under the MIT license, which made this Windows app possible. Thank you.

## License

MIT, see [LICENSE](LICENSE). JIZURA is © 852wa, MIT licensed, and included as a submodule: see `web/vendor/JIZURA/LICENSE` and its `THIRD_PARTY_NOTICES.md`. The WebView2 SDK is under Microsoft's license and fetched from NuGet at build time. Lyrics are fetched at runtime from LRCLIB and are not part of this repository.
