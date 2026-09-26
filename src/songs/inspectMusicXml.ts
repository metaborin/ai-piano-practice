import type { Compatibility, Song } from './Song'

export const COMPATIBILITY_VERSION = 1
export const MAX_PRACTICE_NOTES = 1000
export const MAX_PRACTICE_MEASURES = 500

/** Basic validity and practice support are separate: unsupported scores remain intact. */
export function inspectMusicXml(xml: string, fileName = '') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('MusicXMLの形式が正しくありません。XMLが壊れています。')
  const root = doc.documentElement.localName
  if (root !== 'score-partwise' && root !== 'score-timewise') throw new Error('MusicXMLではないXMLです。score-partwise または score-timewise が必要です。')
  if (!doc.querySelector('part')) throw new Error('MusicXMLにpartがありません。')
  if (!doc.querySelector(root === 'score-partwise' ? 'part > measure' : 'measure > part')) throw new Error('MusicXMLにmeasureがありません。')
  const text = (selector: string) => doc.querySelector(selector)?.textContent?.trim() ?? ''
  const title = text('work > work-title') || text('movement-title') || fileName.replace(/\.[^.]+$/, '') || '無題'
  const composer = [...doc.querySelectorAll('identification > creator[type="composer"]')].map((node) => node.textContent?.trim()).filter(Boolean).join(' / ')
  const reasons: string[] = []
  const notes = [...doc.querySelectorAll('part note')]
  const voices = new Set(notes.map((note) => note.querySelector('voice')?.textContent?.trim() || '1'))
  if (root === 'score-timewise') reasons.push('score-timewise形式')
  if (root === 'score-partwise' && doc.querySelectorAll('score-partwise > part').length !== 1) reasons.push('複数パート')
  if (voices.size > 1) reasons.push('複数声部')
  if ([...doc.querySelectorAll('staves, note > staff')].some((node) => Number(node.textContent) !== 1)) reasons.push('複数Staff')
  const unsupported: [string, string][] = [
    ['chord', '和音'], ['rest', '休符'], ['grace, cue', '装飾音・小音符'], ['tie, tied', 'タイ'],
    ['repeat, ending, segno, coda, sound[da-capo], sound[dal-segno], sound[dacapo], sound[dalsegno], sound[tocoda], sound[fine]', '反復・演奏順の指定'],
    ['backup, forward', '声部・時刻の移動'], ['transpose, octave-shift', '移調・オクターブ移動'],
    ['unpitched', '打楽器音'], ['time-modification, tremolo', '連符・トレモロ'],
    ['image, credit-image, part-link, link', '画像・外部参照'],
  ]
  for (const [selector, reason] of unsupported) if (doc.querySelector(selector)) reasons.push(reason)
  const pitchedNoteCount = doc.querySelectorAll('part note > pitch').length
  if (pitchedNoteCount === 0) reasons.push('練習対象の音がありません')
  if (notes.length > MAX_PRACTICE_NOTES || doc.querySelectorAll('measure').length > MAX_PRACTICE_MEASURES) reasons.push('表示上限（1000音・500小節）を超える楽譜')
  // External/internal entities and embedded external assets are never passed to OSMD.
  if (/<!ENTITY\s/i.test(xml)) reasons.push('XMLエンティティ定義')
  return { title, composer, reasons, pitchedNoteCount }
}

/** Recheck structure on every read. Versioned OSMD results are hints, never play authorization. */
export function recheckCompatibility(song: Song): Song {
  if (song.source !== 'imported' || song.musicXml.type !== 'text') return song
  let compatibility: Compatibility
  try {
    const { reasons } = inspectMusicXml(song.musicXml.value, song.originalFileName)
    compatibility = reasons.length > 0
      ? { status: 'unsupported', version: COMPATIBILITY_VERSION, reasons }
      : song.compatibility?.version === COMPATIBILITY_VERSION
        ? song.compatibility
        : { status: 'unknown', version: COMPATIBILITY_VERSION, reasons: [] }
  } catch (error) {
    compatibility = { status: 'unsupported', version: COMPATIBILITY_VERSION, reasons: [error instanceof Error ? error.message : 'MusicXMLを検証できませんでした。'] }
  }
  return { ...song, compatibility }
}

export function compatibilityLabel(song: Song) {
  if (song.compatibility?.status === 'unsupported') return '現在の練習機能では未対応'
  if (song.compatibility?.status === 'supported') return '練習可能（選択時にも再確認）'
  return '未確認（選択時に確認）'
}
