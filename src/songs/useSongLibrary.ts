import { useEffect, useState } from 'react'
import type { Song } from './Song'
import type { SongRepository } from './SongRepository'

export type SongLibraryState = {
  status: 'loading' | 'ready' | 'error'
  songs: readonly Song[]
  error: string | null
}

export function useSongLibrary(repository: SongRepository, onInitialSong: (song: Song) => Promise<void>, initialSongId: string) {
  const [library, setLibrary] = useState<SongLibraryState>({ status: 'loading', songs: [], error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const songs = await repository.listSongs()
        if (cancelled) return
        setLibrary({ status: 'ready', songs, error: null })
        const initial = songs.find((song) => song.id === initialSongId) ?? songs[0]
        if (initial) void onInitialSong(initial)
      } catch {
        if (!cancelled) setLibrary({ status: 'error', songs: [], error: '曲ライブラリを読み込めませんでした。もう一度お試しください。' })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [repository, onInitialSong, initialSongId, attempt])
  const retry = () => {
    setLibrary({ status: 'loading', songs: [], error: null })
    setAttempt((value) => value + 1)
  }
  return { library, retry }
}
