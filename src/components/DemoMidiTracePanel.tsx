import { useState } from 'react'
import type { DemoMidiTrace } from '../midi/DemoMidiTrace'

export function DemoMidiTracePanel({ trace }: { trace: DemoMidiTrace }) {
  const [text, setText] = useState('「ログを更新」で直近の送信記録を表示します。')
  const refresh = () => setText(trace.read().map(e =>
    `${e.order} ${e.event} pitch=${e.pitch ?? '-'} @${e.timestamp?.toFixed(3) ?? '-'} sent=${e.requestedAt.toFixed(3)} session=${e.session} gen=${e.generation} index=${e.sequenceIndex} measure=${e.measure ?? '-'} pass=${e.repeatPass ?? '-'}${e.reason ? ' ' + e.reason : ''}`
  ).join('\n') || 'まだ送信記録がありません。')
  return <section aria-label="Demo MIDI Trace">
    <h3>Demo MIDI Trace</h3>
    <p>直近2048件。@はMIDI指定時刻、sentは送信要求時刻（ページ開始からのms）です。NOTE_OFFは予約を記録しています。実発音を検知した記録ではありません。</p>
    <button onClick={refresh}>ログを更新</button>
    <textarea className="demo-midi-trace" aria-label="Demo MIDI Traceの記録" readOnly value={text} rows={10} />
  </section>
}
