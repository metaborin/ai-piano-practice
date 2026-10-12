# 第1段階：マイム・マイム PRIMO 検証

2026-10-12修正。前版は和声音から別の旋律を作ってしまい、マイム・マイムの主旋律を再現できていませんでした。今回、**曲の主旋律を残した右手譜**へ置換しました。小節長・音域の検査だけでは曲の同一性を保証できなかったため、特徴的なフレーズとリズムの回帰検査を追加しました。

ユーザーの参考動画：[Only Yesterday おもひでぽろぽろ - Mayim Mayim](https://www.youtube.com/watch?v=ad0yViwiXUc)。旋律資料：[John Chambers ABC collection の Mayim_Dm（ABC掲載）](https://abcnotation.com/tunePage?a=trillian.mit.edu%2F~jc%2Fmusic%2Fabc%2FKlezmer%2Ftune%2FMayim_Dm%2F0000)。参考録音の完全採譜・音色・細かな装飾の再現はしていません。

## 楽譜と構成

- `src/scores/duet/maim-maim-primo-once.musicxml`：30小節、118打鍵対象。
- `src/scores/duet/maim-maim-primo-original.musicxml`：書かれた30小節、演奏順1〜30→5〜30、218打鍵対象。
- 同ディレクトリのSECONDOは既存 `tests/fixtures/timeline/maim-maim-full-{once,original}.musicxml` とバイト単位で同一。
- `public/duet-scores/`：PRIMOのMXL/PDF各2点、確認用2パートfull scoreのMusicXML/MXL各2点。
- `output/pdf/`：確認・印刷用PRIMO PDF各1ページ。公開用PDFと同じ内容。

全曲2/2拍子、二分音符116（四分音符232 BPM）、各小節4四分拍。originalの反復開始は5小節目、終了は30小節目。反復をMusicXMLに記し、譜面の小節は複製しません。

## 編曲方針

PRIMOは右手の単旋律、A4〜A5（MIDI 69〜81）。SECONDOの最高音F4より上で、両者の鍵盤域が重なりません。八分・四分・付点四分・二分音符と四分休符を使用し、和音・装飾・タイ・特殊奏法は追加していません。

主旋律26小節をイ短調の高音域へ移し、SECONDOの5〜30小節へ配置しました。1〜4小節は終盤27〜30小節のフレーズを使う前奏です。5〜12小節が最初の主題、13〜22小節が高い同音反復と掛け声に相当する部分、23〜30小節が下降する終盤の主題です。12小節目だけは既存SECONDOのE→Amに合わせ、G5をG♯5へ変更しています。通常の旋律にある弱起は新しい小節を加えず、各小節4拍と既存の反復開始を優先します。

full scoreは確認専用です。既存アプリの一般インポートは単一MusicXML partに限るため、2パートfull scoreを直接取り込む対応は追加しません。PRIMO単体は既存のMusicXML/MXL取り込みで使用できます。

## 第1段階の確認結果

- 既存パーサーによる小節番号・開始拍・長さ・テンポ・反復の一致、SECONDO原本の同一性、主題3部分の音程・音価・前奏と終盤の一致：単体6件成功。
- PRIMO once/original × MusicXML/MXL：実OSMDを使った既存取り込み・表示・カーソル対応・音数確認、ブラウザ4件成功。
- 右手/両手のPracticePlanとDemoPlan生成が可能（PRIMOは一段譜のため同じ単旋律）。
- MXL内のXMLは元MusicXMLと同一。full scoreはPRIMO/SECONDOの2パート・各30小節。
- OSMDからPDF化し、Popplerで両方の全ページをPNG化して目視確認。タイトル・小節・反復記号がページ内に収まることを確認。
- 確認用full scoreもOSMDで描画。PRIMO一段とSECONDO二段の配置、先頭と30小節目の反復位置を確認しました。実音での合奏評価は別途必要です。

同じMusicXMLからローカルWindowsのピアノサンプルで試聴用WAVを生成しました。once約31.53秒、original約58.43秒（短い前後余白を含む）。楽曲時間はSECONDOと同じ約31.03秒／57.93秒です。試聴音源はPX-100の録音ではありません。

全PRIMO発音の音程・開始時刻・離鍵時刻を、アプリの既存 `buildDemoPlan` の結果と照合しました。合奏試聴音源も両パートの同じDemoPlanから作成し、SECONDOのタイによる持続を維持しています。

修正後の自動確認：単体457件、本番ビルドのブラウザ240件、lint、テスト型チェック、buildがすべて成功。PRIMO両版のXML/MXL取り込み、両方向の相手再生、無入力の通し練習、停止、反復、開始位置、ミニマップ、原譜、全画面、PWAを含みます。既存OSMDのチャンクサイズ警告はありますが、ビルドエラーはありません。GitHub Pagesの反映は実際のデプロイと公開URL検査の結果を最終報告で区別します。

PX-100での合奏の響き・弾きやすさと、ユーザーの期待する旋律としての受入は未確認です。機械的な構成一致を音楽的な実機受入と同一視しません。Phase 3には進んでいません。
