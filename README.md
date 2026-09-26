# AIピアノ練習アプリ — Phase 2E-A

曲一覧から練習曲を選び、楽譜を見ながら電子ピアノで正しい鍵盤を順番に弾く練習アプリです。React + TypeScript + Vite、OpenSheetMusicDisplay（OSMD）、Web MIDI API を使用しています。

公開URL: **https://metaborin.github.io/ai-piano-practice/**

**ユーザーからPhase 2Dまで完了との報告を受けています。Phase 2E-Aの曲ライブラリ基盤は実装・自動確認を行い、Chromebook + U2MIDI Pro + PX-100での実機確認を待ちます。Phase 2E-B以降は実装していません。**

- [Phase 2E-A の実装報告・設計・13項目の完了条件・実機確認](docs/PHASE2EA.md)
- [Phase 2D の実装報告・曲の追加手順・実機チェックリスト](docs/PHASE2D.md)

- [Phase 2C-B の実装報告・手本演奏・13項目のチェックリスト](docs/PHASE2CB.md)
- [Phase 2C-A の実装報告・MIDI出力テスト・10項目のチェックリスト](docs/PHASE2CA.md)
- [Phase 2B の実装報告・実機確認・12項目のチェックリスト](docs/PHASE2B.md)
- [GitHub Pages の公開設定・更新手順・ChromeのMIDI許可](docs/GITHUB_PAGES.md)
- [Phase 2A の実機確認記録](docs/PHASE2A_CHECKLIST.md)

## 使い方

1. PX-100 MIDI OUT → CME U2MIDI Pro → Chromebook の接続を使い、Chromeで公開URLを開きます。
2. 「MIDI接続」を押し、Chromeで許可します。`U2MIDI Pro MIDI 1 / CME Pro` を確認します。
3. 「曲ライブラリ」の「練習する曲」で内蔵曲を選びます。初期選択は「きらきら星」。読み込み後に「練習開始」を押すと、選択曲の先頭から始まります。
4. 正しい音は「できた！」と表示され、カーソルが1音進みます。間違った音は「もう一度♪」と表示され、位置を保ちます。
5. 同じ音が続くところは、鍵盤を離してからもう一度押してください。
6. 選択曲の最後まで弾くと「できました！」を表示します。「もう一度」で最初から再開できます。音数はきらきら星14音、ドレミの練習7音、短いメロディ5音です。

練習中・手本再生中にも曲を変更できます。変更時は発音と予約を停止し、進捗をリセットして新しい曲の待機状態になります。MIDI接続と機器選択は維持します。読み込み中・失敗時は練習と手本を開始できません。失敗したら別の曲を選んでください。

「自分の曲」は現在空です。「＋ 曲を追加」はMusicXML / MXLの追加機能を次のPhaseで提供する案内を画面内に表示します。ファイル選択・IndexedDB保存・PDF/画像の追加や表示はまだ行いません。

練習開始前のMIDI入力はデバッグ表示のみ更新します。開発確認用の「前の音／次の音」は「開発者用」を開くと使えます。誤操作を避けるため、練習中・完了後は手動移動を無効にします。

練習時のリズム・テンポ・音の長さの評価、和音・左手・両手・AI・点数・履歴保存は今回の対象外です。

## 手本を聴く（Phase 2C-B）

1. MIDI出力の接続済み表示を確認して「手本を聴く」を押すと、選択曲のMusicXMLから読み込んだ音をPX-100本体で再生します。カーソルも1音目から進みます。
2. 固定100 BPM。四分音符600ms、二分音符1200msの間隔で、音価の90%の位置にNote Offを入れます。同音も独立して鳴らします。
3. 「停止」で途中停止します。再度「手本を聴く」を押すと1音目から再生します。
4. 最後のNote Offで「手本の再生が終わりました」と表示し、カーソルは最後に残します。「練習開始」で最初から弾けます。

手本を押すと、それまでの練習をリセットして `demoPlaying` に切り替えます。手本中の鍵盤入力・MIDIループバックはデバッグ表示だけに反映し、正誤判定を行いません。MusicXMLを唯一の原本として、同じXMLからOSMDの楽譜と `ScoreModel` の音高・音価を生成します。曲の音列を別途ハードコードしていません。

予約を消せない環境での確実な停止を優先し、未来のNote Onをまとめてキューへ送りません。開始時刻から計算した絶対時刻で1音ずつNote Onを送り、Note OffはMIDIのtimestampで予約します。画面処理の大きな遅延や別タブへの移動では停止します。停止直後、残ったNote Offが過ぎるまで操作が一時的に無効になる場合があります。[スケジュール方法と実機確認](docs/PHASE2CB.md)

再生速度・テンポ変更UI、部分再生、反復、メトロノームは追加していません。

## MIDI出力の接続確認（Phase 2C-A）

双方向の接続に加え、**U2MIDI ProのMIDI OUT → PX-100のMIDI IN** を確認します。上記の「MIDI接続」で入出力の許可を共有します。SysExは使いません。

1. ページ下部の「MIDI出力テスト」で出力機器を選び、MIDI出力が接続済みになることを確認します。CME / U2MIDIに関連する名前・メーカーを優先して自動選択します。
2. 「テスト音 C4」でChannel 1にNote 60 / Velocity 80を送り、500ms後の明示的Note Offを予約します。PX-100本体の中央のドが鳴り、止まることを耳で確認します。
3. 「すべての音を停止」はC4のNote OffとCC123 / All Notes Offを送ります。
4. 「最後のMIDI出力」でNote On → Note Off、停止操作でAll Notes Offを確認します。これは送信要求の表示で、発音を検知した表示ではありません。

このC4テストは下部の接続確認用として維持しています。手本再生中はC4テストを無効化し、「すべての音を停止」からも手本を停止できます。[C4テストの実機確認](docs/PHASE2CA.md#9-chromebook実機確認手順)を参照してください。

## 開発環境で起動

Node.js 24系、npmを使用します。`.nvmrc` は `24`、検証環境は Node.js 24.16.0 です。

```sh
cd ai-piano-practice
npm ci
npm run dev
```

同じ端末のChromeで http://localhost:5173/ai-piano-practice/ を開きます。既にプロジェクトのフォルダーにいる場合は `cd` は不要です。

```sh
npm run lint
npm run typecheck:tests
npm test
npm run build
npm run preview
```

本番ビルドのローカルURLは http://localhost:4173/ai-piano-practice/ です。GitHub Pages のサブパス `/ai-piano-practice/` を維持しています。MusicXML は `?url&no-inline` importでViteが生成したURLをRepositoryに登録し、選択時に取得します。XML本文は変更していません。

本番ビルドのブラウザーテスト（初回はChromiumをインストール）:

```sh
npx playwright install chromium
npm run test:pages
```

`npm run test:e2e` は開発サーバー、`npm run test:pages` は本番ビルドを検証します。公開URLへの同じテストの実行方法は [公開手順](docs/GITHUB_PAGES.md) にあります。Chromebookで公開アプリを使うだけなら、Node.js・Linux・Playwrightの導入は不要です。

## 構成

```text
src/
  songs/
    Song.ts                # 保存可能な曲メタデータ、URL/text、元PDF/画像の参照
    SongRepository.ts      # 非同期listSongs/getSong契約
    BuiltInSongRepository.ts # 非公開の内蔵3曲データと取得
    libraryRepository.ts   # Repositoryの組み立てと初期選択ID
    loadSongMusicXml.ts    # URL取得・保存済み文字列を同じXML処理へ渡す
    useSongLibrary.ts      # Repositoryから一覧取得・初期選択・再試行
  audio/
    DemoPlayer.ts          # ScoreModelの音価から手本イベント・再生位置・停止を管理
    useDemoPlayer.ts       # 手本・練習モードの接続と非表示時の停止
  midi/
    MidiManager.ts          # 接続・全イベント通知・最新入力表示用データ
    MidiOutputManager.ts    # 共有MIDIAccessの出力選択・C4送信・停止
    midiTypes.ts            # timestamp / velocity を含むMIDI型
    parseMidiMessage.ts     # Note On / Offの正規化・表示用音名
    useMidi.ts
  score/
    SongSelection.ts       # 取得・要求ID・描画完了の照合・失敗/復帰
    useSongSelection.ts    # 曲変更時の練習停止・消音とモデル適用
    validateMusicXml.ts    # XML形式・対応範囲・対象音の検証
    ScoreModel.ts           # 楽譜ソース・カーソルと同順序のMIDI音列とdurationBeats
    readScoreModel.ts       # OSMDの各カーソル位置から音列を取得
  practice/
    NoteMatcher.ts         # MIDI Note Numberの一致比較だけ
    PracticeSession.ts     # 開始・現在音・完了・再開・保持鍵盤
    usePracticeSession.ts  # MIDIイベントとセッションの接続
  components/
    SongLibrary.tsx        # 内蔵曲・自分の曲・追加ボタンの案内
    ScoreView.tsx
    PracticeControls.tsx
    DeveloperControls.tsx
    MidiStatus.tsx
    MidiDebugPanel.tsx
    MidiOutputPanel.tsx
    DemoControls.tsx
  scores/twinkle.musicxml
  scores/do-re-mi.musicxml
  scores/short-melody.musicxml
  App.tsx
  App.css
  index.css
  main.tsx
tests/
  unit/                    # MIDI・判定・練習状態
  e2e/                     # 楽譜・MIDI・練習のブラウザーテスト
  pages/                   # 本番サブパスと静的アセット
.github/workflows/deploy-pages.yml
```

MIDI受信、楽譜データ、描画、判定、練習状態を分離しています。受信は最新のReact画面状態を経由せず、全イベントを同期的に `PracticeSession` へ届けます。短時間に Note On / Off が連続しても、各イベントを処理します。

## 検証・公開

- 単体テスト: 88件。
- ブラウザーテスト: 開発用38件、本番用39件（MIDI入出力は模擬）。
- lint、アプリとテストの型検査、buildを実行。
- `main` にpushすると GitHub Actions が検査・ビルド・ブラウザーテスト後に `dist/` を公開します。
- 今回の実機受入は [Phase 2E-Aチェックリスト](docs/PHASE2EA.md) を使います。

## npmパッケージ

Phase 2B・2C-A・2C-B・2D・2E-Aで新しいnpmパッケージは追加していません。`package-lock.json` を維持しています。

| 用途 | パッケージ | バージョン |
| --- | --- | --- |
| UI | react / react-dom | 19.3.0 / 19.3.0 |
| 楽譜 | opensheetmusicdisplay | 2.1.3 |
| 開発・ビルド | vite / @vitejs/plugin-react | 8.3.1 / 6.1.1 |
| 型検査 | typescript | 6.0.3 |
| 型定義 | @types/react / @types/react-dom / @types/node | 19.3.0 / 19.3.0 / 24.19.0 |
| lint | oxlint | 1.85.0 |
| 単体テスト | vitest | 5.0.2 |
| ブラウザーテスト | @playwright/test | 1.63.0 |

OSMDの遅延読み込みチャンクは約1.31MB（gzip約337KB）のため、既存のサイズ警告が出ます。ビルドエラーではありません。`node_modules/`、`dist/`、`test-results/` はGit管理対象外です。
