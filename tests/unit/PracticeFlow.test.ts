import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { CHORD_MAX_WINDOW_MS, CHORD_SETTLE_MS } from '../../src/practice/RunThroughMatcher'
import { noteXml, parseXml, scoreXml, parseFixture } from './xmlFixture'

const plan = createPracticePlan(parseXml(scoreXml(noteXml('C') + noteXml('E', 1, '<chord/>') + noteXml('G', 1, '<chord/>') + noteXml('D') + noteXml('E'))))!
const on = (s: PracticeSession, n: number) => s.handleMidiEvent({ type: 'noteon', channel: 1, midiNote: n, velocity: 80, timestamp: performance.now() })
const off = (s: PracticeSession, n: number) => s.handleMidiEvent({ type: 'noteoff', channel: 1, midiNote: n, velocity: 0, timestamp: performance.now() })
function session(chord = true) {
  const s = new PracticeSession()
  s.loadPlan(chord ? plan : createPracticePlan(parseXml(scoreXml(noteXml('C') + noteXml('D'))))!)
  s.setFlowMode('run-through'); s.start()
  return s
}
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('run-through input attempts', () => {
  it.each([60, 62])('single note %i completes once immediately and stores the complete result', note => {
    const s = session(false); on(s, note)
    expect(s.getSnapshot()).toMatchObject({ currentNoteIndex: 1, status: 'practicing', correctNoteCount: note === 60 ? 1 : 0 })
    const a = s.getSnapshot().attempts[0]
    expect(a).toEqual({ sequenceOccurrenceId: expect.any(String), sourceMomentId: expect.any(String), measureNumber: '1', practiceMode: 'both', flowMode: 'run-through',
      expectedMidiNotes: [60], playedMidiNotes: [note], matchedMidiNotes: note === 60 ? [60] : [], missingMidiNotes: note === 60 ? [] : [60], unexpectedMidiNotes: note === 60 ? [] : [62],
      result: note === 60 ? 'correct' : 'incorrect', startedAt: 0, completedAt: 0 })
    on(s, note); on(s, note); vi.advanceTimersByTime(1000)
    expect(s.getSnapshot().attempts).toHaveLength(1)
  })
  it.each([67, 69])('chord C E %i advances exactly one target after settle', last => {
    const s = session(); on(s, 60); vi.advanceTimersByTime(25); on(s, 64); vi.advanceTimersByTime(25); on(s, last)
    vi.advanceTimersByTime(CHORD_SETTLE_MS - 1)
    expect(s.getSnapshot().currentNoteIndex).toBe(0)
    vi.advanceTimersByTime(1)
    expect(s.getSnapshot()).toMatchObject({ currentNoteIndex: 1, correctNoteCount: last === 67 ? 1 : 0, status: 'practicing' })
    expect(s.getSnapshot().attempts[0]).toMatchObject({ expectedMidiNotes: [60, 64, 67], playedMidiNotes: [60, 64, last],
      matchedMidiNotes: last === 67 ? [60, 64, 67] : [60, 64], missingMidiNotes: last === 67 ? [] : [67], unexpectedMidiNotes: last === 67 ? [] : [69],
      result: last === 67 ? 'correct' : 'incorrect', startedAt: 0, completedAt: 150,
      sequenceOccurrenceId: plan.sequence.occurrences[0].id, sourceMomentId: plan.targets[0].scoreMomentId })
    vi.advanceTimersByTime(1000); expect(s.getSnapshot().attempts).toHaveLength(1)
  })
  it('waits after the last new note, but never beyond 300 ms from the first', () => {
    const s = session()
    for (const [i, n] of [60, 64, 67, 69].entries()) { if (i) vi.advanceTimersByTime(80); on(s, n) }
    vi.advanceTimersByTime(59); expect(s.getSnapshot().attempts).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(s.getSnapshot().attempts).toHaveLength(1)
    expect(s.getSnapshot().attempts[0]).toMatchObject({ completedAt: CHORD_MAX_WINDOW_MS, unexpectedMidiNotes: [69] })
  })
  it('missing chord notes still advance; no Note On means no attempt or silent skip', () => {
    const s = session(); vi.advanceTimersByTime(60_000); expect(s.getSnapshot().attempts).toEqual([])
    on(s, 60); vi.advanceTimersByTime(100)
    expect(s.getSnapshot().attempts[0]).toMatchObject({ result: 'incorrect', missingMidiNotes: [64, 67] })
    vi.advanceTimersByTime(60_000); expect(s.getSnapshot().currentNoteIndex).toBe(1)
  })
  it('duplicate held keys or released/repressed notes within the group do not extend settle', () => {
    const s = session(); on(s, 60); vi.advanceTimersByTime(70)
    on(s, 60); off(s, 60); on(s, 60); vi.advanceTimersByTime(30)
    expect(s.getSnapshot().attempts).toHaveLength(1)
    expect(s.getSnapshot().attempts[0].playedMidiNotes).toEqual([60])
  })
  it('a late input after an expired window is evaluated against the next target, not the old chord', () => {
    const s = session(); on(s, 60)
    vi.spyOn(performance, 'now').mockReturnValue(120)
    on(s, 62)
    expect(s.getSnapshot().attempts.map(a => a.expectedMidiNotes)).toEqual([[60, 64, 67], [62]])
    expect(s.getSnapshot().currentNoteIndex).toBe(2)
  })
  it('completion retains every attempt including the last wrong note; further input is ignored; restart clears results', () => {
    const s = session(false); on(s, 60); on(s, 65)
    const snapshot = s.getSnapshot()
    expect(snapshot).toMatchObject({ status: 'completed', currentNoteIndex: 1, correctNoteCount: 1 })
    expect(snapshot.attempts.map(a => a.result)).toEqual(['correct', 'incorrect'])
    off(s, 65); on(s, 62); expect(s.getSnapshot()).toBe(snapshot)
    s.restart(); expect(s.getSnapshot()).toMatchObject({ status: 'practicing', currentNoteIndex: 0, attempts: [], correctNoteCount: 0 })
    expect(snapshot.attempts).toHaveLength(2)
  })
  it('restart returns to the specified start, preserving held-key blocking', () => {
    const s = session(); s.setStartTarget(1); s.start(); on(s, 62); s.restart()
    on(s, 62); expect(s.getSnapshot().attempts).toEqual([])
    off(s, 62); on(s, 62); expect(s.getSnapshot().attempts).toHaveLength(1)
    expect(s.getSnapshot().startTargetIndex).toBe(1)
  })
  it('mode changes cancel partial chords, return to start and retain plan/start/mode, without old timers advancing', () => {
    const s = session(); on(s, 60); s.setFlowMode('until-correct'); vi.advanceTimersByTime(1000)
    expect(s.getSnapshot()).toMatchObject({ status: 'idle', currentNoteIndex: 0, attempts: [], flowMode: 'until-correct' })
    s.setStartTarget(1); s.setFlowMode('run-through'); s.start(); on(s, 62)
    expect(s.getSnapshot().attempts[0].expectedMidiNotes).toEqual([62])
    s.setFlowMode('until-correct'); expect(s.getSnapshot()).toMatchObject({ startTargetIndex: 1, currentNoteIndex: 1, attempts: [] })
  })
  it.each(['demo', 'input-reset', 'load', 'dispose'] as const)('%s cancels pending timers and preserves completed records where appropriate', action => {
    const s = session(); on(s, 60)
    if (action === 'demo') { s.beginDemo(); on(s, 64) }
    if (action === 'input-reset') s.clearActiveNotes()
    if (action === 'load') s.loadPlan(null)
    if (action === 'dispose') s.dispose()
    vi.advanceTimersByTime(1000); expect(s.getSnapshot().attempts).toEqual([])
  })
  it('demo suspension retains previous attempts and resumes without grading demo input', () => {
    const s = session(false); on(s, 60); s.beginDemo(); on(s, 62); vi.advanceTimersByTime(1000)
    expect(s.getSnapshot().attempts).toHaveLength(1); s.endDemo()
    on(s, 62); expect(s.getSnapshot().attempts).toHaveLength(1)
    off(s, 62); on(s, 62); expect(s.getSnapshot().status).toBe('completed')
  })
  it('repeat passes have distinct occurrence IDs with the same source moment and correct hand mode', () => {
    const p = createPracticePlan(parseFixture('maim-maim-full-original'), 'right')!
    const s = new PracticeSession(); s.loadPlan(p); s.setFlowMode('run-through'); s.start()
    for (const o of p.sequence.occurrences) {
      o.sourceTarget.expectedMidiNotes.forEach(n => on(s, n)); vi.advanceTimersByTime(100)
      o.sourceTarget.expectedMidiNotes.forEach(n => off(s, n))
    }
    const attempts = s.getSnapshot().attempts
    expect(s.getSnapshot().status).toBe('completed'); expect(attempts).toHaveLength(p.sequence.occurrences.length)
    expect(new Set(attempts.map(a => a.sequenceOccurrenceId)).size).toBe(attempts.length)
    const second = p.sequence.occurrences.findIndex(o => o.repeatPass === 2)
    expect(attempts.slice(0, second).some(a => a.sourceMomentId === attempts[second].sourceMomentId)).toBe(true)
    expect(attempts.every(a => a.practiceMode === 'right' && a.result === 'correct')).toBe(true)
  })
})

describe('until-correct remains independent', () => {
  it('wrong, extra and incomplete notes stay; a correct chord immediately advances without settle', () => {
    const s = new PracticeSession(); s.loadPlan(plan); s.start()
    on(s, 69); off(s, 69); expect(s.getSnapshot().currentNoteIndex).toBe(0)
    on(s, 60); vi.advanceTimersByTime(301); off(s, 60)
    expect(s.getSnapshot()).toMatchObject({ currentNoteIndex: 0, feedback: 'incorrect' })
    on(s, 60); on(s, 64); on(s, 67)
    expect(s.getSnapshot()).toMatchObject({ currentNoteIndex: 1, feedback: 'correct', flowMode: 'until-correct', attempts: [] })
  })
})
