import type { PracticeTarget } from './PracticePlan'
import { buildPlaybackSequence } from '../score/ScoreNavigation'
import type { PlaybackSequence, SequenceOccurrence } from '../score/ScoreNavigation'
import type { ScoreModel } from '../score/ScoreModel'

export type PracticeOccurrence = SequenceOccurrence & {
  readonly sourceTarget: PracticeTarget; readonly sourceTargetIndex: number
}
export type PracticeSequence = {
  readonly playback: PlaybackSequence; readonly occurrences: readonly PracticeOccurrence[]
}
export function createPracticeSequence(score: ScoreModel, targets: readonly PracticeTarget[]): PracticeSequence {
  const playback = buildPlaybackSequence(score)
  const byMoment = new Map(targets.map((sourceTarget, sourceTargetIndex) => [sourceTarget.scoreMomentId, { sourceTarget, sourceTargetIndex }]))
  const occurrences: PracticeOccurrence[] = []
  for (const occurrence of playback.moments) {
    const target = byMoment.get(occurrence.sourceMoment.id)
    if (target) occurrences.push({ ...occurrence, ...target, sequenceIndex: occurrences.length })
  }
  return { playback, occurrences }
}
