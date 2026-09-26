import type { ScoreModel, ScoreSource } from './ScoreModel'
import { getSongMusicXml } from './songCatalog'
import type { Song } from './songCatalog'

export type SongSnapshot = {
  readonly requestId: number
  readonly song: Song
  readonly status: 'loading' | 'ready' | 'error'
  readonly source: ScoreSource | null
  readonly error: string | null
}
type Dependencies = {
  reset: () => void
  apply: (model: ScoreModel) => void
  obtain?: (song: Song) => Promise<string>
}

/** Coordinates acquisition and OSMD completion without owning MIDI or a DOM. */
export class SongSelection {
  private generation = 0
  private listeners = new Set<() => void>()
  private snapshot: SongSnapshot
  private readonly dependencies: Dependencies
  constructor(initial: Song, dependencies: Dependencies) {
    this.dependencies = dependencies
    this.snapshot = { requestId: 0, song: initial, status: 'loading', source: null, error: null }
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
    this.publish({ requestId, song, status: 'loading', source: null, error: null })
    try {
      const xml = await (this.dependencies.obtain ?? getSongMusicXml)(song)
      this.acceptMusicXml(requestId, xml)
    } catch {
      this.fail(requestId, 'MusicXMLを取得できませんでした。通信を確認し、別の曲を選んでください。')
    }
  }
  /** Accept already acquired XML separately, leaving room for future acquisition sources. */
  private acceptMusicXml(requestId: number, musicXml: string) {
    if (requestId !== this.generation) return
    const { id, title, partLabel } = this.snapshot.song
    this.publish({ source: { id, title, partLabel, musicXml } })
  }
  ready = (requestId: number, model: ScoreModel) => {
    if (requestId !== this.generation || this.snapshot.status !== 'loading') return
    const source = this.snapshot.source
    if (!source || source.id !== model.id || source.musicXml !== model.musicXml || model.notes.length === 0) {
      this.fail(requestId, '練習対象の音を読み込めませんでした。別の曲を選んでください。')
      return
    }
    this.dependencies.apply(model)
    this.publish({ status: 'ready' })
  }
  fail = (requestId: number, error: string) => {
    if (requestId !== this.generation) return
    this.dependencies.reset()
    this.publish({ status: 'error', source: null, error })
  }
  cancel = () => {
    ++this.generation
    this.dependencies.reset()
  }
}
