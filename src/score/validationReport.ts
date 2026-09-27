import type { ScoreModel } from './ScoreModel'
import type { Compatibility } from '../songs/Song'
import { compatibilityFromModel } from '../songs/inspectMusicXml'
import { resolveTempo } from '../audio/tempo'
import { createPracticePlan } from '../practice/PracticePlan'
import { buildPlaybackSequence } from './ScoreNavigation'

/** Derived only; never persisted over the original XML or cached Song metadata. */
export function createValidationReport(model: ScoreModel | null, songTempoBpm?: number, compatibility?: Compatibility | null, error?: string | null) {
  const result = compatibility ?? (model ? compatibilityFromModel(model) : null)
  const supported = !error && result?.status === 'supported'
  return {
    supported,
    label: supported ? model?.practiceCompatibility === 'simpleMelody' ? '単旋律対応' : '音程練習対応' : '現在の練習・手本は未対応',
    reasons: [...new Set([...(result?.reasons ?? []), ...(error ? [error] : [])])],
    tempo: model ? resolveTempo(model, songTempoBpm) : null,
    measures: model ? { first: model.measures[0]?.number, last: model.measures.at(-1)?.number, count: model.measures.length } : null,
    chordMoments: model?.moments.filter((moment) => moment.notes.length > 1).length ?? 0,
    tieNotes: model?.notes.filter((note) => note.tieStart || note.tieStop).length ?? 0,
    navigation: model?.navigation ?? null,
    expandedMeasures: model && supported ? buildPlaybackSequence(model).measures.map(occurrence => occurrence.source.number) : null,
    steps: model && supported ? { right: createPracticePlan(model, 'right')?.sequence.occurrences.length ?? 0,
      left: createPracticePlan(model, 'left')?.sequence.occurrences.length ?? 0, both: createPracticePlan(model)?.sequence.occurrences.length ?? 0 } : null,
  }
}
