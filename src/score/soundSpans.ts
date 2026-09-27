import { Beat } from './Beat'
import type { ScoreNote } from './ScoreModel'

export type SoundSpan = { midiNote: number; onset: Beat; end: Beat; lastDuration: Beat; sourceNotes: ScoreNote[] }

/** Written notes -> physical-key spans. No XML, MIDI port, timers or UI. */
export function soundSpans(notes: readonly ScoreNote[]): SoundSpan[] {
  const spans: SoundSpan[] = []
  const ties = new Map<string, SoundSpan>()
  for (const note of notes) {
    const onset = Beat.from(note.onset), duration = Beat.from(note.duration)
    const key = `${note.staff}:${note.voice}:${note.midiNote}`
    if (note.ties.some((tie) => !['start', 'stop', 'continue'].includes(tie.type))) throw new Error('特殊なタイ表記')
    if (note.tieStop) {
      const previous = ties.get(key)
      if (!previous || previous.end.compare(onset) !== 0) throw new Error('対応する開始音のないタイ・Staff/Voiceをまたぐタイ')
      previous.end = onset.add(duration); previous.lastDuration = duration; previous.sourceNotes.push(note)
      if (!note.tieStart) ties.delete(key)
    } else {
      if (ties.has(key)) throw new Error('接続が不明なタイ')
      const span = { midiNote: note.midiNote, onset, end: onset.add(duration), lastDuration: duration, sourceNotes: [note] }
      spans.push(span)
      if (note.tieStart) ties.set(key, span)
    }
  }
  if (ties.size) throw new Error('終端のないタイ')
  const unique = new Map<string, SoundSpan>()
  for (const span of spans) {
    const key = span.onset.key + ':' + span.midiNote, previous = unique.get(key)
    if (!previous) unique.set(key, span)
    else {
      previous.sourceNotes.push(...span.sourceNotes)
      if (span.end.compare(previous.end) > 0) { previous.end = span.end; previous.lastDuration = span.lastDuration }
    }
  }
  const result = [...unique.values()].sort((a, b) => a.onset.compare(b.onset))
  const last = new Map<number, SoundSpan>()
  for (const span of result) {
    const previous = last.get(span.midiNote)
    if (previous && span.onset.compare(previous.end) < 0) throw new Error('異なる開始拍で重なる同一音高（同じ鍵盤）の声部')
    last.set(span.midiNote, span)
  }
  return result
}
