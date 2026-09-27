export const CHORD_WINDOW_MS = 300
export type MomentMatchFeedback = {
  readonly status: 'pending' | 'correct' | 'incorrect'
  readonly expectedMidiNotes: readonly number[]
  readonly matchedMidiNotes: readonly number[]
  readonly missingMidiNotes: readonly number[]
  readonly unexpectedMidiNotes: readonly number[]
}

/** Collect fresh Note Ons only. Releases/held-key suppression belong to the session. */
export class MomentMatcher {
  private received = new Set<number>()
  private startedAt: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private readonly result: (match: MomentMatchFeedback) => void
  constructor(result: (match: MomentMatchFeedback) => void) { this.result = result }
  reset = () => {
    ++this.generation; clearTimeout(this.timer); this.timer = undefined
    this.received.clear(); this.startedAt = undefined
  }
  private report(status: MomentMatchFeedback['status'], expected: readonly number[], unexpected: number[] = []) {
    const feedback: MomentMatchFeedback = { status, expectedMidiNotes: [...expected],
      matchedMidiNotes: expected.filter((note) => this.received.has(note)),
      missingMidiNotes: expected.filter((note) => !this.received.has(note)), unexpectedMidiNotes: unexpected }
    if (status !== 'pending') this.reset()
    this.result(feedback)
  }
  press(expected: readonly number[], midiNote: number, timestamp = performance.now()) {
    if (!expected.length) return
    if (!expected.includes(midiNote)) { this.report('incorrect', expected, [midiNote]); return }
    if (this.startedAt !== undefined && (timestamp - this.startedAt > CHORD_WINDOW_MS || timestamp < this.startedAt)) { this.report('incorrect', expected); return }
    if (this.startedAt === undefined) {
      this.startedAt = timestamp
      const generation = ++this.generation
      // Inclusive boundary: an event at exactly 300ms can still complete the chord.
      this.timer = setTimeout(() => { if (generation === this.generation) this.report('incorrect', expected) }, CHORD_WINDOW_MS + 1)
    }
    this.received.add(midiNote)
    this.report(expected.every((note) => this.received.has(note)) ? 'correct' : 'pending', expected)
  }
}
