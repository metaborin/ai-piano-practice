import { useEffect, useRef, useState } from 'react'
import type { ImportedSong, Song } from './Song'
import type { WritableSongRepository } from './SongRepository'

export type SongLibraryState = {
  status: 'loading' | 'ready' | 'error'
  songs: readonly Song[]
  error: string | null
}

export function useSongLibrary(repository: WritableSongRepository, onInitialSong: (song: Song) => Promise<void>, initialSongId: string) {
  const [library, setLibrary] = useState<SongLibraryState>({ status: 'loading', songs: [], error: null })
  const [attempt, setAttempt] = useState(0)
  const initialized = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    let cancelled = false
    const request = ++generation.current
    const load = async () => {
      try {
        const songs = await repository.listSongs()
        if (cancelled || request !== generation.current) return
        setLibrary({ status: 'ready', songs, error: repository.getStorageError?.() ?? null })
        if (!initialized.current) {
          initialized.current = true
          const initial = songs.find((song) => song.id === initialSongId) ?? songs[0]
          if (initial) void onInitialSong(initial)
        }
      } catch {
        if (!cancelled && request === generation.current) setLibrary((state) => ({ ...state, status: 'error', error: '曲ライブラリを読み込めませんでした。もう一度お試しください。' }))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [repository, onInitialSong, initialSongId, attempt])
  const retry = () => {
    setLibrary((state) => ({ ...state, status: 'loading', error: null }))
    setAttempt((value) => value + 1)
  }
  const addSong = async (song: ImportedSong) => {
    await repository.addSong(song)
    ++generation.current
    setLibrary((state) => ({ status: 'ready', songs: [...state.songs, song], error: state.error }))
  }
  const deleteSong = async (id: string) => {
    await repository.deleteSong(id)
    ++generation.current
    setLibrary((state) => ({ ...state, status: 'ready', songs: state.songs.filter((song) => song.id !== id) }))
  }
  return { library, retry, addSong, deleteSong }
}
