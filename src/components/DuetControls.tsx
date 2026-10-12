import type { DuetPartId, Song } from '../songs/Song'
import type { DuetSnapshot } from '../practice/DuetController'

type Props = { song: Song; part: DuetPartId; partnerEnabled: boolean; duet: DuetSnapshot; practiceActive: boolean; onPart: (part: DuetPartId) => void; onPartner: (enabled: boolean) => void; onStop: () => void }
export function DuetControls({ song, part, partnerEnabled, duet, practiceActive, onPart, onPartner, onStop }: Props) {
  const piece = song.duet!
  return <section className="duet-controls" aria-label="一人連弾の設定" data-duet-status={duet.status}>
    <h2>一人で連弾練習</h2>
    <div className="duet-selectors">
      <label>練習対象パート<select value={part} onChange={e => onPart(e.target.value as DuetPartId)}>
        <option value="primo">PRIMO（高音域）</option><option value="secondo">SECONDO（既存の楽譜）</option>
      </select></label>
      <label>相手パート自動再生<select value={partnerEnabled ? 'on' : 'off'} onChange={e => onPartner(e.target.value === 'on')}>
        <option value="off">なし</option><option value="on">あり（{part === 'primo' ? 'SECONDO' : 'PRIMO'}を鳴らす）</option>
      </select></label>
      <button onClick={onStop} disabled={!practiceActive}>連弾練習を停止</button>
    </div>
    <p className="flow-hint">PRIMOは新作の右手単旋律です。手本ボタンでは自分のパートを聴けます。</p>
    {duet.message && <p role={duet.status === 'error' ? 'alert' : 'status'}>{duet.message}</p>}
    {piece.downloads && <details className="duet-downloads"><summary>PRIMO楽譜・合奏確認用データ</summary>
      <div><a href={piece.parts.primo.musicXml.value} download>PRIMO MusicXML</a><a href={piece.downloads.primoMxl} download>PRIMO MXL</a><a href={piece.downloads.primoPdf} target="_blank" rel="noopener">PRIMO PDF</a><a href={piece.downloads.fullScore} download>合奏確認用 MusicXML</a><a href={piece.downloads.fullMxl} download>合奏確認用 MXL</a></div>
      <p>合奏確認用データは2パート対応の楽譜ソフトで開いてください。</p>
    </details>}
  </section>
}
