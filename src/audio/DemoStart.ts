import type { PracticePlan } from '../practice/PracticePlan'
export type DemoStart = { readonly kind: 'beginning' } | { readonly kind: 'moment'; readonly momentId: string } | { readonly kind: 'measure'; readonly measureIndex: number }

/** Measure indices identify occurrences even when XML measure labels repeat. */
export function resolveDemoStart(plan: PracticePlan, start: DemoStart) {
  if (start.kind === 'beginning') return { index: 0, onsetBeats: 0 }
  const measure = start.kind === 'measure' ? plan.score.measures[start.measureIndex] : undefined
  const index = start.kind === 'moment' ? plan.targets.findIndex((target) => target.scoreMomentId === start.momentId)
    : measure ? plan.targets.findIndex((target) => target.onsetBeats >= measure.onsetBeats) : -1
  if (index < 0) throw new Error('指定した位置以降に、このパートの音がありません。別の開始位置を選んでください。')
  return { index, onsetBeats: plan.targets[index].onsetBeats }
}
