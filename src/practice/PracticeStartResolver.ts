import type { ScoreMeasure } from '../score/ScoreModel'
import { Beat } from '../score/Beat'
import { firstTargetInOrAfterMeasure, scoreMeasure } from '../score/ScorePosition'
import { MODE_LABELS } from './PracticePlan'
import type { PracticePlan } from './PracticePlan'
import type { RepeatPosition } from '../score/ScoreNavigation'

export type PracticeStart = { readonly kind: 'beginning' } | { readonly kind: 'measure'; readonly measureIndex: number }
export type PracticeStartPosition = {
  readonly requested: PracticeStart
  readonly requestedMeasure: ScoreMeasure | null
  readonly resolvedTargetIndex: number | null
  readonly resolvedOccurrenceIndex: number | null
  readonly resolvedMeasure: ScoreMeasure | null
  readonly adjusted: boolean
  readonly reason: 'exact' | 'later-in-measure' | 'next-measure' | 'unavailable'
  readonly message: string
}

/** Practice uses new attacks already filtered by the plan; it never synthesizes a tie attack. */
export function resolvePracticeStart(plan: PracticePlan, requested: PracticeStart = { kind: 'beginning' }, preferredPass?: RepeatPosition): PracticeStartPosition {
  const measure = requested.kind === 'beginning' ? plan.score.measures[0] : scoreMeasure(plan.score, requested.measureIndex)
  const index = requested.kind === 'beginning' ? (plan.targets.length ? 0 : -1) : firstTargetInOrAfterMeasure(plan, requested.measureIndex)
  const target = plan.targets[index]
  if (!measure || !target) return { requested, requestedMeasure: measure ?? null, resolvedTargetIndex: null, resolvedOccurrenceIndex: null, resolvedMeasure: null,
    adjusted: false, reason: 'unavailable', message: '指定した小節以降に、このパートの新しい音がありません。別の開始位置かパートを選んでください。' }
  const resolved = plan.score.measures[target.sourceNotes[0].measureIndex]
  const laterMeasure = resolved.index !== measure.index
  const adjusted = Beat.from(target.onset).compare(Beat.from(measure.onset)) !== 0
  const occurrences = plan.sequence.occurrences
  const preferred = preferredPass?.repeatRegionId ? occurrences.findIndex(occurrence => occurrence.sourceTargetIndex === index && occurrence.repeatRegionId === preferredPass.repeatRegionId && occurrence.repeatPass === preferredPass.repeatPass) : -1
  const resolvedOccurrenceIndex = preferred >= 0 ? preferred : occurrences.findIndex(occurrence => occurrence.sourceTargetIndex === index)
  return { requested, requestedMeasure: measure, resolvedTargetIndex: index, resolvedOccurrenceIndex, resolvedMeasure: resolved, adjusted,
    reason: laterMeasure ? 'next-measure' : adjusted ? 'later-in-measure' : 'exact',
    message: requested.kind === 'measure' && laterMeasure
      ? `${measure.number}小節目には${MODE_LABELS[plan.mode]}の新しい音がないため、${resolved.number}小節目から開始します。` : '' }
}
