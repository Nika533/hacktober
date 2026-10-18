// Stand-alone harness: ?theme=dark&mode=reflow.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import fixture from '../tests/fixtures/article.pdf?url'
import { openPdf, PdfOverlayRenderer, PdfView, type PdfViewMode } from '../src'
import '../src/styles.css'
import './harness.css'

const params = new URLSearchParams(location.search)
const theme = params.get('theme')
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme

const host = document.querySelector<HTMLElement>('.harness__doc')!
const pageLabel = document.querySelector<HTMLElement>('.harness__page')!
let view: PdfView | null = null
let lens: PdfOverlayRenderer | null = null

async function show(source: { url: string } | { data: ArrayBuffer }, label: string): Promise<void> {
  const mode = (view?.mode ?? (params.get('mode') === 'reflow' ? 'reflow' : 'pages')) as PdfViewMode
  lens?.destroy()
  view?.destroy()
  const doc = await openPdf(source, { workerSrc })
  view = await PdfView.create(host, doc, {
    label,
    mode,
    onPageChange: (n) => (pageLabel.textContent = `Page ${n} of ${doc.numPages}`)
  })
  const current = view
  lens = new PdfOverlayRenderer({ scale: () => current.scale })
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
/** A Range over the first occurrence of some text in a page's text layer. */
function findInPage(page: number, text: string): Range | null {
  const layer = view?.textLayer(page)
  if (!layer) return null
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent?.indexOf(text) ?? -1
    if (i < 0) continue
    const r = document.createRange()
    r.setStart(n, i)
    r.setEnd(n, i + text.length)
    return r
  }
  return null
}

// What a Lens session would produce on this page: a defined term (fits after
// shrinking), a long rewrite (grows into a card) and a margin gloss.
document.querySelector('[data-lens="demo"]')!.addEventListener('click', () => {
  if (!lens || view?.mode !== 'pages') return
  const term = findInPage(1, 'heteroscedasticity')
  if (term)
    lens.apply(
      term,
      { action: 'replace', transform: 'define', text: 'uneven error spread' },
      { animate: true }
    )
  const title = findInPage(1, 'Robust standard errors')
  if (title)
    lens.apply(
      title,
      {
        action: 'replace',
        transform: 'simplify',
        text: 'Standard errors that stay honest when the spread is uneven'
      },
      { animate: true }
    )
  const plot = findInPage(1, 'A residual plot is the quickest check.')
  if (plot)
    lens.apply(
      plot,
      {
        action: 'gloss',
        transform: 'example',
        text: 'Plot residuals against fitted values; a funnel means uneven spread.'
      },
      { animate: true }
    )
  document.body.dataset.marks = String(lens.marks().length)
})
document.querySelector('[data-lens="clear"]')!.addEventListener('click', () => {
  lens?.restoreAll({ animate: true })
  document.body.dataset.marks = '0'
})

document.querySelector<HTMLInputElement>('input[type="file"]')!.addEventListener('change', (e) => {
  const file = (e.currentTarget as HTMLInputElement).files?.[0]
  if (file) void file.arrayBuffer().then((data) => show({ data }, file.name))
})

void show({ url: fixture }, 'article.pdf')
