import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARK_TAG } from '../src/guard'
import { InlineRenderer } from '../src/render/inline'
import type { MarkSpec, RendererEvent } from '../src/render/types'
import { rangeForText } from './helpers'

const spec: MarkSpec = { action: 'replace', transform: 'define', text: 'unequal spread (rewrite)' }
const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let renderer: InlineRenderer
let events: RendererEvent[]
let p: HTMLElement
const html = 'The model shows <em>heteroscedasticity</em> in the residuals.'

beforeEach(() => {
  document.body.innerHTML = `<main><p id="p">${html}</p><p id="other">Other text.</p></main>`
  p = document.getElementById('p') as HTMLElement
  renderer = new InlineRenderer({ document, shadowMode: 'open', reapplyDelayMs: 0 })
  events = []
  renderer.subscribe((event) => events.push(event))
})

afterEach(() => renderer.destroy())

describe('InlineRenderer: page re-renders', () => {
  it('ignores its own mutations', async () => {
    renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)
    await settle()
    expect(events).toEqual([])
    expect(renderer.marks()).toHaveLength(1)
  })

  it('drops a mark quietly when the page edits the marked text', async () => {
    const mark = renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)!
    const text = p.querySelector(MARK_TAG)!.firstChild as Text
    text.data = 'homoscedasticity'
    await settle()
    expect(events.map((event) => event.type)).toEqual(['dropped'])
    expect(events[0]?.mark.id).toBe(mark.id)
    expect(p.querySelector(MARK_TAG)).toBeNull()
    expect(p.textContent).toBe('The model shows homoscedasticity in the residuals.')
    expect(renderer.marks()).toHaveLength(0)
  })

  it('re-applies the mark when the page re-renders the same text', async () => {
    const mark = renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)!
    p.innerHTML = html
    await settle()
    expect(events.map((event) => event.type)).toEqual(['dropped', 'reapplied'])
    const reapplied = events[1]
    expect(reapplied?.type === 'reapplied' && reapplied.previousId).toBe(mark.id)
    const host = p.querySelector(MARK_TAG)!
    expect(host.shadowRoot?.querySelector('mark')?.textContent).toBe(spec.text)
    expect(renderer.marks()).toHaveLength(1)
  })

  it('re-applies when the whole block is replaced by an identical one', async () => {
    renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)
    const fresh = document.createElement('p')
    fresh.innerHTML = html
    p.replaceWith(fresh)
    await settle()
    expect(events.map((event) => event.type)).toEqual(['dropped', 'reapplied'])
    expect(fresh.querySelector(MARK_TAG)).not.toBeNull()
  })

  it('does not re-apply when the paragraph text changed', async () => {
    renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)
    p.innerHTML = 'The model shows <em>heteroscedasticity</em> in the fitted values.'
    await settle()
    expect(events.map((event) => event.type)).toEqual(['dropped'])
    expect(p.querySelector(MARK_TAG)).toBeNull()
  })

  it('gives up after a few re-applies on a page that keeps re-rendering', async () => {
    renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)
    const fighter = new MutationObserver(() => {
      if (p.querySelector(MARK_TAG)) p.innerHTML = html
    })
    fighter.observe(p, { childList: true, subtree: true })
    p.innerHTML = html
    for (let i = 0; i < 10; i++) await settle(10)
    fighter.disconnect()
    const types = events.map((event) => event.type)
    expect(types.filter((type) => type === 'reapplied')).toHaveLength(3)
    expect(types.filter((type) => type === 'dropped')).toHaveLength(4)
    expect(p.querySelector(MARK_TAG)).toBeNull()
  })

  it('stops observing once every mark is restored', async () => {
    const mark = renderer.apply(rangeForText(p, 'heteroscedasticity'), spec)!
    renderer.restore(mark.id)
    p.innerHTML = html
    await settle()
    expect(events).toEqual([])
  })
})
