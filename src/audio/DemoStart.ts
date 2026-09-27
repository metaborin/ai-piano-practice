import type { PracticePlan } from '../practice/PracticePlan'
import { firstTargetInOrAfterMeasure, scoreMeasure } from '../score/ScorePosition'
import { Beat } from '../score/Beat'
export type DemoStart = { readonly kind: 'beginning' } | { readonly kind: 'moment'; readonly momentId: string } | { readonly kind: 'measure'; readonly measureIndex: number }

/** Measure indices identify occurrences even when XML measure labels repeat. */
export function resolveDemoStart(plan: PracticePlan, start: DemoStart): { index: number; onsetBeats: number; cursorMomentId?: string } {
  if (start.kind === 'beginning') return { index: 0, onsetBeats: 0 }
  const measure = start.kind === 'measure' ? scoreMeasure(plan.score, start.measureIndex) : undefined
  // A demo reconstructs sounding notes at a tie-only bar; practice instead seeks new attacks.
  if (measure && plan.sourceNotes.some(note => note.tieStop && Beat.from(note.onset).compare(Beat.from(measure.onset)) === 0)) {
    const moment = plan.score.moments.find(moment => Beat.from(moment.onset).compare(Beat.from(measure.onset)) === 0)
    if (moment) {
      const index = plan.targets.findLastIndex(target => Beat.from(target.onset).compare(Beat.from(measure.onset)) <= 0)
      if (index >= 0) return { index, onsetBeats: measure.onsetBeats, cursorMomentId: moment.id }
    }
  }
  const index = start.kind === 'moment' ? plan.targets.findIndex((target) => target.scoreMomentId === start.momentId)
    : measure ? firstTargetInOrAfterMeasure(plan, measure.index) : -1
  if (index < 0) throw new Error('指定した位置以降に、このパートの音がありません。別の開始位置を選んでください。')
  return { index, onsetBeats: plan.targets[index].onsetBeats }
}
