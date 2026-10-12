import type { ScoreModel, ScoreSource } from './ScoreModel'
import { createPracticePlan } from '../practice/PracticePlan'
import type { PracticeMode, PracticePlan } from '../practice/PracticePlan'
import { loadSongMusicXml } from '../songs/loadSongMusicXml'
import type { Song, DuetPartId } from '../songs/Song'
import { oppositePart, songForDuetPart } from '../songs/duetSongs'
import { parseMusicXml } from './parseMusicXml'
import { validateDuetPair } from '../practice/DuetPlan'
import { resolvePracticeStart } from '../practice/PracticeStartResolver'
import type { PracticeStart, PracticeStartPosition } from '../practice/PracticeStartResolver'
import type { RepeatPosition } from './ScoreNavigation'

export type SongSnapshot = {
  readonly requestId: number
  readonly song: Song | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly source: ScoreSource | null
  readonly error: string | null
  readonly model: ScoreModel | null
  readonly canPractice: boolean
  readonly mode: PracticeMode
  readonly plan: PracticePlan | null
  readonly practiceStart: PracticeStart
  readonly startPosition: PracticeStartPosition | null
  readonly duetPart: DuetPartId
  readonly partnerPlan: PracticePlan | null
}
type Dependencies = {
  reset: () => void
  apply: (plan: PracticePlan, partner: PracticePlan | null) => void
  position?: (index: number | null) => void
  obtain?: (song: Song) => Promise<string>
}

/** Coordinates acquisition and OSMD completion without owning MIDI or a DOM. */
export class SongSelection {
  private generation = 0
  private listeners = new Set<() => void>()
  private snapshot: SongSnapshot
  private readonly dependencies: Dependencies
  private partnerModel: ScoreModel | null = null
  constructor(initial: Song | null, dependencies: Dependencies) {
    this.dependencies = dependencies
    this.snapshot = { requestId: 0, song: initial, status: 'idle', source: null, error: null, model: null, canPractice: false, mode: 'both', plan: null, practiceStart: { kind: 'beginning' }, startPosition: null, duetPart: 'secondo', partnerPlan: null }
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<SongSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  select = (song: Song) => this.selectPart(song, song.duet?.defaultPart ?? 'secondo')
  setDuetPart = (part: DuetPartId) => {
    const song = this.snapshot.song
    if (!song?.duet || this.snapshot.duetPart === part) return Promise.resolve()
    return this.selectPart(song, part)
  }
  private selectPart = async (song: Song, duetPart: DuetPartId) => {
    const requestId = ++this.generation
    // Synchronous, before the first await: grading stops before MIDI output stops.
    this.dependencies.reset()
    this.partnerModel = null
    this.publish({ requestId, song, status: 'loading', source: null, error: null, model: null, canPractice: false, mode: 'both', plan: null, practiceStart: { kind: 'beginning' }, startPosition: null, duetPart, partnerPlan: null })
    try {
      const obtain = this.dependencies.obtain ?? loadSongMusicXml
      const [xml, partnerXml] = await Promise.all([
        obtain(songForDuetPart(song, duetPart)),
        song.duet ? obtain(songForDuetPart(song, oppositePart(duetPart))) : Promise.resolve(null),
      ])
      if (requestId !== this.generation) return
      if (partnerXml) {
        try { this.partnerModel = parseMusicXml({ id: `${song.id}:partner`, title: song.title, partLabel: oppositePart(duetPart), musicXml: partnerXml }) }
        catch { this.fail(requestId, '相手パートのMusicXMLを解析できませんでした。別の曲を選んでください。'); return }
      }
      this.acceptMusicXml(requestId, xml)
    } catch {
      this.fail(requestId, 'MusicXMLを取得できませんでした。通信を確認し、別の曲を選んでください。')
    }
  }
  /** Accept already acquired XML separately, leaving room for future acquisition sources. */
  private acceptMusicXml(requestId: number, musicXml: string) {
    if (requestId !== this.generation || !this.snapshot.song) return
    const { id, title, partLabel } = songForDuetPart(this.snapshot.song, this.snapshot.duetPart)
    this.publish({ source: { id, title, partLabel, musicXml } })
  }
  ready = (requestId: number, model: ScoreModel) => {
    if (requestId !== this.generation || this.snapshot.status !== 'loading') return
    const source = this.snapshot.source
    if (!source || source.id !== model.id || source.musicXml !== model.musicXml || model.measures.length === 0 || (model.notes.length === 0 && model.rests.length === 0)) {
      this.fail(requestId, '練習対象の音を読み込めませんでした。別の曲を選んでください。')
      return
    }
    let partnerPlan: PracticePlan | null = null
    if (this.snapshot.song?.duet) {
      try {
        if (!this.partnerModel) throw new Error('相手パートの楽譜がありません。')
        validateDuetPair(model, this.partnerModel)
        partnerPlan = createPracticePlan(this.partnerModel, 'both', this.snapshot.song.tempoBpm)
        if (!partnerPlan?.targets.length) throw new Error('相手パートに再生する音がありません。')
      } catch (error) { this.fail(requestId, error instanceof Error ? error.message : '連弾の楽譜を準備できませんでした。'); return }
    }
    this.snapshot = { ...this.snapshot, partnerPlan }
    const plan = createPracticePlan(model, this.snapshot.mode, this.snapshot.song?.tempoBpm)
    const startPosition = this.applyPlan(plan)
    this.publish({ status: 'ready', model, plan, startPosition, canPractice: !!plan?.targets.length })
  }
  setMode = (mode: PracticeMode, currentOccurrenceIndex?: number) => {
    const model = this.snapshot.model
    if (this.snapshot.status !== 'ready' || !model || this.snapshot.mode === mode) return
    const preferred = currentOccurrenceIndex === undefined ? undefined : this.snapshot.plan?.sequence.occurrences[currentOccurrenceIndex]
    this.dependencies.reset()
    const plan = createPracticePlan(model, mode, this.snapshot.song?.tempoBpm)
    const practiceStart = this.snapshot.practiceStart.kind === 'current' && preferred && plan
      ? { kind: 'current' as const, occurrenceIndex: plan.sequence.occurrences.findIndex(o => o.measureOccurrenceIndex > preferred.measureOccurrenceIndex
        || o.measureOccurrenceIndex === preferred.measureOccurrenceIndex && o.sourceMoment.onsetBeats >= preferred.sourceMoment.onsetBeats) }
      : this.snapshot.practiceStart
    const startPosition = this.applyPlan(plan, practiceStart, preferred)
    this.publish({ mode, plan, practiceStart, startPosition, canPractice: !!plan?.targets.length })
  }
  private applyPlan(plan: PracticePlan | null, requested = this.snapshot.practiceStart, preferred?: RepeatPosition) {
    if (!plan) return null
    const position = resolvePracticeStart(plan, requested, preferred)
    this.dependencies.apply(plan, this.snapshot.partnerPlan)
    this.dependencies.position?.(position.resolvedOccurrenceIndex)
    return position
  }
  setPracticeStart = (practiceStart: PracticeStart) => {
    if (this.snapshot.status !== 'ready' || !this.snapshot.plan) return
    this.dependencies.reset()
    const startPosition = this.applyPlan(this.snapshot.plan, practiceStart)
    this.publish({ practiceStart, startPosition })
  }
  fail = (requestId: number, error: string) => {
    if (requestId !== this.generation) return
    this.dependencies.reset()
    this.partnerModel = null
    this.publish({ status: 'error', source: null, error, model: null, plan: null, partnerPlan: null, canPractice: false, startPosition: null })
  }
  cancel = () => {
    ++this.generation
    this.dependencies.reset()
  }
}
