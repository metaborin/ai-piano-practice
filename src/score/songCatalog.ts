export type Song = {
  readonly id: string
  readonly title: string
  readonly partLabel: string
  readonly loadMusicXml: () => Promise<{ default: string }>
}

// Vite resolves these raw imports into base-aware, independently loaded assets.
// MusicXML is the only source of pitches, durations and note counts.
export const songs: readonly Song[] = [
  { id: 'twinkle-opening', title: 'きらきら星', partLabel: '右手・単音', loadMusicXml: () => import('../scores/twinkle.musicxml?raw') },
  { id: 'do-re-mi', title: 'ドレミの練習', partLabel: '右手・単音', loadMusicXml: () => import('../scores/do-re-mi.musicxml?raw') },
  { id: 'short-melody', title: '短いメロディ', partLabel: '右手・単音', loadMusicXml: () => import('../scores/short-melody.musicxml?raw') },
]

/** Acquisition only; parsing and rendering belong to the score pipeline. */
export async function getSongMusicXml(song: Song): Promise<string> {
  return (await song.loadMusicXml()).default
}
