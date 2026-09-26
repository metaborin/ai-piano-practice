import { afterEach, expect, it, vi } from 'vitest'
import { buildDemoNotes, DemoPlayer } from '../../src/audio/DemoPlayer'
import type { DemoOutput } from '../../src/audio/DemoPlayer'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { PracticeSession } from '../../src/practice/PracticeSession'
import type { ScoreModel } from '../../src/score/ScoreModel'

const melody = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]
const score: ScoreModel = { id: 'test', title: '', partLabel: '', musicXml: '', notes: melody.map((midiNote, index) => ({ midiNote, durationBeats: index === 6 || index === 13 ? 2 : 1 })) }
afterEach(() => { vi.useRealTimers() })

it.each([true, false])('changing songs releases sounding notes and cancels future playback (clear=%s)', async (clearSupported) => {
  const { player, practice, port, output } = await setup(clearSupported)
  player.start()
  vi.advanceTimersByTime(1250)
  practice.loadScore(null)
  player.loadScore(null)
  expect(port.send.mock.calls.slice(-2)).toEqual([[[0x80, 67, 0]], [[0xb0, 123, 0]]])
  const sends = port.send.mock.calls.length
  const changed = { ...score, id: 'changed', notes: [{ midiNote: 65, durationBeats: 2 }] }
  player.loadScore(changed)
  practice.loadScore(changed)
  vi.advanceTimersByTime(20000)
  expect(port.send).toHaveBeenCalledTimes(sends)
  expect(player.getSnapshot()).toMatchObject({ status: 'idle', totalNotes: 1, currentNoteIndex: 0 })
  expect(practice.getSnapshot()).toMatchObject({ status: 'idle', correctNoteCount: 0 })
  expect(output.getSnapshot().playing).toBe(false)
  player.start()
  expect(port.send.mock.calls.at(-2)?.[0]).toEqual([0x90, 65, 80])
})

it.each([false, true])('ignores a cancelled old position/completion timer and interruption callback (final=%s)', (final) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  let oldInterrupted = () => {}
  const output: DemoOutput = {
    beginDemo: () => true, playDemoNote: vi.fn(() => true), finishDemo: vi.fn(), stopAllNotes: vi.fn(),
    subscribeDemoInterrupted: (listener) => { oldInterrupted = listener; return () => {} },
  }
  const timer = vi.spyOn(globalThis, 'setTimeout')
  const player = new DemoPlayer(output)
  player.loadScore(final ? { ...score, notes: score.notes.slice(0, 1) } : score)
  player.start()
  const oldTimer = timer.mock.calls.at(-1)![0] as () => void
  const interruption = oldInterrupted
  player.loadScore({ ...score, notes: [{ midiNote: 67, durationBeats: 2 }] })
  player.start()
  const before = player.getSnapshot()
  oldTimer()
  interruption()
  expect(player.getSnapshot()).toBe(before)
  expect(output.playDemoNote).toHaveBeenCalledTimes(2)
  expect(output.finishDemo).not.toHaveBeenCalled()
  player.stop()
  timer.mockRestore()
})

async function setup(clearSupported = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const port = {
    id: 'cme', name: 'CME', manufacturer: '', state: 'connected',
    open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(), clear: clearSupported ? vi.fn() : undefined,
  }
  const output = new MidiOutputManager()
  output.attachAccess({ outputs: new Map([['cme', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  const practice = new PracticeSession(score.notes)
  const player = new DemoPlayer(output, practice.beginDemo)
  player.subscribe(() => { if (player.getSnapshot().status !== 'playing') practice.endDemo() })
  player.loadScore(score)
  return { player, port, output, practice }
}

it('builds all 14 score notes in order: quarter 600ms and half 1200ms at default 100 BPM', () => {
  const notes = buildDemoNotes(score)
  expect(notes.map((note) => note.midiNote)).toEqual(melody)
  expect(notes[0]).toEqual({ index: 0, midiNote: 60, startMs: 0, durationMs: 600, noteOffMs: 540 })
  expect(notes[6]).toEqual({ index: 6, midiNote: 67, startMs: 3600, durationMs: 1200, noteOffMs: 4680 })
  expect(notes[7].startMs).toBe(4800)
  expect(notes[13]).toEqual({ index: 13, midiNote: 60, startMs: 8400, durationMs: 1200, noteOffMs: 9480 })
})

it('uses a replacement ScoreModel without relying on the twinkle melody or duration list', () => {
  const changed = { ...score, notes: [{ midiNote: 72, durationBeats: 1.5 }, { midiNote: 61, durationBeats: 0.5 }] }
  expect(buildDemoNotes(changed)).toEqual([
    { index: 0, midiNote: 72, startMs: 0, durationMs: 900, noteOffMs: 810 },
    { index: 1, midiNote: 61, startMs: 900, durationMs: 300, noteOffMs: 1170 },
  ])
})

it.each([0, -1, NaN, Infinity])('rejects invalid tempo or duration %s', (value) => {
  expect(() => buildDemoNotes(score, value)).toThrow()
  expect(() => buildDemoNotes({ ...score, notes: [{ midiNote: 60, durationBeats: value }] })).toThrow()
})

it('sends separate On/Off for repeated notes on a fixed timeline and completes only after the final Off', async () => {
  const { player, port } = await setup()
  vi.advanceTimersByTime(100)
  player.start()
  expect(port.send.mock.calls).toEqual([[[0x90, 60, 80], 100], [[0x80, 60, 0], 640]])
  vi.advanceTimersByTime(599)
  expect(player.getSnapshot().currentNoteIndex).toBe(0)
  vi.advanceTimersByTime(1)
  expect(port.send.mock.calls.slice(-2)).toEqual([[[0x90, 60, 80], 700], [[0x80, 60, 0], 1240]])
  expect(player.getSnapshot().currentNoteIndex).toBe(1)
  vi.advanceTimersByTime(8879)
  expect(player.getSnapshot()).toMatchObject({ status: 'playing', currentNoteIndex: 13 })
  vi.advanceTimersByTime(1)
  expect(player.getSnapshot()).toMatchObject({ status: 'completed', currentNoteIndex: 13 })
  expect(port.send.mock.calls.filter(([bytes]) => bytes[0] === 0x90).map(([bytes]) => bytes[1])).toEqual(melody)
  expect(port.send.mock.calls.filter(([bytes]) => bytes[0] === 0x80)).toHaveLength(14)
  expect(port.send.mock.calls.at(-1)).toEqual([[0x80, 60, 0], 9580])
})

it.each([true, false])('stop prevents every future Note On, releases the current G4 and sends CC123 (clear=%s)', async (clearSupported) => {
  const { player, port, output } = await setup(clearSupported)
  player.start()
  vi.advanceTimersByTime(1250)
  expect(player.getSnapshot().currentNoteIndex).toBe(2)
  player.stop()
  expect(port.send.mock.calls.slice(-2)).toEqual([[[0x80, 67, 0]], [[0xb0, 123, 0]]])
  expect(player.getSnapshot().status).toBe('stopped')
  const sends = port.send.mock.calls.length
  vi.advanceTimersByTime(20000)
  expect(port.send).toHaveBeenCalledTimes(sends)
  expect(output.getSnapshot().playing).toBe(false)
})

it('blocks double playback and C4 test overlap; replay after completion starts at note one', async () => {
  const { player, port, output } = await setup()
  player.start()
  player.start()
  output.playTestNote()
  expect(port.send).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(9480)
  expect(player.getSnapshot().status).toBe('completed')
  player.start()
  expect(player.getSnapshot()).toMatchObject({ status: 'playing', currentNoteIndex: 0 })
  expect(port.send.mock.calls.at(-2)).toEqual([[0x90, 60, 80], 9480])
  player.stop()
})

it('resets practice before output, ignores loopback/keyboard input and permits practice after completion', async () => {
  const { player, port, practice } = await setup()
  const input = (note: number, type: 'noteon' | 'noteoff' = 'noteon') => practice.handleMidiEvent({ type, midiNote: note, velocity: type === 'noteon' ? 80 : 0, channel: 1, timestamp: performance.now() })
  practice.start()
  input(60); input(60, 'noteoff')
  expect(practice.getSnapshot().correctNoteCount).toBe(1)
  // Synchronous loopback in send() must already see demoPlaying, including the first Note On.
  port.send.mockImplementation((bytes: number[]) => {
    if (bytes[0] === 0x90) {
      expect(practice.getSnapshot().status).toBe('demoPlaying')
      input(bytes[1]); input(bytes[1], 'noteoff')
    }
  })
  player.start()
  practice.start()
  practice.restart()
  practice.moveCursor(1)
  melody.forEach((note) => { input(note); input(note, 'noteoff') })
  vi.advanceTimersByTime(9480)
  expect(practice.getSnapshot()).toMatchObject({ currentNoteIndex: 0, correctNoteCount: 0, status: 'idle', feedback: null })
  practice.start()
  input(60)
  expect(practice.getSnapshot()).toMatchObject({ currentNoteIndex: 1, correctNoteCount: 1, status: 'practicing' })
})

it('external all-notes-off, output selection and unplug cancel sequencing', async () => {
  const { player, output, port } = await setup()
  player.start()
  output.stopAllNotes()
  expect(player.getSnapshot().status).toBe('stopped')
  player.start()
  output.selectOutput('')
  expect(player.getSnapshot().status).toBe('stopped')
  output.selectOutput('cme')
  await Promise.resolve()
  player.start()
  port.state = 'disconnected'
  output.refreshOutputs()
  expect(player.getSnapshot().status).toBe('stopped')
  const sends = port.send.mock.calls.length
  vi.advanceTimersByTime(20000)
  expect(port.send).toHaveBeenCalledTimes(sends)
})

it('a missing score/output or a send failure never starts uncontrolled playback', async () => {
  const { player, output, port, practice } = await setup()
  player.loadScore(null)
  player.start()
  expect(player.getSnapshot().status).toBe('error')
  expect(port.send).not.toHaveBeenCalled()
  player.loadScore(score)
  output.selectOutput('')
  player.start()
  expect(player.getSnapshot().status).toBe('error')
  output.selectOutput('cme')
  await Promise.resolve()
  port.send.mockImplementationOnce(() => { throw new Error('send failed') })
  player.start()
  expect(player.getSnapshot().status).toBe('error')
  expect(practice.getSnapshot().status).toBe('idle')
  const sends = port.send.mock.calls.length
  vi.advanceTimersByTime(20000)
  expect(port.send).toHaveBeenCalledTimes(sends)
})

it('stops if the UI stalls instead of sending a burst of overdue notes', async () => {
  const { player, port } = await setup()
  player.start()
  const realNow = performance.now
  vi.spyOn(performance, 'now').mockImplementation(() => realNow.call(performance) + 2000)
  vi.advanceTimersByTime(600)
  expect(player.getSnapshot().status).toBe('stopped')
  expect(port.send.mock.calls.filter(([bytes]) => bytes[0] === 0x90)).toHaveLength(1)
  vi.restoreAllMocks()
})

it('waits for the previous scheduled Off before a new demo when clear is unavailable', async () => {
  const { player, output, port } = await setup(false)
  player.start()
  vi.advanceTimersByTime(3700)
  player.stop()
  player.start()
  expect(player.getSnapshot().status).toBe('error')
  const sends = port.send.mock.calls.length
  vi.advanceTimersByTime(980)
  expect(output.getSnapshot().playing).toBe(false)
  player.start()
  expect(player.getSnapshot().status).toBe('playing')
  expect(port.send).toHaveBeenCalledTimes(sends + 2)
  player.stop()
})
