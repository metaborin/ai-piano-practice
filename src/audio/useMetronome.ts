import { useEffect, useState, useSyncExternalStore } from 'react'
import { ClickAudio } from './ClickAudio'
import { Metronome } from './Metronome'

export function useMetronome() {
  const [metronome] = useState(() => new Metronome(new ClickAudio()))
  const snapshot = useSyncExternalStore(metronome.subscribe, metronome.getSnapshot)
  useEffect(() => {
    const hidden = () => { if (document.hidden) metronome.stop() }
    const stop = () => metronome.stop()
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop)
    return () => { metronome.stop(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop) }
  }, [metronome])
  return { metronome, metronomeState: snapshot }
}
