/** Move only outside a comfortable visible band, placing the target about 45% down.
 * Coordinates come from the rendered cursor, not assumed measure/system heights.
 */
export function scrollDelta(start: number, end: number, visibleStart: number, visibleEnd: number): number {
  const space = visibleEnd - visibleStart, size = end - start
  if (space <= 0 || size <= 0) return 0
  const lead = Math.min(32, space * 0.08)
  if (size >= space) return start >= visibleStart && start < visibleStart + lead ? 0 : start - visibleStart
  if (start >= visibleStart && end <= visibleEnd - lead) return 0
  return start - (visibleStart + (space - size) * 0.45)
}

/** Event-driven only: no scroll listener, polling, MIDI or OSMD ownership. */
export function followScoreCursor(view: HTMLElement, cursor: HTMLElement, immediate: boolean, vertical = true) {
  if (!view.isConnected || !cursor.isConnected) return
  // Cancel an old smooth move before an explicit jump/restoration, even if already visible.
  if (immediate) view.scrollTo({ top: view.scrollTop, left: view.scrollLeft, behavior: 'instant' })
  const card = view.closest<HTMLElement>('.score-card')
  if (!card) return // Hidden import validation must never move the page.
  const header = card.querySelector<HTMLElement>('.score-status')
  const margin = 12
  let bounds = view.getBoundingClientRect(), target = cursor.getBoundingClientRect()
  let top = Math.max(bounds.top + margin, (header?.getBoundingClientRect().bottom ?? 0) + margin, margin)
  let bottom = Math.min(bounds.bottom - margin, window.innerHeight - margin)
  if (vertical && (target.top < top || target.bottom > bottom || bottom <= top)) {
    const panel = card.getBoundingClientRect()
    // A control click may have scrolled the page away from the score. Make the
    // bounded panel visible first; this is synchronous before demo's first send.
    if (panel.top < margin || panel.bottom > window.innerHeight - margin) {
      window.scrollTo({ top: Math.max(0, window.scrollY + panel.top - margin), behavior: 'instant' })
      bounds = view.getBoundingClientRect(); target = cursor.getBoundingClientRect()
      top = Math.max(bounds.top + margin, (header?.getBoundingClientRect().bottom ?? 0) + margin, margin)
      bottom = Math.min(bounds.bottom - margin, window.innerHeight - margin)
    }
  }
  const dy = vertical ? scrollDelta(target.top, target.bottom, top, bottom) : 0
  const dx = scrollDelta(target.left, target.right, Math.max(bounds.left + margin, margin), Math.min(bounds.right - margin, window.innerWidth - margin))
  const nextTop = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, view.scrollTop + dy))
  const nextLeft = Math.max(0, Math.min(view.scrollWidth - view.clientWidth, view.scrollLeft + dx))
  if (Math.abs(nextTop - view.scrollTop) < 1 && Math.abs(nextLeft - view.scrollLeft) < 1) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  view.scrollTo({ top: nextTop, left: nextLeft, behavior: immediate || reducedMotion ? 'instant' : 'smooth' })
}
