import { UI_TAG, createLens, guessLanguage, type Lens } from '@hoot/lens-dom'
import { PdfOverlayRenderer, PdfView, openPdf, type PdfViewMode } from '@hoot/pdf-view'
import { Button, IconButton, Segmented, type SegmentedOption } from '@hoot/ui'
import { Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtensionBackend } from '../content/backend'
import { installSalt, pageHost, pageSite, urlHash } from '../content/page'
import { FILE_ASKED_KEY } from '../sw/pdf'

type Phase = 'loading' | 'ready' | 'error' | 'file-access'

const MODES: SegmentedOption<PdfViewMode>[] = [
  { value: 'pages', label: 'Pages' },
  { value: 'reflow', label: 'Reflow' }
]

const parse = (file: string): URL | null => {
  try {
    const url = new URL(file)
    return ['http:', 'https:', 'file:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

const fileName = (url: URL): string =>
  decodeURIComponent(url.pathname.split('/').pop() || url.hostname || 'PDF')

type PdfDocument = Awaited<ReturnType<typeof openPdf>>

/** Text read from the first pages for the language guess. */
const SAMPLE_PAGES = 3
const SAMPLE_CHARS = 4000

/**
 * The PDF's language: its /Lang, else a guess from its first pages, else ''
 * (unknown). Never the viewer's own English, or every PDF would read as
 * English and foreign ones would never be translated.
 */
async function pdfLanguage(doc: PdfDocument): Promise<string> {
  const meta = await doc.getMetadata().catch(() => null)
  const declared = (meta?.info as { Language?: unknown } | undefined)?.Language
  if (typeof declared === 'string' && declared.trim()) return declared.trim()
  let sample = ''
  for (let n = 1; n <= Math.min(doc.numPages, SAMPLE_PAGES) && sample.length < SAMPLE_CHARS; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent()
    sample += ` ${items.map((item) => ('str' in item ? item.str : '')).join(' ')}`
  }
  return guessLanguage(sample)
}

/** Hands this one PDF back to the browser's own viewer. */
async function openNative(file: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'lens.pdf.native', url: file }).catch(() => undefined)
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { url: file })
  else location.replace(file)
}

/** viewer.html: a PDF in d3's `pdf-view` with Lens on top (D2-31). */
export function Viewer({
  file,
  backend
}: {
  file: string
  backend: ExtensionBackend
}): React.JSX.Element {
  const url = useMemo(() => parse(file), [file])
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<PdfView | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<PdfViewMode>('pages')
  const [page, setPage] = useState({ current: 1, total: 0 })
  const [docLang, setDocLang] = useState('')

  useEffect(() => {
    if (!url) return
    let cancelled = false
    let doc: PdfDocument | null = null
    void (async () => {
      if (url.protocol === 'file:' && !(await chrome.extension.isAllowedFileSchemeAccess())) {
        await chrome.storage.local.set({ [FILE_ASKED_KEY]: true })
        if (!cancelled) setPhase('file-access')
        return
      }
      const opened = await openPdf(
        { url: url.href },
        {
          workerSrc: chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs'),
          standardFontDataUrl: chrome.runtime.getURL('pdfjs/standard_fonts/'),
          cMapUrl: chrome.runtime.getURL('pdfjs/cmaps/')
        }
      )
      doc = opened
      if (cancelled || !host.current) return
      view.current = await PdfView.create(host.current, opened, {
        label: fileName(url),
        onPageChange: (current) => setPage({ current, total: opened.numPages })
      })
      setPage({ current: 1, total: opened.numPages })
      setPhase('ready')
      const lang = await pdfLanguage(opened).catch(() => '')
      if (!cancelled) setDocLang(lang)
    })().catch(() => {
      if (!cancelled) setPhase('error')
    })
    return () => {
      cancelled = true
      view.current?.destroy()
      view.current = null
      void doc?.loadingTask.destroy()
    }
  }, [url])

  useEffect(() => {
    const current = view.current
    if (phase !== 'ready' || !current || !url) return
    let lens: Lens | null = null
    let renderer: PdfOverlayRenderer | null = null
    let stopped = false
    void (async () => {
      await current.setMode(mode)
      const salt = await installSalt().catch(() => '')
      if (stopped) return
      renderer = mode === 'pages' ? new PdfOverlayRenderer({ scale: () => current.scale }) : null
      lens = createLens({
        document,
        backend,
        site: pageSite(url),
        hostname: pageHost(url),
        urlHash: urlHash(url, salt),
        surface: 'pdf',
        renderer: renderer ?? 'inline',
        shadowMode: __HOOT_E2E__ ? 'open' : 'closed'
      })
      // As in the content script: e2e waits for this before selecting anything.
      if (__HOOT_E2E__) {
        void lens.ready.then(() => document.querySelector(UI_TAG)?.setAttribute('data-ready', ''))
      }
    })()
    return () => {
      stopped = true
      lens?.destroy()
      renderer?.destroy()
    }
  }, [phase, mode, url, backend])

  const zoom = (factor: number): void => {
    const current = view.current
    if (current) current.setZoom(current.scale * factor)
  }

  const fallback = (
    <Button size="sm" variant="ghost" onClick={() => void openNative(file)}>
      Open in the browser’s viewer
    </Button>
  )

  return (
    <div className="hoot-viewer">
      <header className="hoot-viewer__bar hoot-chrome">
        <h1 className="hoot-viewer__title" title={file}>
          {url ? fileName(url) : 'PDF'}
        </h1>
        {phase === 'ready' && (
          <>
            <span className="hoot-viewer__page">
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
              <span className="hoot-viewer__zoom">
                <IconButton label="Zoom out" size="sm" onClick={() => zoom(0.8)}>
                  <Minus />
                </IconButton>
                <IconButton label="Zoom in" size="sm" onClick={() => zoom(1.25)}>
                  <Plus />
                </IconButton>
              </span>
            )}
          </>
        )}
        <span className="hoot-viewer__spacer" />
        {fallback}
      </header>
      <main
        ref={host}
        className="hoot-viewer__doc"
        data-phase={phase}
        lang={phase === 'ready' ? docLang : undefined}
      >
        {(!url || phase === 'error') && (
          <section className="hoot-viewer__notice" role="alert">
            <h2 className="hoot-t-subtitle">Hoot couldn’t open this PDF</h2>
            <p className="hoot-t-body">
              {url
                ? 'It may have moved, or the site may not allow it.'
                : 'This address isn’t a PDF.'}{' '}
              The browser’s own viewer may still show it.
            </p>
          </section>
        )}
        {phase === 'file-access' && (
          <section className="hoot-viewer__notice">
            <h2 className="hoot-t-subtitle">Let Hoot Lens open files on this computer</h2>
            <p className="hoot-t-body">
              Your browser asks once. On the extension’s details page, turn on “Allow access to file
              URLs”, then open this PDF again.
            </p>
            <div className="hoot-viewer__actions">
              <Button
                variant="primary"
                onClick={() =>
                  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
                }
              >
                Open extension details
              </Button>
              <Button onClick={() => void openNative(file)}>Use the browser’s viewer</Button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
