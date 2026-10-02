import type { ImportedSong } from './Song'
import type { WritableSongRepository } from './SongRepository'
import type { OriginalScoreAttachment, OriginalScoreRepository } from './OriginalScoreRepository'

export const SONG_DB_NAME = 'ai-piano-practice'
export const SONG_DB_VERSION = 2
export const SONG_STORE = 'songs'
export const ORIGINAL_SCORE_STORE = 'originalScores'
const storageMessage = '曲の保存領域を利用できませんでした。ブラウザのサイトデータ設定や空き容量を確認して、もう一度お試しください。'

function validateRecord(song: ImportedSong) {
  if (!song || song.source !== 'imported' || !song.id?.startsWith('imported:') || !song.title?.trim() ||
    song.musicXml?.type !== 'text' || typeof song.musicXml.value !== 'string' ||
    typeof song.originalFileName !== 'string' || !Number.isFinite(song.createdAt) ||
    !['musicxml', 'mxl'].includes(song.fileFormat)) throw new Error('保存された曲データの形式が正しくありません。')
}

/** Version 2 adds a Blob store without rewriting/deleting any version 1 Song. */
export class IndexedDbSongRepository implements WritableSongRepository, OriginalScoreRepository {
  private database: Promise<IDBDatabase> | null = null
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(SONG_DB_NAME, SONG_DB_VERSION)
        let rejected = false
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(SONG_STORE)) request.result.createObjectStore(SONG_STORE, { keyPath: 'id' })
          if (!request.result.objectStoreNames.contains(ORIGINAL_SCORE_STORE)) request.result.createObjectStore(ORIGINAL_SCORE_STORE, { keyPath: 'id' })
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
    await this.changeOriginal(id, undefined, true)
  }
  private async changeOriginal(id: string, attachment?: OriginalScoreAttachment, deleteSong = false): Promise<ImportedSong> {
    if (!id.startsWith('imported:')) throw new Error('元の楽譜は自分の曲へ登録してください。')
    try {
      const db = await this.open()
      return await new Promise<ImportedSong>((resolve, reject) => {
        const transaction = db.transaction([SONG_STORE, ORIGINAL_SCORE_STORE], 'readwrite')
        const songs = transaction.objectStore(SONG_STORE), assets = transaction.objectStore(ORIGINAL_SCORE_STORE)
        const get = songs.get(id)
        let updated: ImportedSong
        get.onsuccess = () => {
          try {
            const song = get.result as ImportedSong | undefined
            if (!song) throw new Error('Song not found')
            validateRecord(song)
            const { originalScore, ...rest } = song
            if (originalScore) assets.delete(originalScore.storageId)
            updated = attachment ? { ...rest, originalScore: attachment.metadata } : rest
            if (deleteSong) songs.delete(id)
            else {
              if (attachment) assets.put({ id: attachment.metadata.storageId, blob: attachment.blob })
              songs.put(updated)
            }
          } catch { transaction.abort() }
        }
        transaction.oncomplete = () => resolve(updated)
        transaction.onabort = transaction.onerror = () => reject(new Error(storageMessage))
      })
    } catch { throw new Error('元の楽譜を保存・削除できませんでした。曲が存在することと、サイトデータ設定・空き容量を確認してください。') }
  }
  saveOriginalScore(id: string, attachment: OriginalScoreAttachment) {
    return this.changeOriginal(id, attachment)
  }
  deleteOriginalScore(id: string) { return this.changeOriginal(id) }
  async getOriginalScore(storageId: string): Promise<Blob> {
    try {
      const db = await this.open()
      return await new Promise<Blob>((resolve, reject) => {
        const transaction = db.transaction(ORIGINAL_SCORE_STORE)
        const request = transaction.objectStore(ORIGINAL_SCORE_STORE).get(storageId)
        transaction.oncomplete = () => request.result?.blob instanceof Blob ? resolve(request.result.blob) : reject(new Error('Missing Blob'))
        transaction.onabort = transaction.onerror = () => reject(new Error(storageMessage))
      })
    } catch { throw new Error('保存された元の楽譜を読み込めませんでした。曲ライブラリから元の楽譜を登録し直してください。練習用楽譜は利用できます。') }
  }
}
