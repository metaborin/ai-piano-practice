import twinkleUrl from '../scores/twinkle.musicxml?url&no-inline'
import doReMiUrl from '../scores/do-re-mi.musicxml?url&no-inline'
import shortMelodyUrl from '../scores/short-melody.musicxml?url&no-inline'
import type { Song } from './Song'
import type { SongRepository } from './SongRepository'

// Vite generates URLs under its configured base, including the Pages subpath.
// Kept private: consumers read serializable records through the repository.
const builtInSongs: readonly Song[] = [
  { id: 'twinkle-opening', title: 'きらきら星', source: 'builtin', partLabel: '右手・単音', musicXml: { type: 'url', value: twinkleUrl } },
  { id: 'do-re-mi', title: 'ドレミの練習', source: 'builtin', partLabel: '右手・単音', musicXml: { type: 'url', value: doReMiUrl } },
  { id: 'short-melody', title: '短いメロディ', source: 'builtin', partLabel: '右手・単音', musicXml: { type: 'url', value: shortMelodyUrl } },
]

export class BuiltInSongRepository implements SongRepository {
  async listSongs(): Promise<readonly Song[]> {
    return structuredClone(builtInSongs)
  }
  async getSong(id: string): Promise<Song | undefined> {
    const song = builtInSongs.find((entry) => entry.id === id)
    return song ? structuredClone(song) : undefined
  }
}
