import type { MidiNoteEvent } from '../midi/midiTypes'
import type { PracticeScore as ScoreModel, PracticeNote as ScoreNote } from '../score/ScoreModel'
import { matchNote } from './NoteMatcher'
import type { NoteMatch } from './NoteMatcher'

export type PracticeSnapshot = {
  readonly currentNoteIndex: number
  readonly totalNotes: number
  readonly expectedMidiNote: number | null
  readonly correctNoteCount: number
  readonly status: 'idle' | 'practicing' | 'completed' | 'demoPlaying'
  readonly feedback: NoteMatch | null
}

/** Browser-independent state machine. Receives each event synchronously, including releases. */
export class PracticeSession {
  private notes: readonly ScoreNote[] = []
  private activeNotes = new Set<string>()
  private listeners = new Set<() => void>()
  private snapshot: PracticeSnapshot = {
    currentNoteIndex: 0, totalNotes: 0, expectedMidiNote: null,
    correctNoteCount: 0, status: 'idle', feedback: null,
  }

  constructor(notes: readonly ScoreNote[] = []) { this.setNotes(notes) }

  getSnapshot = (): PracticeSnapshot => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(patch: Partial<PracticeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private setNotes(notes: readonly ScoreNote[]) {
    this.notes = notes.map((note) => ({ ...note }))
    this.publish({ currentNoteIndex: 0, totalNotes: notes.length, expectedMidiNote: notes[0]?.midiNote ?? null, correctNoteCount: 0, status: 'idle', feedback: null })
  }

  loadScore = (score: ScoreModel | null) => { this.setNotes(score?.notes ?? []) }

  start = () => {
    if (this.notes.length === 0 || this.snapshot.status === 'demoPlaying') return
    // Preserve held keys, including keys pressed before start or during a restart.
    this.publish({ currentNoteIndex: 0, expectedMidiNote: this.notes[0].midiNote, correctNoteCount: 0, status: 'practicing', feedback: null })
  }

  restart = () => { this.start() }

  beginDemo = () => {
    this.publish({ currentNoteIndex: 0, expectedMidiNote: this.notes[0]?.midiNote ?? null, correctNoteCount: 0, feedback: null, status: 'demoPlaying' })
  }
  endDemo = () => {
    if (this.snapshot.status === 'demoPlaying') this.publish({ status: 'idle' })
  }

  moveCursor = (direction: -1 | 1) => {
    if (this.snapshot.status !== 'idle' || this.notes.length === 0) return
    const index = Math.max(0, Math.min(this.notes.length - 1, this.snapshot.currentNoteIndex + direction))
    this.publish({ currentNoteIndex: index, expectedMidiNote: this.notes[index].midiNote, feedback: null })
  }

  clearActiveNotes = () => { this.activeNotes.clear() }

  handleMidiEvent = (event: MidiNoteEvent) => {
    const key = `${event.channel}:${event.midiNote}`
    if (event.type === 'noteoff' || event.velocity === 0) {
      this.activeNotes.delete(key)
      return
    }
    if (this.activeNotes.has(key)) return
    this.activeNotes.add(key)
    if (this.snapshot.status !== 'practicing' || this.snapshot.expectedMidiNote === null) return

    const feedback = matchNote(this.snapshot.expectedMidiNote, event.midiNote)
    if (feedback === 'incorrect') {
      this.publish({ feedback })
      return
    }
    const correctNoteCount = this.snapshot.correctNoteCount + 1
    if (this.snapshot.currentNoteIndex === this.notes.length - 1) {
      // Keep the cursor on the final target note.
      this.publish({ correctNoteCount, feedback, status: 'completed' })
      return
    }
    const index = this.snapshot.currentNoteIndex + 1
    this.publish({ currentNoteIndex: index, expectedMidiNote: this.notes[index].midiNote, correctNoteCount, feedback })
  }
}
