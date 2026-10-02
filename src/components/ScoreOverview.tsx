import { memo, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ScoreLayout } from '../score/ScoreLayout'
import type { ScoreModel } from '../score/ScoreModel'
import { createScoreOverviewImage } from '../score/ScoreOverviewImage'
import { fitOverview, frameCoalescer, overviewViewport, reflowViewport } from '../score/OverviewGeometry'

export type ScoreOverviewHandle = {
  prepare: (host: HTMLElement, layout: ScoreLayout | null, model: ScoreModel) => void
  layout: (layout: ScoreLayout | null) => void
  position: (moment: string | null, busy: boolean) => void
}
type Props = { ref: Ref<ScoreOverviewHandle>; target: RefObject<HTMLDivElement | null>; view: RefObject<HTMLDivElement | null> }

/** Display-only boundary: no player/session/MIDI objects or callbacks enter. */
export const ScoreOverview = memo(function ScoreOverview({ ref, target, view }: Props) {
  const root = useRef<HTMLDetailsElement>(null), stage = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null)
  const picture = useRef<HTMLImageElement>(null), frame = useRef<HTMLDivElement>(null), marker = useRef<HTMLDivElement>(null)
  const message = useRef<HTMLParagraphElement>(null), description = useRef<HTMLSpanElement>(null)
  const api = useRef<ScoreOverviewHandle | null>(null)
  useImperativeHandle(ref, () => ({
    prepare: (...args) => api.current?.prepare(...args), layout: value => api.current?.layout(value), position: (...args) => api.current?.position(...args),
  }), [])

  useEffect(() => {
    const panel = view.current, container = root.current, area = stage.current, content = sheet.current
    const img = picture.current, viewport = frame.current, current = marker.current, status = message.current, text = description.current
    if (!panel || !container || !area || !content || !img || !viewport || !current || !status || !text) return
    let host: HTMLElement | null = null
    let measures = new Map<string, string>()
    let live: ScoreLayout | null = null, original: ScoreLayout | null = null
    let source: ReturnType<typeof createScoreOverviewImage> | null = null
    let moment: string | null = null, busy = false, disposed = false, attempted = false, ready = false, updates = 0
    const fail = () => { if (!disposed) { ready = false; container.dataset.state = 'error'; status.hidden = false; status.textContent = '全体表示を作成できませんでした'; content.hidden = true } }
    const update = () => {
      if (disposed || !host || panel.hidden || !area.clientWidth) return
      // Deferred generation must never start once practice/demo has begun.
      if (!attempted && !busy) {
        attempted = true
        const start = performance.now()
        try {
          source = createScoreOverviewImage(host); original = live
          container.dataset.renderCount = '1'; container.dataset.renderTime = (performance.now() - start).toFixed(2)
          img.onload = () => { if (!disposed) { ready = true; container.dataset.state = 'ready'; status.hidden = true; content.hidden = false; scheduler.schedule() } }
          img.onerror = fail
          img.src = source.url
        } catch { fail() }
      }
      if (!ready || !source || !container.open) return
      const fitted = fitOverview(source, { width: area.clientWidth, height: area.clientHeight })
      content.style.width = `${fitted.width}px`; content.style.height = `${fitted.height}px`
      const bounds = panel.getBoundingClientRect(), origin = host.getBoundingClientRect()
      const liveSize = { width: Math.max(host.scrollWidth, origin.width), height: Math.max(host.scrollHeight, origin.height) }
      const visible = { top: bounds.top + panel.clientTop - origin.top, bottom: bounds.top + panel.clientTop + panel.clientHeight - origin.top,
        left: bounds.left + panel.clientLeft - origin.left, right: bounds.left + panel.clientLeft + panel.clientWidth - origin.left }
      const ratio = reflowViewport(visible, live, original, liveSize, source)
      viewport.style.transform = `translate(${ratio.left * fitted.width}px, ${ratio.top * fitted.height}px)`
      viewport.style.width = `${(ratio.right - ratio.left) * fitted.width}px`
      viewport.style.height = `${Math.max(1, (ratio.bottom - ratio.top) * fitted.height)}px`
      container.dataset.viewportTop = String(ratio.top); container.dataset.viewportHeight = String(ratio.bottom - ratio.top)
      const position = moment ? original?.positions.get(moment) : undefined
      current.hidden = !position
      if (position) {
        const normalized = overviewViewport(position, source)
        current.style.transform = `translate(${normalized.left * fitted.width}px, ${normalized.top * fitted.height}px)`
        current.style.height = `${Math.max(5, (normalized.bottom - normalized.top) * fitted.height)}px`
        current.dataset.moment = moment!; current.dataset.top = String(normalized.top)
      } else { delete current.dataset.moment; delete current.dataset.top }
      const measure = moment ? measures.get(moment) : undefined
      text.textContent = measure ? `現在 ${measure}小節目付近。青い枠は大きな楽譜の表示範囲、緑の線は演奏位置です。` : '青い枠は大きな楽譜の表示範囲です。'
      container.dataset.viewportUpdates = String(++updates)
    }
    const scheduler = frameCoalescer(requestAnimationFrame, cancelAnimationFrame, () => { try { update() } catch { fail() } })
    const observer = new ResizeObserver(() => scheduler.schedule())
    observer.observe(panel); observer.observe(area)
    panel.addEventListener('scroll', scheduler.schedule, { passive: true })
    container.addEventListener('toggle', scheduler.schedule)
    api.current = {
      prepare(element, layout, score) {
        host = element; live = layout; measures = new Map(score.moments.map(item => [item.id, item.measureNumber]))
        container.dataset.scoreId = score.id; container.dataset.writtenMeasures = String(score.measures.length)
        observer.observe(element); scheduler.schedule()
      },
      layout(layout) { live = layout; scheduler.schedule() },
      position(id, playing) { moment = id; busy = playing; scheduler.schedule() },
    }
    return () => {
      disposed = true; api.current = null; scheduler.cancel(); observer.disconnect()
      panel.removeEventListener('scroll', scheduler.schedule); container.removeEventListener('toggle', scheduler.schedule)
      img.onload = null; img.onerror = null; img.removeAttribute('src')
      if (source) URL.revokeObjectURL(source.url)
    }
  }, [view])

  return target.current ? createPortal(<details ref={root} className="score-overview" open data-state="loading" data-render-count="0" data-render-time="0" data-viewport-updates="0">
    <summary>楽譜全体 <span className="overview-legend">青枠：表示範囲 · 緑：現在位置</span></summary>
    <div className="overview-stage" ref={stage} aria-hidden="true">
      <p ref={message} className="overview-message">全体表示を準備中…</p>
      <div className="overview-sheet" ref={sheet} hidden>
        <img ref={picture} alt="" draggable={false} />
        <div ref={frame} className="overview-viewport" />
        <div ref={marker} className="overview-current" hidden />
      </div>
    </div>
    <span ref={description} className="visually-hidden" />
  </details>, target.current) : null
})

export function ScoreOverviewDiagnostics() {
  const [text, setText] = useState('「全体表示の診断を更新」で現在の値を確認できます。')
  return <section aria-label="全体表示の診断"><h3>全体表示の診断</h3>
    <button onClick={() => {
      const data = document.querySelector<HTMLElement>('.score-overview')?.dataset
      setText(data ? `Overview render count：${data.renderCount} ／ Overview render time：${data.renderTime}ms ／ Viewport update count：${data.viewportUpdates} ／ State：${data.state}` : '全体表示はありません。')
    }}>全体表示の診断を更新</button><p>{text}</p>
  </section>
}
