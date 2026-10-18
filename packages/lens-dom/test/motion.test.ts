import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InlineRenderer } from '../src/render/inline'
import { criticallyDamped } from '../src/ui/motion'
import { loadArticle, rangeForText, textNodes } from './helpers'

const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let article: HTMLElement
let renderer: InlineRenderer

beforeEach(() => {
  article = loadArticle()
  renderer = new InlineRenderer({ document, shadowMode: 'open' })
})

afterEach(() => renderer.destroy())

describe('motion', () => {
  it('builds a critically damped curve that never overshoots', () => {
    const values = criticallyDamped().slice('linear('.length, -1).split(', ').map(Number)
    expect(values[0]).toBe(0)
    expect(values[values.length - 1]).toBe(1)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!)
      expect(values[i]!).toBeLessThanOrEqual(1)
    }
  })

  it('swaps with an animation and still lands on the rewrite', async () => {
    const mark = renderer.apply(
      rangeForText(article, 'heteroscedasticity'),
      { action: 'replace', transform: 'define', text: 'unequal spread' },
      { animate: true }
    )!
    await settle()
    expect(mark.anchor.textContent).toBe('unequal spread')
    expect(mark.anchor.querySelector('slot')).toBeNull()
  })

  it('restores exactly after an animated restore', async () => {
    const html = article.innerHTML
    const nodes = textNodes(article)
    const mark = renderer.apply(rangeForText(article, 'heteroscedasticity'), {
      action: 'replace',
      transform: 'define',
      text: 'unequal spread'
    })!
    renderer.restore(mark.id, { animate: true })
    expect(renderer.marks()).toHaveLength(0)
    await settle()
    expect(article.innerHTML).toBe(html)
    expect(textNodes(article)).toEqual(nodes)
  })

  it('survives a restore that interrupts the swap animation', async () => {
    const html = article.innerHTML
    const mark = renderer.apply(
      rangeForText(article, 'residuals'),
      { action: 'replace', transform: 'define', text: 'leftover errors' },
      { animate: true }
    )!
    renderer.restore(mark.id, { animate: true })
    await settle()
    expect(article.innerHTML).toBe(html)
  })
})
