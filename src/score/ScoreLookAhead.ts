import type { PracticePlan } from '../practice/PracticePlan'

/** OSMD identities, independent of pixels, React and MIDI timing. */
export type MomentSystem = { readonly system: number; readonly measureIndex: number }
export type ScoreSystems = ReadonlyMap<string, MomentSystem>
export type LookAheadTarget = {
  readonly fromIndex: number; readonly toIndex: number
  readonly momentId: string; readonly system: number; readonly navigationJump: boolean
}
export function navigationJump(plan: PracticePlan, from: number, to: number): boolean {
  const a = plan.sequence.occurrences[from], b = plan.sequence.occurrences[to]
  return !!a && !!b && to > from && b.sourceTargetIndex <= a.sourceTargetIndex
}

/** Prepare in the last playable measure of a system, not a fixed number of notes. */
export function practiceLookAhead(plan: PracticePlan, index: number, systems: ScoreSystems): LookAheadTarget | null {
  const occurrences = plan.sequence.occurrences, current = occurrences[index]
  const position = current && systems.get(current.sourceMoment.id)
  if (!position) return null
  for (let next = index + 1; next < occurrences.length; next++) {
    const previous = occurrences[next - 1], destination = occurrences[next], target = systems.get(destination.sourceMoment.id)
    if (navigationJump(plan, next - 1, next)) return null // Practice keeps the current bar until the correct strike.
    if (target && target.system !== position.system) return previous.sourceMoment.measureIndex === position.measureIndex
      ? { fromIndex: next - 1, toIndex: next, momentId: destination.sourceMoment.id, system: target.system, navigationJump: false } : null
  }
  return null
}
