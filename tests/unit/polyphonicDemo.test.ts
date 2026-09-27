import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { parseFixture, parseXml, scoreXml, noteXml } from './xmlFixture'

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }))
afterEach(() => vi.useRealTimers())
async function setup(clear = true, name = 'g-piano-practice') {
  const port = { id: 'cme', name: 'CME', manufacturer: 'CME', state: 'connected', open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), send: vi.fn(), clear: clear ? vi.fn() : undefined }
  const output = new MidiOutputManager()
  output.attachAccess({ outputs: new Map([['cme', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  const plan = createPracticePlan(parseFixture(name))!, practice = new PracticeSession()
  practice.loadPlan(plan)
  const player = new DemoPlayer(output, practice.beginDemo)
  player.subscribe(() => { if (player.getSnapshot().status !== 'playing') practice.endDemo() })
  player.loadPlan(plan)
  return { port, output, player, practice, plan }
}
it.each(['right', 'left', 'both'] as const)('%s demo uses only selected source notes and keeps independent durations', (mode) => {
  const plan = createPracticePlan(parseFixture('g-piano-practice'), mode)!, notes = buildDemoPlan(plan)
  expect(notes.map((note) => note.midiNote)).toEqual(plan.sourceNotes.map((note) => note.midiNote))
  const first = notes.filter((note) => note.startMs === 0)
  expect(first.map((note) => note.midiNote).sort((a, b) => a - b)).toEqual(plan.targets[0].expectedMidiNotes)
  for (const note of first) expect(note.noteOffMs).toBe(note.midiNote < 60 ? 1080 : 540)
})
it('one callback sends chord On messages with exactly the same MIDI timestamp', async () => {
  const { player, port } = await setup()
  vi.advanceTimersByTime(100); player.start()
  const on = port.send.mock.calls.filter(([data]) => data[0] === 0x90)
  expect(on).toHaveLength(5)
  expect(on.map(([, time]) => time)).toEqual([100, 100, 100, 100, 100])
  expect(port.send.mock.calls.filter(([data]) => data[0] === 0x80).map(([data, time]) => [data[1], time])).toEqual([[72, 640], [76, 640], [79, 640], [48, 1180], [55, 1180]])
  vi.advanceTimersByTime(600)
  expect(player.getSnapshot().currentNoteIndex).toBe(1)
  player.stop()
})
it('deduplicates simultaneous physical pitches and retains the longest required duration', () => {
  const score = parseXml(scoreXml(noteXml('C', 1, '<voice>1</voice>') + '<backup><duration>1</duration></backup>' + noteXml('C', 2, '<voice>2</voice><staff>2</staff>')))
  const plan = createPracticePlan(score)!
  expect(plan.sourceNotes).toHaveLength(2)
  expect(buildDemoPlan(plan)).toEqual([{ index: 0, midiNote: 60, startMs: 0, durationMs: 1200, noteOffMs: 1080 }])
})
it('normal tie chains have a single On, no intermediate Off, and a gate only at the chain end', async () => {
  const { player, port, plan, output } = await setup(true, 'h-ties')
  expect(buildDemoPlan(plan)).toEqual([
    { index: 0, midiNote: 60, startMs: 0, durationMs: 2400, noteOffMs: 2340 },
    { index: 0, midiNote: 64, startMs: 0, durationMs: 600, noteOffMs: 540 },
    { index: 1, midiNote: 67, startMs: 1200, durationMs: 600, noteOffMs: 1740 },
  ])
  player.start(); vi.advanceTimersByTime(1740)
  expect(player.getSnapshot().status).toBe('playing')
  vi.advanceTimersByTime(600)
  expect(player.getSnapshot().status).toBe('completed')
  expect(output.getSnapshot().latestMessage).toEqual({ type: 'noteoff', data: [0x80, 60, 0], timestamp: 2340 })
  expect(port.send.mock.calls.filter(([data]) => data[0] === 0x90 && data[1] === 60)).toHaveLength(1)
})
it('rests defer the first Note On without inserting a fake key', async () => {
  const { player, port } = await setup(true, 'e-rest')
  player.start(); expect(port.send).not.toHaveBeenCalled()
  vi.advanceTimersByTime(599); expect(port.send).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(port.send.mock.calls).toEqual([[[0x90, 60, 80], 600], [[0x80, 60, 0], 1140]])
  player.stop()
})
it.each([true, false])('stop sends Off for all chord pitches plus CC123; no future On can return (clear=%s)', async (clear) => {
  const { player, port, output } = await setup(clear)
  player.start(); vi.advanceTimersByTime(100)
  const before = port.send.mock.calls.length
  player.stop()
  expect(port.send.mock.calls.slice(before).map(([data]) => data)).toEqual([[0x80, 72, 0], [0x80, 76, 0], [0x80, 79, 0], [0x80, 48, 0], [0x80, 55, 0], [0xb0, 123, 0]])
  if (!clear) {
    expect(output.getSnapshot().playing).toBe(true)
    vi.advanceTimersByTime(440); expect(output.getSnapshot().playing).toBe(true)
  }
  const stopped = port.send.mock.calls.length
  vi.advanceTimersByTime(20000)
  expect(port.send).toHaveBeenCalledTimes(stopped)
  expect(output.getSnapshot().playing).toBe(false)
})
it('mode replacement stops sound and the next start begins at the new first target', async () => {
  const { player, port, plan } = await setup()
  player.start(); vi.advanceTimersByTime(100)
  player.loadPlan(createPracticePlan(plan.score, 'left'))
  expect(player.getSnapshot()).toMatchObject({ status: 'idle', currentNoteIndex: 0, totalNotes: 5 })
  const stopped = port.send.mock.calls.length
  vi.advanceTimersByTime(10000); expect(port.send).toHaveBeenCalledTimes(stopped)
  player.start()
  expect(port.send.mock.calls.slice(stopped).filter(([data]) => data[0] === 0x90).map(([data]) => data[1])).toEqual([48, 55])
  player.stop()
})
it('all chord loopback is excluded from practice before the very first send', async () => {
  const { player, port, practice } = await setup()
  practice.start()
  port.send.mockImplementation((data: number[]) => {
    expect(practice.getSnapshot().status).toBe('demoPlaying')
    practice.handleMidiEvent({ midiNote: data[1], type: data[0] === 0x90 ? 'noteon' : 'noteoff', velocity: data[2], channel: 1, timestamp: performance.now() })
  })
  player.start(); vi.advanceTimersByTime(4680)
  expect(practice.getSnapshot()).toMatchObject({ status: 'practicing', correctNoteCount: 0, feedback: null })
})
it('a failure partway through chord transmission releases notes already sent and cancels future playback', async () => {
  const { player, port } = await setup()
  port.send.mockImplementation((data: number[]) => { if (data[0] === 0x90 && data[1] === 79) throw new Error('port failed') })
  player.start()
  expect(player.getSnapshot().status).toBe('error')
  expect(port.send.mock.calls.some(([data]) => data[0] === 0x80 && data[1] === 72)).toBe(true)
  expect(port.send.mock.calls.some(([data]) => data[0] === 0xb0 && data[1] === 123)).toBe(true)
  const stopped = port.send.mock.calls.length
  vi.advanceTimersByTime(20000); expect(port.send).toHaveBeenCalledTimes(stopped)
})
it.each([
  noteXml('C', 1, '<tie type="stop"/>'),
  noteXml('C', 1, '<tie type="start"/>'),
  noteXml('C', 2, '<voice>1</voice>') + '<backup><duration>1</duration></backup>' + noteXml('C', 2, '<voice>2</voice>'),
])('ambiguous ties/overlapping physical pitches cannot silently start a demo', (xml) => {
  const model = parseXml(scoreXml(xml))
  expect(model.practiceCompatibility).toBe('unsupported')
  expect(createPracticePlan(model)).toBeNull()
})
