import { parseMusicXml } from './parseMusicXml'

/** Parse support is independent of the current practice mode. */
export function validateMusicXml(xml: string): void {
  parseMusicXml({ id: 'validation', title: '', partLabel: '', musicXml: xml })
}
