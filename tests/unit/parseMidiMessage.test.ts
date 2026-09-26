import { describe, expect, it } from 'vitest'
import { midiNoteName, parseMidiMessage } from '../../src/midi/parseMidiMessage'

describe('MIDI normalization', () => {
  it('preserves C4, strike velocity, timestamp and channel 1', () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 72]), 123.5)).toEqual({ type: 'noteon', midiNote: 60, velocity: 72, timestamp: 123.5, channel: 1 })
  })
  it('preserves the release velocity on explicit Note Off', () => {
    expect(parseMidiMessage([0x8f, 60, 33], 42)).toEqual({ type: 'noteoff', midiNote: 60, velocity: 33, timestamp: 42, channel: 16 })
  })
  it('treats Note On with velocity zero as Note Off', () => {
    expect(parseMidiMessage([0x95, 67, 0], 12)).toMatchObject({ type: 'noteoff', midiNote: 67, velocity: 0, channel: 6 })
  })
  it.each([null, [], [0x90, 60], [0xfe], [0xb0, 64, 127], [0xf8, 0, 0], [0x90, 128, 60], [0x90, 60, -1], [0x90, 60, 128], [0x90, 60.5, 72]])('ignores non-note or malformed data: %j', (data) => {
    expect(parseMidiMessage(data, 0)).toBeNull()
  })
  it.each([[0, 'C-1'], [60, 'C4'], [61, 'C♯4'], [69, 'A4'], [72, 'C5'], [127, 'G9']])('formats %i as %s for display', (note, name) => {
    expect(midiNoteName(note as number)).toBe(name)
  })
})
