import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DemoPlayer } from '../audio/DemoPlayer'
import type { MidiOutputManager } from '../midi/MidiOutputManager'
import type { PracticeSession } from '../practice/PracticeSession'
import { SongSelection } from './SongSelection'
import type { DuetController } from '../practice/DuetController'

export function useSongSelection(session: PracticeSession, player: DemoPlayer, output: MidiOutputManager, duet: DuetController) {
  const [selection] = useState(() => new SongSelection(null, {
    reset: () => {
      session.stop()
      duet.loadPlans(null, null)
      session.loadPlan(null)
      player.loadPlan(null)
      // Also release an active C4 test, retaining device selection and MIDIAccess.
      if (output.getSnapshot().playing) output.stopAllNotes()
    },
    apply: (model, partner) => {
      player.loadPlan(model)
      session.loadPlan(model)
      duet.loadPlans(model, partner)
    },
    position: session.setStartTarget,
  }))
  const songState = useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot)
  useEffect(() => selection.cancel, [selection])
  return { selection, songState }
}
