import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { extractBounded } from '../../src/songs/readSongFile'

describe('bounded MXL extraction', () => {
  it('accepts an entry at the exact byte limit', async () => {
    const zip = new JSZip().file('score.xml', 'abc')
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
    expect(new TextDecoder().decode(await extractBounded(loaded.file('score.xml')!, 3))).toBe('abc')
  })
  it('stops decompression of an oversized entry', async () => {
    const zip = new JSZip().file('score.xml', 'x'.repeat(2 * 1024 * 1024))
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
    await expect(extractBounded(loaded.file('score.xml')!, 10000)).rejects.toThrow('大きすぎます')
  })
})
