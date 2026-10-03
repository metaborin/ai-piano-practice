import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Display only. Deliberately has no practice, player or MIDI dependencies. */
export function useOriginalFullscreen(enabled: boolean) {
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const activeRef = useRef(false), owned = useRef(false), generation = useRef(0)
  const entryFocus = useRef<HTMLElement | null>(null)
  const invalidateRequest = useCallback(() => { ++generation.current; activeRef.current = false }, [])
  const close = useCallback(() => {
    invalidateRequest(); setActive(false)
    if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {})
  }, [invalidateRequest])
  const enter = () => {
    if (!enabled || activeRef.current || !root.current) return
    entryFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = ++generation.current
    activeRef.current = true; setActive(true)
    // CSS mode is already usable while the browser request is pending or rejected.
    try {
      void root.current.requestFullscreen?.().then(() => {
        if (id !== generation.current && !activeRef.current && document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {})
      }).catch(() => {})
    } catch { /* CSS fallback also covers synchronous browser exceptions. */ }
  }
  useEffect(() => {
    const element = root.current
    const changed = () => {
      if (document.fullscreenElement === root.current) owned.current = true
      else if (owned.current) { owned.current = false; close() }
    }
    const escape = (event: KeyboardEvent) => { if (activeRef.current && event.key === 'Escape') close() }
    document.addEventListener('fullscreenchange', changed)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', escape)
      invalidateRequest()
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {})
    }
  }, [close, invalidateRequest])
  useEffect(() => { if (!enabled && activeRef.current) close() }, [enabled, close])
  useLayoutEffect(() => {
    if (!active) return
    const previousFocus = entryFocus.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const siblings = [...(root.current?.parentElement?.children ?? [])].filter(el => el !== root.current && el instanceof HTMLElement) as HTMLElement[]
    const wasInert = siblings.map(el => el.inert)
    siblings.forEach(el => { el.inert = true })
    root.current?.querySelector<HTMLButtonElement>('.fullscreen-exit')?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = overflow
      siblings.forEach((el, i) => { el.inert = wasInert[i] })
      previousFocus?.focus({ preventScroll: true })
    }
  }, [active])
  return { root, active, enter, close }
}
