# jizura-sync for Windows

Windows で再生中の曲を、リアルタイムに歌詞モーションにするアプリ。

この PC で再生中の曲を Windows のメディア操作（音量フライアウトに出るもの）から追い、同期歌詞を [LRCLIB](https://lrclib.net) から取って、[JIZURA](https://github.com/852wa/JIZURA) で描く。JIZURA は、数百の小さな部品（レイアウト・動き・装飾）を組み合わせて文字PVを組み立てるエンジン。Spotify、Apple Music、ブラウザのタブ（YouTube など）、そのほか Windows のメディア操作に出るプレイヤーなら何でも追える。

見た目は曲ごとに自動で選ばれる。ウィンドウで `R` キーを押すと、別の見た目に変わる。

> **これは [Saqoosha/jizura-sync](https://github.com/Saqoosha/jizura-sync)（macOS アプリ）の非公式フォーク**で、Windows 版を追加したもの。本家の作者とは関係がなく、本家に Windows 版の問い合わせをしないこと。macOS 版は [本家](https://github.com/Saqoosha/jizura-sync) を使う。
>
> **個人のプロジェクトで、サービスではない**。歌詞は LRCLIB から取っていて、許諾を得ていない。これで作ったものを共有する前に、[免責事項](#免責事項)を読むこと。

[English](README.en.md)

## 本家との違い

| | 本家（macOS） | このフォーク（Windows） |
|---|---|---|
| 対応 OS | macOS 14 以降 | Windows 10 (2004) 以降 / Windows 11 |
| 追えるプレイヤー | Spotify とミュージックApp だけ | Windows のメディア操作に出るものすべて（Spotify、Apple Music、ブラウザのタブ、その他） |
| 再生状態の取得 | Apple Events | Windows のメディアセッション（GSMTC） |
| 権限の許可 | 初回にオートメーションの許可が要る | 不要 |
| 配布 | 公証済みビルド、自動アップデート | ソースからビルド（インストーラー・自動アップデートは未対応） |

### Windows 版で追加・改善したこと

- **どのプレイヤーにも追従**: Spotify と Apple Music に限らず、ブラウザで再生している曲にも追従する。再生中のセッションを優先し、何も再生していない間は最後に追っていたものに留まる。バーの再生 / 一時停止・前へ / 次へ・シークは、追っているプレイヤーに送られる
- **描画品質の自動調整**（本家にない機能）: JIZURA のカットの中には、1 フレームの時間を大きく超えるもの（円柱・グリッチグリッド系など）がある。フレームが遅れ始めると、ぼかし・ブルームを省く → 解像度を 0.75 倍 → 色ずれの残像を省く → 解像度を 0.5 倍 → 30 fps、の順に 1 段ずつ軽くし、3 秒間遅れがなければ 1 段戻す。計測では、重いカットが 18 fps から 68 fps まで回復した。120 Hz などの高リフレッシュレートのディスプレイでも、描くのは plan の 60 fps の刻みだけにして無駄を省く
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
- [.NET 10 SDK](https://dotnet.microsoft.com/download)（ビルド用。実行だけなら .NET 10 Desktop Runtime）
- [Node.js](https://nodejs.org/)（ビルド時のページの構文チェック用）
- [Git](https://git-scm.com/)
- WebView2 Runtime（Windows 11 には最初から入っている。無い場合は [Microsoft のページ](https://developer.microsoft.com/microsoft-edge/webview2/) から入れる）

## インストール

Windows 向けの配布ビルドはまだ無いので、ソースからビルドする。PowerShell で:

```powershell
git clone --recursive -b windows https://github.com/Fuku856/jizura-sync-windows.git
cd jizura-sync
powershell -ExecutionPolicy Bypass -File tools/build-win.ps1
```

`build\win\jizura-sync.exe` ができるので、それを起動する。`build\win` フォルダごと好きな場所に移してよい（`web` フォルダが exe の隣に要る）。

`--recursive` を付けずに clone したときは `git submodule update --init` を実行してからビルドする。

起動したら、Spotify や Apple Music、ブラウザで曲を再生する。権限の許可は要らない。

## 使い方

- 再生中のプレイヤーを自動で追い、別のプレイヤーで再生を始めればそちらに切り替わる
- ウィンドウは自由にリサイズできる。手を離すと、JIZURA が描ける形（16:9、9:16、4:3、3:4、1:1、4:5、21:9）のうち一番近いものに合わせる。大きさと、ドラッグしなかった辺は保つ
- 下のバー以外なら、ウィンドウのどこをドラッグしても動かせる
- 歌詞が出ない曲では、理由をウィンドウの中央に出す：見つからない、タイミング付きでない、インストゥルメンタル、検索に失敗した、曲の中の位置がない（ライブ配信など）
- 見えているウィンドウで曲を再生している間は、ディスプレイをスリープさせない
- Windows の表示言語が日本語なら、日本語で表示する

画面下のバーに、ジャケット・曲名と、再生 / 一時停止・前へ / 次へ・シークがある。`?` キーかバーの `?` ボタンで、次の操作一覧が開く。

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

- 歌詞の質は LRCLIB のデータ次第。歌詞が無い曲、同期していない歌詞しか無い曲、長さが 4 秒以上ずれた歌詞しか無い曲は、タイトルだけの画面になり、理由を表示する
- 曲の長さを出さないもの（ライブ配信、再生位置を出さないページ、長さを出さないプレイヤー）は「曲の中の位置がない」と表示し、歌詞は出ない
- ブラウザのタブは、ページが曲名・アーティスト・再生位置を Windows に渡している場合だけ正しく追える。一時停止中の位置は、ページが最後に報告したものになる
- 拍への同期は無い。JIZURA は音声から拍を検出してカットを合わせられるが、jizura-sync はプレイヤーの音声を読めない
- 書体は Google Fonts から必要な分だけ読み込む。最初の数曲は、ネットにつながっていないと本来の見た目にならない
- Spotify for Windows と Apple Music for Windows での動作はまだ確認していない（開発機に入っていなかった）。ブラウザのタブでは確認済み
- インストーラー、自動アップデート、コード署名はまだ無い

## 免責事項

このプロジェクトは個人の実験。Spotify・Apple・Microsoft・LRCLIB・JIZURA の作者・本家 jizura-sync の作者とは関係がなく、承認も支援も受けていない。無保証で提供する（[LICENSE](LICENSE) を参照）。どう使うかは、動かす人の責任。

- **歌詞は許諾を得ていない**。歌詞は作詞者と音楽出版社の著作物。LRCLIB の歌詞は利用者が投稿したもので、LRCLIB もこのプロジェクトも権利者の許諾を得ていない。このプロジェクトは歌詞の権利を一切持たない。歌詞は実行時に取得するだけで、保存も再配布もしない
- **音楽サービスの API は使わない**。同じ PC で再生中の曲の情報を、Windows のメディアセッションから読むだけ。ただし、それで何かの許諾が得られるわけではない。音源の権利は変わらず各サービスと権利者の側にある

## 開発者向け

### デバッグ用の環境変数

`build\win\jizura-sync.exe` を次の環境変数付きで起動できる。

| 変数 | |
|---|---|
| `JIZURA_WEB_ROOT=<リポジトリ>\web` | ビルドに含めたページではなく、チェックアウトの `web/` を読む。編集して `F5` で再読み込み |
| `JIZURA_QUERY=mock=Artist\|Title\|durationMs&t=30` | プレイヤーなしで、固定の曲をページ内の時計で再生する。`quality=N` で描画品質を段階 N（0〜5）に固定 |
| `JIZURA_LOG=<ファイル>` | 読み取りとセッションのイベントをすべて記録する |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` | ページに CDP でつなげる（`http://127.0.0.1:9333/json`） |

開発者ツールのコンソールでは `jizuraSync.perf` で描画品質の段階・キャンバスの大きさ・フレーム時間、`jizuraSync.plan` / `.song` で現在の plan と歌詞を見られる。

### 仕組み

- **再生状態**: Windows の Global System Media Transport Controls（音量フライアウトと同じセッション）から、曲名・アーティスト・ジャケット・再生位置・再生状態を読む。曲・再生状態・再生位置が変わったという通知のたびにすぐ読み、再生中は 1 秒ごとにも読む。一時停止中や再生なしのときは通知を待つだけ。セッションは別プロセスのものなので、各呼び出しに 2 秒のタイムアウトを付けている
- **歌詞**: LRCLIB の同期歌詞（LRC）を、アーティスト・曲名・長さで引く。LRCLIB が一時的に落ちているときは 2 回まで再試行する。LRC は JIZURA の歌詞記法にほぼそのまま渡せるので、変換で行うのは JIZURA の記号のエスケープと、セクションの区切りだけ
- **描画**: ウィンドウは WinForms + WebView2 で、中身は `web/` のページ。ページは `https://app.jizura-sync.test/` の仮想ホストで配信する（この origin がページの localStorage を持つので変えないこと）。JIZURA は曲全体の plan を 1 回だけ作り、レンダラは時刻の純関数なので、毎フレーム現在の再生位置の瞬間を描くだけで同期する

コードと設計の詳しいメモは [AGENTS.md](AGENTS.md) にある。

<a id="setup"></a>

### Spotify 用の Web ページ

`web/` のページは、本家と同じくブラウザだけでも動く。Spotify Web API を通して、どのデバイスで再生している Spotify にも追従する。Spotify の **Premium** アカウントと、自分で作る無料の開発者アプリ（Client ID）が要る。Windows アプリには関係なく、使わないなら読まなくてよい。

1. `./serve.sh` でページを起動する（`http://127.0.0.1:5180/`、bash が要る）
2. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) で **Create app**。**Redirect URIs** に `http://127.0.0.1:5180/` をそのまま入れ（末尾の `/` も要る。`localhost` は拒否される）、**Web API** にチェックして保存し、**Client ID** をコピーする
3. <http://127.0.0.1:5180/> を開き、Client ID を貼って **Spotify に接続**

ほかのアカウントで使う、ポートを変える、自分でホストする、Tesla のブラウザで使う、といった詳しい手順は [本家の README](https://github.com/Saqoosha/jizura-sync#web-page-for-spotify) にある。

**Spotify と Apple の規約は、このような app の公開を認めていない**（Spotify Developer Policy III は音源と映像の同期を禁じ、Apple の MusicKit の規約も他のコンテンツとの同期を禁じている）。Client ID は自分で作り、ほかのプロジェクトのものを流用しないこと。Web ページを他人向けのサービスとしてホストしないこと。

### 本家の更新を取り込む

このリポジトリは Windows 専用で、本家の Mac アプリ（`mac/`、Sparkle、署名・公証・リリースのスクリプト）は削除した。Spotify 用の Web ページと Tesla 向けのデプロイは残しているので、本家の `web/` の変更はそのまま取り込める。

```powershell
git fetch origin                # origin = Saqoosha/jizura-sync
git merge origin/main
```

本家が `mac/` を変更していると、変更と削除の競合になる。そのときは削除のほうを残す（`git rm` で解決する）。

### JIZURA の更新

```bash
git -C web/vendor/JIZURA fetch --depth 1 origin main
git -C web/vendor/JIZURA checkout FETCH_HEAD
tools/update-jizura-scripts.sh      # web/index.html の <script> タグを作り直す（bash が要る）
```

ページは JIZURA の `src/*.js` をファイル名順に直接読み込む。エディタ UI の `src/12_ui.js` は読まず、Windows のビルドではさらに音声解析の `10_audio.js` と書き出しの `11_export.js` も外す。

## 謝辞

歌詞モーションはすべて、[852wa](https://github.com/852wa) さんの [JIZURA](https://github.com/852wa/JIZURA) によるもの。画面に出るレイアウト・動き・装飾・ランダムな見た目は、どれも JIZURA の仕事。エディタや動画書き出しを備えた本家は <https://852wa.github.io/JIZURA/> で試せる。

アプリの土台は [Saqoosha](https://github.com/Saqoosha) さんの [jizura-sync](https://github.com/Saqoosha/jizura-sync)。このフォークは、それに Windows のホストと描画の改善を足したもの。どちらも MIT ライセンスで公開されていたから、この Windows 版を作れた。感謝。

## ライセンス

MIT（[LICENSE](LICENSE)、© Saqoosha, Fuku856）。JIZURA は © 852wa の MIT ライセンスで、submodule として含めている（`web/vendor/JIZURA/LICENSE` と `THIRD_PARTY_NOTICES.md`）。WebView2 SDK は Microsoft のライセンスで、ビルド時に NuGet から取得する。歌詞は実行時に LRCLIB から取得するもので、このリポジトリには含まれない。
