import { expect, it } from 'vitest'
import { BuiltInSongRepository } from '../../src/songs/BuiltInSongRepository'
import type { Song } from '../../src/songs/Song'
import type { SongRepository } from '../../src/songs/SongRepository'

const repository: SongRepository = new BuiltInSongRepository()

it('lists the existing three songs with stable IDs, titles, builtin sources and XML locations', async () => {
  const songs = await repository.listSongs()
  expect(songs.map(({ id, title, source }) => ({ id, title, source }))).toEqual([
    { id: 'twinkle-opening', title: 'きらきら星', source: 'builtin' },
    { id: 'do-re-mi', title: 'ドレミの練習', source: 'builtin' },
    { id: 'short-melody', title: '短いメロディ', source: 'builtin' },
  ])
  expect(new Set(songs.map((song) => song.id)).size).toBe(3)
  for (const song of songs) {
    expect(song.musicXml.type).toBe('url')
    expect(song.musicXml.value).toContain('.musicxml')
    expect(song.originalScore).toBeUndefined()
    expect(structuredClone(song)).toEqual(song)
    expect(JSON.parse(JSON.stringify(song))).toEqual(song)
  }
})

it('looks up the correct full song by ID and returns undefined for an unknown ID', async () => {
  for (const song of await repository.listSongs()) expect(await repository.getSong(song.id)).toEqual(song)
  expect(await repository.getSong('missing-song')).toBeUndefined()
})

it('returned records cannot mutate the built-in catalog, including nested locations', async () => {
  const songs = await repository.listSongs()
  const copy = songs[0] as { title: string; musicXml: { value: string } }
  copy.title = 'changed'
  copy.musicXml.value = 'changed'
  expect(await repository.getSong('twinkle-opening')).toMatchObject({ title: 'きらきら星' })
  expect((await repository.getSong('twinkle-opening'))!.musicXml.value).not.toBe('changed')
  expect((await repository.listSongs())[0].title).toBe('きらきら星')
})

it('the same repository contract can return serializable imported metadata and an original-score reference', async () => {
  const song: Song = {
    id: 'imported:test', title: '自分の曲', source: 'imported', composer: '作者',
    partLabel: '右手・単音', musicXml: { type: 'text', value: '<score-partwise/>' },
    tempoBpm: 100, difficulty: 1, createdAt: 123,
    originalScore: { type: 'pdf', storageId: 'attachment-1', fileName: '指番号.pdf' },
  }
  // Test double only; no import UI or persistence is implemented in Phase 2E-A.
  const future: SongRepository = {
    listSongs: async () => [structuredClone(song)],
    getSong: async (id) => id === song.id ? structuredClone(song) : undefined,
  }
  expect((await future.listSongs())[0].source).toBe('imported')
  expect(await future.getSong(song.id)).toEqual(song)
  expect(JSON.parse(JSON.stringify(song))).toEqual(song)
  const image: Song = { ...song, originalScore: { type: 'image', storageId: 'attachment-2' } }
  expect(structuredClone(image).originalScore?.type).toBe('image')
})
