import type { MidiNoteEvent } from './midiTypes'

/** Normalize note messages only. Pedals, clock, active sensing, etc. are ignored. */
export function parseMidiMessage(data: ArrayLike<number> | null, timestamp: number): MidiNoteEvent | null {
  if (!data || data.length < 3) return null
  const [status, midiNote, velocity] = [data[0], data[1], data[2]]
  if (![status, midiNote, velocity].every(Number.isInteger)) return null
  if (status < 0x80 || status > 0xef || midiNote < 0 || midiNote > 127 || velocity < 0 || velocity > 127) return null
  const command = status & 0xf0
  if (command !== 0x90 && command !== 0x80) return null
  return {
    type: command === 0x80 || velocity === 0 ? 'noteoff' : 'noteon',
    midiNote, velocity, timestamp, channel: (status & 0x0f) + 1,
  }
}

/** Display only: MIDI note numbers remain the canonical values. */
export function midiNoteName(midiNote: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  return `${names[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`
}
