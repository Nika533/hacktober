// Stand-alone harness: ?theme=dark&mode=reflow.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import fixture from '../tests/fixtures/article.pdf?url'
import { openPdf, PdfView, type PdfViewMode } from '../src'
import '../src/styles.css'
import './harness.css'

const params = new URLSearchParams(location.search)
const theme = params.get('theme')
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme

const host = document.querySelector<HTMLElement>('.harness__doc')!
const pageLabel = document.querySelector<HTMLElement>('.harness__page')!
let view: PdfView | null = null

async function show(source: { url: string } | { data: ArrayBuffer }, label: string): Promise<void> {
  const mode = (view?.mode ?? (params.get('mode') === 'reflow' ? 'reflow' : 'pages')) as PdfViewMode
  view?.destroy()
  const doc = await openPdf(source, { workerSrc })
  view = await PdfView.create(host, doc, {
    label,
    mode,
    onPageChange: (n) => (pageLabel.textContent = `Page ${n} of ${doc.numPages}`)
  })
  pageLabel.textContent = `Page 1 of ${doc.numPages}`
  syncMode()
  document.body.dataset.ready = 'true'
}

function syncMode(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === view?.mode))
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
  b.addEventListener('click', () => {
    void view?.setMode(b.dataset.mode as PdfViewMode).then(syncMode)
  })
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  b.addEventListener('click', () => {
    if (!view) return
    const z = b.dataset.zoom
    view.setZoom(z === 'fit' ? 'fit-width' : view.scale * (z === 'in' ? 1.25 : 0.8))
  })
}
document.querySelector<HTMLInputElement>('input[type="file"]')!.addEventListener('change', (e) => {
  const file = (e.currentTarget as HTMLInputElement).files?.[0]
  if (file) void file.arrayBuffer().then((data) => show({ data }, file.name))
})

void show({ url: fixture }, 'article.pdf')
