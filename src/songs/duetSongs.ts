import primoOnce from '../scores/duet/maim-maim-primo-once.musicxml?url&no-inline'
import primoOriginal from '../scores/duet/maim-maim-primo-original.musicxml?url&no-inline'
import secondoOnce from '../scores/duet/maim-maim-secondo-once.musicxml?url&no-inline'
import secondoOriginal from '../scores/duet/maim-maim-secondo-original.musicxml?url&no-inline'
import type { Song, DuetPartId } from './Song'

const duetSong = (version: 'once' | 'original', primo: string, secondo: string): Song => ({
  id: `maim-maim-duet-${version}`, title: `マイム・マイム連弾（${version}版）`, source: 'builtin',
  composer: 'イスラエル民謡 / PRIMOは新作教育用編曲', partLabel: 'SECONDO · 両手',
  musicXml: { type: 'url', value: secondo },
  duet: {
    id: `maim-maim-${version}`, defaultPart: 'secondo',
    parts: {
      primo: { label: 'PRIMO', description: '高音域・右手の新作単旋律', musicXml: { type: 'url', value: primo } },
      secondo: { label: 'SECONDO', description: '既存の両手の楽譜', musicXml: { type: 'url', value: secondo } },
    },
    downloads: {
      primoMxl: `${import.meta.env.BASE_URL}duet-scores/maim-maim-primo-${version}.mxl`,
      primoPdf: `${import.meta.env.BASE_URL}duet-scores/maim-maim-primo-${version}.pdf`,
      fullScore: `${import.meta.env.BASE_URL}duet-scores/maim-maim-full-score-${version}.musicxml`,
      fullMxl: `${import.meta.env.BASE_URL}duet-scores/maim-maim-full-score-${version}.mxl`,
    },
  },
})
export const duetSongs: readonly Song[] = [duetSong('once', primoOnce, secondoOnce), duetSong('original', primoOriginal, secondoOriginal)]
export const oppositePart = (part: DuetPartId): DuetPartId => part === 'primo' ? 'secondo' : 'primo'
export function songForDuetPart(song: Song, part: DuetPartId): Song {
  const data = song.duet?.parts[part]
  return data ? { ...song, musicXml: data.musicXml, partLabel: `${data.label} · ${data.description}` } : song
}
