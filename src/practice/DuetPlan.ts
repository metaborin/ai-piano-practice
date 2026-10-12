import type { ScoreModel } from '../score/ScoreModel'
import type { PracticePlan } from './PracticePlan'
import { millisecondsAtBeat, resolveTempo } from '../audio/tempo'
import { buildDemoPlan } from '../audio/buildDemoPlan'
import type { PlaybackRate } from '../audio/playbackRate'

/** Pair only after both originals validate; a mismatched accompaniment is never enabled. */
export function validateDuetPair(own: ScoreModel, partner: ScoreModel) {
  const signature = (score: ScoreModel) => JSON.stringify({
    measures: score.measures.map(m => [m.number, m.onset, m.duration]), navigation: score.navigation,
    tempos: score.tempos.map(t => [t.onset, t.bpm]),
  })
  if (signature(own) !== signature(partner)) throw new Error('連弾の両パートの小節・反復・テンポが一致しません。')
  if (!['simpleMelody','pitchPractice'].includes(partner.practiceCompatibility) || !partner.notes.length) throw new Error('相手パートのMusicXMLは再生に対応していません。')
}

export function buildDuetTimeline(own: PracticePlan, partner: PracticePlan, playbackRate: PlaybackRate = 1) {
  validateDuetPair(own.score, partner.score)
  const tempo = resolveTempo(own.score, own.songTempoBpm, playbackRate)
  const timeAt = (beat: number) => millisecondsAtBeat(tempo, beat)
  let endMs = 0
  const measureStarts = own.sequence.playback.measures.map(({ source }) => {
    const start = endMs
    endMs += timeAt(source.onsetBeats + source.durationBeats) - timeAt(source.onsetBeats)
    return start
  })
  const targetStarts = own.sequence.occurrences.map(o => {
    const measure = own.sequence.playback.measures[o.measureOccurrenceIndex].source
    return measureStarts[o.measureOccurrenceIndex] + timeAt(o.sourceMoment.onsetBeats) - timeAt(measure.onsetBeats)
  })
  return { measureStarts, targetStarts, endMs, notes: buildDemoPlan(partner, { kind: 'beginning' }, playbackRate) }
}
