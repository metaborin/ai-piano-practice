import { Beat } from './Beat'
import type { ScoreModel } from './ScoreModel'
import type { PracticePlan } from '../practice/PracticePlan'

/** The occurrence index, not the printed label, identifies a written measure. */
export function scoreMeasure(score: ScoreModel, index: number) {
  return Number.isInteger(index) && index >= 0 ? score.measures[index] : undefined
}
export function firstTargetInOrAfterMeasure(plan: PracticePlan, measureIndex: number) {
  const measure = scoreMeasure(plan.score, measureIndex)
  return measure ? plan.targets.findIndex(target => Beat.from(target.onset).compare(Beat.from(measure.onset)) >= 0) : -1
}
