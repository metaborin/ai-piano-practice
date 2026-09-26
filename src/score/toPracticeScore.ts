import { Beat } from './Beat'
import type { PracticeScore, ScoreModel, ScoreMoment } from './ScoreModel'

/** Future physical-key matching can deduplicate pitches without destroying source notes. */
export function expectedMidiSet(moment: ScoreMoment): ReadonlySet<number> {
  return new Set(moment.notes.map((note) => note.midiNote))
}

/** Safe bridge only. Complex timelines must never be flattened into the old player/session. */
export function toPracticeScore(model: ScoreModel): PracticeScore | null {
  if (model.practiceCompatibility !== 'simpleMelody' || !model.moments.length || model.rests.length || model.staffCount !== 1 || model.voices.length !== 1) return null
  let end = Beat.zero()
  const notes = []
  for (const moment of model.moments) {
    if (moment.notes.length !== 1 || Beat.from(moment.onset).compare(end) !== 0) return null
    const note = moment.notes[0]
    if (note.ties.length || note.chord) return null
    notes.push({ midiNote: note.midiNote, durationBeats: note.durationBeats })
    end = Beat.from(note.onset).add(Beat.from(note.duration))
  }
  if (end.compare(Beat.from(model.totalDuration)) !== 0) return null
  return { id: model.id, title: model.title, partLabel: model.partLabel, musicXml: model.musicXml, notes }
}
