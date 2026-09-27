import type { ScoreModel, ScoreSource } from './ScoreModel'
import { createPracticePlan } from '../practice/PracticePlan'
import type { PracticeMode, PracticePlan } from '../practice/PracticePlan'
import { loadSongMusicXml } from '../songs/loadSongMusicXml'
import type { Song } from '../songs/Song'

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
}
type Dependencies = {
  reset: () => void
  apply: (plan: PracticePlan) => void
  obtain?: (song: Song) => Promise<string>
}

/** Coordinates acquisition and OSMD completion without owning MIDI or a DOM. */
export class SongSelection {
  private generation = 0
  private listeners = new Set<() => void>()
  private snapshot: SongSnapshot
  private readonly dependencies: Dependencies
  constructor(initial: Song | null, dependencies: Dependencies) {
    this.dependencies = dependencies
    this.snapshot = { requestId: 0, song: initial, status: 'idle', source: null, error: null, model: null, canPractice: false, mode: 'both', plan: null }
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
  select = async (song: Song) => {
    const requestId = ++this.generation
    // Synchronous, before the first await: grading stops before MIDI output stops.
    this.dependencies.reset()
    this.publish({ requestId, song, status: 'loading', source: null, error: null, model: null, canPractice: false, mode: 'both', plan: null })
    try {
      const xml = await (this.dependencies.obtain ?? loadSongMusicXml)(song)
      this.acceptMusicXml(requestId, xml)
    } catch {
      this.fail(requestId, 'MusicXMLを取得できませんでした。通信を確認し、別の曲を選んでください。')
    }
  }
  /** Accept already acquired XML separately, leaving room for future acquisition sources. */
  private acceptMusicXml(requestId: number, musicXml: string) {
    if (requestId !== this.generation || !this.snapshot.song) return
    const { id, title, partLabel } = this.snapshot.song
    this.publish({ source: { id, title, partLabel, musicXml } })
  }
  ready = (requestId: number, model: ScoreModel) => {
    if (requestId !== this.generation || this.snapshot.status !== 'loading') return
    const source = this.snapshot.source
    if (!source || source.id !== model.id || source.musicXml !== model.musicXml || model.measures.length === 0 || (model.notes.length === 0 && model.rests.length === 0)) {
      this.fail(requestId, '練習対象の音を読み込めませんでした。別の曲を選んでください。')
      return
    }
    const plan = createPracticePlan(model, this.snapshot.mode)
    if (plan) this.dependencies.apply(plan)
    this.publish({ status: 'ready', model, plan, canPractice: !!plan?.targets.length })
  }
  setMode = (mode: PracticeMode) => {
    const model = this.snapshot.model
    if (this.snapshot.status !== 'ready' || !model || this.snapshot.mode === mode) return
    this.dependencies.reset()
    const plan = createPracticePlan(model, mode)
    if (plan) this.dependencies.apply(plan)
    this.publish({ mode, plan, canPractice: !!plan?.targets.length })
  }
  fail = (requestId: number, error: string) => {
    if (requestId !== this.generation) return
    this.dependencies.reset()
    this.publish({ status: 'error', source: null, error, model: null, plan: null, canPractice: false })
  }
  cancel = () => {
    ++this.generation
    this.dependencies.reset()
  }
}
