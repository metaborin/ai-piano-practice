import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PracticeSession } from '../practice/PracticeSession'
import { DemoPlayer } from './DemoPlayer'
import type { DemoOutput } from './DemoPlayer'

/** Mode coordination is synchronous; echoed notes cannot slip through a React effect delay. */
export function useDemoPlayer(output: DemoOutput, practice: PracticeSession) {
  const [player] = useState(() => new DemoPlayer(output, practice.beginDemo))
  const demo = useSyncExternalStore(player.subscribe, player.getSnapshot)
  useEffect(() => {
    const unsubscribe = player.subscribe(() => {
      if (player.getSnapshot().status !== 'playing') practice.endDemo()
    })
    const stopWhenHidden = () => { if (document.hidden) player.stop() }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => { player.stop(); unsubscribe(); document.removeEventListener('visibilitychange', stopWhenHidden) }
  }, [player, practice])
  return { demo, player }
}
