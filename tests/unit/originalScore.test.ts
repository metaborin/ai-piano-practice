import { describe, expect, it } from 'vitest'
import { MAX_ORIGINAL_SCORE_SIZE, readOriginalScoreFile, validateOriginalScoreFile } from '../../src/songs/readOriginalScoreFile'

describe('reference file validation without musical interpretation', () => {
  for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.JPG', 'image/jpeg'], ['a.jpeg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp']]) {
    it('accepts extension/MIME ' + name, () => expect(validateOriginalScoreFile({ name, type, size: 20 })).toBe(type))
  }
  it('normalizes empty or generic MIME from Chrome file pickers', () => {
    expect(validateOriginalScoreFile({ name: 'a.pdf', type: '', size: 20 })).toBe('application/pdf')
    expect(validateOriginalScoreFile({ name: 'a.png', type: 'application/octet-stream', size: 20 })).toBe('image/png')
  })
  for (const [name, type] of [['a.svg', 'image/svg+xml'], ['a.pdf', 'image/png'], ['a.png.exe', 'image/png']]) {
    it('rejects unsupported/mismatched ' + name, () => expect(() => validateOriginalScoreFile({ name, type, size: 20 })).toThrow('PDFまたは画像'))
  }
  it('bounds bytes at 30 MiB and rejects empty files', () => {
    expect(validateOriginalScoreFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_ORIGINAL_SCORE_SIZE })).toBe('application/pdf')
    expect(() => validateOriginalScoreFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_ORIGINAL_SCORE_SIZE + 1 })).toThrow('30 MB')
    expect(() => validateOriginalScoreFile({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toThrow('空')
  })
  it('preserves original bytes and creates complete serializable metadata', async () => {
    const file = new File(['%PDF-1.7\nexample'], 'my.pdf', { type: '' })
    const first = await readOriginalScoreFile(file), next = await readOriginalScoreFile(file)
    expect(await first.blob.text()).toBe(await file.text())
    expect(first.metadata).toMatchObject({ type: 'pdf', fileName: 'my.pdf', mimeType: 'application/pdf', size: file.size })
    expect(first.metadata.createdAt).toBeGreaterThan(0)
    expect(first.metadata.storageId).not.toBe(next.metadata.storageId)
    expect(structuredClone(first.metadata)).toEqual(first.metadata)
  })
  it('rejects a renamed file before persistence', async () => {
    await expect(readOriginalScoreFile(new File(['<script>bad</script>'], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow('内容')
  })
  it('reports inaccessible file bytes before any persistence', async () => {
    const file = new File(['%PDF-1.7'], 'missing.pdf', { type: 'application/pdf' })
    file.slice = () => { const blob = new Blob(); blob.arrayBuffer = async () => { throw new Error('unreadable') }; return blob }
    await expect(readOriginalScoreFile(file)).rejects.toThrow('読み込めませんでした')
  })
})
