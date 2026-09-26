import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import type { Song } from '../../src/songs/Song'
import { loadSongMusicXml } from '../../src/songs/loadSongMusicXml'
import { SongSelection } from '../../src/score/SongSelection'
import { PracticeSession } from '../../src/practice/PracticeSession'

const xml = readFileSync(new URL('../../src/scores/short-melody.musicxml', import.meta.url), 'utf8')
const urlSong: Song = {
  id: 'sample', title: 'テスト曲', source: 'builtin', partLabel: '右手・単音',
  musicXml: { type: 'url', value: '/ai-piano-practice/assets/sample.musicxml' },
}
afterEach(() => vi.unstubAllGlobals())

it('loads the exact configured URL, without assuming the site root or rebuilding its path', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(xml))
  vi.stubGlobal('fetch', fetcher)
  expect(await loadSongMusicXml(urlSong)).toBe(xml)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(urlSong.musicXml.value)
})

it('URL and text sources produce the identical XML, independent of builtin/imported source labels', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(xml))
  vi.stubGlobal('fetch', fetcher)
  const fromUrl = await loadSongMusicXml({ ...urlSong, source: 'imported' })
  for (const source of ['builtin', 'imported'] as const) {
    expect(await loadSongMusicXml({ ...urlSong, source, musicXml: { type: 'text', value: xml } })).toBe(fromUrl)
  }
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each([404, 500])('HTTP %s cannot masquerade as a successful XML load', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status })))
  await expect(loadSongMusicXml(urlSong)).rejects.toThrow(String(status))
})

it('network failures are propagated into the existing recoverable song-selection error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const apply = vi.fn()
  const selection = new SongSelection(null, { reset: vi.fn(), apply })
  await selection.select(urlSong)
  expect(selection.getSnapshot()).toMatchObject({ status: 'error', source: null })
  expect(selection.getSnapshot().error).toContain('取得できませんでした')
  expect(apply).not.toHaveBeenCalled()
  await selection.select({ ...urlSong, musicXml: { type: 'text', value: xml } })
  expect(selection.getSnapshot()).toMatchObject({ status: 'loading', source: { musicXml: xml } })
})

it('text songs with original-score metadata enter the existing selection pipeline without loading that attachment', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const song: Song = {
    ...urlSong, source: 'imported', musicXml: { type: 'text', value: xml },
    originalScore: { type: 'pdf', storageId: 'separate-attachment', fileName: 'original.pdf' },
  }
  const practice = new PracticeSession()
  const selection = new SongSelection(null, { reset: () => practice.loadScore(null), apply: practice.loadScore })
  await selection.select(song)
  const state = selection.getSnapshot()
  expect(state.source).toEqual({ id: song.id, title: song.title, partLabel: song.partLabel, musicXml: xml })
  expect(state.song?.originalScore).toEqual(song.originalScore)
  expect(state.status).toBe('loading') // Still waits for the existing OSMD parsing/rendering path.
  expect(practice.getSnapshot().totalNotes).toBe(0)
  expect(fetcher).not.toHaveBeenCalled()
})
