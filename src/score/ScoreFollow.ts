/** Move only outside a comfortable visible band, placing the target about 35% down.
 * Coordinates come from the rendered cursor, not assumed measure/system heights.
 */
export function scrollDelta(start: number, end: number, visibleStart: number, visibleEnd: number): number {
  const space = visibleEnd - visibleStart, size = end - start
  if (space <= 0 || size <= 0) return 0
  const lead = Math.min(32, space * 0.08)
  if (size >= space) return start >= visibleStart && start < visibleStart + lead ? 0 : start - visibleStart
  if (start >= visibleStart && end <= visibleEnd - lead) return 0
  return start - (visibleStart + (space - size) * 0.35)
}

/** Fit current + next without hiding current. If both cannot fit, reveal as much
 * of next as possible while preserving current (small screens / tall imported spacing).
 */
export function lookAheadDelta(currentTop: number, currentBottom: number, nextTop: number, nextBottom: number, visibleTop: number, visibleBottom: number): number {
  if (visibleBottom <= visibleTop || currentBottom <= currentTop) return 0
  if (currentTop >= visibleTop && currentBottom <= visibleBottom && nextTop >= visibleTop && nextBottom <= visibleBottom) return 0
  const lower = Math.max(currentBottom, nextBottom) - visibleBottom
  const upper = Math.min(currentTop, nextTop) - visibleTop
  if (lower > upper) return currentTop - visibleTop
  const preferred = currentTop - visibleTop - (visibleBottom - visibleTop - (currentBottom - currentTop)) * 0.35
  return Math.min(upper, Math.max(lower, preferred))
}
type FollowBox = { top: number; bottom: number; left: number; right: number }
export type FollowPreview = { readonly box: FollowBox; readonly currentBox?: FollowBox; readonly navigationJump: boolean }

/** Event-driven only: no scroll listener, polling, MIDI or OSMD ownership. */
export function followScoreCursor(view: HTMLElement, cursor: HTMLElement, immediate: boolean, vertical = true, preview?: FollowPreview) {
  if (!view.isConnected || !cursor.isConnected) return
  // Cancel an old smooth move before an explicit jump/restoration, even if already visible.
  if (immediate) view.scrollTo({ top: view.scrollTop, left: view.scrollLeft, behavior: 'instant' })
  const card = view.closest<HTMLElement>('.score-card')
  if (!card) return // Hidden import validation must never move the page.
  const header = card.querySelector<HTMLElement>('.score-status')
  const margin = 12
  let bounds = view.getBoundingClientRect(), target = cursor.getBoundingClientRect()
  let previewBox = preview?.box
  let currentBox = preview?.currentBox
  let top = Math.max(bounds.top + margin, (header?.getBoundingClientRect().bottom ?? 0) + margin, margin)
  let bottom = Math.min(bounds.bottom - margin, window.innerHeight - margin)
  if (vertical && (target.top < top || target.bottom > bottom || bottom <= top)) {
    const panel = card.getBoundingClientRect()
    // A control click may have scrolled the page away from the score. Make the
    // bounded panel visible first; this is synchronous before demo's first send.
    if (panel.top < margin || panel.bottom > window.innerHeight - margin) {
      window.scrollTo({ top: Math.max(0, window.scrollY + panel.top - margin), behavior: 'instant' })
      const oldTop = bounds.top, oldLeft = bounds.left
      bounds = view.getBoundingClientRect(); target = cursor.getBoundingClientRect()
      if (previewBox) previewBox = { top: previewBox.top + bounds.top - oldTop, bottom: previewBox.bottom + bounds.top - oldTop,
        left: previewBox.left + bounds.left - oldLeft, right: previewBox.right + bounds.left - oldLeft }
      if (currentBox) currentBox = { top: currentBox.top + bounds.top - oldTop, bottom: currentBox.bottom + bounds.top - oldTop,
        left: currentBox.left + bounds.left - oldLeft, right: currentBox.right + bounds.left - oldLeft }
      top = Math.max(bounds.top + margin, (header?.getBoundingClientRect().bottom ?? 0) + margin, margin)
      bottom = Math.min(bounds.bottom - margin, window.innerHeight - margin)
    }
  }
  const destination = preview?.navigationJump && previewBox ? previewBox : target
  const dy = vertical ? preview && previewBox && !preview.navigationJump
    ? lookAheadDelta(currentBox?.top ?? target.top, currentBox?.bottom ?? target.bottom, previewBox.top, previewBox.bottom, top, bottom)
    : scrollDelta(destination.top, destination.bottom, top, bottom) : 0
  // A preview must not pan horizontally away from the current notes.
  const dx = scrollDelta(destination.left, destination.right, Math.max(bounds.left + margin, margin), Math.min(bounds.right - margin, window.innerWidth - margin))
  const nextTop = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, view.scrollTop + dy))
  const nextLeft = Math.max(0, Math.min(view.scrollWidth - view.clientWidth, view.scrollLeft + dx))
  if (Math.abs(nextTop - view.scrollTop) < 1 && Math.abs(nextLeft - view.scrollLeft) < 1) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  view.scrollTo({ top: nextTop, left: nextLeft, behavior: immediate || reducedMotion ? 'instant' : 'smooth' })
}
