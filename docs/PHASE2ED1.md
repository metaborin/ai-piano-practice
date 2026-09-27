# Phase 2E-D1 — 実曲を使うためのアプリ側準備

実装日：2026-09-27。Phase 2E-C2はユーザーのChromebook + CASIO PX-100 + CME U2MIDI Proでの実機確認まで完了済みです。

公開先：[AIピアノ練習アプリ](https://metaborin.github.io/ai-piano-practice/)

**今回はアプリ側の準備・自動検証です。「マイム・マイム（冒頭練習）」SECONDOの確認済みMusicXML・元スキャン譜は今回の依頼に添付されていません。同曲の転記・登録・正解音の照合・実機確認は行っていません。画像推測・自動変換・OMR・PDF表示は実装していません。D2・D3・Phase 3へ進んでいません。**

## 作成・変更ファイル

| ファイル | 内容 |
| --- | --- |
| `src/audio/tempo.ts`（新規） | 共通テンポ優先順位・BPM→ms・途中テンポの区間積分 |
| `src/audio/buildDemoPlan.ts` | 発音・消音・タイ・休符を同じテンポ時間軸へ変換 |
| `src/audio/DemoPlayer.ts` | 定数を共通化し、既存の送信・停止構造を維持 |
| `src/practice/PracticePlan.ts` | Songテンポのフォールバック情報を保持 |
| `src/score/SongSelection.ts` | 曲選択・モード変更時にSongテンポをPlanへ渡す |
| `src/score/parseMusicXml.ts` | 不正なsound tempoの場合、有効なmetronomeを使用 |
| `src/score/validationReport.ts`（新規） | 解析済みモデルから検証結果を生成 |
| `src/components/ValidationReport.tsx`（新規） | 登録確認・開発者用で共有する検証表示 |
| `src/components/SongImport.tsx` | パート名・テンポを保持し、登録前にレポート表示 |
| `src/components/DeveloperControls.tsx` | 曲・パート・作者・source・検証結果・現在Stepを表示 |
| `src/songs/inspectMusicXml.ts` | part-nameと開始テンポを既存metadataに反映 |
| `src/songs/Song.ts` | 既存tempoBpmの優先順位をコメントに明記。型の構造変更なし |
| `src/App.tsx`, `src/App.css`, `index.html` | 現在小節、狭幅表示、Phase表記 |
| `tests/unit/realPiece.test.ts`（新規） | テンポ優先順位・116 BPM・モード・小節・レポート・保存互換性 |
| `tests/e2e/realPiece.spec.ts`（新規） | XML/MXL登録、3モード、手本、小節、元楽譜参照、削除再追加 |
| `tests/fixtures/timeline/i-piece-validation.musicxml`（新規） | 4小節の原作検証譜。マイム・マイムの音符ではない |
| `tests/e2e/output.spec.ts`, `tests/unit/parseMusicXml.test.ts` | Phase表記とテスト名のみ更新 |
| `README.md`, `docs/GITHUB_PAGES.md`, `docs/PHASE2EC2.md`, 本書 | 現行仕様、C2実機完了記録、確認手順 |

依存パッケージ、IndexedDBのversion/store、GitHub Actions、Vite baseは変更していません。

## 共通エンジンとSong互換性

既存の `MusicXML → ScoreModel → PracticePlan → PracticeTarget → MomentMatcher / PracticeSession` を使います。OSMDも同じXML原文を表示します。曲名による分岐や「マイム・マイム」専用の正解配列はありません。

Songには既に `title / composer / source / partLabel / musicXml / tempoBpm / originalScore / compatibility` があるため、新しいpieceType・practiceScopeは追加していません。小節範囲と音楽情報はXMLから求め、二重管理を避けます。composer欄は由来の記載にも使えます。

新規登録では1Partの`part-name`をpartLabelへ、XMLの開始テンポを既存tempoBpmへ保存します。MusicXMLの原文は変更しません。古いSongでテンポがない場合も読み込めます。既存レコードの再判定はメモリー内だけで行い、保存済みtitle/composer/tempoBpm/originalScore/XMLを書き換えません。

原譜参照の`originalScore`を持つ旧レコードを読み込み、曲・モード変更・手本再生後も保存レコード全体が不変であることをブラウザで比較しています。PDFを読み込む・表示する機能は未追加です。

## テンポ優先順位

1. その拍で有効なMusicXMLの数値テンポ。
2. XMLの指定がまだなければSongの`tempoBpm`。
3. どちらも使えなければ`DEFAULT_TEMPO_BPM = 100`。

1拍は四分音符換算で `60000 / BPM` msです。116 BPMなら約517.241379ms。メトロノームの二分音符や付点もC1パーサーで四分音符BPMへ換算します。

同じdirectionに有効な`<sound tempo>`とmetronomeがあればsoundを優先します。不正なsound値は警告し、有効なmetronomeがあればそれを使います。不正・未指定のmetadata値は既定値へ戻します。Allegrettoなど文字だけの指定から速度を推測しません。

XMLの途中のテンポ指定は、その拍から適用します。開始前の区間へ遡って適用しません。同じ拍の複数指定は既存パーサーの順序に従い、最後の指定を採用します。発音、各Note Off、休符、テンポ変更をまたぐタイ/音価を同じ時間変換で計算します。

従来の90%ゲートを維持し、通常タイは最後の音価の末尾だけにゲートを適用します。同時和音の同一timestamp、同一pitchの重複統合、全音停止・予約取消、MIDIループバック除外も維持しています。テンポ変更UIやユーザー演奏のリズム/テンポ評価はありません。

## measureNumberとValidation Report

通常画面の「○小節目」は、現在のPracticeTargetの`measureNumber`をそのまま表示します。手本中もカーソルと同じTarget indexを使います。曲変更・モード変更・もう一度で先頭へ戻り、読み込み中・エラー・対象音なしでは古い小節表示を残しません。小節を1〜4と決めつけず、弱起の0やXMLの文字を含む番号もそのまま保持します。

「＋ 曲を追加」の登録確認で「楽譜解析結果を確認」を開けます。選択後は「開発者用」→「Score解析」で同じレポートと曲のmetadataを確認できます。

表示内容：実際の先頭/末尾小節番号と小節数、Staff数、Voice一覧、Moment/音符/休符数、同時発音位置数、Tieの音符数、開始テンポと採用元、1拍のms、途中テンポ、モード別Step数、対応状況、警告と理由。通常画面には技術用語Momentを追加していません。

解析不能時は架空のStaff数や小節数を補いません。OSMD表示照合に失敗した場合も成功レポートとして扱いません。登録確認・選択時の検証を維持しています。

**レポートは構造とアプリ互換性の検査です。印刷譜との音高・音価の一致や、手書き注記の正しさを証明するものではありません。**

## 対応・未対応記譜

C2の対応範囲を維持：1Part、1〜2Staff、複数Voice、通常和音、休符、backup/forward、同じStaff/Voice/pitchで正確につながる通常タイ。Staff1=右手、Staff2=左手はPlanのフィルタです。

アルペジオ、装飾記号、連符、反復、特殊なCross Staff、曖昧なタイ、異なる開始拍で重なる同一pitchは練習・手本を無効にし、理由を表示します。表示可能なXMLはOSMD表示を維持します。Grace/cue、複数Part、3Staff以上、移調、TAB、微分音など解析範囲外では、選択時の解析を停止します。原文を通常和音や単旋律へ勝手に単純化しません。

## テスト

| 項目 | 結果 |
| --- | --- |
| `npm test` | 192件成功（既存174＋D1の18） |
| `npx playwright test` | 98件成功（既存91＋D1の7） |
| `npm run lint` | 成功 |
| `npm run typecheck:tests` | 成功 |
| `npm run build` | 成功。既存OSMDの500kBサイズ警告あり |
| `npm run test:pages` | 99件成功。`/ai-piano-practice/`配下の本番distを検証 |
| GitHub Actions / 公開URL | main反映後の[Actions結果](https://github.com/metaborin/ai-piano-practice/actions/workflows/deploy-pages.yml)と公開URLの検証結果をチャットの完了報告に記載 |
| マイム・マイムの原譜との一致・実音・実機操作 | 確認済みXMLの提供・登録後にユーザー確認 |

新しいfixture Iは**検証専用の原作**です。4小節（XML番号5〜8）・16拍・2Staff・Voice1/2・20音符・9Moment・休符3・タイ音符2・116 BPM。右手7Step、左手5Step、両手9Stepです。C2のG/H、既存3曲、E-B追加曲も継続テストしています。

追加単体テストは依頼の12項目をカバーし、数値テンポの優先順位/不正値、metronome-only、付点換算、途中変更をまたぐ長音、同時送信、停止、原文保持、未対応検出を検証します。ブラウザでは3モードの完了/再開、小節追従、XML/MXL取込、採用元表示、元PDF参照不変、未対応時の開始禁止、修正版の削除再登録とMIDI接続維持を確認します。MIDIはモックで、実際のPX-100音を検知した確認ではありません。

## マイム・マイムを追加するときのChromebook手順

1. 外部で作成し、**印刷された五線譜と照合した**冒頭のMusicXML/MXLを用意します。手書きドレミを自動採用しません。タイトル「マイム・マイム（冒頭練習）」、part-name「SECONDO」、可能なら四分音符116 BPMをXMLへ記録します。範囲は確認したXMLの内容を使います。
2. Chromeで公開アプリを再読み込みし、Phase 2E-D1を確認します。保存曲を残すためサイトデータの消去は不要です。
3. 「＋ 曲を追加」で確認済みXML/MXLを選び、曲名・作者/由来・パートと「楽譜解析結果を確認」を見ます。実際の小節番号/数、2Staff、Voice、休符/タイ、116 BPM（MusicXML）、音程練習対応を確認します。未対応理由がある場合は開始せずXMLと対応範囲を確認します。
4. 登録して「自分の曲」から選び、OSMDの音符・両手・小節範囲を印刷譜と照合します。曲一覧に追加しただけで原譜との照合が完了したことにはなりません。
5. U2MIDI ProとPX-100を双方向に接続し、MIDI接続を許可して入出力を確認します。C4テストで発音・停止を確認します。
6. 右手→左手→両手の順に練習開始。正しい単音/和音で1Step進むこと、誤音/不足音では待つこと、現在小節と緑のカーソルが一致すること、休符/タイ継続で再打鍵を求めないことを確認します。
7. 最後で完了し、「もう一度」で選択パートの先頭へ戻ることを確認します。XMLで実際に生成されたStep数を使い、固定の4小節/音数を想定しません。
8. 各パートの「手本を聴く」で実際の116 BPM相当の速度、音高・音価・同時和音、タイ/休符、小節表示/カーソルを確認します。1拍は約517.24msです。
9. 再生中に停止・全音停止・モード変更・曲変更を行い、全音が止まって20秒以上待っても旧曲が再発音しないこと、接続と選択機器が維持されることを確認します。
10. XMLを修正する場合は外部に原文を保管してから、該当追加曲を削除し修正版を再登録します。新しいSong IDになり、同一Songの編集・原譜参照の移し替えは今回の機能に含みません。
11. Chrome再起動後も既存曲/追加曲が残ること、きらきら星・ドレミ・短いメロディ・E-B単旋律・C2両手譜が従来どおり使えることを確認します。

## D1の12項目チェックリスト

| # | 完了条件 | アプリ側・自動確認 | 実際のマイム・マイム |
| --- | --- | --- | --- |
| 1 | 通常の追加曲として取込 | XML/MXL取込・保存成功 | 確認済みXML未提供 |
| 2 | Tempo 116 | 優先順位・ms・送信時刻成功 | XMLテンポと実音を確認待ち |
| 3 | 2Staff表示 | 4小節のOSMD表示成功 | 原譜と照合待ち |
| 4 | 右手/左手/両手Plan | 7/5/9Stepで検証成功 | 選択曲で確認待ち |
| 5 | 小節番号 | XML番号・練習/手本同期成功 | 原譜と照合待ち |
| 6 | 音程練習 | 各パート・完了/再開成功 | 実機待ち |
| 7 | 和音判定 | C2回帰とD1和音成功 | 実機待ち |
| 8 | 手本再生 | 116 BPM・同時出力・音価・停止成功 | PX-100実音待ち |
| 9 | Validation Report | 登録前/選択後・失敗時成功 | 実曲で確認待ち |
| 10 | 未対応の安全な検出 | 単体・ブラウザで開始禁止成功 | 実曲XMLを確認待ち |
| 11 | 既存曲の維持 | C2までの全回帰・保存レコード不変 | 更新後の実機回帰待ち |
| 12 | GitHub Pages | 本番サブパス確認後、公開結果は完了報告参照 | Chromebookで確認待ち |

アプリ側の準備と実曲そのものの受入を分けて扱います。残る実曲XMLの照合・実音確認を済ませる前に、マイム・マイムでのD1検証を完了扱いにはしません。対応外の記譜、原譜PDFの表示・紐付けUI、曲の編集UI、テンポ/リズム等の演奏評価は追加していません。
