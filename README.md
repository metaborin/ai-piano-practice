# AIピアノ練習アプリ — Phase 2A

React + TypeScript + Vite で、きらきら星の楽譜表示と Web MIDI 入力を確認するアプリです。

GitHub Pages: **https://metaborin.github.io/ai-piano-practice/**

`main` への push で自動デプロイします。[公開設定・ChromeのMIDI許可・Chromebook実機確認の手順](docs/GITHUB_PAGES.md)を参照してください。

**Phase 2A の実装は完了しています。Chromebook + PX-100 の実機による受入確認は未実施です。** Phase 1 で確認済みの機器接続を前提とし、ハードウェアの再調査は行っていません。

## 1. 作成・変更したファイル

既存アプリがなかったため、この `ai-piano-practice` ディレクトリに新規作成しました。以下はソース・設定・ドキュメントの全一覧です。`node_modules/`、`dist/`、`test-results/` は生成物です。

```text
ai-piano-practice/
  .github/workflows/deploy-pages.yml
  .gitignore
  .nvmrc
  .oxlintrc.json
  index.html
  package.json
  package-lock.json
  vite.config.ts
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  tsconfig.tests.json
  playwright.config.ts
  playwright.pages.config.ts
  README.md
  docs/
    GITHUB_PAGES.md
    PHASE2A_CHECKLIST.md
    phase2a-desktop.png
    phase2a-mobile.png
  src/
    main.tsx
    App.tsx
    App.css
    index.css
    midi/
      midiTypes.ts
      parseMidiMessage.ts
      MidiManager.ts
      useMidi.ts
    score/
      ScoreModel.ts
    scores/
      twinkle.musicxml
    components/
      MidiStatus.tsx
      ScoreView.tsx
      MidiDebugPanel.tsx
      PracticeControls.tsx
  tests/
    unit/
      parseMidiMessage.test.ts
      MidiManager.test.ts
    e2e/
      midiFixture.ts
      practice.spec.ts
    pages/
      assets.spec.ts
```

Vite のサンプル画面・画像・アイコンは取り除きました。

## 2. 実装内容

- **楽譜:** OSMD の SVG 描画。ト音記号、ハ長調、4/4 拍子、右手の単音4小節。`60 60 67 67 | 69 69 67 | 65 65 64 64 | 62 62 60`。各フレーズ末尾の G4 / C4 は二分音符、それ以外は四分音符です。
- **現在位置:** 最初の音に緑のカーソル。前後ボタンで14音を移動し、先頭・末尾で該当ボタンを無効化します。画面幅変更時も選択中の音を維持します。
- **MIDI:** 接続ボタンから `navigator.requestMIDIAccess({ sysex: false })` を呼び出します。初回接続では `U2MIDI Pro MIDI 1` を優先します。複数の入力機器は選択欄で切り替えられます。機器名・メーカー名、未接続／接続待ち／接続中／エラーを表示します。
- **抜き差し:** 許可取得後は機器の接続・切断を監視します。選択中の機器がなくなれば別の利用可能な入力、なければ接続待ちになります。入力の変更・切断で古い受信表示を消します。
- **入力表示:** 最新の音名、MIDI Note、Velocity、Event、Channel。Note Off の直後も打鍵強度を読めるよう、直近の Note On と Note Off をそれぞれ画面内のメモリーに保持します。履歴・ファイル・ブラウザーストレージへの保存はありません。
- **MIDI 整理:** Note On の Velocity 0 を Note Off に正規化。Channel は1〜16。`timestamp` は `MIDIMessageEvent.timeStamp` のミリ秒値で、時刻やテンポの評価には使用していません。ペダル・Clock・Active Sensing などは無視します。
- **責務分離:** `MidiManager` は楽譜を参照しません。`ScoreModel` は MusicXML と曲の情報、`ScoreView` は OSMD の描画とカーソル、`App` は画面の組み立てを担当します。音名は表示専用で、MIDI Note Number が基準値です。

音程判定、自動カーソル移動、手本再生、リズム・テンポ評価、AI、データ保存は実装していません。`NoteMatcher`、`PracticeSession`、`DemoPlayer`、`AI Coach` の仮実装も追加していません。

## 3. 使用した npm パッケージ

直接依存パッケージです。再現可能なバージョンは `package-lock.json` に固定しています。

| 用途 | パッケージ | 実装時のインストール済みバージョン |
| --- | --- | --- |
| UI | react / react-dom | 19.3.0 / 19.3.0 |
| MusicXML 描画 | opensheetmusicdisplay | 2.1.3 |
| 開発・ビルド | vite / @vitejs/plugin-react | 8.3.1 / 6.1.1 |
| 型検査 | typescript | 6.0.3 |
| 型定義 | @types/react / @types/react-dom / @types/node | 19.3.0 / 19.3.0 / 24.19.0 |
| lint | oxlint | 1.85.0 |
| 単体テスト | vitest | 5.0.2 |
| ブラウザーテスト | @playwright/test | 1.63.0 |

Web MIDI はブラウザー標準 API を直接利用します。

## 4. 起動方法

Node.js 24 系と npm を使用してください。この実装は Node.js 24.16.0 で検証しています。`.nvmrc` にも `24` を指定しました。

親ディレクトリから実行します。

```sh
cd ai-piano-practice
npm ci
npm run dev
```

同じ端末の Google Chrome で **http://localhost:5173/ai-piano-practice/** を開きます。使用中のポートがあれば Vite が表示した URL を使ってください。この作業環境には依存パッケージをインストール済みです。

```sh
npm run lint
npm test
npm run typecheck:tests
npm run build
```

ブラウザーテストを別の開発環境で初めて実行する場合:

```sh
npx playwright install chromium
npm run test:e2e
```

Linux でブラウザー実行用のシステム依存が不足している場合は Playwright の出力案内に従ってください。Chromebook でアプリを使うだけなら、Playwright のインストール・実行は不要です。

本番ビルドのローカル確認:

```sh
npm run build
npm run preview
```

Chrome で Vite が表示する `localhost` URL（通常 http://localhost:4173/ai-piano-practice/）を開きます。配信用ファイルは `dist/` に出力されます。GitHub Pages 用のサブパスも含めた検証は `npm run test:pages` で実行できます。

## 5. Chromebook での実機確認手順

**GitHub Pages の公開URLを開く場合は Linux / Node.js のセットアップは不要です。** [公開ページ用の実機確認手順](docs/GITHUB_PAGES.md#chromebook-での-web-midi-実機確認)を利用してください。以下はローカル開発を行う場合の手順です。

### Chromebook 自身で起動する場合

1. 利用可能なら ChromeOS の Linux 開発環境を有効にし、Node.js 24 系を用意します。管理対象端末では Linux が制限される場合があります。[Google のセットアップ手順](https://support.google.com/chromebook/answer/9145439?hl=ja)
2. このプロジェクトを Chromebook の「Linux ファイル」にコピーします。Windows の `node_modules/` はコピーせず、Chromebook 上で `npm ci` を実行します。
3. プロジェクトのディレクトリで `npm run dev -- --host 0.0.0.0 --port 5173 --strictPort` を実行します。
4. **ChromeOS 標準の Google Chrome** で http://localhost:5173/ai-piano-practice/ を開きます。Linux 内のサーバーを ChromeOS の Chrome から localhost で開けます。[ChromeOS の公式説明](https://chromeos.dev/en/web-environment)

### 別端末でビルドしたアプリを使う場合

GitHub Pages の場合は `main` への push 後に GitHub Actions が `dist/` を作成・公開します。https://metaborin.github.io/ai-piano-practice/ を Chromebook の Chrome で直接開いてください。別の配信先へ変更する場合は、配信パスに合わせて Vite の `base` を設定して再ビルドしてください。

**Windows PC の `http://192.168.x.x:5173/` を Chromebook から開く方法では、MIDI を利用できません。** Web MIDI は secure context とユーザーの許可を必要とします。同じ端末の localhost、または HTTPS を利用してください。[MDN: Web MIDI の要件](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API#security_requirements)

### アプリ上の確認

1. Phase 1 で確認済みの接続（PX-100 → U2MIDI Pro → Chromebook）をそのまま使用します。
2. きらきら星の4小節が読めること、最初の C4 にカーソルがあることを確認します。
3. 「次の音」を13回押し、「前の音」で先頭まで戻ります。長いソとド、小節・段の境界も確認します。
4. 「MIDI接続」を押し、Chrome の要求を許可します。`MIDI ● 接続中`、`U2MIDI Pro MIDI 1`、`CME Pro` を確認します。
5. 中央のドを押して保持し、`C4 / MIDI Note 60 / Note On / Channel 1` を確認します。送信チャンネルを変更済みなら、その番号が表示されます。
6. 鍵盤を離し、`Note Off` を確認します。Velocity 0 の Note On で送信される場合も Note Off と表示します。
7. 弱く・中くらい・強く弾き、**直近の Note On** の Velocity が変化することを確認します。Note Off の Velocity は打鍵強度とは別の値です。
8. 同じ音や異なる音を何度か弾き、カーソルの位置と `1 / 14 音` などの表示が変わらないことを確認します。
9. ケーブルを抜き差しし、接続待ち→接続中、入力再開を確認します。画面幅を変え、手動カーソル位置が維持されることも確認します。

## 6. 完了条件と検証結果

2026-09-26、Windows / Node.js 24.16.0 / Playwright Chromium での結果:

- TypeScript + Vite のビルド: 成功。
- lint（Oxlint）: エラーなし。
- 単体テスト: 22 件成功（MIDI 正規化、C4 表記、権限待ち・切断時のライフサイクル）。
- テストコードの型検査: 成功。
- ブラウザーテスト: 7 件成功（MusicXML の音列・拍数、実際の SVG 描画、14音の往復、リサイズ、MIDI 模擬入力、機器選択・再接続、拒否・エラー復旧）。
- 1280px と390px 幅の画面を画像でも確認。

**MIDI 自動テストは模擬入力です。実機確認済みとは扱っていません。** 10項目の完了条件・実機記録欄は [PHASE2A_CHECKLIST.md](docs/PHASE2A_CHECKLIST.md) にあります。

画面例: [横画面](docs/phase2a-desktop.png) / [狭い画面](docs/phase2a-mobile.png)。いずれも MIDI 未接続状態です。

## 7. 未解決事項・注意点

- この環境では Chromebook / PX-100 / U2MIDI Pro を実際に操作できないため、今回のアプリでの実機受入確認は未実施です。
- OSMD の独立した遅延読み込みチャンクが約1.31MB（gzip 約337KB）のため、ビルド時にサイズ警告が出ます。ビルドエラーではありません。初回の楽譜読み込み時間は Chromebook で確認してください。
- npm インストール時に OSMD の間接依存である `prebuild-install` の非推奨通知が出ました。実装時の npm audit は脆弱性0件で、ビルド・描画は検証できています。
- MIDI 許可が拒否されている場合は、Chrome の対象サイトの MIDI 設定を許可して再試行してください。管理対象 Chromebook のポリシーで拒否される場合もあります。
- この楽譜のカーソル単位は単音の14位置です。和音・休符・複数パートを含む汎用の譜面追従は今回の対象外です。
- 入力表示は画面を再読み込みすると消えます。ペダルによる音の伸びなどは評価していません。

## 8. Phase 2B に進む前の確認

実機で **C4=60、打鍵ごとの Velocity、Note On/Off、接続の安定性、全14音の手動移動、MIDI 入力時にカーソルが動かないこと** を確認してください。タッチ操作・譜面台付近での見やすさ・画面幅変更も確認し、[チェックリスト](docs/PHASE2A_CHECKLIST.md) に記録してください。その後に音程判定と自動カーソル移動を設計する段階です。

OSMD のカーソルは [公式 Cursor API](https://opensheetmusicdisplay.github.io/classdoc/classes/Cursor.html) の `reset()`、`show()`、`next()`、`previous()` を使用しています。
