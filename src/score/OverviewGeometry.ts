import type { LayoutRect, ScoreLayout } from './ScoreLayout'

export type OverviewSize = { width: number; height: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Coordinates are relative to the score host, excluding panel padding. */
export function overviewViewport(view: LayoutRect, size: OverviewSize): LayoutRect {
  return {
    top: clamp(view.top / Math.max(1, size.height), 0, 1),
    bottom: clamp(view.bottom / Math.max(1, size.height), 0, 1),
    left: clamp(view.left / Math.max(1, size.width), 0, 1),
    right: clamp(view.right / Math.max(1, size.width), 0, 1),
  }
}

/** A resize may reflow systems. Reuse the immutable picture and map visible
 * written positions onto it. The resulting rectangle is a bounding range. */
export function reflowViewport(view: LayoutRect, live: ScoreLayout | null, original: ScoreLayout | null, liveSize: OverviewSize, originalSize: OverviewSize): LayoutRect {
  if (!live || !original || live === original) return overviewViewport(view, liveSize)
  const visible: LayoutRect[] = []
  for (const [id, rect] of live.positions) {
    if (rect.bottom >= view.top && rect.top <= view.bottom && rect.right >= view.left && rect.left <= view.right) {
      const source = original.positions.get(id)
      if (source) visible.push(source)
    }
  }
  if (!visible.length) return overviewViewport(view, liveSize)
  return overviewViewport({ top: Math.min(...visible.map(r => r.top)), bottom: Math.max(...visible.map(r => r.bottom)),
    left: 0, right: originalSize.width }, originalSize)
}

export function fitOverview(source: OverviewSize, available: OverviewSize) {
  const scale = Math.min(available.width / Math.max(1, source.width), available.height / Math.max(1, source.height))
  return { width: source.width * scale, height: source.height * scale }
}

/** Event coalescing, not a continuously running animation loop. */
export function frameCoalescer(request: (callback: FrameRequestCallback) => number, cancel: (id: number) => void, update: () => void) {
  let frame: number | null = null
  return {
    schedule() { if (frame === null) frame = request(() => { frame = null; update() }) },
    cancel() { if (frame !== null) cancel(frame); frame = null },
  }
}
