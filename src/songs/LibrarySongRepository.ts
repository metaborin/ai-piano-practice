import type { ImportedSong, Song } from './Song'
import type { SongRepository, WritableSongRepository } from './SongRepository'
import { recheckCompatibility } from './inspectMusicXml'
import type { OriginalScoreAttachment, OriginalScoreRepository } from './OriginalScoreRepository'

export class LibrarySongRepository implements WritableSongRepository, OriginalScoreRepository {
  private readonly builtin: SongRepository
  private readonly imported: WritableSongRepository & OriginalScoreRepository
  private storageError: string | null = null
  constructor(builtin: SongRepository, imported: WritableSongRepository & OriginalScoreRepository) {
    this.builtin = builtin
    this.imported = imported
  }
  getStorageError = () => this.storageError
  async listSongs(): Promise<readonly Song[]> {
    const builtin = await this.builtin.listSongs()
    try {
      const imported = await this.imported.listSongs()
      this.storageError = null
      return [...builtin, ...imported.map(recheckCompatibility)]
    } catch {
      this.storageError = '自分の曲を読み込めませんでした。保存領域の設定・空き容量を確認してください。内蔵曲は利用できます。'
      return builtin
    }
  }
  async getSong(id: string) {
    const song = await this.builtin.getSong(id) ?? await this.imported.getSong(id)
    return song ? recheckCompatibility(song) : undefined
  }
  async addSong(song: ImportedSong) {
    if (await this.builtin.getSong(song.id)) throw new Error('内蔵曲は変更できません。')
    await this.imported.addSong(song)
  }
  async deleteSong(id: string) {
    if (await this.builtin.getSong(id)) throw new Error('内蔵曲は削除できません。')
    await this.imported.deleteSong(id)
  }
  async saveOriginalScore(id: string, attachment: OriginalScoreAttachment) {
    if (await this.builtin.getSong(id)) throw new Error('内蔵曲は変更できません。')
    return this.imported.saveOriginalScore(id, attachment)
  }
  async deleteOriginalScore(id: string) {
    if (await this.builtin.getSong(id)) throw new Error('内蔵曲は変更できません。')
    return this.imported.deleteOriginalScore(id)
  }
  getOriginalScore(id: string) { return this.imported.getOriginalScore(id) }
}
