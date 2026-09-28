import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MidiEventSource } from '../midi/midiTypes'
import { PracticeSession } from './PracticeSession'
import { flushSync } from 'react-dom'

/** Wires MIDI to practice without coupling either domain to OSMD or React rendering. */
export function usePracticeSession(events: MidiEventSource) {
  const [session] = useState(() => new PracticeSession())
  const practice = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    const unsubscribeNotes = events.subscribeNoteEvents(event => {
      // A repeat transition must be visible before the next input handler runs.
      if (session.isBeforeNavigationJump()) flushSync(() => session.handleMidiEvent(event))
      else session.handleMidiEvent(event)
    })
    const unsubscribeReset = events.subscribeInputReset(session.clearActiveNotes)
    return () => { unsubscribeNotes(); unsubscribeReset(); session.dispose() }
  }, [events, session])
  return {
    session, practice, start: session.start, restart: session.restart,
    moveCursor: session.moveCursor, onScoreReady: session.loadScore,
  }
}
