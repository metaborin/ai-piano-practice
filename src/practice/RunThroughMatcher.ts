import { CHORD_WINDOW_MS } from './MomentMatcher'
import type { PracticeAttemptResult } from './PracticeAttemptResult'

export const CHORD_MAX_WINDOW_MS = CHORD_WINDOW_MS
export const CHORD_SETTLE_MS = 100
export type AttemptMatch = Pick<PracticeAttemptResult, 'expectedMidiNotes' | 'playedMidiNotes' | 'matchedMidiNotes' | 'missingMidiNotes' | 'unexpectedMidiNotes' | 'result' | 'startedAt' | 'completedAt'>

/** Groups input attempts, not beats. No input means no attempt and no advancement. */
export class RunThroughMatcher {
  private expected: readonly number[] = []
  private received = new Set<number>()
  private startedAt = 0
  private deadline = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private readonly report: (result: AttemptMatch) => void
  constructor(report: (result: AttemptMatch) => void) { this.report = report }

  reset = () => {
    ++this.generation; clearTimeout(this.timer); this.timer = undefined
    this.expected = []; this.received.clear()
  }
  /** Flush before the session reads the current target, since completion advances it. */
  flushExpired = () => {
    if (this.received.size && performance.now() >= this.deadline) this.finish()
  }
  press(expected: readonly number[], midiNote: number) {
    if (!expected.length || this.received.has(midiNote)) return
    const now = performance.now()
    if (!this.received.size) {
      this.expected = [...expected]; this.startedAt = now
    }
    this.received.add(midiNote)
    if (expected.length === 1) { this.finish(); return }
    this.deadline = Math.min(this.startedAt + CHORD_MAX_WINDOW_MS, now + CHORD_SETTLE_MS)
    clearTimeout(this.timer)
    const generation = ++this.generation
    this.timer = setTimeout(() => { if (generation === this.generation) this.finish() }, Math.max(0, this.deadline - now))
  }
  private finish() {
    const expected = this.expected, played = [...this.received].sort((a, b) => a - b)
    const missing = expected.filter(note => !this.received.has(note))
    const unexpected = played.filter(note => !expected.includes(note))
    const result: AttemptMatch = {
      expectedMidiNotes: [...expected], playedMidiNotes: played,
      matchedMidiNotes: expected.filter(note => this.received.has(note)),
      missingMidiNotes: missing, unexpectedMidiNotes: unexpected,
      result: missing.length || unexpected.length ? 'incorrect' : 'correct',
      startedAt: this.startedAt, completedAt: performance.now(),
    }
    this.reset()
    this.report(result)
  }
}
