import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfOverlayRenderer } from '../src/overlay'

// A minimal pages-mode DOM: two pages, each with a text layer of spans.
function build(): { pages: HTMLElement[]; text: (page: number, i: number) => Text } {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.className = 'hoot-pdf'
  const pages = [1, 2].map((n) => {
    const page = document.createElement('div')
    page.className = 'hoot-pdf-page'
    page.dataset.page = String(n)
    const layer = document.createElement('div')
    layer.className = 'hoot-pdf-text'
    for (const t of [
      'the model shows heteroscedasticity.',
      'A residual plot is the quickest check.'
    ]) {
      const span = document.createElement('span')
      span.textContent = t
      layer.append(span)
    }
    page.append(layer)
    root.append(page)
    return page
  })
  document.body.append(root)
  return {
    pages,
    text: (page, i) =>
      pages[page - 1]!.querySelectorAll('.hoot-pdf-text span')[i]!.firstChild as Text
  }
}

function range(start: Text, from: number, end: Text = start, to = from + 5): Range {
  const r = document.createRange()
  r.setStart(start, from)
  r.setEnd(end, to)
  return r
}

const define = { action: 'replace', transform: 'define', text: 'uneven error spread' } as const

describe('PdfOverlayRenderer', () => {
  let dom: ReturnType<typeof build>
  beforeEach(() => {
    dom = build()
    // happy-dom has no layout: give ranges and pages fixed boxes.
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(110, 220, 150, 20)
    ] as unknown as DOMRectList)
    // Pages are 1000×1300 at (10, 20); a rewrite's <mark> is one 20px line tall.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('hoot-pdf-page')
        ? new DOMRect(10, 20, 1000, 1300)
        : new DOMRect(0, 0, 100, 20)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('accepts runs inside one page text layer and refuses the rest', () => {
    const r = new PdfOverlayRenderer({ scale: () => 2 })
    expect(r.check(range(dom.text(1, 0), 16, dom.text(1, 0), 34))).toEqual({ ok: true })
    const collapsed = range(dom.text(1, 0), 3, dom.text(1, 0), 3)
    expect(r.check(collapsed)).toEqual({ ok: false, reason: 'collapsed' })
    expect(r.check(range(dom.text(1, 1), 0, dom.text(2, 0), 4))).toEqual({
      ok: false,
      reason: 'multi-block'
    })
    const outside = document.createElement('p')
    outside.textContent = 'not in a PDF'
    document.body.append(outside)
    expect(r.check(range(outside.firstChild as Text, 0))).toEqual({
      ok: false,
      reason: 'multi-block'
    })
    expect(r.check(range(dom.text(1, 0), 3, dom.text(1, 0), 4))).toEqual({
      ok: false,
      reason: 'no-text'
    })
  })

  it('lays a replace box over the run in PDF points that follow the zoom variable', () => {
    const r = new PdfOverlayRenderer({ scale: () => 2, ids: () => 'm1' })
    const mark = r.apply(range(dom.text(1, 0), 16, dom.text(1, 0), 34), define)!
    expect(mark).not.toBeNull()
    expect(mark.id).toBe('m1')
    expect(mark.original).toBe('heteroscedasticity')
    const box = dom.pages[0]!.querySelector<HTMLElement>('.hoot-pdf-marks > .hoot-pdf-mark')!
    expect(box.dataset.action).toBe('replace')
    // (110 - 10) / 2 = 50pt from the page's left edge, (220 - 20) / 2 = 100pt down.
    expect(box.style.left).toBe('calc(var(--total-scale-factor) * 50.00px)')
    expect(box.style.top).toBe('calc(var(--total-scale-factor) * 100.00px)')
    expect(box.style.width).toBe('calc(var(--total-scale-factor) * 75.00px)')
    expect(mark.anchor.tagName).toBe('MARK')
    expect(mark.anchor.tabIndex).toBe(0)
    expect(mark.anchor.textContent).toBe('uneven error spread')
    const desc = document.getElementById(mark.anchor.getAttribute('aria-describedby')!)
    expect(desc?.textContent).toContain('Original: heteroscedasticity')
    expect(r.get('m1')).toBe(mark)
    expect(r.marks()).toEqual([mark])
  })

  it('won’t mark inside an existing mark', () => {
    const r = new PdfOverlayRenderer({ scale: () => 1 })
    const mark = r.apply(range(dom.text(1, 0), 16, dom.text(1, 0), 34), define)!
    const inside = range(mark.anchor.firstChild as Text, 0)
    // The mark lives outside the text layer, so it's refused as not-a-PDF-run.
    expect(r.check(inside).ok).toBe(false)
  })

  it('puts a gloss beside the run with a tint over it, and restore removes both', () => {
    const r = new PdfOverlayRenderer({ scale: () => 1 })
    const mark = r.apply(range(dom.text(1, 1), 0, dom.text(1, 1), 38), {
      action: 'gloss',
      transform: 'example',
      text: 'Plot residuals against fitted values.'
    })!
    const layer = dom.pages[0]!.querySelector('.hoot-pdf-marks')!
    expect(layer.querySelectorAll('.hoot-pdf-mark__run')).toHaveLength(1)
    expect(layer.querySelector('.hoot-pdf-mark')?.classList.contains('hoot-pdf-mark--margin')).toBe(
      true
    )
    expect(r.restore(mark.id)).toBe(true)
    expect(layer.children).toHaveLength(0)
    expect(r.restore(mark.id)).toBe(false)
  })

  it('restoreAll clears every page and reports the count', () => {
    const r = new PdfOverlayRenderer({ scale: () => 1 })
    r.apply(range(dom.text(1, 0), 16, dom.text(1, 0), 34), define)
    r.apply(range(dom.text(2, 0), 16, dom.text(2, 0), 34), define)
    expect(r.restoreAll()).toBe(2)
    expect(document.querySelectorAll('.hoot-pdf-mark')).toHaveLength(0)
    expect(r.marks()).toEqual([])
    const off = r.subscribe(() => undefined)
    expect(typeof off).toBe('function')
    r.destroy()
  })
})
