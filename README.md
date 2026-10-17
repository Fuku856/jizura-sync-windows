# jizura-sync for Windows

Windows で再生中の曲を、リアルタイムに歌詞モーションにするアプリ。

この PC で再生中の曲を Windows のメディア操作（音量フライアウトに出るもの）から追い、同期歌詞を [LRCLIB](https://lrclib.net)・[プチリリ](https://petitlyrics.com)・[lrc.red](https://lrc.red)・NetEase（網易雲音楽）から取って、[JIZURA](https://github.com/852wa/JIZURA) で描く。JIZURA は、数百の小さな部品（レイアウト・動き・装飾）を組み合わせて文字PVを組み立てるエンジン。Spotify、Apple Music、ブラウザのタブ（YouTube など）、そのほか Windows のメディア操作に出るプレイヤーなら何でも追える。

見た目は曲ごとに自動で選ばれる。ウィンドウで `R` キーを押すと、別の見た目に変わる。

> **これは [Saqoosha/jizura-sync](https://github.com/Saqoosha/jizura-sync)（macOS アプリ）の非公式フォーク**で、Windows 版を追加したもの。本家の作者とは関係がなく、本家に Windows 版の問い合わせをしないこと。macOS 版は [本家](https://github.com/Saqoosha/jizura-sync) を使う。
>
> **個人のプロジェクトで、サービスではない**。歌詞は LRCLIB などの非公式な経路で取っていて、許諾を得ていない。これで作ったものを共有する前に、[免責事項](#免責事項)を読むこと。

[English](README.en.md)

## Windows 版で追加・改善したこと

- **どのプレイヤーにも追従**: Spotify と Apple Music に限らず、ブラウザで再生している曲にも追従する。再生中のセッションを優先し、何も再生していない間は最後に追っていたものに留まる。バーの再生 / 一時停止・前へ / 次へ・シークは、追っているプレイヤーに送られる。権限の許可は要らない
- **歌詞の取得元を追加**: LRCLIB に加えて、プチリリ・lrc.red・NetEase からも探す。邦楽で歌詞が見つかる曲が大きく増えた。使った取得元はバーに表示する
- **描画品質の自動調整**: JIZURA のカットの中には、1 フレームの時間を大きく超えるもの（円柱・グリッチグリッド系など）がある。フレームが遅れ始めると、ぼかし・ブルームを省く → 解像度を 0.75 倍 → 色ずれの残像を省く → 解像度を 0.5 倍 → 30 fps、の順に 1 段ずつ軽くし、3 秒間遅れがなければ 1 段戻す。計測では、重いカットが 18 fps から 68 fps まで回復した。120 Hz などの高リフレッシュレートのディスプレイでも、描くのは plan の 60 fps の刻みだけにして無駄を省く
- **トランジションの描画を軽く**: カット切り替えのたびに前のカットの静止画を毎フレーム描き直していたのを、同じ絵なので使い回すようにした。キャンバスを不透明にして合成の手間も減らした
- **ジャケットが後から届いても表示**: ブラウザなどは曲名より後にジャケット画像を出すので、届いた時点でバーに反映する
- **シーク直後にスライダーが戻らない**: ブラウザはシークを少し遅れて反映するので、反映されるまで（最大 1 秒）古い位置の読み取りを無視する
- **ページのドラッグでウィンドウを移動**: 下のバー以外をドラッグすると、Windows 標準の移動になる（3 px 以上動かしたときだけ。クリックはクリックのまま）
- **ウィンドウの位置と大きさを記憶**し、次回も同じ場所に開く
- **ダークモードのタイトルバー**とアプリアイコン
- **外部リンクは既定のブラウザで開く**（アプリ内では開かない）
- 最小化中は描画も読み取りも止まり、CPU を使わない

## 必要なもの

- Windows 10 バージョン 2004 以降、または Windows 11（x64）
- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)（x64）
- WebView2 Runtime（Windows 11 には最初から入っている。無い場合は [Microsoft のページ](https://developer.microsoft.com/microsoft-edge/webview2/) から入れる）

## インストール

1. [Releases](https://github.com/Fuku856/jizura-sync-windows/releases) から `jizura-sync-<バージョン>-win-x64.zip` をダウンロードする（今はプレリリースだけ）
2. 好きな場所に展開し、`jizura-sync.exe` を起動する。`WebView2Loader.dll` と `web` フォルダは exe の隣に置いたままにする
3. Spotify や Apple Music、ブラウザで曲を再生する。権限の許可は要らない

コード署名をしていないので、初回は Windows SmartScreen の警告が出ることがある。その場合は「詳細情報」→「実行」で起動する。更新するときは、新しい zip を展開し直す（設定は `%LOCALAPPDATA%\jizura-sync` にあるので引き継がれる）。

### ソースからビルドする

[.NET 10 SDK](https://dotnet.microsoft.com/download)、[Node.js](https://nodejs.org/)（ページの構文チェック用）、[Git](https://git-scm.com/) が要る。PowerShell で:

```powershell
git clone --recursive https://github.com/Fuku856/jizura-sync-windows.git
cd jizura-sync-windows
powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
```

`build\win` に `jizura-sync.exe`・`WebView2Loader.dll`・`web` ができる。`--recursive` を付けずに clone したときは、`git submodule update --init` を実行してからビルドする。

## 使い方

- 再生中のプレイヤーを自動で追い、別のプレイヤーで再生を始めればそちらに切り替わる
- ウィンドウは自由にリサイズできる。手を離すと、JIZURA が描ける形（16:9、9:16、4:3、3:4、1:1、4:5、21:9）のうち一番近いものに合わせる。大きさと、ドラッグしなかった辺は保つ
- 下のバー以外なら、ウィンドウのどこをドラッグしても動かせる
- 歌詞が出ない曲では、理由をウィンドウの中央に出す：見つからない、タイミング付きでない、インストゥルメンタル、検索に失敗した、曲の中の位置がない（ライブ配信など）
- 見えているウィンドウで曲を再生している間は、ディスプレイをスリープさせない
- Windows の表示言語が日本語なら、日本語で表示する

画面下のバーに、ジャケット・曲名・歌詞の取得元（「歌詞: プチリリ」など）と、再生 / 一時停止・前へ / 次へ・シークがある。`?` キーかバーの `?` ボタンで、次の操作一覧が開く。

| キー | |
|---|---|
| クリック、`H` | バーを隠す / 出す（記憶される）。隠していてもエラーは短く表示される |
| `R` | 別の見た目に変える（スタイル・雰囲気・色・書体・使う部品） |
| `U` | 曲のセクション内で見せ方をそろえる（オン、既定）か、行ごとにばらばらに選ぶ（オフ） |
| `K` | 動き: 見た目まかせ → なめらか → カクカク 12 fps → もっとカクカク 8 fps（手描きアニメのコマ打ち） |
| `[` / `]` | 歌詞が曲より先走る・遅れるときに、50 ms 遅らせる / 早める（記憶される） |
| `Space` | 再生 / 一時停止 |
| `F`、ダブルクリック | 全画面 |
| `?`、`Esc` | ヘルプを開く / 閉じる |

## 制限

- 歌詞の質は各ソースのデータ次第。どのソースにも歌詞が無い曲、同期していない歌詞しか無い曲、長さが 4 秒以上ずれた歌詞しか無い曲は、タイトルだけの画面になり、理由を表示する
- 曲の長さを出さないもの（ライブ配信、再生位置を出さないページ、長さを出さないプレイヤー）は「曲の中の位置がない」と表示し、歌詞は出ない
- ブラウザのタブは、ページが曲名・アーティスト・再生位置を Windows に渡している場合だけ正しく追える。一時停止中の位置は、ページが最後に報告したものになる
- 拍への同期は無い。JIZURA は音声から拍を検出してカットを合わせられるが、jizura-sync はプレイヤーの音声を読めない
- 書体は Google Fonts から必要な分だけ読み込む。最初の数曲は、ネットにつながっていないと本来の見た目にならない
- Spotify for Windows と Apple Music for Windows での動作はまだ確認していない（開発機に入っていなかった）。ブラウザのタブでは確認済み
- インストーラー、自動アップデート、コード署名はまだ無い

## 免責事項

このプロジェクトは個人の実験。Spotify・Apple・Microsoft・LRCLIB・プチリリ・lrc.red・NetEase・JIZURA の作者・本家 jizura-sync の作者とは関係がなく、承認も支援も受けていない。無保証で提供する（[LICENSE](LICENSE) を参照）。どう使うかは、動かす人の責任。

- **歌詞は許諾を得ていない**。歌詞は作詞者と音楽出版社の著作物。LRCLIB の歌詞は利用者が投稿したもので、LRCLIB もこのプロジェクトも権利者の許諾を得ていない。プチリリ・lrc.red・NetEase は公開 API ではない口を使っていて（プチリリは同社の Android SDK のアプリ ID を借りている）、各サービスの利用規約に反しうる。このプロジェクトは歌詞の権利を一切持たない。歌詞は実行時に取得するだけで、保存も再配布もしない
- **音楽サービスの API は使わない**。同じ PC で再生中の曲の情報を、Windows のメディアセッションから読むだけ。ただし、それで何かの許諾が得られるわけではない。音源の権利は変わらず各サービスと権利者の側にある

## 開発者向け

ビルドは[ソースからビルドする](#ソースからビルドする)を参照。コードと設計のメモ、変更の確かめ方は [AGENTS.md](AGENTS.md) にある。

### デバッグ

`build\win\jizura-sync.exe` を次の環境変数付きで起動する。

| 変数 | |
|---|---|
| `JIZURA_WEB_ROOT=<リポジトリ>\web` | チェックアウトの `web/` を読む。編集して `F5` で再読み込み |
| `JIZURA_QUERY=mock=Artist\|Title\|durationMs&t=30` | プレイヤーなしで、固定の曲をページ内の時計で再生する |
| `JIZURA_LOG=<ファイル>` | 読み取りとセッションのイベントを記録する |

### リリース

`main` が最新のリリース、`dev` が開発中の版にあたる。GitHub でリリースを公開すると、[`release-windows.yml`](.github/workflows/release-windows.yml) がそのタグをビルドして zip を添付し、リリースノートを書く。

- タグがバージョンになる（`v1.2.3`、プレリリースは `v1.2.3-beta.1`）
- リリースは Target を `main`、プレリリースは `dev` にして作る

### 本家と JIZURA の更新を取り込む

```powershell
git fetch origin                # origin = Saqoosha/jizura-sync
git merge origin/main
```

本家が `mac/`（このリポジトリでは削除済み）を変更していると変更と削除の競合になるので、削除のほうを残す。

```bash
git -C web/vendor/JIZURA fetch --depth 1 origin main
git -C web/vendor/JIZURA checkout FETCH_HEAD
tools/update-jizura-scripts.sh      # web/index.html の <script> タグを作り直す
```

<a id="setup"></a>

### Spotify 用の Web ページ

`web/` のページは、本家と同じくブラウザだけでも Spotify Web API で動く（Windows アプリには関係ない）。Spotify の **Premium** アカウントと、自分で作る開発者アプリの Client ID が要る。

1. `./serve.sh` でページを起動する（`http://127.0.0.1:5180/`）
2. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) で **Create app**。**Redirect URIs** に `http://127.0.0.1:5180/` をそのまま入れ、**Web API** にチェックして保存し、**Client ID** をコピーする
3. <http://127.0.0.1:5180/> を開き、Client ID を貼って **Spotify に接続**

Spotify と Apple の規約は、このような app の公開を認めていない。Client ID は自分で作り、ページを他人向けのサービスとしてホストしないこと。

## Special Thanks

This repository is forked from Saqoosha's jizura-sync.\
https://github.com/Saqoosha/jizura-sync

All of the lyric motion is drawn by 852wa's JIZURA.\
https://github.com/852wa/JIZURA

## ライセンス

MIT（[LICENSE](LICENSE)、© Saqoosha, Fuku856）。JIZURA は © 852wa の MIT ライセンスで、submodule として含めている（`web/vendor/JIZURA/LICENSE` と `THIRD_PARTY_NOTICES.md`）。WebView2 SDK は Microsoft のライセンスで、ビルド時に NuGet から取得する。歌詞は実行時に各ソースから取得するもので、このリポジトリには含まれない。
