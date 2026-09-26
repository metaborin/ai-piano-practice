import type { ImportedSong } from './Song'
import type { WritableSongRepository } from './SongRepository'

export const SONG_DB_NAME = 'ai-piano-practice'
export const SONG_DB_VERSION = 1
export const SONG_STORE = 'songs'
const storageMessage = '曲の保存領域を利用できませんでした。ブラウザのサイトデータ設定や空き容量を確認して、もう一度お試しください。'

function validateRecord(song: ImportedSong) {
  if (!song || song.source !== 'imported' || !song.id?.startsWith('imported:') || !song.title?.trim() ||
    song.musicXml?.type !== 'text' || typeof song.musicXml.value !== 'string' ||
    typeof song.originalFileName !== 'string' || !Number.isFinite(song.createdAt) ||
    !['musicxml', 'mxl'].includes(song.fileFormat)) throw new Error('保存された曲データの形式が正しくありません。')
}

/** Store records only; future Blob attachments can use a separate store in a schema upgrade. */
export class IndexedDbSongRepository implements WritableSongRepository {
  private database: Promise<IDBDatabase> | null = null
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(SONG_DB_NAME, SONG_DB_VERSION)
        let rejected = false
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(SONG_STORE)) request.result.createObjectStore(SONG_STORE, { keyPath: 'id' })
        }
        request.onerror = request.onblocked = () => { rejected = true; reject(new Error(storageMessage)) }
        request.onsuccess = () => {
          const db = request.result
          if (rejected) { db.close(); return }
          db.onversionchange = () => { db.close(); this.database = null }
          db.onclose = () => { this.database = null }
          resolve(db)
        }
      }).catch(() => { this.database = null; throw new Error(storageMessage) })
    }
    return this.database
  }
  private async operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    try {
      const db = await this.open()
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(SONG_STORE, mode)
        const request = run(transaction.objectStore(SONG_STORE))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onabort = transaction.onerror = () => reject(new Error(storageMessage))
      })
    } catch { throw new Error(storageMessage) }
  }
  async listSongs(): Promise<readonly ImportedSong[]> {
    const songs = await this.operation<ImportedSong[]>('readonly', (store) => store.getAll())
    songs.forEach(validateRecord)
    return songs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }
  async getSong(id: string): Promise<ImportedSong | undefined> {
    const song = await this.operation<ImportedSong | undefined>('readonly', (store) => store.get(id))
    if (song) validateRecord(song)
    return song
  }
  async addSong(song: ImportedSong) {
    validateRecord(song)
    await this.operation('readwrite', (store) => store.add(song))
  }
  async deleteSong(id: string) {
    if (!id.startsWith('imported:')) throw new Error('内蔵曲は削除できません。')
    await this.operation('readwrite', (store) => store.delete(id))
  }
}
