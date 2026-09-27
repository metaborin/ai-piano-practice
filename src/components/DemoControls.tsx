import type { DemoSnapshot } from '../audio/DemoPlayer'
import { useState } from 'react'
import type { PracticePlan } from '../practice/PracticePlan'
export type DemoChoice = 'beginning' | 'current' | `measure:${number}`
type Props = { demo: DemoSnapshot; plan: PracticePlan | null; outputReady: boolean; outputBusy: boolean; onPlay: (choice: DemoChoice) => void; onStop: () => void }

export function DemoControls({ demo, plan, outputReady, outputBusy, onPlay, onStop }: Props) {
  const [choice, setChoice] = useState<DemoChoice>('beginning')
  const playing = demo.status === 'playing'
  return (
    <section className="demo-controls" aria-label="手本演奏" data-demo-status={demo.status}>
      <label className="demo-start">手本の開始位置
        <select value={choice} onChange={(event) => setChoice(event.target.value as DemoChoice)} disabled={!plan || playing}>
          <option value="beginning">最初から</option><option value="current">現在位置から</option>
          {plan?.score.measures.map((measure) => <option key={measure.index} value={`measure:${measure.index}`}>{measure.number}小節目から</option>)}
        </select>
      </label>
      <div className="practice-buttons">
        <button onClick={() => onPlay(choice)} disabled={demo.totalNotes === 0 || !outputReady || outputBusy || playing}>{playing ? '再生中…' : '手本を聴く'}</button>
        <button onClick={onStop} disabled={!playing}>停止</button>
      </div>
      <p className="demo-message" role="status">{!playing && outputBusy && demo.status === 'stopped' ? '停止しました。次の操作を準備しています…' : demo.message || 'ピアノの音で、手本を聴いてみよう'}</p>
    </section>
  )
}
