import type { PracticePlan } from '../practice/PracticePlan'
import type { DemoNote } from './DemoPlayer'
import { navigationJump } from '../score/ScoreLookAhead'
import type { ScoreSystems } from '../score/ScoreLookAhead'

export const LOOKAHEAD_MS = 750
export type DemoPreview = { readonly id: string; readonly momentId: string; readonly occurrenceIndex: number; readonly navigationJump: boolean }
export type DemoPreviewEvent = DemoPreview & { readonly atMs: number; readonly dueMs: number }

/** Visual events only. No change to the existing MIDI note or release timestamps. */
export function buildDemoPreviews(notes: readonly DemoNote[], plan: PracticePlan, systems: ScoreSystems): DemoPreviewEvent[] {
  const attacks = notes.filter((note, index) => index === 0 || note.startMs !== notes[index - 1].startMs)
  const events: DemoPreviewEvent[] = []
  let systemStartMs = attacks[0]?.startMs ?? 0
  for (let index = 1; index < attacks.length; index++) {
    const previous = attacks[index - 1], next = attacks[index]
    const momentId = next.cursorMomentId ?? plan.sequence.occurrences[next.index].sourceMoment.id
    const fromId = previous.cursorMomentId ?? plan.sequence.occurrences[previous.index].sourceMoment.id
    const from = systems.get(fromId), to = systems.get(momentId)
    const jump = navigationJump(plan, previous.index, next.index)
    if (!from || !to || (!jump && from.system === to.system)) continue
    // Adjacent systems can be prepared while several short notes remain.
    // A repeat must wait until the last attack, since its current system leaves view.
    const atMs = Math.max((jump ? previous.startMs : systemStartMs) + 1, next.startMs - LOOKAHEAD_MS)
    systemStartMs = next.startMs
    if (atMs >= next.startMs) continue
    events.push({ id: `${next.index}:${next.startMs}`, momentId, occurrenceIndex: next.index, navigationJump: jump, atMs, dueMs: next.startMs })
  }
  return events
}
