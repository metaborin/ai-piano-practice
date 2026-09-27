import type { PracticePlan } from '../practice/PracticePlan'
import { firstTargetInOrAfterMeasure, scoreMeasure } from '../score/ScorePosition'
import { Beat } from '../score/Beat'
export type DemoStart = { readonly kind: 'beginning' } | { readonly kind: 'moment'; readonly momentId: string } | { readonly kind: 'measure'; readonly measureIndex: number } | { readonly kind: 'occurrence'; readonly occurrenceId: string }

/** Physical measure selection chooses its first occurrence; occurrence ID retains the pass. */
export function resolveDemoStart(plan: PracticePlan, start: DemoStart): { index: number; onsetBeats: number; measureOccurrenceIndex: number; cursorMomentId?: string } {
  const occurrences = plan.sequence.occurrences
  const fromTarget = (targetIndex: number) => occurrences.findIndex(occurrence => occurrence.sourceTargetIndex === targetIndex)
  if (start.kind === 'beginning') return { index: 0, onsetBeats: 0, measureOccurrenceIndex: 0 }
  if (start.kind === 'occurrence') {
    const index = occurrences.findIndex(occurrence => occurrence.id === start.occurrenceId)
    if (index < 0) throw new Error('指定した位置が見つかりません。別の開始位置を選んでください。')
    const occurrence = occurrences[index]
    return { index, onsetBeats: occurrence.sourceTarget.onsetBeats, measureOccurrenceIndex: occurrence.measureOccurrenceIndex }
  }
  const measure = start.kind === 'measure' ? scoreMeasure(plan.score, start.measureIndex) : undefined
  // A demo reconstructs sounding notes at a tie-only bar; practice instead seeks new attacks.
  if (measure && plan.sourceNotes.some(note => note.tieStop && Beat.from(note.onset).compare(Beat.from(measure.onset)) === 0)) {
    const moment = plan.score.moments.find(moment => Beat.from(moment.onset).compare(Beat.from(measure.onset)) === 0)
    if (moment) {
      const measureOccurrenceIndex = plan.sequence.playback.measures.findIndex(occurrence => occurrence.source.index === measure.index)
      const index = occurrences.findLastIndex(occurrence => occurrence.measureOccurrenceIndex < measureOccurrenceIndex
        || (occurrence.measureOccurrenceIndex === measureOccurrenceIndex && Beat.from(occurrence.sourceTarget.onset).compare(Beat.from(measure.onset)) <= 0))
      if (index >= 0) return { index, onsetBeats: measure.onsetBeats, cursorMomentId: moment.id, measureOccurrenceIndex }
    }
  }
  const index = start.kind === 'moment' ? plan.targets.findIndex((target) => target.scoreMomentId === start.momentId)
    : measure ? firstTargetInOrAfterMeasure(plan, measure.index) : -1
  if (index < 0) throw new Error('指定した位置以降に、このパートの音がありません。別の開始位置を選んでください。')
  const occurrenceIndex = fromTarget(index)
  return { index: occurrenceIndex, onsetBeats: plan.targets[index].onsetBeats, measureOccurrenceIndex: occurrences[occurrenceIndex].measureOccurrenceIndex }
}
