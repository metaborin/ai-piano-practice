import type { BeatFraction, ScoreModel, ScoreNote } from '../score/ScoreModel'
import { createPracticeSequence } from './PracticeSequence'
import type { PracticeSequence } from './PracticeSequence'
export type PracticeMode = 'right' | 'left' | 'both'
export const MODE_LABELS: Record<PracticeMode, string> = { right: '右手', left: '左手', both: '両手' }
export type PracticeTarget = {
  readonly id: string; readonly scoreMomentId: string
  readonly onset: BeatFraction; readonly onsetBeats: number; readonly measureNumber: string
  readonly expectedMidiNotes: readonly number[]; readonly sourceNotes: readonly ScoreNote[]
}
export type PracticePlan = {
  readonly score: ScoreModel; readonly mode: PracticeMode
  readonly targets: readonly PracticeTarget[]; readonly sourceNotes: readonly ScoreNote[]
  readonly sequence: PracticeSequence
  /** Playback fallback only. XML tempo remains authoritative. */
  readonly songTempoBpm?: number
}
export function createPracticePlan(score: ScoreModel, mode: PracticeMode = 'both', songTempoBpm?: number): PracticePlan | null {
  if (!['simpleMelody', 'pitchPractice'].includes(score.practiceCompatibility)) return null
  const selected = (note: ScoreNote) => mode === 'both' || note.staff === (mode === 'right' ? 1 : 2)
  const targets = score.moments.flatMap((moment) => {
    const sourceNotes = moment.notes.filter(selected)
    const expectedMidiNotes = [...new Set(sourceNotes.filter((note) => !note.tieStop).map((note) => note.midiNote))].sort((a, b) => a - b)
    return expectedMidiNotes.length ? [{ id: mode + ':' + moment.id, scoreMomentId: moment.id, onset: moment.onset, onsetBeats: moment.onsetBeats, measureNumber: moment.measureNumber, expectedMidiNotes, sourceNotes }] : []
  })
  return { score, mode, targets, sequence: createPracticeSequence(score, targets), sourceNotes: score.notes.filter(selected), songTempoBpm }
}
