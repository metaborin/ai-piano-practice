import { readFileSync } from 'node:fs'
import { DOMParser } from '@xmldom/xmldom'
import { parseMusicXml } from '../../src/score/parseMusicXml'

export const fixture = (name: string) => readFileSync(new URL('../fixtures/timeline/' + name + '.musicxml', import.meta.url), 'utf8')
export function parseXml(musicXml: string) {
  const document = new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message) } }).parseFromString(musicXml, 'application/xml')
  return parseMusicXml({ id: 'test', title: 'test', partLabel: '', musicXml }, document as unknown as Document)
}
export const parseFixture = (name: string) => parseXml(fixture(name))
export const noteXml = (step = 'C', duration = 1, extra = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`
export const scoreXml = (body: string, divisions = '1') => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions></attributes>${body}</measure></part></score-partwise>`
