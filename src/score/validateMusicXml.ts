/** Validate the supported subset before OSMD's tolerant importer can drop elements. */
export function validateMusicXml(xml: string): void {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'score-partwise') {
    throw new Error('MusicXMLの形式が正しくありません。')
  }
  if (!doc.querySelector('part note pitch')) throw new Error('練習対象の音がありません。')
  const voices = new Set([...doc.querySelectorAll('note')].map((note) => note.querySelector('voice')?.textContent ?? '1'))
  if (doc.querySelectorAll('score-partwise > part').length !== 1 || voices.size !== 1 ||
      doc.querySelector('chord, rest, grace, tie, tied, repeat, ending, backup, forward') ||
      [...doc.querySelectorAll('staves')].some((node) => Number(node.textContent) !== 1)) {
    throw new Error('この楽譜は未対応です。休符・和音・反復のない1パートの単旋律を使用してください。')
  }
}
