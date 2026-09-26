import { describe, expect, it } from 'vitest'
import type { MidiNoteEvent } from '../../src/midi/midiTypes'
import { PracticeSession } from '../../src/practice/PracticeSession'

const melody = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]
const scoreNotes = melody.map((midiNote) => ({ midiNote }))
const event = (midiNote: number, type: 'noteon' | 'noteoff' = 'noteon', velocity = 72, channel = 1): MidiNoteEvent => ({ type, midiNote, velocity, channel, timestamp: 123.5 })
function strike(session: PracticeSession, note: number) {
  session.handleMidiEvent(event(note))
  session.handleMidiEvent(event(note, 'noteoff', 0))
}

describe('PracticeSession', () => {
  it('ignores playing before start, then resets a manual position to the first note', () => {
    const session = new PracticeSession(scoreNotes)
    strike(session, 60)
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', currentNoteIndex: 0, correctNoteCount: 0, feedback: null })
    session.moveCursor(1)
    session.moveCursor(1)
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 2, expectedMidiNote: 67 })
    session.start()
    expect(session.getSnapshot()).toMatchObject({ status: 'practicing', currentNoteIndex: 0, expectedMidiNote: 60, totalNotes: 14 })
  })

  it('keeps the index and expected pitch on a wrong note', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    strike(session, 64)
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 0, expectedMidiNote: 60, correctNoteCount: 0, feedback: 'incorrect' })
  })

  it('advances one position per press, ignores repeated Note On while held, and requires release', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 1, expectedMidiNote: 60, correctNoteCount: 1, feedback: 'correct' })
    session.handleMidiEvent(event(60))
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(1)
    session.handleMidiEvent(event(60, 'noteoff', 40))
    expect(session.getSnapshot().currentNoteIndex).toBe(1)
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 2, expectedMidiNote: 67, correctNoteCount: 2 })
  })

  it.each(['noteoff', 'zero-velocity'] as const)('%s releases a held note without grading or moving the cursor', (kind) => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    session.handleMidiEvent(event(60))
    const before = session.getSnapshot()
    session.handleMidiEvent(event(60, kind === 'noteoff' ? 'noteoff' : 'noteon', 0))
    expect(session.getSnapshot()).toBe(before)
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(2)
  })

  it('ignores stray releases, including velocity zero, without changing feedback', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    session.handleMidiEvent(event(60, 'noteoff', 33))
    session.handleMidiEvent(event(60, 'noteon', 0))
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 0, feedback: null })
  })

  it('a release on another channel does not unlock the held key', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    session.handleMidiEvent(event(60, 'noteon', 72, 1))
    session.handleMidiEvent(event(60, 'noteoff', 0, 2))
    session.handleMidiEvent(event(60, 'noteon', 72, 1))
    expect(session.getSnapshot().currentNoteIndex).toBe(1)
    session.handleMidiEvent(event(60, 'noteoff', 0, 1))
    session.handleMidiEvent(event(60, 'noteon', 72, 1))
    expect(session.getSnapshot().currentNoteIndex).toBe(2)
  })

  it('completes exactly on the fourteenth correct pitch and safely ignores further playing', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    for (const note of melody.slice(0, -1)) strike(session, note)
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 13, correctNoteCount: 13, status: 'practicing' })
    strike(session, 64)
    expect(session.getSnapshot().status).toBe('practicing')
    strike(session, 60)
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 13, expectedMidiNote: 60, correctNoteCount: 14, status: 'completed' })
    const completed = session.getSnapshot()
    for (const note of [...melody, 127, 0]) strike(session, note)
    expect(session.getSnapshot()).toBe(completed)
  })

  it.each(['practicing', 'completed'] as const)('restarts from %s with progress and feedback reset', (status) => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    if (status === 'completed') melody.forEach((note) => strike(session, note))
    else { strike(session, 60); strike(session, 64) }
    session.restart()
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 0, correctNoteCount: 0, status: 'practicing', feedback: null })
    strike(session, 60)
    expect(session.getSnapshot().currentNoteIndex).toBe(1)
  })

  it('requires a fresh press if C4 was held before starting or restarting', () => {
    const session = new PracticeSession(scoreNotes)
    session.handleMidiEvent(event(60))
    session.start()
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(0)
    session.handleMidiEvent(event(60, 'noteoff', 0))
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(1)
    session.restart()
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(0)
    session.handleMidiEvent(event(60, 'noteoff', 0))
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(1)
  })

  it('clears held keys on input reset while preserving the practice position', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    session.handleMidiEvent(event(60))
    session.clearActiveNotes()
    expect(session.getSnapshot()).toMatchObject({ currentNoteIndex: 1, status: 'practicing' })
    session.handleMidiEvent(event(60))
    expect(session.getSnapshot().currentNoteIndex).toBe(2)
  })

  it('clamps development navigation and rejects navigation during practice or completion', () => {
    const session = new PracticeSession(scoreNotes)
    for (let i = 0; i < 30; i++) session.moveCursor(1)
    expect(session.getSnapshot().currentNoteIndex).toBe(13)
    for (let i = 0; i < 30; i++) session.moveCursor(-1)
    expect(session.getSnapshot().currentNoteIndex).toBe(0)
    session.start()
    session.moveCursor(1)
    expect(session.getSnapshot().currentNoteIndex).toBe(0)
    melody.forEach((note) => strike(session, note))
    session.moveCursor(-1)
    expect(session.getSnapshot().currentNoteIndex).toBe(13)
  })

  it('does not grade timestamp or nonzero velocity and leaves original events intact', () => {
    const session = new PracticeSession(scoreNotes)
    session.start()
    const soft = Object.freeze({ ...event(60), velocity: 1, timestamp: 1000000 })
    session.handleMidiEvent(soft)
    session.handleMidiEvent(event(60, 'noteoff', 0))
    const strong = Object.freeze({ ...event(60), velocity: 127, timestamp: 1 })
    session.handleMidiEvent(strong)
    expect(session.getSnapshot().currentNoteIndex).toBe(2)
    expect(soft).toMatchObject({ velocity: 1, timestamp: 1000000 })
    expect(strong).toMatchObject({ velocity: 127, timestamp: 1 })
  })

  it('cannot start an empty score and resets when score loading fails', () => {
    const session = new PracticeSession()
    session.start()
    strike(session, 60)
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', totalNotes: 0, expectedMidiNote: null })
    session.loadScore({ id: 'test', title: 'test', partLabel: '', musicXml: '', notes: scoreNotes })
    session.start()
    strike(session, 60)
    session.loadScore(null)
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', totalNotes: 0, currentNoteIndex: 0, feedback: null })
  })
})
