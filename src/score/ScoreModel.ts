import musicXml from '../scores/twinkle.musicxml?raw'

/** Score content is independent of MIDI devices and UI state. */
export type ScoreModel = { id: string; title: string; partLabel: string; musicXml: string }
export const twinkleScore: ScoreModel = {
  id: 'twinkle-opening', title: 'きらきら星', partLabel: '右手・単音', musicXml,
}
