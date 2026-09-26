import { useEffect, useState, useSyncExternalStore } from 'react'
import { MidiManager } from './MidiManager'

export function useMidi() {
  const [manager] = useState(() => new MidiManager())
  const midi = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  useEffect(() => () => manager.disconnect(), [manager])
  return { midi, connect: manager.connect, selectInput: manager.selectInput }
}
