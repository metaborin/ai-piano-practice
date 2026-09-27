import type { PracticePlan } from '../practice/PracticePlan'
import { Beat } from '../score/Beat'
import { soundSpans } from '../score/soundSpans'
import type { DemoNote } from './DemoPlayer'
import { DEMO_GATE_RATIO, millisecondsAtBeat, resolveTempo } from './tempo'

/** Timed performance includes rests/gaps and tied duration; targets provide view positions. */
export function buildDemoPlan(plan: PracticePlan): DemoNote[] {
  if (!plan.targets.length) throw new Error('Empty demo plan')
  const tempo = resolveTempo(plan.score, plan.songTempoBpm)
  const timeAt = (beat: number) => millisecondsAtBeat(tempo, beat)
  return soundSpans(plan.sourceNotes).map((span) => {
    const index = plan.targets.findIndex((target) => Beat.from(target.onset).compare(span.onset) === 0)
    if (index < 0) throw new Error('No practice target for demo attack')
    const startMs = timeAt(span.onset.beats)
    return { index, midiNote: span.midiNote, startMs,
      durationMs: timeAt(span.end.beats) - startMs,
      noteOffMs: timeAt(span.end.beats - span.lastDuration.beats * (1 - DEMO_GATE_RATIO)) }
  })
}
