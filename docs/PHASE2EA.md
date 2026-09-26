# Phase 2E-A — 曲ライブラリ基盤

実装日: 2026-09-26

公開先: https://metaborin.github.io/ai-piano-practice/

ユーザーから「Phase 2Dまで完了」と報告を受けています。今回は曲モデル・Repository・ライブラリUIの基盤だけを実装しました。Phase 2E-AのChromebook実機確認後に、別の依頼としてPhase 2E-Bへ進みます。

## 作成・変更したファイル

| ファイル | 内容 |
| --- | --- |
| src/songs/Song.ts（新規） | 保存可能なSong、MusicXML所在、元PDF/画像の参照 |
| src/songs/SongRepository.ts（新規） | 非同期の曲一覧・ID取得インターフェース |
| src/songs/BuiltInSongRepository.ts（新規） | 内蔵3曲のメタデータ、IDによる取得 |
| src/songs/libraryRepository.ts（新規） | Repositoryの組み立て・初期曲ID |
| src/songs/loadSongMusicXml.ts（新規） | URL/textをMusicXML文字列へ統一 |
| src/songs/useSongLibrary.ts（新規） | 一覧取得・初期選択・読み込み失敗時の再試行 |
| src/components/SongLibrary.tsx（新規） | 内蔵曲・自分の曲・追加ボタン・案内メッセージ |
| src/assets.d.ts（新規） | ViteのXML URL importの型宣言 |
| src/score/songCatalog.ts（削除） | 固定配列・関数付きSongをRepositoryへ移行 |
| src/score/SongSelection.ts | 新Song型とXML取得関数を利用、一覧取得前の未選択状態 |
| src/score/useSongSelection.ts | 初期曲を固定配列から選ばず、ライブラリから受け取る |
| src/App.tsx / src/App.css | ライブラリUIと初期読み込みを接続、タッチ向けレイアウト |
| index.html | Phase 2E-Aの説明 |
| tests/unit/SongRepository.test.ts（新規） | 3曲・ID・source・データの独立性・将来のimported構造 |
| tests/unit/loadSongMusicXml.test.ts（新規） | URL/text共通化、HTTP/通信失敗、元楽譜の分離 |
| tests/unit/SongSelection.test.ts | テストも固定配列ではなくRepositoryから曲を取得 |
| tests/e2e/library.spec.ts（新規） | ライブラリ、案内だけの追加ボタン、キーボード・画面幅 |
| tests/e2e/output.spec.ts | Phase表示の期待値 |
| tests/e2e/songs.spec.ts | XML取得失敗等のモックをXMLファイル配信へ対応 |
| tests/pages/assets.spec.ts | 全3曲のXML URLがPagesサブパスから読めることを確認 |
| tsconfig.tests.json | XMLアセット型宣言をテスト型検査にも含める |
| README.md / docs/GITHUB_PAGES.md | 現在の構成・使い方・公開手順 |
| docs/PHASE2D.md | ユーザーからの完了報告を追記 |
| docs/PHASE2EA.md（新規） | この実装報告・実機チェックリスト |

内蔵XML3ファイル、ScoreModel、readScoreModel、ScoreView、PracticeSession、NoteMatcher、DemoPlayer、MIDI管理、Vite設定、Actions、依存パッケージは変更していません。

## Songモデル

| 項目 | 型・目的 |
| --- | --- |
| id / title | 安定した曲IDと表示名 |
| source | builtin / imported |
| partLabel | 既存の「右手・単音」表示を保持 |
| musicXml | type: url または text、value: URLまたはXML文字列 |
| composer | 任意の作曲者 |
| tempoBpm / difficulty | 任意のメタデータ。今回の再生速度や判定は変更しない |
| createdAt | 任意の作成時刻。将来使用する場合はUnix時刻のミリ秒 |
| originalScore | 任意の元楽譜参照。type: pdf / image、storageId、任意のfileName |

関数、DOM、MIDIの接続状態、バイナリ添付をSongへ含めません。JSONやstructuredCloneで保存可能なデータです。元楽譜が未設定の内蔵曲もそのまま扱えます。

将来の最近の練習・課題・履歴は、安定したsongIdを参照する別データとして追加できます。Songに練習中の進捗やMIDI機器情報を混ぜていません。今回は履歴・課題等の機能や保存処理は作っていません。

## Repositoryと内蔵曲

`SongRepository` は次の非同期読み取り契約です。

```ts
listSongs(): Promise<readonly Song[]>
getSong(id: string): Promise<Song | undefined>
```

現在はBuiltInSongRepositoryを実装しています。曲配列はその内部に閉じ、UIへ直接exportしません。読み取り時に複製を返すため、呼び出し元がデータを変更しても内蔵曲の定義は壊れません。未知のIDではundefinedを返します。

| ID | 曲 | 音数・先頭 |
| --- | --- | --- |
| twinkle-opening | きらきら星 | 14音・C4 |
| do-re-mi | ドレミの練習 | 7音・C4 |
| short-melody | 短いメロディ | 5音・G4 |

全曲sourceはbuiltinです。音数・正解音・手本用音列はメタデータに重複登録せず、従来どおりXMLから生成します。

`libraryRepository.ts` がRepositoryの実体を選びます。UIはインターフェース経由で一覧を取得し、その結果をsourceでグループ表示します。初期曲IDは既存のtwinkle-openingです。一覧の取得が遅れても、古い取得結果やアンマウント後の結果を適用しません。

Phase 2E-BではIndexedDbSongRepositoryを同じ読み取り契約で実装し、組み立て箇所で内蔵・追加曲の一覧をまとめられます。addSong/deleteSongは書き込み可能なRepositoryへ追加する想定です。今回はダミーの保存・削除APIやIndexedDB実装を追加せず、内蔵Repositoryは読み取り専用にしています。

## MusicXMLの取得と既存処理

`loadSongMusicXml(song)` だけが所在の違いを扱います。

- url: 指定URLをfetchし、HTTP成功を確認して本文を取得。
- text: 保持しているXML文字列を返す。ネットワークへアクセスしない。

sourceがbuiltinかimportedかで音楽処理を分岐しません。戻り値を共通のSongSelectionへ渡し、既存のXML検証 → OSMD読み込み・描画 → 同じカーソルからScoreModel生成 → PracticeSessionとDemoPlayerへの反映へ進めます。

内蔵曲はViteの `?url&no-inline` importを使い、XMLを独立したアセットとして出力します。Viteが `/ai-piano-practice/assets/...` のURLを生成します。以前のraw文字列importから取得方法を変えましたが、XML本文・音高・音価・14/7/5音の対応は維持しています。

内蔵曲を増やす場合は、対応範囲のXMLを `src/scores/` に置き、BuiltInSongRepositoryにそのURL importと一意のSong情報を登録します。UI・判定・手本演奏へ曲別コードを追加する必要はありません。

## 曲変更とoriginalScoreの分離

Phase 2Dの停止・初期化手順を維持しています。

1. 選択イベント内で練習判定を停止し、モデルと進捗をリセット。
2. 手本タイマー・通知を無効化し、発音中の音を既存Note Off／All Notes Offで停止。C4テストが再生中ならそれも停止。
3. 新しいXMLを取得し、既存OSMD・ScoreModel処理が揃ってから待機状態へ。カーソルは先頭。
4. 要求IDにより古い取得・解析・描画通知を無視。既存のOSMDインスタンス分離・後始末も維持。
5. MIDI接続、入出力機器選択、入力ハンドラーは維持。

選択中のSongはSongSelectionが保持し、OSMDへ渡すScoreSourceはid・title・partLabel・musicXmlだけです。originalScoreは音楽モデルや判定に入りません。将来のPDF/画像本体は別ストレージのstorageIdで参照できます。

Phase 2E-Eで表示モードを追加する際も、選択Song・PracticeSession・DemoPlayerのモデルを表示モードから独立させられます。今回はPDF/画像の取得・表示、切り替えタブ、ファイル取り込み、添付保存を一切追加していません。

## UIと今回の範囲

上部に曲ライブラリを置き、内蔵曲をグループ化した選択欄と「自分の曲」の空表示を用意しました。選択欄は52px、追加ボタンは48px以上の高さです。狭い画面では縦に並びます。

「＋ 曲を追加」は通常の画面内メッセージを表示するだけです。ブラウザーalert・ファイル選択を開かず、選択曲・進捗・MIDI接続を変更しません。

MusicXML/MXLのファイル選択・解凍、IndexedDB保存、追加曲削除、PDF/画像、元楽譜表示、和音・左右手・複数Staff/Voice、リズム解析、AIは今回の対象外です。対応する楽譜範囲と固定100 BPMの手本演奏はPhase 2Dと同じです。

## 自動テスト・ビルド

- 単体テスト88件成功（既存78件＋Repository/取得処理10件）。
- 本番ビルドのブラウザーテスト39件成功（既存36件＋ライブラリUI3件）。
- 開発モードのブラウザーテスト38件成功。
- lint・テスト型チェック・アプリ型チェックを含むbuild成功。
- 広い画面と390px幅のスクリーンショットを確認。

既存の全曲表示・正誤判定・終了・曲変更リセット・旧曲の後発再生防止・MIDI維持・非同期の順序逆転・取得/解析/描画失敗からの復帰を引き続き検証しています。MIDIはモックです。実際のPX-100の発音・消音は確認済みとは扱いません。

追加テストではURL/textの一致、HTTP 404/500・通信失敗、元楽譜未設定、保存可能なimported型、PDF/画像への参照が音楽処理を変えないことを確認しています。公開用アセット検査は全3曲のXML URLを検証します。

## GitHub Pages公開

既存のmain → GitHub Actions → GitHub Pagesを維持しています。[Actions](https://github.com/metaborin/ai-piano-practice/actions)で変更コミットのbuild/deploy両方を確認し、公開URLでも39件を実行します。実際のデプロイ結果・コミット・公開URLでのテスト結果は実装チャットの最終報告に記録します。

ローカルbuild成功と公開成功は別に確認します。認証・リポジトリ再作成・公開設定変更をユーザーに要求する構成変更はありません。

## Phase 2E-A完了条件チェックリスト

「自動確認」はローカルの実コードとブラウザーでの確認です。実機欄はユーザー確認後に記録します。

| # | 条件 | 実装・自動確認 | Chromebook |
| --- | --- | --- | --- |
| 1 | 曲ライブラリUI | 確認済み | 未確認 |
| 2 | 内蔵3曲の一覧 | 確認済み | 未確認 |
| 3 | 自分の曲の領域 | 確認済み | 未確認 |
| 4 | ＋曲を追加と案内表示 | 確認済み | 未確認 |
| 5 | 既存3曲の切り替え | 確認済み | 未確認 |
| 6 | 楽譜表示 | 確認済み | 未確認 |
| 7 | 練習判定 | 模擬MIDIで確認済み | 未確認 |
| 8 | 手本演奏 | 模擬MIDIで確認済み | 発音・同期未確認 |
| 9 | 曲切り替えでリセット | 確認済み | 消音を含め未確認 |
| 10 | MIDI接続・機器選択維持 | 模擬MIDIで確認済み | 未確認 |
| 11 | SongRepository経由の管理 | 型・単体・結合確認済み | 対象外 |
| 12 | originalScoreの受け皿 | 型・複製・読み込み分離を確認済み | 表示は後続Phase |
| 13 | GitHub Pages | 本番サブパスで39件成功。実公開結果は最終報告 | 公開版実機は未確認 |

## Chromebook実機確認手順

1. 公開URLをChromeで開き、Phase 2E-A、曲ライブラリ、内蔵3曲、自分の曲の空表示を確認します。古い画面なら再読み込みしてください。
2. 「＋ 曲を追加」を押し、案内が画面内に出ることを確認します。ファイル選択が開かず、曲や進捗が変わらないことを確認します。
3. 既存のPX-100とU2MIDI Proの双方向MIDI接続を使い、「MIDI接続」でChromeの許可を選びます。入力・出力機器を確認します。
4. 3曲を選び、きらきら星14音/C4、ドレミ7音/C4、短いメロディ5音/G4の先頭になることを確認します。
5. 各曲で「練習開始」。誤音で待つ、正音で進む、最後で終了、「もう一度」でその曲の先頭になることを確認します。
6. 「手本を聴く」で表示曲がPX-100から鳴り、音価とカーソルが合うこと、停止できることを確認します。
7. 手本の発音中に別曲へ変更し、音が止まり、20秒待っても前曲が鳴らないことを確認します。新曲は待機状態で、練習・手本を先頭から開始できます。
8. 曲変更後もMIDI接続・入力/出力機器選択を維持することを確認します。きらきら星に戻し、C4テスト・全音停止・入力/出力デバッグも確認します。

以前MIDIを拒否した場合は、Chromeのサイト情報 → サイトの設定 → MIDIの許可を確認して再読み込みします。[既存の詳しい接続・許可手順](GITHUB_PAGES.md)

## 未解決事項

- Phase 2E-AのChromebook + U2MIDI Pro + PX-100実機受入が未実施です。
- OSMDの既存チャンクサイズ警告は継続します。buildエラーではありません。
- MIDI予約のclear非対応時の待ち時間や、画面非表示・大きなタイマー遅延での手本停止は既存仕様です。
- ファイル取り込み・保存は未実装で、意図したPhase境界です。実機確認後も、依頼なしにPhase 2E-B以降へ進みません。

```text
実機確認日 / ChromeOS・Chrome:
入力機器 / 出力機器:
ライブラリ・追加ボタン:
3曲の判定・終了:
手本・同期・切り替え時の停止:
MIDI接続維持:
気付いた点:
```
