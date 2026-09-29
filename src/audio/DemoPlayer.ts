import type { PracticeScore as ScoreModel } from '../score/ScoreModel'
import type { PracticePlan } from '../practice/PracticePlan'
import { buildDemoPlan } from './buildDemoPlan'
import { DEFAULT_TEMPO_BPM, DEMO_GATE_RATIO } from './tempo'
import { resolveDemoStart } from './DemoStart'
import type { DemoStart } from './DemoStart'
import { buildDemoPreviews } from './DemoLookAhead'
import type { DemoPreview } from './DemoLookAhead'
import type { ScoreSystems } from '../score/ScoreLookAhead'
import { DemoPreviewScheduler } from './DemoPreviewScheduler'
import type { DemoMidiTrace } from '../midi/DemoMidiTrace'
import { navigationJump } from '../score/ScoreLookAhead'

export { DEFAULT_TEMPO_BPM, DEMO_GATE_RATIO } from './tempo'
const MAX_ATTACK_LATENESS_MS = 150

export type DemoNote = {
  index: number
  midiNote: number
  startMs: number
  durationMs: number
  noteOffMs: number
  cursorMomentId?: string
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
  trace?: DemoMidiTrace
  beginDemo: () => boolean
  playDemoNote: (midiNote: number, onTime: number, offTime: number) => boolean
  playDemoNotes?: (notes: readonly { midiNote: number; offTime: number }[], onTime: number) => boolean
  finishDemo: () => void
  stopAllNotes: () => void
  subscribeDemoInterrupted: (listener: () => void) => () => void
}
export type DemoSnapshot = {
  status: 'idle' | 'playing' | 'stopped' | 'completed' | 'error'
  currentNoteIndex: number
  totalNotes: number
  message: string
  cursorMomentId: string | null
  preview: DemoPreview | null
}

/** Browser/React/OSMD-independent sequencer. MIDI and view share a monotonic timeline. */
export class DemoPlayer {
  private snapshot: DemoSnapshot = { status: 'idle', currentNoteIndex: 0, totalNotes: 0, message: '', cursorMomentId: null, preview: null }
  private listeners = new Set<() => void>()
  private score: ScoreModel | null = null
  private plan: PracticePlan | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribeOutput: (() => void) | undefined
  private generation = 0
  private playbackSession = 0
  private systems: ScoreSystems | null = null
  private previews = new DemoPreviewScheduler()
  private refreshPreviews: (() => void) | undefined
  private startSequenceIndex = 0
  private skippedNotes = 0
  private visualErrors = 0
  setSystems = (systems: ScoreSystems | null) => {
    this.systems = systems
    this.refreshPreviews?.()
  }

  private readonly output: DemoOutput
  private readonly beforeStart: () => void
  private readonly publishPosition: (update: () => void) => void
  constructor(output: DemoOutput, beforeStart: () => void = () => {}, publishPosition: (update: () => void) => void = (update) => update()) {
    this.output = output
    this.beforeStart = beforeStart
    this.publishPosition = publishPosition
  }
  getSnapshot = () => this.snapshot
  getDiagnostics = () => {
    const occurrence = this.plan?.sequence.occurrences[this.snapshot.currentNoteIndex]
    return { generation: this.generation, playbackSession: this.playbackSession, startSequenceIndex: this.startSequenceIndex, sequenceIndex: this.snapshot.currentNoteIndex,
      sequenceLength: this.snapshot.totalNotes, measure: occurrence?.sourceMoment.measureNumber ?? null, repeatPass: occurrence?.repeatPass ?? null,
      scheduledTimers: Number(this.timer !== undefined) + Number(this.previews.pending), skippedNotes: this.skippedNotes, visualErrors: this.visualErrors }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<DemoSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  /** Rendering is best-effort. An adapter failure must not tear down the MIDI clock. */
  private position(patch: Partial<DemoSnapshot>, before?: () => void) {
    const generation = this.generation
    let applied = false
    const update = () => { if (applied || generation !== this.generation) return; applied = true; before?.(); this.publish(patch) }
    try { this.publishPosition(update) }
    catch {
      this.visualErrors++
      if (!applied) update()
    }
  }
  private tracePosition(index: number) {
    const occurrence = this.plan?.sequence.occurrences[index]
    this.output.trace?.setContext({ session: this.playbackSession, generation: this.generation, sequenceIndex: index,
      measure: occurrence?.sourceMoment.measureNumber ?? null, repeatPass: occurrence?.repeatPass ?? null })
  }
  loadScore = (score: ScoreModel | null) => {
    ++this.playbackSession
    this.stop()
    this.cancelTimers()
    this.score = score
    this.plan = null
    this.publish({ status: 'idle', currentNoteIndex: 0, totalNotes: score?.notes.length ?? 0, message: '', cursorMomentId: null, preview: null })
  }
  loadPlan = (plan: PracticePlan | null) => {
    this.loadScore(null)
    this.plan = plan
    this.publish({ totalNotes: plan?.sequence.occurrences.length ?? 0 })
  }
  resetDisplay = () => {
    if (this.snapshot.status !== 'playing') this.publish({ status: 'idle', currentNoteIndex: 0, message: '', cursorMomentId: null })
  }
  playFromMoment = (momentId: string) => this.start({ kind: 'moment', momentId })
  playFromOccurrence = (occurrenceId: string) => this.start({ kind: 'occurrence', occurrenceId })
  start = (start: DemoStart = { kind: 'beginning' }) => {
    if (this.snapshot.status === 'playing') return
    let notes: DemoNote[]
    let firstIndex = 0
    let firstMoment: string | null = null
    let startMessage = '手本を再生中です'
    try {
      if (this.plan) {
        const origin = resolveDemoStart(this.plan, start)
        firstIndex = origin.index
        startMessage = origin.message ?? startMessage
        firstMoment = origin.cursorMomentId ?? this.plan.sequence.occurrences[firstIndex].sourceMoment.id
        notes = buildDemoPlan(this.plan, start)
      }
      else if (this.score && start.kind === 'beginning') notes = buildDemoNotes(this.score)
      else throw new Error('No score')
    } catch (error) {
      this.publish({ status: 'error', message: error instanceof Error && error.message.startsWith('指定した位置') ? error.message : '手本の楽譜を読み込めません。ページを再読み込みしてください。' })
      return
    }
    // Every play has fresh clocks and subscriptions, before exposing the new session.
    this.cancelTimers()
    const generation = this.generation
    const playbackSession = ++this.playbackSession
    this.startSequenceIndex = firstIndex; this.skippedNotes = 0; this.visualErrors = 0
    this.tracePosition(firstIndex)
    this.output.trace?.record('START')
    if (!this.output.beginDemo()) {
      this.publish({ status: 'error', message: 'MIDI出力の接続と、テスト音が終了していることを確認してください。' })
      return
    }
    // Synchronous: reset/disable grading before any MIDI output or possible loopback.
    // The adapter commits cursor position synchronously before the first MIDI send.
    this.unsubscribeOutput = this.output.subscribeDemoInterrupted(() => {
      if (generation === this.generation) this.interrupted()
    })
    this.position({ status: 'playing', currentNoteIndex: firstIndex, cursorMomentId: firstMoment, message: startMessage, preview: null }, this.beforeStart)
    if (generation !== this.generation || this.getSnapshot().status !== 'playing') return
    const startedAt = performance.now()
    this.refreshPreviews = () => {
      this.previews.cancel()
      this.publish({ preview: null })
      const events = this.plan && this.systems ? buildDemoPreviews(notes, this.plan, this.systems) : []
      this.previews.start(events, startedAt, event => {
        if (generation === this.generation && this.snapshot.status === 'playing') this.position({ preview: event })
      })
    }
    const endMs = notes.reduce((end, note) => Math.max(end, note.noteOffMs), 0)
    const finish = () => {
      if (generation !== this.generation) return
      this.timer = undefined
      const remaining = startedAt + endMs - performance.now()
      if (remaining > 0) { this.timer = setTimeout(finish, remaining); return }
      this.cancelTimers()
      this.output.finishDemo()
      this.output.trace?.record('COMPLETE')
      this.publish({ status: 'completed', message: '手本の再生が終わりました', preview: null })
    }
    const play = (index: number) => {
      if (generation !== this.generation || this.snapshot.status !== 'playing') return
      this.timer = undefined
      // Do not burst overdue attacks, shift musical time, or stop because drawing
      // blocked the UI thread. Resume the original clock at a still-valid attack.
      const caughtUpAt = performance.now()
      while (index < notes.length) {
        let end = index + 1
        while (end < notes.length && notes[end].startMs === notes[index].startMs) end++
        const onset = notes.slice(index, end)
        if (caughtUpAt - (startedAt + notes[index].startMs) <= MAX_ATTACK_LATENESS_MS && onset.every(voice => caughtUpAt < startedAt + voice.noteOffMs)) break
        for (const voice of onset) {
          this.tracePosition(voice.index)
          this.output.trace?.record('SKIP', { timestamp: startedAt + voice.startMs, pitch: voice.midiNote, reason: 'whole onset expired before audio callback' })
          this.skippedNotes++
        }
        index = end
      }
      if (index >= notes.length) { finish(); return }
      const note = notes[index]
      const due = startedAt + note.startMs
      const now = performance.now()
      // A timer may fire slightly early. Never put a future Note On in an uncancellable queue.
      if (now < due) { this.timer = setTimeout(() => play(index), due - now); return }
      // Complete the entire MIDI onset BEFORE committing React/OSMD work.
      // Initial positioning happened before startedAt; upcoming viewports still
      // use independent previews. A display stall cannot selectively lose a voice.
      const cursorMomentId = note.cursorMomentId ?? this.plan?.sequence.occurrences[note.index]?.sourceMoment.id ?? null
      const preview = this.snapshot.preview && this.snapshot.preview.occurrenceIndex > note.index ? this.snapshot.preview : null
      this.tracePosition(note.index)
      if (this.plan && navigationJump(this.plan, this.snapshot.currentNoteIndex, note.index)) this.output.trace?.record('REPEAT_JUMP', { timestamp: due })
      let next = index
      while (next < notes.length && notes[next].startMs === note.startMs) next++
      const voices = notes.slice(index, next).map(voice => ({ midiNote: voice.midiNote, offTime: startedAt + voice.noteOffMs }))
      const sent = this.output.playDemoNotes ? this.output.playDemoNotes(voices, due)
        : voices.every(voice => generation === this.generation && this.output.playDemoNote(voice.midiNote, due, voice.offTime))
      if (!sent) {
        if (playbackSession !== this.playbackSession) return
        this.stop()
        this.publish({ status: 'error', message: '手本を送信できませんでした。MIDI出力の接続を確認してください。' })
        return
      }
      if (generation !== this.generation) return
      if (next < notes.length) {
        this.timer = setTimeout(() => play(next), Math.max(0, startedAt + notes[next].startMs - performance.now()))
      } else {
        this.timer = setTimeout(finish, Math.max(0, startedAt + endMs - performance.now()))
      }
      if (this.snapshot.currentNoteIndex !== note.index || this.snapshot.cursorMomentId !== cursorMomentId || this.snapshot.preview !== preview) {
        this.position({ currentNoteIndex: note.index, cursorMomentId, preview })
      }
    }
    if (notes[0].startMs > 0) this.timer = setTimeout(() => play(0), notes[0].startMs)
    else play(0)
    if (generation === this.generation) this.refreshPreviews?.()
  }
  private cancelTimers() {
    ++this.generation
    this.tracePosition(this.snapshot.currentNoteIndex)
    this.output.trace?.record('GENERATION_CHANGE')
    clearTimeout(this.timer)
    this.previews.cancel()
    this.refreshPreviews = undefined
    this.timer = undefined
    this.unsubscribeOutput?.()
    this.unsubscribeOutput = undefined
  }
  private interrupted() {
    this.output.trace?.record('INTERRUPTED')
    this.cancelTimers()
    this.publish({ status: 'stopped', message: '手本を停止しました', preview: null })
  }
  stop = () => {
    if (this.snapshot.status !== 'playing') return
    this.output.trace?.record('STOP')
    this.cancelTimers()
    this.output.stopAllNotes()
    this.publish({ status: 'stopped', message: '手本を停止しました', preview: null })
  }
}
