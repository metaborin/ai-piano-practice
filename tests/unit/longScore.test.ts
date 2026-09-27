import { afterEach, expect, it, vi } from 'vitest'
import { scrollDelta } from '../../src/score/ScoreFollow'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { buildCursorMap } from '../../src/score/CursorMap'
import type { Cursor } from 'opensheetmusicdisplay'
import { parseFixture, parseXml, scoreXml, noteXml } from './xmlFixture'

afterEach(() => vi.useRealTimers())
// Exercise engine scaling beyond the importer safety limits without changing those limits.
function largeModel(count: number) {
  const base = parseXml(scoreXml(noteXml()))
  const notes = Array.from({ length: count }, (_, index) => ({ ...base.notes[0], id: `note:${index}`, onsetBeats: index, onset: { numerator: String(index), denominator: '1' } }))
  return { ...base, notes, moments: notes.map((note) => ({ ...base.moments[0], id: `moment:${note.id}`, onset: note.onset, onsetBeats: note.onsetBeats, notes: [note] })),
    measures: [{ ...base.measures[0], durationBeats: count, duration: { numerator: String(count), denominator: '1' } }],
    totalBeats: count, totalDuration: { numerator: String(count), denominator: '1' } }
}
it.each([
  [200, 400, 100, 700, 0],
  [720, 940, 100, 700, 449],
  [10, 230, 100, 700, -261],
  [0, 800, 100, 700, -100],
  [105, 905, 100, 700, 0],
  [0, 0, 100, 700, 0],
])('scroll geometry %j..%j inside %j..%j yields %j', (start, end, top, bottom, delta) => {
  expect(scrollDelta(start, end, top, bottom)).toBe(delta)
})
it.each(['right', 'left', 'both'] as const)('%s creates a long plan, reaches late targets and completes with the actual count', (mode) => {
  const model = parseFixture('j-long-practice'), plan = createPracticePlan(model, mode)!, practice = new PracticeSession()
  expect(model.measures).toHaveLength(32); expect(model.moments).toHaveLength(128)
  expect(model.tempoBpm).toBe(116)
  expect(plan.targets).toHaveLength(mode === 'left' ? 64 : 128)
  expect(model.measures.map((measure) => measure.number)).not.toContain('17')
  practice.loadPlan(plan); practice.start()
  for (const target of plan.targets) for (const pitch of target.expectedMidiNotes) {
    practice.handleMidiEvent({ type: 'noteon', midiNote: pitch, velocity: 80, timestamp: 0, channel: 1 })
    practice.handleMidiEvent({ type: 'noteoff', midiNote: pitch, velocity: 0, timestamp: 0, channel: 1 })
  }
  expect(practice.getSnapshot()).toMatchObject({ currentNoteIndex: plan.targets.length - 1, correctNoteCount: plan.targets.length, status: 'completed' })
  expect(plan.targets.at(-1)!.measureNumber).toBe('36')
  const notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: 24 })
  expect(notes[0].startMs).toBe(0); expect(notes[0].index).toBe(mode === 'left' ? 48 : 96)
})
it('CursorMap supports more than the former 5000 traversal guard using a score-derived bound', () => {
  const model = largeModel(5100)
  let index = 0
  const cursor = {
    reset: () => { index = 0 }, next: () => { index++ },
    Iterator: { get EndReached() { return index >= model.notes.length }, CurrentMeasureIndex: 0,
      get CurrentRelativeInMeasureTimestamp() { return { GetExpandedNumerator: () => index, Denominator: 4 } } },
    NotesUnderCursor: () => [{ isRest: () => false, Pitch: { Octave: 4, FundamentalNote: 0, AccidentalHalfTones: 0 } }],
  } as unknown as Cursor
  const map = buildCursorMap(model, cursor, 0)
  expect(map.size).toBe(5100); expect(map.get(model.moments.at(-1)!.id)).toBe(5099)
})
it.each([true, false])('long playback keeps at most two timers, stops all notes and never revives cancelled music (clear=%s)', async (clear) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const port = { id: 'cme', name: 'CME', state: 'connected', open: vi.fn().mockResolvedValue(undefined), close: vi.fn(), send: vi.fn(), clear: clear ? vi.fn() : undefined }
  const output = new MidiOutputManager(); output.attachAccess({ outputs: new Map([['cme', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  const model = largeModel(2000), plan = createPracticePlan(model)!
  const player = new DemoPlayer(output); player.loadPlan(plan)
  player.start(); player.start() // A second click must not create a second sequencer.
  for (let index = 0; index < 1200; index++) { vi.advanceTimersByTime(600); expect(vi.getTimerCount()).toBeLessThanOrEqual(2) }
  expect(port.send.mock.calls.filter(([data]) => data[0] === 0x90)).toHaveLength(1201)
  player.stop(); const stopped = port.send.mock.calls.length
  expect(port.send.mock.calls.at(-1)![0]).toEqual([0xb0, 123, 0])
  vi.advanceTimersByTime(2000000); expect(port.send).toHaveBeenCalledTimes(stopped); expect(vi.getTimerCount()).toBe(0)
  player.start({ kind: 'moment', momentId: plan.targets[1900].scoreMomentId })
  vi.advanceTimersByTime(60000); expect(player.getSnapshot().status).toBe('completed'); expect(vi.getTimerCount()).toBe(0)
  player.start(); player.loadPlan(createPracticePlan(parseFixture('a-simple')))
  const replaced = port.send.mock.calls.length; vi.advanceTimersByTime(2000000)
  expect(port.send).toHaveBeenCalledTimes(replaced)
})
