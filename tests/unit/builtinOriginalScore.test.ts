import { afterEach, expect, it, vi } from 'vitest'
import { BuiltInSongRepository } from '../../src/songs/BuiltInSongRepository'
import { LibrarySongRepository } from '../../src/songs/LibrarySongRepository'

afterEach(() => vi.unstubAllGlobals())
function setup() {
  const builtin = new BuiltInSongRepository()
  const imported = { listSongs: vi.fn().mockRejectedValue(new Error('IDB unavailable')), getSong: vi.fn(), addSong: vi.fn(), deleteSong: vi.fn(), saveOriginalScore: vi.fn(), deleteOriginalScore: vi.fn(), getOriginalScore: vi.fn().mockResolvedValue(new Blob(['personal PDF'])) }
  return { builtin, imported, library: new LibrarySongRepository(builtin, imported) }
}

it('a built-in PDF is fetched through the Pages base even when personal storage is unavailable', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(new Blob(['%PDF-reference'], { type: 'application/pdf' })))
  vi.stubGlobal('fetch', fetcher)
  const { builtin, imported, library } = setup()
  await library.listSongs()
  const song = (await builtin.getSong('harvest-time'))!
  expect(song.duet).toBeUndefined()
  const pdf = await library.getOriginalScore(song.originalScore!.storageId)
  expect(await pdf.text()).toBe('%PDF-reference')
  expect(fetcher).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}scores/harvest-time-original.pdf`)
  expect(imported.getOriginalScore).not.toHaveBeenCalled()
})

it('a failed built-in PDF stays an explicit reference error, never a different personal PDF', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
  const { imported, library } = setup()
  await expect(library.getOriginalScore('builtin:harvest-time:original')).rejects.toThrow('原譜を読み込めません')
  expect(imported.getOriginalScore).not.toHaveBeenCalled()
})

it('personal PDF references still use IndexedDB; unknown built-in IDs cannot create arbitrary fetches', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const { builtin, imported, library } = setup()
  expect(await (await library.getOriginalScore('personal-ref')).text()).toBe('personal PDF')
  expect(imported.getOriginalScore).toHaveBeenCalledWith('personal-ref')
  await expect(builtin.getOriginalScore('toString')).rejects.toThrow('原譜が見つかりません')
  expect(fetcher).not.toHaveBeenCalled()
})

it('built-in references cannot be removed or overwritten in personal storage', async () => {
  const { imported, library } = setup()
  await expect(library.deleteOriginalScore('harvest-time')).rejects.toThrow('内蔵曲は変更できません')
  expect(imported.deleteOriginalScore).not.toHaveBeenCalled()
})
