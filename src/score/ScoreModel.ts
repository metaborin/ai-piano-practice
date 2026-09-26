import musicXml from '../scores/twinkle.musicxml?raw'

/** Score content is independent of MIDI devices and UI state. */
export type ScoreSource = { id: string; title: string; partLabel: string; musicXml: string }
export type ScoreNote = { readonly midiNote: number; readonly durationBeats: number }
/** Ordered one-to-one with the rendered OSMD cursor positions. */
export type ScoreModel = ScoreSource & { readonly notes: readonly ScoreNote[] }
export const twinkleScore: ScoreSource = {
  id: 'twinkle-opening', title: 'きらきら星', partLabel: '右手・単音', musicXml,
}
