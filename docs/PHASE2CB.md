# Phase 2C-B 実装報告・Chromebook実機確認

実装日: 2026-09-26

公開URL: **https://metaborin.github.io/ai-piano-practice/**

Phase 2C-Aはユーザーの実機報告により完了しています。今回の「手本を聴く」は、現在表示している4小節・14音のMusicXMLを元に、PX-100へMIDIを送ります。曲全体の再生・停止・カーソル同期が今回の対象です。Phase 2C-Bの実機受入は未確認です。

## 1. 作成・変更したファイル

新規9ファイル:

- `src/audio/DemoPlayer.ts`: 楽譜から再生イベントを生成し、開始・停止・位置・終了を通知。
- `src/audio/useDemoPlayer.ts`: 練習モードとの同期と、ページ非表示時の停止。
- `src/components/DemoControls.tsx`: 手本を聴く・停止・状態表示。
- `tests/unit/DemoPlayer.test.ts`: 再生・停止・モード分離の15件。
- `tests/unit/readScoreModel.test.ts`: OSMDの音価変換・不正値の2件。
- `tests/e2e/demo.spec.ts`: 手本・カーソル・ループバック・停止等の5件。
- `docs/PHASE2CB.md`: 本報告書。
- `docs/phase2cb-playing.png`、`docs/phase2cb-completed.png`: 模擬MIDIでの画面例。

変更19ファイル:

- `src/score/ScoreModel.ts`、`src/score/readScoreModel.ts`: durationBeatsを追加。
- `src/midi/MidiOutputManager.ts`、`src/midi/useMidi.ts`: 既存出力を手本と共有、任意音高の送信・停止・使用中の排他処理。
- `src/practice/PracticeSession.ts`、`src/practice/usePracticeSession.ts`: demoPlayingで判定を停止し、開始時にリセット。
- `src/App.tsx`、`src/App.css`: 再生位置の表示・主要ボタン。
- `src/components/PracticeControls.tsx`、`src/components/DeveloperControls.tsx`: 手本中の操作制限、練習状態の明示。
- `src/components/MidiOutputPanel.tsx`: C4固定だった出力表示を実際の送信音高に対応。
- `tests/unit/PracticeSession.test.ts`: 既存テストのScoreNoteに音価を追加。
- `tests/e2e/midiFixture.ts`: 出力ループバックとclear非対応のモック。
- `tests/e2e/output.spec.ts`: Phase表示の期待値更新。
- `tests/e2e/practice.spec.ts`: 画面幅変更後のSVG・カーソル再描画を待って座標を比較。
- `index.html`、`README.md`、`docs/GITHUB_PAGES.md`、`docs/PHASE2CA.md`: 現在の機能・検証・受入記録。

MusicXML自体、OSMD表示部品、NoteMatcher、MIDI入力解析・デバッグ部品、Viteのbase、GitHub Actions、npm依存・ロックファイルは維持しています。

画面例: [手本中](phase2cb-playing.png) / [手本完了](phase2cb-completed.png)（いずれも模擬MIDI）

## 2. DemoPlayerの設計

`DemoPlayer` はReact・OSMDのDOM・MIDI実機に依存せず、`DemoOutput` インターフェイスを介して既存出力マネージャーを使用します。

- `loadScore`: ScoreModelを受け取り、旧再生を停止。
- `start`: ScoreModelからイベントを生成し、必ず先頭から再生。再生中の再呼出しは無視。
- `stop`: 次音タイマーを破棄し、出力マネージャーへNote Off・CC123を要求。
- `getSnapshot / subscribe`: `idle / playing / stopped / completed / error`、再生音符index、全音数、案内文を通知。

React側が通知を購読し、画面と既存ScoreViewのカーソルindexを更新します。出力選択・抜き差し・「すべての音を停止」からも再生停止が通知され、シーケンスが終了します。

## 3. MusicXML / ScoreModelから作るデータ

```text
twinkle.musicxml
  ↓ OSMDが読み込み、カーソル位置の音符を順に取得
ScoreModel.notes = [{ midiNote, durationBeats }, ...]
  ├ PracticeSession → 音高の正誤判定
  └ DemoPlayer → startMs / durationMs / noteOffMs / 音符index
                     ↓ 同じindexを既存OSMDカーソルへ
```

`readScoreModel` がOSMDの各音符の `Pitch` と `Length.RealValue` を読みます。Lengthは全音符を1とする分数なので、4倍して四分音符単位の `durationBeats` に変換します。表示・判定・再生の音列は同じカーソル順序に対応します。

手本用の14音配列を本番コードへ追加していません。別のScoreModelで音高・音価が変わるテストも行っています。対象は現在の単旋律で、休符・和音・装飾音・複数声部・タイ・繰り返し等を含む任意の楽譜への汎用対応は今回の範囲外です。

## 4. テンポと音価

現在のMusicXMLにテンポ指定はなく、`DEFAULT_TEMPO_BPM = 100` を使用します。速度変更UIはありません。

```text
durationMs = durationBeats × 60000 / 100
四分音符: 1拍 × 600ms = 600ms
二分音符: 2拍 × 600ms = 1200ms
```

開始位置は前の音価を累積して決めます。最初の音は0ms、7音目の長いソは3600ms、次のファは4800ms、最後のドは8400msです。同音を独立して鳴らすため、Note Offを音価の90%の位置（四分音符540ms後、二分音符1080ms後）に送ります。拍間隔は600ms・1200msのままです。最後のNote Offは9480msで、その時点を正常終了とします。

## 5. MIDI Note On / Offのスケジュール

Channel 1・Velocity 80固定です。

```text
Note On:  [0x90, midiNote, 80]
Note Off: [0x80, midiNote, 0]
```

`performance.now()` の再生開始時刻を基準に、すべての発音予定時刻を計算します。前のタイマーが遅れた分を次音へ累積させません。

停止の確実性を優先し、**未来のNote Onを曲全体分まとめてMIDIキューへ送りません**。各音の開始予定時刻にJSタイマーで起動し、現在または過去になった開始timestampでNote Onを送ります。その音のNote Offは将来timestampで予約します。[Web MIDI仕様のsendとclear](https://www.w3.org/TR/webmidi/#dom-midioutput-send)

これにより `clear()` がない環境でも、停止後に未送信の次音が始まることを防ぎます。一方、Note Onの実際の開始にはJS実行の遅れが影響します。予定から150msを超えて遅れた場合や音の終了時刻を過ぎた場合は、遅れた音をまとめて鳴らさず停止して案内します。これは精度の限界を隠さず、停止を優先する設計上の選択です。

## 6. 停止処理

1. シーケンスの世代番号を更新し、次音・終了タイマーを解除。
2. 対応環境では `MIDIOutput.clear()` で未送信の予約を消去。
3. 最後に送信した音高へ個別Note Offを送信。
4. Channel 1のAll Notes Off `[0xB0, 123, 0]` を送信。
5. 出力表示用タイマーを停止し、手本を `stopped`、練習を `idle` にする。

`clear()` 非対応なら既に送ったNote Offだけが残ります。その予約時刻を過ぎるまで次の手本・練習開始を一時的に無効化し、古いNote Offで次の音が途中消音されないようにします。現在の曲では残り最大約1080msです。機器を切り替えて元の出力へ戻った場合も、その出力の予約時刻を確認します。

再生中の出力選択変更、切断、ページ離脱、別タブ等でページが非表示になった場合も停止します。再接続・表示復帰だけでは自動再生しません。停止送信の一部が例外になっても、個別Note OffとCC123をそれぞれ試みます。物理的に切断済みのPX-100には送信できないため、再接続後に「すべての音を停止」で確認してください。

## 7. カーソル同期

DemoPlayerがNote Onを送るタイミングで `currentNoteIndex` を通知します。UIはそのindexを既存ScoreViewへ渡し、OSMDのカーソルを移動します。音を離して次へ進むまでの短い空白でも、カーソルはその音符上に留まります。

`1 / 14 音` も手本位置に追従します。停止時はその位置、正常終了時は最後の音に残します。「手本を聴く」の再実行と「練習開始」はそれぞれ先頭へ戻します。開発者用の手動カーソルは練習・手本の開始前に使用できます。

## 8. 手本と練習判定の分離

最初のMIDI送信より前に、PracticeSessionを同期的に `demoPlaying` にします。同時に練習index・正解数・フィードバックをリセットします。Reactの次の描画を待って判定を止める構成ではありません。

PracticeSessionの判定条件は `status === practicing` のみです。手本中はNote Onを受けてもNoteMatcherを呼ばず、正解数と練習indexを0のまま維持します。保持鍵盤・Note Offの追跡と入力デバッグは続けます。手本中の `start / restart / moveCursor` も受け付けません。

手本の再生位置はDemoPlayerが管理し、PracticeSessionのindexへコピーしません。終了・停止で練習を `idle` へ戻し、ユーザーが「練習開始」を押して初めて練習を再開します。練習を中断した位置へ自動復帰しません。

## 9. 自動テストと結果

単体テスト70件（既存53 + DemoPlayer 15 + ScoreModel読取2）が成功しました。指定された12項目を含めて確認しています。

- ScoreModelの14音順序・先頭60・同音ごとのOn/Off。
- 100 BPMの四分600ms・二分1200ms、90%位置でのOff、別の音列・音価。
- clearの有無にかかわらず、停止後の次のNote Onが発生しないこと、現在音のOffとCC123。
- 二重開始防止、C4テストとの重複防止、最後のOff後のcompleted、最初からの再再生。
- 練習中断、最初の出力からの同期ループバックでも判定しないこと、終了後の練習。
- 未接続・送信失敗・機器選択・抜き差し、遅延時の停止、古いOffが残る間の待機。

本番ビルドのブラウザーテスト22件（既存17 + 手本5）が成功しました。

- **実際のMusicXML→OSMD→ScoreModel→手本出力**を通し、14音すべての順序と音価を確認。
- 全14位置のOSMDカーソルと進捗表示を確認。
- 練習途中からの手本、模擬ループバックと鍵盤入力中の正解数・練習indexが0のままであること。
- clear非対応の途中停止・再生し直し・非常停止、抜き差し、未選択、送信エラー。
- ページ非表示・離脱時の停止、狭い画面、既存の楽譜・入力・14音練習・C4テスト・Pagesアセット。

MIDIは模擬です。実際のPX-100の発音・消音・体感上の同期は自動テストから断定しません。

## 10. lint / typecheck / build

```sh
npm test
npm run lint
npm run typecheck:tests
npm run test:pages
```

すべて成功。`test:pages` 内でアプリの型検査と本番buildを実行しています。OSMD約1.31MBの既存チャンクサイズ警告は残りますが、ビルドエラーはありません。新規npm依存はありません。

## 11. GitHub Pages

公開URL・`/ai-piano-practice/` base・MusicXMLのraw importを維持します。既存のmain push → GitHub Actionsの検査・build → GitHub Pages公開を使います。今回の新テストも既存ワークフローが自動で拾います。

[Actions実行一覧](https://github.com/metaborin/ai-piano-practice/actions/workflows/deploy-pages.yml)で対象コミットの成功を確認できます。公開後にもHTTPS URLへ同じ22件のブラウザーテストを実行し、完了メッセージで結果を報告します。

## 12. Chromebook実機確認手順

1. Phase 2C-Aで確認済みの双方向配線と機材を使用します。PX-100の電源・音量を確認し、最初はペダルを離します。
2. Chromeで公開URLを再読み込みし、上部の **Phase 2C-B** と **手本を聴く／停止** を確認します。
3. 「MIDI接続」で許可し、下部の出力機器がU2MIDI Pro / CME関連の出力で接続済みになることを確認します。必要なら既存のC4テストを使用します。
4. 「手本を聴く」を押します。**PX-100本体から**「ド ド ソ ソ｜ラ ラ ソー｜ファ ファ ミ ミ｜レ レ ドー」が鳴り、カーソルが1音目から進むことを確認します。
5. 最初のド2回、ソ2回などが独立して鳴り、7音目のソと14音目のドが他の音の約2倍の拍間隔・長さになることを確認します。
6. 途中で「停止」を押し、現在音が消音・減衰して、後続音が鳴らないことを確認します。カーソルが停止位置に留まることも確認します。
7. 再び「手本を聴く」を押し、先頭から再生されること、連打で演奏が重ならないことを確認します。
8. 最後まで聴き、「手本の再生が終わりました」・`14 / 14 音`・最後のNote Offを確認します。
9. 「練習開始」で `1 / 14 音` に戻り、正解・誤音・同音連続・全14音完了・「もう一度」を確認します。
10. 練習途中から「手本を聴く」を押します。手本中に鍵盤も弾き、入力デバッグは更新されても「できた！」や練習の進行が発生しないことを確認します。終了後の練習が1音目から始まることを確認します。
11. 「すべての音を停止」からも手本が止まることを確認します。音が止まった状態で抜き差しし、再接続後は手動で手本を開始できることを確認します。
12. 別タブへ移動すると停止し、戻っても自動で再開しないことを確認します。通常の再生テストはアプリを前面にしたまま行ってください。

音が鳴らない場合は、出力機器・PX-100側MIDI INへの配線・音量・受信チャンネルを確認します。[MIDI権限と公開手順](GITHUB_PAGES.md)

## 13. Phase 2C-B完了条件

**実装・自動検証と実機受入は別です。PX-100で音・同期・停止を確認後にPhase 2C-B完了とします。**

| No. | 条件 | 自動検証 | 今回の実機 |
| --- | --- | --- | --- |
| 1 | 手本を聴くボタン | 確認済み | 未確認 |
| 2 | 1音目から再生 | 確認済み | 未確認 |
| 3 | PX-100からきらきら星が鳴る | MIDIメッセージを模擬検証 | 実際の発音未確認 |
| 4 | 音順が楽譜と一致 | 実際のMusicXMLから確認済み | 未確認 |
| 5 | 四分・二分音符の長さ | 600/1200ms、90% Offを確認済み | 未確認 |
| 6 | カーソル同期 | 全14位置を確認済み | 体感上の同期未確認 |
| 7 | 途中停止 | 確認済み | 未確認 |
| 8 | 停止後に鳴りっぱなしにならない | 個別Off・CC123・次音取消を確認済み | 実際の消音未確認 |
| 9 | 最後まで正常終了 | 最終Off時刻で完了を確認済み | 未確認 |
| 10 | 手本で練習判定が進まない | ループバックを含め確認済み | 未確認 |
| 11 | 手本後の練習開始 | 確認済み | 未確認 |
| 12 | 既存機能を維持 | 全既存テスト成功 | 今回の変更後は再確認待ち |
| 13 | GitHub Pages動作 | 本番サブパス・アセットを確認済み | Chromebook再確認待ち |

## 14. 未解決事項・注意点

- 実際の発音・消音、Chromebookの負荷下でのリズムとカーソル同期は実機確認待ちです。表示とMIDI送信要求だけで確認済みとは扱いません。
- MIDI Note Onの開始にはJSタイマーの遅れが影響します。大きな遅延時・非表示時は停止し、無理に継続しません。高精度なバックグラウンド再生は今回の対象外です。
- 予約消去APIが使えない場合、停止後に短時間ボタンが無効になります。残ったNote Offの期限を待っている状態です。
- 物理的な切断後に停止指示を届けることはできません。再接続後の停止と発音状態を確認してください。
- ペダルや音色による余韻は残る場合があります。まずペダルを離し、同音の区切りと二分音符を確認してください。
- 練習中に手本を押すと途中の進捗はリセットされます。手本後は最初から練習します。手本中から押しっぱなしの鍵盤は、一度離してから弾いてください。
- テンポ変更・部分再生・反復・メトロノーム・リズム評価・AI・保存等は追加していません。

記録欄:

```text
実機確認日 / ChromeOS・Chromeバージョン:
入力機器名 / 出力機器名:
PX-100での14音の発音:
同音の区切り / 長いソ・最後のド:
カーソルとのずれ:
途中停止 / 再度先頭から再生:
最後までの正常終了:
手本中に鍵盤を弾いた結果:
手本後の練習開始・14音完了:
その他:
```
