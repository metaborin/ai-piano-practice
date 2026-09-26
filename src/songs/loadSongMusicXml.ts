import type { Song } from './Song'

/** Acquisition only: both URL and stored text enter the same existing score pipeline. */
export async function loadSongMusicXml(song: Song): Promise<string> {
  switch (song.musicXml.type) {
    case 'text':
      return song.musicXml.value
    case 'url': {
      const response = await fetch(song.musicXml.value)
      if (!response.ok) throw new Error('MusicXML request failed: ' + response.status)
      return response.text()
    }
  }
}
