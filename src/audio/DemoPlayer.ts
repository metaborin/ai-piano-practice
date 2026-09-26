import type { PracticeScore as ScoreModel } from '../score/ScoreModel'

export const DEFAULT_TEMPO_BPM = 100
export const DEMO_GATE_RATIO = 0.9
const MAX_LATENESS_MS = 150

export type DemoNote = {
  index: number
  midiNote: number
  startMs: number
  durationMs: number
  noteOffMs: number
}
/** Only the supplied score is read. No separate melody or duration list. */
export function buildDemoNotes(score: ScoreModel, tempoBpm = DEFAULT_TEMPO_BPM): DemoNote[] {
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0 || score.notes.length === 0) throw new Error('Invalid demo score or tempo')
  let startMs = 0
  return score.notes.map(({ midiNote, durationBeats }, index) => {
    if (!Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127 || !Number.isFinite(durationBeats) || durationBeats <= 0) {
      throw new Error('Invalid demo note')
    }
    const durationMs = durationBeats * 60_000 / tempoBpm
    if (!Number.isFinite(startMs + durationMs)) throw new Error('Invalid demo duration')
    const note = { index, midiNote, startMs, durationMs, noteOffMs: startMs + durationMs * DEMO_GATE_RATIO }
    startMs += durationMs
    return note
  })
}
export type DemoOutput = {
  beginDemo: () => boolean
  playDemoNote: (midiNote: number, onTime: number, offTime: number) => boolean
  finishDemo: () => void
  stopAllNotes: () => void
  subscribeDemoInterrupted: (listener: () => void) => () => void
}
export type DemoSnapshot = {
  status: 'idle' | 'playing' | 'stopped' | 'completed' | 'error'
  currentNoteIndex: number
  totalNotes: number
  message: string
}

/** Browser/React/OSMD-independent sequencer. MIDI and view share a monotonic timeline. */
export class DemoPlayer {
  private snapshot: DemoSnapshot = { status: 'idle', currentNoteIndex: 0, totalNotes: 0, message: '' }
  private listeners = new Set<() => void>()
  private score: ScoreModel | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribeOutput: (() => void) | undefined
  private generation = 0

  private readonly output: DemoOutput
  private readonly beforeStart: () => void
  constructor(output: DemoOutput, beforeStart: () => void = () => {}) {
    this.output = output
    this.beforeStart = beforeStart
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<DemoSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  loadScore = (score: ScoreModel | null) => {
    this.stop()
    this.cancelTimers()
    this.score = score
    this.publish({ status: 'idle', currentNoteIndex: 0, totalNotes: score?.notes.length ?? 0, message: '' })
  }
  resetDisplay = () => {
    if (this.snapshot.status !== 'playing') this.publish({ status: 'idle', currentNoteIndex: 0, message: '' })
  }
  start = () => {
    if (this.snapshot.status === 'playing') return
    let notes: DemoNote[]
    try {
      if (!this.score) throw new Error('No score')
      notes = buildDemoNotes(this.score)
    } catch {
      this.publish({ status: 'error', message: '手本の楽譜を読み込めません。ページを再読み込みしてください。' })
      return
    }
    if (!this.output.beginDemo()) {
      this.publish({ status: 'error', message: 'MIDI出力の接続と、テスト音が終了していることを確認してください。' })
      return
    }
    // Synchronous: reset/disable grading before any MIDI output or possible loopback.
    this.beforeStart()
    this.publish({ status: 'playing', currentNoteIndex: 0, message: '手本を再生中です' })
    const generation = ++this.generation
    this.unsubscribeOutput = this.output.subscribeDemoInterrupted(() => {
      if (generation === this.generation) this.interrupted()
    })
    const startedAt = performance.now()
    const play = (index: number) => {
      if (generation !== this.generation || this.snapshot.status !== 'playing') return
      const note = notes[index]
      const due = startedAt + note.startMs
      const now = performance.now()
      // A timer may fire slightly early. Never put a future Note On in an uncancellable queue.
      if (now < due) { this.timer = setTimeout(() => play(index), due - now); return }
      if (now - due > MAX_LATENESS_MS || now >= startedAt + note.noteOffMs) {
        this.stop()
        this.publish({ message: '再生が遅れたため停止しました。「手本を聴く」で最初から聴けます。' })
        return
      }
      if (!this.output.playDemoNote(note.midiNote, due, startedAt + note.noteOffMs)) {
        this.stop()
        this.publish({ status: 'error', message: '手本を送信できませんでした。MIDI出力の接続を確認してください。' })
        return
      }
      this.publish({ currentNoteIndex: note.index })
      if (index + 1 < notes.length) {
        this.timer = setTimeout(() => play(index + 1), Math.max(0, startedAt + notes[index + 1].startMs - performance.now()))
      } else {
        const finish = () => {
          if (generation !== this.generation) return
          const remaining = startedAt + note.noteOffMs - performance.now()
          if (remaining > 0) { this.timer = setTimeout(finish, remaining); return }
          this.cancelTimers()
          this.output.finishDemo()
          this.publish({ status: 'completed', message: '手本の再生が終わりました' })
        }
        this.timer = setTimeout(finish, Math.max(0, startedAt + note.noteOffMs - performance.now()))
      }
    }
    play(0)
  }
  private cancelTimers() {
    ++this.generation
    clearTimeout(this.timer)
    this.timer = undefined
    this.unsubscribeOutput?.()
    this.unsubscribeOutput = undefined
  }
  private interrupted() {
    this.cancelTimers()
    this.publish({ status: 'stopped', message: '手本を停止しました' })
  }
  stop = () => {
    if (this.snapshot.status !== 'playing') return
    this.cancelTimers()
    this.output.stopAllNotes()
    this.publish({ status: 'stopped', message: '手本を停止しました' })
  }
}
