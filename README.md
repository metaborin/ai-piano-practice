# AIピアノ練習アプリ — Phase 2E-D1.1

曲一覧から練習曲を選び、楽譜を見ながら電子ピアノで正しい鍵盤を順番に弾く練習アプリです。React + TypeScript + Vite、OpenSheetMusicDisplay（OSMD）、Web MIDI API を使用しています。

公開URL: **https://metaborin.github.io/ai-piano-practice/**

**Phase 2E-D1は、ユーザーから「マイム・マイム」の楽譜一致・テンポ・右手／左手／両手・和音についてChromebook + U2MIDI Pro + PX-100での確認完了報告を受領しました。D1.1は楽譜付近のフィードバック、不足音の赤表示、開始位置を選べる手本演奏の改善です。今回の実機受入は別途確認待ちです。D2・Phase 3へは進みません。**

- [Phase 2E-D1.1 の実装報告・音符対応・途中再生・16項目の完了条件・実機確認手順](docs/PHASE2ED11.md)
- [Phase 2E-D1 の実装報告・テンポ優先順位・12項目の完了条件・実曲確認手順](docs/PHASE2ED1.md)
- [Phase 2E-C2 の実装報告・和音判定・25項目の完了条件・実機確認](docs/PHASE2EC2.md)
- [Phase 2E-C1 の実装報告・正規化モデル・17項目の完了条件・実機確認](docs/PHASE2EC1.md)
- [Phase 2E-B の実装報告・保存設計・15項目の完了条件・実機確認](docs/PHASE2EB.md)
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

「＋ 曲を追加」から `.musicxml` / `.xml` / `.mxl` を選び、曲名・作曲者・対応状況を確認して「追加する」を押すと「自分の曲」に保存されます。追加曲はこのブラウザのIndexedDBに保存し、GitHubやサーバーへ送信しません。ページ再読み込み・ブラウザ再起動後も保存領域が残っていれば復元します。サイトデータの削除やプライベート閲覧の終了では失われるため、元のファイルは保管してください。

登録確認の「楽譜解析結果を確認」で小節範囲・Staff・Voice・和音・休符・タイ・手本テンポ・対応状況を確認できます。選択後は「開発者用」でも確認できます。通常画面の現在小節は、PracticeTargetのXML小節番号に従い、練習・手本のカーソルと一緒に進みます。範囲は固定4小節にせず、読み込んだXMLを使用します。検証レポートは構造検査であり、印刷譜との音符の一致を保証するものではありません。

単旋律曲は「選択」で既存の練習・手本演奏を使えます。対応範囲の和音・2Staff・複数Voice・休符・通常のタイを含む曲は「音程練習対応」と表示します。2Staff曲では「練習するパート」の右手・左手・両手を選びます。初期選択は両手です。開発者用の「Score解析」でStaff・Voice・練習Step・期待音などを確認できます。複数Partなど解析範囲外の曲も原文を保存でき、未対応理由を表示します。「削除」→画面内の「削除する」で追加曲だけを削除できます。選択中の曲を削除すると発音・予約を停止してきらきら星へ戻ります。PDF/画像はまだ取り込めません。

和音は最初の必要音から300ms以内に必要な音がすべてそろうと、入力順に関係なく1ステップ進みます。途中は「音をそろえてみよう」、不足・余分な音は「もう一度♪」。楽譜上部に結果と「足りない音」「ちがう音」を表示し、不足した正解の符頭だけを赤くします。余分な音符は描きません。鍵盤を離して弾き直すと赤表示を解除します。単音は待たずに判定します。休符・選択パートに音がない位置・タイ継続音は再打鍵を要求しません。曲やパートを変更すると練習・手本・発音を停止し、先頭の待機状態へ戻ります。

練習開始前のMIDI入力はデバッグ表示のみ更新します。開発確認用の「前の音／次の音」は「開発者用」を開くと使えます。誤操作を避けるため、練習中・完了後は手動移動を無効にします。

300msは和音をまとめる許容幅です。練習時のリズム・テンポ・音の長さ・強弱・ペダルの評価、AI・点数・履歴保存は今回の対象外です。アルペジオ・特殊な装飾・連符などは安全に評価できる範囲へ単純化せず、練習・手本を無効にします。

## 手本を聴く

1. MIDI出力の接続済み表示を確認し、「手本の開始位置」で「最初から」「現在位置から」「指定小節」を選んで「手本を聴く」を押します。選択曲・選択パートの指定位置へカーソルを移してからPX-100本体へ送信します。同じ和音は同じtimestampで発音し、各音価に応じて停止します。
2. MusicXMLの数値テンポを優先し、指定がなければSongのtempoBpm、それもなければ100 BPMです。1拍は `60000 / BPM` ms。116 BPMでは約517.24msです。従来どおり音価の90%の位置にNote Offを入れます。
3. 「停止」で途中停止します。再度「手本を聴く」を押すと選択した開始位置から再生します。指定小節に対象音がなければ次の対象音から始め、以降にもなければメッセージを表示します。
4. 最後のNote Offで「手本の再生が終わりました」と表示します。終了・停止後は元の練習位置と進捗へ戻り、練習中なら続きから弾けます。「もう一度」で練習の先頭へ戻せます。

通常のタイはつながる音価をまとめ、中間の再発音をしません。休符はonsetの間隔で無音になります。同時刻の同じpitchは1回にまとめ、長い方の音価を使用します。XMLの途中の数値テンポ指定も、その位置以降に適用します。タイや長い音がテンポ変更をまたぐ場合も区間ごとの時間を合計します。速度変更UIや演奏テンポの評価は追加していません。

手本を押すと、練習位置・正解数を保持して `demoPlaying` に切り替え、途中の和音判定と赤表示を解除します。手本中の鍵盤入力・MIDIループバックはデバッグ表示だけに反映し、正誤判定を行いません。途中再生の開始点でまだ持続している音・タイは、その残りの長さを新しく発音して再現します。MusicXMLを唯一の原本として、同じXMLからOSMDの楽譜と `ScoreModel` の音高・音価を生成します。曲の音列を別途ハードコードしていません。

予約を消せない環境での確実な停止を優先し、未来のNote Onをまとめてキューへ送りません。開始時刻から計算した絶対時刻で1音ずつNote Onを送り、Note OffはMIDIのtimestampで予約します。画面処理の大きな遅延や別タブへの移動では停止します。停止直後、残ったNote Offが過ぎるまで操作が一時的に無効になる場合があります。[スケジュール方法と実機確認](docs/PHASE2CB.md)

指定位置から曲末までの再生に対応します。終了位置を選ぶ部分練習、楽譜タップによる開始、再生速度変更、反復、メトロノームは追加していません。

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
    SongRepository.ts      # 読み取り契約と、追加/削除の書き込み契約
    BuiltInSongRepository.ts # 非公開の内蔵3曲データと取得
    IndexedDbSongRepository.ts # 追加曲の永続化、トランザクション完了確認
    LibrarySongRepository.ts # 内蔵曲＋追加曲、内蔵曲の書き込み保護
    readSongFile.ts        # XML/MXLの取得と展開サイズ制限
    inspectMusicXml.ts     # メタデータ、基本検証、対応範囲の判定
    libraryRepository.ts   # Repositoryの組み立てと初期選択ID
    loadSongMusicXml.ts    # URL取得・保存済み文字列を同じXML処理へ渡す
    useSongLibrary.ts      # Repositoryから一覧取得・初期選択・再試行
  audio/
    DemoPlayer.ts          # ScoreModelの音価から手本イベント・再生位置・停止を管理
    buildDemoPlan.ts       # 選択パートの発音・休符・タイ・重複pitchを手本へ変換
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
    ScoreModel.ts           # 正規化Note/Rest/Moment、拍・Staff・Voice・Tie・Tempo
    Beat.ts                 # BigIntによる正確な分数の拍計算
    musicXmlDocument.ts     # XML構文検証・DOM読み取り
    parseMusicXml.ts        # chord/backup/forwardから絶対拍位置へ正規化
    toPracticeScore.ts      # 単旋律のみ旧PracticeScoreへ変換
    soundSpans.ts           # 通常タイの接続、物理鍵盤の重複音・重なり検証
    CursorMap.ts            # MomentとOSMDの小節内拍位置・音高を照合
    readScoreModel.ts       # 単旋律のOSMDカーソルと新Parser結果を照合
  practice/
    PracticePlan.ts        # Staffフィルタ、再打鍵対象、元Momentとの対応
    MomentMatcher.ts       # 300ms内の期待音集合とタイムアウト
    NoteMatcher.ts         # MIDI Note Numberの一致比較だけ
    PracticeSession.ts     # 開始・現在音・完了・再開・保持鍵盤
    usePracticeSession.ts  # MIDIイベントとセッションの接続
  components/
    SongLibrary.tsx        # 内蔵曲・自分の曲・選択・削除確認
    SongImport.tsx         # ファイル選択、登録確認、実ScoreModelの検証
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

- 検証項目と今回の結果は [Phase 2E-D1の実装報告](docs/PHASE2ED1.md) を参照。MIDI入出力は模擬し、IndexedDBはブラウザの実装を使用します。
- lint、アプリとテストの型検査、buildを実行。
- `main` にpushすると GitHub Actions が検査・ビルド・ブラウザーテスト後に `dist/` を公開します。
- 今回の実機受入は [Phase 2E-D1チェックリスト](docs/PHASE2ED1.md) を使います。

## npmパッケージ

Phase 2E-BではMXL展開にJSZip 3.10.1を直接依存として追加しました（以前はOSMDの間接依存）。IndexedDBはブラウザ標準APIを使用し、追加ラッパーはありません。

Phase 2E-C1ではNode単体テスト用に `@xmldom/xmldom 0.9.12` を開発依存へ追加しました。公開アプリのParserはブラウザ標準のDOMParserを使用します。DBは引き続きversion 1で、既存曲のXML・メタデータを書き換えません。

| 用途 | パッケージ | バージョン |
| --- | --- | --- |
| UI | react / react-dom | 19.3.0 / 19.3.0 |
| 楽譜 | opensheetmusicdisplay | 2.1.3 |
| MXL展開 | jszip | 3.10.1 |
| 開発・ビルド | vite / @vitejs/plugin-react | 8.3.1 / 6.1.1 |
| 型検査 | typescript | 6.0.3 |
| 型定義 | @types/react / @types/react-dom / @types/node | 19.3.0 / 19.3.0 / 24.19.0 |
| lint | oxlint | 1.85.0 |
| 単体テスト | vitest | 5.0.2 |
| ブラウザーテスト | @playwright/test | 1.63.0 |

OSMDの遅延読み込みチャンクは約1.31MB（gzip約337KB）のため、既存のサイズ警告が出ます。ビルドエラーではありません。`node_modules/`、`dist/`、`test-results/` はGit管理対象外です。
