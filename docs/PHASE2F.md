# Phase 2F — PWA化

公開先: [AIピアノ練習アプリ](https://metaborin.github.io/ai-piano-practice/)

PWAの実装・自動確認と、Chromebookでのインストール・実機受入は別です。Chromebook + CASIO PX-100 + CME U2MIDI Proで下記を確認するまではPhase 2F全体を完了扱いにしません。Phase 3には進んでいません。

## 構成と変更ファイル

| ファイル | 内容 |
| --- | --- |
| `package.json`, `package-lock.json` | Vite 8 / Node 24に対応する `vite-plugin-pwa@2.0.0` を開発依存として固定 |
| `pwa.config.ts`, `vite.config.ts` | base・manifest・Workbox generateSW・事前キャッシュ・ナビゲーションfallback |
| `index.html` | theme-color、SVG favicon、Apple touch icon、説明 |
| `public/icons/piano.svg` | 自作のピアノアイコン原本 |
| `public/icons/piano-192.png`, `piano-512.png`, `piano-maskable-512.png`, `apple-touch-icon.png` | 192 / 512 / maskable 512 / Apple 180 pxのPNG |
| `tools/render-pwa-icons.mjs` | 自作SVGからPNGを再生成するスクリプト |
| `src/pwa/PwaClient.ts`, `client.ts` | SW登録・更新待機・通知・インストールイベント・通信状態の独立した管理 |
| `src/pwa/PwaControls.tsx`, `pwa.css` | 更新通知、練習中の確認、インストール、オフライン表示、手動更新確認 |
| `src/main.tsx` | React StrictModeの外でPWA管理を一度だけ開始 |
| `src/App.tsx` | PWA表示と更新承認時の停止処理を接続、Phase 2F表記 |
| `playwright.config.ts`, `playwright.pages.config.ts` | 既存の通信異常テストとSW検証を分離し、公開ビルド検査へPWAテストを追加 |
| `tests/unit/PwaClient.test.ts` | 更新・インストール・接続状態・manifest・PNGの検査 |
| `tests/pwa/helpers.ts`, `offline.spec.ts`, `versionServer.ts`, `update.spec.ts` | 実際のSW・オフライン・保存データ・2バージョンの更新検査 |
| `tests/e2e/output.spec.ts` | 既存のPhase見出し期待値を更新 |
| `tests/e2e/chords.spec.ts` | 停止検証中の実時間経過を抑え、既存のNote Off期待値を保ったまま仮想時計を固定 |
| `README.md`, `docs/GITHUB_PAGES.md`, 本書 | PWAの利用・公開・実機受入手順 |

既存依存のバージョン、MusicXML解析、ScoreModel、PracticeSession、NoteMatcher、DemoPlayer、OSMD、PDF表示、MIDI管理、IndexedDBスキーマは変更していません。練習結果は従来どおりセッション内のみです。

## Manifest・アイコン・URL

| 項目 | 設定 |
| --- | --- |
| name / short_name | AIピアノ練習アプリ / AIピアノ |
| description | MIDI対応のピアノ練習アプリ |
| id / start_url / scope | `/ai-piano-practice/` |
| display / orientation / lang | `standalone` / `any` / `ja` |
| theme_color / background_color | `#28694e` / `#f5f7f5` |
| manifest | `/ai-piano-practice/manifest.webmanifest` |
| Service Worker | `/ai-piano-practice/sw.js` |

アイコンは第三者素材を使わず、緑地とピアノ鍵盤をSVGで作成しました。maskableは背景を全面不透明にし、鍵盤を中央の安全領域に配置しています。`node tools/render-pwa-icons.mjs` で同じPNGを生成できます（Playwright Chromiumが必要）。Chromeのネイティブなインストール画面での切り抜き・ランチャー表示は実機確認項目です。

ViteとSWは同じ `APP_BASE` を使用します。起動URLに不要なルーターは追加していません。アイコンはmanifest相対、HTML内は `%BASE_URL%`、クライアント側のSW登録は `import.meta.env.BASE_URL` を使います。ナビゲーションfallbackは `/ai-piano-practice/` 配下だけを対象にし、同一GitHub Pages originの別プロジェクトへ広げません。

## キャッシュとオフライン

`vite-plugin-pwa` がWorkboxのService Workerを生成します。開発サーバーではSWを登録せず、本番ビルドで有効です。初回はオンラインで全事前キャッシュが成功するとアプリのウィンドウを制御し、ヘルプに「オフライン用の保存ができました」と表示します。

事前キャッシュ対象はHTML、manifest、アイコン、hashed JS/CSS、内蔵3曲のMusicXML、OSMD、JSZip、PDF.js本体とworker（`.mjs`）、CMap、フォント、WASMと画像デコーダーです。既存のPDF.jsアセットはローカル配信されており、CDN依存はありません。初回キャッシュは220項目、約6.7 MiB（非圧縮）です。単一ファイルは2 MiBを上限にして、将来の追加で必要ファイルが黙って除外されることをビルド時に検出します。

runtime cacheは追加していません。ビルドに含まれない任意の通信を保存せず、Blob URLも扱いません。ユーザーのMusicXML、PDF、画像は従来のIndexedDB `ai-piano-practice`（version 2、`songs` / `originalScores`）だけに保存します。SWはIndexedDBへアクセスせず、複製・移行・削除もしません。

一度保存が完了すれば、オフラインで起動、内蔵曲、保存済みの自分の曲、練習用楽譜、元PDF／画像を利用できます。PDF.jsを初めて開く操作もオフラインで検証しています。MIDIモックでは練習・手本演奏も動作します。「オフラインです」は通知だけであり、練習操作を無効にしません。

初めてのアクセス、事前キャッシュ未完了、キャッシュやサイトデータが削除された端末では、オフライン起動を保証できません。新しい版の取得にはネット接続が必要です。端末の保存領域の削除は曲・元楽譜も失わせるため、更新のためにサイトデータを消す必要はありません。実物のPDFの内容・端末メモリによる制約と既存の30 MiB上限、パスワード付きPDF非対応は維持します。

同じChromeプロファイル・originを利用する別ウィンドウ間の曲・Blob共有を自動テストしています。ChromeOSで実際にインストールしたPWAと既存Chromeタブ間の共有は実機で確認してください。

## 更新・インストール・MIDI

- `registerType: 'prompt'`、`skipWaiting: false`。新しい版のキャッシュが完了すると「新しいバージョンがあります」を表示し、勝手に再読み込みしません。
- 起動、オンライン復帰、ウィンドウのフォーカス／表示復帰（自動確認は最短60秒間隔）、表示中は1時間ごとに更新を確認します。「アプリのインストール・更新」から手動でも確認できます。SWスクリプトはHTTPキャッシュを経由せず確認します。
- 「更新する」を押すと、練習／手本／テスト音の再生中には状態がリセットされる旨を確認します。キャンセルでは現在位置・発音予約を変更しません。
- 承認後だけ待機SWへ `SKIP_WAITING` を送ります。切り替え完了時に既存の停止処理で手本予約・発音を止め、そのウィンドウを一度だけ再読み込みします。idleでは確認なしで適用します。再読み込み後は通常どおり待機状態で、MIDIは利用者が接続します。
- 別ウィンドウで更新が承認されても、このウィンドウを自動リロードしないため、仮想登録モジュールの自動リロードを使わず、小さな独立クライアントで制御します。別窓には更新通知を残します。古い画面で未読込の機能を新たに開く際は、その画面でも更新してください。
- Workboxが新manifestにない旧アセットを削除し、`cleanupOutdatedCaches` も有効です。別プロジェクトのcacheやIndexedDBは削除しません。
- `beforeinstallprompt` が届いたときだけ「アプリをインストール」を表示します。未発火・キャンセルをエラー扱いにせず、Chromeメニュー手順も案内します。`appinstalled` と `display-mode: standalone` ではボタンを非表示にします。

オンライン状態・更新・インストール状態はPWA部品だけが購読します。PWA通知からPracticeSessionやDemoPlayerを操作しません。Appが渡す停止コールバックを使うのは、利用者が更新を承認して本当に再読み込みする直前だけです。

更新通知は原譜全画面の内部にも小さく表示します。全画面で不要なインストール説明を隠し、既存のFullscreen API、100dvh、原譜ズーム、sticky表示を保ちます。

`navigator.requestMIDIAccess()` の既存フローはそのままです。自動接続・追加の権限要求・入力リスナー登録は行いません。ブラウザ版とPWA版の実物のMIDI入出力、音の停止、初回許可はこの環境から確認できません。

## 自動検証と公開

lint、アプリ・ビルド設定の型検査、テストの型検査、本番ビルドは成功しました。単体テストは27ファイル426件（既存412件 + PWA14件）が成功しました。本番ビルドに対するブラウザテストは220件です。全体実行で219件が成功し、停止テスト1件は仮想時計を固定して再実行し成功しました。Note Offの期待値は緩めていません。PWA専用10件もこの中に含みます。

既存の `main` → GitHub Actions → GitHub Pages を使用し、Actionsでも全検査を再実行してから公開します。CIと公開URLでの最終結果・実行記録へのリンクは、この変更の完了報告に記載します。ビルド成功だけを公開成功として扱いません。

ChromiumのDevTools Protocolでmanifestの取得・内容、インストール要件の検査エラー0件を確認しました。Lighthouse CLIはインストールされていないため、Lighthouseスコアは測定していません。従来のOSMD等の大きなbundleの警告は残りますが、ビルドエラーはありません。PWA依存追加時の `npm audit` は脆弱性0件でした。

PWAテストは実際のService Workerを有効にして実施します。既存の取得失敗・遅延取得などのテストでは、事前キャッシュが通信モックを隠さないようSWを無効にしています。更新テストはローカルの専用HTTPサーバーで2種類のSWを生成し、実際のinstall → waiting → activate → キャッシュ整理を検証します。公開サーバーのファイルは書き換えません。

standalone表示判定・インストールイベントは自動テストではシミュレーションです。元PDF検証には既存の2ページ合成PDFを使用します。MIDIは既存モックとタイマー制御で検査します。いずれもChromebookでのインストール／実物の音を確認したことにはなりません。

## Chromebookへのインストール

1. これまで保存した曲を使っている**同じChromeプロファイル**で、オンライン状態の[公開アプリ](https://metaborin.github.io/ai-piano-practice/)を開きます。
2. 「アプリのインストール・更新」を開き、「オフライン用の保存ができました」を確認します。
3. 「アプリをインストール」が出ていれば押します。なければアドレスバーのインストールアイコン、またはChromeの「︙」→「キャスト、保存、共有」→「ページをアプリとしてインストール」を使います。Chromeの版で文言・場所が異なる場合があります。[Chrome公式手順](https://support.google.com/chrome/answer/9658361?hl=ja&co=GENIE.Platform%3DDesktop)
4. アプリ名とピアノのアイコンを確認してインストールします。ランチャーの「AIピアノ練習アプリ」から起動し、必要ならシェルフに固定します。
5. 独立したウィンドウで開くことと、ヘルプの「アプリのウィンドウで起動しています」を確認します。

## Chromebook + PX-100 + U2MIDI Pro 実機受入

確認結果は未記入です。既存曲・元PDFを削除せず、次をChromeタブとPWAで確認してください。

- [ ] ランチャーのアプリ名・アイコン・ウィンドウ起動が正しい。アドレスバーなしの画面で幅・高さが崩れない。
- [ ] Chromeで登録済みの「マイム・マイム」、その他の自分の曲、元PDF／画像がPWAでも残っている。同じ曲を選んで確認する。
- [ ] PWAで新たに登録した曲・元楽譜が、同じプロファイルのChromeを開き直しても見える。
- [ ] ブラウザ版とPWA版それぞれで、未接続 →「MIDI接続」→ 必要ならChromeで許可 → 入出力接続済みとなる。機器選択・デバッグ・C4テスト音・すべての音を停止が動く。
- [ ] きらきら星と保存曲で「できるまで」、和音・両手・反復・途中開始・終了・もう一度が従来どおり動く。
- [ ] 「通し練習」の誤答記録・結果表示が維持される。結果が再読み込みで消えることは従来どおり。
- [ ] 手本がPX-100から鳴り、カーソル・先読み・反復・ミニマップが追従し、停止後に再発音しない。
- [ ] PDF／画像 → 原譜で全画面練習 → 拡大縮小 → Esc／全画面終了 → 練習用楽譜へ戻す操作で、練習・手本と現在位置が維持される。
- [ ] オンラインで保存完了後、アプリを閉じ、Wi-FiをOFFにしてランチャーから再起動できる。
- [ ] オフラインで全内蔵曲・自分の曲・元PDF／画像を表示できる。MIDI接続、練習、手本と停止が動く。
- [ ] Wi-FiのON/OFFだけでは練習位置・MIDI接続が変わらず、オフライン表示だけが切り替わる。
- [ ] 次回公開時、練習／手本中に新バージョン通知が出ても勝手に再読み込み・停止しない。表示されなければオンラインで「更新を確認」。
- [ ] 練習／手本中の「更新する」→ キャンセルで継続する。承認すると発音と予約が停止して新しい版へ移り、保存曲・元PDFが残る。
- [ ] idleで更新した場合も一度だけ再読み込みされる。別タブで更新しても演奏中のウィンドウは勝手に再読み込みされない。

MIDIを拒否した場合は、Chromeのサイト情報／アプリ情報から当該サイトの設定を開き、MIDIを許可してから再度「MIDI接続」を押します。詳細は [GitHub Pages手順](GITHUB_PAGES.md) を参照してください。

未解決事項は、上記の実機受入です。クラウド同期、ログイン、Push、Background Sync、AIコーチ、Phase 3、練習結果の永続保存は追加していません。
