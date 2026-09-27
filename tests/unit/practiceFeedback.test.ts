import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MomentMatcher } from '../../src/practice/MomentMatcher'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { missingSourceNoteIds } from '../../src/score/ScoreNoteRenderMap'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { resolveDemoStart } from '../../src/audio/DemoStart'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { parseFixture, parseXml, scoreXml, noteXml } from './xmlFixture'

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }))
afterEach(() => vi.useRealTimers())
const press = (session: PracticeSession, midiNote: number, off = false) => session.handleMidiEvent({ type: off ? 'noteoff' : 'noteon', channel: 1, midiNote, velocity: off ? 0 : 80, timestamp: performance.now() })
const setup = () => { const plan = createPracticePlan(parseFixture('b-chord'))!; const session = new PracticeSession(); session.loadPlan(plan); session.start(); return { session, plan } }

it('correct chord feedback is complete and independent of later resets', () => {
  const result = vi.fn(), matcher = new MomentMatcher(result)
  for (const note of [67, 60, 64]) matcher.press([60, 64, 67], note)
  const feedback = result.mock.lastCall![0]
  expect(feedback).toEqual({ status: 'correct', expectedMidiNotes: [60, 64, 67], matchedMidiNotes: [60, 64, 67], missingMidiNotes: [], unexpectedMidiNotes: [] })
  matcher.reset(); expect(feedback.matchedMidiNotes).toEqual([60, 64, 67])
})
it('partial C E remains pending; only G becomes a red target after timeout', () => {
  const { session, plan } = setup()
  press(session, 60); press(session, 64)
  expect(session.getSnapshot().matchFeedback).toMatchObject({ status: 'pending', matchedMidiNotes: [60, 64], missingMidiNotes: [67], unexpectedMidiNotes: [] })
  expect(missingSourceNoteIds(plan, session.getSnapshot().matchFeedback)).toEqual([])
  vi.advanceTimersByTime(301)
  expect(session.getSnapshot().feedback).toBe('incorrect')
  expect(missingSourceNoteIds(plan, session.getSnapshot().matchFeedback)).toEqual([plan.sourceNotes.find((note) => note.midiNote === 67)!.id])
})
it('C E A reports G missing and A unexpected, then clears red at the next fresh attempt', () => {
  const { session, plan } = setup()
  for (const note of [60, 64, 69]) press(session, note)
  expect(session.getSnapshot().matchFeedback).toMatchObject({ status: 'incorrect', matchedMidiNotes: [60, 64], missingMidiNotes: [67], unexpectedMidiNotes: [69] })
  for (const note of [60, 64, 69]) press(session, note, true)
  press(session, 67)
  expect(session.getSnapshot().matchFeedback).toMatchObject({ status: 'pending', matchedMidiNotes: [67], unexpectedMidiNotes: [] })
  expect(missingSourceNoteIds(plan, session.getSnapshot().matchFeedback)).toEqual([])
  press(session, 60); press(session, 64)
  expect(session.getSnapshot().status).toBe('completed')
  expect(missingSourceNoteIds(plan, session.getSnapshot().matchFeedback)).toEqual([])
})
it('single-note errors identify expected and unexpected without a delay', () => {
  const session = new PracticeSession([{ midiNote: 60, durationBeats: 1 }]); session.start(); press(session, 62)
  expect(session.getSnapshot().matchFeedback).toMatchObject({ status: 'incorrect', expectedMidiNotes: [60], matchedMidiNotes: [], missingMidiNotes: [60], unexpectedMidiNotes: [62] })
})
it.each(['restart', 'clearActiveNotes', 'beginDemo'] as const)('%s clears prior visual feedback and the old timeout', (action) => {
  const { session, plan } = setup(); press(session, 69); session[action]()
  expect(missingSourceNoteIds(plan, session.getSnapshot().matchFeedback)).toEqual([])
  expect(session.getSnapshot().matchFeedback).toBeNull()
  const before = session.getSnapshot(); vi.advanceTimersByTime(1000); expect(session.getSnapshot()).toBe(before)
})
it('mode and song replacement remove feedback without recoloring an unrelated target', () => {
  const { session } = setup(); press(session, 69)
  session.loadPlan(createPracticePlan(parseFixture('g-piano-practice'), 'left'))
  expect(session.getSnapshot().matchFeedback).toBeNull()
  session.start(); press(session, 70)
  session.loadPlan(createPracticePlan(parseFixture('a-simple')))
  expect(session.getSnapshot().matchFeedback).toBeNull()
})
it('deduplicated physical pitches highlight both source notes while tie continuations stay uncolored', () => {
  const score = parseXml(scoreXml(noteXml('C', 1, '<voice>1</voice>') + '<backup><duration>1</duration></backup>' + noteXml('C', 1, '<voice>2</voice><staff>2</staff>')))
  const plan = createPracticePlan(score)!, session = new PracticeSession(); session.loadPlan(plan); session.start(); press(session, 62)
  expect(missingSourceNoteIds(plan, session.getSnapshot().matchFeedback)).toHaveLength(2)
  const tied = createPracticePlan(parseFixture('h-ties'))!
  session.loadPlan(tied); session.start(); press(session, 60); press(session, 64); press(session, 65)
  expect(missingSourceNoteIds(tied, session.getSnapshot().matchFeedback)).toEqual(tied.targets[1].sourceNotes.filter((note) => !note.tieStop).map((note) => note.id))
})

it.each(['right', 'left', 'both'] as const)('%s partial demo starts at a target or the first target of the selected measure', (mode) => {
  const plan = createPracticePlan(parseFixture('g-piano-practice'), mode)!
  const start = { kind: 'measure', measureIndex: 1 } as const
  const position = resolveDemoStart(plan, start)
  expect(plan.targets[position.index].measureNumber).toBe('2')
  const notes = buildDemoPlan(plan, start)
  expect(notes[0].startMs).toBe(0)
  expect(notes.filter((note) => note.startMs === 0).map((note) => note.midiNote).sort((a, b) => a - b)).toEqual(plan.targets[position.index].expectedMidiNotes)
  expect(notes.every((note) => note.index >= position.index)).toBe(true)
  expect(buildDemoPlan(plan, { kind: 'moment', momentId: plan.targets[position.index].scoreMomentId })).toEqual(notes)
})
it('rest-only selected measure skips to the next target; no later target gives an actionable error', () => {
  const score = parseFixture('i-piece-validation'), plan = createPracticePlan({ ...score, notes: score.notes.filter((note) => note.measureIndex !== 1), moments: score.moments.filter((moment) => moment.measureIndex !== 1) }, 'right')!
  expect(resolveDemoStart(plan, { kind: 'measure', measureIndex: 1 }).onsetBeats).toBe(8)
  expect(() => resolveDemoStart(plan, { kind: 'measure', measureIndex: 99 })).toThrow('音がありません')
})
it('partial playback uses the local tempo, reconstructs held ties, and beginning preserves leading rests', () => {
  const plan = createPracticePlan(parseFixture('i-piece-validation'))!
  const notes = buildDemoPlan(plan, { kind: 'measure', measureIndex: 1 })
  expect(notes[0]).toMatchObject({ midiNote: 76, startMs: 0 })
  expect(notes[0].noteOffMs).toBeCloseTo(0.9 * 60000 / 116, 6)
  const rest = createPracticePlan(parseFixture('e-rest'))!
  expect(buildDemoPlan(rest)[0].startMs).toBe(600)
  expect(buildDemoPlan(rest, { kind: 'moment', momentId: rest.targets[0].scoreMomentId })[0].startMs).toBe(0)
})
it.each(['stop', 'complete'] as const)('demo %s preserves practice position/count, suppresses input and resumes with no old red feedback', (end) => {
  const plan = createPracticePlan(parseFixture('g-piano-practice'))!, session = new PracticeSession()
  session.loadPlan(plan); session.start()
  for (const note of plan.targets[0].expectedMidiNotes) { press(session, note); press(session, note, true) }
  const output = { beginDemo: () => true, playDemoNote: vi.fn(() => true), finishDemo: vi.fn(), stopAllNotes: vi.fn(), subscribeDemoInterrupted: () => () => {} }
  const ordering: string[] = []
  const player = new DemoPlayer(output, session.beginDemo, (update) => { update(); ordering.push('cursor') })
  output.playDemoNote.mockImplementation(() => { ordering.push('MIDI'); press(session, 74); press(session, 74, true); return true })
  player.subscribe(() => { if (player.getSnapshot().status !== 'playing') session.endDemo() })
  player.loadPlan(plan); player.playFromMoment(plan.targets[2].scoreMomentId)
  expect(ordering.slice(0, 2)).toEqual(['cursor', 'MIDI'])
  expect(player.getSnapshot().currentNoteIndex).toBe(2)
  expect(session.getSnapshot()).toMatchObject({ status: 'demoPlaying', currentNoteIndex: 1, correctNoteCount: 1 })
  if (end === 'stop') player.stop(); else vi.advanceTimersByTime(20000)
  expect(session.getSnapshot()).toMatchObject({ status: 'practicing', currentNoteIndex: 1, correctNoteCount: 1, matchFeedback: null })
  const count = output.playDemoNote.mock.calls.length; vi.advanceTimersByTime(20000); expect(output.playDemoNote).toHaveBeenCalledTimes(count)
  for (const note of plan.targets[1].expectedMidiNotes) { press(session, note); press(session, note, true) }
  expect(session.getSnapshot().correctNoteCount).toBe(2)
})
it('song replacement during demo cannot restore old progress or an expired pending trial', () => {
  const { session } = setup(); press(session, 60); session.beginDemo()
  session.loadPlan(createPracticePlan(parseFixture('a-simple'))); session.endDemo(); vi.advanceTimersByTime(1000)
  expect(session.getSnapshot()).toMatchObject({ status: 'idle', currentNoteIndex: 0, correctNoteCount: 0, matchFeedback: null })
})
