# GitHub Pages 公開・Chromebook実機確認

対象リポジトリ: [metaborin/ai-piano-practice](https://github.com/metaborin/ai-piano-practice)

公開URL: **https://metaborin.github.io/ai-piano-practice/**

Phase 2A の楽譜・MIDI機能を引き継ぎ、Phase 2B の音順練習を ChromeOS の Chrome から HTTPS で利用するための公開設定です。Chromebook での利用に Node.js や Linux 開発環境は必要ありません。

## 変更内容

- `vite.config.ts` の `base` を `/ai-piano-practice/` に設定しました。JavaScript、CSS、OSMD の遅延読み込みチャンクもこのパスで配信します。
- `twinkle.musicxml` は引き続き `src/score/ScoreModel.ts` の `?raw` import でビルド時に JavaScript に埋め込みます。実行時に `/src/scores/...` を取得しないため、GitHub Pages でも XML のパスは壊れません。`public/` への複製も不要です。
- MusicXML の DOCTYPE の HTTP URL は文書形式の宣言です。アプリから DTD を取得する処理はありません。
- `.github/workflows/deploy-pages.yml` で `main` への push と手動実行に対応します。Node.js 24、`npm ci`、lint、型検査、単体テスト、build、ブラウザーテストが成功した場合のみ `dist/` を Pages に公開します。
- 公式 GitHub Actions をバージョンに対応するコミット SHA で固定しました。追加のアクセストークンを Secrets に登録する必要はありません。デプロイには GitHub が発行する `GITHUB_TOKEN` を使用します。
- 本番ビルドと公開先に同じ Phase 2A の回帰テストと Phase 2B の音順練習テストを実行できます。

Phase 2B では「練習開始」後だけ、正しい MIDI Note の打鍵でカーソルが進みます。「前の音／次の音」は開発者用の折りたたみ領域に残し、練習前のみ使用できます。リズム・テンポ・AI・手本再生は実装していません。

## リポジトリ作成から公開まで

このプロジェクトでは **`package.json` がある `ai-piano-practice` フォルダー自体をリポジトリのルート** にします。その親フォルダーをルートにしないでください。

### 初回だけ行う設定

1. GitHub に `metaborin` でログインします。
2. `ai-piano-practice` というリポジトリを作成します。GitHub Free の Pages を使用する場合は Public にします。作成済みなら再作成しません。
3. プロジェクトのファイルを `main` ブランチに commit / push します。`.github/workflows/deploy-pages.yml` も含めます。`node_modules/`、`dist/`、`test-results/` は `.gitignore` で対象外になります。
4. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。`Deploy from a branch` や `gh-pages` ブランチは使用しません。[GitHub公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
5. **Actions → Deploy to GitHub Pages** を開き、`build` と `deploy` の両方が成功したことを確認します。初回に Pages 設定が間に合わず失敗した場合は、設定後に **Re-run all jobs** または **Run workflow → main** で再実行します。
6. Settings → Pages の **Visit site** から公開URLを開きます。HTTPS のURLと末尾の `/` を含めてブックマークしてください。

GitHub CLI で新規リポジトリを作成する場合のコマンド例です。既にリポジトリが作成・接続済みの場合は繰り返し実行しません。

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
git init -b main
git add .
git commit -m "Deploy Phase 2A to GitHub Pages"
gh repo create metaborin/ai-piano-practice --public --source=. --remote=origin --push
gh api --method POST repos/metaborin/ai-piano-practice/pages -f build_type=workflow
```

初回コミット時に Git のユーザー情報を求められたら、GitHub のユーザー名と Settings → Emails に表示された noreply メールアドレスを、そのリポジトリ内の `git config user.name` / `git config user.email` に設定します。トークンをファイルに書いたり commit したりする必要はありません。

### 次回以降の更新

```sh
git add .
git commit -m "Update Phase 2A"
git push origin main
```

`main` の更新から Actions が自動で検査・ビルド・公開します。失敗時は Actions の失敗したステップを確認してください。手動で `dist/` を push する必要はありません。

## 公開用ビルドのローカル確認

```sh
npm ci
npm run lint
npm test
npm run typecheck:tests
npm run build
npm run preview
```

Chrome で **http://localhost:4173/ai-piano-practice/** を開きます。開発サーバーのURLも **http://localhost:5173/ai-piano-practice/** に変わります。

本番ビルドに対するブラウザーテスト:

```sh
npx playwright install chromium
npm run test:pages
```

このコマンドは build 後、4174番ポートで `dist/` を起動し、既存機能・Phase 2B・サブパスのテスト12件を実行します。テストでは MIDI を模擬し、実際の演奏機器は操作しません。

公開済みサイトを PowerShell から同じテストで確認する場合:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://metaborin.github.io/ai-piano-practice/'
npm run test:pages
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

## Chromebook での Web MIDI 実機確認

1. Phase 1 で確認済みの接続を使用します: **PX-100 MIDI OUT → CME U2MIDI Pro → Chromebook の USB-A**。
2. ChromeOS 標準の **Google Chrome** で公開URLを直接開きます。埋め込み表示や GitHub のソース閲覧画面は使用しません。
3. 楽譜4小節・14音、最初の C4 の緑のカーソル、`1 / 14 音` を確認します。
4. **MIDI接続** を押します。Chrome が MIDI 機器へのアクセスを尋ねたら **許可** を選択します。SysEx の利用や MIDI 出力はこのアプリでは要求しません。
5. **MIDI ● 接続中**、機器名 **U2MIDI Pro MIDI 1**、メーカー **CME Pro** を確認します。
6. 中央のドを押して保持し、**C4 / MIDI Note 60 / Note On** を確認します。鍵盤を離して **Note Off** を確認します。
7. 弱く・中くらい・強く弾き、**直近の Note On** の Velocity が変わることを確認します。Note Off の Velocity は打鍵強度とは別の値です。
8. 練習開始前は入力でカーソルが進まないことを確認します。必要なら「開発者用」を開き、**前の音／次の音** で手動移動を確認します。
9. **練習開始** を押すと先頭へ戻ります。間違った音は「もう一度♪」と表示され、正しい音は「できた！」と表示されて1音進みます。
10. 最初のドは「押す→離す→もう一度押す」で2音進めます。14音を順番に弾いて「できました！」を確認し、「もう一度」で最初から再開します。[Phase 2Bの詳しい確認手順](PHASE2B.md#10-chromebook実機確認手順)

### 許可ダイアログが出ない／以前拒否した場合

1. 公開ページを開いた状態で、Chrome のアドレスバー左側にあるサイト情報・コントロールのアイコンを押します。
2. **サイトの設定** を開き、**MIDI** に関する項目を **許可** にします。表示名は Chrome のバージョンにより異なります。項目が見つからなければ対象サイトの権限をリセットします。
3. アプリを再読み込みし、再び **MIDI接続** を押します。
4. 「管理者によってブロック」などが表示される場合は、学校等の端末管理者に対象サイトでの MIDI 利用可否を確認します。

許可は公開ページのサイト（`metaborin.github.io`）に対する設定です。Windows の localhost での許可は Chromebook へ引き継がれません。Web MIDI は HTTPS 等の secure context と、ブラウザーの許可を必要とします。[MDN: Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API#security_requirements)

## GitHub Pages 上で確認する項目

- [ ] URL が `https://metaborin.github.io/ai-piano-practice/` である。
- [ ] Actions の `build` と `deploy` が成功している。
- [ ] 白い画面や404にならず、楽譜・CSS・カーソルが表示される。
- [ ] MusicXML の14音が正しい。最初は C4、長いソと最後のドは二分音符。
- [ ] ページの再読み込みでも楽譜が表示される。
- [ ] 前後移動・端のボタン無効化・画面幅変更が正常。
- [ ] MIDI 権限を許可でき、U2MIDI Pro MIDI 1 / CME Pro が表示される。
- [ ] PX-100 の C4 が60、Velocity が打鍵に応じて変化、On / Off の両方が表示される。
- [ ] 練習開始前は入力でカーソルが動かない。開始後は正解の打鍵で1音だけ進む。
- [ ] 間違い・Note Off・押しっぱなしの重複入力では進まない。
- [ ] 14音目で「できました！」になり、「もう一度」で1音目へ戻る。
- [ ] 抜き差し後に接続状態が更新され、再び受信できる。

Phase 2A はユーザーによる実機確認が完了しています。今回の実機結果は [Phase 2B の受入チェックリスト](PHASE2B.md#11-phase-2b完了条件) に記録してください。ブラウザー自動テストは実機確認の代わりにはなりません。

参考: [Vite の GitHub Pages 設定](https://vite.dev/guide/static-deploy#github-pages)。OSMD のチャンクサイズ警告は既存のもので、ビルドは成功します。
