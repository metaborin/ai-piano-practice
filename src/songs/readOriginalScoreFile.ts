import type { OriginalScoreAttachment } from './OriginalScoreRepository'

export const MAX_ORIGINAL_SCORE_SIZE = 30 * 1024 * 1024
export const ORIGINAL_SCORE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const types: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export function validateOriginalScoreFile(file: Pick<File, 'name' | 'type' | 'size'>): string {
  const mime = types[file.name.split('.').pop()?.toLowerCase() ?? '']
  if (!mime || (file.type && file.type !== mime && file.type !== 'application/octet-stream')) throw new Error('PDFまたは画像ファイル（JPG・PNG・WEBP）を選択してください。拡張子とファイル形式も確認してください。')
  if (file.size > MAX_ORIGINAL_SCORE_SIZE) throw new Error('元の楽譜は30 MB以下のファイルを選択してください。')
  if (file.size === 0) throw new Error('ファイルが空です。別のファイルを選択してください。')
  return mime
}
export async function readOriginalScoreFile(file: File): Promise<OriginalScoreAttachment> {
  const mimeType = validateOriginalScoreFile(file)
  let bytes: Uint8Array
  try { bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer()) }
  catch { throw new Error('元の楽譜ファイルを読み込めませんでした。もう一度選択してください。') }
  const text = String.fromCharCode(...bytes)
  const valid = mimeType === 'application/pdf' ? text.startsWith('%PDF-')
    : mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mimeType === 'image/png' ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
    : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP'
  if (!valid) throw new Error('ファイルの内容がPDF・画像の形式と一致しません。別のファイルを選択してください。')
  return {
    metadata: { type: mimeType === 'application/pdf' ? 'pdf' : 'image', fileName: file.name, mimeType, size: file.size, createdAt: Date.now(), storageId: crypto.randomUUID() },
    // Preserve bytes/resolution, normalizing only the MIME type for the viewer.
    blob: file.slice(0, file.size, mimeType),
  }
}
export const originalScoreSize = (size: number) => `${(size / (1024 * 1024)).toFixed(2)} MB`
