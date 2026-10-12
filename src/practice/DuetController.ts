import type { MidiOutputManager } from '../midi/MidiOutputManager'
import type { PracticeSession } from './PracticeSession'
import type { PracticePlan } from './PracticePlan'
import type { PracticeStart } from './PracticeStartResolver'
import { buildDuetTimeline } from './DuetPlan'
import type { DemoNote } from '../audio/DemoPlayer'

export type DuetSnapshot = { readonly status: 'idle' | 'playing' | 'waiting' | 'stopped' | 'completed' | 'error'; readonly message: string }
type Timeline = ReturnType<typeof buildDuetTimeline>
/** Two-part transport. No React/DOM/OSMD dependencies and no second MIDI input handler. */
export class DuetController {
  private snapshot: DuetSnapshot = { status: 'idle', message: '' }
  private listeners = new Set<() => void>()
  private own: PracticePlan | null = null
  private partner: PracticePlan | null = null
  private timeline: Timeline | null = null
  private generation = 0
  private boundaryTimer: ReturnType<typeof setTimeout> | undefined
  private attackTimer: ReturnType<typeof setTimeout> | undefined
  private subscriptions: (() => void)[] = []
  private outputOwned = false
  private partnerEnabled = false
  private advancing = false
  private internalStop = false
  private waiting = false
  private index = 0
  private startedAt = 0
  private originMs = 0
  private playbackSession = 0
  private readonly output: MidiOutputManager
  private readonly session: PracticeSession
  constructor(output: MidiOutputManager, session: PracticeSession) { this.output = output; this.session = session }
  getSnapshot = () => this.snapshot
  getDiagnostics = () => ({ generation: this.generation, timers: Number(this.boundaryTimer !== undefined) + Number(this.attackTimer !== undefined), outputOwned: this.outputOwned })
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<DuetSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()) }
  private active() { return this.snapshot.status === 'playing' || this.snapshot.status === 'waiting' }
  loadPlans = (own: PracticePlan | null, partner: PracticePlan | null) => {
    this.stop()
    this.own = own; this.partner = partner; this.timeline = null
    this.session.setClockMode('input')
    this.publish({ status: 'idle', message: '' })
  }
  start = (start: PracticeStart, partnerEnabled: boolean) => {
    this.stop()
    if (!this.own || !this.partner || this.session.getSnapshot().startTargetIndex === null) return false
    try { this.timeline = buildDuetTimeline(this.own, this.partner) }
    catch (error) { this.publish({ status: 'error', message: error instanceof Error ? error.message : '連弾の演奏順を準備できませんでした。' }); return false }
    this.partnerEnabled = partnerEnabled
    if (partnerEnabled && !this.output.beginDemo()) {
      this.publish({ status: 'error', message: '相手パートを鳴らすMIDI出力を接続し、テスト音・停止処理が終わってから開始してください。' })
      return false
    }
    this.outputOwned = partnerEnabled
    ++this.generation
    this.waiting = false
    this.session.setClockMode(this.session.getSnapshot().flowMode === 'run-through' ? 'timed' : 'paced')
    this.session.start()
    this.index = this.session.getSnapshot().currentNoteIndex
    const timeline = this.timeline
    this.originMs = start.kind === 'beginning' ? 0 : start.kind === 'current' ? timeline.targetStarts[this.index]
      : timeline.measureStarts[this.own.sequence.playback.measures.findIndex(m => m.source.index === start.measureIndex)]
    this.startedAt = performance.now()
    ++this.playbackSession
    this.tracePosition()
    this.output.trace.record('START', { reason: 'duet practice' })
    this.publish({ status: 'playing', message: partnerEnabled ? '相手パートと一緒に練習中です' : '曲の速さに合わせて通し練習中です' })
    const generation = this.generation
    this.subscriptions.push(this.session.subscribe(() => {
      if (generation !== this.generation || this.advancing) return
      if (this.session.getSnapshot().status !== 'practicing') { this.stop(); return }
      if (this.waiting && this.session.isTargetSatisfied()) this.resume()
    }))
    if (partnerEnabled) {
      this.subscriptions.push(this.output.subscribeDemoInterrupted(() => {
        if (!this.internalStop && generation === this.generation) this.stop()
      }))
      this.subscriptions.push(this.output.subscribe(() => {
        if (!this.internalStop && generation === this.generation && this.output.getSnapshot().status !== 'connected') {
          this.stop(); this.publish({ status: 'error', message: 'MIDI出力が切断されたため、連弾を停止しました。接続後に再開してください。' })
        }
      }))
    }
    this.window(this.originMs, true)
    return true
  }
  private due(ms: number) { return this.startedAt + ms - this.originMs }
  private tracePosition() {
    const occurrence = this.own?.sequence.occurrences[this.index]
    this.output.trace.setContext({ session: this.playbackSession, generation: this.generation, sequenceIndex: this.index,
      measure: occurrence?.sourceMoment.measureNumber ?? null, repeatPass: occurrence?.repeatPass ?? null })
  }
  private window(from: number, restoreHeld: boolean) {
    const timeline = this.timeline!
    const to = timeline.targetStarts[this.index + 1] ?? timeline.endMs
    const generation = this.generation
    if (this.partnerEnabled) {
      const notes = timeline.notes.filter(n => n.startMs >= from && n.startMs < to)
      if (restoreHeld) notes.unshift(...timeline.notes.filter(n => n.startMs < from && n.noteOffMs > from).map(n => ({ ...n, startMs: from })))
      notes.sort((a,b) => a.startMs - b.startMs)
      this.playAttacks(notes, 0, generation)
    }
    if (generation !== this.generation) return
    const boundary = () => {
      if (generation !== this.generation || !this.active()) return
      this.boundaryTimer = undefined
      const remaining = this.due(to) - performance.now()
      if (remaining > 0) { this.boundaryTimer = setTimeout(boundary, Math.ceil(remaining)); return }
      if (this.session.getSnapshot().flowMode === 'until-correct' && !this.session.isTargetSatisfied()) {
        this.waiting = true
        // Only pause at a target boundary. Continuous correct playing keeps long
        // notes and queued Offs intact, including across repeated measures.
        this.releaseOutput()
        this.publish({ status: 'waiting', message: '正しい音を待っています。弾けたら相手パートも続きます。' })
      } else this.advance(to, false)
    }
    this.boundaryTimer = setTimeout(boundary, Math.max(0, Math.ceil(this.due(to) - performance.now())))
  }
  private playAttacks(notes: readonly DemoNote[], index: number, generation: number) {
    if (generation !== this.generation || !this.active() || this.waiting) return
    this.attackTimer = undefined
    while (index < notes.length) {
      const due = this.due(notes[index].startMs), now = performance.now()
      if (now < due) { this.attackTimer = setTimeout(() => this.playAttacks(notes, index, generation), Math.ceil(due - now)); return }
      let next = index + 1
      while (next < notes.length && notes[next].startMs === notes[index].startMs) next++
      const onset = notes.slice(index, next)
      // Same rolling policy as DemoPlayer: future On messages stay cancellable
      // in JS. Never burst expired attacks after a background stall.
      if (now - due <= 150 && onset.every(n => this.due(n.noteOffMs) > now)) {
        const voices = onset.map(n => ({ midiNote: n.midiNote, offTime: this.due(n.noteOffMs) }))
        const sent = this.session.withoutMidiInput(() => this.output.playDemoNotes(voices, due))
        if (!sent) { this.stop(); this.publish({ status: 'error', message: '相手パートを送信できませんでした。MIDI出力を確認してください。' }); return }
      }
      index = next
      if (generation !== this.generation) return
    }
  }
  private advance(to: number, restoreHeld: boolean) {
    this.advancing = true
    try { this.session.finishClockTarget() } finally { this.advancing = false }
    if (this.session.getSnapshot().status === 'completed') {
      this.output.trace.record('COMPLETE', { reason: 'duet practice' })
      this.cancel()
      if (this.outputOwned) this.output.finishDemo()
      this.outputOwned = false
      this.session.setClockMode('input')
      this.publish({ status: 'completed', message: '連弾練習が終わりました' })
      return
    }
    const nextIndex = this.session.getSnapshot().currentNoteIndex
    if (this.own!.sequence.occurrences[nextIndex].measureOccurrenceIndex !== this.own!.sequence.occurrences[this.index].measureOccurrenceIndex
      && this.own!.sequence.occurrences[nextIndex].sourceMoment.measureIndex < this.own!.sequence.occurrences[this.index].sourceMoment.measureIndex) {
      this.output.trace.record('REPEAT_JUMP', { timestamp: this.due(to), reason: 'duet practice' })
    }
    this.index = nextIndex
    this.tracePosition()
    this.window(to, restoreHeld)
  }
  private resume() {
    if (!this.active() || !this.waiting) return
    const generation = this.generation
    // A browser without MIDIOutput.clear must drain old Offs before reusing
    // pitches. The manager retains this barrier; retrying does not queue an On.
    if (this.partnerEnabled && !this.output.beginDemo()) {
      if (generation !== this.generation) return
      this.boundaryTimer = setTimeout(() => { if (generation === this.generation) this.resume() }, 25)
      return
    }
    this.waiting = false
    const to = this.timeline!.targetStarts[this.index + 1] ?? this.timeline!.endMs
    this.originMs = to; this.startedAt = performance.now()
    this.publish({ status: 'playing', message: '相手パートと一緒に練習中です' })
    this.advance(to, true)
  }
  private releaseOutput() {
    clearTimeout(this.attackTimer); this.attackTimer = undefined
    if (this.outputOwned) {
      this.internalStop = true
      try { this.output.stopAllNotes() } finally { this.internalStop = false }
    }
  }
  private cancel() {
    ++this.generation
    clearTimeout(this.boundaryTimer); clearTimeout(this.attackTimer)
    this.boundaryTimer = undefined; this.attackTimer = undefined
    this.subscriptions.splice(0).forEach(unsubscribe => unsubscribe())
    this.waiting = false
  }
  stop = () => {
    if (!this.active()) return
    this.output.trace.record('STOP', { reason: 'duet practice' })
    this.cancel()
    this.session.stop()
    this.releaseOutput()
    this.outputOwned = false
    this.session.setClockMode('input')
    this.publish({ status: 'stopped', message: '連弾練習を停止しました' })
  }
}
