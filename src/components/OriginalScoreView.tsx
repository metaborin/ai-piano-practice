import { Component, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { OriginalScore } from '../songs/Song'
import type { OriginalScoreRepository } from '../songs/OriginalScoreRepository'

const PdfScoreView = lazy(() => import('./PdfScoreView'))
type Props = { original: OriginalScore; repository: OriginalScoreRepository; active: boolean; zoom?: number }

/** Keyed by storageId: never shares a Blob, scroll position or URL across attachments. */
export const OriginalScoreView = memo(function OriginalScoreView({ original, repository, active, zoom = 100 }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const scroll = useRef({ top: 0, left: 0 })
  const ready = useRef(false)
  useLayoutEffect(() => { ready.current = false }, [active])
  const restore = useCallback(() => {
    if (panel.current) {
      panel.current.scrollTop = scroll.current.top; panel.current.scrollLeft = scroll.current.left
      ready.current = true
    }
  }, [])
  return <div className="original-score-view" ref={panel} hidden={!active} role="region" tabIndex={0} aria-label="元の楽譜のスクロール領域"
    onScroll={event => { if (active && ready.current) scroll.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft } }}>
    <div className="original-score-content" style={{ width: `${zoom}%` }}>
      {active && <OriginalScoreContent original={original} repository={repository} panel={panel} onReady={restore} />}
    </div>
  </div>
})

/** Mount per visit so stale/empty loading layouts cannot overwrite the saved scroll. */
function OriginalScoreContent({ original, repository, panel, onReady }: Omit<Props, 'active'> & { panel: RefObject<HTMLDivElement | null>; onReady: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reportError = useCallback((message: string) => setError(message), [])
  useEffect(() => {
    let cancelled = false, objectUrl: string | undefined
    void repository.getOriginalScore(original.storageId).then(asset => {
      if (cancelled) return
      if (original.type === 'image') {
        try { objectUrl = URL.createObjectURL(asset) }
        catch { throw new Error('元の楽譜の表示URLを作成できませんでした。一度練習用楽譜へ戻ってお試しください。') }
      }
      setBlob(asset); setUrl(objectUrl ?? null)
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '元の楽譜を読み込めませんでした。') })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [original.storageId, original.type, repository])
  return <>
      <p className="original-reference-note">{original.fileName ?? '元の楽譜'} · 参照用（現在位置・赤表示は練習用楽譜に表示）</p>
      {error ? <p className="error-message" role="alert">{error}</p> : !blob ? <p role="status">元の楽譜を読み込み中…</p>
        : original.type === 'pdf' ? <OriginalViewBoundary><Suspense fallback={<p role="status">PDFを準備中…</p>}><PdfScoreView blob={blob} panel={panel} onReady={onReady} onError={reportError} /></Suspense></OriginalViewBoundary>
        : url && <img className="original-score-image" src={url} alt={original.fileName ?? '元の楽譜'} onLoad={onReady} onError={() => reportError('画像を表示できませんでした。元の楽譜を登録し直してください。練習用楽譜は利用できます。')} />}
    </>
}

class OriginalViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">PDF表示機能を読み込めませんでした。通信状態を確認してください。練習用楽譜は引き続き利用できます。</p> : this.props.children }
}
