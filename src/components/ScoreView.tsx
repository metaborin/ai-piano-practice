import { useEffect, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ScoreModel, ScoreSource } from '../score/ScoreModel'
import { readScoreModel } from '../score/readScoreModel'
type Props = { score: ScoreSource; cursorIndex: number; onReady: (model: ScoreModel | null) => void }

export function ScoreView({ score, cursorIndex, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<OpenSheetMusicDisplay | null>(null)
  const currentIndexRef = useRef(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Each effect owns its host: cancelled loads cannot interfere with StrictMode's new render.
    const host = document.createElement('div')
    container.append(host)
    let cancelled = false
    let display: OpenSheetMusicDisplay | null = null
    let observer: ResizeObserver | null = null
    let frame = 0
    let lastWidth = 0
    const fail = () => {
      if (cancelled) return
      displayRef.current = null
      onReady(null)
      setError('楽譜を表示できませんでした。ページを再読み込みしてください。')
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
        const { OpenSheetMusicDisplay, Pitch } = await import('opensheetmusicdisplay')
        if (cancelled) return
        display = new OpenSheetMusicDisplay(host, {
          autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false,
          drawComposer: false, drawPartNames: false, drawMeasureNumbers: true,
          newSystemFromXML: true, followCursor: false,
          cursorsOptions: [{ type: 0, color: '#299b70', alpha: 0.32, follow: false }],
        })
        display.EngravingRules.StretchLastSystemLine = true
        await display.load(score.musicXml)
        if (cancelled) return
        currentIndexRef.current = 0
        render()
        const model = readScoreModel(score, display.cursor, Pitch.OctaveXmlDifference)
        display.cursor.show()
        displayRef.current = display
        setError(null)
        onReady(model)
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
    }
    void load()
    return () => {
      cancelled = true
      observer?.disconnect()
      cancelAnimationFrame(frame)
      displayRef.current = null
      display?.cursors.forEach((cursor) => cursor.Dispose())
      display?.clear()
      host.remove()
    }
  }, [score, onReady])

  useEffect(() => {
    const display = displayRef.current
    if (!display) return
    while (currentIndexRef.current < cursorIndex) { display.cursor.next(); currentIndexRef.current++ }
    while (currentIndexRef.current > cursorIndex) { display.cursor.previous(); currentIndexRef.current-- }
    display.cursor.show()
  }, [cursorIndex])

  return (
    <div className="score-view">
      {error && <p className="error-message" role="alert">{error}</p>}
      <div ref={containerRef} className="score-renderer" role="img" aria-label="ト音記号、4分の4拍子。ド ド ソ ソ、ラ ラ ソー、ファ ファ ミ ミ、レ レ ドー。" />
    </div>
  )
}
