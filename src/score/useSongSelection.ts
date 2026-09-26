import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DemoPlayer } from '../audio/DemoPlayer'
import type { MidiOutputManager } from '../midi/MidiOutputManager'
import type { PracticeSession } from '../practice/PracticeSession'
import { SongSelection } from './SongSelection'

export function useSongSelection(session: PracticeSession, player: DemoPlayer, output: MidiOutputManager) {
  const [selection] = useState(() => new SongSelection(null, {
    reset: () => {
      session.loadScore(null)
      player.loadScore(null)
      // Also release an active C4 test, retaining device selection and MIDIAccess.
      if (output.getSnapshot().playing) output.stopAllNotes()
    },
    apply: (model) => {
      player.loadScore(model)
      session.loadScore(model)
    },
  }))
  const songState = useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot)
  useEffect(() => selection.cancel, [selection])
  return { selection, songState }
}
