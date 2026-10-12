import type { ClickSound } from './Metronome'

/** Synthesized locally: no MIDI notes, sample download, permission prompt or audio upload. */
export class ClickAudio implements ClickSound {
  private context: AudioContext | null = null
  private voices = new Map<OscillatorNode, GainNode>()
  prepare = async () => {
    this.context ??= new AudioContext()
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Audio unavailable')
  }
  play = (accent: boolean) => {
    const context = this.context
    if (!context || context.state !== 'running') throw new Error('Audio suspended')
    const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(accent ? 1400 : 900, now)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(accent ? 0.18 : 0.12, now + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035)
    oscillator.connect(gain); gain.connect(context.destination)
    this.voices.set(oscillator, gain)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(oscillator) }
    oscillator.start(now); oscillator.stop(now + 0.04)
  }
  stop = () => {
    for (const [oscillator, gain] of this.voices) {
      // Disconnect synchronously as well as cancelling the active oscillator.
      gain.disconnect(); oscillator.stop(); oscillator.disconnect(); oscillator.onended = null
    }
    this.voices.clear()
  }
}
