import type { PracticeSnapshot } from '../practice/PracticeSession'
import { midiNoteName } from '../midi/parseMidiMessage'
import type { ScoreModel } from '../score/ScoreModel'
import { MODE_LABELS } from '../practice/PracticePlan'
import type { PracticePlan } from '../practice/PracticePlan'
import { CHORD_WINDOW_MS } from '../practice/MomentMatcher'
import type { Song } from '../songs/Song'
import { ValidationReport } from './ValidationReport'
import type { DemoPlayer, DemoSnapshot } from '../audio/DemoPlayer'
import type { MidiOutputManager } from '../midi/MidiOutputManager'
import { DemoMidiTracePanel } from './DemoMidiTracePanel'
import type { DemoMidiTrace } from '../midi/DemoMidiTrace'

type Props = { practice: PracticeSnapshot; model?: ScoreModel | null; plan?: PracticePlan | null; song?: Song | null; error?: string | null; cursorIndex?: number; blocked?: boolean; onPrevious: () => void; onNext: () => void;
  demo?: DemoSnapshot; demoDiagnostics?: ReturnType<DemoPlayer['getDiagnostics']>; outputDiagnostics?: ReturnType<MidiOutputManager['getDiagnostics']>; midiTrace?: DemoMidiTrace }
export function DeveloperControls({ practice, model, plan, song, error, cursorIndex, blocked = false, onPrevious, onNext, demo, demoDiagnostics: diagnostic, outputDiagnostics: output, midiTrace }: Props) {
  const { currentNoteIndex, totalNotes, expectedMidiNote, status } = practice
  const disabled = blocked || totalNotes === 0 || status !== 'idle'
  return (
    <details className="developer-controls">
      <summary>開発者用</summary>
      {demo && diagnostic && output && <section className="demo-diagnostics" aria-label="手本再生の診断">
        <h3>手本再生の診断</h3>
        <p>Demo status：{demo.status} ／ Session：{diagnostic.playbackSession} ／ Generation：{diagnostic.generation}<br />
          Sequence index：{diagnostic.sequenceIndex} ／ Start：{diagnostic.startSequenceIndex} ／ Length：{diagnostic.sequenceLength}<br />
          Measure：{diagnostic.measure ?? '—'} ／ Repeat pass：{diagnostic.repeatPass ?? '—'}<br />
          Scheduled timers：{diagnostic.scheduledTimers + output.scheduledTimers} ／ Active output notes：[{output.activeNotes.join(', ')}]<br />
          Expired attacks：{diagnostic.skippedNotes} ／ Display errors：{diagnostic.visualErrors}</p>
      </section>}
      {midiTrace && <DemoMidiTracePanel trace={midiTrace} />}
      {(model || error) && <section className="score-analysis" aria-label="Score解析">
        <h3>Score解析</h3>
        {song && <p>曲：{song.title} ／ パート：{song.partLabel}<br />作曲者・由来：{song.composer || '未指定'} ／ source：{song.source}</p>}
        <ValidationReport model={model ?? null} tempoBpm={song?.tempoBpm} compatibility={model ? undefined : song?.compatibility} error={error} />
        {plan && <p>練習モード：{model?.staffCount === 1 ? '全体' : MODE_LABELS[plan.mode]} ／ 練習Step：{plan.sequence.occurrences.length} ／ 現在：{plan.sequence.occurrences.length ? (cursorIndex ?? currentNoteIndex) + 1 : 0}<br />期待音：[{plan.sequence.occurrences[cursorIndex ?? currentNoteIndex]?.sourceTarget.expectedMidiNotes.join(', ')}] ／ Chord window：{CHORD_WINDOW_MS}ms</p>}
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
