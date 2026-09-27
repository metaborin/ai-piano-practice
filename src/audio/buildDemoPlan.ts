import type { PracticePlan } from '../practice/PracticePlan'
import { Beat } from '../score/Beat'
import { soundSpans } from '../score/soundSpans'
import type { DemoNote } from './DemoPlayer'
import { DEMO_GATE_RATIO, millisecondsAtBeat, resolveTempo } from './tempo'
import { resolveDemoStart } from './DemoStart'
import type { DemoStart } from './DemoStart'

/** Timed performance includes rests/gaps and tied duration; targets provide view positions. */
export function buildDemoPlan(plan: PracticePlan, start: DemoStart = { kind: 'beginning' }): DemoNote[] {
  if (!plan.targets.length) throw new Error('Empty demo plan')
  const tempo = resolveTempo(plan.score, plan.songTempoBpm)
  const timeAt = (beat: number) => millisecondsAtBeat(tempo, beat)
  const origin = resolveDemoStart(plan, start), offset = timeAt(origin.onsetBeats)
  const targetByOnset = new Map(plan.targets.map((target, index) => [Beat.from(target.onset).key, index]))
  const notes = soundSpans(plan.sourceNotes).map((span) => {
    const index = targetByOnset.get(span.onset.key)
    if (index === undefined) throw new Error('No practice target for demo attack')
    const startMs = timeAt(span.onset.beats)
    return { index, midiNote: span.midiNote, startMs,
      durationMs: timeAt(span.end.beats) - startMs,
      noteOffMs: timeAt(span.end.beats - span.lastDuration.beats * (1 - DEMO_GATE_RATIO)) }
  })
  // A partial demo reconstructs still-sounding notes (including a tie entering the start).
  // Nothing before the selected origin is queued, and original target indices are retained.
  return notes.filter((note) => note.noteOffMs > offset).map((note) => ({ ...note,
    ...(note.startMs < offset && origin.cursorMomentId ? { cursorMomentId: origin.cursorMomentId } : {}),
    index: note.startMs < offset ? origin.index : note.index,
    startMs: Math.max(0, note.startMs - offset),
    durationMs: note.startMs + note.durationMs - Math.max(offset, note.startMs),
    noteOffMs: note.noteOffMs - offset }))
}
