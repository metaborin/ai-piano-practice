# Phase 2E-C1 — MusicXMLの正規化タイムライン

Phase 2E-BはユーザーのChromebook実機確認まで完了済みです。今回のC1は解析基盤と表示・互換性の拡張です。和音の判定、右手・左手・両手モード、同時Note Onの手本、リズム評価、AIは実装していません。

公開URL：[AIピアノ練習アプリ](https://metaborin.github.io/ai-piano-practice/)

**追記：ユーザーからChromebook実機確認も問題なく完了したとの報告を受け、Phase 2E-C1は完了しました。以下はC1実装時点の記録です。次の実装・受入は [Phase 2E-C2](PHASE2EC2.md) に分けて記録します。**

## 作成・変更ファイル

| ファイル | 内容 |
| --- | --- |
| `src/score/ScoreModel.ts` | 正規化Note・Rest・Moment・小節・Tempo・Tie、旧処理用PracticeScore |
| `src/score/Beat.ts`（新規） | 正確な分数の計算・比較・JSONへの変換 |
| `src/score/musicXmlDocument.ts`（新規） | XML構文とルートの検証、DOMの読み取り |
| `src/score/parseMusicXml.ts`（新規） | MusicXMLから絶対拍位置のタイムラインを生成 |
| `src/score/toPracticeScore.ts`（新規） | 単旋律専用アダプター、将来用expected MIDI set |
| `src/score/validateMusicXml.ts` | 新Parserで解析範囲を検証 |
| `src/score/readScoreModel.ts` | 既存OSMDカーソル読取りを照合用に保持、型を変更 |
| `src/score/SongSelection.ts` | 正規化モデルの保持、練習可否と表示準備完了を分離 |
| `src/practice/PracticeSession.ts`, `src/audio/DemoPlayer.ts` | 旧互換型のimportだけ変更。判定・再生アルゴリズムは維持 |
| `src/songs/Song.ts`, `src/songs/inspectMusicXml.ts` | 解析対応と練習対応を分離、既存XMLの再解析 |
| `src/components/ScoreView.tsx` | 元XMLのOSMD表示、単旋律のモデル照合、複雑曲のカーソル非表示 |
| `src/components/SongImport.tsx` | 複雑曲も解析・描画を確認し、対応状況を表示 |
| `src/components/DeveloperControls.tsx`, `src/App.tsx` | 折りたたみScore解析、複雑曲の練習・手本の無効化 |
| `index.html` | Phase表記と説明 |
| `tests/fixtures/timeline/*.musicxml`（新規6ファイル） | A〜Fの小さな原作テスト譜 |
| `tests/unit/parseMusicXml.test.ts`, `tests/unit/xmlFixture.ts`（新規） | XML実体を解析する単体テストと補助関数 |
| `tests/unit/SongSelection.test.ts`, `tests/unit/DemoPlayer.test.ts` | 新旧モデルの接続・複雑曲の遮断、型の更新 |
| `tests/e2e/timeline.spec.ts`（新規） | 6譜の描画・操作制限・旧DB保持・切替停止 |
| `tests/e2e/imports.spec.ts`, `tests/e2e/songs.spec.ts`, `tests/e2e/output.spec.ts` | C1で対応した範囲の期待値、Phase表記の更新 |
| `package.json`, `package-lock.json` | テスト用XML DOMを開発依存へ追加 |
| `README.md`, `docs/GITHUB_PAGES.md`, `docs/PHASE2EB.md`, 本書 | 現行範囲・旧Phase完了・公開・実機手順 |

MIDI管理、IndexedDBのスキーマとRepository、Viteのbase、GitHub Actionsは変更していません。

## 型とデータの流れ

```text
内蔵曲URL / 保存済みMusicXML / MXLから展開したMusicXML
  → parseMusicXml
  → ScoreModel（notes / rests / moments / measures / tempos）
  → toPracticeScore（安全な単旋律のみ）
  → 従来のPracticeSession・DemoPlayer

同じMusicXML原文 → OSMD → 楽譜表示
```

主な型は [ScoreModel.ts](../src/score/ScoreModel.ts) にあります。

- `ScoreNote`：安定ID、MIDI音高、正確な開始拍・音価とNumber表現、小節index/番号、staff、voice、XML ID、chord、tieStart/tieStop、tie/tied情報。
- `ScoreMoment`：安定ID、開始拍、小節、同じ開始拍にある個々の`ScoreNote[]`。単音なら1note、和音なら複数noteです。
- `ScoreRest`：開始拍・音価・小節・staff・voice・全休符フラグ。notesにもMomentにも架空のMIDI音を追加しません。
- `ScoreModel`：上記配列、measures、totalBeats/totalDuration、staffCount、文字列voices、tempoBpm、位置付きtempos、warnings、practiceCompatibility。
- `BeatFraction`：`{ numerator: string, denominator: string }`。既約分数で分母は正。JSONとstructuredCloneで扱えます。
- `PracticeScore`：元の単旋律契約`{ id, title, partLabel, musicXml, notes: { midiNote, durationBeats }[] }`を残す過渡的アダプター用型。

`measureNumber`は数値固定ではなく文字列です。弱起の`0`や`pickup-A`など原本のラベルを維持し、配列の位置は別の`measureIndex`に保持します。音符IDはpart・小節index・小節内のXML順から生成します。

## 時間軸の解析

四分音符を1 beatとし、`duration / divisions`を正規化します。小節の開始位置に小節内の位置を加えて絶対拍位置を求めます。

| 要素 | 処理 |
| --- | --- |
| 通常note | 現在位置をonsetにし、duration分だけ進める |
| chord note | 直前の基準音（chordなし）のonsetへ追加し、現在位置を進めない。音価は各音に保持 |
| backup | duration/divisions分戻す。小節先頭より前へ戻る入力は拒否 |
| forward | duration/divisions分進める。空白をMIDI音に変換しない |
| rest | RestEventとして保持し時間を進める。鍵盤待ち対象にはしない |
| staff | 未指定は1。1/2を保持し、左右の手という意味は固定しない |
| voice | 未指定は文字列`"1"`。chordの省略時は基準音のvoiceを使用 |
| pitch | `(octave + 1) * 12 + stepの半音値 + alter`。整数alterとMIDI 0〜127を検証 |
| tie / tied | source・type・number・time-only、start/stop/continueを保持。音符は結合・削除しない |
| tempo | sound@tempo、数値metronomeのbeat-unit・付点・per-minuteとoffsetを読む。位置付き変更も保持 |

小節の長さは、全Voiceのnote/rest/forwardが到達する**最大位置**です。最後にXMLへ記載されたVoiceの終了位置だけを使いません。小節境界ではdivisionsを継承し、変更があればその小節から新しい値を適用します。

現在はMusicXMLに書かれた実際の時間長を採用します。拍子記号から不足分の休符を生成したり、過不足を自動補正したりはしません。このため弱起・不完全な最終小節も実長を保ちます。拍子に対する小節長の妥当性検査、forwardの拍子境界越え検査は未実装です。小節途中のdivisions変更は明示的に未対応として拒否します。

chordに基準音がない場合、異なるVoiceを連結した場合、chordの音価が基準音より長い場合はエラーです。基準音より短いchord音は保持できます。[MusicXML公式のchord仕様](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/chord/)

## 分数・Moment・重複音

内部はBigIntの分子/分母を最大公約数で約分します。加減算・divisions除算・順序比較・同時刻判定でNumberの丸めに頼りません。同時刻の正規化キー（例`2/3`）でグループ化し、`onsetBeats`と`durationBeats`は外部表示・旧API向けに変換します。

同じonset・同じpitchでも、別Voice/Staffの音符は別ID・別noteとして残ります。将来の物理鍵盤用には`expectedMidiSet(moment)`が重複を除いた集合を返します。今回のNoteMatcherには接続していません。

## 単旋律の互換性と操作制限

`toPracticeScore`は、1Staff・1Voice、1Moment=1note、休符/タイ/chordなし、時間が連続する単旋律だけを旧契約へ変換します。compatibilityフラグだけでなく実際の構造も確認し、複雑な曲を1音ずつの列へ平坦化しません。

単旋律はOSMDのカーソル列と新Parserの音高・音数・音価も照合してから操作可能にします。OSMD側のNumberの音価には照合時だけ微小許容差を使います。Momentのグループ化には使用しません。手本は従来の100 BPM・90%ゲート・停止方式です。取得したテンポ情報は今回は手本速度へ適用しません。

複雑曲では元XMLをOSMDへ渡して和音・大譜表を表示し、練習開始・もう一度・手本・前後移動を無効にします。練習音数は`— / — 音`で、音符数を単旋律の打鍵回数として表示しません。Score解析でMoment数とNotes数を別に確認できます。

曲変更では既存の処理で練習を先に停止し、手本タイマー・発音・予約を停止し、進捗を消してから読込みます。SongSelectionの要求ID、ScoreViewごとのOSMDインスタンス/ホストと破棄、DemoPlayerの世代管理を維持しています。遅い描画・再生通知は新しい曲へ反映しません。MIDI接続と機器選択は維持し、入力ハンドラーを増やしません。

## compatibilityと保存データ

compatibility versionを2へ更新し、`parseCompatibility`と`practiceCompatibility`を追加しました。旧レコードでも読めるよう任意フィールドです。

| 状態 | 表示・操作 |
| --- | --- |
| parse supported / simpleMelody | 解析・表示・従来の練習・手本 |
| parse supported / polyphonicPending | 「解析可能・練習は次Phase」。表示のみ |
| 解析範囲外、または練習unsupported | 理由を表示。練習・手本を無効化 |

DB名`ai-piano-practice`、version 1、`songs`ストアを維持します。DB migration・初期化・一括削除はありません。古いcompatibilityキャッシュはメモリー上で原文を再解析し、DBへ書き戻しません。XML、曲名、作者、originalScoreなどの既存フィールドは保持します。

以前「和音・複数Staffは未対応」と保存した曲も、新しいParserで再判定して解析・表示可能になります。OSMDの表示失敗は選択時のエラーとして扱い、前曲の楽譜・正解データを残して操作可能にしません。

## 対応範囲と意図した制限

1Partのscore-partwise、1/2Staff、複数Voice、chord、rest、backup/forward、tie情報、整数alter、divisions、小節境界でのdivisions変更、数値tempoに対応します。note/rest合計1000要素・500小節まで。既存のXML/MXLサイズ制限も維持します。

- 複数Part、score-timewise、3Staff以上、grace/cue、打楽器・TAB、移調、octave-shift、微分音、外部画像参照などは理由付きで解析を拒否します。
- タイは情報保持まで。chain結合、タイ再生、再打鍵評価は未実装です。
- 連符はduration/divisionsの正確な時間を保持しwarningを返します。評価は行いません。
- ペダル・アルペジオ・装飾記号はwarningを返し、演奏展開しません。以前から受け付けていた単旋律は同じ記譜音の練習を維持します。
- 反復・演奏順・トレモロは記載順だけを保持してwarningを返し、練習・手本を無効にします。
- 対応していない要素を消して原文を単純化しません。OSMDへ渡す原文も、保存する原文も維持します。

## Fixtureとテスト

| Fixture（`tests/fixtures/timeline/`） | 期待する解析 |
| --- | --- |
| A `a-simple.musicxml` | C4→D4→E4、onset 0/1/2、各1beat、3Moment |
| B `b-chord.musicxml` | C4+E4+G4、onset 0、1Moment/3notes、1beat |
| C `c-grand-staff.musicxml` | Staff1 C5/E5、Staff2 C3/G3、全音onset 0、1Moment/4notes |
| D `d-two-voices.musicxml` | Voice1 C4/D4各1beat、Voice2 G3が2beats、onset 0/0/1 |
| E `e-rest.musicxml` | 1beat休符→C4、note onset 1、総2beats |
| F `f-backup-forward.musicxml` | backupで戻りforwardで移動、E4/G3/C4のonset 0/1/2 |

単体テストは上記に加え、小節の最大長、divisions継承/変更、分数同時刻、異なる音価の和音、同pitch重複、MIDI alter、tie/tied、tempo/offset、無効入力、内蔵3曲の以前と同じ音列・終了・手本時刻を検証します。

ブラウザテストはA〜Fの追加・OSMD表示・解析値・操作制限、大譜表の2段と4音符、PC/狭幅レイアウトを確認します。旧DBに単旋律と大譜表を入れ、再読み込み後の復元と**DBレコード全体の不変**も比較します。手本から複雑曲への切替後はNote Off/All Notes Offを確認し、時計を20秒進めても再送信がないこと、MIDI許可要求1回・入力リスナー1個を検証します。

既存テストは維持し、休符・複数Staff/Voiceが解析可能になった期待値とキャッシュ再判定だけを更新しました。ローカル検証結果は以下のとおりです。mainへ反映した後の公開成否は、対象コミットのActions結果と公開URLの検証で区別し、作業完了報告に記載します。

| 確認 | 結果 |
| --- | --- |
| 単体テスト | 136件成功 |
| lint | 成功 |
| テスト型チェック | 成功 |
| アプリ型チェック・本番build | 成功（既存OSMDサイズ警告あり） |
| 開発版ブラウザ | 82件成功 |
| 本番dist・サブパス | 83件成功 |
| GitHub Actions・Pages | [対象コミットのbuild/deploy結果](https://github.com/metaborin/ai-piano-practice/actions/workflows/deploy-pages.yml)を公開後に確認 |
| 公開URLへのブラウザテスト | 本番distと同じ83件を公開後に実行し、完了報告に記載 |
| Chromebook/PX-100実機 | ユーザー確認待ち |

MIDIはモックと時計制御で検証します。音がPX-100から出たこと・実際に止まったことを、自動テストの結果としては主張しません。OSMDチャンクの既存サイズ警告は残ります。

## Chromebook実機確認

1. 保存済み曲がある同じChromeプロファイルで公開URLを再読み込みします。上部が`Phase 2E-C1`になり、以前追加した曲が残ることを確認します。サイトデータを消す操作は不要です。
2. 既存のMIDI接続・入出力機器を選び、内蔵3曲と保存済み単旋律について正解/誤り・連打・最終音・もう一度・手本の音順/音価・カーソル・停止を確認します。
3. [fixtureフォルダー](https://github.com/metaborin/ai-piano-practice/tree/main/tests/fixtures/timeline)のA〜Fを開き、GitHubのDownload raw fileからChromebookへ保存します。アプリの「＋ 曲を追加」で選択し、登録します（内蔵曲へ自動追加はしていません）。
4. Aは3Moment/3notesで従来の単旋律練習・手本ができることを確認します。
5. Bはドミソ和音、Cはト音記号/ヘ音記号の2段と4音が見えることを確認します。B〜Fは解析・表示可能と表示され、練習・もう一度・手本・前後移動が無効であることを確認します。
6. 「開発者用」→「Score解析」のStaff・Voice・Moment・Notes・Rest・総拍数を上の表と比較します。複雑曲の表示中に鍵盤を弾いても、最新MIDI入力だけ更新され、練習は進まないことを確認します。
7. 単旋律の手本を再生し、途中でCの大譜表へ変更します。PX-100の音が止まり、20秒以上待っても旧曲が再発音しないことを耳で確認します。
8. きらきら星へ戻し、MIDI機器の選択を維持したまま練習と手本を再開できること、C4テストと「すべての音を停止」が使えることを確認します。
9. ページ再読み込み・Chrome終了/再起動後も、以前の曲と今回の追加曲が残り、同じ表示・制限になることを確認します。

結果は使用曲名、成功/失敗、機器名、問題があれば再現手順と一緒に記録してください。和音・両手の実際の判定や手本再生は今回の実機確認対象外です。

## 17項目の完了条件

「自動確認」は実装・モック・ブラウザでの確認を意味します。実機の受入欄は別です。

| # | 条件 | 実装・自動確認 | Chromebook受入 |
| --- | --- | --- | --- |
| 1 | MomentベースのScoreModel | 対応・単体テスト | 解析表示を確認待ち |
| 2 | 単音 | 対応・A | A確認待ち |
| 3 | 和音を1Moment | 対応・B | B確認待ち |
| 4 | 2Staff | 対応・C、OSMD2段 | C確認待ち |
| 5 | 複数Voice | 対応・D/F | D/F確認待ち |
| 6 | backup/forward | 対応・F | F確認待ち |
| 7 | restの時間進行 | 対応・E、休符をnoteにしない | E確認待ち |
| 8 | durationのbeats正規化 | 分数単体テスト | 解析表示を確認待ち |
| 9 | staff/voice保持 | 元note単位の単体テスト | C/D確認待ち |
| 10 | tie情報保持 | tie/tied単体テスト | タイ曲の表示確認は任意 |
| 11 | 内蔵単旋律3曲 | 音列・練習・手本・ブラウザ | 実機待ち |
| 12 | 追加単旋律 | XML/MXL・保存曲テスト | 実機待ち |
| 13 | 複雑譜のOSMD表示 | B〜Fブラウザ | 表示確認待ち |
| 14 | 解析と次Phase練習を分離 | 表示・ボタン・MIDI抑止 | 操作確認待ち |
| 15 | 既存IndexedDB曲の保持 | version1の旧レコード不変テスト | 自分の保存曲で確認待ち |
| 16 | MIDI入出力維持 | 既存モック・タイマー・切替停止 | PX-100実音確認待ち |
| 17 | GitHub Pages | 本番サブパスを検証。main反映後の公開結果は上記Actions・完了報告参照 | Chromebookで確認待ち |

未完了なのは新しい実機受入と、明示した解析範囲外の機能です。範囲外をC2として今回実装したり、和音を単旋律と誤って評価したりはしません。
