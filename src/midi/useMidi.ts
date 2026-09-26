import { useEffect, useState, useSyncExternalStore } from 'react'
import { MidiManager } from './MidiManager'

export function useMidi() {
  const [manager] = useState(() => new MidiManager())
  const midi = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  const output = useSyncExternalStore(manager.output.subscribe, manager.output.getSnapshot)
  useEffect(() => {
    const stop = () => { if (manager.output.getSnapshot().playing) manager.output.stopAllNotes() }
    window.addEventListener('pagehide', stop)
    return () => { window.removeEventListener('pagehide', stop); manager.disconnect() }
  }, [manager])
  return {
    midi, connect: manager.connect, selectInput: manager.selectInput, events: manager,
    output, selectOutput: manager.output.selectOutput, playTestNote: manager.output.playTestNote,
    stopAllNotes: manager.output.stopAllNotes, retryOutput: manager.output.retry,
  }
}
