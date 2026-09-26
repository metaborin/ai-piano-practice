import type { ImportedSong, Song } from './Song'

/** Async reads work equally for bundled metadata and a future IndexedDB store. */
export interface SongRepository {
  listSongs(): Promise<readonly Song[]>
  getSong(id: string): Promise<Song | undefined>
}

export interface WritableSongRepository extends SongRepository {
  addSong(song: ImportedSong): Promise<void>
  deleteSong(id: string): Promise<void>
  getStorageError?(): string | null
}
