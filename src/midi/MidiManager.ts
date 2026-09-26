import type { MidiSnapshot } from './midiTypes'
import { parseMidiMessage } from './parseMidiMessage'

function initialSnapshot(): MidiSnapshot {
  return {
    status: 'disconnected', requesting: false,
    message: '「MIDI接続」を押して、ChromeでMIDIの使用を許可してください。',
    inputs: [], selectedInputId: null,
    latestEvent: null, lastNoteOn: null, lastNoteOff: null,
  }
}

/** Owns browser MIDI access only; it has no knowledge of the score or cursor. */
export class MidiManager {
  private snapshot = initialSnapshot()
  private listeners = new Set<() => void>()
  private access: MIDIAccess | null = null
  private input: MIDIInput | null = null
  private generation = 0

  getSnapshot = (): MidiSnapshot => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(patch: Partial<MidiSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  connect = async (): Promise<void> => {
    if (this.snapshot.requesting) return
    if (!window.isSecureContext) {
      this.publish({ status: 'error', message: 'MIDIにはHTTPS、またはこの端末のlocalhostで開く必要があります。' })
      return
    }
    if (!navigator.requestMIDIAccess) {
      this.publish({ status: 'error', message: 'このブラウザーはWeb MIDIに対応していません。Google Chromeで開いてください。' })
      return
    }
    const generation = ++this.generation
    this.publish({ status: 'waiting', requesting: true, message: 'MIDIの使用許可を確認しています…' })
    try {
      // Called only from the connection button. SysEx and MIDI output are unused.
      const access = this.access ?? await navigator.requestMIDIAccess({ sysex: false })
      if (generation !== this.generation) return
      this.access = access
      access.addEventListener('statechange', this.onStateChange)
      this.publish({ requesting: false })
      this.refreshInputs(true)
    } catch (error) {
      if (generation !== this.generation) return
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      this.publish({
        status: 'error', requesting: false,
        message: denied
          ? 'MIDIの使用が許可されていません。Chromeのサイト設定でMIDIを許可し、もう一度接続してください。'
          : 'MIDIに接続できませんでした。ChromeのMIDI権限と入力機器を確認して、もう一度接続してください。',
      })
    }
  }

  selectInput = (id: string) => {
    const input = this.access?.inputs.get(id)
    if (input?.state === 'connected') this.activateInput(input)
  }
  private onStateChange = () => { this.refreshInputs() }

  private refreshInputs(force = false) {
    if (!this.access) return
    const inputs = Array.from(this.access.inputs.values()).filter((input) => input.state === 'connected')
    const selected = inputs.find((input) => input.id === this.snapshot.selectedInputId)
      ?? inputs.find((input) => input.name === 'U2MIDI Pro MIDI 1')
      ?? inputs.find((input) => input.name?.includes('U2MIDI Pro'))
      ?? inputs[0]
    this.publish({ inputs: inputs.map((input) => ({ id: input.id, name: input.name || '名前のないMIDI入力', manufacturer: input.manufacturer || '' })) })
    if (!selected) {
      ++this.generation
      this.releaseInput()
      this.publish({ status: 'waiting', requesting: false, selectedInputId: null, latestEvent: null, lastNoteOn: null, lastNoteOff: null, message: '入力機器の接続待ちです。機器が見つかると自動で接続します。' })
    } else if (force || selected !== this.input) {
      this.activateInput(selected)
    }
  }

  private activateInput(input: MIDIInput) {
    const generation = ++this.generation
    this.releaseInput()
    this.input = input
    this.publish({ status: 'waiting', selectedInputId: input.id, latestEvent: null, lastNoteOn: null, lastNoteOff: null, message: `${input.name || 'MIDI入力'} に接続しています…` })
    input.addEventListener('midimessage', this.onMidiMessage)
    void input.open().then(() => {
      if (generation !== this.generation) {
        if (this.input !== input) void input.close().catch(() => {})
        return
      }
      this.publish({ status: 'connected', message: `${input.name || 'MIDI入力'} · ${input.manufacturer || 'メーカー不明'}` })
    }).catch(() => {
      if (generation !== this.generation) return
      input.removeEventListener('midimessage', this.onMidiMessage)
      this.publish({ status: 'error', message: '入力機器を開けませんでした。「MIDI接続」で再試行してください。' })
    })
  }

  private onMidiMessage = (message: MIDIMessageEvent) => {
    if (message.currentTarget !== this.input) return
    const event = parseMidiMessage(message.data, message.timeStamp)
    if (!event) return
    this.publish({ latestEvent: event, ...(event.type === 'noteon' ? { lastNoteOn: event } : { lastNoteOff: event }) })
  }

  private releaseInput() {
    const input = this.input
    this.input = null
    if (!input) return
    input.removeEventListener('midimessage', this.onMidiMessage)
    void input.close().catch(() => { /* The device may already be unplugged. */ })
  }

  disconnect = () => {
    ++this.generation
    this.access?.removeEventListener('statechange', this.onStateChange)
    this.access = null
    this.releaseInput()
    this.snapshot = initialSnapshot()
    this.listeners.forEach((listener) => listener())
  }
}
