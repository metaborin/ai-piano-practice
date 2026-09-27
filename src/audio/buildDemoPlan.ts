import type { PracticePlan } from '../practice/PracticePlan'
import { Beat } from '../score/Beat'
import { soundSpans } from '../score/soundSpans'
import type { DemoNote } from './DemoPlayer'
import { DEMO_GATE_RATIO, millisecondsAtBeat, resolveTempo } from './tempo'
import { resolveDemoStart } from './DemoStart'
import type { DemoStart } from './DemoStart'

/** Shared navigation on one MIDI timeline. Written notes are never copied or rewritten. */
export function buildDemoPlan(plan: PracticePlan, start: DemoStart = { kind: 'beginning' }): DemoNote[] {
  if (!plan.sequence.occurrences.length) throw new Error('Empty demo plan')
  const tempo = resolveTempo(plan.score, plan.songTempoBpm)
  const timeAt = (beat: number) => millisecondsAtBeat(tempo, beat)
  const origin = resolveDemoStart(plan, start)
  const measures = plan.sequence.playback.measures
  const measureTimes: number[] = []
  let elapsed = 0
  for (const { source } of measures) {
    measureTimes.push(elapsed)
    elapsed += timeAt(source.onsetBeats + source.durationBeats) - timeAt(source.onsetBeats)
  }
  let offset = 0
  const spans = soundSpans(plan.sourceNotes)
  const sourceTargetByOnset = new Map(plan.targets.map((target, index) => [Beat.from(target.onset).key, index]))
  const spansByTarget = new Map<number, typeof spans>()
  for (const span of spans) {
    const index = sourceTargetByOnset.get(span.onset.key)
    if (index === undefined) throw new Error('No practice target for demo attack')
    const group = spansByTarget.get(index) ?? []
    group.push(span); spansByTarget.set(index, group)
  }
  const notes: DemoNote[] = []
  let nextOccurrence = 0
  for (let first = 0; first < measures.length;) {
    let last = first
    while (last + 1 < measures.length && measures[last + 1].source.index === measures[last].source.index + 1) last++
    const from = measures[first].source.onsetBeats
    const finalMeasure = measures[last].source
    const to = finalMeasure.onsetBeats + finalMeasure.durationBeats
    const segmentStartMs = measureTimes[first], segmentEndMs = segmentStartMs + timeAt(to) - timeAt(from)
    if (origin.measureOccurrenceIndex >= first && origin.measureOccurrenceIndex <= last) offset = segmentStartMs + timeAt(origin.onsetBeats) - timeAt(from)
    // Visit each occurrence once, even with many one-measure repeats. Only attacks
    // in this segment are used, so no prior-pass tie can leak into its beginning.
    while (nextOccurrence < plan.sequence.occurrences.length && plan.sequence.occurrences[nextOccurrence].measureOccurrenceIndex <= last) {
      const occurrence = plan.sequence.occurrences[nextOccurrence++]
      for (const span of spansByTarget.get(occurrence.sourceTargetIndex) ?? []) {
        const startMs = segmentStartMs + timeAt(span.onset.beats) - timeAt(from)
        const endMs = Math.min(segmentEndMs, segmentStartMs + timeAt(span.end.beats) - timeAt(from))
        const noteOffMs = Math.min(segmentEndMs, segmentStartMs + timeAt(span.end.beats - span.lastDuration.beats * (1 - DEMO_GATE_RATIO)) - timeAt(from))
        notes.push({ index: occurrence.sequenceIndex, midiNote: span.midiNote, startMs, durationMs: endMs - startMs, noteOffMs })
      }
    }
    first = last + 1
  }
  // Partial starts reconstruct ties still sounding inside the selected segment.
  return notes.filter((note) => note.noteOffMs > offset).map((note) => ({ ...note,
    ...(note.startMs < offset && origin.cursorMomentId ? { cursorMomentId: origin.cursorMomentId } : {}),
    index: note.startMs < offset ? origin.index : note.index,
    startMs: Math.max(0, note.startMs - offset),
    durationMs: note.startMs + note.durationMs - Math.max(offset, note.startMs),
    noteOffMs: note.noteOffMs - offset }))
}
