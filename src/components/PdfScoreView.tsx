import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PageSize = { width: number; height: number }
type Props = { blob: Blob; panel: RefObject<HTMLDivElement | null>; onReady: () => void; onError: (message: string) => void }

/** Loaded only in the original view. No scripting, links, forms or music data are executed. */
export default function PdfScoreView({ blob, panel, onReady, onError }: Props) {
  const [loaded, setLoaded] = useState<{ document: PDFDocumentProxy; sizes: PageSize[] } | null>(null)
  useEffect(() => {
    let cancelled = false, task: PDFDocumentLoadingTask | undefined
    const load = async () => {
      try {
        const pdf = await import('pdfjs-dist')
        if (cancelled) return
        pdf.GlobalWorkerOptions.workerSrc = workerUrl
        const data = new Uint8Array(await blob.arrayBuffer())
        if (cancelled) return
        const assets = `${import.meta.env.BASE_URL}pdfjs/`
        task = pdf.getDocument({ data, cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/' })
        const document = await task.promise
        const sizes: PageSize[] = []
        // Dimensions only: canvases are allocated just for pages near the viewport.
        for (let index = 1; index <= document.numPages; index++) {
          if (cancelled) return
          const page = await document.getPage(index)
          const { width, height } = page.getViewport({ scale: 1 })
          sizes.push({ width, height })
        }
        if (!cancelled) setLoaded({ document, sizes })
      } catch (error) {
        if (!cancelled) onError(error instanceof Error && error.name === 'PasswordException'
          ? 'パスワード付きPDFは表示できません。パスワードのないPDFを登録してください。'
          : 'PDFを表示できませんでした。ファイルが壊れていないか確認し、元の楽譜を登録し直してください。')
      }
    }
    void load()
    return () => { cancelled = true; void task?.destroy().catch(() => {}) }
  }, [blob, onError])
  useEffect(() => { if (loaded) onReady() }, [loaded, onReady])
  if (!loaded) return <p role="status">PDFを読み込み中…</p>
  return <div className="original-pdf" data-pages={loaded.sizes.length}>
    {loaded.sizes.map((size, index) => <PdfPage key={index} document={loaded.document} number={index + 1} size={size} panel={panel} onError={onError} />)}
  </div>
}

function PdfPage({ document, number, size, panel, onError }: { document: PDFDocumentProxy; number: number; size: PageSize; panel: Props['panel']; onError: Props['onError'] }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = host.current!
    let visible = false
    const update = () => setWidth(visible ? Math.floor(element.clientWidth) : 0)
    const visibility = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update() }, { root: panel.current, rootMargin: '160px' })
    const resize = new ResizeObserver(update)
    visibility.observe(element); resize.observe(element)
    return () => { visibility.disconnect(); resize.disconnect() }
  }, [panel])
  useEffect(() => {
    const target = canvas.current!
    let cancelled = false, render: RenderTask | undefined
    if (!width) { target.width = 0; target.height = 0; delete target.dataset.rendered; return }
    const draw = async () => {
      try {
        const page = await document.getPage(number)
        if (cancelled) return
        const cssHeight = width * size.height / size.width
        const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (width * cssHeight)))
        const viewport = page.getViewport({ scale: width / size.width * pixelRatio })
        target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height)
        render = page.render({ canvas: target, viewport })
        await render.promise
        if (!cancelled) target.dataset.rendered = 'true'
      } catch { if (!cancelled) onError('PDFのページを表示できませんでした。練習用楽譜は引き続き利用できます。') }
    }
    void draw()
    return () => { cancelled = true; render?.cancel() }
  }, [document, number, width, size, onError])
  return <div className="original-pdf-page" ref={host} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
    <canvas ref={canvas} role="img" aria-label={`元の楽譜 PDF ${number}ページ`} />
    <span className="pdf-page-number">{number}</span>
  </div>
}
