import type { PracticeSnapshot } from '../practice/PracticeSession'
import { midiNoteName } from '../midi/parseMidiMessage'

type Props = { practice: PracticeSnapshot; blocked?: boolean; onPrevious: () => void; onNext: () => void }
export function DeveloperControls({ practice, blocked = false, onPrevious, onNext }: Props) {
  const { currentNoteIndex, totalNotes, expectedMidiNote, status } = practice
  const disabled = blocked || totalNotes === 0 || status !== 'idle'
  return (
    <details className="developer-controls">
      <summary>開発者用</summary>
      <p>開発確認用の手動カーソルです。練習・手本の開始前に操作でき、練習開始で先頭へ戻ります。</p>
      <p className="expected-note">練習の現在音：{expectedMidiNote === null ? '—' : `${midiNoteName(expectedMidiNote)} / MIDI Note ${expectedMidiNote}`}</p>
      <div className="cursor-buttons">
        <button onClick={onPrevious} disabled={disabled || currentNoteIndex === 0}><span aria-hidden="true">← </span>前の音</button>
        <button onClick={onNext} disabled={disabled || currentNoteIndex >= totalNotes - 1}>次の音<span aria-hidden="true"> →</span></button>
      </div>
    </details>
  )
}
