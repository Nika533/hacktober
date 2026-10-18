import {
  describeMark,
  type ApplyOptions,
  type Mark,
  type MarkSpec,
  type RangeCheck,
  type Renderer,
  type RendererListener,
  type RestoreOptions
} from '@hoot/lens-dom'

/**
 * Lens marks for pages mode: lens-dom's `Renderer` contract over a PDF page.
 *
 * A PDF page is a canvas, so its glyphs can't be swapped. Instead a mark is a
 * box laid over the glyph run on the page itself:
 * - replace: the box is paper-coloured and covers the run. The rewrite starts
 *   at the run's font size and shrinks in steps down to a floor; if it still
 *   doesn't fit, the box grows into a card below the run (spec §9.2).
 * - gloss: the run stays visible with a tint, and the note sits in the page
 *   margin beside it, or under the run when the margin is too narrow.
 *
 * Geometry is stored in PDF points and written as
 * `calc(var(--total-scale-factor) * Npt-as-px)`, the same variable the text
 * layer uses. Zoom, re-render and canvas release therefore never move or drop
 * a mark, and nothing listens to scroll: the boxes live inside the page.
 */

const FONT_STEPS = [1, 0.92, 0.85, 0.78, 0.72]
/** Below this (in CSS px at the current zoom) shrinking stops and the box grows. */
const MIN_FONT_PX = 9
/** Narrowest margin (pt) a gloss is placed in; otherwise it goes under the run. */
const MIN_MARGIN_PT = 110
const GAP_PT = 6
const LINE_HEIGHT = 1.15

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Entry {
  mark: PdfMark
  /** The box plus, for glosses, the tint over the run. */
  parts: HTMLElement[]
}

class PdfMark implements Mark {
  constructor(
    readonly id: string,
    readonly spec: MarkSpec,
    readonly original: string,
    readonly anchor: HTMLElement
  ) {}

  rects(): DOMRect[] {
    return Array.from(this.anchor.getClientRects())
  }
}

export interface PdfOverlayRendererOptions {
  /** Current zoom (CSS px per PDF point), usually `() => view.scale`. */
  scale: () => number
  ids?: () => string
}

/** The `.hoot-pdf-page` holding both ends of the range, if they share one text layer. */
function pageOf(range: Range): HTMLElement | null {
  const elementOf = (n: Node): Element | null => (n instanceof Element ? n : n.parentElement)
  const start = elementOf(range.startContainer)?.closest('.hoot-pdf-text')
  const end = elementOf(range.endContainer)?.closest('.hoot-pdf-text')
  if (!start || start !== end) return null
  return start.closest<HTMLElement>('.hoot-pdf-page')
}

const px = (pt: number): string => `calc(var(--total-scale-factor) * ${pt.toFixed(2)}px)`

/** Union of the range's line boxes, in PDF points relative to the page. */
function runBox(range: Range, page: HTMLElement, scale: number): Box | null {
  const p = page.getBoundingClientRect()
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return {
    left: (left - p.left) / scale,
    top: (top - p.top) / scale,
    width: (right - left) / scale,
    height: (bottom - top) / scale
  }
}

/** Font size of the run in PDF points (text-layer spans carry it at the current zoom). */
function runFontPt(range: Range, scale: number): number {
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  const size = el ? Number.parseFloat(getComputedStyle(el).fontSize) : NaN
  return Number.isFinite(size) && size > 0 ? size / scale : 11
}

/** The text layer's font family for the run (PDF.js maps PDF fonts to CSS families). */
function runFontFamily(range: Range): string {
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  return (el && getComputedStyle(el).fontFamily) || 'sans-serif'
}

export class PdfOverlayRenderer implements Renderer {
  readonly kind = 'pdf-overlay'
  readonly #opts: PdfOverlayRendererOptions
  readonly #entries = new Map<string, Entry>()
  #seq = 0

  constructor(options: PdfOverlayRendererOptions) {
    this.#opts = options
  }

  check(range: Range): RangeCheck {
    if (range.collapsed) return { ok: false, reason: 'collapsed' }
    if (!range.startContainer.isConnected) return { ok: false, reason: 'detached' }
    const page = pageOf(range)
    if (!page) return { ok: false, reason: 'multi-block' }
    if (!range.toString().trim()) return { ok: false, reason: 'no-text' }
    const inMark = (n: Node): boolean =>
      !!(n instanceof Element ? n : n.parentElement)?.closest('.hoot-pdf-mark')
    if (inMark(range.startContainer) || inMark(range.endContainer)) {
      return { ok: false, reason: 'marked' }
    }
    return { ok: true }
  }

  apply(range: Range, spec: MarkSpec, options: ApplyOptions = {}): Mark | null {
    if (!this.check(range).ok) return null
    const page = pageOf(range)
    const scale = this.#opts.scale()
    const run = page && runBox(range, page, scale)
    if (!page || !run) return null

    const id = this.#opts.ids?.() ?? `pdf-mark-${++this.#seq}`
    const original = range.toString()
    const doc = page.ownerDocument
    const box = doc.createElement('div')
    box.className = 'hoot-pdf-mark'
    box.dataset.action = spec.action
    box.dataset.hootLens = id
    const anchor = doc.createElement('mark')
    anchor.tabIndex = 0
    anchor.textContent = spec.text
    const desc = doc.createElement('span')
    desc.id = `hoot-pdf-desc-${id}`
    desc.hidden = true
    desc.textContent = describeMark(spec, original)
    anchor.setAttribute('aria-describedby', desc.id)
    box.append(anchor, desc)

    let layer = page.querySelector<HTMLElement>(':scope > .hoot-pdf-marks')
    if (!layer) {
      layer = doc.createElement('div')
      layer.className = 'hoot-pdf-marks'
      page.append(layer)
    }
    layer.append(box)

    const fontPt = runFontPt(range, scale)
    box.style.fontFamily = runFontFamily(range)
    const parts: HTMLElement[] = [box]
    if (spec.action === 'replace') this.#layoutReplace(box, run, fontPt, scale)
    else {
      const pageWidthPt = page.getBoundingClientRect().width / scale
      parts.push(this.#layoutGloss(box, run, fontPt, pageWidthPt, layer, scale))
    }

    const mark = new PdfMark(id, spec, original, anchor)
    this.#entries.set(id, { mark, parts })
    if (options.animate) for (const el of parts) materialize(el)
    return mark
  }

  restore(id: string, options: RestoreOptions = {}): boolean {
    const entry = this.#entries.get(id)
    if (!entry) return false
    this.#entries.delete(id)
    for (const el of entry.parts) {
      if (options.animate) dematerialize(el)
      else el.remove()
    }
    return true
  }

  restoreAll(options: RestoreOptions = {}): number {
    const ids = [...this.#entries.keys()].reverse()
    for (const id of ids) this.restore(id, options)
    return ids.length
  }

  get(id: string): Mark | undefined {
    return this.#entries.get(id)?.mark
  }

  marks(): Mark[] {
    return [...this.#entries.values()].map((e) => e.mark)
  }

  /** Marks are tied to page geometry, not DOM text, so they're never dropped. */
  subscribe(listener: RendererListener): () => void {
    void listener
    return () => undefined
  }

  destroy(): void {
    this.restoreAll()
  }

  #layoutReplace(box: HTMLElement, run: Box, fontPt: number, scale: number): void {
    const st = box.style
    st.left = px(run.left)
    st.top = px(run.top)
    st.width = px(run.width)
    st.minHeight = px(run.height)
    st.lineHeight = String(LINE_HEIGHT)
    // How many lines the original run takes up (usually one).
    const runLines = Math.max(1, Math.round(run.height / (fontPt * LINE_HEIGHT)))
    // Shrink in steps while the rewrite needs more lines than the original.
    for (const step of FONT_STEPS) {
      const sizePt = fontPt * step
      if (sizePt * scale < MIN_FONT_PX && step !== 1) break
      st.fontSize = px(sizePt)
      if (linesOf(box, sizePt * scale) <= runLines) return
    }
    // Still too long: keep the floor size and let the box grow into a card
    // that wraps downward from the run (never sideways into the same line,
    // where it would read as if it were part of the sentence).
    box.classList.add('hoot-pdf-mark--card')
    st.fontSize = px(Math.max(fontPt * FONT_STEPS[FONT_STEPS.length - 1]!, MIN_FONT_PX / scale))
    st.width = px(Math.max(run.width, 160))
  }

  #layoutGloss(
    box: HTMLElement,
    run: Box,
    fontPt: number,
    pageWidthPt: number,
    layer: HTMLElement,
    scale: number
  ): HTMLElement {
    // A tint over the run itself, so the reader sees what the note is about.
    const tint = layer.ownerDocument.createElement('div')
    tint.className = 'hoot-pdf-mark__run'
    Object.assign(tint.style, {
      left: px(run.left),
      top: px(run.top),
      width: px(run.width),
      height: px(run.height)
    })
    layer.insertBefore(tint, box)

    const st = box.style
    st.fontSize = px(Math.max(fontPt * 0.85, 7))
    // The note goes past the end of the text on these lines, into the margin.
    const textRight = Math.max(run.left + run.width, lineRight(layer, run, scale))
    const rightMargin = pageWidthPt - textRight - GAP_PT * 2
    if (rightMargin >= MIN_MARGIN_PT) {
      box.classList.add('hoot-pdf-mark--margin')
      st.left = px(textRight + GAP_PT * 2)
      st.top = px(run.top)
      st.width = px(Math.min(rightMargin, 200))
    } else {
      st.left = px(run.left)
      st.top = px(run.top + run.height + GAP_PT / 2)
      st.maxWidth = px(Math.max(run.width, 200))
    }
    return tint
  }
}

/** Rightmost text edge (pt) on the lines the run occupies, from the page's text layer. */
function lineRight(layer: HTMLElement, run: Box, scale: number): number {
  const page = layer.parentElement
  const text = page?.querySelector('.hoot-pdf-text')
  if (!page || !text) return 0
  const p = page.getBoundingClientRect()
  let right = 0
  for (const span of text.querySelectorAll('span')) {
    const r = span.getBoundingClientRect()
    const mid = (r.top + r.bottom) / 2 - p.top
    if (r.width > 0 && mid >= run.top * scale && mid <= (run.top + run.height) * scale) {
      right = Math.max(right, (r.right - p.left) / scale)
    }
  }
  return right
}

/** Lines the box's text wraps to at a given font size (px). */
function linesOf(box: HTMLElement, fontPx: number): number {
  const anchor = box.querySelector('mark')
  const height = anchor ? anchor.getBoundingClientRect().height : box.scrollHeight
  return Math.max(1, Math.round(height / (fontPx * LINE_HEIGHT)))
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Spec §5.5: blur 2px → 0 and fade in, ~180 ms, no bounce; 120 ms fade under reduced motion. */
function materialize(el: HTMLElement): void {
  if (typeof el.animate !== 'function') return
  el.animate(
    reduced()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, filter: 'blur(2px)' },
          { opacity: 1, filter: 'blur(0)' }
        ],
    { duration: reduced() ? 120 : 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
  )
}

/** The same path out, then the box is removed. */
function dematerialize(el: HTMLElement): void {
  if (typeof el.animate !== 'function') {
    el.remove()
    return
  }
  const a = el.animate(
    reduced()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, filter: 'blur(0)' },
          { opacity: 0, filter: 'blur(2px)' }
        ],
    { duration: reduced() ? 120 : 180, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' }
  )
  a.onfinish = () => el.remove()
  a.oncancel = () => el.remove()
}
