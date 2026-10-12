import type { MetronomeBeat } from './buildMetronomePlan'

export type ClickSound = { prepare: () => Promise<void>; play: (accent: boolean) => void; stop: () => void }
export type MetronomeTransport = {
  schedule: (beats: readonly MetronomeBeat[], startedAt: number, originMs: number, fromMs: number, toMs: number) => void
  stop: () => void
  unavailable?: (message: string) => void
}
type Window = { beats: readonly MetronomeBeat[]; startedAt: number; originMs: number; fromMs: number; toMs: number }
export type MetronomeSnapshot = { readonly enabled: boolean; readonly status: 'off' | 'ready' | 'playing' | 'error'; readonly message: string }

/** A cancellable, optional click track; it never receives MIDI or changes pitch grading. */
export class Metronome implements MetronomeTransport {
  private snapshot: MetronomeSnapshot = { enabled: false, status: 'off', message: '' }
  private listeners = new Set<() => void>()
  private window: Window | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private enableRequest = 0
  private prepared = false
  private problem = ''
  private readonly sound: ClickSound
  constructor(sound: ClickSound) { this.sound = sound }
  getSnapshot = () => this.snapshot
  getDiagnostics = () => ({ scheduledTimers: Number(this.timer !== undefined), hasWindow: !!this.window })
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private publish(patch: Partial<MetronomeSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()) }
  private cancel(silence: boolean) {
    ++this.generation
    clearTimeout(this.timer); this.timer = undefined
    if (silence) this.sound.stop()
  }
  /** Must be called by the ON control's user gesture to unlock browser audio. */
  setEnabled = async (enabled: boolean) => {
    const request = ++this.enableRequest
    this.cancel(true)
    this.prepared = false
    this.publish({ enabled, status: enabled ? 'ready' : 'off', message: '' })
    if (!enabled) return
    try {
      await this.sound.prepare()
      if (request !== this.enableRequest || !this.snapshot.enabled) return
      this.prepared = true
      if (this.problem) { this.fail(this.problem); return }
      this.run(false)
    } catch { if (request === this.enableRequest) this.fail() }
  }
  schedule = (beats: readonly MetronomeBeat[], startedAt: number, originMs: number, fromMs: number, toMs: number) => {
    this.cancel(false)
    this.problem = ''
    this.window = { beats, startedAt, originMs, fromMs, toMs }
    this.run(true)
  }
  unavailable = (message: string) => {
    this.window = null; this.problem = message
    this.cancel(true)
    if (this.snapshot.enabled) this.fail(message)
  }
  private fail(message = 'クリック音を再生できません。メトロノームをOFF→ONにして、Chromeの音声設定を確認してください。') {
    this.cancel(true); this.prepared = false
    this.publish({ status: 'error', message })
  }
  private run(includeDue: boolean) {
    if (!this.snapshot.enabled || !this.prepared || !this.window) return
    const { beats, startedAt, originMs, fromMs, toMs } = this.window
    const generation = this.generation
    const due = (beat: MetronomeBeat) => startedAt + beat.atMs - originMs
    const now = performance.now()
    const from = Math.max(fromMs - 1e-7, includeDue ? -Infinity : now - startedAt + originMs)
    let low = 0, high = beats.length
    while (low < high) { const middle = (low + high) >>> 1; if (beats[middle].atMs < from) low = middle + 1; else high = middle }
    let index = low
    this.publish({ status: 'playing', message: '' })
    const tick = () => {
      if (generation !== this.generation || !this.snapshot.enabled) return
      this.timer = undefined
      // Skip missed beats after a blocked/background tab, never burst clicks.
      while (index >= 0 && index < beats.length && beats[index].atMs < toMs - 1e-7 && performance.now() - due(beats[index]) > 100) index++
      if (index < 0 || index >= beats.length || beats[index].atMs >= toMs - 1e-7) return
      const remaining = due(beats[index]) - performance.now()
      if (remaining > 0) { this.timer = setTimeout(tick, Math.ceil(remaining)); return }
      try { this.sound.play(beats[index].accent) } catch { this.fail(); return }
      index++
      if (index < beats.length && beats[index].atMs < toMs - 1e-7) this.timer = setTimeout(tick, Math.max(0, Math.ceil(due(beats[index]) - performance.now())))
    }
    tick()
  }
  stop = () => {
    this.cancel(true); this.window = null; this.problem = ''
    if (this.snapshot.status !== 'error') this.publish({ status: this.snapshot.enabled ? 'ready' : 'off', message: '' })
  }
}
