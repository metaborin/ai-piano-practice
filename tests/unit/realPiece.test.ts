import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { inspectMusicXml, recheckCompatibility } from '../../src/songs/inspectMusicXml'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { millisecondsAtBeat, resolveTempo } from '../../src/audio/tempo'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { SongSelection } from '../../src/score/SongSelection'
import { createValidationReport } from '../../src/score/validationReport'
import type { Song } from '../../src/songs/Song'
import { fixture, parseFixture, parseXml, scoreXml, noteXml } from './xmlFixture'

beforeEach(() => { vi.stubGlobal('DOMParser', DOMParser); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const xml = fixture('i-piece-validation')
const song: Song = { id: 'test', title: '実曲相当検証', partLabel: 'SECONDO', source: 'imported', musicXml: { type: 'text', value: xml }, tempoBpm: 80,
  originalScore: { type: 'pdf', storageId: 'unchanged-pdf-reference', fileName: 'original.pdf' } }

it('extracts title, composer, SECONDO and tempo 116 from the XML without modifying it', () => {
  const result = inspectMusicXml(xml)
  expect(result).toMatchObject({ title: 'D1検証用オリジナル（実曲ではありません）', composer: 'アプリ検証用', partLabel: 'SECONDO', tempoBpm: 116 })
  expect(result.model?.musicXml).toBe(xml)
  const before = structuredClone(song), updated = recheckCompatibility(song)
  expect(updated.originalScore).toEqual(before.originalScore)
  expect(updated.tempoBpm).toBe(80)
  expect(song).toEqual(before)
})

it('MusicXML wins over Song tempo, while metadata 116 and default 100 are separate fallbacks', () => {
  expect(resolveTempo(parseFixture('i-piece-validation'), 80)[0]).toMatchObject({ bpm: 116, source: 'MusicXML' })
  const noTempo = parseFixture('a-simple')
  expect(resolveTempo(noTempo, 116)[0]).toMatchObject({ bpm: 116, source: 'Song metadata' })
  expect(resolveTempo(noTempo)[0]).toMatchObject({ bpm: 100, source: 'default' })
  expect(millisecondsAtBeat(resolveTempo(noTempo, 116), 1)).toBeCloseTo(517.24137931, 7)
  expect(millisecondsAtBeat(resolveTempo(noTempo), 1)).toBe(600)
})

it.each([0, -10, NaN, Infinity])('invalid metadata tempo %s uses the default', (bpm) => {
  expect(resolveTempo(parseFixture('a-simple'), bpm)[0].bpm).toBe(100)
})

it('reads metronome-only and dotted beat units in quarter-note BPM; invalid XML tempo falls back', () => {
  const metronomeOnly = xml.replace('<sound tempo="116"/>', '')
  expect(resolveTempo(parseXml(metronomeOnly), 80)[0].bpm).toBe(116)
  const dotted = metronomeOnly.replace('<beat-unit>quarter</beat-unit><per-minute>116</per-minute>', '<beat-unit>half</beat-unit><beat-unit-dot/><per-minute>60</per-minute>')
  expect(resolveTempo(parseXml(dotted))[0].bpm).toBe(180)
  expect(resolveTempo(parseXml(xml.replace('tempo="116"', 'tempo="0"')), 80)[0]).toMatchObject({ bpm: 116, source: 'MusicXML' })
  const invalid = parseXml(xml.replace('tempo="116"', 'tempo="0"').replace('<per-minute>116</per-minute>', '<per-minute>bad</per-minute>'))
  expect(resolveTempo(invalid, 116)[0]).toMatchObject({ bpm: 116, source: 'Song metadata' })
  expect(invalid.warnings.some((warning) => warning.code === 'tempo')).toBe(true)
})

it('integrates changes across a sustained note; a later mark never changes earlier timing', () => {
  const score = parseXml(scoreXml(noteXml('C', 4) + '<direction><offset>-2</offset><sound tempo="120"/></direction>'))
  const timeline = resolveTempo(score, 60)
  expect(timeline.map(({ bpm, beat }) => [beat, bpm])).toEqual([[0, 60], [2, 120]])
  const note = buildDemoPlan(createPracticePlan(score, 'both', 60)!)[0]
  expect(note.durationMs).toBe(3000)
  expect(note.noteOffMs).toBe(2800)
  expect(millisecondsAtBeat(timeline, 1)).toBe(1000)
})

it.each([['right', 7], ['left', 5], ['both', 9]] as const)('%s plan uses original measure numbers and selected staff for %s steps', (mode, count) => {
  const model = parseFixture('i-piece-validation'), plan = createPracticePlan(model, mode)!
  expect(plan.targets).toHaveLength(count)
  expect([...new Set(plan.targets.map((target) => target.measureNumber))]).toEqual(['5', '6', '7', '8'])
  expect(plan.targets.every((target) => target.sourceNotes.every((note) => mode === 'both' || note.staff === (mode === 'right' ? 1 : 2)))).toBe(true)
  const demo = buildDemoPlan(plan)
  for (const note of demo) expect(note.startMs).toBeCloseTo(plan.targets[note.index].onsetBeats * 60_000 / 116, 7)
  expect(demo.filter((note) => note.startMs === 0).every((note) => plan.targets[0].expectedMidiNotes.includes(note.midiNote))).toBe(true)
})

it('SongSelection passes metadata tempo through both initial loading and mode changes', async () => {
  const model = parseXml(xml.replace(/<direction>.*?<\/direction>/s, ''))
  const withTempo: Song = { ...song, musicXml: { type: 'text', value: model.musicXml }, tempoBpm: 116 }
  const apply = vi.fn(), selection = new SongSelection(null, { reset: vi.fn(), apply, obtain: async () => model.musicXml })
  await selection.select(withTempo)
  selection.ready(selection.getSnapshot().requestId, model)
  expect(apply.mock.lastCall![0].songTempoBpm).toBe(116)
  selection.setMode('left')
  const plan = apply.mock.lastCall![0]
  expect(plan.songTempoBpm).toBe(116)
  expect(buildDemoPlan(plan)[1].noteOffMs).toBeCloseTo(1.8 * 60_000 / 116, 7)
})

it('DemoPlayer sends simultaneous chords at 116 BPM and cancels the remaining piece on stop', () => {
  const output = { beginDemo: () => true, playDemoNote: vi.fn(() => true), finishDemo: vi.fn(), stopAllNotes: vi.fn(), subscribeDemoInterrupted: () => () => {} }
  const player = new DemoPlayer(output), plan = createPracticePlan(parseFixture('i-piece-validation'), 'both', 80)!
  player.loadPlan(plan); player.start()
  expect(output.playDemoNote.mock.calls).toHaveLength(4)
  expect(output.playDemoNote.mock.calls.map((args) => (args as unknown as number[])[1])).toEqual([0, 0, 0, 0])
  vi.advanceTimersByTime(518)
  expect(output.playDemoNote.mock.lastCall).toEqual([74, 60_000 / 116, 1.9 * 60_000 / 116])
  player.stop()
  expect(output.stopAllNotes).toHaveBeenCalledOnce()
  const count = output.playDemoNote.mock.calls.length
  vi.advanceTimersByTime(20000)
  expect(output.playDemoNote).toHaveBeenCalledTimes(count)
})

it('validation reports actual XML scope, polyphony, rests, ties, plans and effective tempo', () => {
  const report = createValidationReport(parseFixture('i-piece-validation'), 80)
  expect(report).toMatchObject({ supported: true, label: '音程練習対応', measures: { first: '5', last: '8', count: 4 },
    chordMoments: 6, tieNotes: 2, steps: { right: 7, left: 5, both: 9 } })
  expect(report.tempo![0]).toMatchObject({ bpm: 116, source: 'MusicXML' })
})

it.each(['<arpeggiate/>', '<ornaments><trill-mark/></ornaments>', '<tuplet type="start"/>'])('unsupported or rendering-failed scores never get a successful report: %s', (notation) => {
  let modified = xml.replace('</note>', `<notations>${notation}</notations></note>`)
  if (notation.includes('tuplet')) modified = modified.replace('</note>', '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>')
  const result = inspectMusicXml(modified)
  expect(createValidationReport(result.model, result.tempoBpm, result.compatibility).supported).toBe(false)
  expect(createPracticePlan(result.model!)).toBeNull()
  expect(createValidationReport(parseFixture('i-piece-validation'), 80, undefined, 'OSMD表示失敗').supported).toBe(false)
})

it('unparsed Grace Note and multiple Parts report reasons without fabricated score counts', () => {
  for (const modified of [xml.replace('<note>', '<note><grace/>'), xml.replace('</score-partwise>', '<part id="P2"><measure number="1"/></part></score-partwise>')]) {
    const result = inspectMusicXml(modified), report = createValidationReport(result.model, undefined, result.compatibility)
    expect(report.supported).toBe(false)
    expect(report.measures).toBeNull()
    expect(report.reasons.length).toBeGreaterThan(0)
  }
})
