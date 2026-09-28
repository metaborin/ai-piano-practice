# Phase 2E-D3.2 — MusicXMLの単純反復記号対応

実装日：2026-09-28。D3.1はユーザーからChromebook + PX-100 + U2MIDI Proでの実機確認完了を受領済みです。D3.2は実装・自動検証と、今回の反復機能の実機受入を分けます。Phase 3へは進みません。

追記：D3.3の依頼時に、original版の反復がChromebook実機で意図どおり動作したとの確認を受領しました。段替わり・反復時の先読みスクロール改善は [D3.3](PHASE2ED33.md) で扱います。

公開先：[AIピアノ練習アプリ](https://metaborin.github.io/ai-piano-practice/)

## 対象と結果

Workで作成済みの `maim_maim_secondo_full_original.musicxml` を、内容を変えずに回帰fixtureへコピーしました。SHA-256は `ea6a8de798c08953b3b6af5cdc95e020f6bd80f004b8fa45984493f23919bb7e`。内蔵曲を置換せず、ユーザーがoriginal版を登録・選択して使います。

| 項目 | once版 | original版 |
| --- | --- | --- |
| 原譜の小節数 | 30 | 30 |
| 原譜の音符／休符／Moment | 224／77／109 | 224／77／109 |
| 反復範囲 | なし | XMLから5〜30を取得 |
| 演奏順 | 1〜30 | 1〜30 → 5〜30（56小節分） |
| 右手練習Step | 48 | 88 |
| 左手練習Step | 76 | 144 |
| 両手練習Step | 109 | 204 |
| テンポ | 四分音符232 BPM | 四分音符232 BPM |

楽譜にある二分音符116を既存処理で四分音符232へ換算しています。5小節や30小節という値はテストの期待値だけに使用し、アプリ処理には入れていません。

## Scoreと演奏順の分離

```text
元のMusicXML → ScoreModel（記載順のまま）＋ ScoreNavigation
                 ├─ 同じMusicXML → OSMD（原譜を1回だけ表示）
                 └─ PlaybackSequence（原譜小節・Momentへの参照）
                      └─ PracticeSequence（選択パートのTargetへの参照）
                           ├─ PracticeSession
                           └─ buildDemoPlan → DemoPlayer → MIDI出力
```

- `ScoreNavigation.repeats` は `RepeatRegion` の配列です。安定ID、物理的な開始・終了小節index、`totalPasses` を持ちます。XML小節番号は表示用なので、同じ番号や弱起番号があっても境界を混同しません。
- `PlaybackSequence.measures` は小節への参照、`moments` は `SequenceOccurrence` です。一意ID、演奏順index、元の `ScoreMoment`、小節Occurrence index、反復区間IDと回数を持ちます。
- `PracticePlan.targets` は従来どおり原譜上の新規打鍵対象です。各モードでStaffを選び、タイ継続を除き、和音をまとめます。
- `PracticePlan.sequence.occurrences` は `sourceTarget` と `sourceTargetIndex` を持ちます。1回目と2回目は別Occurrenceですが、同じMoment・Targetオブジェクトを参照します。音符・Target・MusicXMLの複製や書き換えはしません。
- 進捗分母と完了判定はOccurrence数です。原譜の休符・タイだけのMomentを打鍵対象数へ加えません。

## Repeat解析と対応範囲

MusicXML 4.0公式の [repeat](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/repeat/) と [barline](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/barline/) を確認しました。`times` は区間を演奏する**合計回数**で、追加反復回数ではありません。backward側の省略は今回の仕様として合計2回、`times="3"` は合計3回です。`times="1"` は1回です。仕様の型はnonNegativeIntegerですが、0回指定は本アプリの対応範囲外として明示的に無効化し、2回へ読み替えません。

`barline` 直下のrepeatを取り出します。`location="left"` は当該小節の前、`right` は後の境界で、省略時は仕様どおりrightです。forwardはその境界の次の小節から、backwardは直前の小節までを範囲にします。forwardのないbackwardは曲頭を開始とします。同じ境界の終了→次の開始を処理し、複数の独立した非ネスト区間にも対応します。

次は解析結果・Compatibilityに「現在未対応の演奏順記号あり」と理由を出し、表示だけにします。

- ネスト、重複、終了のないforward、空区間、不正なdirection、barline外のrepeat、小節途中のrepeat。
- ending／volta、Segno、Coda、Fine、measure-repeat、beat-repeat。
- soundのD.C.／D.S.／ジャンプ／条件指定、barlineのsegno/coda指定、wordsの一般的なD.C.・D.S.・Da Capo・Dal Segno・Segno・Coda・Fine表記。
- 条件付きrepeat、forward側のtimes、0・小数・不正数値・上限を超えるtimes。

任意の自然言語の演奏指示を解釈する機能はありません。既存の単旋律・和音・最大2Staff・既存範囲の複数Voice・通常タイ・休符・音価・テンポ対応は維持します。1番／2番括弧、D.C.等の実行、PDF表示、AI、Phase 3は追加しません。

## 安全上限

演奏順は後方へジャンプするwhileループで生成せず、原譜を前へ走査し、検証済み区間の回数分だけ参照を並べます。`MAX_SEQUENCE_OCCURRENCES = 100_000` を小節・Moment・音符Occurrenceそれぞれに適用します。小節数の展開量を事前確認し、密な和音で音符数だけが増える場合にも上限を設けます。範囲や回数を再検証し、超過時は練習不可の説明を表示します。元の1000音・500小節等の取込制限は維持しています。

## 練習・フィードバック・カーソル

PracticeSessionの `currentNoteIndex` / `startTargetIndex` / `matchFeedback.targetIndex` は既存名を保ち、現在は演奏順のOccurrence indexを表します。原譜indexはOccurrenceの `sourceTargetIndex` として分離しています。1回目の30小節終了は次のOccurrenceへ進み、2回目5小節となります。最後のOccurrenceだけでcompletedになります。

反復ジャンプ時は直前パスのフィードバックを消します。2回目の正誤判定も同じ300ms判定器を利用します。不足音はそのOccurrenceの元Targetから元ScoreNote IDへ戻して赤表示し、成功・開始位置変更・モード変更等で消去します。余分な音表示、押しっぱなし防止、同音の再打鍵も維持します。

OSMDは元のXMLをそのまま読み、反復記号を含む30小節を1回描画します。`CursorIgnoreRepetitions = true` でカーソル対応表を原譜順に作り、アプリ側でOccurrence → sourceMoment → CursorMapへ対応させます。OSMD側とアプリ側で二重に反復しません。

カーソルが30→5へ戻ると、既存ScoreFollowが視野外の5小節へ戻します。通常はsmooth、動きを減らす設定ではinstantです。同じMomentへの再訪もOccurrence indexで識別します。再生停止時は練習のOccurrenceへ戻り、既存のモード切替による追従でその位置を表示します。通常UIには反復区間でのみ「反復 1回目」「反復 2回目」を表示します。

## 途中開始・モード変更

`PracticeStartResolver` は `resolvedTargetIndex`（原譜）と `resolvedOccurrenceIndex`（演奏順）を分けて返します。休符やタイだけの指定小節は、従来どおり原譜上の次の新規打鍵へ解決します。末尾まで打鍵がなければ開始不可です。小節の新規指定ではそのTargetの最初のOccurrenceを使います。

「もう一度」はセッションに保存した開始Occurrenceへ戻ります。2回目から開始したセッションも1回目へ戻しません。曲の変更では全て初期化します。

パート変更では選択済みrequestedMeasureを維持して新しいPlan/Sequenceを作り、切替直前の練習Occurrenceと同じ反復区間・回数で指定開始位置を解決できれば、その回数を保持します。指定開始位置がその反復区間外などの場合は、指定小節の最初のOccurrenceへ戻します。現在小節へ勝手に開始指定を変更しません。手本中の切替でも復帰先の練習Occurrenceを基準にし、待機状態になります。

## 手本と音の停止

手本も `plan.sequence.playback` を使います。記載順に連続する区間では既存soundSpansのタイを保ち、逆行する境界で区切ります。MusicXMLテンポの積分と区間の経過時間から、全パスで増加するstartMs/Note Off timestampを作ります。区間先頭の休符、途中テンポ変更、既存フォールバックも維持します。

反復前の全spanのNote Offを区間終端までに収め、逆行先へタイを暗黙に持ち越しません。反復開始より前に始まったタイ継続は、2回目で新たな打鍵を捏造しません。通常の記載順で続く最終パスのタイは保持します。ジャンプ時に演奏器を停止・再起動する別タイマーは作らず、既存の単一の次発音予約とMIDI timestampを使います。

指定小節からの手本は最初のOccurrenceです。タイ継続小節では従来どおり、その境界でまだ鳴っている音を再構成します。「現在位置から」はOccurrence IDを渡すため、2回目10小節なら2回目10〜30だけです。原譜Moment IDだけで1回目へ解決し直しません。

停止・切替・非表示化では既存の世代番号、予約取消、Note Off／All Notes Offを使用します。clear非対応出力の古いNote Off待機も維持します。DemoPlayerからReact/OSMDのDOMは操作しません。練習Sessionは再生中進まず、停止・終了後は同じOccurrence・進捗・開始点へ復帰します。

## 保存曲と検証レポート

Compatibility versionを4へ更新し、保存済みoriginal版も元XMLから再評価します。保存レコードやXMLを上書きする移行はありません。MusicXML/MXL追加・IndexedDB復元・削除・MIDI機器選択を維持します。

開発者用と登録確認の検証レポートに、Repeat有無、範囲、total passes、Expanded measuresの番号列と小節数を追加しました。各パートの練習Stepは反復後の数です。モデル音符数・Moment数は原譜の数を表示します。

## 作成・変更ファイル

| ファイル | 役割 |
| --- | --- |
| `src/score/ScoreNavigation.ts`（新規） | RepeatRegion、境界解析、共有PlaybackSequence、安全上限 |
| `src/practice/PracticeSequence.ts`（新規） | 元TargetへのOccurrence参照 |
| `src/score/ScoreModel.ts`, `parseMusicXml.ts` | 原譜にnavigationを保持、単純反復と未対応を分離 |
| `src/practice/PracticePlan.ts`, `PracticeSession.ts`, `PracticeStartResolver.ts` | モード別展開、進捗・終了・開始・フィードバック |
| `src/score/SongSelection.ts` | requestedMeasure・反復回数を保持するモード切替 |
| `src/audio/DemoStart.ts`, `buildDemoPlan.ts`, `DemoPlayer.ts` | Occurrence開始、共通演奏順、発音境界・timestamp |
| `src/score/ScoreNoteRenderMap.ts`, `src/components/ScoreView.tsx` | 元音符の赤表示、原譜カーソル・追従 |
| `src/score/validationReport.ts`, `src/components/ValidationReport.tsx`, `DeveloperControls.tsx` | 反復詳細と展開Step |
| `src/songs/inspectMusicXml.ts` | Compatibility version 4 |
| `src/App.tsx`, `src/App.css`, `index.html` | 現在Occurrence、簡潔な反復表示、Phase名 |
| `tests/unit/repeats.test.ts`（新規） | 解析・実曲・各モード・途中開始・再生・停止・上限 |
| `tests/e2e/repeats.spec.ts`（新規） | 原譜表示・逆行追従・正誤・完了・手本・MXL・復元 |
| `tests/fixtures/timeline/maim-maim-full-original.musicxml`（新規） | Workの原文fixture |
| `tests/unit/longScore.test.ts` | 大規模合成モデルの小節長を合成音符の長さと整合 |
| `tests/e2e/output.spec.ts` | 表示Phase名更新 |
| `README.md`, `docs/GITHUB_PAGES.md`, `docs/PHASE2ED31.md`, 本書 | 現状・設計・実機受入手順 |

## 自動検証・公開状況

| 検査 | 結果 |
| --- | --- |
| 単体 | 既存274件＋反復追加36件＝310件成功 |
| 開発ブラウザ | 134件＋追加MXL保存・復元1件成功 |
| 本番ビルドのブラウザ | 全136件成功。最後のタイ継続境界調整後も関連25件を再確認 |
| lint / typecheck:tests / build | 成功（buildはアプリのtscも実行） |
| Git差分 | diff --check成功 |
| ビルド警告 | 既存のOSMD等500kB超チャンク警告のみ、ビルドエラーなし |
| 実機 | D3.2は未実施・ユーザー受入待ち |

全自動テストをGitHub Actionsでも実行し、その後、公開HTTPS URLへ同じ136件を実行します。**実際に反映されたcommit・Actions URL・公開先での結果は、この実装のチャット完了報告に記載します。** ローカルbuildの成功を公開成功として扱いません。実機の音の出方・残音・USB接続品質はモックからは確認できません。

既存Viteの `/ai-piano-practice/` とmain → GitHub Actions → Pagesの構成を維持します。Actionsはlint・型・単体・build・本番ブラウザテストの通過後だけ公開します。ローカルのbuild成功と公開成功は分けて記録します。

## Chromebook実機確認（未実施）

公開URLを再読み込みし「Phase 2E-D3.2」を確認します。保存曲を残すためサイトデータは消しません。PX-100とU2MIDI Proを従来どおり双方向接続し、「MIDI接続」を許可、入力・出力機器を確認します。元のoriginal版 `.musicxml` または `.mxl` を「＋ 曲を追加」で登録してください。既に登録済みなら選択し直します。once版と取り違えないようにします。

| # | 確認内容 | 自動検証 | 実機 |
| --- | --- | --- | --- |
| 1 | original版を追加・保存・再選択できる | XML/MXL/復元 | 未確認 |
| 2 | 開発者用のRepeat rangeが5〜30、total passesが2 | 解析・UI | 未確認 |
| 3 | 30小節の原譜が1回分だけ表示され、反復記号がある | OSMD・画像確認 | 未確認 |
| 4 | 練習順が1〜30→5〜30 | 3モード | 未確認 |
| 5 | 右手が88Stepで反復する | 単体・ブラウザ | 未確認 |
| 6 | 左手が144Stepで反復する | 単体・ブラウザ | 未確認 |
| 7 | 両手が204Stepで反復する | 単体・ブラウザ | 未確認 |
| 8 | 初回30小節終了でカーソルが5へ戻る | 3モード | 未確認 |
| 9 | 5小節が見える位置へ自動スクロールする | 3モード | 未確認 |
| 10 | 反復1回目／2回目の表示が変わる | UI | 未確認 |
| 11 | 進捗分母が展開Step、2回目でも正誤・不足音赤表示が正しい | 3モード | 未確認 |
| 12 | 2回目30小節終了でだけcompletedになる | 3モード | 未確認 |
| 13 | 手本も1〜30→5〜30を鳴らす | モックで全送信列 | 未確認 |
| 14 | 手本30→5の境界で前の音が残らず、停止後に再発音しない | Off期限・取消 | 未確認（聴感必須） |
| 15 | 10小節指定は1回目から、右手14小節の練習は15へ安全に解決 | Resolver・UI | 未確認 |
| 16 | 2回目10小節で「現在位置から」は2回目の続きだけ | 単体・ブラウザ | 未確認 |
| 17 | 手本停止／終了で元のOccurrence・カーソル・スクロールへ戻る | 単体・ブラウザ | 未確認 |
| 18 | once版は従来どおり1〜30、途中開始と再開始も動く | 既存回帰 | 未確認 |
| 19 | きらきら星等の既存短曲、テスト音、全音停止、MIDI接続が維持される | 既存回帰 | 未確認 |
| 20 | ending等は未対応表示となり、練習・手本を開始できない | 単体・ブラウザ | 未確認 |
| 21 | GitHub Pages上でも同じ動作となる | サブパス本番検証＋公開後も同じテストを実行 | 未確認 |

特に14はPX-100の音を聴いて確認してください。途中停止・全音停止後に十分待ち、前の手本が再び鳴らないことを確認します。パート変更・曲変更後もMIDI選択が維持されること、途中開始後の「もう一度」がその開始位置へ戻ることも確認してください。

## 未解決事項

D3.2の実機受入はユーザー確認待ちです。既存のOSMDチャンクサイズ警告を維持しています。今回未対応と明示した複雑な演奏順の実装、リズム解析・AI・PDF表示は対象外です。実機確認を受領するまではD3.2全体を完了扱いにしません。
