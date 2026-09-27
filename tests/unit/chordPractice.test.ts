import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { CHORD_WINDOW_MS } from '../../src/practice/MomentMatcher'
import { SongSelection } from '../../src/score/SongSelection'
import type { Song } from '../../src/songs/Song'
import { parseFixture, parseXml, scoreXml, noteXml } from './xmlFixture'

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }))
afterEach(() => vi.useRealTimers())
function setup(name = 'b-chord') {
  const plan = createPracticePlan(parseFixture(name))!
  const session = new PracticeSession(); session.loadPlan(plan); session.start()
  return { session, plan }
}
function send(session: PracticeSession, pitch: number, release = false) {
  session.handleMidiEvent({ midiNote: pitch, type: release ? 'noteoff' : 'noteon', velocity: release ? 0 : 80, channel: 1, timestamp: performance.now() })
}

it('single target succeeds immediately and a wrong pitch never advances', () => {
  const { session } = setup('a-simple')
  send(session, 61); expect(session.getSnapshot().currentNoteIndex).toBe(0)
  send(session, 60); expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 1, correctNoteCount: 1 })
  expect(vi.getTimerCount()).toBe(0)
})
it.each([[60, 64, 67], [67, 60, 64], [64, 67, 60]])('a chord in any order %s completes once at the inclusive 300ms boundary', (...notes) => {
  const { session } = setup()
  send(session, notes[0]); vi.advanceTimersByTime(150); send(session, notes[1])
  expect(session.getSnapshot().correctNoteCount).toBe(0)
  vi.advanceTimersByTime(CHORD_WINDOW_MS - 150); send(session, notes[2])
  expect(session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: 1, currentNoteIndex: 0 })
  notes.forEach((note) => { send(session, note, true); send(session, note) })
  vi.advanceTimersByTime(1000)
  expect(session.getSnapshot().correctNoteCount).toBe(1)
})
it('missing pitches time out without further input; retry requires fresh strikes', () => {
  const { session } = setup()
  send(session, 60); send(session, 64)
  vi.advanceTimersByTime(301)
  expect(session.getSnapshot()).toMatchObject({ feedback: 'incorrect', correctNoteCount: 0 })
  send(session, 60); send(session, 64); send(session, 67)
  expect(session.getSnapshot().correctNoteCount).toBe(0)
  vi.advanceTimersByTime(301)
  for (const note of [60, 64, 67]) send(session, note, true)
  for (const note of [60, 64, 67]) send(session, note)
  expect(session.getSnapshot().status).toBe('completed')
})
it('an unexpected pitch fails the entire attempt and clears previously collected notes', () => {
  const { session } = setup()
  send(session, 60); send(session, 64); send(session, 69)
  expect(session.getSnapshot().feedback).toBe('incorrect')
  send(session, 67)
  expect(session.getSnapshot().correctNoteCount).toBe(0)
  session.restart()
  for (const note of [60, 64, 67, 69]) send(session, note, true)
  for (const note of [67, 64, 60]) send(session, note)
  expect(session.getSnapshot().correctNoteCount).toBe(1)
})
it('duplicate Note Ons cannot replace a missing pitch', () => {
  const { session } = setup()
  for (let i = 0; i < 10; i++) { send(session, 60); send(session, 64) }
  expect(session.getSnapshot().correctNoteCount).toBe(0)
  send(session, 67)
  expect(session.getSnapshot().correctNoteCount).toBe(1)
})
it.each(['restart', 'clearActiveNotes', 'beginDemo', 'dispose'] as const)('%s invalidates partial chord timers', (action) => {
  const { session } = setup()
  send(session, 60); session[action]()
  const before = session.getSnapshot()
  vi.advanceTimersByTime(1000)
  expect(session.getSnapshot()).toBe(before)
})
it('demo input cannot score and switching songs clears the old chord attempt', () => {
  const { session } = setup()
  send(session, 60)
  session.beginDemo()
  for (const note of [60, 64, 67]) { send(session, note, true); send(session, note) }
  expect(session.getSnapshot().correctNoteCount).toBe(0)
  session.loadPlan(createPracticePlan(parseFixture('a-simple')))
  vi.advanceTimersByTime(1000)
  expect(session.getSnapshot()).toMatchObject({ status: 'idle', feedback: null, totalNotes: 3 })
})
it('filters right/left/both, skips other-staff moments and never mutates the score', () => {
  const score = parseFixture('g-piano-practice'), before = JSON.stringify(score)
  expect(score).toMatchObject({ staffCount: 2, totalBeats: 8, tempoBpm: 100 })
  expect(score.notes).toHaveLength(18); expect(score.moments).toHaveLength(6)
  const right = createPracticePlan(score, 'right')!, left = createPracticePlan(score, 'left')!, both = createPracticePlan(score)!
  expect(right.targets.map((target) => target.onsetBeats)).toEqual([0, 1, 2, 4, 6])
  expect(left.targets.map((target) => target.onsetBeats)).toEqual([0, 2, 4, 5, 6])
  expect(both.targets).toHaveLength(6)
  expect(right.targets[0].expectedMidiNotes).toEqual([72, 76, 79])
  expect(left.targets[0].expectedMidiNotes).toEqual([48, 55])
  expect(both.targets[0].expectedMidiNotes).toEqual([48, 55, 72, 76, 79])
  expect(JSON.stringify(score)).toBe(before)
})
it.each(['right', 'left', 'both'] as const)('%s practice completes at its final target and wrong-staff notes are not credited', (mode) => {
  const plan = createPracticePlan(parseFixture('g-piano-practice'), mode)!
  const session = new PracticeSession(); session.loadPlan(plan); session.start()
  if (mode !== 'both') { send(session, mode === 'right' ? 48 : 72); expect(session.getSnapshot().feedback).toBe('incorrect') }
  for (const target of plan.targets) for (const note of target.expectedMidiNotes) { send(session, note); send(session, note, true) }
  expect(session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: plan.targets.length, currentNoteIndex: plan.targets.length - 1 })
  send(session, 0); send(session, 127)
  expect(session.getSnapshot().correctNoteCount).toBe(plan.targets.length)
})
it('deduplicates physical keys while keeping every source note', () => {
  const score = parseXml(scoreXml(noteXml('C', 1, '<voice>1</voice>') + '<backup><duration>1</duration></backup>' + noteXml('C', 1, '<voice>2</voice><staff>2</staff>')))
  const plan = createPracticePlan(score)!
  expect(plan.targets[0].expectedMidiNotes).toEqual([60])
  expect(plan.targets[0].sourceNotes).toHaveLength(2)
})
it('rest and tie-only moments do not become input steps; stop+start ties need no new press', () => {
  const rest = createPracticePlan(parseFixture('e-rest'))!
  expect(rest.targets.map((target) => target.onsetBeats)).toEqual([1])
  const tied = createPracticePlan(parseFixture('h-ties'))!
  expect(tied.targets.map((target) => [target.onsetBeats, target.expectedMidiNotes])).toEqual([[0, [60, 64]], [2, [67]]])
  expect(tied.targets[1].sourceNotes).toHaveLength(2)
})
it('a staff with only rests has an empty safe plan', () => {
  const score = parseXml(scoreXml(noteXml()).replace('<divisions>1</divisions>', '<divisions>1</divisions><staves>2</staves>'))
  const plan = createPracticePlan(score, 'left')!
  expect(plan.targets).toEqual([])
  const session = new PracticeSession(); session.loadPlan(plan); session.start()
  expect(session.getSnapshot().status).toBe('idle')
})
it.each(['arpeggiate', 'ornaments', 'time-modification'])('%s remains explicitly unsupported for normal chord practice', (tag) => {
  const score = parseXml(scoreXml(noteXml('C', 1, `<notations><${tag}/></notations>`)))
  expect(score.warnings.length).toBeGreaterThan(0)
  expect(createPracticePlan(score)).toBeNull()
})
it('mode change resets progress and a partial chord, preserves XML/model and invalidates the old timeout', async () => {
  const score = parseFixture('g-piano-practice'), session = new PracticeSession()
  const song: Song = { id: score.id, title: score.title, partLabel: '', source: 'imported', musicXml: { type: 'text', value: score.musicXml } }
  const reset = vi.fn(() => session.loadPlan(null))
  const selection = new SongSelection(null, { reset, apply: session.loadPlan })
  await selection.select(song); selection.ready(selection.getSnapshot().requestId, score)
  session.start(); send(session, 72)
  selection.setMode('left')
  expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 0, correctNoteCount: 0, status: 'idle', expectedMidiNotes: [48, 55], feedback: null })
  vi.advanceTimersByTime(1000)
  expect(session.getSnapshot().feedback).toBeNull()
  expect(selection.getSnapshot()).toMatchObject({ mode: 'left', model: score })
  expect(reset).toHaveBeenCalledTimes(2)
})
