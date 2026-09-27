import type { Cursor } from 'opensheetmusicdisplay'
import { Beat } from './Beat'
import type { ScoreModel } from './ScoreModel'

/** Match normalized attacks to OSMD API positions, never to SVG notehead/DOM ordering. */
export function buildCursorMap(model: ScoreModel, cursor: Cursor, octaveXmlDifference: number): ReadonlyMap<string, number> {
  const byTime = new Map<string, { index: number; pitches: Set<number> }>()
  cursor.reset()
  try {
    let index = 0
    while (!cursor.Iterator.EndReached) {
      if (index > 5000) throw new Error('Cursor traversal limit')
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
      if (!attacks.length) continue
      const position = byTime.get(Beat.from(moment.onset).key)
      if (!position || attacks.some((note) => !position.pitches.has(note.midiNote))) throw new Error(`ScoreMoment ${moment.id} does not match the OSMD cursor`)
      mapping.set(moment.id, position.index)
    }
    return mapping
  } finally { cursor.reset() }
}
