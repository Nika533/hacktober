import {
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask
} from 'pdfjs-dist'
import {
  bodyFontSize,
  linesFromRuns,
  reflowPage,
  runsFromTextContent,
  type TextRun
} from './reflow'
import { renderReflow } from './renderReflow'

export type PdfViewMode = 'pages' | 'reflow'
export type PdfZoom = number | 'fit-width'

export interface PdfViewOptions {
  mode?: PdfViewMode
  zoom?: PdfZoom
  /** Accessible name of the scroll area, e.g. the file name. */
  label?: string
  /** Most visible page changed (1-based). */
  onPageChange?: (page: number) => void
  /** A page's canvas and text layer finished rendering (1-based). */
  onPageRendered?: (page: number) => void
  /** Rendered pages kept in memory; older off-screen ones are released. */
  maxRenderedPages?: number
}

interface Slot {
  n: number
  page: PDFPageProxy
  /** Size at scale 1, PDF points. */
  width: number
  height: number
  el: HTMLDivElement
  canvas: HTMLCanvasElement
  text: HTMLDivElement
  renderedScale: number | null
  task: RenderTask | null
  textLayer: TextLayer | null
  usedAt: number
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const GUTTER = 24

/**
 * A scrolling document view with two modes:
 * - 'pages': each page as a canvas plus a selectable PDF.js text layer,
 *   rendered lazily as it nears the viewport, at the device pixel ratio;
 * - 'reflow': the text as headings and paragraphs that wrap to the window.
 *
 * Framework-free so the extension's viewer and the Hoot Reader share it.
 * The owner keeps the PDFDocumentProxy and destroys it after `destroy()`.
 */
export class PdfView {
  readonly element: HTMLDivElement
  readonly #doc: PDFDocumentProxy
  readonly #opts: PdfViewOptions
  readonly #pagesEl: HTMLDivElement
  readonly #slots: Slot[]
  readonly #visible = new Map<number, number>()
  #mode: PdfViewMode = 'pages'
  #zoom: PdfZoom = 'fit-width'
  #scale = 1
  #current = 1
  #reflow: HTMLElement | null = null
  #io: IntersectionObserver | null = null
  #ro: ResizeObserver | null = null
  #frame = 0
  #destroyed = false

  private constructor(
    container: HTMLElement,
    doc: PDFDocumentProxy,
    pages: PDFPageProxy[],
    opts: PdfViewOptions
  ) {
    this.#doc = doc
    this.#opts = opts
    const own = container.ownerDocument
    this.element = own.createElement('div')
    this.element.className = 'hoot-pdf'
    this.element.tabIndex = 0
    this.element.setAttribute('role', 'document')
    this.element.setAttribute('aria-label', opts.label ?? 'PDF document')
    this.element.dataset.mode = 'pages'
    this.#pagesEl = own.createElement('div')
    this.#pagesEl.className = 'hoot-pdf__pages'
    this.element.append(this.#pagesEl)

    this.#slots = pages.map((page, i) => {
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view
      const el = own.createElement('div')
      el.className = 'hoot-pdf-page'
      el.dataset.page = String(i + 1)
      el.setAttribute('role', 'group')
      el.setAttribute('aria-label', `Page ${i + 1} of ${pages.length}`)
      const canvas = own.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      const text = own.createElement('div')
      text.className = 'hoot-pdf-text'
      el.append(canvas, text)
      this.#pagesEl.append(el)
      return {
        n: i + 1,
        page,
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        el,
        canvas,
        text,
        renderedScale: null,
        task: null,
        textLayer: null,
        usedAt: 0
      }
    })
    container.append(this.element)
  }

  /** Builds the view inside `container` (which should give it a height). */
  static async create(
    container: HTMLElement,
    doc: PDFDocumentProxy,
    opts: PdfViewOptions = {}
  ): Promise<PdfView> {
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
    )
    const view = new PdfView(container, doc, pages, opts)
    view.#observe()
    view.setZoom(opts.zoom ?? 'fit-width')
    if (opts.mode === 'reflow') await view.setMode('reflow')
    return view
  }

  get pageCount(): number {
    return this.#slots.length
  }
  get mode(): PdfViewMode {
    return this.#mode
  }
  get scale(): number {
    return this.#scale
  }
  get zoom(): PdfZoom {
    return this.#zoom
  }
  get currentPage(): number {
    return this.#current
  }

  pageElement(n: number): HTMLElement | undefined {
    return this.#slots[n - 1]?.el
  }
  /** The selectable text layer of a page in 'pages' mode. */
  textLayer(n: number): HTMLElement | undefined {
    return this.#slots[n - 1]?.text
  }
  /** The reflowed article, once reflow mode has been shown. */
  get reflowElement(): HTMLElement | null {
    return this.#reflow
  }

  setZoom(zoom: PdfZoom): void {
    this.#zoom = zoom
    const anchor = this.#current
    let changed = this.#applyScale(this.#targetScale(zoom))
    // Sizing the pages can add a vertical scrollbar, which narrows the
    // viewport; fit again once against the final width.
    if (zoom === 'fit-width') changed = this.#applyScale(this.#targetScale(zoom)) || changed
    if (changed && this.#mode === 'pages') {
      this.scrollToPage(anchor)
      for (const n of this.#visible.keys()) void this.#render(n)
    }
  }

  #targetScale(zoom: PdfZoom): number {
    const first = this.#slots[0]
    const fit = first ? (this.element.clientWidth - GUTTER * 2) / first.width : 1
    const raw = zoom === 'fit-width' ? fit : zoom
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(raw) && raw > 0 ? raw : 1))
  }

  /** Sizes every page for `scale`; false when nothing changed. */
  #applyScale(scale: number): boolean {
    if (scale === this.#scale && this.#slots.every((s) => s.el.style.width)) return false
    this.#scale = scale
    // PDF.js text layers size themselves from these variables.
    const st = this.element.style
    st.setProperty('--scale-factor', String(scale))
    st.setProperty('--user-unit', '1')
    st.setProperty('--total-scale-factor', String(scale))
    st.setProperty('--scale-round-x', '1px')
    st.setProperty('--scale-round-y', '1px')
    for (const s of this.#slots) {
      s.el.style.width = `${Math.floor(s.width * scale)}px`
      s.el.style.height = `${Math.floor(s.height * scale)}px`
    }
    return true
  }

  async setMode(mode: PdfViewMode): Promise<void> {
    if (mode === this.#mode && (mode === 'pages' || this.#reflow)) return
    const page = this.#current
    if (mode === 'reflow' && !this.#reflow) {
      this.#reflow = await this.#buildReflow()
      if (this.#destroyed) return
      this.element.append(this.#reflow)
    }
    this.#mode = mode
    this.element.dataset.mode = mode
    this.#pagesEl.hidden = mode !== 'pages'
    if (this.#reflow) this.#reflow.hidden = mode !== 'reflow'
    this.scrollToPage(page)
    if (mode === 'pages') for (const n of this.#visible.keys()) void this.#render(n)
  }

  scrollToPage(n: number): void {
    const target =
      this.#mode === 'reflow'
        ? this.#reflow?.querySelector<HTMLElement>(`[data-page="${n}"]`)
        : this.#slots[n - 1]?.el
    if (!target) return
    this.element.scrollTop = target.offsetTop - (this.#mode === 'pages' ? GUTTER / 2 : 0)
    this.#setCurrent(n)
  }

  destroy(): void {
    this.#destroyed = true
    cancelAnimationFrame(this.#frame)
    this.#io?.disconnect()
    this.#ro?.disconnect()
    for (const s of this.#slots) this.#release(s)
    this.element.remove()
  }

  // ---- internals ----

  #observe(): void {
    if (typeof IntersectionObserver !== 'undefined') {
      this.#io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page)
            if (e.isIntersecting) this.#visible.set(n, e.intersectionRatio)
            else this.#visible.delete(n)
          }
          let best = this.#current
          let bestRatio = -1
          for (const [n, r] of this.#visible) {
            if (r > bestRatio || (r === bestRatio && n < best)) {
              best = n
              bestRatio = r
            }
          }
          if (this.#mode === 'pages') {
            this.#setCurrent(best)
            for (const n of this.#visible.keys()) void this.#render(n)
          }
        },
        // Start rendering a screen ahead so scrolling rarely shows blanks.
        { root: this.element, rootMargin: '100% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
      )
      for (const s of this.#slots) this.#io.observe(s.el)
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.#ro = new ResizeObserver(() => {
        if (this.#zoom !== 'fit-width') return
        cancelAnimationFrame(this.#frame)
        this.#frame = requestAnimationFrame(() => this.setZoom('fit-width'))
      })
      this.#ro.observe(this.element)
    }
  }

  #setCurrent(n: number): void {
    if (n === this.#current) return
    this.#current = n
    this.#opts.onPageChange?.(n)
  }

  async #render(n: number): Promise<void> {
    const s = this.#slots[n - 1]
    if (!s || this.#destroyed) return
    s.usedAt = performance.now()
    if (s.renderedScale === this.#scale && !s.task) return
    if (s.task) {
      s.task.cancel()
      s.task = null
    }
    s.textLayer?.cancel()
    const scale = this.#scale
    const viewport = s.page.getViewport({ scale })
    const ratio = globalThis.devicePixelRatio || 1
    // Render into a fresh canvas and swap it in, so the old bitmap stays up
    // (stretched) until the sharp one is ready.
    const canvas = s.el.ownerDocument.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    const task = s.page.render({
      canvas,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    })
    s.task = task
    try {
      await task.promise
    } catch (e) {
      if (e instanceof RenderingCancelledException) return
      throw e
    } finally {
      if (s.task === task) s.task = null
    }
    if (this.#destroyed || scale !== this.#scale) return
    s.canvas.replaceWith(canvas)
    s.canvas = canvas

    s.text.replaceChildren()
    const textLayer = new TextLayer({
      textContentSource: s.page.streamTextContent(),
      container: s.text,
      viewport
    })
    s.textLayer = textLayer
    try {
      await textLayer.render()
    } catch {
      return
    }
    s.renderedScale = scale
    this.#opts.onPageRendered?.(n)
    this.#evict()
  }

  /** Frees the canvases of the least recently shown off-screen pages. */
  #evict(): void {
    const max = this.#opts.maxRenderedPages ?? 12
    const rendered = this.#slots.filter((s) => s.renderedScale !== null && !this.#visible.has(s.n))
    const keep = max - this.#visible.size
    if (rendered.length <= keep) return
    rendered.sort((a, b) => a.usedAt - b.usedAt)
    for (const s of rendered.slice(0, rendered.length - Math.max(0, keep))) this.#release(s)
  }

  #release(s: Slot): void {
    s.task?.cancel()
    s.task = null
    s.textLayer?.cancel()
    s.textLayer = null
    s.canvas.width = 0
    s.canvas.height = 0
    s.text.replaceChildren()
    s.renderedScale = null
  }

  async #buildReflow(): Promise<HTMLElement> {
    const perPage: TextRun[][] = []
    for (const s of this.#slots) {
      const content = await s.page.getTextContent()
      perPage.push(runsFromTextContent(content.items))
    }
    const body = bodyFontSize(perPage.flatMap((runs) => linesFromRuns(runs)))
    const blocks = perPage.flatMap((runs, i) => reflowPage(runs, i + 1, body))
    const article = renderReflow(blocks, this.#slots.length, this.element.ownerDocument)
    // The document's /Lang, so screen readers and lens-dom read it correctly.
    const meta = await this.#doc.getMetadata().catch(() => null)
    const lang = (meta?.info as { Language?: unknown } | undefined)?.Language
    if (typeof lang === 'string' && lang) article.lang = lang
    return article
  }
}
