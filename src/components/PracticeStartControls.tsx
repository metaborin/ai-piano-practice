import type { PracticePlan } from '../practice/PracticePlan'
import type { PracticeStart } from '../practice/PracticeStartResolver'

type Props = { plan: PracticePlan | null; requested: PracticeStart; onChange: (start: PracticeStart) => void }
export function PracticeStartControls({ plan, requested, onChange }: Props) {
  return <div className="practice-start-controls">
    <label className="demo-start">練習の開始位置
      <select disabled={!plan} value={requested.kind === 'beginning' ? 'beginning' : `measure:${requested.measureIndex}`}
        onChange={event => onChange(event.target.value === 'beginning' ? { kind: 'beginning' } : { kind: 'measure', measureIndex: Number(event.target.value.slice(8)) })}>
        <option value="beginning">最初から</option>
        {plan?.score.measures.map(measure => <option key={measure.index} value={`measure:${measure.index}`}>{measure.number}小節目から</option>)}
      </select>
    </label>
  </div>
}
