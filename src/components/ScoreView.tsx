import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ScoreModel, ScoreSource } from '../score/ScoreModel'
import { readScoreModel } from '../score/readScoreModel'
import { parseMusicXml } from '../score/parseMusicXml'
import { toPracticeScore } from '../score/toPracticeScore'
import { buildCursorMap } from '../score/CursorMap'
import { ScoreNoteRenderMap } from '../score/ScoreNoteRenderMap'
import { followScoreCursor } from '../score/ScoreFollow'
import { readScoreLayout, lookAheadZoom } from '../score/ScoreLayout'
import type { ScoreLayout } from '../score/ScoreLayout'
import { navigationJump, practiceLookAhead } from '../score/ScoreLookAhead'
import type { ScoreSystems } from '../score/ScoreLookAhead'
import type { PracticePlan } from '../practice/PracticePlan'
import type { DemoPreview } from '../audio/DemoLookAhead'
type Props = {
  requestId: number
  score: ScoreSource
  cursorIndex: number
  cursorMomentId?: string | null
  missingNoteIds?: readonly string[]
  followMode?: 'idle' | 'practice' | 'demo'
  focusRequest?: number
  returnRequest?: number
  plan?: PracticePlan | null
  demoPreview?: DemoPreview | null
  onSystems?: (requestId: number, systems: ScoreSystems) => void
  onReady: (requestId: number, model: ScoreModel) => void
  onError: (requestId: number, message: string) => void
}

export function ScoreView({ requestId, score, cursorIndex, cursorMomentId, missingNoteIds, followMode, focusRequest = 0, returnRequest = 0, plan, demoPreview, onSystems, onReady, onError }: Props) {
  const [followWarning, setFollowWarning] = useState(false)
  const safeFollow = useCallback((...args: Parameters<typeof followScoreCursor>) => {
    try { followScoreCursor(...args) } catch { setFollowWarning(true) }
  }, [])
  const viewRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<OpenSheetMusicDisplay | null>(null)
  const currentIndexRef = useRef(0)
  const mappingRef = useRef<ReadonlyMap<string, number>>(new Map())
  const layoutRef = useRef<ScoreLayout | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)
  const cursorVisibleRef = useRef(cursorMomentId !== null)
  const noteMapRef = useRef<ScoreNoteRenderMap | null>(null)
  const missingRef = useRef(missingNoteIds)
  const followRef = useRef<{ mode?: string; moment?: string | null; occurrenceIndex?: number; request: number; returnRequest: number; y?: number; previewId?: string; active: boolean }>({ mode: 'idle', request: 0, returnRequest: 0, active: false })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Each effect owns its host: cancelled loads cannot interfere with StrictMode's new render.
    const host = document.createElement('div')
    host.style.visibility = 'hidden'
    container.append(host)
    hostRef.current = host
    let cancelled = false
    let display: OpenSheetMusicDisplay | null = null
    let observer: ResizeObserver | null = null
    let frame = 0
    let lastWidth = 0
    let lastWindowHeight = 0
    let loading = false
    let disposed = false
    let practiceCursor = false
    let model: ScoreModel | null = null
    let octaveDifference = 0
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
      if (practiceCursor && model) {
        mappingRef.current = buildCursorMap(model, display.cursor, octaveDifference)
        let layout = readScoreLayout(model, display, mappingRef.current, host)
        const zoom = lookAheadZoom(layout, display.Zoom, viewRef.current?.clientHeight ?? 0)
        if (zoom < display.Zoom - 0.001) {
          display.Zoom = zoom; display.render()
          mappingRef.current = buildCursorMap(model, display.cursor, octaveDifference)
          layout = readScoreLayout(model, display, mappingRef.current, host)
        }
        layoutRef.current = layout
        onSystems?.(requestId, layout.systems)
        noteMapRef.current?.clear()
        noteMapRef.current = new ScoreNoteRenderMap(model, display, octaveDifference)
        noteMapRef.current.highlight(missingRef.current ?? [])
      }
      display.cursor.reset()
      for (let index = 0; index < currentIndexRef.current; index++) display.cursor.next()
      if (practiceCursor && cursorVisibleRef.current) display.cursor.show()
      else display.cursor.hide()
      display.cursor.cursorElement.alt = ''
      display.cursor.cursorElement.setAttribute('aria-hidden', 'true')
      if (followRef.current.active && viewRef.current && practiceCursor && cursorVisibleRef.current) safeFollow(viewRef.current, display.cursor.cursorElement, true)
    }
    const load = async () => {
      try {
        try { model = parseMusicXml(score) }
        catch (error) {
          fail(error instanceof Error ? error.message : 'MusicXMLを検証できませんでした。')
          return
        }
        const { OpenSheetMusicDisplay, Pitch } = await import('opensheetmusicdisplay')
        octaveDifference = Pitch.OctaveXmlDifference
        if (cancelled) return
        display = new OpenSheetMusicDisplay(host, {
          autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false,
          drawComposer: false, drawPartNames: false, drawMeasureNumbers: true,
          newSystemFromXML: true, followCursor: false,
          cursorsOptions: [{ type: 0, color: '#299b70', alpha: 0.32, follow: false }],
        })
        display.EngravingRules.StretchLastSystemLine = true
        // The app owns occurrence navigation; OSMD's cursor maps written positions once.
        display.EngravingRules.CursorIgnoreRepetitions = true
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
        lastWindowHeight = window.innerHeight
        observer = new ResizeObserver(() => {
          // A repeat badge / progress message must not rebuild the whole score.
          const width = container.clientWidth, height = window.innerHeight
          if (width <= 0 || (Math.abs(width - lastWidth) < 1 && Math.abs(height - lastWindowHeight) < 1)) return
          lastWidth = width; lastWindowHeight = height
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => { try { render() } catch { setFollowWarning(true) } })
        })
        observer.observe(container)
        if (viewRef.current) observer.observe(viewRef.current)
      } catch { fail() }
      finally { if (cancelled) dispose() }
    }
    void load()
    return () => {
      cancelled = true
      observer?.disconnect()
      cancelAnimationFrame(frame)
      displayRef.current = null
      layoutRef.current = null; hostRef.current = null
      noteMapRef.current?.clear(); noteMapRef.current = null
      dispose()
    }
  }, [requestId, score, onReady, onError, onSystems, safeFollow])

  useLayoutEffect(() => {
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
      if (followMode && viewRef.current) {
        const previous = followRef.current, view = viewRef.current, element = display.cursor.cursorElement
        const y = element.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop
        const explicit = previous.request !== focusRequest || previous.mode !== followMode
        const currentOnly = previous.returnRequest !== returnRequest
        const moved = previous.moment !== cursorMomentId || previous.occurrenceIndex !== cursorIndex
        const changedSystem = previous.y === undefined || Math.abs(previous.y - y) > 1
        const layout = layoutRef.current, host = hostRef.current
        const previewId = demoPreview?.id
        const newDemoPreview = !!demoPreview && previous.previewId !== previewId
        const practicePreview = plan && layout && followMode === 'practice' ? practiceLookAhead(plan, cursorIndex, layout.systems) : null
        const preview = currentOnly ? null : (followMode === 'demo' ? newDemoPreview ? demoPreview : null : practicePreview)
        const rect = preview && layout?.positions.get(preview.momentId)
        const currentRect = layout?.positions.get(cursorMomentId ?? '')
        const hostBox = host?.getBoundingClientRect()
        const jumping = !!plan && previous.occurrenceIndex !== undefined && moved && (
          navigationJump(plan, previous.occurrenceIndex, cursorIndex) ||
          (cursorIndex > previous.occurrenceIndex && navigationJump(plan, cursorIndex - 1, cursorIndex)))
        const shouldFollow = explicit || newDemoPreview || (moved && (followMode !== 'idle' || previous.moment != null))
        if (shouldFollow) safeFollow(view, element, explicit || jumping || !!preview?.navigationJump,
          explicit || jumping || !!preview || followMode !== 'demo' || changedSystem,
          rect && hostBox && preview ? { box: { top: hostBox.top + rect.top, bottom: hostBox.top + rect.bottom, left: hostBox.left + rect.left, right: hostBox.left + rect.right },
            currentBox: currentRect ? { top: hostBox.top + currentRect.top, bottom: hostBox.top + currentRect.bottom, left: hostBox.left + currentRect.left, right: hostBox.left + currentRect.right } : undefined,
            navigationJump: preview.navigationJump } : undefined)
        view.dataset.currentSystem = String(layout?.systems.get(cursorMomentId ?? '')?.system ?? '')
        view.dataset.lookaheadMoment = preview?.momentId ?? ''
        view.dataset.lookaheadSystem = String(preview ? layout?.systems.get(preview.momentId)?.system ?? '' : '')
        view.dataset.navigationJump = String(jumping || !!preview?.navigationJump)
        followRef.current = { mode: followMode, moment: cursorMomentId, occurrenceIndex: cursorIndex, request: focusRequest, returnRequest, y, previewId, active: previous.active || shouldFollow }
      }
    } catch { setFollowWarning(true) }
  }, [cursorIndex, cursorMomentId, requestId, onError, followMode, focusRequest, returnRequest, plan, demoPreview, safeFollow])

  useLayoutEffect(() => {
    missingRef.current = missingNoteIds
    noteMapRef.current?.highlight(missingNoteIds ?? [])
  }, [missingNoteIds])

  return (
    <div ref={viewRef} className="score-view" role="region" tabIndex={0} aria-label="楽譜のスクロール領域">
      {followWarning && <p role="status">楽譜の追従を更新できませんでした。手本の音は続きます。停止後に曲を選び直してください。</p>}
      <div ref={containerRef} className="score-renderer" role="img" aria-label={score.title + 'の楽譜'} />
    </div>
  )
}
