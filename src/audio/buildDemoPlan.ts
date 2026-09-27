import type { PracticePlan } from '../practice/PracticePlan'
import { Beat } from '../score/Beat'
import { soundSpans } from '../score/soundSpans'
import type { DemoNote } from './DemoPlayer'

/** Timed performance includes rests/gaps and tied duration; targets provide view positions. */
export function buildDemoPlan(plan: PracticePlan, tempoBpm = 100): DemoNote[] {
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0 || !plan.targets.length) throw new Error('Empty demo plan')
  const milliseconds = 60_000 / tempoBpm
  return soundSpans(plan.sourceNotes).map((span) => {
    const index = plan.targets.findIndex((target) => Beat.from(target.onset).compare(span.onset) === 0)
    if (index < 0) throw new Error('No practice target for demo attack')
    return { index, midiNote: span.midiNote, startMs: span.onset.beats * milliseconds,
      durationMs: span.end.subtract(span.onset).beats * milliseconds,
      noteOffMs: (span.end.beats - span.lastDuration.beats * 0.1) * milliseconds }
  })
}
