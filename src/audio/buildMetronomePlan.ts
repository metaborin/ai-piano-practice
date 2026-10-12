import type { PracticePlan } from '../practice/PracticePlan'
import type { PlaybackRate } from './playbackRate'
import type { DemoStart } from './DemoStart'
import { resolveDemoStart } from './DemoStart'
import { millisecondsAtBeat, resolveTempo } from './tempo'

export type MetronomeBeat = { readonly atMs: number; readonly accent: boolean; readonly measureOccurrenceIndex: number; readonly beatInMeasure: number }
export const MAX_METRONOME_BEATS = 100_000

/** Clicks come from the same written measures, repeat occurrences and tempo integrator as MIDI. */
export function buildMetronomePlan(plan: PracticePlan, rate: PlaybackRate = 1, start: DemoStart = { kind: 'beginning' }): MetronomeBeat[] {
  const tempo = resolveTempo(plan.score, plan.songTempoBpm, rate)
  const timeAt = (beat: number) => millisecondsAtBeat(tempo, beat)
  const origin = resolveDemoStart(plan, start)
  const beats: MetronomeBeat[] = []
  let elapsed = 0, offset = 0
  for (const [measureOccurrenceIndex, { source: measure }] of plan.sequence.playback.measures.entries()) {
    if (measureOccurrenceIndex === origin.measureOccurrenceIndex) offset = elapsed + timeAt(origin.onsetBeats) - timeAt(measure.onsetBeats)
    const meter = measure.meter
    const unit = meter ? 4 / meter.beatType * (meter.beatType === 8 && meter.beats >= 6 && meter.beats % 3 === 0 ? 3 : 1) : 1
    const full = meter ? meter.beats * 4 / meter.beatType : measure.durationBeats
    // An incomplete opening/implicit bar is an anacrusis, not an invented downbeat.
    const phase = meter && (measure.implicit || measure.index === 0) && measure.durationBeats < full ? full - measure.durationBeats : 0
    if (beats.length + Math.ceil((phase + measure.durationBeats) / unit) - Math.ceil((phase - 1e-9) / unit) > MAX_METRONOME_BEATS) throw new Error('拍数がメトロノームの上限（100,000拍）を超えています。')
    for (let tick = Math.ceil((phase - 1e-9) / unit); tick * unit - phase < measure.durationBeats - 1e-9; tick++) {
      beats.push({ atMs: elapsed + timeAt(measure.onsetBeats + tick * unit - phase) - timeAt(measure.onsetBeats),
        accent: !!meter && tick === 0, measureOccurrenceIndex, beatInMeasure: tick + 1 })
    }
    elapsed += timeAt(measure.onsetBeats + measure.durationBeats) - timeAt(measure.onsetBeats)
  }
  return beats.filter(beat => beat.atMs >= offset - 1e-7).map(beat => ({ ...beat, atMs: Math.max(0, beat.atMs - offset) }))
}
