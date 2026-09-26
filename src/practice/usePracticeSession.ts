import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MidiEventSource } from '../midi/midiTypes'
import { PracticeSession } from './PracticeSession'

/** Wires MIDI to practice without coupling either domain to OSMD or React rendering. */
export function usePracticeSession(events: MidiEventSource) {
  const [session] = useState(() => new PracticeSession())
  const practice = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    const unsubscribeNotes = events.subscribeNoteEvents(session.handleMidiEvent)
    const unsubscribeReset = events.subscribeInputReset(session.clearActiveNotes)
    return () => { unsubscribeNotes(); unsubscribeReset() }
  }, [events, session])
  return {
    practice, start: session.start, restart: session.restart,
    moveCursor: session.moveCursor, onScoreReady: session.loadScore,
  }
}
