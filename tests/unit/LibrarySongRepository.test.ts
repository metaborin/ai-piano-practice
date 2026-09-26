import { expect, it, vi } from 'vitest'
import { BuiltInSongRepository } from '../../src/songs/BuiltInSongRepository'
import { IndexedDbSongRepository } from '../../src/songs/IndexedDbSongRepository'
import { LibrarySongRepository } from '../../src/songs/LibrarySongRepository'
import type { ImportedSong } from '../../src/songs/Song'

it('blocks attempts to delete or overwrite a built-in song at the repository boundary', async () => {
  const imported = { listSongs: async () => [], getSong: async () => undefined, addSong: vi.fn(), deleteSong: vi.fn() }
  const repository = new LibrarySongRepository(new BuiltInSongRepository(), imported)
  await expect(repository.deleteSong('twinkle-opening')).rejects.toThrow('内蔵曲は削除できません')
  await expect(repository.addSong({ id: 'twinkle-opening' } as ImportedSong)).rejects.toThrow('内蔵曲は変更できません')
  expect(imported.addSong).not.toHaveBeenCalled()
  expect(imported.deleteSong).not.toHaveBeenCalled()
  await expect(new IndexedDbSongRepository().deleteSong('twinkle-opening')).rejects.toThrow('内蔵曲は削除できません')
})

it('returns built-in songs and an actionable warning if personal storage fails', async () => {
  const imported = { listSongs: async () => { throw new Error('IDB unavailable') }, getSong: async () => undefined, addSong: vi.fn(), deleteSong: vi.fn() }
  const repository = new LibrarySongRepository(new BuiltInSongRepository(), imported)
  expect(await repository.listSongs()).toHaveLength(3)
  expect(repository.getStorageError()).toContain('内蔵曲は利用できます')
  expect((await repository.getSong('twinkle-opening'))?.title).toBe('きらきら星')
})
