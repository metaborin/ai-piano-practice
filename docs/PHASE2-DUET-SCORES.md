# 第1段階：マイム・マイム PRIMO 検証

2026-10-12。既存SECONDOに合わせた**新作教育用編曲**。動画・市販PRIMOの採譜ではありません。

## 楽譜と構成

- `src/scores/duet/maim-maim-primo-once.musicxml`：30小節、87打鍵対象。
- `src/scores/duet/maim-maim-primo-original.musicxml`：書かれた30小節、演奏順1〜30→5〜30、164打鍵対象。
- 同ディレクトリのSECONDOは既存 `tests/fixtures/timeline/maim-maim-full-{once,original}.musicxml` とバイト単位で同一。
- `public/duet-scores/`：PRIMOのMXL/PDF各2点、確認用2パートfull scoreのMusicXML/MXL各2点。
- `output/pdf/`：確認・印刷用PRIMO PDF各1ページ。公開用PDFと同じ内容。

全曲2/2拍子、二分音符116（四分音符232 BPM）、各小節4四分拍。originalの反復開始は5小節目、終了は30小節目。反復をMusicXMLに記し、譜面の小節は複製しません。

## 編曲方針

PRIMOは右手の単旋律、G♯4〜B5（MIDI 68〜83）。SECONDOの最高音F4より上で、両者の鍵盤域が重なりません。四分・二分音符と四分休符を使用し、和音・装飾・タイ・特殊奏法は追加していません。SECONDOのG / Am / Dm / C、4・12・30小節のE→Amに沿った和声音中心の新しい旋律です。B5や跳躍を含むため、先にPRIMO単独で音域を確認してください。

full scoreは確認専用です。既存アプリの一般インポートは単一MusicXML partに限るため、2パートfull scoreを直接取り込む対応は追加しません。PRIMO単体は既存のMusicXML/MXL取り込みで使用できます。

## 第1段階の確認結果

- 既存パーサーによる小節番号・開始拍・長さ・テンポ・反復の一致、SECONDO原本の同一性：単体4件成功。
- PRIMO once/original × MusicXML/MXL：実OSMDを使った既存取り込み・表示・カーソル対応・音数確認、ブラウザ4件成功。
- 右手/両手のPracticePlanとDemoPlan生成が可能（PRIMOは一段譜のため同じ単旋律）。
- MXL内のXMLは元MusicXMLと同一。full scoreはPRIMO/SECONDOの2パート・各30小節。
- OSMDからPDF化し、Popplerで両方の全ページをPNG化して目視確認。タイトル・小節・反復記号がページ内に収まることを確認。
- 確認用full scoreもOSMDで描画。PRIMO一段とSECONDO二段の配置、先頭と30小節目の反復位置を確認しました。実音での合奏評価は別途必要です。

PX-100での合奏の響き・弾きやすさは未確認です。機械的な構成一致を音楽的な実機受入と同一視しません。第1段階の成果物を基盤として第2段階へ進みます。
