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

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
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
    try {
      output.send(NOTE_ON)
      // Schedule at the MIDI port, not a JS timer: background timer throttling must not hold the note.
      output.send(NOTE_OFF, now + TEST_DURATION_MS)
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

  /** Each stop attempt is independent: CC123 is still attempted if clear or Note Off fails. */
  private sendStop(output: MIDIOutput) {
    let succeeded = true
    let cleared = false
    // clear() is in the Web MIDI spec but is not implemented in every browser/type library.
    const clearable = output as MIDIOutput & { clear?: () => void }
    if (typeof clearable.clear === 'function') {
      try { clearable.clear(); cleared = true } catch { succeeded = false }
    }
    for (const action of [() => output.send(NOTE_OFF), () => output.send(ALL_NOTES_OFF)]) {
      try { action() } catch { succeeded = false }
    }
    return { succeeded, cleared }
  }

  stopAllNotes = () => {
    // Keep emergency stop available after a send failure, as long as the port is still present.
    const output = this.output
    if (!output || output.state !== 'connected') { this.readyOutput(); return }
    const { succeeded, cleared } = this.sendStop(output)
    // Without clear(), the queued Note Off still exists. Wait out its original 500ms
    // before another C4 can start, so that old Note Off cannot cut the next test short.
    if (cleared) this.cancelDisplayTimer()
    this.publish({ playing: cleared ? false : this.snapshot.playing, ...(succeeded
      ? { latestMessage: { type: 'allnotesoff' as const, data: [...ALL_NOTES_OFF], timestamp: performance.now() }, message: 'Note OffとAll Notes Offを送信しました。' }
      : { status: 'error' as const, message: '停止メッセージを送信できませんでした。接続とPX-100の発音状態を確認してください。' }),
    })
  }

  private cancelDisplayTimer() {
    clearTimeout(this.displayTimer)
    this.displayTimer = undefined
  }
  private releaseOutput() {
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
