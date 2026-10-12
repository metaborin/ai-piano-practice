import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MidiOutputManager } from '../midi/MidiOutputManager'
import type { PracticeSession } from './PracticeSession'
import { DuetController } from './DuetController'
import type { MetronomeTransport } from '../audio/Metronome'

export function useDuetController(output: MidiOutputManager, session: PracticeSession, metronome?: MetronomeTransport) {
  const [controller] = useState(() => new DuetController(output, session, metronome))
  const duet = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    const stopWhenHidden = () => { if (document.hidden) controller.stop() }
    const stop = () => controller.stop()
    document.addEventListener('visibilitychange', stopWhenHidden)
    window.addEventListener('pagehide', stop)
    return () => { controller.stop(); document.removeEventListener('visibilitychange', stopWhenHidden); window.removeEventListener('pagehide', stop) }
  }, [controller])
  return { controller, duet }
}
