import { afterEach, expect, it, vi } from 'vitest'
import { practiceLookAhead, navigationJump } from '../../src/score/ScoreLookAhead'
import type { ScoreSystems } from '../../src/score/ScoreLookAhead'
import { lookAheadDelta } from '../../src/score/ScoreFollow'
import { lookAheadZoom } from '../../src/score/ScoreLayout'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { buildDemoPreviews, LOOKAHEAD_MS } from '../../src/audio/DemoLookAhead'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { parseFixture } from './xmlFixture'

afterEach(() => vi.useRealTimers())
const score = parseFixture('maim-maim-full-original')
// Pure planner tests inject layout identities; browser tests use actual OSMD systems.
const systems: ScoreSystems = new Map(score.moments.map(m => [m.id, { system: Math.floor(m.measureIndex / 4), measureIndex: m.measureIndex }]))
for (const mode of ['right', 'left', 'both'] as const) {
  const plan = createPracticePlan(score, mode)!, occurrences = plan.sequence.occurrences
  const at = (measure: number, pass = 1) => occurrences.findIndex(o => o.sourceMoment.measureIndex === measure && (o.repeatPass ?? 1) === pass)
  it(mode + ': prepares in the last playable measure, before next input, including the second repeat pass', () => {
    expect(practiceLookAhead(plan, at(0), systems)).toBeNull()
    for (const [current, next, pass] of [[3, 4, 1], [7, 8, 1], [7, 8, 2]]) {
      const target = practiceLookAhead(plan, at(current, pass), systems)!
      expect(target.momentId).toBe(occurrences[at(next, pass)].sourceMoment.id)
      expect(target.toIndex).toBeGreaterThan(at(current, pass))
      expect(target.navigationJump).toBe(false)
    }
    expect(practiceLookAhead(plan, occurrences.length - 1, systems)).toBeNull()
  })
  it(mode + ': detects a backward occurrence jump but practice does not preview until the correct strike', () => {
    const next = at(4, 2), current = next - 1
    expect(navigationJump(plan, current, next)).toBe(true)
    expect(navigationJump(plan, next, current)).toBe(false)
    expect(practiceLookAhead(plan, current, systems)).toBeNull()
    const session = new PracticeSession(); session.loadPlan(plan); session.start()
    for (const occurrence of occurrences.slice(0, current)) {
      for (const midiNote of occurrence.sourceTarget.expectedMidiNotes) {
        session.handleMidiEvent({ type: 'noteon', midiNote, channel: 1, velocity: 80, timestamp: 0 })
        session.handleMidiEvent({ type: 'noteoff', midiNote, channel: 1, velocity: 0, timestamp: 0 })
      }
    }
    expect(session.isBeforeNavigationJump()).toBe(true)
    for (const midiNote of occurrences[current].sourceTarget.expectedMidiNotes) {
      session.handleMidiEvent({ type: 'noteon', midiNote, channel: 1, velocity: 80, timestamp: 0 })
      session.handleMidiEvent({ type: 'noteoff', midiNote, channel: 1, velocity: 0, timestamp: 0 })
    }
    expect(session.getSnapshot().currentNoteIndex).toBe(next)
    expect(session.isBeforeNavigationJump()).toBe(false)
  })
  it(mode + ': demo prepares ordinary systems and jumps without editing MIDI times, including partial starts', () => {
    for (const start of [{ kind: 'beginning' }, { kind: 'measure', measureIndex: 3 }, { kind: 'occurrence', occurrenceId: occurrences[at(7, 2)].id }] as const) {
      const notes = buildDemoPlan(plan, start), before = structuredClone(notes)
      const previews = buildDemoPreviews(notes, plan, systems)
      expect(previews.length).toBeGreaterThan(0)
      for (const event of previews) {
        expect(event.atMs).toBeLessThan(event.dueMs)
        expect(event.dueMs - event.atMs).toBeLessThanOrEqual(LOOKAHEAD_MS + 0.001)
        if (event.navigationJump) {
          const last = notes.filter(n => n.startMs < event.dueMs).at(-1)!
          expect(event.atMs).toBeGreaterThan(last.startMs)
          expect(occurrences[event.occurrenceIndex].sourceMoment.measureIndex).toBe(4)
        }
      }
      expect(notes).toEqual(before)
    }
  })
}
it('tie-only and rest-only bars do not prevent the last playable bar triggering a preview', () => {
  const plan = createPracticePlan(score, 'right')!
  const index = plan.sequence.occurrences.findIndex(o => o.sourceMoment.measureIndex === 14)
  // Measure 16 contains no new right-hand attack; measure 15 is the last playable one.
  expect(practiceLookAhead(plan, index, systems)?.momentId).toBe(plan.sequence.occurrences.find(o => o.sourceMoment.measureIndex === 16)!.sourceMoment.id)
})
it('same system has no demo preview; layout changes determine transitions without measure-number rules', () => {
  const plan = createPracticePlan(score)!, notes = buildDemoPlan(plan, { kind: 'occurrence', occurrenceId: plan.sequence.occurrences.at(-5)!.id })
  const single = new Map(score.moments.map(m => [m.id, { system: 0, measureIndex: m.measureIndex }]))
  expect(buildDemoPreviews(notes, plan, single)).toEqual([])
  single.set(plan.sequence.occurrences.at(-1)!.sourceMoment.id, { system: 99, measureIndex: 29 })
  expect(buildDemoPreviews(notes, plan, single)).toHaveLength(1)
})
it.each([
  [200, 350, 410, 560, 100, 700, 0],
  [400, 550, 650, 800, 100, 700, 142.5],
  [100, 250, 750, 900, 100, 700, 0],
])('pair framing preserves current and fits next when space permits (%j)', (ct, cb, nt, nb, top, bottom, expected) => {
  const delta = lookAheadDelta(ct, cb, nt, nb, top, bottom)
  expect(delta).toBe(expected)
  expect(ct - delta).toBeGreaterThanOrEqual(top)
  expect(cb - delta).toBeLessThanOrEqual(bottom)
  if (nb - ct <= bottom - top) expect(nb - delta).toBeLessThanOrEqual(bottom)
})
it('measured zoom makes adjacent systems fit, with a readable lower bound', () => {
  const layout = { systems: new Map([['a', { system: 1, measureIndex: 0 }], ['b', { system: 2, measureIndex: 4 }]]),
    positions: new Map([['a', { top: 0, bottom: 220, left: 0, right: 10 }], ['b', { top: 400, bottom: 620, left: 0, right: 10 }]]) }
  expect(lookAheadZoom(layout, 1.35, 700)).toBe(1.35)
  expect(lookAheadZoom(layout, 1.35, 600)).toBeCloseTo(1.35 * 552 / 620)
  expect(lookAheadZoom(layout, 1.35, 300)).toBe(1)
})
it.each(['stop', 'replace', 'resize', 'complete'] as const)('demo preview keeps actual cursor and exact MIDI times; %s cancels stale work', action => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const plan = createPracticePlan(score)!, notes = buildDemoPlan(plan)
  const output = { beginDemo: () => true, playDemoNote: vi.fn(() => true), finishDemo: vi.fn(), stopAllNotes: vi.fn(), subscribeDemoInterrupted: () => () => {} }
  const player = new DemoPlayer(output); player.loadPlan(plan); player.setSystems(systems)
  const observations: { index: number; moment: string | null; at: number; preview: number }[] = []
  player.subscribe(() => { const state = player.getSnapshot(); if (state.preview) observations.push({ index: state.currentNoteIndex, moment: state.cursorMomentId, at: performance.now(), preview: state.preview.occurrenceIndex }) })
  player.start()
  const event = buildDemoPreviews(notes, plan, systems)[0]
  vi.advanceTimersByTime(Math.ceil(event.atMs))
  expect(observations.length).toBeGreaterThan(0)
  expect(observations.at(-1)!.index).toBeLessThan(event.occurrenceIndex)
  expect(observations.at(-1)!.moment).not.toBe(event.momentId)
  if (action === 'resize') {
    for (let i = 0; i < 5; i++) player.setSystems(new Map(systems))
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2)
  }
  if (action === 'stop') player.stop()
  else if (action === 'replace') player.loadPlan(createPracticePlan(parseFixture('a-simple')))
  else {
    vi.runAllTimers()
    expect(player.getSnapshot().status).toBe('completed')
    expect(output.playDemoNote.mock.calls).toEqual(notes.map(n => [n.midiNote, n.startMs, n.noteOffMs]))
  }
  const count = observations.length, sent = output.playDemoNote.mock.calls.length
  vi.advanceTimersByTime(120000)
  expect(observations).toHaveLength(count); expect(output.playDemoNote).toHaveBeenCalledTimes(sent)
  expect(player.getSnapshot().preview).toBeNull(); expect(vi.getTimerCount()).toBe(0)
})
