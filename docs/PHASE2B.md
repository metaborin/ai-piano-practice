# Phase 2B 実装報告・Chromebook受入確認

実装日: 2026-09-26

対象: CASIO Privia PX-100 → CME U2MIDI Pro → Chromebook / Chrome

公開URL: **https://metaborin.github.io/ai-piano-practice/**

Phase 2A はユーザーによる実機確認が完了しています。Phase 2B の実装と自動検証を行い、今回追加した練習動作のChromebook実機受入は確認待ちです。

## 1. 作成・変更したファイル

新規作成:

- `src/practice/NoteMatcher.ts`
- `src/practice/PracticeSession.ts`
- `src/practice/usePracticeSession.ts`
- `src/score/readScoreModel.ts`
- `src/components/DeveloperControls.tsx`
- `tests/unit/NoteMatcher.test.ts`
- `tests/unit/PracticeSession.test.ts`
- `tests/e2e/session.spec.ts`
- `docs/PHASE2B.md`
- `docs/phase2b-practicing.png`
- `docs/phase2b-completed.png`

変更:

- `src/App.tsx`、`src/App.css`、`index.html`
- `src/components/PracticeControls.tsx`、`src/components/ScoreView.tsx`
- `src/midi/MidiManager.ts`、`src/midi/midiTypes.ts`、`src/midi/useMidi.ts`
- `src/score/ScoreModel.ts`
- `tests/e2e/practice.spec.ts`
- `playwright.pages.config.ts`（コメントのみ）
- `.github/workflows/deploy-pages.yml`（検証ステップの表示名のみ）
- `README.md`、`docs/GITHUB_PAGES.md`、`docs/PHASE2A_CHECKLIST.md`

既存のMusicXML、MIDI正規化処理、MIDIデバッグ表示部品、Viteのbase設定、npm依存・ロックファイルは変更していません。

## 2. 実装内容

「練習開始」から14音を順番に判定します。正解で「できた！」と表示して次の音へ進み、間違いは「もう一度♪」と表示して同じ音に留まります。14音目の正解で「できました！」となり、カーソルは最後の音に残ります。「もう一度」は練習途中・完了後のどちらでも、最初から練習し直せます。

表示する音列と判定用の音列を二重管理しません。OSMDでMusicXMLを読み込み、カーソルを先頭から順にたどって、その位置の音高をMIDI Noteに変換し `ScoreModel.notes` に格納します。`currentNoteIndex` はこの配列と画面カーソルの両方に使います。今回の曲は4小節・14音です。

```text
60 60 67 67 | 69 69 67 | 65 65 64 64 | 62 62 60
```

楽譜のSVGを直接書き換える音符の色変更は追加していません。現在位置は既存OSMDカーソルを使用します。手動ボタンは折りたたみ式「開発者用」に置き、練習中・完了後には無効化しています。

画面例（模擬MIDI入力）: [練習中](phase2b-practicing.png) / [完了](phase2b-completed.png)

## 3. NoteMatcherの仕様

`matchNote(expectedMidiNote, playedMidiNote)` は、数値が等しければ `correct`、異なれば `incorrect` を返す純粋関数です。C4等の音名文字列・Velocity・timestampは比較しません。例えば60と72は別の音として扱います。

## 4. PracticeSessionの仕様

ブラウザー・React・OSMDを必要としない状態管理クラスです。主な状態:

| 項目 | 内容 |
| --- | --- |
| currentNoteIndex | 0始まり。表示は1を足して `1 / 14 音` 等にする |
| totalNotes | ScoreModelから取得した音数（今回14） |
| expectedMidiNote | 現在のカーソル位置の正解音。未読み込み時はnull |
| correctNoteCount | 順番に受理した音の数。点数として表示・保存しない |
| status | `idle` / `practicing` / `completed` |
| feedback | `null` / `correct` / `incorrect` |

- 読み込み後は `idle`、先頭の音です。開始前の演奏は判定しません。
- 楽譜読み込みとMIDI接続が完了すると「練習開始」を押せます。
- `start()` と `restart()` は先頭・正解数0・フィードバックなし・`practicing` にします。
- `moveCursor()` は `idle` の開発確認に限り使えます。判定対象の音も同じindexで更新します。練習開始で必ず先頭に戻します。
- 正解が13音の状態は `14 / 14 音` で練習中です。最後の音も正解して初めて `completed` にします。内部indexは13のままです。
- 完了後の演奏で練習状態は変わりません。MIDIデバッグ表示は更新されます。
- MIDIの切断・機器切替では保持鍵盤だけをクリアし、練習位置を維持します。再接続後に同じ位置から続けられます。
- 楽譜読み込みに失敗した場合は練習状態を初期化し、開始・手動操作を無効にします。

## 5. 同じ音が連続する場合

`activeNotes` を `channel:midiNote` 単位で管理します。最初のNote Onで押下中として登録し、同じ鍵盤・同じチャンネルの重複Note Onは無視します。Note Offで登録を解除した後のNote Onを新しい打鍵として扱います。

```text
C4 Note On  → 2 / 14 音（1音だけ進む）
C4 Note On  → 2 / 14 音（押しっぱなしの重複は無視）
C4 Note Off → 2 / 14 音（解除だけ）
C4 Note On  → 3 / 14 音（次の打鍵で進む）
```

「練習開始」「もう一度」の時にも、実際に押されている鍵盤の情報は維持します。C4を押したまま開始・再開した場合は、いったん離してから弾いてください。開始操作だけで押しっぱなしの鍵盤を新しい打鍵として数えないためです。

## 6. Note On / Note Offの扱い

判定対象はVelocityが0より大きいNote Onだけです。Note Offと、Velocity 0のNote Onは鍵盤の解除だけに使い、正誤判定・進行には使いません。既存の `parseMidiMessage` による正規化に加え、PracticeSessionにもVelocity 0の防御を置いています。

MIDIイベントは `MidiManager.subscribeNoteEvents` で1件ずつ同期的に通知します。Reactが描画した「最後の入力」を監視して判定する構成にはしていません。1回の画面更新の間に複数のNote On / Offが届いても処理します。

`MidiNoteEvent.timestamp` と `velocity` は保持し、書き換えません。今回、時刻・長さ・強弱は正解条件に使いません。MIDIデバッグの最新入力と直近On / Offも残しています。演奏履歴の永続保存はしません。

## 7. 自動テスト

単体テスト40件が成功しました。既存22件に、NoteMatcher 3件・PracticeSession 15件を追加しています。

指定された10項目（60=60、60≠64、誤音で停止、正解で1音進む、同音連続、14音で完了、完了後入力、再開、Note Off、Velocity 0）を含みます。開始前・開始時に保持中の鍵盤、途中からの再開、別チャンネルのNote Off、切断時の保持解除、空の楽譜、手動操作の制限も確認しています。

本番ビルドのブラウザーテスト12件が成功しました。MIDIは模擬入力です。

- 既存の楽譜・手動操作・MIDI接続・デバッグ・拒否／エラー復旧7件。
- Phase 2Bの練習・再開・完了・抜き差し4件。
- GitHub Pagesのサブパス・静的アセット1件。

14音のOn / Offを1回のブラウザー処理内で連続送信するテストでも完了します。単体試験だけでなく、MIDI受信からReact画面・OSMDまでを通して取りこぼしを検証しています。各手動位置のScoreModelのMIDI音列も、指定された14音と一致することを確認しました。

## 8. lint / typecheck / build

```sh
npm run lint
npm run typecheck:tests
npm test
npm run test:pages
```

Oxlint、テストコードのTypeScript型検査、単体テスト、本番ビルド（`tsc -b && vite build`）、本番ブラウザーテストを実行し、エラーはありません。OSMDの約1.31MBのチャンクに対する既存サイズ警告は残っています。

## 9. GitHub Pages

公開先・`/ai-piano-practice/` のbase・`main` push → GitHub Actions → GitHub Pagesのフローを維持しています。ワークフローの処理は変更せず、表示名だけを現在の練習機能に合わせました。今回追加したテストも既存ワークフローから実行されます。

[Actionsの実行一覧](https://github.com/metaborin/ai-piano-practice/actions/workflows/deploy-pages.yml)で最新mainの `build` と `deploy` が成功したことを確認してください。公開後はページを再読み込みし、上部に **Phase 2B** が表示されることを確認します。

## 10. Chromebook実機確認手順

1. Phase 2Aで確認済みのPX-100 / U2MIDI Proの接続を使います。
2. Chromeで公開URLを開き、再読み込みします。上部の **Phase 2B** と4小節の楽譜を確認します。
3. 「MIDI接続」で許可し、**U2MIDI Pro MIDI 1 / CME Pro / 接続中** を確認します。
4. まだ「練習開始」を押さずにC4を弾きます。最新入力は変わり、カーソルは最初のままであることを確認します。
5. 必要なら「開発者用」を開いて手動ボタンを確認します。その後「練習開始」を押し、必ず1音目に戻ることを確認します。
6. 最初はC4が期待音です。E4等の違う音を押し、「もう一度♪」・`1 / 14 音` のままであることを確認します。
7. C4を1回押します。「できた！」・`2 / 14 音` になります。押しっぱなしでそれ以上進まないことを確認します。
8. C4を離します。Note Offが表示され、位置は `2 / 14 音` のままです。もう一度C4を押すと `3 / 14 音` に進みます。
9. G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4 と続けます。自由な速さ・長さで構いません。同じ音は離してから押します。
10. 最後のC4で `14 / 14 音` と「できました！」が出ます。完了後に別の音を弾いても、カーソルが範囲外に出ず、デバッグ表示が更新されることを確認します。
11. 「もう一度」で `1 / 14 音` と通常の案内へ戻り、再び判定できることを確認します。練習途中でも試してください。
12. 途中でU2MIDI Proを抜き差しし、再接続後に同じ位置から続けられること、MIDIデバッグの表示・Velocity・Channelが維持されていることを確認します。

ChromeのMIDI許可を以前拒否した場合は、サイト情報→サイトの設定→MIDIを許可し、再読み込みしてください。[詳しい公開・許可手順](GITHUB_PAGES.md)

## 11. Phase 2B完了条件

**実装・自動検証は完了、Chromebook + PX-100での今回の練習動作の受入確認待ちです。** Phase 2Aの実機確認を、そのままPhase 2Bの受入確認済みとは扱っていません。

| No. | 完了条件 | 自動検証 | Phase 2B実機 |
| --- | --- | --- | --- |
| 1 | 既存のきらきら星楽譜が正常表示 | 確認済み | 未確認 |
| 2 | U2MIDI Proが正常接続 | 模擬接続確認済み | 未確認（Phase 2Aでは確認済み） |
| 3 | 練習開始で開始できる | 確認済み | 未確認 |
| 4 | 現在音と同じMIDI Noteで正解 | 確認済み | 未確認 |
| 5 | 正解でカーソルが次へ進む | 確認済み | 未確認 |
| 6 | 間違った音では進まない | 確認済み | 未確認 |
| 7 | 連続同音でも1回のNote Onで1音だけ進む | 重複入力も確認済み | 未確認 |
| 8 | Note Offでは進まない | Velocity 0も確認済み | 未確認 |
| 9 | 最終音の正解で「できました！」 | 完了後入力も確認済み | 未確認 |
| 10 | もう一度で1音目から再開 | 途中・完了後を確認済み | 未確認 |
| 11 | MIDIデバッグ表示が正常 | 最新・直近On/Off確認済み | 未確認 |
| 12 | Pages上でも既存機能が正常 | サブパスの本番ビルドを確認済み | 未確認 |

## 12. 未解決事項・注意点

- 今回の実機検証はユーザー側で実施してください。自動テストは模擬MIDIで、実機からの演奏ではありません。
- 対象は現在の単音14音です。休符・和音・装飾音・複数パートなどの汎用追従は実装していません。今回のモデル読み込みでは、カーソル1位置に複数音や休符がある楽譜は開始できません。
- 同じ鍵盤を再判定するにはNote Offが必要です。機器の切断・切替では保持情報をクリアします。開始・再開時の押しっぱなしの鍵盤は離してから弾いてください。
- 1つの選択済みMIDI入力の全チャンネルを受け付けます。チャンネル別の音程判定や複数機器の合奏は対象外です。
- リズム・テンポ・音の長さは判定しません。二分音符でも正しい鍵盤を押した時点で次へ進みます。
- フィードバックは控えめな固定領域で更新し、モーダル・効果音・点数・タイマーは追加していません。
- 楽譜の主表示とOSMDのカーソルを維持し、正解済み音符の色変更は追加していません。
- ページを再読み込みすると練習状態は初期化されます。保存・AI・手本再生等のPhase 3機能はありません。

## 13. 次のPhaseに進む前の確認

Chromebookの実機で、**最初のド2回、長いソの次への進み方、間違いからの弾き直し、全14音の完了、途中・完了後のもう一度、速い連打、接続復帰**を確認してください。タッチ操作と譜面台付近からの見やすさも確認します。Phase 2Bの受入確認が完了するまで、次のPhaseの実装には進みません。

記録欄:

```text
実機確認日 / ChromeOS・Chromeバージョン:
Phase 2Bの表示:
接続機器名:
最初のC4を押す・離す・押す結果:
間違った音と弾き直し:
14音目での完了:
途中・完了後の「もう一度」:
速い連打 / 抜き差し後の続行:
その他:
```
