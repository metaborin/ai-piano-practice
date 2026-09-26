import type JSZip from 'jszip'
import { inspectMusicXml } from './inspectMusicXml'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_XML_BYTES = 10 * 1024 * 1024
export const MAX_CONTAINER_BYTES = 64 * 1024
export const MAX_ZIP_ENTRIES = 1024

// JSZip's documented browser streaming API is not included in its 3.10 typings.
type ByteStream = {
  on(event: 'data', callback: (chunk: Uint8Array) => void): ByteStream
  on(event: 'error', callback: (error: Error) => void): ByteStream
  on(event: 'end', callback: () => void): ByteStream
  pause(): ByteStream
  resume(): ByteStream
}

/** Bound decompression while streaming, before accumulating a full ZIP bomb. */
export function extractBounded(entry: JSZip.JSZipObject, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): ByteStream }).internalStream('uint8array')
    let chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      stream.pause()
      chunks = []
      reject(error)
    }
    stream.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) { fail(new Error('展開後のファイルサイズが大きすぎます。')); return }
      chunks.push(chunk)
    }).on('error', () => fail(new Error('MXLを展開できませんでした。ファイルが壊れている可能性があります。'))).on('end', () => {
      if (settled) return
      settled = true
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      chunks = []
      resolve(bytes)
    }).resume()
  })
}

function decodeXml(bytes: Uint8Array) {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { throw new Error('XMLの文字コードを読み込めませんでした。UTF-8またはBOM付きUTF-16で保存してください。') }
}

export async function readSongFile(file: File) {
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (!extension || !['musicxml', 'xml', 'mxl'].includes(extension)) throw new Error('対応していない拡張子です。.musicxml / .xml / .mxl を選んでください。')
  if (file.size > MAX_FILE_BYTES) throw new Error('ファイルサイズが大きすぎます。10 MiB以下のファイルを選んでください。')
  let buffer: ArrayBuffer
  try { buffer = await file.arrayBuffer() }
  catch { throw new Error('ファイルを読み込めませんでした。もう一度選択してください。') }
  let musicXml: string
  const fileFormat = extension === 'mxl' ? 'mxl' as const : 'musicxml' as const
  if (fileFormat === 'musicxml') musicXml = decodeXml(new Uint8Array(buffer))
  else {
    const { default: Zip } = await import('jszip')
    let archive: JSZip
    try {
      // checkCRC32 eagerly inflates EVERY entry; only extract the two required entries below.
      archive = await Zip.loadAsync(buffer)
    } catch { throw new Error('MXLを開けませんでした。ZIPファイルが壊れている可能性があります。') }
    if (Object.keys(archive.files).length > MAX_ZIP_ENTRIES) throw new Error('MXL内のファイル数が多すぎます（上限1024）。')
    const container = archive.file('META-INF/container.xml')
    if (!container) throw new Error('MXLにMETA-INF/container.xmlがありません。')
    const containerXml = decodeXml(await extractBounded(container, MAX_CONTAINER_BYTES))
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml')
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'container') throw new Error('MXLのcontainer.xmlが壊れています。')
    const rootfile = doc.querySelector('container > rootfiles > rootfile')
    const path = rootfile?.getAttribute('full-path')
    if (!path) throw new Error('MXLのcontainer.xmlにrootfileのfull-pathがありません。')
    if (path.startsWith('/') || /[\\:]/.test(path) || path.split('/').some((part) => part === '..' || part === '.')) throw new Error('MXLのrootfileパスが不正です。')
    const media = rootfile?.getAttribute('media-type')
    if (media && media !== 'application/vnd.recordare.musicxml+xml') throw new Error('MXLの先頭rootfileがMusicXMLではありません。')
    const body = archive.file(path)
    if (!body) throw new Error('MXLにrootfileで指定されたMusicXML本体がありません。')
    if ((body.unsafeOriginalName && body.unsafeOriginalName !== path) || (container.unsafeOriginalName && container.unsafeOriginalName !== 'META-INF/container.xml')) throw new Error('MXL内のファイルパスが不正です。')
    musicXml = decodeXml(await extractBounded(body, MAX_XML_BYTES))
  }
  return { musicXml, fileFormat, originalFileName: file.name, ...inspectMusicXml(musicXml, file.name) }
}

export type ReadSongFileResult = Awaited<ReturnType<typeof readSongFile>>
