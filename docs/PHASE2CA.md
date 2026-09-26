# Phase 2C-A 実装報告・Chromebook実機確認

実装日: 2026-09-26

公開URL: **https://metaborin.github.io/ai-piano-practice/**

Phase 2BはユーザーによるChromebook + CME U2MIDI Pro + CASIO Privia PX-100実機確認が完了しています。今回はMIDI出力のC4テストだけを追加しました。Phase 2C-Aの実装・自動検証と、PX-100本体の実際の発音確認は区別します。

## 1. 作成・変更したファイル

新規6ファイル:

- `src/midi/MidiOutputManager.ts`: 出力選択、接続、C4送信、停止、出力状態。
- `src/components/MidiOutputPanel.tsx`: 下部の出力テストUI。
- `tests/unit/MidiOutputManager.test.ts`: 出力ロジックの単体テスト13件。
- `tests/e2e/output.spec.ts`: 入出力共存・出力操作のブラウザーテスト5件。
- `docs/PHASE2CA.md`: 本報告書と受入チェックリスト。
- `docs/phase2ca-output.png`: 模擬MIDIを使用した画面例。

変更11ファイル:

- `src/midi/MidiManager.ts`: 共有MIDIAccessとstatechangeを出力側に渡し、終了時も連携。
- `src/midi/useMidi.ts`: 出力状態・操作をUIへ渡し、ページを離れる際に発音中なら停止。
- `src/App.tsx`: 既存画面の下部に出力テスト領域を追加。Phase表記更新。
- `src/App.css`: 出力領域と大きな操作ボタンのスタイル。
- `index.html`: 説明文のPhase表記更新。
- `tests/unit/MidiManager.test.ts`: MIDIAccessモックにoutputsを追加。
- `tests/e2e/midiFixture.ts`: MIDIOutputモックを追加。
- `tests/e2e/practice.spec.ts`: selectの参照を「入力機器」で明示。
- `README.md`: 現在の機能・使い方・検証数。
- `docs/GITHUB_PAGES.md`: MIDI出力と公開後確認を追記。
- `docs/PHASE2B.md`: ユーザーによる実機確認完了を記録。

MusicXML、ScoreModel、ScoreView、PracticeSession、NoteMatcher、入力メッセージの解析・入力デバッグ部品、Viteのbase、GitHub Actions、npm依存・ロックファイルは変更していません。

画面例: [出力テストと既存の練習画面](phase2ca-output.png)（模擬MIDI）

## 2. MIDI Outputの実装方法

既存の `MidiManager.connect()` が取得する `MIDIAccess` を `MidiOutputManager` と共有します。許可は既存の「MIDI接続」から要求し、`requestMIDIAccess({ sysex: false })` を維持します。出力機器の切替・再接続で別の許可要求はしません。

`MidiOutputManager` は `access.outputs` を列挙し、選択済みの `MIDIOutput.open()` 成功後にテスト音を送れます。入力側の `statechange` 通知を共有し、出力の抜き差しも一覧と接続表示へ反映します。出力がなくても入力・練習は使用できます。

出力クラスは楽譜・練習状態を参照せず、送信した音を入力イベントへ流し込みません。既存の入力イベント・timestamp・velocity・Note On / Offの処理を維持しています。

## 3. 出力機器の選択

ページ下部の「MIDI出力テスト」→「出力機器」のselectで選択します。名前またはメーカーにCME / U2MIDIを含む機器を優先し、該当がなければ最初の出力を自動選択します。完全一致の名前には依存しません。

明示的に「出力機器を選択」に戻すと未選択状態を維持します。ユーザーが選んだ機器を抜いた場合は、その機器の再接続を待ち、別機器へ自動で送信しません。接続しても自動で音は鳴らしません。再接続後はもう一度ボタンを押します。

入力・出力それぞれの「未接続／接続待ち／接続済み／エラー」を表示します。出力を開けない・送信できない場合は説明と「出力を再接続」を表示します。未許可・未選択・機器なし・切断時はテスト送信を行いません。

## 4. Note On / Note Offの内容

`OUTPUT_CHANNEL = 1`、C4 = MIDI 60、Velocity = 80、長さ500msを定数で管理します。

| タイミング | 内容 | MIDIバイト（16進表記） |
| --- | --- | --- |
| テスト音ボタン | Note On / C4 / 60 / Velocity 80 / Ch 1 | `[0x90, 0x3C, 0x50]` |
| 500ms後 | 明示的Note Off / C4 / 60 / Velocity 0 / Ch 1 | `[0x80, 0x3C, 0x00]` |

Note Onは即時、Note Offは `output.send([0x80, 60, 0], performance.now() + 500)` の送信時刻を指定して予約します。停止をJavaScriptタイマーだけに依存させません。[Web MIDI仕様: MIDIOutput.send](https://www.w3.org/TR/webmidi/#dom-midioutput-send)

画面の「最後のMIDI出力」は最初にNote On、予定時刻にNote Offへ更新します。画面更新用タイマーが遅れると表示の切替も遅れますが、Note OffはMIDI側へ予約済みです。表示は送信要求・予定時刻に基づき、物理ケーブルの先の到達・実際の発音を検知するものではありません。

ボタン連打でC4が重ならないよう、テスト送信中はボタンを無効化します。

## 5. All Notes Offと停止処理

「すべての音を停止」は、対応環境では `MIDIOutput.clear()` で未送信の予約を消去し、C4個別のNote OffとChannel 1のCC123を送ります。

```text
個別 Note Off: [0x80, 60, 0]
All Notes Off: [0xB0, 123, 0]
```

`clear()` がない環境でも個別Note OffとCC123を送れます。その場合、元のNote Off予約が残るので、元の500msが過ぎるまで次のテスト音を無効化します。古い予約が次のC4を途中で止めないためです。`clear()` や個別Note Offが例外になっても、CC123の送信を別途試みます。

出力切替・ページ離脱・アプリ終了時にも、テスト送信中なら停止を試みます。切断済み機器へは送信できないため、再接続後の「すべての音を停止」を使用してください。停止はChannel 1だけが対象です。全16チャンネルを変更する処理やSysExは追加していません。

## 6. 実行したテスト

単体テスト53件（既存40 + 出力13件）を実行して成功しました。

- 正確なNote Onバイト、500ms後を指定したNote Offバイト、表示切替。
- 連打防止、再テスト、個別Note Off・CC123、予約消去。
- `clear()` 非対応時の停止と再テスト待機。
- 未許可・機器なし・未選択で安全に終了。
- CMEの部分一致・メーカー優先、別機器の選択。
- 機器切替時の停止、抜き差し時の状態更新・自動再発音なし。
- open・send・停止送信の例外、再試行、終了時の停止、遅れて完了するopenへの対処。
- 既存のMIDI入力解析とPhase 2Bの10指定項目を含む全テスト。

本番ビルドのブラウザーテスト17件（既存12 + 出力5件）を実行して成功しました。許可要求1回、出力選択、Note On / Off・CC123表示、未接続・例外・復帰、入力と出力の独立性、既存の14音練習、サブパスと静的アセットを確認します。入出力はすべて模擬であり、実際のPX-100を自動操作するテストではありません。

## 7. lint / typecheck / build

```sh
npm test
npm run lint
npm run typecheck:tests
npm run test:pages
```

全コマンド成功。`test:pages` 内で `tsc -b && vite build` も実行しています。既存OSMDチャンク約1.31MBに対するサイズ警告はありますが、ビルドエラーはありません。新しいnpmパッケージは不要です。

## 8. GitHub Pages

公開先は **https://metaborin.github.io/ai-piano-practice/** です。既存の `/ai-piano-practice/` baseとMusicXMLの `?raw` importを維持し、`main` push → GitHub Actionsの検証 → Pages公開を使用します。

今回の出力テストも既存のワークフローから実行されます。[最新Actionsの結果](https://github.com/metaborin/ai-piano-practice/actions/workflows/deploy-pages.yml)で対象コミットのbuild・deployを確認できます。公開後は同じ17件のブラウザーテストを公開HTTPS URLにも実行します。実際の公開結果は作業完了メッセージに記録します。

## 9. Chromebook実機確認手順

1. 確認済みの双方向配線を使用します。**PX-100 MIDI OUT → U2MIDI Pro MIDI IN** と **U2MIDI Pro MIDI OUT → PX-100 MIDI IN**、U2MIDI ProのUSB → Chromebookを確認します。
2. PX-100の電源を入れ、普段の音量にして、最初はペダルを離して確認します。
3. Chromeで公開URLを再読み込みし、上部の **Phase 2C-A** を確認します。
4. 「MIDI接続」で許可します。既に許可済みならダイアログが出ない場合があります。SysExの設定変更は不要です。
5. まず練習開始前の状態で、下部の **MIDI出力テスト** を表示します。入力・出力とも接続済みになり、出力selectに **U2MIDI Pro / CME Pro** に関連する機器が選択されていることを確認します。名称が違っても該当する出力を選びます。
6. **テスト音 C4** を1回押します。Chromebookのスピーカーではなく **PX-100本体から中央のドが鳴ること** を確認します。
7. 約0.5秒で鍵盤を離したときのように音が減衰することを確認します。音色による余韻と、鳴りっぱなしを区別してください。「最後のMIDI出力」は **C4 / Note On / MIDI Note 60 / Velocity 80 / Channel 1 → Note Off / Velocity 0** に切り替わります。
8. 数回繰り返し、毎回1音だけ鳴って止まることを確認します。続けて **すべての音を停止** を押し、**All Notes Off / CC 123 / Value 0 / Channel 1** の表示を確認します。発音直後の停止でも確認してください。
9. 出力を未選択にするとテスト音を押せないこと、選び直すと再び押せることを確認します。
10. 音が止まった状態でUSBを抜き差しし、入力・出力表示が更新され、再選択・再接続後にテスト音を鳴らせることを確認します。再接続だけで自動発音しないことも確認します。
11. 既存の「練習開始」で、正解で1音進む、誤音で停止、ドの押す・離す・押す、全14音の完了、「もう一度」、入力デバッグを確認します。

以前権限を拒否した場合はChromeのサイト情報 → サイトの設定 → MIDIを許可して再読み込みします。[詳しい許可手順](GITHUB_PAGES.md#許可ダイアログが出ない以前拒否した場合)

音が鳴らない場合は、出力選択、PX-100側のMIDI INへの配線、PX-100の音量・受信設定を確認してください。Note On / Offの表示だけで発音確認済みとは扱いません。

## 10. Phase 2C-A完了条件

**実装・自動検証の完了と実機受入は別です。PX-100の発音をユーザーが確認した後にPhase 2C-A完了とします。**

| No. | 条件 | 自動検証 | 今回の実機 |
| --- | --- | --- | --- |
| 1 | 既存Phase 2B機能が正常 | 確認済み | 再確認待ち（2Bでは確認済み） |
| 2 | MIDI Outputを検出 | 模擬で確認済み | 未確認 |
| 3 | U2MIDI Proの出力を選択 | 名称差・メーカーでの検出も確認済み | 未確認 |
| 4 | テスト音 C4を押せる | 確認済み | 未確認 |
| 5 | Note 60 / Velocity 80 / Ch 1のNote On | バイト列を確認済み | PX-100の発音未確認 |
| 6 | 約500ms後にNote Off | 送信予約時刻とバイト列を確認済み | 消音未確認 |
| 7 | All Notes Offを送信 | CC123を確認済み | 消音未確認 |
| 8 | 最後のMIDI出力を表示 | On / Off / CC123を確認済み | 未確認 |
| 9 | GitHub Pagesで正常起動 | 本番サブパス・アセットを確認済み | Chromebook再確認待ち |
| 10 | 既存MIDI入力・演奏判定を維持 | 全既存テスト成功 | 今回の変更後は再確認待ち |

## 11. 未解決事項・注意点

- 実際のPX-100からの発音・消音はこの開発環境で確認していません。USB / DINケーブルの先への到達はWeb MIDIの送信結果から断定できません。
- ケーブルを抜いた後の停止要求は楽器へ届きません。再接続し「すべての音を停止」を押して発音状態を確認してください。
- 停止の対象はChannel 1です。音色・ペダル・楽器側の受信設定による挙動は実機で確認してください。
- アプリ側にMIDI Thru / 出力の入力への転送はありません。機器側の設定等で出力音が入力へ戻る場合の自動識別は追加していません。テストはまず練習開始前に行い、テスト音だけで入力デバッグが変化するかも確認してください。
- 楽譜はそのままで、ScoreModelを使う曲再生・テンポ・再生シーケンサー・手本・AI・リズム・履歴は追加していません。

## 12. Phase 2C-Bに進む前の確認

**PX-100本体から中央のドが鳴ること、約500ms後のNote Offで止まること、停止ボタン、繰り返しテスト、接続復帰、既存の14音練習**を実機で確認してください。出力が入力へ戻っていないか、音色・音量・受信チャンネルの設定も記録します。

今回の作業ではPhase 2C-Bの手本演奏へ進みません。

```text
確認日 / ChromeOS・Chromeバージョン:
表示Phase:
入力機器名 / 出力機器名:
PX-100からC4が鳴ったか:
約500ms後のNote Offで止まったか:
すべての音を停止の結果:
繰り返し / 抜き差し後の結果:
テスト音だけで入力デバッグが変化するか:
Phase 2Bの14音練習・再開:
その他:
```
