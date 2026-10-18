import type { LensBackend, ReaderDocument } from '@hoot/core'
import { createLens, type Lens } from '@hoot/lens-dom'
import { openPdf, PdfOverlayRenderer, PdfView, type PdfViewMode } from '@hoot/pdf-view'
import { Button, IconButton, Segmented, type SegmentedOption } from '@hoot/ui'
import { FolderOpen, Minus, Plus } from 'lucide-react'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'

type Phase = 'loading' | 'ready' | 'error'

const MODES: SegmentedOption<PdfViewMode>[] = [
  { value: 'pages', label: 'Pages' },
  { value: 'reflow', label: 'Text only' }
]

export interface PdfReaderProps {
  doc: ReaderDocument
  backend: LensBackend
  /** Lens is turned on in Studio → Reading. */
  lensOn: boolean
  onOpen: () => void
  onOpenReading: () => void
}

/** One open PDF: pdf-view pages (or reflowed text) with Lens on top. */
export function PdfReader({
  doc,
  backend,
  lensOn,
  onOpen,
  onOpenReading
}: PdfReaderProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<PdfView | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<PdfViewMode>('pages')
  const [page, setPage] = useState({ current: 1, total: 0 })

  useEffect(() => {
    let cancelled = false
    let pdf: Awaited<ReturnType<typeof openPdf>> | null = null
    void (async () => {
      // PDF.js transfers the buffer to its worker; keep the caller's copy intact.
      pdf = await openPdf({ data: doc.bytes.slice() }, { workerSrc })
      if (cancelled || !host.current) return
      view.current = await PdfView.create(host.current, pdf, {
        label: doc.name,
        onPageChange: (current) => setPage({ current, total: pdf?.numPages ?? 0 })
      })
      setPage({ current: 1, total: pdf.numPages })
      setPhase('ready')
    })().catch(() => {
      if (!cancelled) setPhase('error')
    })
    return () => {
      cancelled = true
      view.current?.destroy()
      view.current = null
      void pdf?.loadingTask.destroy()
    }
  }, [doc])

  // Lens follows the view mode: the overlay renderer on pages, inline marks on reflowed text.
  useEffect(() => {
    const current = view.current
    if (phase !== 'ready' || !current) return
    let lens: Lens | null = null
    let renderer: PdfOverlayRenderer | null = null
    let stopped = false
    void current.setMode(mode).then(() => {
      if (stopped) return
      renderer = mode === 'pages' ? new PdfOverlayRenderer({ scale: () => current.scale }) : null
      lens = createLens({
        document,
        backend,
        site: '',
        surface: 'reader',
        renderer: renderer ?? 'inline',
        shadowMode: import.meta.env.MODE === 'e2e' ? 'open' : 'closed'
      })
    })
    return () => {
      stopped = true
      lens?.destroy()
      renderer?.destroy()
    }
  }, [phase, mode, backend])

  const zoom = (factor: number): void => {
    const current = view.current
    if (current) current.setZoom(current.scale * factor)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey || mode !== 'pages') return
      const current = view.current
      if (!current) return
      if (e.key === '+' || e.key === '=') current.setZoom(current.scale * 1.25)
      else if (e.key === '-') current.setZoom(current.scale * 0.8)
      else if (e.key === '0') current.setZoom('fit-width')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  return (
    <div className="hoot-reader__doc-frame">
      <header className="hoot-reader__bar hoot-chrome">
        <h1 className="hoot-reader__title" title={doc.name}>
          {doc.name}
        </h1>
        {phase === 'ready' && (
          <>
            <span className="hoot-reader__page" aria-live="polite">
              Page {page.current} of {page.total}
            </span>
            <Segmented<PdfViewMode>
              label="View"
              hideLabel
              size="sm"
              value={mode}
              options={MODES}
              onChange={setMode}
            />
            {mode === 'pages' && (
              <span className="hoot-reader__zoom">
                <IconButton label="Zoom out" size="sm" shortcut="Ctrl+-" onClick={() => zoom(0.8)}>
                  <Minus />
                </IconButton>
                <IconButton label="Zoom in" size="sm" shortcut="Ctrl++" onClick={() => zoom(1.25)}>
                  <Plus />
                </IconButton>
              </span>
            )}
          </>
        )}
        <span className="hoot-reader__spacer" />
        <IconButton label="Open another PDF" shortcut="Ctrl+O" onClick={onOpen}>
          <FolderOpen />
        </IconButton>
      </header>
      {!lensOn && phase === 'ready' && (
        <p className="hoot-reader__lens-off" role="status">
          Hoot Lens is off, so nothing here changes.{' '}
          <Button size="sm" variant="ghost" onClick={onOpenReading}>
            Turn it on in Reading settings
          </Button>
        </p>
      )}
      <main ref={host} className="hoot-reader__doc" data-phase={phase}>
        {phase === 'error' && (
          <section className="hoot-reader__notice" role="alert">
            <h2>Hoot couldn’t open this PDF</h2>
            <p>It may be damaged or password-protected. Try another file.</p>
            <Button onClick={onOpen}>Open another PDF…</Button>
          </section>
        )}
      </main>
    </div>
  )
}
