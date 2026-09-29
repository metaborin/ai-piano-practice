import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { DemoPreviewScheduler } from '../../src/audio/DemoPreviewScheduler'
import { resolveDemoStart } from '../../src/audio/DemoStart'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { parseFixture } from './xmlFixture'
import type { PracticeMode } from '../../src/practice/PracticePlan'
import type { DemoStart } from '../../src/audio/DemoStart'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
const score = parseFixture('maim-maim-full-original')
const modes = ['right', 'left', 'both'] as const
const systems = new Map(score.moments.map(m => [m.id, { system: Math.floor(m.measureIndex / 4), measureIndex: m.measureIndex }]))
const strike = (practice: PracticeSession, notes: readonly number[]) => {
  for (const midiNote of notes) practice.handleMidiEvent({ type: 'noteon', midiNote, channel: 1, velocity: 80, timestamp: performance.now() })
  for (const midiNote of notes) practice.handleMidiEvent({ type: 'noteoff', midiNote, channel: 1, velocity: 0, timestamp: performance.now() })
}
async function setup(mode: PracticeMode = 'both', clear = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const plan = createPracticePlan(score, mode)!, practice = new PracticeSession()
  practice.loadPlan(plan)
  const port = { id: 'cme', name: 'CME', state: 'connected', open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), send: vi.fn(), clear: clear ? vi.fn() : undefined }
  const output = new MidiOutputManager(); output.attachAccess({ outputs: new Map([['cme', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  const player = new DemoPlayer(output, practice.beginDemo)
  player.subscribe(() => { if (player.getSnapshot().status !== 'playing') practice.endDemo() })
  player.loadPlan(plan); player.setSystems(systems)
  return { plan, practice, port, output, player }
}
it('audits all original occurrences and source measures, including both passes and every demo attack', () => {
  const audit = modes.map(mode => {
    const plan = createPracticePlan(score, mode)!, notes = buildDemoPlan(plan)
    expect(plan.sequence.playback.measures.map(m => Number(m.source.number))).toEqual([...Array.from({ length: 30 }, (_, i) => i + 1), ...Array.from({ length: 26 }, (_, i) => i + 5)])
    expect(plan.sequence.occurrences).toHaveLength(mode === 'right' ? 88 : mode === 'left' ? 144 : 204)
    expect([...new Set(notes.map(n => n.index))]).toEqual(plan.sequence.occurrences.map(o => o.sequenceIndex))
    return { mode, occurrenceCount: plan.sequence.occurrences.length, noteOnCount: notes.length,
      measures: plan.sequence.playback.measures.map(m => ({ sequenceIndex: m.sequenceIndex, measureNumber: m.source.number, repeatPass: m.repeatPass ?? null })),
      occurrences: plan.sequence.occurrences.map(o => ({ sequenceIndex: o.sequenceIndex, measureNumber: o.sourceMoment.measureNumber, repeatPass: o.repeatPass ?? null })) }
  })
  if (process.env.WRITE_DEMO_AUDIT === '1') writeFileSync(new URL('../../docs/PHASE2ED331-sequence.json', import.meta.url), JSON.stringify(audit, null, 2) + '\n')
})
for (const mode of modes) {
  it(mode + ': forward repeat is ordinary playback; complete only after pass 2 final Note Off', async () => {
    const { plan, port, player, output } = await setup(mode), notes = buildDemoPlan(plan)
    player.start()
    let clock = 0
    for (const [measure, pass] of [['5', 1], ['30', 1], ['5', 2], ['30', 2]] as const) {
      const target = plan.sequence.occurrences.find(o => o.sourceMoment.measureNumber === measure && o.repeatPass === pass)!
      const at = Math.ceil(notes.find(n => n.index === target.sequenceIndex)!.startMs)
      vi.advanceTimersByTime(at - clock); clock = at
      expect(player.getSnapshot().status).toBe('playing')
      expect(player.getDiagnostics()).toMatchObject({ sequenceIndex: target.sequenceIndex, measure, repeatPass: pass })
      expect(port.clear).not.toHaveBeenCalled()
    }
    const end = Math.max(...notes.map(n => n.noteOffMs))
    vi.advanceTimersByTime(Math.floor(end) - clock)
    expect(player.getSnapshot().status).toBe('playing')
    vi.advanceTimersByTime(1)
    expect(player.getSnapshot().status).toBe('completed')
    expect(port.send.mock.calls.filter(([data]) => data[0] === 0x90).map(([data]) => data[1])).toEqual(notes.map(n => n.midiNote))
    expect(output.getDiagnostics()).toMatchObject({ demoActive: false, activeNotes: [], scheduledTimers: 0 })
    expect(player.getDiagnostics().scheduledTimers).toBe(0); expect(vi.getTimerCount()).toBe(0)
  })
  for (const scenario of ['A', 'B', 'C', 'D', 'E', 'F'] as const) it(mode + ': lifecycle scenario ' + scenario, async () => {
    const { plan, practice, player, port, output } = await setup(mode)
    if (['B', 'C', 'D'].includes(scenario)) {
      practice.start()
      for (const o of plan.sequence.occurrences.slice(0, scenario === 'B' ? 6 : undefined)) strike(practice, o.sourceTarget.expectedMidiNotes)
    }
    if (scenario === 'E' || scenario === 'F') {
      player.start()
      if (scenario === 'E') { vi.advanceTimersByTime(1500); player.stop() } else vi.runAllTimers()
    }
    const start: DemoStart = scenario === 'D'
      ? { kind: 'current', occurrenceIndex: practice.getSnapshot().currentNoteIndex, completed: true } : { kind: 'beginning' }
    const sent = port.send.mock.calls.length, startedAt = performance.now()
    player.start(start)
    expect(player.getSnapshot()).toMatchObject({ status: 'playing', currentNoteIndex: 0 })
    expect(player.getDiagnostics().startSequenceIndex).toBe(0)
    if (scenario === 'D') expect(player.getSnapshot().message).toContain('最初から手本を再生')
    vi.runAllTimers()
    const ons = port.send.mock.calls.slice(sent).filter(([data]) => data[0] === 0x90)
    const notes = buildDemoPlan(plan)
    expect(ons.map(([data]) => data[1])).toEqual(notes.map(n => n.midiNote))
    ons.forEach(([, timestamp], i) => expect(timestamp).toBeCloseTo(startedAt + notes[i].startMs, 5))
    expect(player.getSnapshot().status).toBe('completed')
    expect(output.getDiagnostics().activeNotes).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
  it(mode + ': current preserves pass 2, measure chooses pass 1, invalid current is explicit', () => {
    const plan = createPracticePlan(score, mode)!
    const current = plan.sequence.occurrences.find(o => o.repeatPass === 2 && o.sourceMoment.measureNumber === '10')!
    expect(resolveDemoStart(plan, { kind: 'current', occurrenceIndex: current.sequenceIndex, completed: false }).index).toBe(current.sequenceIndex)
    const measure = resolveDemoStart(plan, { kind: 'measure', measureIndex: 9 })
    expect(plan.sequence.occurrences[measure.index]).toMatchObject({ repeatPass: 1, sourceMoment: { measureNumber: '10' } })
    expect(resolveDemoStart(plan, { kind: 'beginning' }).index).toBe(0)
    expect(() => resolveDemoStart(plan, { kind: 'current', occurrenceIndex: null, completed: false })).toThrow('再生できる音がありません')
  })
}
it.each([true, false])('old audio, display, output timers and interruptions cannot affect the next session (clear=%s)', async clear => {
  const { player, port, output } = await setup('both', clear)
  const timers = vi.spyOn(globalThis, 'setTimeout'), subscribe = vi.spyOn(output, 'subscribeDemoInterrupted')
  player.start()
  const oldTimers = timers.mock.calls.map(([callback]) => callback as () => void), interrupted = subscribe.mock.calls.at(-1)![0]
  player.stop(); vi.advanceTimersByTime(5000)
  expect(port.send.mock.calls.at(-1)![0]).toEqual([0xb0, 123, 0])
  player.start()
  const state = player.getSnapshot(), diagnostics = player.getDiagnostics(), sends = port.send.mock.calls.length, clears = port.clear?.mock.calls.length
  for (const timer of oldTimers) timer()
  interrupted()
  expect(player.getSnapshot()).toBe(state); expect(player.getDiagnostics()).toEqual(diagnostics)
  expect(port.send).toHaveBeenCalledTimes(sends); expect(port.clear?.mock.calls.length).toBe(clears)
  expect(output.getSnapshot().playing).toBe(true)
  vi.runAllTimers(); expect(player.getSnapshot().status).toBe('completed')
  expect(output.getDiagnostics()).toMatchObject({ activeNotes: [], scheduledTimers: 0, demoActive: false })
})
it('visual exceptions and a delayed display do not stop music, clear MIDI or shift future timestamps', async () => {
  const { plan, practice, port, output } = await setup()
  const player = new DemoPlayer(output, practice.beginDemo, update => { update(); throw new Error('scroll unavailable') })
  player.loadPlan(plan); player.setSystems(systems); player.start()
  const token = player.getDiagnostics().generation
  vi.advanceTimersByTime(1000)
  const now = performance.now
  vi.spyOn(performance, 'now').mockImplementation(() => now.call(performance) + 500)
  vi.advanceTimersByTime(2000)
  expect(player.getSnapshot().status).toBe('playing')
  expect(player.getDiagnostics().generation).toBe(token)
  expect(player.getDiagnostics().visualErrors).toBeGreaterThan(0)
  expect(port.clear).not.toHaveBeenCalled()
  vi.runAllTimers(); expect(player.getSnapshot().status).toBe('completed')
  expect(output.getDiagnostics().activeNotes).toEqual([])
})
it('cancelled or replaced look-ahead callbacks cannot notify a new playback; exceptions stay visual-only', () => {
  vi.useFakeTimers()
  const timers = vi.spyOn(globalThis, 'setTimeout'), preview = new DemoPreviewScheduler()
  const event = { id: 'old', momentId: 'm', occurrenceIndex: 1, navigationJump: true, atMs: 0, dueMs: 100000 }
  const first = vi.fn(), second = vi.fn(() => { throw new Error('view') })
  preview.start([event], performance.now(), first)
  const old = timers.mock.calls.at(-1)![0] as () => void
  preview.start([event], performance.now(), second); old()
  expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled()
  expect(() => vi.runAllTimers()).not.toThrow()
  expect(second).toHaveBeenCalledTimes(1); expect(preview.pending).toBe(false)
})
