import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { parseXml, fixture } from './xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'

const xml = (part: string, version: string) => readFileSync(new URL(`../../src/scores/duet/maim-maim-${part}-${version}.musicxml`, import.meta.url), 'utf8')
describe.each(['once', 'original'])('PRIMO stage 1: %s', version => {
  it('preserves SECONDO and aligns every measure, tempo and navigation', () => {
    const primo = parseXml(xml('primo', version)), secondo = parseXml(xml('secondo', version))
    expect(xml('secondo', version)).toBe(fixture('maim-maim-full-' + version))
    expect(primo.measures.map(m => [m.number, m.onset, m.duration])).toEqual(secondo.measures.map(m => [m.number, m.onset, m.duration]))
    expect(primo.measures).toHaveLength(30)
    expect(primo.navigation).toEqual(secondo.navigation)
    expect(primo.tempos).toEqual(secondo.tempos)
    expect(primo.tempoBpm).toBe(232)
    expect(primo.practiceCompatibility).toBe('pitchPractice')
    expect(Math.min(...primo.notes.map(n=>n.midiNote))).toBe(68)
    expect(Math.max(...primo.notes.map(n=>n.midiNote))).toBe(83)
    expect(Math.min(...primo.notes.map(n=>n.midiNote))).toBeGreaterThan(Math.max(...secondo.notes.map(n=>n.midiNote)))
    for (const mode of ['right','both'] as const) {
      const plan = createPracticePlan(primo, mode)!
      expect(plan.targets.length).toBeGreaterThan(0)
      expect(plan.sequence.playback.measures).toHaveLength(version === 'once' ? 30 : 56)
      expect(buildDemoPlan(plan).length).toBeGreaterThan(0)
    }
  })
  it('exports compressed PRIMO from exactly the same XML and a two-part check score', async () => {
    const zip = await JSZip.loadAsync(readFileSync(new URL(`../../public/duet-scores/maim-maim-primo-${version}.mxl`, import.meta.url)))
    expect(await zip.file('score.musicxml')!.async('string')).toBe(xml('primo', version))
    const full = readFileSync(new URL(`../../public/duet-scores/maim-maim-full-score-${version}.musicxml`, import.meta.url), 'utf8')
    const doc = new DOMParser().parseFromString(full, 'application/xml')
    expect(Array.from(doc.getElementsByTagName('part')).map(p => p.getAttribute('id'))).toEqual(['P1','P2'])
    expect(doc.getElementsByTagName('measure').length).toBe(60)
  })
})
