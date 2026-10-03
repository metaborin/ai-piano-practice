import type { MidiNoteEvent } from '../midi/midiTypes'
import type { PracticeScore as ScoreModel, PracticeNote as ScoreNote } from '../score/ScoreModel'
import { MomentMatcher } from './MomentMatcher'
import type { MomentMatchFeedback } from './MomentMatcher'
import type { PracticePlan } from './PracticePlan'
import type { NoteMatch } from './NoteMatcher'
import { RunThroughMatcher } from './RunThroughMatcher'
import type { AttemptMatch } from './RunThroughMatcher'
import type { PracticeAttemptResult, PracticeFlowMode } from './PracticeAttemptResult'
import type { PracticeOccurrence } from './PracticeSequence'
import type { PracticeMode } from './PracticePlan'

/** Legacy property names now count PracticeTargets (steps), not individual chord notes. */
export type PracticeSnapshot = {
  readonly flowMode: PracticeFlowMode
  readonly attempts: readonly PracticeAttemptResult[]
  readonly currentNoteIndex: number
  readonly totalNotes: number
  readonly expectedMidiNote: number | null
  readonly expectedMidiNotes: readonly number[]
  readonly correctNoteCount: number
  readonly startTargetIndex: number | null
  readonly status: 'idle' | 'practicing' | 'completed' | 'demoPlaying'
  readonly feedback: NoteMatch | null
  readonly matchFeedback: (MomentMatchFeedback & { readonly targetIndex: number }) | null
}

/** Browser-independent state machine. Receives each event synchronously, including releases. */
export class PracticeSession {
  private targets: readonly { expectedMidiNotes: readonly number[] }[] = []
  private repeatJumps = new Set<number>()
  private matcher = new MomentMatcher((feedback) => this.handleResult(feedback))
  private runMatcher = new RunThroughMatcher((result) => this.handleAttempt(result))
  private occurrences: readonly PracticeOccurrence[] = []
  private practiceMode: PracticeMode = 'both'
  private activeNotes = new Set<string>()
  // Physical keys held across a reset must be released before counting a fresh press.
  private blockedUntilRelease = new Set<string>()
  private listeners = new Set<() => void>()
  private resumeStatus: 'idle' | 'practicing' | 'completed' | null = null
  private snapshot: PracticeSnapshot = {
    flowMode: 'until-correct', attempts: [],
    currentNoteIndex: 0, totalNotes: 0, expectedMidiNote: null, expectedMidiNotes: [],
    correctNoteCount: 0, startTargetIndex: 0, status: 'idle', feedback: null, matchFeedback: null,
  }

  constructor(notes: readonly ScoreNote[] = []) { this.setNotes(notes) }

  getSnapshot = (): PracticeSnapshot => this.snapshot
  isBeforeNavigationJump = () => this.snapshot.status === 'practicing' && this.repeatJumps.has(this.snapshot.currentNoteIndex + 1)
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
    this.resetInput(); this.targets = targets; this.resumeStatus = null; this.repeatJumps.clear()
    this.occurrences = []; this.practiceMode = 'both'
    this.publish({ attempts: [], currentNoteIndex: 0, startTargetIndex: 0, totalNotes: targets.length, ...this.expected(0), correctNoteCount: 0, status: 'idle', feedback: null, matchFeedback: null })
  }
  private resetInput() {
    this.matcher.reset()
    this.runMatcher.reset()
    this.activeNotes.forEach(key => this.blockedUntilRelease.add(key))
    this.activeNotes.clear()
  }
  /** The resolver/coordinator owns score positions; this machine accepts only a validated index. */
  setStartTarget = (index: number | null) => {
    if (this.snapshot.status === 'demoPlaying') return
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= this.targets.length)) throw new Error('Invalid practice start target')
    this.resetInput(); this.resumeStatus = null
    this.publish({ startTargetIndex: index, currentNoteIndex: index ?? 0, ...this.expected(index ?? -1),
      attempts: [], correctNoteCount: 0, status: 'idle', feedback: null, matchFeedback: null })
  }
  setFlowMode = (flowMode: PracticeFlowMode) => {
    if (flowMode === this.snapshot.flowMode) return
    this.resetInput(); this.resumeStatus = null
    const index = this.snapshot.startTargetIndex
    this.publish({ flowMode, attempts: [], currentNoteIndex: index ?? 0, ...this.expected(index ?? -1),
      correctNoteCount: 0, status: 'idle', feedback: null, matchFeedback: null })
  }
  loadPlan = (plan: PracticePlan | null) => {
    const occurrences = plan?.sequence.occurrences ?? []
    this.setTargets(occurrences.map(occurrence => occurrence.sourceTarget))
    this.occurrences = occurrences; this.practiceMode = plan?.mode ?? 'both'
    occurrences.forEach((occurrence, index) => {
      if (index > 0 && occurrence.sourceTargetIndex <= occurrences[index - 1].sourceTargetIndex) this.repeatJumps.add(index)
    })
  }

  loadScore = (score: ScoreModel | null) => { this.setNotes(score?.notes ?? []) }

  start = () => {
    const index = this.snapshot.startTargetIndex
    if (this.targets.length === 0 || index === null || this.snapshot.status === 'demoPlaying') return
    this.resetInput()
    this.publish({ attempts: [], currentNoteIndex: index, ...this.expected(index), correctNoteCount: 0, status: 'practicing', feedback: null, matchFeedback: null })
  }

  restart = () => { this.start() }

  beginDemo = () => {
    if (this.snapshot.status === 'demoPlaying') return
    this.resumeStatus = this.snapshot.status
    this.matcher.reset()
    this.runMatcher.reset()
    this.publish({ feedback: null, matchFeedback: null, status: 'demoPlaying' })
  }
  endDemo = () => {
    if (this.snapshot.status === 'demoPlaying') this.publish({ status: this.resumeStatus ?? 'idle' })
    this.resumeStatus = null
  }

  moveCursor = (direction: -1 | 1) => {
    if (this.snapshot.status !== 'idle' || this.targets.length === 0) return
    const index = Math.max(0, Math.min(this.targets.length - 1, this.snapshot.currentNoteIndex + direction))
    this.publish({ currentNoteIndex: index, ...this.expected(index), feedback: null, matchFeedback: null })
  }

  clearActiveNotes = () => { this.activeNotes.clear(); this.blockedUntilRelease.clear(); this.matcher.reset(); this.runMatcher.reset(); this.publish({ feedback: null, matchFeedback: null }) }
  dispose = () => { this.matcher.reset(); this.runMatcher.reset() }

  handleMidiEvent = (event: MidiNoteEvent) => {
    const key = `${event.channel}:${event.midiNote}`
    if (event.type === 'noteoff' || event.velocity === 0) {
      this.activeNotes.delete(key)
      this.blockedUntilRelease.delete(key)
      return
    }
    if (this.activeNotes.has(key) || this.blockedUntilRelease.has(key)) return
    this.activeNotes.add(key)
    if (this.snapshot.status !== 'practicing' || this.snapshot.expectedMidiNote === null) return

    if (this.snapshot.flowMode === 'run-through') {
      this.runMatcher.flushExpired()
      if (this.snapshot.status === 'practicing') this.runMatcher.press(this.snapshot.expectedMidiNotes, event.midiNote)
    } else this.matcher.press(this.snapshot.expectedMidiNotes, event.midiNote, event.timestamp)
  }
  private handleAttempt(result: AttemptMatch) {
    if (this.snapshot.status !== 'practicing' || this.snapshot.flowMode !== 'run-through') return
    const targetIndex = this.snapshot.currentNoteIndex, occurrence = this.occurrences[targetIndex]
    const attempt: PracticeAttemptResult = {
      ...result, sequenceOccurrenceId: occurrence?.id ?? `legacy:${targetIndex}`,
      sourceMomentId: occurrence?.sourceMoment.id ?? `legacy:${targetIndex}`,
      measureNumber: occurrence?.sourceMoment.measureNumber ?? '', practiceMode: this.practiceMode, flowMode: 'run-through',
    }
    const completed = targetIndex === this.targets.length - 1, index = completed ? targetIndex : targetIndex + 1
    this.publish({ attempts: [...this.snapshot.attempts, attempt], currentNoteIndex: index, ...this.expected(index),
      correctNoteCount: this.snapshot.correctNoteCount + (result.result === 'correct' ? 1 : 0),
      status: completed ? 'completed' : 'practicing', feedback: result.result,
      matchFeedback: { ...result, status: result.result, targetIndex },
    })
  }
  private handleResult(result: MomentMatchFeedback) {
    if (this.snapshot.status !== 'practicing') return
    const matchFeedback = { ...result, targetIndex: this.snapshot.currentNoteIndex }
    if (result.status !== 'correct') {
      this.publish({ feedback: result.status === 'pending' ? null : 'incorrect', matchFeedback })
      return
    }
    const feedback = 'correct'
    const correctNoteCount = this.snapshot.correctNoteCount + 1
    if (this.snapshot.currentNoteIndex === this.targets.length - 1) {
      // Keep the cursor on the final target note.
      this.publish({ correctNoteCount, feedback, matchFeedback, status: 'completed' })
      return
    }
    const index = this.snapshot.currentNoteIndex + 1
    const jumped = this.repeatJumps.has(index)
    this.publish({ currentNoteIndex: index, ...this.expected(index), correctNoteCount, feedback: jumped ? null : feedback, matchFeedback: jumped ? null : matchFeedback })
  }
}
