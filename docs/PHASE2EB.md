# Phase 2E-B — MusicXML / MXLの追加・保存・削除

実装日: 2026-09-26。Phase 2E-AはユーザーのChromebook実機確認まで完了済みです。

公開先: https://metaborin.github.io/ai-piano-practice/

追記：ユーザーからChromebook + CME U2MIDI Pro + CASIO PX-100による実機確認も問題なく完了したとの報告を受け、Phase 2E-Bは完了しました。以下は実装時の記録です。次の実装・受入は [Phase 2E-C1](PHASE2EC1.md) に分けて記録します。

## 作成・変更ファイル

| ファイル | 役割 |
| --- | --- |
| src/songs/IndexedDbSongRepository.ts（新規） | IndexedDBの保存・取得・削除、エラー、スキーマ更新 |
| src/songs/LibrarySongRepository.ts（新規） | 内蔵＋追加曲を同じRepositoryに統合、内蔵曲保護 |
| src/songs/readSongFile.ts（新規） | 拡張子・入力サイズ、XMLデコード、MXL指定先展開 |
| src/songs/inspectMusicXml.ts（新規） | 基本検証・メタデータ・対応範囲・互換性再判定 |
| src/components/SongImport.tsx（新規） | 登録確認、編集、キャンセル、ScoreModel検証、保存 |
| src/songs/Song.ts | 元ファイル名・形式・互換性とImportedSong型 |
| src/songs/SongRepository.ts | 書き込み可能なRepository契約 |
| src/songs/libraryRepository.ts | 内蔵RepositoryとIndexedDB Repositoryの組み立て |
| src/songs/useSongLibrary.ts | CRUD後の一覧更新、初回だけの初期選択、古い一覧結果の無効化 |
| src/components/SongLibrary.tsx | 追加曲カード・状態・選択・削除確認 |
| src/components/ScoreView.tsx | XMLの対象音数と実ScoreModelの音数を照合 |
| src/score/validateMusicXml.ts | 共通の対応範囲検査を利用 |
| src/App.tsx / src/App.css / index.html | 登録・削除の接続、タッチUI、Phase表記 |
| package.json / package-lock.json | JSZip 3.10.1を直接依存に追加 |
| tests/e2e/imports.spec.ts（新規） | ファイル・実IndexedDB・互換性・MIDI・再起動・異常系 |
| tests/unit/mxlExtraction.test.ts（新規） | 展開サイズの境界・過大圧縮データの停止 |
| tests/unit/LibrarySongRepository.test.ts（新規） | 内蔵曲の変更/削除保護、保存領域失敗時の内蔵曲維持 |
| tests/e2e/library.spec.ts / tests/e2e/output.spec.ts | 追加ボタンの新動作、Phase表記の更新 |
| README.md / docs/GITHUB_PAGES.md / docs/PHASE2EA.md / docs/PHASE2EB.md | 使い方・設計・検証・実機受入 |

内蔵3曲のXML、PracticeSession、NoteMatcher、DemoPlayer、MIDI管理、Viteのbase、GitHub Actionsは維持しています。

## データとIndexedDB

- 同一originのDB `ai-piano-practice`、version `1`、object store `songs`、keyPath `id`。
- IDは `imported:` + `crypto.randomUUID()`。同じ名前・同じ内容でも別レコードとして保存します。
- `title`、任意の`composer`、`source: imported`、`partLabel`、`musicXml: {type: text, value: XML全文}`、`originalFileName`、`fileFormat`、Unixミリ秒の`createdAt`、`compatibility`を保存。
- MusicXMLを文字列にデコードした後は、整形・省略・単純化・再シリアライズをせず保存します。曲名編集はSongメタデータだけを変更します。
- `IndexedDbSongRepository`はrequest成功だけでなく、transactionのcompleteまで待って成功を返します。abort・容量不足・アクセス拒否・upgrade blockedは画面へ通知します。保存失敗時は確認フォームを残し、再試行できます。
- versionchange時は接続を閉じ、次回操作時に再度openします。再読み込み・ブラウザ再起動は同じDBを読み直します。
- `LibrarySongRepository`が内蔵＋追加曲を返します。UIは共通のSong一覧をsourceで分類するだけです。保存領域の読み取り失敗時は警告を出し、内蔵曲を引き続き返します。
- 内蔵Repositoryは読み取り専用。統合Repositoryも内蔵IDのadd/deleteを拒否します。
- `originalScore`のPDF/image参照型は維持しました。Blob保存用storeはまだ作りません。将来のversion upgradeで別storeを追加し、storageIdで参照できます。

アプリと内蔵曲はGitHub Pagesから取得します。ユーザー曲は端末のIndexedDBにのみ保存し、GitHubにもサーバーにも送信しません。他端末への同期やエクスポートはありません。サイトデータの削除・保存領域の消去・プライベート閲覧終了では消失し得るため、元ファイルを保管してください。ページ再読み込み後の選択曲は従来どおり「きらきら星」です。

## ファイル取得・検証・登録

1. `＋ 曲を追加`で単一ファイルを選択。拡張子は大文字小文字を区別せず `.musicxml` / `.xml` / `.mxl`。
2. 入力ファイルの上限は10 MiB（10 × 1024 × 1024 bytes）。XMLはUTF-8、またはBOM付きUTF-16で読みます。
3. MXLはJSZipで開き、`META-INF/container.xml`を読む。最初の`rootfile`の`full-path`をZIPルートからの相対パスとして取得します。XML候補の推測検索はしません。[MusicXML公式MXL仕様](https://www.w3.org/2021/06/musicxml40/tutorial/compressed-mxl-files/)
4. containerは64 KiB、MusicXML本体の展開後は10 MiB、ZIP内は1024エントリまで。展開ストリームを監視し、上限を超えたらpauseして破棄します。関係のない添付は展開しません。[JSZipのストリームAPI](https://stuk.github.io/jszip/documentation/api_zipobject/internal_stream.html)
5. DOMParserでXML構文、score-partwise/score-timewiseルート、part、measureを検証。非MusicXMLや壊れたXMLは保存できません。
6. 曲名はwork-title→movement-title→拡張子なしのファイル名→無題。作曲者はidentification内のcomposer。確認画面で両方編集できます。
7. 対応範囲内なら、独立した非表示ScoreViewで実際のOSMDと既存readScoreModelを実行。描画・MIDI音高・音価・対象音数の一致まで確認し、成功したものだけ「使用できます」と表示します。構造が未対応の場合はOSMDへ渡しません。
8. 明示的な「追加する」で初めて保存します。キャンセルでは保存しません。保存中は再送信を防ぎます。ファイル読込と描画の要求IDにより、古い非同期結果で新しい確認画面を上書きしません。

拡張子・入力サイズ・文字コード・ZIP破損・container欠落/破損・rootfile欠落/不正パス・本体欠落・展開サイズ・非MusicXML・part/measure欠落・ScoreModel解析失敗・保存失敗は、理由を表示します。異常があっても選択中の曲の練習状態とMIDI接続を作り直しません。

## 現在の対応範囲と互換性

現在はscore-partwiseの1パート・1声部・1Staffの単旋律を基本とし、休符、和音、装飾音、小音符、タイ、反復、backup/forward、移調/オクターブ移動、連符/トレモロ、打楽器音、画像/外部参照などを未対応とします。score-timewiseも保存はできますが、現在の練習では未対応です。

1000音・500小節を超える楽譜はブラウザ描画の上限として未対応扱いで保存できます。上限は定数化しています。XSD全体の適合検証やすべてのMusicXML要素の演奏解釈を実装するものではありません。

複雑なXML・対象音なし・ScoreModel解析失敗の曲は「現在の練習機能では未対応」と理由を表示して原文を保存できます。勝手に1声部へ変換しません。選択しても練習・手本の開始を有効にしません。

`compatibility`はstatus（supported/unsupported/unknown）・version・reasons。versionは現在1。保存結果は一覧用のヒントです。一覧取得時に構造を再検査し、判定versionが古い対応曲はunknownへ戻します。**選択時は保存されたsupportedを信用せず、必ず現在の共通検証→OSMD→ScoreModelを通過してから操作を有効にします。** 将来対応範囲を増やすときは検査とversionを更新できます。

MusicXML文字列は共通のloadSongMusicXml→SongSelection→ScoreViewを経由します。同じXMLから描画とScoreModelを作り、ScoreModelをPracticeSession・DemoPlayerへ渡します。追加曲専用の判定・手本ロジックや別の正解音配列はありません。既存の固定100 BPM、音価、停止方式は維持します。

## 削除と状態管理

各追加曲の「削除」→通常UIの「この曲を削除しますか？」→「削除する」で削除。confirmダイアログは使いません。

選択中の曲はDB削除を待つ前に、既存selection.selectできらきら星へ切り替えます。練習判定停止→手本タイマー/旧通知の無効化→Note Off/All Notes Off→モデル・進捗リセットを再利用します。発音や予約が後から復活しません。削除失敗時はレコードを残し、きらきら星の待機状態で再試行できます。

選択していない曲の削除や曲の追加では、現在の練習・選択曲をリセットしません。MIDIアクセス・入出力機器選択・入力ハンドラーを維持します。

## 自動検証と公開

ローカル検証結果:

- `npm test`: 92件成功（既存88件＋4件）。
- `npx playwright test`: 74件成功（既存38件＋取り込み関連36件）。
- `npm run test:pages`: 本番ビルドと75件成功。
- `npm run lint`、`npm run typecheck:tests`、アプリ型チェックを含む`npm run build`: 成功。
- Chromiumの同じprofileでプロセスを終了・再起動し、曲の永続化を確認。
- 1366px/390px幅の画面を確認。OSMDの既存チャンクサイズ警告以外にビルドの問題はありません。

公開は既存のmain push→Actions build/deploy→Pagesを使用します。公開URLへの75件のテストを別途実行し、デプロイrunのURLと確定結果は実装チャットの最終報告に記録します。ローカルbuild成功だけで公開済みとは扱いません。

テストは実ブラウザのIndexedDBを使い、ファイル形式3種、メタデータ/修正/キャンセル、原文保存、同名UUID、再読み込み、新しいページ、ブラウザプロセス終了後の同一profile再起動、削除、transaction abort、アクセス拒否、古い互換性、遅延ファイル読込、狭い画面、外部送信なしを検査します。

MIDIはモックとタイマー制御です。追加曲の正誤・5音/G4の終了・手本音列・削除時の発音停止・予約停止・20秒後の再発音なし・MIDI接続維持を確認します。Phase 2E-Aまでの既存テストも維持します。実際のPX-100の音・消音は自動テストで確認済みとはしません。

## 完了条件15項目

| # | 条件 | 実装・自動確認 | Chromebook実機 |
| --- | --- | --- | --- |
| 1 | ＋ 曲を追加 | 実装、ファイル選択を検査 | 未確認 |
| 2 | musicxml/xml/mxl | 3形式の登録経路を検査 | 未確認 |
| 3 | 内容検証 | XML・MXL・サイズ・構造の異常系を検査 | 未確認 |
| 4 | 曲名・作曲者確認 | 抽出・補完・修正・キャンセルを検査 | 未確認 |
| 5 | 明示保存 | 実IndexedDBとtransaction abortを検査 | 未確認 |
| 6 | 自分の曲へ表示 | 一覧・形式・対応状況を検査 | 未確認 |
| 7 | 再読み込み後に残る | reload・ページ再作成・ブラウザ再起動を検査 | 未確認 |
| 8 | 対応曲の楽譜表示 | 実OSMD/ScoreModelで検査 | 未確認 |
| 9 | 対応曲の練習 | MIDIモックで誤音・正音・終了を検査 | 未確認 |
| 10 | 対応曲の手本 | MIDIモックで音列・停止を検査 | 発音/同期未確認 |
| 11 | 未対応を誤動作させない | 原文維持・未対応表示・開始無効を検査 | 未確認 |
| 12 | 追加曲の削除 | 確認・取消・削除・失敗・選択中停止を検査 | 消音を含め未確認 |
| 13 | 内蔵曲を維持 | 全3曲の既存回帰・削除保護を検査 | 未確認 |
| 14 | MIDI入出力 | モックで接続・機器選択・1ハンドラーを検査 | 未確認 |
| 15 | GitHub Pages | 本番サブパス・実公開を別途確認 | 公開版実機未確認 |

## Chromebook実機確認手順

1. Chromeで公開URLを再読み込みし、Phase 2E-Bを確認します。シークレットではない通常のChromeを使います。
2. 1パート・1声部・1Staffで休符/和音/タイ/反復なしの短いMusicXMLを用意します。既存の[短いメロディの原本](https://raw.githubusercontent.com/metaborin/ai-piano-practice/main/src/scores/short-melody.musicxml)をファイルとして保存して試すこともできます（5音、G4→E4→F4→D4→G4）。
3. 「＋ 曲を追加」→ファイル選択→曲名・作曲者・形式・対応状況を確認。曲名を変更し「追加する」。自分の曲に出ることを確認します。可能ならXMLとMXLの両方で試します。
4. ページ再読み込みで残ること、Chromeを閉じて同じプロフィールで開き直しても残ることを確認します。初期曲はきらきら星なので追加曲を選び直します。
5. PX-100 MIDI OUT→U2MIDI Pro MIDI IN、U2MIDI Pro MIDI OUT→PX-100 MIDI IN、USB→Chromebookを接続。「MIDI接続」で許可し、入力・出力機器を確認します。[既存のChrome許可手順](GITHUB_PAGES.md)
6. 追加曲を選択し、曲名・楽譜・音数・最初の音が一致することを確認。「練習開始」→誤音で待つ→正音で進む→最後で終了→「もう一度」で先頭。
7. 「手本を聴く」で表示曲がPX-100から鳴り、カーソルが追従すること、停止・再開できることを耳と画面で確認します。
8. 手本の発音中にその追加曲を削除し、確認UIで「削除する」。きらきら星に戻り、音が止まり、20秒待っても前曲が再発音しないことを確認します。MIDI機器選択が変わらないことも確認します。
9. 再読み込みして削除が残ることを確認。別曲の削除では現在の練習が変わらないこと、削除のキャンセルでは曲が残ることも確認します。
10. 手元に和音/複数声部などの楽譜があれば追加し、「未対応」として保存され、練習/手本を開始できないことを確認。内蔵曲へ戻して正常復帰することを確認します。
11. 内蔵3曲、C4テスト、全音停止、MIDI入出力デバッグも確認してください。

```text
実機確認日 / ChromeOS・Chrome:
入力機器 / 出力機器:
使用ファイル / 形式 / 対応状況:
曲名・作曲者の確認と編集:
保存 / 再読み込み / Chrome再起動:
楽譜 / 正誤 / 最後で終了:
手本の発音・カーソル同期:
削除時の消音 / 20秒後の再発音なし:
削除の永続化 / 内蔵曲への復帰:
MIDI接続・機器選択の維持:
気付いた点:
```

## 未解決事項・対象外

- Phase 2E-BのChromebook実機受入は未実施です。
- OSMDの既存チャンクサイズ警告は継続。buildエラーではありません。
- XML全文は保持しますが、MXLアーカイブ自体・添付画像・PDFは保存しません。元ファイルのバックアップはユーザー側で保持してください。
- ブラウザの保存領域が失われた後の復旧・別端末同期・同一ファイルの重複排除は今回の範囲外です。
- PDF/画像、元楽譜切替、OMR、和音/両手/複数声部への拡張、リズム解析、AIは未実装です。
