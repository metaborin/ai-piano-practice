import { describe, expect, it, vi } from 'vitest'
import { fitOverview, frameCoalescer, overviewViewport, reflowViewport } from '../../src/score/OverviewGeometry'
import type { ScoreLayout } from '../../src/score/ScoreLayout'
import { readFileSync } from 'node:fs'

describe('overview geometry', () => {
  it('normalizes scrollTop, clientHeight and horizontal scroll independently', () => {
    expect(overviewViewport({ top: 400, bottom: 900, left: 100, right: 500 }, { width: 800, height: 2000 }))
      .toEqual({ top: 0.2, bottom: 0.45, left: 0.125, right: 0.625 })
  })
  it('clamps overscroll and the viewport covering a short score', () => {
    expect(overviewViewport({ top: -10, bottom: 1000, left: -20, right: 900 }, { width: 800, height: 200 }))
      .toEqual({ top: 0, bottom: 1, left: 0, right: 1 })
  })
  it('handles zero dimensions without NaN', () => {
    expect(overviewViewport({ top: 0, bottom: 0, left: 0, right: 0 }, { width: 0, height: 0 })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
  })
  it('fits long and short pictures without cropping or changing their aspect ratio', () => {
    expect(fitOverview({ width: 1000, height: 3000 }, { width: 220, height: 120 })).toEqual({ width: 40, height: 120 })
    expect(fitOverview({ width: 1000, height: 200 }, { width: 220, height: 120 })).toEqual({ width: 220, height: 44 })
  })
  it('projects visible written positions back to the same immutable image after reflow', () => {
    const original: ScoreLayout = { systems: new Map(), positions: new Map([['m5', { top: 100, bottom: 200, left: 300, right: 350 }], ['m6', { top: 100, bottom: 200, left: 600, right: 650 }]]) }
    const live: ScoreLayout = { systems: new Map(), positions: new Map([['m5', { top: 400, bottom: 600, left: 100, right: 150 }], ['m6', { top: 700, bottom: 900, left: 100, right: 150 }]]) }
    expect(reflowViewport({ top: 390, bottom: 610, left: 0, right: 800 }, live, original, { width: 800, height: 2000 }, { width: 1000, height: 1000 }))
      .toEqual({ top: 0.1, bottom: 0.2, left: 0, right: 1 })
  })
  it('falls back to whole-score ratios when no mapped note is visible', () => {
    const layout: ScoreLayout = { systems: new Map(), positions: new Map() }
    expect(reflowViewport({ top: 100, bottom: 300, left: 0, right: 800 }, layout, { ...layout }, { width: 800, height: 1000 }, { width: 800, height: 2000 }))
      .toEqual({ top: 0.1, bottom: 0.3, left: 0, right: 1 })
  })
})

it('coalesces an event burst into one frame, idles afterwards and cancels cleanup work', () => {
  let callback: FrameRequestCallback | undefined
  const request = vi.fn((fn: FrameRequestCallback) => { callback = fn; return 7 }), cancel = vi.fn(), update = vi.fn()
  const scheduler = frameCoalescer(request, cancel, update)
  for (let i = 0; i < 100; i++) scheduler.schedule()
  expect(request).toHaveBeenCalledTimes(1); expect(update).not.toHaveBeenCalled()
  callback!(0); expect(update).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1)
  scheduler.schedule(); expect(request).toHaveBeenCalledTimes(2)
  scheduler.cancel(); expect(cancel).toHaveBeenCalledWith(7)
  scheduler.schedule(); expect(request).toHaveBeenCalledTimes(3)
})

it('keeps the navigator outside the MIDI, session, player and OSMD control layers', () => {
  for (const path of ['src/components/ScoreOverview.tsx', 'src/score/ScoreOverviewImage.ts', 'src/score/OverviewGeometry.ts']) {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/from ['"][^'"]*(?:midi\/|audio\/|practice\/|opensheetmusicdisplay)/)
    expect(source).not.toMatch(/\.render\(|\.stop\(|\.send\(|\.clear\(|setInterval\(/)
  }
})
