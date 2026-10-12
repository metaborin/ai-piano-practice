import twinkleUrl from '../scores/twinkle.musicxml?url&no-inline'
import doReMiUrl from '../scores/do-re-mi.musicxml?url&no-inline'
import shortMelodyUrl from '../scores/short-melody.musicxml?url&no-inline'
import harvestUrl from '../scores/harvest-time.musicxml?url&no-inline'
import type { Song } from './Song'
import type { SongRepository } from './SongRepository'
import { duetSongs } from './duetSongs'

// Vite generates URLs under its configured base, including the Pages subpath.
// Kept private: consumers read serializable records through the repository.
const builtInSongs: readonly Song[] = [
  { id: 'twinkle-opening', title: 'きらきら星', source: 'builtin', partLabel: '右手・単音', musicXml: { type: 'url', value: twinkleUrl } },
  { id: 'do-re-mi', title: 'ドレミの練習', source: 'builtin', partLabel: '右手・単音', musicXml: { type: 'url', value: doReMiUrl } },
  { id: 'short-melody', title: '短いメロディ', source: 'builtin', partLabel: '右手・単音', musicXml: { type: 'url', value: shortMelodyUrl } },
  { id: 'harvest-time', title: '刈り入れ時', composer: 'Gustav Lange（ランゲ）', source: 'builtin', partLabel: 'ピアノ独奏・両手', musicXml: { type: 'url', value: harvestUrl },
    originalScore: { type: 'pdf', storageId: 'builtin:harvest-time:original', fileName: '刈り入れ時（原譜・A3見開き）.pdf', mimeType: 'application/pdf', size: 1814114 } },
  ...duetSongs,
]

const originalScoreUrls: Readonly<Record<string, string>> = {
  'builtin:harvest-time:original': `${import.meta.env.BASE_URL}scores/harvest-time-original.pdf`,
}

export class BuiltInSongRepository implements SongRepository {
  async listSongs(): Promise<readonly Song[]> {
    return structuredClone(builtInSongs)
  }
  async getSong(id: string): Promise<Song | undefined> {
    const song = builtInSongs.find((entry) => entry.id === id)
    return song ? structuredClone(song) : undefined
  }
  async getOriginalScore(storageId: string): Promise<Blob> {
    const url = Object.hasOwn(originalScoreUrls, storageId) ? originalScoreUrls[storageId] : undefined
    if (!url) throw new Error('内蔵曲の原譜が見つかりません。')
    const response = await fetch(url)
    if (!response.ok) throw new Error('内蔵曲の原譜を読み込めませんでした。通信状態を確認して、もう一度開いてください。')
    return response.blob()
  }
}
