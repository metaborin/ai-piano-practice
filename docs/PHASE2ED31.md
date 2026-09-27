# Phase 2E-D3.1 — 任意小節からの練習開始

実装日：2026-09-27。ユーザーから、全30小節once版の先頭練習・手本・長曲追従・赤表示の実機動作を受領しました。今回の途中開始変更は自動検証とChromebook + PX-100での受入を分けます。反復展開、original版の練習対応、Phase 3は追加しません。

公開先：[AIピアノ練習アプリ](https://metaborin.github.io/ai-piano-practice/)

## 修正前の原因調査と確認できた範囲

ローカルとGitHub mainはともにD2の`736784e4bbc1b66a1e550e88082192b7d8abb2f7`でした。Workの「『マイム・マイム』冒頭をMusicXML化」チャットにあるD3成果物 `output/musicxml/full/maim_maim_secondo_full_once.musicxml` と検証レポートを取得し、実際のパーサー・PracticePlan・DemoStart・PracticeSessionで調査しました。アプリの変更前に採取した詳細は[解析記録JSON](PHASE2ED31-analysis.json)です。ScoreMoment、onset、全対象音のStaff/Voice/MIDI/tieStart/tieStop/duration、Target/index/expectedMidiNotes、変更前の開始位置を保存しています。

使用XMLのSHA-256：`648c19ccf5f1aeb36e47854263941eda0d3387cdd8ef4d652b17820deeba499a`。テスト用に原文を`tests/fixtures/timeline/maim-maim-full-once.musicxml`へコピーしました。内蔵曲への追加やXML内容の修正はありません。30小節、224音符、77休符、109Moment、右48／左76／両手109Step、二分音符116＝四分音符232 BPMです。

### 確認した原因

1. 対象4小節の右手は前小節からのタイ継続だけで、新規打鍵がありません。既存PracticePlanはtieStop（tieStop＋tieStartも含む）を正しく除外し、空Targetも残していません。Voice順・onset順・正解音列の生成不良は見つかりませんでした。
2. 旧DemoStartは小節指定を常に「次のPracticeTarget」に丸めていたため、右手だけのタイ継続小節から手本を始めると次小節へ進み、継続部分を省いていました。Workレポートが実際に記録していたのはこの制限です。両手では左手の新規打鍵があるため省略されませんでした。
3. 旧アプリには小節指定の練習開始UI/APIがなく、`PracticeSession.start()`は常にindex 0へ戻っていました。先に開発用カーソルを対象indexへ動かしても開始時に0へ戻ることを再現しました。指定小節・解決済み開始点を保存する責務が不足していました。
4. CursorMapは新規打鍵が全くないMomentを除外していたため、一般のタイ継続だけの小節を手本開始位置として直接表示するには対応表の補完も必要でした。

**「最初の入力後に止まる」という現象そのものは、旧公開版に任意小節の練習開始機能がないため、その操作経路では再現・原因断定していません。** タイを原因と推測して譜面を書き換えることはせず、実データで確定した上記の問題を修正し、新しい開始経路から最後まで進める回帰試験を行います。

### 対象4小節の実データ

onsetとdurationは四分音符を1とする単位。Target indexは0始まりです。全行の右手はStaff 1 / Voice 1、tieStart=false / tieStop=true、duration=4です。前小節の対応音はtieStart=trueで、2小節に連結されています。

| 指定小節 | onset | 継続している右手音（再打鍵しない） | 最初の新規右手打鍵 | 右Target index／表示 | 左Target index | 両手Target index |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | 52 | 13小節からD4/F4（62,65） | 15小節 C4/E4（60,64） | 25／26 / 48 | 28 | 47 |
| 16 | 60 | 15小節からC4/E4（60,64） | 17小節 D4/F4（62,65） | 26／27 / 48 | 36 | 55 |
| 18 | 68 | 17小節からD4/F4（62,65） | 19小節 C4/E4（60,64） | 27／28 / 48 | 44 | 63 |
| 20 | 76 | 19小節からC4/E4（60,64） | 21小節 G3/B3/D4（55,59,62） | 28／29 / 48 | 52 | 71 |

左手・両手は指定小節に留まり、最初のexpectedMidiNotesは14/18でD3（50）、16/20でA2（45）です。両手でも右手の継続音を押すことは要求しません。どの処理にも曲名や14/16/18/20の条件はありません。

## 設計とUI

- `ScorePosition`：実在する小節occurrence indexの検証と、その小節以降の最初のTarget検索を共通化。印刷小節番号の重複や欠番を補完しません。拍の比較は既存Beatの有理数です。
- `PracticeStartResolver`：既存Planを受け取り、requested、requestedMeasure、resolvedTargetIndex、resolvedMeasure、adjusted、reason、messageを返す純粋関数。UI・MIDI・OSMD・タイマーに依存しません。
- 同じ小節内の最初の新規打鍵を優先。休符、他StaffだけのMoment、タイ継続だけのMomentを飛ばします。対象小節に音がなければ次の対象小節へ進め、楽譜パネル内に理由を表示します。小節内の通常の休符スキップでは案内を出しません。
- 後続Targetもなければunavailableとし、練習開始・カーソル復帰を無効化。先頭へ黙って戻りません。別の小節・モードを選べば復帰できます。手本の開始指定は独立して使えます。
- 「練習の開始位置」は「最初から」と実在小節のselect。変更時には練習・手本・発音を停止し、解決済みTargetの待機状態へ移動します。自動で練習を開始しません。
- SongSelectionがrequestedを保持します。パート変更では同じrequestedを新Planで再解決し、他モードのindexを流用しません。曲変更は「最初から」へ戻します。MIDI接続・選択・入力ハンドラーは維持します。

## PracticeSession・再開始・入力状態

PracticeSessionは解決済みindexだけを`setStartTarget()`で受け取り、開始・再開始に使います。現在位置は全曲Target indexに対応し、途中開始でも1/全曲へ戻りません。correctNoteCountは今回のセッションで正解したStep数を0から数え、最後のTargetでcompletedになります。最終音からの開始も同じ規則です。

「もう一度」はそのセッションの開始Targetへ戻ります。「最初から」を選んだセッションでは従来どおり先頭へ戻ります。モード変更では元のrequestedMeasureから再解決した開始点になります。

新しい開始位置、開始、再開始、Plan変更でMomentMatcherの世代・pending chord・300msタイマー・activeNotes・前回のmissing/unexpected・フィードバックをリセットします。ReactへmatchFeedback=nullを伝え、赤表示も解除します。

一方、リセット時に物理的に押されたままの鍵盤は、別の`blockedUntilRelease`集合でNote Offまで重複Note Onを抑止します。これは旧練習状態の流用ではなく「新たに鍵盤を押したときだけ判定する」という既存動作の維持です。入力機器のリセット時には両集合を消去します。300msの和音許容幅や再打鍵の判定基準は変えていません。

## カーソル・手本との関係

練習時はresolved TargetのScoreMoment IDをそのままScoreViewへ渡します。指定小節の先頭やOSMDの配列indexを直接指定しません。既存D2の表示要求によって、開始・再開始・モード変更・「現在位置へ戻る」で実際に弾く音へカーソルとスクロールを合わせます。

手本では指定小節の頭に選択StaffのtieStopがある場合、その小節の実Momentとonsetを開始位置にします。既存soundSpans／buildDemoPlanが、そこですでに鳴っているべき音の残りだけを開始時に発音します。通常の全曲再生でtieStopを再発音することはありません。休符のみの場合は従来どおり次の新規音へ進みます。

DemoSnapshotに表示用のcursorMomentIdを持たせ、PracticeTargetがないタイ継続小節も表示できます。表示中の小節番号はそのMomentから取得します。Step表示はその時点の既存Target（継続中は前の打鍵Target）を表し、存在しない練習Stepを追加しません。CursorMapもタイのみのMomentをOSMD位置へ対応付けます。

DemoPlayerはDOMを操作しません。既存の同期通知・layout effectでカーソルとスクロールを合わせてから最初のMIDIを送ります。手本停止・終了では元の途中練習位置へ復帰し、再生中に練習開始位置を変更すると旧音・予約を停止します。従来のtimestamp、停止時のNote Off／CC123、世代キャンセル、タイマー上限は維持します。

## 変更／作成ファイル

| ファイル | 内容 |
| --- | --- |
| `src/score/ScorePosition.ts`（新規） | 小節occurrenceとTarget検索 |
| `src/practice/PracticeStartResolver.ts`（新規） | requested/resolvedと調整理由 |
| `src/practice/PracticeSession.ts` | 開始Target保持、再開始、入力初期化 |
| `src/score/SongSelection.ts`, `src/score/useSongSelection.ts` | 曲・モード・開始位置の調整と停止 |
| `src/components/PracticeStartControls.tsx`（新規） | 練習開始位置select |
| `src/components/DemoControls.tsx` | 練習対象がない場合の「現在位置から」を無効化 |
| `src/App.tsx`, `src/App.css`, `src/components/PracticeFeedback.tsx` | 操作連携、表示位置、案内、Phase表記 |
| `src/audio/DemoStart.ts`, `src/audio/buildDemoPlan.ts`, `src/audio/DemoPlayer.ts` | タイ継続小節の発音・表示位置 |
| `src/score/CursorMap.ts` | 新規打鍵のないMomentの表示対応 |
| `tests/unit/practiceStart.test.ts`（新規） | 実曲・汎用開始位置／状態／手本テスト |
| `tests/e2e/practiceStart.spec.ts`（新規） | 実際の画面・入力・カーソル・発音順の検証 |
| `tests/fixtures/timeline/maim-maim-full-once.musicxml`（新規） | Work成果物の回帰用原文 |
| `tests/fixtures/timeline/start-a-tie.musicxml`〜`start-f-empty.musicxml`（新規6個） | 下記A〜Fの原作最小譜 |
| `index.html`, `tests/e2e/output.spec.ts` | Phase表示と検証 |
| `README.md`, `docs/GITHUB_PAGES.md`, 本書, `docs/PHASE2ED31-analysis.json`（新規） | 使い方・設計・検証記録 |

パーサーの音楽解釈、PracticePlanの正解音列、MIDI機器管理、IndexedDB、Vite base、依存パッケージ、GitHub Actionsは変更していません。

## 汎用fixtureと検証

| fixture | 条件 |
| --- | --- |
| A: start-a-tie | 小節をまたぐタイ、tieStop＋tieStartの中継、tieStopのみ |
| B: start-b-rest | 小節頭の休符、同じ小節内の後半音 |
| C: start-c-staff-late | 選択Staffの前半に音がなく、別Staffは小節頭から発音 |
| D: start-d-voices | 同じStaffの2Voiceで継続音と新規打鍵が共存 |
| E: start-e-hands | 両手で片手がタイ継続、他方は新規打鍵 |
| F: start-f-empty | 対象Staffの全休小節、次小節の後半へ前進、末尾に対象なし |

追加単体53件。実曲は対象4小節に加え1・13・23・30小節から3モードで誤答・正解・進行・完了・再開始を確認します。残り音なし、欠番・同名小節、pending timer、押したままのキー、モード再解決、曲リセット、途中手本の残り音価と通常タイ非再発音も検証します。

追加ブラウザ16件。対象4小節×3モードの12ケースに、開始変更時のリセット、タイ手本の表示→発音と停止／終了復帰、対象なしからの復帰、タイのみのMomentのOSMD対応を加えました。既存テストを削除・省略していません。

| 検査 | 結果 |
| --- | --- |
| 単体 | 274件成功（既存221＋追加53） |
| lint・テスト型検査 | 成功 |
| 開発ブラウザ | 126件成功（既存110＋追加16） |
| アプリ型検査・build | 成功。既存OSMDチャンクサイズ警告のみ |
| 本番distブラウザ | 127件成功（126＋Pagesアセット検証1）。対象なし時の手本UI追加後は関連16件も再検証 |
| Actions／公開HTTPS | 最終報告に公開commit・runとテスト結果を記載 |
| 実機 | D3.1はユーザー確認待ち |

## 完了条件17項目

| # | 条件 | 自動確認 |
| --- | --- | --- |
| 1〜4 | 右手14/16/18/20小節開始 | 次の新規打鍵15/17/19/21への解決と案内、全ケース検証 |
| 5 | 最初の正解後も進む | 次Target、末尾完了まで検証 |
| 6〜7 | 左手・両手の任意小節開始 | 対象4小節＋通常小節を検証 |
| 8 | タイ継続の不要な再打鍵なし | tieStop、tieStop＋tieStart、新規音だけの和音を検証 |
| 9 | 休符開始 | 同小節の最初の打鍵へ進む |
| 10 | 複数Voice | 同時刻の継続・新規打鍵を区別 |
| 11〜12 | カーソル・現在位置へ戻る | resolved Momentと可視範囲をブラウザ検証 |
| 13 | もう一度 | 同じ開始点へ戻る |
| 14 | モード変更 | requestedを維持し、各Planで再解決 |
| 15 | 先頭練習の維持 | 既存単旋律・和音・300ms・保存・機器管理等を回帰確認 |
| 16 | 途中手本の維持 | タイのみの開始も補完、停止・復帰・旧音なしをモック確認 |
| 17 | GitHub Pages | buildと公開を別に確認し、最終報告へ記録 |

## Chromebook + PX-100 実機確認

1. 公開アプリを再読み込みして**Phase 2E-D3.1**を確認。登録済みの全30小節once版を選びます。保存曲を残すためサイトデータは消さないでください。
2. MIDI入力・出力の選択、接続表示、テスト音C4を確認します。
3. 右手、「練習の開始位置」14小節を選択。15小節へ進める案内、カーソル、26/48を確認し「練習開始」。最初はC4/E4、次は17小節のD4/F4です。14小節のD4/F4の再打鍵は不要です。
4. 16小節指定→17小節D4/F4（27/48）、18指定→19小節C4/E4（28/48）、20指定→21小節G3/B3/D4（29/48）も確認します。途中で誤音を入れて待つこと、正解で進み最後に完了することを確認します。
5. 各ケースで途中・完了後に「もう一度」。曲頭ではなく選択したセッションの開始点へ戻ることを確認します。手動スクロール後の「現在位置へ戻る」も確認します。
6. 14小節指定のまま左手に変更すると14小節D3（29/76）、両手なら14小節の左手D3だけ（48/109）が開始音です。16/18/20も確認し、右手タイ継続の再打鍵を要求しないことを確認します。
7. 右手で手本の開始位置を14小節にして再生。今度は14小節が見えてからD4/F4の残りが鳴り、15小節へ進むことを確認します。16/18/20も同様です。全曲手本ではタイの途中で再発音しないことを確認します。
8. 手本を停止し、元の途中練習位置へ戻ることを確認。20秒待っても再発音しないこと、手本中の練習開始位置変更で音が停止することを確認します。最後まで手本を聴いた場合も練習位置を保持します。
9. pending和音・誤音表示の途中で開始小節やパートを変え、古い不足音・赤表示が残らないことを確認。変更時に鍵盤を押していた場合はいったん離してから弾いてください。
10. 1小節や23小節のような休符開始、最終30小節、きらきら星の先頭練習を回帰確認します。曲変更で「最初から」に戻り、MIDI接続・選択が維持されることを確認します。

## 未解決事項

入力後の停滞という報告と、Workの記録上の手本開始位置の制限には差があり、前者の旧操作経路は特定できていません。今回の新しい開始経路は実XMLとモック入力で検証しましたが、Chromebookの実入力・PX-100の実音と消音は受入待ちです。再現があれば開始小節・モード・期待音表示・実際のMIDI入力を合わせて確認します。

既存の記譜対応範囲・取込上限とOSMDチャンクサイズ警告は維持します。反復対応・original版の練習・1番/2番括弧・D.C./D.S.・Phase 3・AI・PDF表示へは進みません。
