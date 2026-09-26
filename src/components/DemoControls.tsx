import type { DemoSnapshot } from '../audio/DemoPlayer'
type Props = { demo: DemoSnapshot; outputReady: boolean; outputBusy: boolean; onPlay: () => void; onStop: () => void }

export function DemoControls({ demo, outputReady, outputBusy, onPlay, onStop }: Props) {
  const playing = demo.status === 'playing'
  return (
    <section className="demo-controls" aria-label="手本演奏" data-demo-status={demo.status}>
      <div className="practice-buttons">
        <button onClick={onPlay} disabled={demo.totalNotes === 0 || !outputReady || outputBusy || playing}>{playing ? '再生中…' : '手本を聴く'}</button>
        <button onClick={onStop} disabled={!playing}>停止</button>
      </div>
      <p className="demo-message" role="status">{!playing && outputBusy && demo.status === 'stopped' ? '停止しました。次の操作を準備しています…' : demo.message || 'ピアノの音で、手本を聴いてみよう'}</p>
    </section>
  )
}
