import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MidiOutputManager } from '../midi/MidiOutputManager'
import type { PracticeSession } from './PracticeSession'
import { DuetController } from './DuetController'

export function useDuetController(output: MidiOutputManager, session: PracticeSession) {
  const [controller] = useState(() => new DuetController(output, session))
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
