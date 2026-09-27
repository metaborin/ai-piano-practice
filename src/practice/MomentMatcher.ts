import type { NoteMatch } from './NoteMatcher'
export const CHORD_WINDOW_MS = 300

/** Collect fresh Note Ons only. Releases/held-key suppression belong to the session. */
export class MomentMatcher {
  private received = new Set<number>()
  private startedAt: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private readonly result: (match: NoteMatch) => void
  constructor(result: (match: NoteMatch) => void) { this.result = result }
  reset = () => {
    ++this.generation; clearTimeout(this.timer); this.timer = undefined
    this.received.clear(); this.startedAt = undefined
  }
  private finish(match: NoteMatch) { this.reset(); this.result(match) }
  press(expected: readonly number[], midiNote: number, timestamp = performance.now()) {
    if (!expected.length) return
    if (!expected.includes(midiNote)) { this.finish('incorrect'); return }
    if (expected.length === 1) { this.finish('correct'); return }
    if (this.startedAt !== undefined && (timestamp - this.startedAt > CHORD_WINDOW_MS || timestamp < this.startedAt)) { this.finish('incorrect'); return }
    if (this.startedAt === undefined) {
      this.startedAt = timestamp
      const generation = ++this.generation
      // Inclusive boundary: an event at exactly 300ms can still complete the chord.
      this.timer = setTimeout(() => { if (generation === this.generation) this.finish('incorrect') }, CHORD_WINDOW_MS + 1)
    }
    this.received.add(midiNote)
    if (expected.every((note) => this.received.has(note))) this.finish('correct')
  }
}
