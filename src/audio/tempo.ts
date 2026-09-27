import type { ScoreModel } from '../score/ScoreModel'

export const DEFAULT_TEMPO_BPM = 100
export const DEMO_GATE_RATIO = 0.9
export type TempoSource = 'MusicXML' | 'Song metadata' | 'default'
export type TempoPoint = { readonly beat: number; readonly bpm: number; readonly source: TempoSource; readonly startMs: number }
const validTempo = (bpm: number | undefined): bpm is number => typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 && Number.isFinite(60_000 / bpm)

/** Quarter-note tempo. Before the first XML mark, use metadata, then the default.
 * At equal onsets the last XML direction wins, matching the normalized parser.
 */
export function resolveTempo(score: ScoreModel, songTempoBpm?: number): readonly TempoPoint[] {
  const initial: TempoPoint = validTempo(songTempoBpm)
    ? { beat: 0, bpm: songTempoBpm, source: 'Song metadata', startMs: 0 }
    : { beat: 0, bpm: DEFAULT_TEMPO_BPM, source: 'default', startMs: 0 }
  const points: TempoPoint[] = [initial]
  for (const tempo of [...score.tempos].sort((a, b) => a.onsetBeats - b.onsetBeats)) {
    if (!validTempo(tempo.bpm) || !Number.isFinite(tempo.onsetBeats) || tempo.onsetBeats < 0) continue
    const previous = points.at(-1)!
    const point: TempoPoint = { beat: tempo.onsetBeats, bpm: tempo.bpm, source: 'MusicXML',
      startMs: previous.startMs + (tempo.onsetBeats - previous.beat) * 60_000 / previous.bpm }
    if (point.beat === previous.beat) points[points.length - 1] = point
    else points.push(point)
  }
  return points
}

/** Integrate the same tempo timeline for attacks, rests, releases and cursor timing. */
export function millisecondsAtBeat(points: readonly TempoPoint[], beat: number): number {
  const point = points.findLast((candidate) => candidate.beat <= beat) ?? points[0]
  const time = point.startMs + (beat - point.beat) * 60_000 / point.bpm
  if (!Number.isFinite(time) || beat < 0) throw new Error('Invalid playback time')
  return time
}
