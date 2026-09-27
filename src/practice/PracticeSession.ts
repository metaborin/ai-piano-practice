import type { MidiNoteEvent } from '../midi/midiTypes'
import type { PracticeScore as ScoreModel, PracticeNote as ScoreNote } from '../score/ScoreModel'
import { MomentMatcher } from './MomentMatcher'
import type { PracticePlan } from './PracticePlan'
import type { NoteMatch } from './NoteMatcher'

/** Legacy property names now count PracticeTargets (steps), not individual chord notes. */
export type PracticeSnapshot = {
  readonly currentNoteIndex: number
  readonly totalNotes: number
  readonly expectedMidiNote: number | null
  readonly expectedMidiNotes: readonly number[]
  readonly correctNoteCount: number
  readonly status: 'idle' | 'practicing' | 'completed' | 'demoPlaying'
  readonly feedback: NoteMatch | null
}

/** Browser-independent state machine. Receives each event synchronously, including releases. */
export class PracticeSession {
  private targets: readonly { expectedMidiNotes: readonly number[] }[] = []
  private matcher = new MomentMatcher((feedback) => this.handleResult(feedback))
  private activeNotes = new Set<string>()
  private listeners = new Set<() => void>()
  private snapshot: PracticeSnapshot = {
    currentNoteIndex: 0, totalNotes: 0, expectedMidiNote: null, expectedMidiNotes: [],
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
    this.setTargets(notes.map((note) => ({ expectedMidiNotes: [note.midiNote] })))
  }
  private expected(index: number) {
    const expectedMidiNotes = this.targets[index]?.expectedMidiNotes ?? []
    return { expectedMidiNotes, expectedMidiNote: expectedMidiNotes[0] ?? null }
  }
  private setTargets(targets: readonly { expectedMidiNotes: readonly number[] }[]) {
    this.matcher.reset(); this.targets = targets
    this.publish({ currentNoteIndex: 0, totalNotes: targets.length, ...this.expected(0), correctNoteCount: 0, status: 'idle', feedback: null })
  }
  loadPlan = (plan: PracticePlan | null) => { this.setTargets(plan?.targets ?? []) }

  loadScore = (score: ScoreModel | null) => { this.setNotes(score?.notes ?? []) }

  start = () => {
    if (this.targets.length === 0 || this.snapshot.status === 'demoPlaying') return
    this.matcher.reset()
    // Preserve held keys, including keys pressed before start or during a restart.
    this.publish({ currentNoteIndex: 0, ...this.expected(0), correctNoteCount: 0, status: 'practicing', feedback: null })
  }

  restart = () => { this.start() }

  beginDemo = () => {
    this.matcher.reset()
    this.publish({ currentNoteIndex: 0, ...this.expected(0), correctNoteCount: 0, feedback: null, status: 'demoPlaying' })
  }
  endDemo = () => {
    if (this.snapshot.status === 'demoPlaying') this.publish({ status: 'idle' })
  }

  moveCursor = (direction: -1 | 1) => {
    if (this.snapshot.status !== 'idle' || this.targets.length === 0) return
    const index = Math.max(0, Math.min(this.targets.length - 1, this.snapshot.currentNoteIndex + direction))
    this.publish({ currentNoteIndex: index, ...this.expected(index), feedback: null })
  }

  clearActiveNotes = () => { this.activeNotes.clear(); this.matcher.reset() }
  dispose = () => { this.matcher.reset() }

  handleMidiEvent = (event: MidiNoteEvent) => {
    const key = `${event.channel}:${event.midiNote}`
    if (event.type === 'noteoff' || event.velocity === 0) {
      this.activeNotes.delete(key)
      return
    }
    if (this.activeNotes.has(key)) return
    this.activeNotes.add(key)
    if (this.snapshot.status !== 'practicing' || this.snapshot.expectedMidiNote === null) return

    this.matcher.press(this.snapshot.expectedMidiNotes, event.midiNote, event.timestamp)
  }
  private handleResult(feedback: NoteMatch) {
    if (this.snapshot.status !== 'practicing') return
    if (feedback === 'incorrect') {
      this.publish({ feedback })
      return
    }
    const correctNoteCount = this.snapshot.correctNoteCount + 1
    if (this.snapshot.currentNoteIndex === this.targets.length - 1) {
      // Keep the cursor on the final target note.
      this.publish({ correctNoteCount, feedback, status: 'completed' })
      return
    }
    const index = this.snapshot.currentNoteIndex + 1
    this.publish({ currentNoteIndex: index, ...this.expected(index), correctNoteCount, feedback })
  }
}
