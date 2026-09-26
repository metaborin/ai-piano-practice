import { useEffect, useRef } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ScoreModel, ScoreSource } from '../score/ScoreModel'
import { readScoreModel } from '../score/readScoreModel'
import { validateMusicXml } from '../score/validateMusicXml'
type Props = {
  requestId: number
  score: ScoreSource
  cursorIndex: number
  onReady: (requestId: number, model: ScoreModel) => void
  onError: (requestId: number, message: string) => void
}

export function ScoreView({ requestId, score, cursorIndex, onReady, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<OpenSheetMusicDisplay | null>(null)
  const currentIndexRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Each effect owns its host: cancelled loads cannot interfere with StrictMode's new render.
    const host = document.createElement('div')
    host.style.visibility = 'hidden'
    container.append(host)
    let cancelled = false
    let display: OpenSheetMusicDisplay | null = null
    let observer: ResizeObserver | null = null
    let frame = 0
    let lastWidth = 0
    let loading = false
    let disposed = false
    const dispose = () => {
      host.remove()
      // OSMD.load can still be running. Dispose again after it settles, not mid-import.
      if (loading || disposed) return
      disposed = true
      display?.cursors.forEach((cursor) => cursor.Dispose())
      display?.clear()
    }
    const fail = (message = '楽譜を表示できませんでした。別の曲を選んでください。') => {
      if (cancelled) return
      displayRef.current = null
      host.style.visibility = 'hidden'
      onError(requestId, message)
    }
    const render = () => {
      if (!display || cancelled) return
      display.Zoom = container.clientWidth < 600 ? 1.1 : 1.35
      display.render()
      display.cursor.reset()
      for (let index = 0; index < currentIndexRef.current; index++) display.cursor.next()
      display.cursor.show()
      display.cursor.cursorElement.alt = ''
      display.cursor.cursorElement.setAttribute('aria-hidden', 'true')
    }
    const load = async () => {
      try {
        try { validateMusicXml(score.musicXml) }
        catch (error) {
          fail(error instanceof Error ? error.message : 'MusicXMLを検証できませんでした。')
          return
        }
        const { OpenSheetMusicDisplay, Pitch } = await import('opensheetmusicdisplay')
        if (cancelled) return
        display = new OpenSheetMusicDisplay(host, {
          autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false,
          drawComposer: false, drawPartNames: false, drawMeasureNumbers: true,
          newSystemFromXML: true, followCursor: false,
          cursorsOptions: [{ type: 0, color: '#299b70', alpha: 0.32, follow: false }],
        })
        display.EngravingRules.StretchLastSystemLine = true
        loading = true
        try { await display.load(score.musicXml) }
        finally { loading = false }
        if (cancelled) return
        currentIndexRef.current = 0
        render()
        let model: ScoreModel
        try { model = readScoreModel(score, display.cursor, Pitch.OctaveXmlDifference) }
        catch {
          fail('練習対象の音を解析できませんでした。1パートの単旋律を使用してください。')
          return
        }
        display.cursor.show()
        displayRef.current = display
        host.style.visibility = 'visible'
        onReady(requestId, model)
        lastWidth = container.clientWidth
        observer = new ResizeObserver(() => {
          const width = container.clientWidth
          if (width <= 0 || Math.abs(width - lastWidth) < 1) return
          lastWidth = width
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => { try { render() } catch { fail() } })
        })
        observer.observe(container)
      } catch { fail() }
      finally { if (cancelled) dispose() }
    }
    void load()
    return () => {
      cancelled = true
      observer?.disconnect()
      cancelAnimationFrame(frame)
      displayRef.current = null
      dispose()
    }
  }, [requestId, score, onReady, onError])

  useEffect(() => {
    const display = displayRef.current
    if (!display) return
    try {
      while (currentIndexRef.current < cursorIndex) { display.cursor.next(); currentIndexRef.current++ }
      while (currentIndexRef.current > cursorIndex) { display.cursor.previous(); currentIndexRef.current-- }
      display.cursor.show()
    } catch {
      displayRef.current = null
      onError(requestId, '楽譜の現在位置を表示できませんでした。別の曲を選んでください。')
    }
  }, [cursorIndex, requestId, onError])

  return (
    <div className="score-view">
      <div ref={containerRef} className="score-renderer" role="img" aria-label={score.title + 'の楽譜'} />
    </div>
  )
}
