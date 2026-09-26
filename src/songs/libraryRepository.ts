import { BuiltInSongRepository } from './BuiltInSongRepository'
import type { SongRepository } from './SongRepository'

/** Composition point: a future combined built-in/IndexedDB repository goes here. */
export const songRepository: SongRepository = new BuiltInSongRepository()
export const DEFAULT_SONG_ID = 'twinkle-opening'
