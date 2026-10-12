import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveTempo, millisecondsAtBeat } from '../../src/audio/tempo'
import { PLAYBACK_RATES } from '../../src/audio/playbackRate'
import type { PlaybackRate } from '../../src/audio/playbackRate'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { buildDemoPreviews } from '../../src/audio/DemoLookAhead'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import type { PracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { DuetController } from '../../src/practice/DuetController'
import { buildDuetTimeline } from '../../src/practice/DuetPlan'
import { resolvePracticeStart } from '../../src/practice/PracticeStartResolver'
import { parseFixture, parseXml, noteXml, scoreXml } from './xmlFixture'

afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers() })
const builtIn = (name: string) => parseXml(readFileSync(new URL(`../../src/scores/${name}.musicxml`, import.meta.url), 'utf8'))
function strike(session: PracticeSession, pitches: readonly number[]) {
  for (const midiNote of pitches) session.handleMidiEvent({ type: 'noteon', midiNote, channel: 1, velocity: 80, timestamp: performance.now() })
  for (const midiNote of pitches) session.handleMidiEvent({ type: 'noteoff', midiNote, channel: 1, velocity: 0, timestamp: performance.now() })
}
async function outputSetup(clear = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const port = { id: 'cme', name: 'CME', state: 'connected', open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), send: vi.fn(), clear: clear ? vi.fn() : undefined }
  const output = new MidiOutputManager()
  output.attachAccess({ outputs: new Map([['cme', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  const session = new PracticeSession()
  const ons = () => port.send.mock.calls.filter(([d]) => d[0] === 0x90)
  const offs = () => port.send.mock.calls.filter(([d]) => d[0] === 0x80)
  return { port, output, session, ons, offs }
}

for (const rate of PLAYBACK_RATES) {
  it(`${rate * 100}%: scales XML changes and fallback tempos without rewriting the score`, () => {
    const score = parseXml(scoreXml('<direction><sound tempo="120"/></direction>' + noteXml('C', 2, '<tie type="start"/>') + '<direction><sound tempo="60"/></direction>' + noteXml('C', 2, '<tie type="stop"/>') + '<note><rest/><duration>1</duration></note>' + noteXml('G', 1)))
    const original = JSON.stringify(score), points = resolveTempo(score, 200, rate)
    expect(points.map(p => [p.beat, p.bpm, p.source])).toEqual([[0, 120 * rate, 'MusicXML'], [2, 60 * rate, 'MusicXML']])
    expect(millisecondsAtBeat(points, 4)).toBeCloseTo(3000 / rate, 7)
    const plan = createPracticePlan(score)!, notes = buildDemoPlan(plan, { kind: 'beginning' }, rate)
    expect(notes[0].durationMs).toBeCloseTo(3000 / rate, 7)
    expect(notes[0].noteOffMs).toBeCloseTo(2800 / rate, 7) // gate only the final tied segment
    expect(notes[1].startMs).toBeCloseTo(4000 / rate, 7) // preserve the rest
    const noTempo = parseFixture('a-simple')
    expect(resolveTempo(noTempo, 80, rate)[0]).toMatchObject({ bpm: 80 * rate, source: 'Song metadata' })
    expect(resolveTempo(noTempo, undefined, rate)[0]).toMatchObject({ bpm: 100 * rate, source: 'default' })
    expect(JSON.stringify(score)).toBe(original)
  })

  it(`${rate * 100}%: every note, tie, rest, chord and partial/repeated start scales by the same factor`, () => {
    for (const score of [parseFixture('h-ties'), parseFixture('e-rest'), parseFixture('g-piano-practice'), builtIn('harvest-time'), builtIn('duet/maim-maim-primo-original')]) {
      const plan = createPracticePlan(score)!
      const pass2 = plan.sequence.occurrences.find(o => o.repeatPass === 2)
      const starts = [{ kind: 'beginning' } as const, { kind: 'measure', measureIndex: score.measures.length - 1 } as const,
        { kind: 'current', occurrenceIndex: pass2?.sequenceIndex ?? Math.min(1, plan.sequence.occurrences.length - 1), completed: false } as const]
      for (const start of starts) {
        const normal = buildDemoPlan(plan, start), scaled = buildDemoPlan(plan, start, rate)
        expect(scaled).toHaveLength(normal.length)
        scaled.forEach((n, i) => {
          expect([n.index, n.midiNote, n.cursorMomentId]).toEqual([normal[i].index, normal[i].midiNote, normal[i].cursorMomentId])
          for (const field of ['startMs', 'durationMs', 'noteOffMs'] as const) expect(n[field]).toBeCloseTo(normal[i][field] / rate, 6)
        })
      }
      const systems = new Map(score.moments.map(m => [m.id, { system: m.measureIndex, measureIndex: m.measureIndex }]))
      const notes = buildDemoPlan(plan, { kind: 'beginning' }, rate)
      for (const event of buildDemoPreviews(notes, plan, systems)) {
        expect(event.dueMs).toBe(notes.find(n => n.index === event.occurrenceIndex)!.startMs)
        expect(event.atMs).toBeLessThan(event.dueMs)
      }
    }
  })

  it(`${rate * 100}%: the MIDI demo and cursor use the scaled clock, finish at the last Off and restore grading`, async () => {
    const c = await outputSetup(), plan = createPracticePlan(builtIn('twinkle'))!
    c.session.loadPlan(plan); c.session.start(); strike(c.session, [60])
    const player = new DemoPlayer(c.output, c.session.beginDemo)
    player.subscribe(() => { if (player.getSnapshot().status !== 'playing') c.session.endDemo() })
    player.loadPlan(plan)
    c.port.send.mockImplementation(d => { if (d[0] === 0x90) strike(c.session, [d[1]]) })
    const notes = buildDemoPlan(plan, { kind: 'beginning' }, rate)
    player.start({ kind: 'beginning' }, rate)
    vi.advanceTimersByTime(Math.floor(notes[1].startMs) - 1)
    expect(player.getSnapshot().currentNoteIndex).toBe(0)
    vi.advanceTimersByTime(2)
    expect(player.getSnapshot().currentNoteIndex).toBe(1)
    const end = Math.max(...notes.map(n => n.noteOffMs))
    vi.advanceTimersByTime(end - performance.now() - 1)
    expect(player.getSnapshot().status).toBe('playing')
    vi.advanceTimersByTime(2)
    expect(player.getSnapshot().status).toBe('completed')
    expect(c.session.getSnapshot()).toMatchObject({ status: 'practicing', currentNoteIndex: 1, correctNoteCount: 1 })
    expect(c.ons().map(([d]) => d[1])).toEqual(notes.map(n => n.midiNote))
    c.ons().forEach(([, t], i) => expect(t).toBeCloseTo(notes[i].startMs, 6))
    c.offs().forEach(([, t], i) => expect(t).toBeCloseTo(notes[i].noteOffMs, 6))
    expect(player.getDiagnostics().scheduledTimers).toBe(0)
    expect(c.output.getDiagnostics().activeNotes).toEqual([])
  })

  for (const part of ['primo', 'secondo'] as const) for (const version of ['once', 'original']) {
    it(`${rate * 100}% ${part} ${version}: scaled partner notes, own targets and repeats stay synchronized through completion`, async () => {
      const c = await outputSetup()
      const own = createPracticePlan(builtIn(`duet/maim-maim-${part}-${version}`))!
      const partner = createPracticePlan(builtIn(`duet/maim-maim-${part === 'primo' ? 'secondo' : 'primo'}-${version}`))!
      const baseline = buildDuetTimeline(own, partner), timeline = buildDuetTimeline(own, partner, rate)
      expect(timeline.endMs).toBeCloseTo(baseline.endMs / rate, 6)
      timeline.targetStarts.forEach((t, i) => expect(t).toBeCloseTo(baseline.targetStarts[i] / rate, 6))
      const controller = new DuetController(c.output, c.session)
      c.session.loadPlan(own); controller.loadPlans(own, partner)
      expect(controller.start({ kind: 'beginning' }, true, rate)).toBe(true)
      for (let i = 0; i < own.sequence.occurrences.length; i++) {
        expect(c.session.getSnapshot().currentNoteIndex).toBe(i)
        strike(c.session, own.sequence.occurrences[i].sourceTarget.expectedMidiNotes)
        expect(c.session.getSnapshot().correctNoteCount).toBe(i) // wait until the existing target boundary
        vi.advanceTimersByTime(Math.max(0, Math.ceil(timeline.targetStarts[i + 1] ?? timeline.endMs) - performance.now()))
      }
      expect(c.session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: own.sequence.occurrences.length })
      expect(c.ons().map(([d]) => d[1])).toEqual(timeline.notes.map(n => n.midiNote))
      c.ons().forEach(([, t], i) => expect(t).toBeCloseTo(baseline.notes[i].startMs / rate, 6))
      c.offs().forEach(([, t], i) => expect(t).toBeCloseTo(baseline.notes[i].noteOffMs / rate, 6))
      expect(c.port.clear).not.toHaveBeenCalled() // no accidental stop at a repeat
      expect(controller.getDiagnostics().timers).toBe(0)
    })
  }

  it(`${rate * 100}%: incorrect input waits silently; a late correct input resumes, and pass-2 current/measure starts remain valid`, async () => {
    const c = await outputSetup(), own = createPracticePlan(builtIn('duet/maim-maim-primo-original'))!
    const partner = createPracticePlan(builtIn('duet/maim-maim-secondo-original'))!
    const controller = new DuetController(c.output, c.session), timeline = buildDuetTimeline(own, partner, rate)
    c.session.loadPlan(own); controller.loadPlans(own, partner)
    controller.start({ kind: 'beginning' }, true, rate); strike(c.session, [60])
    vi.advanceTimersByTime(Math.ceil(timeline.targetStarts[1]) + 1)
    expect(controller.getSnapshot().status).toBe('waiting')
    expect(c.session.getSnapshot()).toMatchObject({ correctNoteCount: 0, currentNoteIndex: 0 })
    const quiet = c.ons().length
    vi.advanceTimersByTime(5000); expect(c.ons()).toHaveLength(quiet)
    strike(c.session, [79])
    expect(c.session.getSnapshot()).toMatchObject({ correctNoteCount: 1, currentNoteIndex: 1 })
    controller.stop(); c.session.setFlowMode('run-through')
    for (const start of [{ kind: 'measure', measureIndex: 29 } as const,
      { kind: 'current', occurrenceIndex: own.sequence.occurrences.findIndex(o => o.repeatPass === 2) } as const]) {
      c.session.setStartTarget(resolvePracticeStart(own, start).resolvedOccurrenceIndex)
      const before = c.ons().length, began = performance.now()
      const origin = start.kind === 'measure' ? timeline.measureStarts[29] : timeline.targetStarts[start.occurrenceIndex]
      controller.start(start, true, rate)
      vi.advanceTimersByTime(Math.ceil(timeline.endMs - origin) + 1)
      const expected = timeline.notes.filter(n => n.noteOffMs > origin)
      expect(c.ons().slice(before).map(([d]) => d[1])).toEqual(expected.map(n => n.midiNote))
      c.ons().slice(before).forEach(([, t], i) => expect(t).toBeCloseTo(began + Math.max(0, expected[i].startMs - origin), 6))
      expect(c.session.getSnapshot().status).toBe('completed')
    }
  })

  it(`${rate * 100}%: silent timed duet uses the selected speed and still records missing notes`, async () => {
    const c = await outputSetup(), own = createPracticePlan(builtIn('duet/maim-maim-primo-once'))!
    const partner = createPracticePlan(builtIn('duet/maim-maim-secondo-once'))!
    const controller = new DuetController(c.output, c.session), timeline = buildDuetTimeline(own, partner, rate)
    c.session.loadPlan(own); controller.loadPlans(own, partner); c.session.setFlowMode('run-through')
    controller.start({ kind: 'beginning' }, false, rate)
    vi.advanceTimersByTime(Math.floor(timeline.targetStarts[1]) - 1)
    expect(c.session.getSnapshot().currentNoteIndex).toBe(0)
    vi.advanceTimersByTime(2)
    expect(c.session.getSnapshot().attempts[0]).toMatchObject({ result: 'incorrect', missingMidiNotes: [79] })
    vi.advanceTimersByTime(Math.ceil(timeline.endMs) - performance.now() + 1)
    expect(c.session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: 0 })
    expect(c.session.getSnapshot().attempts).toHaveLength(118)
    expect(c.ons()).toHaveLength(0)
  })
}

it.each([true, false])('changing speed between stopped sessions drains Offs and ignores old demo/duet callbacks (clear=%s)', async clear => {
  const c = await outputSetup(clear), plan = createPracticePlan(builtIn('twinkle'))!
  const player = new DemoPlayer(c.output), timers = vi.spyOn(globalThis, 'setTimeout')
  player.loadPlan(plan); player.start({ kind: 'beginning' }, 0.5)
  const oldDemo = timers.mock.calls.map(([fn]) => fn as () => void)
  player.stop()
  expect(c.port.send.mock.calls.some(([d]) => d.join(',') === '176,123,0')).toBe(true)
  if (!clear) expect(c.output.getSnapshot().playing).toBe(true)
  vi.advanceTimersByTime(1200); player.start({ kind: 'beginning' }, 0.75)
  const state = player.getSnapshot(), count = c.ons().length
  oldDemo.forEach(fn => fn())
  expect(player.getSnapshot()).toBe(state); expect(c.ons()).toHaveLength(count)
  expect(c.offs().at(-1)![1] - c.ons().at(-1)![1]).toBeCloseTo(720, 6)
  player.stop(); vi.advanceTimersByTime(1000)
  const own = createPracticePlan(builtIn('duet/maim-maim-primo-once'))!
  const partner = createPracticePlan(builtIn('duet/maim-maim-secondo-once'))!
  const controller = new DuetController(c.output, c.session)
  c.session.loadPlan(own); controller.loadPlans(own, partner); c.session.setFlowMode('run-through')
  timers.mockClear(); controller.start({ kind: 'beginning' }, true, 0.5)
  const oldDuet = timers.mock.calls.map(([fn]) => fn as () => void)
  controller.stop(); vi.advanceTimersByTime(2000)
  controller.start({ kind: 'beginning' }, true, 1)
  const fresh = c.session.getSnapshot(), sent = c.ons().length
  oldDuet.forEach(fn => fn())
  expect(c.session.getSnapshot()).toBe(fresh); expect(c.ons()).toHaveLength(sent)
  controller.stop(); vi.advanceTimersByTime(120000)
  expect(c.ons()).toHaveLength(sent); expect(c.output.getDiagnostics().activeNotes).toEqual([])
})

it.each([0, -1, 0.6, 2, NaN, Infinity])('rejects unsupported playback rate %s before output', value => {
  const rate = value as PlaybackRate, plan: PracticePlan = createPracticePlan(parseFixture('a-simple'))!
  expect(() => buildDemoPlan(plan, { kind: 'beginning' }, rate)).toThrow('Invalid playback rate')
  expect(() => buildDuetTimeline(plan, plan, rate)).toThrow('Invalid playback rate')
})
