import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { DemoMidiTrace } from '../../src/midi/DemoMidiTrace'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import type { PracticeMode } from '../../src/practice/PracticePlan'
import { seekScoreCursor } from '../../src/score/seekScoreCursor'
import { parseFixture, parseXml, noteXml, scoreXml } from './xmlFixture'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
const original = parseFixture('maim-maim-full-original')
async function setup(mode: PracticeMode = 'both', clear = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const port = { id: 'cme', name: 'CME', state: 'connected', open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), send: vi.fn(), clear: clear ? vi.fn() : undefined }
  const output = new MidiOutputManager(); output.attachAccess({ outputs: new Map([['cme', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  const plan = createPracticePlan(original, mode)!, player = new DemoPlayer(output)
  player.loadPlan(plan)
  return { port, output, plan, player }
}

for (const mode of ['right', 'left', 'both'] as const) for (const measure of [29, 30]) it(mode + ': from ' + measure + ', complete boundary messages, Off-before-On and uninterrupted absolute timeline', async () => {
  const { port, output, plan, player } = await setup(mode), start = { kind: 'measure' as const, measureIndex: measure - 1 }, notes = buildDemoPlan(plan, start)
  const second = plan.sequence.occurrences.find(o => o.repeatPass === 2)!
  const firstFive = notes.find(n => n.index === second.sequenceIndex)!
  player.start(start)
  const generation = player.getDiagnostics().generation
  vi.advanceTimersByTime(Math.ceil(firstFive.startMs))
  expect(player.getSnapshot().status).toBe('playing')
  expect(player.getDiagnostics().generation).toBe(generation)
  const trace = output.trace.read(), ons = trace.filter(e => e.event === 'NOTE_ON'), offs = trace.filter(e => e.event === 'NOTE_OFF')
  const lastPass = notes.filter(n => n.index < second.sequenceIndex)
  for (const n of lastPass) expect(offs).toContainEqual(expect.objectContaining({ pitch: n.midiNote, timestamp: n.noteOffMs, generation }))
  const nextOnset = notes.filter(n => n.startMs === firstFive.startMs)
  expect(ons.filter(e => e.sequenceIndex === second.sequenceIndex).map(e => e.pitch)).toEqual(nextOnset.map(n => n.midiNote))
  expect(output.getDiagnostics().activeNotes.sort((a, b) => a - b)).toEqual(nextOnset.map(n => n.midiNote).sort((a, b) => a - b))
  for (const n of nextOnset) {
    const previous = lastPass.filter(p => p.midiNote === n.midiNote).at(-1)
    if (previous) {
      const off = offs.find(e => e.pitch === n.midiNote && e.timestamp === previous.noteOffMs)!, on = ons.find(e => e.pitch === n.midiNote && e.timestamp === n.startMs)!
      expect(off.timestamp!).toBeLessThanOrEqual(on.timestamp!); expect(off.order).toBeLessThan(on.order)
    }
  }
  const six = notes.find(n => plan.sequence.occurrences[n.index].repeatPass === 2 && plan.sequence.occurrences[n.index].sourceMoment.measureNumber === '6')!
  vi.advanceTimersByTime(Math.ceil(six.startMs) + 1 - performance.now())
  const expected = notes.filter(n => n.startMs <= six.startMs)
  expect(port.send.mock.calls.filter(([data]) => data[0] === 0x90)).toEqual(expected.map(n => [[0x90, n.midiNote, 80], n.startMs]))
  expect(output.trace.read().filter(e => ['CLEAR', 'ALL_NOTES_OFF', 'STOP', 'GENERATION_CHANGE', 'SKIP'].includes(e.event) && e.order > trace.find(e => e.event === 'START')!.order)).toEqual([])
  expect(output.trace.read().filter(e => e.event === 'REPEAT_JUMP')).toHaveLength(1)
  if (process.env.WRITE_DEMO_AUDIT === '1') writeFileSync(new URL(`../../docs/PHASE2ED332-${mode}-${measure}.json`, import.meta.url), JSON.stringify({ mode, fromMeasure: measure, expected, trace: output.trace.read() }, null, 2) + '\n')
  if (port.clear) expect(port.clear).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(player.getSnapshot().status).toBe('completed')
  expect(output.getDiagnostics()).toMatchObject({ activeNotes: [], scheduledTimers: 0 })
  expect(vi.getTimerCount()).toBe(0)
})

it('slow position commit cannot erase the boundary onset or split its chord', async () => {
  const { output, plan, port } = await setup('right')
  const second = plan.sequence.occurrences.find(o => o.repeatPass === 2)!.sequenceIndex
  let delayed = false
  const player = new DemoPlayer(output, undefined, update => {
    update()
    if (!delayed && player.getSnapshot().currentNoteIndex === second) { delayed = true; vi.advanceTimersByTime(180) }
  })
  player.loadPlan(plan); player.start({ kind: 'measure', measureIndex: 29 }); vi.runAllTimers()
  expect(delayed).toBe(true)
  const expected = buildDemoPlan(plan, { kind: 'measure', measureIndex: 29 })
  expect(port.send.mock.calls.filter(([data]) => data[0] === 0x90)).toEqual(expected.map(n => [[0x90, n.midiNote, 80], n.startMs]))
  expect(player.getDiagnostics().skippedNotes).toBe(0)
})

it('a slow output display subscriber runs only after every voice of a chord has been sent', async () => {
  const { output, plan, player, port } = await setup('right')
  let delayed = false
  output.subscribe(() => {
    const e = output.trace.read().at(-1)
    if (!delayed && e?.measure === '5' && e.repeatPass === 2 && output.getSnapshot().latestMessage?.type === 'noteon') { delayed = true; vi.advanceTimersByTime(180) }
  })
  player.start({ kind: 'measure', measureIndex: 29 }); vi.runAllTimers()
  expect(delayed).toBe(true)
  const expected = buildDemoPlan(plan, { kind: 'measure', measureIndex: 29 })
  expect(port.send.mock.calls.filter(([data]) => data[0] === 0x90)).toEqual(expected.map(n => [[0x90, n.midiNote, 80], n.startMs]))
  expect(player.getDiagnostics().skippedNotes).toBe(0)
})

it('an already-expired short voice skips the whole late onset without stopping or sending a partial chord', async () => {
  const { output, player } = await setup()
  const score = parseXml(scoreXml(noteXml('C', 8) + noteXml('D', 8) + noteXml('F', 1).replace('<note>', '<note><chord/>') + noteXml('E', 8), '8'))
  player.loadPlan(createPracticePlan(score)); player.start()
  const now = performance.now
  vi.spyOn(performance, 'now').mockImplementation(() => now.call(performance) + 100)
  vi.advanceTimersByTime(600)
  expect(player.getSnapshot().status).toBe('playing')
  expect(output.trace.read().filter(e => e.event === 'SKIP').map(e => e.pitch)).toEqual([62, 65])
  expect(output.trace.read().filter(e => e.event === 'NOTE_ON').map(e => e.pitch)).toEqual([60])
  vi.runAllTimers(); expect(player.getSnapshot().status).toBe('completed')
})

it('equal-time same-pitch release was queued before the next attack, without changing its timestamp', async () => {
  const { output, port } = await setup()
  output.beginDemo(); output.playDemoNote(60, 0, 600)
  vi.advanceTimersByTime(600)
  output.playDemoNote(60, 600, 1200)
  expect(port.send.mock.calls).toEqual([[[0x90, 60, 80], 0], [[0x80, 60, 0], 600], [[0x90, 60, 80], 600], [[0x80, 60, 0], 1200]])
  vi.advanceTimersByTime(600); output.finishDemo()
  expect(output.getDiagnostics()).toMatchObject({ activeNotes: [], scheduledTimers: 0 })
})

it.each([true, false])('same-pitch repeat retains the gate, queues old Off first, and explicit stop still silences everything (clear=%s)', async clear => {
  const { player, port, output } = await setup('both', clear)
  const chord = noteXml('C') + noteXml('E').replace('<note>', '<note><chord/>') + noteXml('G').replace('<note>', '<note><chord/>')
  const score = parseXml(`<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes><barline location="left"><repeat direction="forward"/></barline>${chord}</measure><measure number="2">${chord}<barline location="right"><repeat direction="backward"/></barline></measure></part></score-partwise>`)
  const plan = createPracticePlan(score)!, notes = buildDemoPlan(plan)
  player.loadPlan(plan); player.start()
  vi.advanceTimersByTime(1200)
  const sent = port.send.mock.calls
  for (const pitch of [60, 64, 67]) {
    const off = sent.findIndex(([data, at]) => data[0] === 0x80 && data[1] === pitch && at === 1140)
    const on = sent.findIndex(([data, at]) => data[0] === 0x90 && data[1] === pitch && at === 1200)
    expect(off).toBeGreaterThanOrEqual(0); expect(on).toBeGreaterThan(off)
  }
  expect(notes.filter(n => n.startMs === 600).map(n => n.noteOffMs)).toEqual([1140, 1140, 1140])
  expect(output.getDiagnostics().activeNotes).toEqual([60, 64, 67])
  if (port.clear) expect(port.clear).not.toHaveBeenCalled()
  player.stop()
  expect(port.send.mock.calls.at(-1)![0]).toEqual([0xb0, 123, 0])
  const count = port.send.mock.calls.length
  vi.runAllTimers(); expect(port.send).toHaveBeenCalledTimes(count)
  expect(output.getDiagnostics().activeNotes).toEqual([])
})

it('old output-display callbacks cannot stop or clear a new pass; a song change still sends CC123', async () => {
  const { player, output, port, plan } = await setup()
  const timers = vi.spyOn(globalThis, 'setTimeout')
  player.start({ kind: 'measure', measureIndex: 29 })
  const oldDisplay = timers.mock.calls[0][0] as () => void
  const second = plan.sequence.occurrences.find(o => o.repeatPass === 2)!
  const onset = buildDemoPlan(plan, { kind: 'measure', measureIndex: 29 }).find(n => n.index === second.sequenceIndex)!
  vi.advanceTimersByTime(Math.ceil(onset.startMs))
  const state = output.getSnapshot(), count = port.send.mock.calls.length, generation = player.getDiagnostics().generation
  oldDisplay()
  expect(output.getSnapshot()).toBe(state); expect(port.send).toHaveBeenCalledTimes(count)
  expect(player.getDiagnostics().generation).toBe(generation)
  player.loadPlan(createPracticePlan(parseFixture('a-simple')))
  expect(port.send.mock.calls.at(-1)![0]).toEqual([0xb0, 123, 0])
  const stopped = port.send.mock.calls.length
  vi.runAllTimers(); expect(port.send).toHaveBeenCalledTimes(stopped)
})

it('a large cursor seek traverses model positions but performs only one visible update', () => {
  let hidden = false, renders = 0, position = 110
  const cursor = { hide: () => { hidden = true }, show: () => { hidden = false; renders++ },
    next: () => { position++; if (!hidden) renders++ }, previous: () => { position--; if (!hidden) renders++ } }
  expect(seekScoreCursor(cursor, position, 12)).toBe(12)
  expect(position).toBe(12); expect(renders).toBe(1)
})

it('trace is bounded, detached from UI, and returns immutable snapshots of send requests', () => {
  const trace = new DemoMidiTrace()
  for (let i = 0; i < 2200; i++) trace.record('NOTE_ON', { pitch: 60, timestamp: i })
  const first = trace.read()
  expect(first).toHaveLength(2048); expect(first[0].order).toBe(153)
  first[0].pitch = 99
  expect(trace.read()[0].pitch).toBe(60)
})
