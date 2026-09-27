import { children, descendants } from './musicXmlDocument'
import type { ScoreMeasure, ScoreMoment } from './ScoreModel'

export const MAX_SEQUENCE_OCCURRENCES = 100_000
export type RepeatRegion = {
  readonly id: string; readonly startMeasureIndex: number; readonly endMeasureIndex: number
  readonly totalPasses: number
}
export type ScoreNavigation = { readonly repeats: readonly RepeatRegion[]; readonly reasons: readonly string[] }
export type RepeatPosition = { readonly repeatRegionId?: string; readonly repeatPass?: number }
export type MeasureOccurrence = RepeatPosition & {
  readonly id: string; readonly sequenceIndex: number; readonly source: ScoreMeasure
}
export type SequenceOccurrence = RepeatPosition & {
  readonly id: string; readonly sequenceIndex: number; readonly sourceMoment: ScoreMoment
  readonly measureOccurrenceIndex: number
}
export type PlaybackSequence = {
  readonly measures: readonly MeasureOccurrence[]; readonly moments: readonly SequenceOccurrence[]
}
const limitMessage = '演奏順の展開上限（100,000位置）を超えています。反復回数を確認してください。'

/** Repeat marks describe measure boundaries, independently of the written timeline. */
export function readScoreNavigation(doc: Document, measures: readonly Element[]): ScoreNavigation {
  const reasons = new Set<string>(), repeats: RepeatRegion[] = []
  const reject = (detail: string) => reasons.add('現在未対応の演奏順記号あり：' + detail)
  if (['ending', 'volta', 'segno', 'coda', 'fine', 'measure-repeat', 'beat-repeat'].some(name => descendants(doc, name).length)
    || descendants(doc, 'sound').some(node => ['dacapo', 'dalsegno', 'segno', 'coda', 'tocoda', 'fine', 'forward-repeat', 'time-only'].some(name => node.hasAttribute(name)))
    || descendants(doc, 'barline').some(node => node.hasAttribute('segno') || node.hasAttribute('coda'))
    || descendants(doc, 'words').some(node => /(?:\bD\s*\.?\s*[CS]\s*\.?\b|\bda\s+capo\b|\bdal\s+segno\b|\bsegno\b|\bcoda\b|\bfine\b)/i.test(node.textContent ?? ''))) reject('ending / D.C. / D.S. / Segno / Coda / Fine等')
  const marks: { boundary: number; direction: string; times: string | null }[] = []
  for (const [index, measure] of measures.entries()) for (const barline of children(measure, 'barline')) {
    for (const repeat of children(barline, 'repeat')) {
      const location = barline.getAttribute('location') || 'right'
      const direction = repeat.getAttribute('direction') || ''
      if (!['left', 'right'].includes(location) || !['forward', 'backward'].includes(direction)) { reject('小節途中または不正な反復'); continue }
      if (repeat.hasAttribute('after-jump') || (direction === 'forward' && repeat.hasAttribute('times'))) reject('条件付き反復・開始側の回数指定')
      marks.push({ boundary: index + (location === 'right' ? 1 : 0), direction, times: repeat.hasAttribute('times') ? repeat.getAttribute('times') : null })
    }
  }
  if (marks.length !== descendants(doc, 'repeat').length) reject('barline外または不正な反復')
  // A boundary can end one independent region and begin the next.
  marks.sort((a, b) => a.boundary - b.boundary || (a.direction === b.direction ? 0 : a.direction === 'backward' ? -1 : 1))
  let open: number | null = null
  for (const mark of marks) {
    if (mark.direction === 'forward') {
      if (open !== null) reject('ネストした反復')
      else open = mark.boundary
      continue
    }
    const start = open ?? 0, end = mark.boundary - 1
    // MusicXML 4.0 <repeat>: times is total plays, not additional repeats.
    const totalPasses = mark.times === null ? 2 : Number(mark.times)
    if (mark.times !== null && !/^\+?\d+$/.test(mark.times.trim()) || !Number.isSafeInteger(totalPasses) || totalPasses < 1) reject('反復回数は1以上の整数が必要です')
    else if (totalPasses > MAX_SEQUENCE_OCCURRENCES) reject(limitMessage)
    else if (start < 0 || end < start || end >= measures.length || repeats.some(region => start <= region.endMeasureIndex)) reject('重複・ネストまたは空の反復区間')
    else repeats.push({ id: `repeat:${start}:${end}`, startMeasureIndex: start, endMeasureIndex: end, totalPasses })
    open = null
  }
  if (open !== null) reject('終了記号のない反復')
  return { repeats, reasons: [...reasons] }
}

/** Bounded forward construction: no navigation while-loop and no copied score events. */
export function buildPlaybackSequence(score: { measures: readonly ScoreMeasure[]; moments: readonly ScoreMoment[]; navigation: ScoreNavigation }): PlaybackSequence {
  if (score.navigation.reasons.length) throw new Error(score.navigation.reasons.join('、'))
  const regions = [...score.navigation.repeats].sort((a, b) => a.startMeasureIndex - b.startMeasureIndex)
  let lastEnd = -1, expandedCount = score.measures.length
  for (const region of regions) {
    if (!Number.isSafeInteger(region.totalPasses) || region.totalPasses < 1 || !Number.isInteger(region.startMeasureIndex) || !Number.isInteger(region.endMeasureIndex)
      || region.startMeasureIndex <= lastEnd || region.endMeasureIndex < region.startMeasureIndex || region.endMeasureIndex >= score.measures.length) throw new Error('反復区間が不正または重複しています。')
    expandedCount += (region.endMeasureIndex - region.startMeasureIndex + 1) * (region.totalPasses - 1)
    if (expandedCount > MAX_SEQUENCE_OCCURRENCES) throw new Error(limitMessage)
    lastEnd = region.endMeasureIndex
  }
  const measures: MeasureOccurrence[] = [], moments: SequenceOccurrence[] = []
  let noteOccurrences = 0
  const byMeasure = new Map<number, ScoreMoment[]>()
  for (const moment of score.moments) { const group = byMeasure.get(moment.measureIndex) ?? []; group.push(moment); byMeasure.set(moment.measureIndex, group) }
  const append = (index: number, position: RepeatPosition = {}) => {
    if (measures.length >= MAX_SEQUENCE_OCCURRENCES) throw new Error(limitMessage)
    const source = score.measures[index], sequenceIndex = measures.length
    measures.push({ id: `measure-occurrence:${sequenceIndex}`, sequenceIndex, source, ...position })
    for (const sourceMoment of byMeasure.get(index) ?? []) {
      noteOccurrences += sourceMoment.notes.length
      if (moments.length >= MAX_SEQUENCE_OCCURRENCES || noteOccurrences > MAX_SEQUENCE_OCCURRENCES) throw new Error(limitMessage)
      moments.push({ id: `occurrence:${sequenceIndex}:${sourceMoment.id}`, sequenceIndex: moments.length, sourceMoment, measureOccurrenceIndex: sequenceIndex, ...position })
    }
  }
  const starts = new Map(regions.map(region => [region.startMeasureIndex, region]))
  for (let index = 0; index < score.measures.length; index++) {
    const region = starts.get(index)
    if (!region) { append(index); continue }
    for (let pass = 1; pass <= region.totalPasses; pass++) for (let measure = index; measure <= region.endMeasureIndex; measure++) append(measure, { repeatRegionId: region.id, repeatPass: pass })
    index = region.endMeasureIndex
  }
  return { measures, moments }
}
