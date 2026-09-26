import type { Song } from './Song'

/** Async reads work equally for bundled metadata and a future IndexedDB store. */
export interface SongRepository {
  listSongs(): Promise<readonly Song[]>
  getSong(id: string): Promise<Song | undefined>
}

// A future writable repository can extend this contract with addSong/deleteSong.
// The built-in repository deliberately exposes no write operations.
