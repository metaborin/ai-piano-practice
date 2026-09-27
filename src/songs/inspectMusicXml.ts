import type { Compatibility, Song } from './Song'
import type { ScoreModel } from '../score/ScoreModel'
import { child, descendants, readMusicXmlDocument, value } from '../score/musicXmlDocument'
import { parseMusicXml } from '../score/parseMusicXml'

export const COMPATIBILITY_VERSION = 3
export function compatibilityFromModel(model: ScoreModel): Compatibility {
  return { version: COMPATIBILITY_VERSION, status: ['simpleMelody', 'pitchPractice'].includes(model.practiceCompatibility) && model.notes.length ? 'supported' : 'unsupported',
    parseCompatibility: 'supported', practiceCompatibility: model.practiceCompatibility, reasons: model.practiceReasons }
}

/** Valid XML can be saved even when its timeline is outside the supported parser subset. */
export function inspectMusicXml(xml: string, fileName = '') {
  const doc = readMusicXmlDocument(xml)
  const root = doc.documentElement
  const work = child(root, 'work')
  const title = (work ? value(work, 'work-title') : '') || value(root, 'movement-title') || fileName.replace(/\.[^.]+$/, '') || '無題'
  const composer = descendants(doc, 'creator').filter((node) => node.getAttribute('type') === 'composer').map((node) => node.textContent?.trim()).filter(Boolean).join(' / ')
  const parts = descendants(root, 'score-part')
  const partLabel = parts.length === 1 ? value(parts[0], 'part-name') || '追加曲' : '追加曲'
  let model: ScoreModel | null = null
  let compatibility: Compatibility
  try {
    model = parseMusicXml({ id: 'inspection', title, partLabel, musicXml: xml }, doc)
    compatibility = compatibilityFromModel(model)
  } catch (error) {
    compatibility = { version: COMPATIBILITY_VERSION, status: 'unsupported', parseCompatibility: 'unsupported', practiceCompatibility: 'unsupported', reasons: [error instanceof Error ? error.message : 'MusicXMLを解析できませんでした。'] }
  }
  return { title, composer, partLabel, tempoBpm: model?.tempoBpm, model, compatibility, reasons: model ? [] : compatibility.reasons, pitchedNoteCount: model?.notes.length ?? descendants(doc, 'pitch').length }
}

/** Never migrate or delete persisted records: reanalyse XML into current in-memory metadata. */
export function recheckCompatibility(song: Song): Song {
  if (song.source !== 'imported' || song.musicXml.type !== 'text') return song
  try { return { ...song, compatibility: inspectMusicXml(song.musicXml.value, song.originalFileName).compatibility } }
  catch (error) {
    return { ...song, compatibility: { status: 'unsupported', version: COMPATIBILITY_VERSION, parseCompatibility: 'unsupported', practiceCompatibility: 'unsupported', reasons: [error instanceof Error ? error.message : 'MusicXMLを検証できませんでした。'] } }
  }
}

export function compatibilityLabel(song: Song) {
  if (song.compatibility?.practiceCompatibility === 'pitchPractice' && song.compatibility.status === 'supported') return '音程練習対応（選択時にも再確認）'
  if (song.compatibility?.parseCompatibility === 'supported' && song.compatibility.practiceCompatibility === 'polyphonicPending') return '解析可能・練習は次Phase（2E-C2対応予定）'
  if (song.compatibility?.status === 'unsupported') return '現在の練習機能では未対応'
  if (song.compatibility?.status === 'supported') return '練習可能（選択時にも再確認）'
  return '未確認（選択時に確認）'
}
