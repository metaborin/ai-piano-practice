export type NoteMatch = 'correct' | 'incorrect'

/** Pitch only. Names, velocity, timing and note duration are not grading criteria. */
export function matchNote(expectedMidiNote: number, playedMidiNote: number): NoteMatch {
  return expectedMidiNote === playedMidiNote ? 'correct' : 'incorrect'
}
