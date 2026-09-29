import type { DemoPreviewEvent } from './DemoLookAhead'

/** Display-only clock. It cannot stop, clear MIDI, or change the playback token. */
export class DemoPreviewScheduler {
  private token = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  get pending() { return this.timer !== undefined }
  cancel() { ++this.token; clearTimeout(this.timer); this.timer = undefined }
  start(events: readonly DemoPreviewEvent[], startedAt: number, notify: (event: DemoPreviewEvent) => void) {
    this.cancel()
    const token = this.token
    const schedule = (index: number) => {
      if (token !== this.token) return
      while (index < events.length && startedAt + events[index].dueMs <= performance.now()) index++
      if (index >= events.length) return
      const event = events[index]
      this.timer = setTimeout(() => {
        if (token !== this.token) return
        this.timer = undefined
        if (performance.now() < startedAt + event.atMs) { schedule(index); return }
        try { if (performance.now() < startedAt + event.dueMs) notify(event) }
        catch { /* A display consumer cannot own the music lifecycle. */ }
        finally { schedule(index + 1) }
      }, Math.max(0, startedAt + event.atMs - performance.now()))
    }
    schedule(0)
  }
}
