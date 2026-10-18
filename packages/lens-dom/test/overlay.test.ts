import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UI_TAG } from '../src/guard'
import { OverlayRenderer, toLines } from '../src/render/overlay'
import type { MarkSpec, RendererEvent } from '../src/render/types'
import { createUiRoot, type UiRoot } from '../src/ui/root'
import { HIGHLIGHT_GLOSS, HIGHLIGHT_REPLACE } from '../src/ui/styles'
import { rangeForText } from './helpers'

class FakeHighlight extends Set<AbstractRange> {}

const replace: MarkSpec = { action: 'replace', transform: 'expand', text: 'ordinary least squares' }
const html = 'The <b>OLS</b> estimator is still unbiased.'
const settle = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let root: UiRoot
let renderer: OverlayRenderer
let p: HTMLElement
let rect: { left: number; top: number; width: number; height: number }
let registry: Map<string, FakeHighlight>
let events: RendererEvent[]

const toRect = (r: typeof rect): DOMRect =>
  ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }) as DOMRect

beforeEach(() => {
  document.documentElement.querySelectorAll(UI_TAG).forEach((node) => node.remove())
  document.body.innerHTML = `<div id="__next"><p id="p">${html}</p></div>`
  p = document.getElementById('p') as HTMLElement
  registry = new Map()
  Object.defineProperty(window, 'Highlight', { value: FakeHighlight, configurable: true })
  Object.defineProperty(window, 'CSS', { value: { highlights: registry }, configurable: true })
  rect = { left: 120, top: 40, width: 32, height: 22 }
  root = createUiRoot({ document, shadowMode: 'open' })
  renderer = new OverlayRenderer({
    document,
    root,
    reapplyDelayMs: 0,
    rects: () => [toRect(rect)]
  })
  events = []
  renderer.subscribe((event) => events.push(event))
})

afterEach(() => {
  renderer.destroy()
  root.destroy()
})

const box = (): HTMLElement | null => root.shadow.querySelector('.ov-box')

describe('OverlayRenderer', () => {
  it('never changes the page DOM', () => {
    const before = document.body.innerHTML
    const mark = renderer.apply(rangeForText(p, 'OLS'), replace)!
    expect(document.body.innerHTML).toBe(before)
    expect(mark.anchor.textContent).toBe('ordinary least squares')
    expect(mark.original).toBe('OLS')
    renderer.restore(mark.id)
    expect(document.body.innerHTML).toBe(before)
    expect(box()).toBeNull()
  })

  it('positions the box over the original range in document coordinates', () => {
    window.scrollTo(0, 0)
    renderer.apply(rangeForText(p, 'OLS'), replace)
    const style = box()!.style
    expect(style.left).toBe('120px')
    expect(style.top).toBe('40px')
    expect(style.textIndent).toBe('0px')
  })

  it('hides the original with a custom highlight and removes it on restore', () => {
    const mark = renderer.apply(rangeForText(p, 'OLS'), replace)!
    const highlight = registry.get(HIGHLIGHT_REPLACE)!
    expect(highlight.size).toBe(1)
    expect([...highlight][0]?.toString()).toBe('OLS')
    renderer.restore(mark.id)
    expect(highlight.size).toBe(0)
  })

  it('tints the original and shows the note beneath it in gloss mode', () => {
    renderer.apply(rangeForText(p, 'OLS'), {
      action: 'gloss',
      transform: 'expand',
      text: 'ordinary least squares'
    })
    expect(registry.get(HIGHLIGHT_GLOSS)?.size).toBe(1)
    expect(box()!.dataset.action).toBe('gloss')
    expect(box()!.querySelector('mark')?.textContent).toBe('ordinary least squares')
    expect(box()!.style.top).toBe(`${40 + 22 + 4}px`)
  })

  it('describes the change for screen readers', () => {
    const mark = renderer.apply(rangeForText(p, 'OLS'), replace)!
    const id = mark.anchor.getAttribute('aria-describedby')!
    expect(root.shadow.getElementById(id)?.textContent).toBe(
      'Expanded by Hoot. Original: OLS. Press Enter for options.'
    )
    expect(mark.anchor.tabIndex).toBe(0)
  })

  it('treats the rewrite as text', () => {
    renderer.apply(rangeForText(p, 'OLS'), { ...replace, text: '<b>bold</b>' })
    expect(box()!.querySelector('b')).toBeNull()
  })

  it('follows the range when the page scrolls or resizes', async () => {
    renderer.apply(rangeForText(p, 'OLS'), replace)
    rect = { ...rect, left: 10, top: 300 }
    document.dispatchEvent(new Event('scroll'))
    await settle()
    expect(box()!.style.left).toBe('10px')
    expect(box()!.style.top).toBe('300px')
  })

  it('drops the overlay when the page re-renders and re-applies it for the same text', async () => {
    const mark = renderer.apply(rangeForText(p, 'OLS'), replace)!
    p.innerHTML = html
    await settle()
    expect(events.map((event) => event.type)).toEqual(['dropped', 'reapplied'])
    expect(events[0]?.mark.id).toBe(mark.id)
    expect(renderer.marks()).toHaveLength(1)
    expect(root.shadow.querySelectorAll('.ov-box')).toHaveLength(1)
  })

  it('groups client rects into visual lines', () => {
    const r = (left: number, top: number, width: number, height: number): DOMRect =>
      toRect({ left, top, width, height })
    expect(toLines([r(10, 100, 30, 20), r(40, 102, 6, 16), r(0, 128, 50, 20)])).toEqual([
      { top: 100, bottom: 120, right: 46 },
      { top: 128, bottom: 148, right: 50 }
    ])
  })

  it('applies the same never-touch rules as the inline renderer', () => {
    p.innerHTML = 'Run <code>fit()</code> now.'
    expect(renderer.apply(rangeForText(p, 'fit()'), replace)).toBeNull()
  })
})
