import { BuiltInSongRepository } from './BuiltInSongRepository'
import { IndexedDbSongRepository } from './IndexedDbSongRepository'
import { LibrarySongRepository } from './LibrarySongRepository'

export const songRepository = new LibrarySongRepository(new BuiltInSongRepository(), new IndexedDbSongRepository())
export const DEFAULT_SONG_ID = 'twinkle-opening'
