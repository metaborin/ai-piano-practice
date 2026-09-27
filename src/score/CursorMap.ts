import type { Cursor } from 'opensheetmusicdisplay'
import { Beat } from './Beat'
import type { ScoreModel } from './ScoreModel'

/** Match normalized moments to OSMD positions, including tie-only demo start positions. */
export function buildCursorMap(model: ScoreModel, cursor: Cursor, octaveXmlDifference: number): ReadonlyMap<string, number> {
  const byTime = new Map<string, { index: number; pitches: Set<number> }>()
  cursor.reset()
  try {
    let index = 0
    while (!cursor.Iterator.EndReached) {
      if (index > model.notes.length + model.rests.length + model.measures.length) throw new Error('Cursor traversal did not finish')
      const measure = model.measures[cursor.Iterator.CurrentMeasureIndex]
      const relative = cursor.Iterator.CurrentRelativeInMeasureTimestamp
      if (measure && relative) {
        const n = relative.GetExpandedNumerator(), d = relative.Denominator
        if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) throw new Error('Unsafe cursor fraction')
        const beat = Beat.from(measure.onset).add(new Beat(BigInt(n) * 4n, BigInt(d)))
        const pitches = new Set(cursor.NotesUnderCursor().filter((note) => !note.isRest() && note.Pitch).map((note) => {
          const pitch = note.Pitch!
          return 12 * (pitch.Octave + octaveXmlDifference + 1) + pitch.FundamentalNote + pitch.AccidentalHalfTones
        }))
        if (!byTime.has(beat.key)) byTime.set(beat.key, { index, pitches })
      }
      index++; cursor.next()
    }
    const mapping = new Map<string, number>()
    for (const moment of model.moments) {
      const attacks = moment.notes.filter((note) => !note.tieStop)
      const displayed = attacks.length ? attacks : moment.notes
      if (!displayed.length) continue
      const position = byTime.get(Beat.from(moment.onset).key)
      if (!position || displayed.some((note) => !position.pitches.has(note.midiNote))) throw new Error(`ScoreMoment ${moment.id} does not match the OSMD cursor`)
      mapping.set(moment.id, position.index)
    }
    return mapping
  } finally { cursor.reset() }
}
