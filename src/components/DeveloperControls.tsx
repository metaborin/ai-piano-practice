import type { PracticeSnapshot } from '../practice/PracticeSession'
import { midiNoteName } from '../midi/parseMidiMessage'
import type { ScoreModel } from '../score/ScoreModel'

type Props = { practice: PracticeSnapshot; model?: ScoreModel | null; blocked?: boolean; onPrevious: () => void; onNext: () => void }
export function DeveloperControls({ practice, model, blocked = false, onPrevious, onNext }: Props) {
  const { currentNoteIndex, totalNotes, expectedMidiNote, status } = practice
  const disabled = blocked || totalNotes === 0 || status !== 'idle'
  return (
    <details className="developer-controls">
      <summary>開発者用</summary>
      {model && <section className="score-analysis" aria-label="Score解析">
        <h3>Score解析</h3>
        <p>Staff：{model.staffCount} ／ Voice：{model.voices.join(', ')}</p>
        <p>Moment：{model.moments.length} ／ Notes：{model.notes.length} ／ Rest：{model.rests.length}</p>
        <p>Chord：{model.moments.some((moment) => moment.notes.length > 1) ? 'あり' : 'なし'} ／ 総拍数：{model.totalBeats}</p>
        <p>テンポ情報：{model.tempoBpm === undefined ? 'なし' : model.tempoBpm + ' BPM'}（今回の手本は従来の100 BPM）</p>
        <p>現在の練習対応：{model.practiceCompatibility === 'simpleMelody' ? '単旋律対応' : model.practiceCompatibility === 'polyphonicPending' ? 'Phase 2E-C2対応予定' : '未対応'}</p>
        {model.warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
      </section>}
      <p>開発確認用の手動カーソルです。練習・手本の開始前に操作でき、練習開始で先頭へ戻ります。</p>
      <p className="expected-note">練習の現在音：{expectedMidiNote === null ? '—' : `${midiNoteName(expectedMidiNote)} / MIDI Note ${expectedMidiNote}`}</p>
      <div className="cursor-buttons">
        <button onClick={onPrevious} disabled={disabled || currentNoteIndex === 0}><span aria-hidden="true">← </span>前の音</button>
        <button onClick={onNext} disabled={disabled || currentNoteIndex >= totalNotes - 1}>次の音<span aria-hidden="true"> →</span></button>
      </div>
    </details>
  )
}
