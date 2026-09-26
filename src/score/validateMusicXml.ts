import { inspectMusicXml } from '../songs/inspectMusicXml'

/** Validate the supported subset before OSMD's tolerant importer can drop elements. */
export function validateMusicXml(xml: string): void {
  const { reasons, pitchedNoteCount } = inspectMusicXml(xml)
  if (pitchedNoteCount === 0) throw new Error('練習対象の音がありません。')
  if (reasons.length > 0) throw new Error('この楽譜は未対応です：' + reasons.join('、') + '。休符・和音・反復のない1パート・1声部・1Staffの単旋律を使用してください。')
}
