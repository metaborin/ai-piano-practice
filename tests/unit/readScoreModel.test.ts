import { expect, it } from 'vitest'
import type { Cursor } from 'opensheetmusicdisplay'
import { readScoreModel } from '../../src/score/readScoreModel'

function cursorFor(lengths: number[]) {
  let index = 0
  return {
    reset: () => { index = 0 }, next: () => { index++ },
    get Iterator() { return { EndReached: index >= lengths.length } },
    NotesUnderCursor: () => [{ isRest: () => false, IsGraceNote: false, Pitch: { Octave: 1, FundamentalNote: 0, AccidentalHalfTones: 0 }, Length: { RealValue: lengths[index] } }],
    get index() { return index },
  }
}
const source = { id: 'test', title: '', partLabel: '', musicXml: '' }
it('reads duration from OSMD whole-note fractions in the same order as the cursor pitches', () => {
  const cursor = cursorFor([0.25, 0.5, 0.375])
  expect(readScoreModel(source, cursor as unknown as Cursor, 3).notes).toEqual([
    { midiNote: 60, durationBeats: 1 }, { midiNote: 60, durationBeats: 2 }, { midiNote: 60, durationBeats: 1.5 },
  ])
  expect(cursor.index).toBe(0)
})
it('rejects invalid durations and restores the cursor even after a parsing failure', () => {
  const cursor = cursorFor([0.25, 0])
  expect(() => readScoreModel(source, cursor as unknown as Cursor, 3)).toThrow('duration')
  expect(cursor.index).toBe(0)
})
