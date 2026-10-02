# Phase 2E-E — 練習用楽譜／元の楽譜 切り替え

MusicXMLを正解基準とする練習用楽譜に加え、同じSongに保存したPDF・画像を参照できます。表示切り替えは演奏状態を変更しません。D3.4はユーザーによる実機確認済み。Eの実装・自動検証と、Chromebook + PX-100 + U2MIDI Proによる実機受入は分けて扱います。Phase 3は実装していません。

## 作成・変更ファイル

| ファイル | 内容 |
| --- | --- |
| `src/songs/Song.ts` | 既存originalScoreへMIME・サイズ・作成日時を追加 |
| `src/songs/OriginalScoreRepository.ts`（新規） | Blob取得、Songと添付の一体更新契約 |
| `src/songs/readOriginalScoreFile.ts`（新規） | 拡張子・MIME・ヘッダー・30 MiB検証とメタデータ生成 |
| `src/songs/IndexedDbSongRepository.ts` | DB v2、Blobストア、原子的な登録・置き換え・削除 |
| `src/songs/LibrarySongRepository.ts`, `useSongLibrary.ts` | 元の楽譜操作の委譲、再選曲を伴わないメタデータ反映 |
| `src/components/OriginalScoreEditor.tsx`（新規） | ファイル選択、登録／置き換え／削除確認 |
| `src/components/OriginalScoreView.tsx`（新規） | Blob読込、画像表示、URL管理、スクロール保持、局所的エラー処理 |
| `src/components/PdfScoreView.tsx`（新規） | PDF.jsによる複数ページ参照表示、表示付近だけの描画 |
| `src/components/SongLibrary.tsx` | 各曲の登録状態・元の楽譜操作 |
| `src/components/ScoreView.tsx`, `ScoreOverview.tsx` | 非表示中の更新抑制、復帰時の位置・赤表示・スクロール |
| `src/App.tsx`, `src/App.css`, `index.html` | 表示専用状態・タッチ操作・版表示 |
| `vite.config.ts`, `pdfAssets.ts`（新規） | Vite baseを維持しPDF.js補助アセットを同梱 |
| `package.json`, `package-lock.json` | PDF.jsの固定バージョン追加 |
| `tests/unit/originalScore.test.ts`（新規） | 元ファイル検証・メタデータ・バイト維持 |
| `tests/e2e/originalScore.spec.ts`, `originalErrors.spec.ts`, `originalFixtures.ts`（新規） | 実IndexedDB、移行、PDF/画像表示、再生中切替、失敗・復帰 |
| 既存E2E・`tests/unit/LibrarySongRepository.test.ts` | MusicXML用inputの指定を明確化、DBの版固定を解除、リポジトリモック更新 |
| `tests/e2e/chords.spec.ts`, `demo.spec.ts`, `output.spec.ts` | 模擬時計による時刻固定、E版の表示確認 |
| `README.md`, `docs/GITHUB_PAGES.md`, 本文書 | 利用方法・公開・設計・実機手順 |

既存E2Eの調整対象は `chords.spec.ts`, `demo.spec.ts`, `demoLifecycle.spec.ts`, `feedbackDemoStart.spec.ts`, `imports.spec.ts`, `library.spec.ts`, `longScore.spec.ts`, `lookAhead.spec.ts`, `output.spec.ts`, `overview.spec.ts`, `practiceStart.spec.ts`, `realPiece.spec.ts`, `repeatMidi.spec.ts`, `repeats.spec.ts`, `timeline.spec.ts`（いずれも `tests/e2e/`）です。

MusicXML原文、ScoreModel、PracticeSession、PracticeSequence、DemoPlayer、MIDI管理、GitHub Actionsワークフローは変更していません。

## データと保存

`Song.originalScore` は既存の `type: 'pdf' | 'image'` と `storageId` を引き継ぎ、`fileName`, `mimeType`, `size`, `createdAt` を持ちます。過去の将来用参照だけのレコードを破壊しないため、追加属性は型上optionalです。新しい登録処理は全属性を必須として生成します。`storageId` は登録ごとのUUIDで、添付IDを兼ねます。音列・練習情報は含みません。

DB名は `ai-piano-practice` のまま、versionを1から2へ上げます。upgradeでは `originalScores` ストアを追加するだけで、既存 `songs` の削除・再作成・原文の再保存は行いません。実ブラウザにversion 1のマイムを保存し、更新後もレコードが一致することをテストしています。

`originalScores` のレコードは `{ id: storageId, blob: Blob }`。base64にせず、Fileを同じバイト列のBlobにして保存します。画像の再圧縮・縮小はしません。保存確認前はIndexedDBを変更しません。

`OriginalScoreRepository` は音楽解析を扱いません。実装を既存IndexedDBリポジトリに置き、曲とBlobの両ストアを1つのreadwrite transactionで扱います。

- 登録：Blob追加とSong.originalScore設定を同時commit。
- 置き換え：旧Blob削除、新Blob追加、メタデータ更新を同時commit。
- 元だけ削除：BlobとoriginalScoreを削除し、MusicXMLその他を維持。
- 曲削除：曲レコードと紐付くBlobを同時削除。
- transaction失敗：すべてrollback。新Blobだけ残る／旧Blobだけ消える状態を作りません。

原譜は端末の同じブラウザ・同じサイトに保存されます。GitHubへのアップロードや端末間同期、バックアップ機能はありません。サイトデータ削除等に備え、ユーザーの元ファイルは引き続き保管してください。

## PDFと画像の表示

標準PDF viewerは軽い候補ですが、ブラウザ側のviewer内部にスクロールと表示エラーが隠れるため、アプリ側で確実に復帰・検証する要件に合わせPDF.jsを採用しました。Chromebookの標準viewerが利用できないと断定したものではありません。

追加npmパッケージは **pdfjs-dist 6.3.289**。PDF画面のコンポーネントとPDF.jsは遅延importし、PDFを開いたときだけ取得します。workerはViteのURL import、標準フォント・日本語CMap・スキャン画像用WASM等は同じ公開先の `pdfjs/` から取得します。[PDF.js公式の層構造と使用方法](https://mozilla.github.io/pdf.js/getting_started/)、[公式描画例](https://github.com/mozilla/pdf.js/blob/master/docs/contents/examples/index.md)を確認しています。

各ページの縦横比を取得し、パネル幅へfitします。IntersectionObserverで表示付近のページだけCanvasへ描画し、遠いページのCanvasは解放します。描画倍率は最大2倍・1ページ400万画素に抑え、保存Blobは変更しません。PDF内のリンク・フォーム・スクリプト用UIは作りません。パスワード付きPDFは明示エラーにします。複雑なPDFの全形式対応を保証するものではありません。

画像はBlob URLを `img` へ渡し、縦横比を保ってパネル幅に収めます。PDF・画像とも同じ参照パネル内でスクロールできます。画像は1曲1ファイルです。PDF上のカーソル、赤表示、音符タップ、MusicXMLとの対応付け、PDFミニマップ、OMRはありません。

画像URLはビューを離れる・曲変更・置き換え・削除・unmountでrevokeします。遅れたBlob取得結果はキャンセル済みなら採用しません。PDFはBlobのArrayBufferをworkerへ渡すため文書用Blob URLを作りません。PDF非表示時は読み込み・描画taskをcancel/destroyし、workerとCanvasを破棄します。

## 表示状態と演奏状態

Appの表示状態は `{ requestId, mode: 'practice' | 'original' }`。右手／左手／両手のPracticeModeと分けています。曲要求IDが変わると練習用表示へ戻ります。元の楽譜がない場合は切り替え欄を出しません。MusicXMLの初期描画中は元の楽譜ボタンを無効にし、隠れた状態でOSMDを初期描画しないようにします。

切り替えはこの表示状態だけを変更します。selection.select、PracticeSessionのreset、DemoPlayerのstop/generation更新、MIDI clear・All Notes Off等は呼びません。登録メタデータの反映も曲を再選択せず、ライブラリのoriginalScoreだけ更新します。

練習用のScoreViewとOSMDインスタンスはmountedのまま保持します。元の楽譜表示中はメイン楽譜・ミニマップをhiddenにし、カーソルseek・赤DOM変更・追従スクロール・ResizeObserver起因の描き直しを抑えます。練習判定・手本位置の通知自体は続きます。

戻ると最新のmomentとSequenceOccurrenceへseekし、不足音を反映します。音が進んでいれば現在位置を追従し、進んでいなければ手動で見ていた練習用のscrollTop/Leftを保ちます。反復pass・指定開始位置・選択パート・正解数・完了状態・MomentMatchFeedbackは表示切り替えの対象外です。

元の楽譜のscrollTop/Leftは別refに記録します。ビューを開き直してPDFのページ寸法や画像が準備できた時点で復元します。読み込み途中の高さ0や非表示化のscrollイベントで保存位置を上書きしません。PDFを非表示中に保持し続ける重い描画処理はありません。曲／添付が変われば原譜スクロールはリセットします。

## ファイル検証とエラー

上限は `MAX_ORIGINAL_SCORE_SIZE = 30 * 1024 * 1024` バイト。拡張子、MIME、先頭シグネチャを検査します。MIMEが空または汎用octet-streamの場合のみ拡張子と実内容で判定します。対応外、形式不一致、空、上限超過、File読込、IndexedDB読書き、Blob欠落、URL作成、画像decode、PDF解析・描画・表示モジュール取得をそれぞれ元の楽譜側で扱います。

エラーでPracticeSessionを停止・初期化しません。「練習用楽譜」へ戻れ、別の元ファイルを登録できます。過去のメタデータだけで実Blobがない場合も再登録を案内します。PDF表示モジュール自体の通信失敗はReactの局所的ErrorBoundaryで受け止め、ページ全体を落としません。通信復旧後もPDFモジュールを取得できない場合はページの再読み込みが必要です。

## 自動検証

| 確認 | ローカル結果 |
| --- | --- |
| `npm run lint` | 成功、警告なし |
| `npm run typecheck:tests` | 成功 |
| `npm test` | 25ファイル・394件成功 |
| `npm run build` | 成功、TypeScriptを含む。既存のOSMD大サイズチャンク警告あり |
| 開発版E2E | 全196件を対象に実行。194件成功後、時刻依存2件を修正して成功を確認。関連32件の再実行は31件成功・長い反復1件が30秒の総実行枠に達したため60秒に変更し、本番版で成功を確認 |
| ローカル本番配信 | 元の楽譜18件＋既存Pagesアセット1件、計19件すべて成功 |

長いシナリオの総実行枠は60秒ですが、個別の表示・状態の条件は緩めていません。本番配信19件は `npx playwright test --config=playwright.pages.config.ts tests/e2e/originalScore.spec.ts tests/e2e/originalErrors.spec.ts tests/pages/assets.spec.ts` で実行しました。GitHub Actionsでは既存機能も含む全197件を一括実行し、成功後だけ公開する既存条件を維持します。対象commit・Actions・公開URLでの実結果は最終報告で示します。

追加テストは実ブラウザのIndexedDBを使い、PDF/各画像の保存・バイト一致・同一Songへの紐付け・再読み込み・取得・置換/両削除・v1移行・rollbackを検証します。マイムoriginal版で両手の反復2回目・赤表示・現在位置を保持し、参照中にも練習が進むこと、元の楽譜表示中の手本継続、復帰後のOSMD、MIDI clear/CC123/重複ハンドラーなしを確認します。

PDFは2ページの合成文書を実際にCanvasへ描画し、2ページ目までのスクロールと復帰を確認します。JPG/JPEG/PNG/WEBPは800×2400の合成画像で解像度・表示・復帰を確認します。ユーザーのPDFや著作権のある楽譜画像をテスト用にコピーしていません。

既存E2Eのfile input指定はMusicXML欄へ限定しました。新しい参照ファイル欄と取り違えないためです。既存DB読取テストはversion 1固定を外しました。300ms和音入力と手本の各音を観察するテストは、ホスト・CIの処理時間に左右されないよう模擬時計を停止して必要な時刻だけ進めます。製品の判定時間・MIDI予約間隔は変更していません。

## GitHub Pages

`/ai-piano-practice/` とmain push→既存Actions→Pagesの公開手順を維持します。元ファイルはビルド対象ではありません。`pdfAssets.ts` が配信するのはPDF.jsの補助データのみです。ビルド、ローカル本番配信テスト、GitHub Actions公開、公開URL検証を別々に確認します。公開結果は最終報告にcommitとActions実行へのリンクを示します。

## Chromebook実機確認

1. [公開アプリ](https://metaborin.github.io/ai-piano-practice/)を再読み込みし、Phase 2E-E表示と、以前保存したマイム・マイムが残っていることを確認します。サイトデータは消さないでください。
2. PX-100 + U2MIDI Proを接続し、MIDI入力・出力の機器選択を確認します。
3. 自分の曲の「元の楽譜を登録」から実際のPDFを選び、曲名・ファイル名・形式・サイズを確認して登録します。キャンセルも試します。
4. ページ再読み込み後に曲を選び直し、「元の楽譜」にPDFが残り、書き込みや指番号が読めること、2ページ目以降へパネル内スクロールできることを確認します。
5. 練習用で任意小節を手動表示し、元PDFも途中へスクロールします。切り替えを往復し、演奏が進んでいない間はそれぞれの位置に戻ることを確認します。
6. 両手練習を開始し、誤った音を弾いて不足音を赤くします。元へ切り替えて戻り、現在位置・正解数・赤表示・右左両手モード・開始位置が保たれることを確認します。
7. 元の楽譜表示中にも正しい音を弾き、練習用へ戻ると進んだ現在位置に表示が合うことを確認します。
8. マイムoriginalの反復2回目でも同じ操作を行い、反復2回目のままであることを確認します。
9. 手本再生中に元PDFへ切り替え、PX-100の音が途切れず、音抜け・二重発音・急な停止がないことを耳で確認します。PDFをスクロールし、練習用へ戻ると現在の手本位置へ緑帯が追従することを確認します。
10. JPG/JPEG・PNG・WEBPでも登録・表示・幅fit・スクロールを試します。小さい文字や鉛筆書きが読めるか確認します。
11. 「元の楽譜を変更」でキャンセル後は旧ファイル、置き換え後は新ファイルになることを確認します。
12. 「元の楽譜を削除」後も曲・MusicXML・練習が残ることを確認します。不要なテスト曲で曲全体の削除も試します。
13. 元の楽譜表示中に別曲を選び、練習用表示へ戻ること、再選択後に原譜を開けることを確認します。
14. 切り替えだけではMIDI接続・機器選択が変わらないこと、従来の停止・すべての音を停止・もう一度も利用できることを確認します。

## 未解決・実機受入の境界

自動テストのMIDIはモックです。実際のPX-100の発音・停止やChromebook実機での読める大きさ、大きなスキャンPDF表示中の音の連続性はユーザーの確認待ちです。パスワード付きPDF、特殊なPDF、極端に多いページ／巨大な画像の描画には制約があり、表示できなければ参照側だけにエラーを出します。端末間の共有・バックアップ、PDFとMusicXMLの位置同期、Phase 3機能は未実装です。実機受入が済むまではPhase 2E-E全体を完了扱いにしません。
