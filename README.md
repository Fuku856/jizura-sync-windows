# jizura-sync for Windows

Windows で再生中の曲の歌詞を、リアルタイムで歌詞モーションにするアプリ。

再生中の曲を Windows のメディア操作（音量フライアウトに出るもの）から追い、同期歌詞を取得して [JIZURA](https://github.com/852wa/JIZURA) で文字PVとして描く。
見た目は曲ごとに自動で選ばれ、`R` キーで別の見た目に変わる。

> [Saqoosha/jizura-sync](https://github.com/Saqoosha/jizura-sync)（macOS アプリ）の非公式フォーク。

[English](README.en.md)

## 特徴

- **どのプレイヤーにも追従**\
  Spotify・Apple Music・ブラウザのタブ（YouTube など）など、Windows のメディア操作に出るプレイヤーなら何でも追従します。権限の許可は不要です。

- **4 つの歌詞ソース**\
  LRCLIB・[プチリリ](https://petitlyrics.com)・[lrc.red](https://lrc.red)・NetEase から歌詞を探します。使った取得元はバーに表示されます。

- **描画品質の自動調整**\
  重いカットでフレームが遅れると、品質を 1 段ずつ下げて滑らかさを保ちます。

- **軽いトランジション**\
  カット切り替えの描画を使い回し、負荷を減らしています。

- **バーから再生を操作**\
  再生 / 一時停止・前へ / 次へ・シークを、追従中のプレイヤーに送ります。

- **ウィンドウまわり**\
  ページのドラッグで移動でき、位置と大きさは次回も引き継がれます。タイトルバーはダークモードです。

- **最小化中は停止**\
  描画も読み取りも止まり、CPU を使いません。

## 使い方

- 再生中のプレイヤーを自動で追い、別のプレイヤーで再生を始めればそちらに切り替わる
- ウィンドウは自由にリサイズでき、手を離すと JIZURA が描ける縦横比（16:9、9:16、4:3、3:4、1:1、4:5、21:9）に合わせる
- 下のバー以外をドラッグすると、ウィンドウを動かせる
- 歌詞が出ない曲では、理由をウィンドウの中央に出す
- 曲の再生中は、ディスプレイをスリープさせない
- Windows の表示言語が日本語なら、日本語で表示する

画面下のバーに、ジャケット・曲名・歌詞の取得元と、再生の操作がある。マウスを止めて 3 秒たつとカーソルと一緒に隠れ、動かすと戻る。バーのピンボタンで、常に表示にできる。`?` キーかバーの `?` ボタンで、操作一覧が開く。

| キー | |
|---|---|
| クリック | バーをすぐ隠す |
| `H`、ピンボタン | バーを常に表示する / しない |
| `R` | 別の見た目に変える |
| `U` | 見せ方の統一。オン（既定）は A メロ・サビなどのまとまりごとに見せ方をそろえ、繰り返すサビは同じ見せ方にする。オフは歌詞 1 行ずつ別々に選ぶ |
| `K` | 動き: 見た目まかせ → なめらか → 12 fps → 8 fps |
| `[` / `]` | 歌詞を 50 ms 遅らせる / 早める |
| `Space` | 再生 / 一時停止 |
| `F`、ダブルクリック | 全画面 |
| `?`、`Esc` | ヘルプを開く / 閉じる |

## 必要なもの

- Windows 10 バージョン 2004 以降、または Windows 11（x64）
- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)（x64）と WebView2 Runtime。インストーラーは、無ければ Microsoft から取得して入れる（.NET のときだけ管理者の許可を求められる）。zip 版では自分で入れる（WebView2 は Windows 11 には最初から入っている。無い場合は [Microsoft のページ](https://developer.microsoft.com/microsoft-edge/webview2/) から）

## インストール

[Releases](https://github.com/Fuku856/jizura-sync-windows/releases) に、インストーラー（`.exe`）と zip の 2 つがある。中身は同じで、設定も同じ場所（`%LOCALAPPDATA%\jizura-sync`）に置かれる。

コード署名をしていないので、SmartScreen の警告が出ることがある。その場合は「詳細情報」→「実行」で進める。

### インストーラー

1. `jizura-sync-<バージョン>-win-x64.exe` をダウンロードして実行する。管理者権限は要らず、自分のユーザーだけに入る（`%LOCALAPPDATA%\Programs\jizura-sync`）
2. スタートメニューの jizura-sync を起動し、好きなプレイヤー（ブラウザのタブも可）で曲を再生する

- **更新**: 新しい版の exe を実行する。起動中なら閉じてから入れ直す。設定は引き継がれる
- **アンインストール**: Windows の「設定」→「アプリ」から。設定も消すときは、そのあと `%LOCALAPPDATA%\jizura-sync` を消す

### zip

1. `jizura-sync-<バージョン>-win-x64.zip` をダウンロードし、好きな場所に展開する
2. `jizura-sync.exe` を起動する（`WebView2Loader.dll` と `web` フォルダは exe の隣に置いたままにする）

更新するときは、新しい zip を展開し直す。設定は引き継がれる。インストーラー版と zip 版は設定を共有するので、同時には起動できない。

## 制限

- どのソースにも同期歌詞が無い曲や、長さが 4 秒以上ずれた歌詞しか無い曲は、タイトルだけの画面になる
- 曲の長さを出さないもの（ライブ配信など）では、歌詞は出ない
- ブラウザのタブは、ページが曲名・再生位置を Windows に渡している場合だけ正しく追える
- 拍への同期は無い（プレイヤーの音声は読めない）
- 書体は Google Fonts から読み込むので、オフラインでは本来の見た目にならない
- Spotify for Windows と Apple Music for Windows での動作は未確認（ブラウザのタブでは確認済み）
- 自動アップデートとコード署名は無い

## 開発者向け

コードと設計のメモ、変更の確かめ方は [AGENTS.md](AGENTS.md) にある。

### ビルド

[.NET 10 SDK](https://dotnet.microsoft.com/download)、[Node.js](https://nodejs.org/)（ページの構文チェック用）、[Git](https://git-scm.com/) が要る。PowerShell で:

```powershell
git clone --recursive https://github.com/Fuku856/jizura-sync-windows.git
cd jizura-sync-windows
powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
```

`build\win` に `jizura-sync.exe`・`WebView2Loader.dll`・`web` ができる。`--recursive` を付けずに clone したときは、`git submodule update --init` を実行してからビルドする。

インストーラーは [Inno Setup 6](https://jrsoftware.org/isinfo.php)（6.6 以降）で作る。`winget install JRSoftware.InnoSetup` で入れてから:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-installer.ps1 -Version 1.2.3
```

上のビルドに続けて `build\installer\jizura-sync-v1.2.3-win-x64.exe` を作る。`-Version` を省くと csproj の `<Version>` になる。

### デバッグ

`build\win\jizura-sync.exe` を次の環境変数付きで起動する。

| 変数 | |
|---|---|
| `JIZURA_WEB_ROOT=<リポジトリ>\web` | チェックアウトの `web/` を読む。編集して `F5` で再読み込み |
| `JIZURA_QUERY=mock=Artist\|Title\|durationMs&t=30` | プレイヤーなしで、固定の曲をページ内の時計で再生する |
| `JIZURA_LOG=<ファイル>` | 読み取りとセッションのイベントを記録する |

ページだけなら、`./serve.sh` で起動して <http://127.0.0.1:5180/?mock> をブラウザで開いても確かめられる（bash と Python が要る）。

### リリース

`main` が最新のリリース、`dev` が開発中の版にあたる。GitHub でリリースを公開すると、[`release-windows.yml`](.github/workflows/release-windows.yml) がそのタグからインストーラーと zip を作って添付し、リリースノートを書く。

- タグがバージョンになる（`v1.2.3`、プレリリースは `v1.2.3-beta.1`）
- リリースは Target を `main`、プレリリースは `dev` にして作る

### 本家と JIZURA の更新を取り込む

```powershell
git fetch origin                # origin = Saqoosha/jizura-sync
git merge origin/main
```

本家が `mac/`・`web/spotify.js`・`tools/deploy-cloudflare.sh`（このリポジトリでは削除済み）を変更していると変更と削除の競合になるので、削除のほうを残す。`web/app.js` などで Spotify や Tesla の部分が競合したときも、削除のほうを残す。

```bash
git -C web/vendor/JIZURA fetch --depth 1 origin main
git -C web/vendor/JIZURA checkout FETCH_HEAD
tools/update-jizura-scripts.sh      # web/index.html の <script> タグを作り直す
```

## Special Thanks

This repository is forked from Saqoosha's jizura-sync.\
https://github.com/Saqoosha/jizura-sync

All of the lyric motion is drawn by 852wa's JIZURA.\
https://github.com/852wa/JIZURA

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 Fuku856
