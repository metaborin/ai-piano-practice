import { useEffect, useRef } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ScoreModel, ScoreSource } from '../score/ScoreModel'
import { readScoreModel } from '../score/readScoreModel'
import { parseMusicXml } from '../score/parseMusicXml'
import { toPracticeScore } from '../score/toPracticeScore'
import { buildCursorMap } from '../score/CursorMap'
type Props = {
  requestId: number
  score: ScoreSource
  cursorIndex: number
  cursorMomentId?: string | null
  onReady: (requestId: number, model: ScoreModel) => void
  onError: (requestId: number, message: string) => void
}

export function ScoreView({ requestId, score, cursorIndex, cursorMomentId, onReady, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<OpenSheetMusicDisplay | null>(null)
  const currentIndexRef = useRef(0)
  const mappingRef = useRef<ReadonlyMap<string, number>>(new Map())
  const cursorVisibleRef = useRef(cursorMomentId !== null)

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
    let practiceCursor = false
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
      if (practiceCursor && cursorVisibleRef.current) display.cursor.show()
      else display.cursor.hide()
      display.cursor.cursorElement.alt = ''
      display.cursor.cursorElement.setAttribute('aria-hidden', 'true')
    }
    const load = async () => {
      try {
        let model: ScoreModel
        try { model = parseMusicXml(score) }
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
        const practiceScore = toPracticeScore(model)
        practiceCursor = ['simpleMelody', 'pitchPractice'].includes(model.practiceCompatibility) && model.notes.length > 0
        render()
        try {
          mappingRef.current = practiceCursor ? buildCursorMap(model, display.cursor, Pitch.OctaveXmlDifference) : new Map()
          if (practiceScore) {
            const rendered = readScoreModel(score, display.cursor, Pitch.OctaveXmlDifference)
            if (rendered.notes.length !== practiceScore.notes.length || rendered.notes.some((note, index) =>
              note.midiNote !== practiceScore.notes[index].midiNote || Math.abs(note.durationBeats - practiceScore.notes[index].durationBeats) > 1e-9)) throw new Error('OSMD cursor differs from parsed timeline')
          }
        }
        catch (error) {
          console.warn('Score cursor mapping failed', error)
          fail('解析した音と楽譜カーソルを対応付けられませんでした。この曲の練習・手本は開始できません。')
          return
        }
        if (practiceCursor && cursorVisibleRef.current) display.cursor.show()
        displayRef.current = practiceCursor ? display : null
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
    cursorVisibleRef.current = cursorMomentId !== null
    const display = displayRef.current
    if (!display) return
    if (!cursorVisibleRef.current) { display.cursor.hide(); return }
    try {
      const targetIndex = cursorMomentId ? mappingRef.current.get(cursorMomentId) : 0
      if (targetIndex === undefined) throw new Error('Missing cursor target')
      while (currentIndexRef.current < targetIndex) { display.cursor.next(); currentIndexRef.current++ }
      while (currentIndexRef.current > targetIndex) { display.cursor.previous(); currentIndexRef.current-- }
      display.cursor.show()
    } catch {
      displayRef.current = null
      onError(requestId, '楽譜の現在位置を表示できませんでした。別の曲を選んでください。')
    }
  }, [cursorIndex, cursorMomentId, requestId, onError])

  return (
    <div className="score-view">
      <div ref={containerRef} className="score-renderer" role="img" aria-label={score.title + 'の楽譜'} />
    </div>
  )
}
