# Phase 2E-C2 — 和音・右手・左手・両手の音程練習

実装日：2026-09-27。Phase 2E-C1はユーザーのChromebook実機確認まで完了済みです。

公開先：[AIピアノ練習アプリ](https://metaborin.github.io/ai-piano-practice/)

**今回の実装・自動テストと、新しいChromebook + CME U2MIDI Pro + PX-100での実機受入は別です。実機受入はユーザー確認待ちです。実機確認が済むまではC2全体を完了扱いにせず、Phase 3へ進みません。**

## 作成・変更ファイル

| ファイル | 役割 |
| --- | --- |
| `src/practice/PracticePlan.ts`（新規） | PracticeMode、PracticeTarget、Staffフィルタ、再打鍵対象の生成 |
| `src/practice/MomentMatcher.ts`（新規） | 300msの和音入力集合、成功・不成立、世代付きタイマー |
| `src/practice/PracticeSession.ts` | Target単位の進行、保持鍵盤、旧単旋律API互換 |
| `src/practice/usePracticeSession.ts` | アンマウント時のMatcher後始末 |
| `src/score/soundSpans.ts`（新規） | 通常タイの接続、同時pitch重複統合、安全に再生できない重なりの検出 |
| `src/score/CursorMap.ts`（新規） | ScoreMomentとOSMDカーソル位置の照合 |
| `src/score/ScoreModel.ts` | 音程練習対応区分の追加 |
| `src/score/parseMusicXml.ts` | C2対応範囲の判定、アルペジオ等の遮断、タイ検証 |
| `src/score/SongSelection.ts`, `src/score/useSongSelection.ts` | モード・Plan保持、同期的な停止/消音/再生成 |
| `src/audio/buildDemoPlan.ts`（新規） | 選択パートの発音時刻・個別音価・タイを再生イベントへ変換 |
| `src/audio/DemoPlayer.ts` | 同一時刻の一括処理、最終Note Offまで再生、休符の開始待ち |
| `src/midi/MidiOutputManager.ts` | 発音中の複数pitch、全音Note Off、最長の予約期限、出力デバッグ |
| `src/components/ScoreView.tsx` | CursorMapを使用し、対象Momentへ移動。照合失敗は開始不可 |
| `src/components/DeveloperControls.tsx` | 選択モード・Step・期待集合・時間窓の表示 |
| `src/songs/Song.ts`, `src/songs/inspectMusicXml.ts` | compatibility version 3、元XMLからの再判定 |
| `src/App.tsx`, `src/App.css`, `index.html` | パートボタン、ステップ表示、待機/対象なし制御、Phase表記 |
| `tests/unit/chordPractice.test.ts`, `tests/unit/polyphonicDemo.test.ts`（新規） | 和音判定・モード・タイ・MIDI予約/停止の単体テスト |
| `tests/unit/SongSelection.test.ts`, `tests/unit/loadSongMusicXml.test.ts`, `tests/unit/parseMusicXml.test.ts` | C2 Plan接続・意図した対応範囲の期待値更新 |
| `tests/e2e/chords.spec.ts`（新規） | 右手/左手/両手の練習・カーソル・手本・停止・対象なし・未対応譜 |
| `tests/e2e/timeline.spec.ts`, `tests/e2e/imports.spec.ts`, `tests/e2e/output.spec.ts` | C1からの対応拡張、旧DB原文保持、Phase表記 |
| `tests/fixtures/timeline/g-piano-practice.musicxml`, `h-ties.musicxml`（新規） | 両手6Moment/18音、タイ継続と個別音価の原作テスト譜 |
| `README.md`, `docs/GITHUB_PAGES.md`, `docs/PHASE2EC1.md`, 本書 | 現行仕様・C1受入完了記録・公開・実機確認 |

新しいnpm依存、DB migration、Vite baseの変更、Actionsの変更はありません。

## PracticePlan / PracticeTarget

```text
MusicXML → C1 Parser → ScoreModel
                       ├→ 元XMLをOSMDへ → CursorMap
                       └→ PracticePlan（選択Staff）
                           ├→ PracticeTarget → MomentMatcher → PracticeSession
                           └→ soundSpans → DemoPlayer → MIDIOutputManager
```

`PracticePlan`は`score / mode / targets / sourceNotes`を持ちます。`PracticeTarget`は`id / scoreMomentId / onset / onsetBeats / measureNumber / expectedMidiNotes / sourceNotes`を持ち、元のMomentへ戻れる対応を維持します。

`right`はstaff 1、`left`はstaff 2、`both`は両方をPlan生成時に選びます。ScoreModel自体に左右手の意味は追加していません。2Staffだけにパート選択を表示し、新しい曲の初期モードは両手です。1Staffの既存曲には不要なモード選択を表示しません。

選択したStaffの音のうち`tieStop`でない音を、新しい打鍵の対象にします。`tieStop && tieStart`の中間タイも除外します。MIDI pitchをSetで重複排除したものが`expectedMidiNotes`で、元の音符は`sourceNotes`とScoreModelに残します。休符、選択Staffに音がないMoment、タイ継続音だけのMomentは入力待ちStepにしません。対象が0なら開始/手本を無効にし、説明を表示してカーソルも隠します。

進行単位はTargetです。既存APIの`currentNoteIndex / totalNotes / correctNoteCount`は互換性のため名称を残し、内部ではStepを数えます。単旋律の旧`loadScore`も互換入口として残しています。通常画面は既存単旋律なら「音」、複雑曲なら「ステップ」と表示します。

## MomentMatcherと300ms

1. PracticeSessionがchannel＋pitchの保持鍵盤を管理し、同じ鍵盤を保持中の重複Note Onを除きます。Note OffとVelocity 0は解除だけで、正誤判定しません。
2. 単音Targetは正しいNote Onで即時に正解です。300ms待ちません。
3. 和音は最初の期待音で試行を開始し、そのMIDI timestampを基準に集合へ蓄積します。入力順は問いません。
4. 期待集合がすべてそろい、最初から最後が300ms以内なら1Stepだけ進みます。
5. 余分な音、時間超過、入力がそろわないまま期限を迎えた場合は「もう一度♪」。位置を保ち、試行の集合を破棄します。

`CHORD_WINDOW_MS = 300`を定数で管理します。入力間の差はMIDIの単調時計timestampで比較し、追加入力がなくてもJSタイマーで不成立を通知します。300msちょうどを許容するため、期限通知はその境界直後（301ms）に行います。時計の遅延があっても、300msを超えた入力を既存試行に混ぜません。

不成立後やモード変更後も、保持中の鍵盤を自動で再利用しません。一度離して新しいNote Onを送ると再試行できます。曲変更・モード変更・もう一度・手本開始・入力機器リセット・アンマウントでは集合とタイマーを破棄します。世代番号で古いコールバックを無効にします。

完成した時点で即座に次Stepへ進む仕様です。その後に届くNote Onは次Stepへの入力になります。押し続けた長さ、音符の開始時刻、拍とのずれ、速度、強弱は評価しません。300msは和音をまとめるためだけの幅です。

## OSMDカーソル

元XMLのOSMD表示を維持します。`CursorMap`はOSMDのIterator APIから小節index、小節内の分数拍位置、カーソル配下の音高を取得します。C1の小節開始位置と合わせて、正規化されたMomentの開始拍・打鍵対象音に照合し、`scoreMomentId → cursor index`を生成します。音符のSVG要素順・画面座標・DOM探索を練習基準にしません。

Reactは選択Planの現在TargetのMoment IDだけをScoreViewへ渡します。右手/左手で飛ばしたMoment、休符、タイ継続位置はMapに基づいて通過します。手本も同じTarget位置を通知します。再描画時もその位置を復元します。単旋律では既存の音高/音価照合も維持しています。

照合できない楽譜は安全に練習・手本を開始不可にします。読込みの要求ID、OSMDインスタンスごとのホスト、非同期処理のキャンセルも従来どおりです。OSMDが原文の一部を読み落とした場合に、異なる楽譜へ正誤判定を進めません。

## DemoPlayer・タイ・同一pitch・停止

選択PlanのsourceNotesから発音区間を作ります。通常のタイは同じstaff・voice・pitchで、前音の終端と次音の開始が正確につながるものを結合します。途中ではNote On/Offを送りません。最後のタイ音の末尾にだけ従来の90%ゲートを適用します。開始/終端が欠けるタイ、Staff/Voiceをまたぐタイなどは、保持時間を推測せず未対応理由にします。

同じ開始拍・同じpitchの複数source noteは1回のNote Onに統合し、最も長い終了時刻を使用します。元ScoreModelは変更しません。異なる開始拍で同じpitchが重なる複数声部は、鍵盤の再打鍵と保持が曖昧になるため今回の練習・手本の範囲外です。

同じ開始時刻の和音は**1つのタイマーコールバック**で処理し、全音に同じMIDI timestamp `T`を渡します。各音のNote Offは個別の音価から求め、MIDI側へ予約します。和音の音数ぶんタイマーを作りません。異なる音価が混ざっても最後に必要なNote Offまで再生状態を維持します。休符・forwardはonsetの間隔により無音になり、最初の休符中も発音しません。

テンポは既存の固定100 BPM、Velocity 80、Channel 1です。ScoreModelのテンポ情報は保持しますが、今回テンポ変更UI・テンポ追従は追加していません。

未来のNote Onを大量にMIDIキューへ入れない従来の方式を維持しています。停止時は世代番号を更新し、次の発音とUIタイマーをキャンセルし、追跡している全pitchへ明示的Note OffとCC123を送ります。出力機器のclear()が使えない場合は、旧Note Offの**最長の予約期限**まで次の手本/C4開始を待ち、旧Offが新しい発音を切らないようにします。出力エラーでも各Note Off・CC123を独立して試みます。

手本開始前に同期的にPracticeSessionを`demoPlaying`へ切り替え、部分入力とタイマーを消します。MIDIループバックを正解にしません。曲/モード変更では練習停止→手本停止/消音→Plan再生成→先頭待機の順に処理し、MIDIアクセス・機器選択は維持します。

## compatibility・保存・未対応範囲

compatibility versionは3です。単旋律は`simpleMelody`、今回対応する複雑曲は`pitchPractice`で「音程練習対応」、範囲外は`unsupported`として理由を表示します。C1までの古い区分はXML原文から再判定します。

IndexedDBは従来のversion 1のままです。DB初期化、破壊的migration、既存レコードの書き換えはありません。E-Bのversion 1互換情報、C1のversion 2互換情報を持つレコードを実ブラウザで復元し、XML・曲名・作者・originalScoreを含む全保存レコードが不変であることを比較しています。

対応：1Part、1〜2Staff、複数Voice、通常和音、休符、backup/forward、通常タイ。既存の1000音/500小節・ファイルサイズ制限も維持します。

練習/手本を無効にする範囲：アルペジオ、装飾記号・トレモロ、連符、反復・演奏順指定、同時刻の同一Voiceが複数Staffをまたぐ記譜、曖昧なタイ、異なる開始拍で重なる同一pitch。ペダル記号はwarningを表示し、ペダルの演奏効果・評価は行いません。

複数Part、3Staff以上、grace/cue、打楽器・TAB、移調、octave-shift、微分音などのC1解析制限は継続します。小節途中のdivisions変更や拍子からの不足時間の自動補完も範囲外です。原文を壊して対応譜へ単純化しません。

## 自動確認

| 項目 | 結果 |
| --- | --- |
| 単体テスト | 174件成功（既存136件＋C2の38件） |
| 開発版ブラウザ | 91件成功 |
| lint | 成功 |
| テスト型チェック | 成功 |
| アプリ型チェック・build | 成功。OSMDの既存サイズ警告あり |
| 本番dist・サブパス | 92件成功（`/ai-piano-practice/`配下） |
| GitHub Actions・Pages | main反映後の[build/deploy結果](https://github.com/metaborin/ai-piano-practice/actions/workflows/deploy-pages.yml)を確認し、完了報告に記載 |
| 公開URLのブラウザテスト | 本番と同じ92件を公開後に実行し、完了報告に記載 |
| Chromebookの実音・停止・演奏操作 | ユーザー確認待ち |

既存テストは維持し、C1で無効だった機能がC2で有効になった期待値を更新しています。MIDI出力はモック、時間は偽時計、保存は実ブラウザのIndexedDBで検証します。PC幅と390px幅で表示も確認しました。

依頼の自動テスト32項目との対応：

| 要求番号 | 検証内容・主なテスト |
| --- | --- |
| 1–2, 20–21 | 即時単音・誤音、既存PracticeSession/Demoと内蔵3曲・XML/MXL追加曲のブラウザ回帰 |
| 3–10 | chordPractice：入力順3通り・300ms境界・1Step・不足・期限・余分な音・重複・再試行 |
| 11–17 | chordPractice：Staffフィルタ・重複pitch・対象なし・休符・tieStop/中間タイ |
| 18–19 | SongSelectionとchords：部分入力中/手本中の切替、進捗・タイマー・消音 |
| 22–27 | polyphonicDemoとchords：同時timestamp・パート別音列・個別Off・重複統合 |
| 28–29 | 全pitchのOff/CC123、clear有無、途中送信失敗、モード切替、停止ボタン、ループバック |
| 30–31 | 各モードの最終Target完了、完了後の追加入力の無視、再開 |
| 32 | arpeggiateの警告・表示・練習/手本遮断を単体とブラウザで確認 |

新規fixture Gは**2Staff・Voice 1/2・6Moment・18notes・8beats・100 BPM**の原作テスト譜です。右手5Step、左手5Step、両手6Stepで、片手にしか音がない時刻と異なる音価を含みます。fixture Hは通常タイの開始/中間/終端と和音を含み、再打鍵は2Step、C4は再発音せず4beats相当を結合します。C1のA〜Fも継続して使用します。

## Chromebook実機確認

1. 以前の保存曲があるChromeプロファイルで[公開アプリ](https://metaborin.github.io/ai-piano-practice/)を再読み込みし、`Phase 2E-C2`と保存曲を確認します。サイトデータを消す必要はありません。
2. U2MIDI ProとPX-100の双方向接続を使い、「MIDI接続」と入力/出力機器を確認します。C4テストと停止を確認します。
3. C1で実機確認した2Staff和音曲を選びます。「音程練習対応」と、右手・左手・両手のボタンを確認します。別の再確認譜として[fixture G](https://github.com/metaborin/ai-piano-practice/blob/main/tests/fixtures/timeline/g-piano-practice.musicxml)をDownload raw fileで保存し、「＋ 曲を追加」から登録できます。
4. **右手**：練習開始後、上段の必要音を弾きます。和音の全音がそろって1Step進むこと、左手側の異なる音では進まないことを確認します。最後で完了し、もう一度で先頭へ戻ることを確認します。
5. **左手**：下段だけで同じ確認を行います。上段にしか音がない位置では入力待ちにならないことを確認します。
6. **両手**：同時刻の上下段をまとめて弾くと1Step進むことを確認します。わずかな打鍵ずれは許容され、不足音のまま待つ/余分な音を含めると「もう一度♪」になることを確認します。弾き直す際は鍵盤をいったん離します。
7. 右手→左手→両手の順に「手本を聴く」を使い、選択パートだけがPX-100から鳴ること、和音がまとまって鳴ること、四分/二分音符の違い、カーソルの追従を確認します。
8. 和音が鳴っている途中に「停止」「すべての音を停止」、または別モード/別曲を選びます。全音が止まり、20秒以上待っても旧曲が再発音しないことを耳で確認します。機器選択を維持して先頭から再開できることも確認します。
9. 手本中に鍵盤を弾いても練習進捗が進まないこと、練習途中のモード変更で進捗と部分入力が消えることを確認します。
10. 必要に応じて[fixture H](https://github.com/metaborin/ai-piano-practice/blob/main/tests/fixtures/timeline/h-ties.musicxml)を追加し、C4のタイ途中で再打鍵を求めず、手本でもC4が再発音しないことを確認します。
11. きらきら星・ドレミの練習・短いメロディ・以前の追加単旋律へ戻し、従来の練習/手本/連打/停止が正常なこと、Chrome再起動後も保存曲が残ることを確認します。

fixture Gの期待値は右手5/左手5/両手6です。ユーザーの既存実機確認曲は、そのXMLから計算したStep数を使います。右手/左手はStaffの絞り込みであり、実際にどちらの手で鍵盤を弾いたかをセンサーで検出する機能ではありません。

## 25項目の完了条件

「自動確認」はモック/ブラウザでの確認です。実機欄が済むまではC2全体の完了ではありません。

| # | 条件 | 実装・自動確認 | 実機受入 |
| --- | --- | --- | --- |
| 1 | 既存単旋律練習 | 回帰テスト成功 | 待ち |
| 2 | 右手/左手/両手選択 | UI・モードテスト | 待ち |
| 3 | 右手音程練習 | Staff1・5Step完了 | 待ち |
| 4 | 左手音程練習 | Staff2・5Step完了 | 待ち |
| 5 | 両手音程練習 | 両Staff・6Step完了 | 待ち |
| 6 | 和音をNote On集合で判定 | 集合・順不同テスト | 待ち |
| 7 | 1和音=1Step | 進捗・カーソルテスト | 待ち |
| 8 | 300ms許容 | 境界含む3入力順テスト | 待ち |
| 9 | 不足音・余分な音 | 期限/誤入力/再試行テスト | 待ち |
| 10 | 休符を入力待ちにしない | E・Planテスト | 待ち |
| 11 | タイを再打鍵させない | H・中間タイ・2Step | 待ち |
| 12 | Target単位のカーソル | OSMD照合・各モード・タイ | 待ち |
| 13 | 分かりやすい進捗 | ステップ表示・狭幅確認 | 待ち |
| 14 | 右手手本 | Staff1音列・送信 | PX-100実音待ち |
| 15 | 左手手本 | Staff2音列・送信 | PX-100実音待ち |
| 16 | 両手手本 | 両Staff音列・送信 | PX-100実音待ち |
| 17 | 同時timestamp | 全和音のtimestamp比較 | 聴感確認待ち |
| 18 | 個別音価のOff | 異なるOff・長いタイ | PX-100実音待ち |
| 19 | 停止で全音停止 | 全pitch Off・CC123・予約取消 | 実際の消音待ち |
| 20 | 手本中の判定停止 | 同期ループバックテスト | 待ち |
| 21 | モード切替のリセット | 部分入力・再生中・先頭復帰 | 待ち |
| 22 | 曲切替のリセット | 既存とC2の切替回帰 | 待ち |
| 23 | 追加曲の保持 | E-B/C1保存レコード不変 | 自分の保存曲で確認待ち |
| 24 | MIDI入出力 | 許可1回・リスナー1個・出力回帰 | 実機待ち |
| 25 | GitHub Pages | 本番検証後、公開Actions・URL検証は完了報告参照 | Chromebookで確認待ち |

未完了なのは今回の実機受入です。上記の未対応記譜は明示した範囲外として残します。リズム/テンポ/音価/強弱/ペダル/指使い評価、AI、PDF表示・変換、OMRは実装していません。
