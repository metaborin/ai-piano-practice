export type DemoMidiContext = { session: number; generation: number; sequenceIndex: number; measure: string | null; repeatPass: number | null }
export type DemoMidiEvent = 'START' | 'NOTE_ON' | 'NOTE_OFF' | 'REPEAT_JUMP' | 'CLEAR' | 'ALL_NOTES_OFF' | 'GENERATION_CHANGE' | 'SKIP' | 'STOP' | 'COMPLETE' | 'INTERRUPTED' | 'SEND_ERROR'
export type DemoMidiTraceEntry = DemoMidiContext & { order: number; event: DemoMidiEvent; requestedAt: number; timestamp?: number; pitch?: number; reason?: string }

/** Bounded local send-request log. No React subscriptions, MIDI calls or timers. */
export class DemoMidiTrace {
  private entries: DemoMidiTraceEntry[] = []
  private order = 0
  private context: DemoMidiContext = { session: 0, generation: 0, sequenceIndex: 0, measure: null, repeatPass: null }
  setContext(context: DemoMidiContext) { this.context = context }
  record(event: DemoMidiEvent, details: { timestamp?: number; pitch?: number; reason?: string } = {}) {
    this.entries.push({ ...this.context, order: ++this.order, event, requestedAt: performance.now(), ...details })
    if (this.entries.length > 2048) this.entries.splice(0, this.entries.length - 2048)
  }
  read = (): readonly DemoMidiTraceEntry[] => this.entries.map(entry => ({ ...entry }))
}
