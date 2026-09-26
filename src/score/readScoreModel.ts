import type { Cursor } from 'opensheetmusicdisplay'
import type { ScoreModel, ScoreNote, ScoreSource } from './ScoreModel'

/** Read the same cursor sequence the view uses; never maintain a second melody list. */
export function readScoreModel(source: ScoreSource, cursor: Cursor, octaveXmlDifference: number): ScoreModel {
  const notes: ScoreNote[] = []
  cursor.reset()
  try {
    while (!cursor.Iterator.EndReached) {
      const current = cursor.NotesUnderCursor()
      // Phase 2B supports this single-voice, pitched melody only.
      if (current.length !== 1 || current[0].isRest() || current[0].IsGraceNote || !current[0].Pitch) {
        throw new Error('Phase 2B requires one pitched note per cursor position')
      }
      const pitch = current[0].Pitch
      const midiNote = 12 * (pitch.Octave + octaveXmlDifference + 1) + pitch.FundamentalNote + pitch.AccidentalHalfTones
      if (!Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127) throw new Error('Invalid MIDI pitch in score')
      // OSMD Length is a fraction of a whole note; our beat unit is a quarter note.
      const durationBeats = current[0].Length.RealValue * 4
      if (!Number.isFinite(durationBeats) || durationBeats <= 0) throw new Error('Invalid note duration in score')
      notes.push({ midiNote, durationBeats })
      cursor.next()
    }
    if (notes.length === 0) throw new Error('The score has no notes')
    return { ...source, notes }
  } finally {
    cursor.reset()
  }
}
