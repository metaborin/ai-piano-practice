export type MidiNoteEvent = {
  type: 'noteon' | 'noteoff'
  midiNote: number
  velocity: number
  /** MIDIMessageEvent.timeStamp: milliseconds relative to the browser time origin. */
  timestamp: number
  /** Channels are 1–16. */
  channel: number
}

export type MidiConnectionStatus = 'disconnected' | 'waiting' | 'connected' | 'error'
export type MidiInputDevice = { id: string; name: string; manufacturer: string }
export type MidiSnapshot = {
  status: MidiConnectionStatus
  requesting: boolean
  message: string
  inputs: MidiInputDevice[]
  selectedInputId: string | null
  latestEvent: MidiNoteEvent | null
  lastNoteOn: MidiNoteEvent | null
  lastNoteOff: MidiNoteEvent | null
}
