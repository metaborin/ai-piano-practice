import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Beat } from '../../src/score/Beat'
import { expectedMidiSet, toPracticeScore } from '../../src/score/toPracticeScore'
import { buildDemoNotes } from '../../src/audio/DemoPlayer'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { fixture, noteXml, parseFixture, parseXml, scoreXml } from './xmlFixture'

describe('MusicXML normalized timeline', () => {
  it('A: three single notes are three moments with normalized durations and default staff/voice', () => {
    const score = parseFixture('a-simple')
    expect(score.moments.map((moment) => [moment.onsetBeats, moment.notes.map((note) => note.midiNote)])).toEqual([[0, [60]], [1, [62]], [2, [64]]])
    expect(score.notes.map((note) => note.durationBeats)).toEqual([1, 1, 1])
    expect(score.staffCount).toBe(1); expect(score.voices).toEqual(['1']); expect(score.totalBeats).toBe(3)
    expect(score.practiceCompatibility).toBe('simpleMelody')
  })
  it('B: C-E-G is one moment; chord notes never advance time', () => {
    const score = parseFixture('b-chord')
    expect(score.moments).toHaveLength(1)
    expect(score.moments[0].notes.map((note) => note.midiNote)).toEqual([60, 64, 67])
    expect(score.notes.map((note) => note.onsetBeats)).toEqual([0, 0, 0])
    expect(score.totalBeats).toBe(1)
    expect(toPracticeScore(score)).toBeNull()
    const next = parseXml(fixture('b-chord').replace('</measure>', noteXml('D', 4) + '</measure>'))
    expect(next.moments.map((moment) => moment.onsetBeats)).toEqual([0, 1])
  })
  it('retains individual chord durations rather than forcing a shared value', () => {
    const xml = scoreXml(noteXml('C', 2) + noteXml('E', 1, '<chord/>') + noteXml('G', 1))
    const score = parseXml(xml)
    expect(score.moments[0].notes.map((note) => note.durationBeats)).toEqual([2, 1])
    expect(score.moments[1].onsetBeats).toBe(2)
    expect(score.totalBeats).toBe(3)
  })
  it('C: notes from both staves share a moment while retaining staff and string voice', () => {
    const score = parseFixture('c-grand-staff')
    expect(score.staffCount).toBe(2); expect(score.voices).toEqual(['1', '2'])
    expect(score.moments).toHaveLength(1)
    expect(score.notes.map((note) => [note.midiNote, note.staff, note.voice])).toEqual([[72, 1, '1'], [76, 1, '1'], [48, 2, '2'], [55, 2, '2']])
    expect(score.totalBeats).toBe(1)
    expect(score.practiceCompatibility).toBe('pitchPractice')
  })
  it('D: quarter-note voice and half-note voice have correct independent starts and lengths', () => {
    const score = parseFixture('d-two-voices')
    expect(score.notes.map((note) => [note.midiNote, note.onsetBeats, note.durationBeats, note.voice])).toEqual([[60, 0, 1, '1'], [55, 0, 2, '2'], [62, 1, 1, '1']])
    expect(score.totalBeats).toBe(2)
  })
  it('E: a rest advances time without becoming a MIDI note or a key-wait moment', () => {
    const score = parseFixture('e-rest')
    expect(score.rests).toHaveLength(1); expect(score.notes).toHaveLength(1); expect(score.moments).toHaveLength(1)
    expect(score.rests[0]).toMatchObject({ onsetBeats: 0, durationBeats: 1 })
    expect(score.moments[0].onsetBeats).toBe(1); expect(score.totalBeats).toBe(2)
    expect(toPracticeScore(score)).toBeNull()
  })
  it('F: backup returns to zero and forward moves the second voice to beat one', () => {
    const score = parseFixture('f-backup-forward')
    expect(score.notes.map((note) => [note.midiNote, note.onsetBeats, note.durationBeats])).toEqual([[64, 0, 2], [55, 1, 2], [60, 2, 1]])
    expect(score.totalBeats).toBe(3)
  })
  it('next measure begins at maximum extent, even if the last serialized voice ends earlier', () => {
    const xml = scoreXml(noteXml('C', 4, '<voice>top</voice>') + '<backup><duration>4</duration></backup>' + noteXml('G', 1, '<voice>bottom</voice>'))
      .replace('</part>', '<measure number="2">' + noteXml('D', 1) + '</measure></part>')
    const score = parseXml(xml)
    expect(score.notes.at(-1)).toMatchObject({ midiNote: 62, onsetBeats: 4, measureNumber: '2', measureIndex: 1 })
    expect(score.voices).toEqual(['top', 'bottom', '1']); expect(score.totalBeats).toBe(5)
  })
  it('handles divisions changes at measure boundaries, inherited values and decimal divisions exactly', () => {
    const xml = scoreXml(noteXml('C', 1), '3').replace('</part>', '<measure number="2"><attributes><divisions>6</divisions></attributes>' + noteXml('D', 2) + '</measure><measure number="3">' + noteXml('E', 2) + '</measure></part>')
    const score = parseXml(xml)
    expect(score.notes.map((note) => note.onset)).toEqual([{ numerator: '0', denominator: '1' }, { numerator: '1', denominator: '3' }, { numerator: '2', denominator: '3' }])
    expect(score.totalDuration).toEqual({ numerator: '1', denominator: '1' })
    expect(parseXml(scoreXml(noteXml('C', 0.5), '0.5')).totalBeats).toBe(1)
  })
  it('groups exact fractional onsets reached by different additions and preserves duplicate pitches', () => {
    const xml = scoreXml(noteXml('C', 1, '<voice>1</voice>') + noteXml('D', 1, '<voice>1</voice>') + noteXml('E', 1, '<voice>1</voice>') + '<backup><duration>3</duration></backup><forward><duration>2</duration></forward>' + noteXml('E', 1, '<voice>2</voice><staff>2</staff>'), '3')
    const score = parseXml(xml), moment = score.moments[2]
    expect(score.moments).toHaveLength(3)
    expect(moment.onset).toEqual({ numerator: '2', denominator: '3' })
    expect(moment.notes).toHaveLength(2)
    expect(new Set(moment.notes.map((note) => note.id)).size).toBe(2)
    expect([...expectedMidiSet(moment)]).toEqual([64])
  })
  it.each([[-2, 58], [-1, 59], [0, 60], [1, 61], [2, 62]])('alter %s maps C4 to MIDI %s', (alter, midi) => {
    expect(parseXml(scoreXml(noteXml().replace('<octave>', '<alter>' + alter + '</alter><octave>'))).notes[0].midiNote).toBe(midi)
  })
  it('preserves tie and tied sources, start/stop/continue, numbers and separate original notes', () => {
    const score = parseXml(scoreXml(noteXml('C', 1, '<tie type="start"/><notations><tied type="start" number="2"/></notations>') + noteXml('C', 1, '<tie type="stop"/><tie type="start"/><notations><tied type="continue" number="2"/></notations>') + noteXml('C', 1, '<tie type="stop"/>')))
    expect(score.notes.map((note) => [note.tieStart, note.tieStop])).toEqual([[true, false], [true, true], [false, true]])
    expect(score.notes[0].ties).toEqual([{ source: 'tie', type: 'start', number: undefined, timeOnly: undefined }, { source: 'tied', type: 'start', number: '2', timeOnly: undefined }])
    expect(score.notes).toHaveLength(3); expect(toPracticeScore(score)).toBeNull()
  })
  it('keeps pickup/non-numeric measure labels without padding imaginary rests', () => {
    const score = parseXml(scoreXml(noteXml('C', 1)).replace('number="1"', 'number="pickup-A" implicit="yes"'))
    expect(score.measures[0]).toMatchObject({ number: 'pickup-A', implicit: true, durationBeats: 1 })
    expect(score.notes[0].measureNumber).toBe('pickup-A')
  })
  it('records sound tempo and metronome beat-unit/dots/offset changes', () => {
    const xml = scoreXml('<direction><sound tempo="90"/></direction>' + noteXml('C', 1) + '<direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type><offset>1</offset></direction>' + noteXml('D', 2))
    const score = parseXml(xml)
    expect(score.tempoBpm).toBe(90)
    expect(score.tempos.map((tempo) => [tempo.onsetBeats, tempo.bpm, tempo.source])).toEqual([[0, 90, 'sound'], [2, 180, 'metronome']])
    expect(buildDemoNotes(toPracticeScore(score)!)[0].durationMs).toBe(600)
  })
  it('sound offset overrides direction offset and missing tempo remains undefined', () => {
    const score = parseXml(scoreXml(noteXml('C', 4) + '<direction><offset>-2</offset><sound tempo="120"><offset>-1</offset></sound></direction>'))
    expect(score.tempos[0].onsetBeats).toBe(3); expect(score.tempoBpm).toBeUndefined()
    expect(parseFixture('a-simple').tempoBpm).toBeUndefined()
  })
  it('preserves tuplet durations exactly and warns instead of expanding performance semantics', () => {
    const score = parseXml(scoreXml(noteXml('C', 1, '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'), '3'))
    expect(score.notes[0].duration).toEqual({ numerator: '1', denominator: '3' })
    expect(score.warnings.some((warning) => warning.code === 'tuplet')).toBe(true)
    expect(toPracticeScore(score)).toBeNull()
  })
  it.each(['pedal', 'arpeggiate', 'ornaments', 'repeat', 'tremolo'])('warns about %s while retaining the legacy monophonic policy', (tag) => {
    const score = parseXml(scoreXml(noteXml('C', 1, `<notations><${tag}/></notations>`)))
    expect(score.warnings.length).toBeGreaterThan(0)
    expect(score.practiceCompatibility).toBe(['repeat', 'tremolo', 'arpeggiate', 'ornaments'].includes(tag) ? 'unsupported' : 'simpleMelody')
    expect(score.notes[0].midiNote).toBe(60)
  })
  it.each([
    [scoreXml(noteXml('C', 0)), 'duration'],
    [scoreXml(noteXml(), '0'), 'divisions'],
    [scoreXml(noteXml()).replace('<divisions>1</divisions>', ''), 'divisions'],
    [scoreXml('<backup><duration>1</duration></backup>' + noteXml()), 'backup'],
    [scoreXml(noteXml('C', 1, '<chord/>')), 'chord'],
    [scoreXml(noteXml('C', 1) + noteXml('E', 2, '<chord/>')), 'chord'],
    [scoreXml(noteXml() + '<attributes><divisions>2</divisions></attributes>' + noteXml()), '小節途中'],
    [scoreXml(noteXml('C', 1, '<staff>3</staff>')), 'Staff'],
    [scoreXml(noteXml('C', 1, '<grace/>')), '装飾音'],
    [scoreXml(noteXml()).replace('<octave>4</octave>', '<octave>10</octave>'), 'MIDI音高'],
    [scoreXml(noteXml()).replace('<octave>', '<alter>0.5</alter><octave>'), '微分音'],
    [scoreXml(noteXml()).replace('<divisions>', '<transpose><chromatic>2</chromatic></transpose><divisions>'), '移調'],
  ])('rejects invalid or unimplemented timing/pitch without partially flattening (%s)', (xml, message) => {
    expect(() => parseXml(xml)).toThrow(message)
  })
  it('retains serializable exact positions, stable IDs and original XML across repeated parses', () => {
    const score = parseFixture('c-grand-staff')
    expect(parseFixture('c-grand-staff')).toEqual(score)
    expect(structuredClone(score)).toEqual(score)
    expect(JSON.parse(JSON.stringify(score)).moments).toEqual(JSON.parse(JSON.stringify(score.moments)))
    expect(score.musicXml).toBe(fixture('c-grand-staff'))
  })
})

describe('legacy melody compatibility', () => {
  it.each([
    ['twinkle', [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]],
    ['do-re-mi', [60, 62, 64, 65, 67, 69, 71]],
    ['short-melody', [67, 64, 65, 62, 67]],
  ] as const)('%s keeps the original note sequence, grading, completion and demo timing', (name, expected) => {
    const xml = readFileSync(new URL('../../src/scores/' + name + '.musicxml', import.meta.url), 'utf8')
    const normalized = parseXml(xml), legacy = toPracticeScore(normalized)!
    expect(legacy.notes.map((note) => note.midiNote)).toEqual(expected)
    expect(normalized.moments).toHaveLength(expected.length)
    const session = new PracticeSession(); session.loadScore(legacy); session.start()
    for (const midiNote of expected) {
      session.handleMidiEvent({ type: 'noteon', midiNote, velocity: 80, channel: 1, timestamp: 0 })
      session.handleMidiEvent({ type: 'noteoff', midiNote, velocity: 0, channel: 1, timestamp: 1 })
    }
    expect(session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: expected.length })
    const demo = buildDemoNotes(legacy)
    expect(demo.map((note) => note.midiNote)).toEqual(expected)
    expect(demo.map((note) => note.startMs)).toEqual(normalized.notes.map((note) => note.onsetBeats * 600))
  })
  it('refuses to flatten a complex model even if an incorrect compatibility flag is supplied', () => {
    expect(toPracticeScore({ ...parseFixture('b-chord'), practiceCompatibility: 'simpleMelody' })).toBeNull()
    expect(toPracticeScore({ ...parseFixture('e-rest'), practiceCompatibility: 'simpleMelody' })).toBeNull()
  })
})

it('Beat sums and reductions are exact rather than rounded for moment equality', () => {
  expect(Beat.decimal('0.1').add(Beat.decimal('0.2')).key).toBe(Beat.decimal('0.3').key)
  expect(new Beat(2n, 6n).add(new Beat(1n, 3n)).key).toBe('2/3')
  expect(() => Beat.decimal('NaN')).toThrow()
})
