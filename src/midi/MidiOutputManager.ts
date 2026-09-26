import type { MidiConnectionStatus, MidiInputDevice } from './midiTypes'

export const OUTPUT_CHANNEL = 1
export const TEST_NOTE = 60
export const TEST_VELOCITY = 80
export const TEST_DURATION_MS = 500
const channelByte = OUTPUT_CHANNEL - 1
const NOTE_ON = [0x90 | channelByte, TEST_NOTE, TEST_VELOCITY]
const NOTE_OFF = [0x80 | channelByte, TEST_NOTE, 0]
const ALL_NOTES_OFF = [0xb0 | channelByte, 123, 0]

export type MidiOutputMessage = {
  type: 'noteon' | 'noteoff' | 'allnotesoff'
  data: number[]
  timestamp: number
}
export type MidiOutputSnapshot = {
  status: MidiConnectionStatus
  message: string
  outputs: MidiInputDevice[]
  selectedOutputId: string | null
  playing: boolean
  latestMessage: MidiOutputMessage | null
}
function initialSnapshot(): MidiOutputSnapshot {
  return {
    status: 'disconnected', message: '「MIDI接続」でMIDIの使用を許可してください。',
    outputs: [], selectedOutputId: null, playing: false, latestMessage: null,
  }
}

/** Uses the input manager's MIDIAccess; never requests permission or feeds input events. */
export class MidiOutputManager {
  private snapshot = initialSnapshot()
  private listeners = new Set<() => void>()
  private access: MIDIAccess | null = null
  private output: MIDIOutput | null = null
  // undefined: automatic choice; null: explicitly unselected; string: remember user's port.
  private preferredId: string | null | undefined
  private generation = 0
  private displayTimer: ReturnType<typeof setTimeout> | undefined
  private demoActive = false
  private demoInterruptedListeners = new Set<() => void>()
  private activeNote = TEST_NOTE
  private offDeadlines = new WeakMap<MIDIOutput, number>()

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  subscribeDemoInterrupted = (listener: () => void) => {
    this.demoInterruptedListeners.add(listener)
    return () => { this.demoInterruptedListeners.delete(listener) }
  }
  private interruptDemo() {
    if (!this.demoActive) return
    this.demoActive = false
    this.demoInterruptedListeners.forEach((listener) => listener())
  }
  private publish(patch: Partial<MidiOutputSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  attachAccess(access: MIDIAccess) {
    this.access = access
    this.refreshOutputs(true)
  }

  refreshOutputs = (force = false) => {
    if (!this.access) return
    const outputs = Array.from(this.access.outputs.values()).filter((port) => port.state === 'connected')
    const selected = this.preferredId === undefined
      ? outputs.find((port) => /u2midi|cme/i.test(`${port.name} ${port.manufacturer}`)) ?? outputs[0]
      : outputs.find((port) => port.id === this.preferredId)
    this.publish({ outputs: outputs.map((port) => ({ id: port.id, name: port.name || '名前のないMIDI出力', manufacturer: port.manufacturer || '' })) })
    if (!selected) {
      this.releaseOutput()
      this.publish({
        status: 'waiting', selectedOutputId: null,
        message: typeof this.preferredId === 'string'
          ? '選択したMIDI出力機器が切断されました。接続または出力機器の選択を確認してください。'
          : outputs.length === 0 ? 'MIDI出力機器が見つかりません。USB接続を確認してください。' : 'MIDI出力機器を選択してください。',
      })
    } else if (force || selected !== this.output) {
      this.activateOutput(selected)
    }
  }

  selectOutput = (id: string) => {
    this.preferredId = id || null
    this.refreshOutputs(true)
  }
  retry = () => this.refreshOutputs(true)

  private activateOutput(output: MIDIOutput) {
    this.releaseOutput()
    const generation = ++this.generation
    this.output = output
    this.publish({ status: 'waiting', selectedOutputId: output.id, latestMessage: null, message: `${output.name || 'MIDI出力'} に接続しています…` })
    void output.open().then(() => {
      if (generation !== this.generation) {
        if (this.output !== output) void output.close().catch(() => {})
        return
      }
      this.publish({ status: 'connected', message: `${output.name || 'MIDI出力'} · ${output.manufacturer || 'メーカー不明'}` })
      this.waitForPendingOff(output)
    }).catch(() => {
      if (generation !== this.generation) return
      this.publish({ status: 'error', message: 'MIDI出力機器を開けませんでした。「出力を再接続」で再試行してください。' })
    })
  }

  private readyOutput() {
    const output = this.output
    if (!output || output.state !== 'connected' || this.snapshot.status !== 'connected') {
      this.publish({ message: !this.access ? '「MIDI接続」でMIDIの使用を許可してください。' : 'MIDI出力に接続できていません。出力機器の選択とUSB接続を確認してください。' })
      return null
    }
    return output
  }

  playTestNote = () => {
    const output = this.readyOutput()
    if (!output || this.snapshot.playing) return
    const now = performance.now()
    this.activeNote = TEST_NOTE
    try {
      output.send(NOTE_ON)
      // Schedule at the MIDI port, not a JS timer: background timer throttling must not hold the note.
      output.send(NOTE_OFF, now + TEST_DURATION_MS)
      this.offDeadlines.set(output, now + TEST_DURATION_MS)
      this.publish({ playing: true, latestMessage: { type: 'noteon', data: [...NOTE_ON], timestamp: now } })
      this.displayTimer = setTimeout(() => {
        this.displayTimer = undefined
        this.publish({ playing: false, ...(this.snapshot.latestMessage?.type === 'noteon'
          ? { latestMessage: { type: 'noteoff' as const, data: [...NOTE_OFF], timestamp: now + TEST_DURATION_MS } } : {}) })
      }, TEST_DURATION_MS)
    } catch {
      this.sendStop(output)
      this.publish({ playing: false, status: 'error', message: 'MIDI出力を送信できませんでした。接続を確認し、「出力を再接続」で再試行してください。' })
    }
  }

  beginDemo = () => {
    if (!this.readyOutput() || this.snapshot.playing) return false
    this.demoActive = true
    this.publish({ playing: true })
    return true
  }
  playDemoNote = (midiNote: number, onTime: number, offTime: number) => {
    const output = this.readyOutput()
    const now = performance.now()
    if (!this.demoActive || !output || !Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127
      || !Number.isFinite(onTime) || !Number.isFinite(offTime) || onTime > now || offTime <= now) return false
    this.cancelDisplayTimer()
    this.activeNote = midiNote
    const noteOn = [0x90 | channelByte, midiNote, TEST_VELOCITY]
    const noteOff = [0x80 | channelByte, midiNote, 0]
    try {
      // onTime is now/past: only Note Off is ever placed in the future MIDI queue.
      output.send(noteOn, onTime)
      output.send(noteOff, offTime)
      this.offDeadlines.set(output, offTime)
      this.publish({ latestMessage: { type: 'noteon', data: noteOn, timestamp: onTime } })
      this.displayTimer = setTimeout(() => {
        this.displayTimer = undefined
        this.publish({ latestMessage: { type: 'noteoff', data: noteOff, timestamp: offTime } })
      }, Math.max(0, offTime - performance.now()))
      return true
    } catch {
      this.stopAllNotes()
      this.publish({ status: 'error', message: 'MIDI出力を送信できませんでした。接続を確認し、「出力を再接続」で再試行してください。' })
      return false
    }
  }
  finishDemo = () => {
    this.demoActive = false
    this.cancelDisplayTimer()
    this.publish({ playing: false, latestMessage: { type: 'noteoff', data: [0x80 | channelByte, this.activeNote, 0], timestamp: performance.now() } })
  }

  /** Each stop attempt is independent: CC123 is still attempted if clear or Note Off fails. */
  private sendStop(output: MIDIOutput) {
    let succeeded = true
    let cleared = false
    // clear() is in the Web MIDI spec but is not implemented in every browser/type library.
    const clearable = output as MIDIOutput & { clear?: () => void }
    if (typeof clearable.clear === 'function') {
      try { clearable.clear(); cleared = true; this.offDeadlines.delete(output) } catch { succeeded = false }
    }
    for (const action of [() => output.send([0x80 | channelByte, this.activeNote, 0]), () => output.send(ALL_NOTES_OFF)]) {
      try { action() } catch { succeeded = false }
    }
    return { succeeded, cleared }
  }

  stopAllNotes = () => {
    this.interruptDemo()
    // Keep emergency stop available after a send failure, as long as the port is still present.
    const output = this.output
    if (!output || output.state !== 'connected') {
      this.cancelDisplayTimer()
      this.publish({ playing: false })
      this.readyOutput()
      return
    }
    const { succeeded } = this.sendStop(output)
    // Without clear(), wait until the queued Note Off expires before another note/demo
    // can start, so that an old Note Off cannot cut the next playback short.
    this.cancelDisplayTimer()
    this.waitForPendingOff(output)
    this.publish({ ...(succeeded
      ? { latestMessage: { type: 'allnotesoff' as const, data: [...ALL_NOTES_OFF], timestamp: performance.now() }, message: 'Note OffとAll Notes Offを送信しました。' }
      : { status: 'error' as const, message: '停止メッセージを送信できませんでした。接続とPX-100の発音状態を確認してください。' }),
    })
  }

  private waitForPendingOff(output: MIDIOutput) {
    const remaining = Math.max(0, (this.offDeadlines.get(output) ?? 0) - performance.now())
    this.publish({ playing: remaining > 0 })
    if (remaining > 0) this.displayTimer = setTimeout(() => {
      this.displayTimer = undefined
      this.publish({ playing: false })
    }, remaining)
  }

  private cancelDisplayTimer() {
    clearTimeout(this.displayTimer)
    this.displayTimer = undefined
  }
  private releaseOutput() {
    this.interruptDemo()
    ++this.generation
    this.cancelDisplayTimer()
    const output = this.output
    this.output = null
    if (output) {
      if (this.snapshot.playing && output.state === 'connected') this.sendStop(output)
      void output.close().catch(() => {})
    }
    if (this.snapshot.playing) this.publish({ playing: false })
  }
  disconnect = () => {
    this.releaseOutput()
    this.access = null
    this.preferredId = undefined
    this.snapshot = initialSnapshot()
    this.listeners.forEach((listener) => listener())
  }
}
