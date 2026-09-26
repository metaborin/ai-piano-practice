import type { PracticeSnapshot } from '../practice/PracticeSession'

type Props = { practice: PracticeSnapshot; midiConnected: boolean; blocked?: boolean; onStart: () => void; onRestart: () => void }
export function PracticeControls({ practice, midiConnected, blocked = false, onStart, onRestart }: Props) {
  const { status, feedback, totalNotes } = practice
  const message = status === 'demoPlaying' ? '手本を聴いてみよう'
    : status === 'completed' ? 'できました！'
    : status === 'idle' ? '「練習開始」で、はじめの音から弾こう'
    : !midiConnected ? 'MIDIを接続すると、続きから弾けます'
    : feedback === 'correct' ? 'できた！'
    : feedback === 'incorrect' ? 'もう一度♪'
    : '緑の音を弾いてみよう'
  return (
    <section className="practice-controls" aria-label="練習の操作" data-practice-status={status} data-practice-index={practice.currentNoteIndex} data-correct-count={practice.correctNoteCount}>
      <p className={`practice-feedback ${status === 'completed' ? 'completed' : feedback ?? ''}`} role="status">{message}</p>
      <div className="practice-buttons">
        <button className="primary-button" onClick={onStart} disabled={blocked || totalNotes === 0 || !midiConnected || status !== 'idle'}>
          {status === 'completed' ? '練習完了' : status === 'practicing' ? '練習中' : '練習開始'}
        </button>
        <button onClick={onRestart} disabled={blocked || totalNotes === 0 || status === 'idle' || status === 'demoPlaying'}>もう一度</button>
      </div>
      <p className="practice-hint">{status === 'demoPlaying' ? '聴き終わったら「練習開始」で弾いてみよう。' : status === 'idle' && !midiConnected ? '下の「MIDI接続」からピアノをつなぎましょう。' : '自分のペースで、ひとつずつ弾いてみよう。'}</p>
    </section>
  )
}
