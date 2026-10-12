import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { afterEach, expect, it, vi } from 'vitest'
import { parseXml } from './xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { PracticeSession } from '../../src/practice/PracticeSession'

const xml = readFileSync(new URL('../../src/scores/harvest-time.musicxml', import.meta.url), 'utf8')
const score = parseXml(xml)
const notes = (measure: number, staff: number) => score.notes.filter(n => n.measureNumber === String(measure) && n.staff === staff)
afterEach(() => vi.useRealTimers())

it('the supplied solo score has 57 complete 6/8 bars, two staves, and no invented repeat', () => {
  expect(xml).toContain('<beats>6</beats>')
  expect(xml).toContain('<beat-type>8</beat-type>')
  expect(xml).toContain('<fifths>1</fifths>')
  expect(xml).toContain('<beat-unit-dot')
  expect(score).toMatchObject({ staffCount: 2, voices: ['1', '2'], totalBeats: 171, tempoBpm: 108, practiceCompatibility: 'pitchPractice', warnings: [] })
  expect(score.measures).toHaveLength(57)
  expect(score.measures.every((m, i) => m.number === String(i + 1) && m.onsetBeats === i * 3 && m.durationBeats === 3)).toBe(true)
  expect(score.navigation).toEqual({ repeats: [], reasons: [] })
  expect(score.notes).toHaveLength(529)
  expect(notes(1, 1).map(n => [n.midiNote, n.durationBeats])).toEqual([[67, 1], [69, 0.5], [71, 1]])
  expect(notes(1, 2).map(n => n.midiNote)).toEqual([55, 59, 62, 55, 59, 62])
  expect(notes(57, 1).map(n => n.midiNote)).toEqual([59, 67])
  expect(notes(57, 2).map(n => n.midiNote)).toEqual([43, 50])
  expect(Math.max(...score.notes.map(n => n.midiNote))).toBe(91)
})

it('retains the printed chromatic melody and natural cancellations instead of inferring every F as sharp', () => {
  expect(notes(5, 1).map(n => n.midiNote)).toEqual([74, 68, 69])
  expect(notes(6, 1).map(n => n.midiNote)).toEqual([74, 70, 71])
  expect(notes(7, 1).map(n => n.midiNote)).toEqual([69, 73, 74, 76, 78, 76])
  expect(notes(47, 1).map(n => n.midiNote)).toEqual([83, 82, 83, 86, 84, 81])
  expect(notes(49, 1).map(n => n.midiNote)).toEqual([71, 70, 71, 74, 72, 69])
  for (const bar of [40, 43]) expect(notes(bar, 2).at(-1)?.midiNote).toBe(65)
})

it('written returns are present in the XML, and the five ties sustain without another attack', () => {
  for (let bar = 1; bar <= 15; bar++) for (const staff of [1, 2]) {
    expect(notes(bar + 24, staff).map(n => [n.midiNote, n.durationBeats])).toEqual(notes(bar, staff).map(n => [n.midiNote, n.durationBeats]))
  }
  const plan = createPracticePlan(score, 'right')!
  for (const [bar, pitch, beats] of [[16, 67, 2.5], [51, 74, 2], [53, 74, 2], [54, 74, 1], [55, 74, 1]]) {
    const start = notes(bar, 1).find(n => n.midiNote === pitch)!
    const tied = notes(bar, 1).find(n => n.tieStop)!
    expect(start.tieStart).toBe(true)
    expect(plan.targets.some(t => t.onsetBeats === tied.onsetBeats)).toBe(false)
    const event = buildDemoPlan(plan).find(n => n.midiNote === pitch && Math.abs(n.startMs - start.onsetBeats * 60_000 / 108) < 0.001)!
    expect(event.durationMs).toBeCloseTo(beats * 60_000 / 108, 6)
  }
  expect(buildDemoPlan(createPracticePlan(score, 'both')!)).toHaveLength(524)
})

it.each([
  { mode: 'right' as const, steps: 225, attacks: 227, first: [67] },
  { mode: 'left' as const, steps: 268, attacks: 297, first: [55] },
  { mode: 'both' as const, steps: 331, attacks: 524, first: [55, 67] },
])('$mode uses that hand for both grading and demo, and finishes the whole piece', ({ mode, steps, attacks, first }) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const plan = createPracticePlan(score, mode)!, demo = buildDemoPlan(plan)
  expect(plan.targets).toHaveLength(steps)
  expect(plan.sequence.playback.measures).toHaveLength(57)
  expect(demo).toHaveLength(attacks)
  expect(demo.filter(n => n.startMs === 0).map(n => n.midiNote).sort((a, b) => a - b)).toEqual(first)
  expect(Math.max(...demo.map(n => n.startMs + n.durationMs))).toBeCloseTo(95_000, 6)
  const session = new PracticeSession()
  session.loadPlan(plan); session.start()
  const send = (pitch: number, release = false) => session.handleMidiEvent({ midiNote: pitch, type: release ? 'noteoff' : 'noteon', velocity: release ? 0 : 80, channel: 1, timestamp: performance.now() })
  send(60); send(60, true)
  expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 0, correctNoteCount: 0 })
  for (const target of plan.targets) {
    for (const pitch of target.expectedMidiNotes) send(pitch)
    for (const pitch of target.expectedMidiNotes) send(pitch, true)
  }
  expect(session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: steps, totalNotes: steps })
  session.restart()
  expect(session.getSnapshot()).toMatchObject({ status: 'practicing', currentNoteIndex: 0, correctNoteCount: 0, expectedMidiNotes: first })
  session.dispose()
})

it('the downloadable MXL contains exactly the app XML and the original PDF fits offline precaching', async () => {
  const archive = await JSZip.loadAsync(readFileSync(new URL('../../public/scores/harvest-time.mxl', import.meta.url)))
  expect(await archive.file('score.musicxml')!.async('string')).toBe(xml)
  expect(await archive.file('META-INF/container.xml')!.async('string')).toContain('score.musicxml')
  const pdf = readFileSync(new URL('../../public/scores/harvest-time-original.pdf', import.meta.url))
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.length).toBeLessThan(2 * 1024 * 1024)
  expect(pdf.length).toBe(1814114)
})
