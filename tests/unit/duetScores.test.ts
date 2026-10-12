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
    expect(Math.min(...primo.notes.map(n=>n.midiNote))).toBe(69)
    expect(Math.max(...primo.notes.map(n=>n.midiNote))).toBe(81)
    expect(Math.min(...primo.notes.map(n=>n.midiNote))).toBeGreaterThan(Math.max(...secondo.notes.map(n=>n.midiNote)))
    for (const mode of ['right','both'] as const) {
      const plan = createPracticePlan(primo, mode)!
      expect(plan.targets.length).toBeGreaterThan(0)
      expect(plan.sequence.occurrences).toHaveLength(version === 'once' ? 118 : 218)
      expect(plan.sequence.playback.measures).toHaveLength(version === 'once' ? 30 : 56)
      expect(buildDemoPlan(plan).length).toBeGreaterThan(0)
    }
  })
  it('retains the recognizable theme and its rhythm in all three sections', () => {
    const primo = parseXml(xml('primo', version))
    const bar = (number: number) => primo.notes.filter(n => n.measureNumber === String(number)).map(n => [n.midiNote, n.durationBeats])
    // A: ascending minor phrase; B: repeated high tonic; C: descending chorus.
    // These acceptance motifs prevent another unrelated chord-tone melody from passing.
    expect(bar(5)).toEqual([[69,1],[71,1],[72,0.5],[71,0.5],[69,1]])
    expect(bar(6)).toEqual([[72,1],[74,1],[76,1.5],[74,0.5]])
    expect(bar(13)).toEqual([[81,1],[81,1],[81,1],[81,1]])
    expect(bar(21)).toEqual([[79,2],[79,2]])
    expect(bar(23)).toEqual([[79,1],[79,1],[77,0.5],[76,0.5],[74,1]])
    expect(bar(1)).toEqual(bar(27))
    expect(bar(2)).toEqual(bar(28))
    expect(bar(3)).toEqual(bar(29))
    expect(bar(4)).toEqual(bar(30))
    // E -> Am cadence in the existing accompaniment, with G# as leading tone.
    expect(bar(12)).toEqual([[76,1],[80,1],[81,2]])
    expect(bar(30)).toEqual([[72,1],[71,1],[69,2]])
    const plan = createPracticePlan(primo, 'right')!
    const demo = buildDemoPlan(plan)
    expect(demo.filter(n => n.startMs >= 16*60000/232 && n.startMs < 20*60000/232).map(n => n.midiNote)).toEqual([69,71,72,71,69])
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
