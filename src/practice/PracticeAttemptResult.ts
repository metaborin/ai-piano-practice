import type { PracticeMode } from './PracticePlan'

export type PracticeFlowMode = 'until-correct' | 'run-through'
export const FLOW_LABELS: Record<PracticeFlowMode, string> = { 'until-correct': 'できるまで', 'run-through': '通し練習' }

/** Session data, independent of rendering. Times use performance.now() (milliseconds). */
export type PracticeAttemptResult = {
  readonly sequenceOccurrenceId: string
  readonly sourceMomentId: string
  readonly measureNumber: string
  readonly practiceMode: PracticeMode
  readonly flowMode: PracticeFlowMode
  readonly expectedMidiNotes: readonly number[]
  readonly playedMidiNotes: readonly number[]
  readonly matchedMidiNotes: readonly number[]
  readonly missingMidiNotes: readonly number[]
  readonly unexpectedMidiNotes: readonly number[]
  readonly result: 'correct' | 'incorrect'
  readonly startedAt: number
  readonly completedAt: number
}
