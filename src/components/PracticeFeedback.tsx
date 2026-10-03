import type { PracticeSnapshot } from '../practice/PracticeSession'
import { midiNoteName } from '../midi/parseMidiMessage'
type Props = { practice: PracticeSnapshot; midiConnected: boolean }
export function PracticeFeedback({ practice, midiConnected }: Props) {
  const { status, feedback, matchFeedback } = practice
  const runThrough = practice.flowMode === 'run-through'
  const lastAttempt = practice.attempts.at(-1)
  const message = status === 'demoPlaying' ? '手本を聴いてみよう'
    : status === 'completed' ? runThrough ? '通し練習が終わりました' : 'できました！'
    : status === 'idle' ? '「練習開始」で、選んだ位置から弾こう'
    : !midiConnected ? 'MIDIを接続すると、続きから弾けます'
    : feedback === 'correct' ? 'できた！'
    : feedback === 'incorrect' ? runThrough ? `${lastAttempt?.measureNumber ?? ''}小節目：記録しました` : 'もう一度♪'
    : matchFeedback?.status === 'pending' ? '音をそろえてみよう'
    : '緑の帯の音を弾いてみよう'
  const incorrect = (status === 'practicing' || runThrough && status === 'completed') && matchFeedback?.status === 'incorrect'
  const missing = incorrect ? matchFeedback.missingMidiNotes.map(midiNoteName).join('・') : ''
  const unexpected = incorrect ? matchFeedback.unexpectedMidiNotes.map(midiNoteName).join('・') : ''
  return <div className="score-feedback" role="status" aria-live="polite" aria-atomic="true">
    <p className={`practice-feedback ${status === 'completed' ? 'completed' : feedback ?? ''}`}>{message}</p>
    <p className="feedback-notes" title={missing ? `足りない音：${missing}` : undefined}>{missing ? `足りない音：${missing}` : '\u00a0'}</p>
    <p className="feedback-notes" title={unexpected ? `ちがう音：${unexpected}` : undefined}>{unexpected ? `ちがう音：${unexpected}` : '\u00a0'}</p>
    {runThrough && status === 'completed' && <div className="run-through-summary">
      <p>正しく弾けた：{practice.correctNoteCount} / {practice.attempts.length} ステップ</p>
      <p>確認したい小節：{[...new Set(practice.attempts.filter(a => a.result === 'incorrect').map(a => a.measureNumber))].map(number => `${number}小節目`).join('、') || 'ありません'}</p>
    </div>}
  </div>
}
