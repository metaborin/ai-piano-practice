/** DOM Level 2 helpers work with browser DOMParser and the test-only XML DOM. */
export function children(node: Node, name?: string): Element[] {
  return Array.from(node.childNodes).filter((node): node is Element => node.nodeType === 1 && (!name || (node as Element).localName === name))
}
export const child = (node: Node, name: string) => children(node, name)[0]
export const value = (node: Node, name: string) => child(node, name)?.textContent?.trim() ?? ''
export function descendants(node: Document | Element, name: string) {
  return Array.from(node.getElementsByTagName('*')).filter((element) => element.localName === name)
}
export function readMusicXmlDocument(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (!doc.documentElement || descendants(doc, 'parsererror').length) throw new Error('MusicXMLの形式が正しくありません。XMLが壊れています。')
  const root = doc.documentElement.localName
  if (root !== 'score-partwise' && root !== 'score-timewise') throw new Error('MusicXMLではないXMLです。score-partwise または score-timewise が必要です。')
  if (!descendants(doc, 'part').length) throw new Error('MusicXMLにpartがありません。')
  if (!descendants(doc, 'measure').length) throw new Error('MusicXMLにmeasureがありません。')
  return doc
}
