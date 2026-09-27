import { afterEach, expect, it, vi } from 'vitest'
import { parseFixture, parseXml, fixture } from './xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { resolvePracticeStart } from '../../src/practice/PracticeStartResolver'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { SongSelection } from '../../src/score/SongSelection'
import { resolveDemoStart } from '../../src/audio/DemoStart'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import type { PracticeMode } from '../../src/practice/PracticePlan'

afterEach(() => vi.useRealTimers())
const event = (midiNote: number, type: 'noteon' | 'noteoff' = 'noteon', channel = 1) => ({ type, midiNote, velocity: type === 'noteon' ? 80 : 0, timestamp: performance.now(), channel })
function strike(session: PracticeSession, pitches: readonly number[]) {
  for (const pitch of pitches) session.handleMidiEvent(event(pitch))
  for (const pitch of pitches) session.handleMidiEvent(event(pitch, 'noteoff'))
}
const cases: [string, PracticeMode, number, number, number[], string][] = [
  ['start-a-tie', 'right', 0, 0, [60], 'exact'],
  ['start-a-tie', 'right', 1, 1, [62], 'next-measure'],
  ['start-a-tie', 'right', 2, 1, [62], 'next-measure'],
  ['start-b-rest', 'right', 1, 1, [62], 'later-in-measure'],
  ['start-c-staff-late', 'right', 1, 1, [67], 'later-in-measure'],
  ['start-c-staff-late', 'left', 1, 1, [50], 'exact'],
  ['start-d-voices', 'right', 1, 1, [64], 'exact'],
  ['start-e-hands', 'right', 1, 1, [76], 'next-measure'],
  ['start-e-hands', 'left', 1, 1, [50], 'exact'],
  ['start-e-hands', 'both', 1, 1, [50], 'exact'],
  ['start-f-empty', 'right', 1, 1, [67], 'next-measure'],
]
it.each(cases)('%s %s measure index %i resolves to attack index %i (%j, %s)', (name, mode, measureIndex, index, notes, reason) => {
  const plan = createPracticePlan(parseFixture(name), mode)!
  expect(plan).not.toBeNull()
  const resolved = resolvePracticeStart(plan, { kind: 'measure', measureIndex })
  expect(resolved).toMatchObject({ resolvedTargetIndex: index, reason, requestedMeasure: { index: measureIndex } })
  expect(plan.targets[index].expectedMidiNotes).toEqual(notes)
  expect(resolved.resolvedMeasure!.index).toBeGreaterThanOrEqual(measureIndex)
  expect(plan.targets.every(t => t.expectedMidiNotes.length > 0)).toBe(true)
})

for (const mode of ['right', 'left', 'both'] as const) it.each([1, 13, 14, 16, 18, 20, 23, 30])(`actual once XML ${mode}: measure %i progresses to completion and restarts at the requested session origin`, number => {
  const score = parseFixture('maim-maim-full-once'), plan = createPracticePlan(score, mode)!
  expect([score.measures.length, score.notes.length, score.rests.length, score.moments.length]).toEqual([30, 224, 77, 109])
  expect(plan.targets.length).toBe(mode === 'right' ? 48 : mode === 'left' ? 76 : 109)
  const origin = resolvePracticeStart(plan, { kind: 'measure', measureIndex: number - 1 }), index = origin.resolvedTargetIndex!
  const advances = mode === 'right' && [14, 16, 18, 20].includes(number)
  expect(origin.resolvedMeasure!.number).toBe(String(number + (advances ? 1 : 0)))
  if (advances) {
    expect(origin.reason).toBe('next-measure'); expect(origin.message).toContain(`${number + 1}小節目`)
    expect(score.notes.filter(n => n.staff === 1 && n.measureIndex === number - 1).every(n => n.tieStop && !n.tieStart)).toBe(true)
  }
  const session = new PracticeSession(); session.loadPlan(plan); session.setStartTarget(index); session.start()
  expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: index, correctNoteCount: 0, startTargetIndex: index })
  strike(session, [127]); expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: index, feedback: 'incorrect' })
  strike(session, plan.targets[index].expectedMidiNotes)
  expect(session.getSnapshot().currentNoteIndex).toBe(Math.min(index + 1, plan.targets.length - 1))
  for (const target of plan.targets.slice(index + 1)) strike(session, target.expectedMidiNotes)
  expect(session.getSnapshot()).toMatchObject({ status: 'completed', currentNoteIndex: plan.targets.length - 1, correctNoteCount: plan.targets.length - index })
  session.restart()
  expect(session.getSnapshot()).toMatchObject({ status: 'practicing', currentNoteIndex: index, correctNoteCount: 0, matchFeedback: null })
})

it('no later attack or invalid measure disables practice without silently returning to zero', () => {
  const plan = createPracticePlan(parseFixture('start-f-empty'), 'right')!
  for (const measureIndex of [3, -1, 999, 1.5]) {
    const position = resolvePracticeStart(plan, { kind: 'measure', measureIndex })
    expect(position).toMatchObject({ reason: 'unavailable', resolvedTargetIndex: null, resolvedMeasure: null })
    const session = new PracticeSession(); session.loadPlan(plan); session.setStartTarget(null); session.start(); strike(session, [72])
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', expectedMidiNotes: [], correctNoteCount: 0 })
  }
})
it('printed measure labels can have duplicates and gaps; occurrence indices remain unambiguous', () => {
  const score = parseXml(fixture('start-b-rest').replace('number="2"', 'number="1"').replace('number="3"', 'number="9"'))
  const plan = createPracticePlan(score)!
  expect(resolvePracticeStart(plan, { kind: 'measure', measureIndex: 1 })).toMatchObject({ resolvedTargetIndex: 1, requestedMeasure: { number: '1', index: 1 }, resolvedMeasure: { number: '1', index: 1 } })
  expect(resolvePracticeStart(plan, { kind: 'measure', measureIndex: 2 })).toMatchObject({ resolvedTargetIndex: 2, resolvedMeasure: { number: '9' } })
})
it('a new start clears a pending chord, prior feedback and timer while held physical keys require release', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const plan = createPracticePlan(parseFixture('maim-maim-full-once'), 'right')!, session = new PracticeSession()
  session.loadPlan(plan); session.start(); session.handleMidiEvent(event(55))
  expect(session.getSnapshot().matchFeedback?.status).toBe('pending')
  session.setStartTarget(25); session.start()
  expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 25, matchFeedback: null, feedback: null, correctNoteCount: 0 })
  const before = session.getSnapshot(); vi.advanceTimersByTime(1000); expect(session.getSnapshot()).toBe(before)
  strike(session, [60, 64]); expect(session.getSnapshot().currentNoteIndex).toBe(26)
  strike(session, [127]); expect(session.getSnapshot().matchFeedback?.unexpectedMidiNotes).toEqual([127])
  session.handleMidiEvent(event(60)); session.setStartTarget(25); session.start()
  session.handleMidiEvent(event(60)); session.handleMidiEvent(event(64))
  expect(session.getSnapshot().currentNoteIndex).toBe(25) // a duplicate held-key On is not a new attack
  session.handleMidiEvent(event(60, 'noteoff')); session.handleMidiEvent(event(60))
  expect(session.getSnapshot().currentNoteIndex).toBe(26)
  session.setStartTarget(25); expect(session.getSnapshot().matchFeedback).toBeNull()
  session.clearActiveNotes(); session.start(); strike(session, [60,64])
  expect(session.getSnapshot().currentNoteIndex).toBe(26)
})
it('mode changes re-resolve the requested measure instead of copying the previous target index; song changes reset it', async () => {
  const model = parseFixture('maim-maim-full-once'), session = new PracticeSession()
  const selection = new SongSelection(null, { obtain: async () => model.musicXml, reset: () => session.loadPlan(null), apply: session.loadPlan, position: session.setStartTarget })
  const song = { id: model.id, title: model.title, partLabel: '', source: 'builtin' as const, musicXml: { type: 'text' as const, value: model.musicXml } }
  await selection.select(song); selection.ready(selection.getSnapshot().requestId, model)
  selection.setMode('right'); selection.setPracticeStart({ kind: 'measure', measureIndex: 13 }); session.start(); strike(session, [60,64])
  expect(session.getSnapshot().currentNoteIndex).toBe(26)
  selection.setMode('left'); expect(session.getSnapshot()).toMatchObject({ status: 'idle', currentNoteIndex: 28, startTargetIndex: 28, correctNoteCount: 0 })
  selection.setMode('both'); expect(session.getSnapshot().startTargetIndex).toBe(47)
  expect(selection.getSnapshot().practiceStart).toEqual({ kind: 'measure', measureIndex: 13 })
  await selection.select(song); selection.ready(selection.getSnapshot().requestId, model)
  expect(selection.getSnapshot().practiceStart).toEqual({ kind: 'beginning' }); expect(session.getSnapshot().startTargetIndex).toBe(0)
})
it('an unavailable start can recover in another mode at the same requested measure', async () => {
  const model = parseFixture('start-f-empty'), session = new PracticeSession()
  const selection = new SongSelection(null, { obtain: async () => model.musicXml, reset: () => session.loadPlan(null), apply: session.loadPlan, position: session.setStartTarget })
  await selection.select({ id: model.id, title: model.title, partLabel: '', source: 'builtin', musicXml: { type: 'text', value: model.musicXml } }); selection.ready(selection.getSnapshot().requestId, model)
  selection.setMode('right'); selection.setPracticeStart({ kind: 'measure', measureIndex: 3 }); expect(session.getSnapshot().startTargetIndex).toBeNull()
  selection.setMode('left'); expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 3, expectedMidiNotes: [53], status: 'idle' })
})

for (const mode of ['right', 'left', 'both'] as const) it.each([14,16,18,20])(`actual ${mode} demo at measure %i restores only the remaining tie at the requested boundary`, number => {
  const plan = createPracticePlan(parseFixture('maim-maim-full-once'), mode)!, start = { kind: 'measure', measureIndex: number - 1 } as const
  const origin = resolveDemoStart(plan, start), notes = buildDemoPlan(plan, start)
  expect(origin.onsetBeats).toBe((number - 1) * 4)
  const tied = number === 14 || number === 18 ? [62,65] : [60,64]
  const first = notes.filter(n => n.startMs === 0).map(n => n.midiNote)
  for (const pitch of tied) expect(first.includes(pitch)).toBe(mode !== 'left')
  if (mode !== 'left') {
    expect(plan.score.moments.find(m => m.id === origin.cursorMomentId)?.measureNumber).toBe(String(number))
    for (const pitch of tied) expect(notes.find(n=>n.startMs===0 && n.midiNote===pitch)!.durationMs).toBeCloseTo(4 * 60000 / 232)
  }
  // The beginning plan never re-attacks the written tie stop.
  expect(buildDemoPlan(plan).filter(n => Math.abs(n.startMs - (number - 1) * 4 * 60000 / 232) < 1e-6 && tied.includes(n.midiNote))).toEqual([])
})
it('tie-only final measure demo has no future attack but still plays, stops and cannot revive', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const score = parseXml(fixture('start-a-tie').replace(/<measure number="4">[\s\S]*?<\/measure>/, '')), plan = createPracticePlan(score)!
  const output = { beginDemo: () => true, playDemoNote: vi.fn(() => true), finishDemo: vi.fn(), stopAllNotes: vi.fn(), subscribeDemoInterrupted: () => () => {} }
  const player = new DemoPlayer(output); player.loadPlan(plan); player.start({ kind: 'measure', measureIndex: 2 })
  expect(player.getSnapshot().status).toBe('playing'); expect(output.playDemoNote).toHaveBeenCalledOnce()
  player.stop(); vi.advanceTimersByTime(100000)
  expect(output.stopAllNotes).toHaveBeenCalledOnce(); expect(output.playDemoNote).toHaveBeenCalledOnce()
  expect(resolvePracticeStart(plan, { kind: 'measure', measureIndex: 2 }).resolvedTargetIndex).toBeNull()
})
