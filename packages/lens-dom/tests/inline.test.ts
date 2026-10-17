import { beforeEach, describe, expect, it } from 'vitest'
import { InlineRenderer, MARK_TAG } from '../src/render/inline'
import type { MarkSpec } from '../src/render/types'
import { loadArticle, rangeAcross, rangeForText, seeded, shadowOf, textNodes } from './helpers'

const define: MarkSpec = {
  action: 'replace',
  transform: 'define',
  text: 'heteroscedasticity (when the spread of errors changes across values)'
}

let article: HTMLElement
let renderer: InlineRenderer

beforeEach(() => {
  article = loadArticle()
  renderer = new InlineRenderer({ document, shadowMode: 'open' })
})

function snapshot(): { html: string; nodes: Text[] } {
  return { html: article.innerHTML, nodes: textNodes(article) }
}

function expectExact(before: { html: string; nodes: Text[] }): void {
  expect(article.innerHTML).toBe(before.html)
  const after = textNodes(article)
  expect(after).toHaveLength(before.nodes.length)
  after.forEach((node, index) => expect(node).toBe(before.nodes[index]))
}

describe('InlineRenderer: replace', () => {
  it('swaps the selected term for the rewrite and marks it', () => {
    const range = rangeForText(article, 'heteroscedasticity')
    const mark = renderer.apply(range, define)
    expect(mark).not.toBeNull()
    expect(mark!.original).toBe('heteroscedasticity')
    const host = article.querySelector(MARK_TAG)!
    expect(host.getAttribute('data-hoot-lens')).toBe(mark!.id)
    const shadow = shadowOf(host)
    expect(shadow.querySelector('mark')?.textContent).toBe(define.text)
    expect(shadow.querySelector('slot')).toBeNull()
    expect(mark!.anchor.tabIndex).toBe(0)
    expect(mark!.anchor.getAttribute('aria-describedby')).toBe('hoot-lens-desc')
    expect(shadow.getElementById('hoot-lens-desc')?.textContent).toBe(
      'Defined by Hoot. Original: heteroscedasticity. Press Enter for options.'
    )
  })

  it('keeps the original text in the light DOM so page text is unchanged', () => {
    const before = article.textContent
    renderer.apply(rangeForText(article, 'heteroscedasticity'), define)
    expect(article.textContent).toBe(before)
  })

  it('restores exactly, including node identity', () => {
    const before = snapshot()
    const mark = renderer.apply(rangeForText(article, 'the usual standard errors'), {
      action: 'replace',
      transform: 'simplify',
      text: 'the normal error estimates'
    })
    expect(article.innerHTML).not.toBe(before.html)
    expect(renderer.restore(mark!.id)).toBe(true)
    expectExact(before)
    expect(renderer.restore(mark!.id)).toBe(false)
    expect(renderer.marks()).toHaveLength(0)
  })

  it('treats the rewrite as text, never as markup', () => {
    const mark = renderer.apply(rangeForText(article, 'residuals'), {
      action: 'replace',
      transform: 'define',
      text: '<img src=x onerror="alert(1)">'
    })
    const shadow = shadowOf(article.querySelector(MARK_TAG)!)
    expect(shadow.querySelector('img')).toBeNull()
    expect(mark!.anchor.textContent).toBe('<img src=x onerror="alert(1)">')
  })

  it('handles a range that crosses into an inline element', () => {
    const p2 = article.querySelector('#p2')!
    const first = p2.firstChild as Text
    const boldText = p2.querySelector('b')!.firstChild as Text
    const before = snapshot()
    const mark = renderer.apply(rangeAcross(first, 3, boldText, 2), {
      action: 'replace',
      transform: 'simplify',
      text: 'the OL'
    })
    expect(mark!.original).toBe('   OL')
    expect(article.querySelectorAll(MARK_TAG)).toHaveLength(2)
    renderer.restore(mark!.id)
    expectExact(before)
  })

  it('preserves whitespace exactly: nbsp, runs of spaces, tabs and newlines', () => {
    const before = snapshot()
    const p3 = article.querySelector('#p3')!
    const text = p3.firstChild as Text
    const start = text.data.indexOf('σ²ᵢ')
    const end = text.data.indexOf('gets')
    const expected = text.data.slice(start, end)
    const mark = renderer.apply(rangeAcross(text, start, text, end), {
      action: 'replace',
      transform: 'unpack',
      text: 'each one has its own spread'
    })
    expect(mark!.original).toBe(expected)
    expect(mark!.original).toMatch(/\t[^\n]+\n {2}Each observation {2}$/)
    renderer.restore(mark!.id)
    expectExact(before)
  })
})

describe('InlineRenderer: gloss', () => {
  it('keeps the original visible and appends an inline note for a term', () => {
    const mark = renderer.apply(rangeForText(article, 'heteroscedasticity'), {
      action: 'gloss',
      transform: 'define',
      text: '(when the spread of errors changes)'
    })
    const shadow = shadowOf(article.querySelector(MARK_TAG)!)
    expect(shadow.querySelector('mark slot')).not.toBeNull()
    const gloss = shadow.querySelector('.gloss')!
    expect(gloss.textContent).toBe(' (when the spread of errors changes)')
    expect(gloss.getAttribute('data-placement')).toBe('inline')
    expect(mark!.anchor.tagName).toBe('MARK')
  })

  it('places a sentence gloss beneath the sentence', () => {
    renderer.apply(rangeForText(article, 'the usual standard errors are no longer trustworthy'), {
      action: 'gloss',
      transform: 'simplify',
      text: 'the normal error estimates can be wrong'
    })
    const shadow = shadowOf(article.querySelector(MARK_TAG)!)
    expect(shadow.querySelector('.gloss')?.getAttribute('data-placement')).toBe('block')
  })
})

describe('InlineRenderer: Phase 0 exit criterion', () => {
  const blocks = ['#p1', '#p2', '#p3', '#p4', '#list']

  it('round-trips 300 random ranges exactly', () => {
    const random = seeded(533)
    for (let i = 0; i < 300; i++) {
      article = loadArticle()
      const block = article.querySelector(blocks[i % blocks.length]!)!
      const nodes = textNodes(block).filter((node) => node.length > 0)
      const a = nodes[Math.floor(random() * nodes.length)]!
      const b = nodes[Math.floor(random() * nodes.length)]!
      const [startNode, endNode] =
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? [b, a] : [a, b]
      let startOffset = Math.floor(random() * (startNode.length + 1))
      let endOffset = Math.floor(random() * (endNode.length + 1))
      if (startNode === endNode && startOffset > endOffset) {
        ;[startOffset, endOffset] = [endOffset, startOffset]
      }
      const range = rangeAcross(startNode, startOffset, endNode, endOffset)
      const expectedOriginal = range.toString()
      const before = snapshot()
      const mark = renderer.apply(range, {
        action: random() < 0.5 ? 'replace' : 'gloss',
        transform: 'simplify',
        text: 'rewritten'
      })
      if (!expectedOriginal.trim()) {
        expect(mark).toBeNull()
        expectExact(before)
        continue
      }
      expect(mark?.original).toBe(expectedOriginal)
      renderer.restore(mark!.id)
      expectExact(before)
    }
  })

  it('restores several marks in any order exactly', () => {
    const random = seeded(42)
    const terms = ['linear model', 'residuals', 'fan out', 'fitted values', 'standard errors']
    for (let round = 0; round < 20; round++) {
      article = loadArticle()
      const before = snapshot()
      const ids = terms.map(
        (term) =>
          renderer.apply(rangeForText(article, term), {
            action: 'replace',
            transform: 'define',
            text: term.toUpperCase()
          })!.id
      )
      ids.sort(() => random() - 0.5)
      for (const id of ids) renderer.restore(id)
      expectExact(before)
    }
  })

  it('restores adjacent marks that split the same text node', () => {
    const before = snapshot()
    const first = renderer.apply(rangeForText(article, 'When you'), define)!
    const second = renderer.apply(rangeForText(article, ' fit'), define)!
    renderer.restore(first.id)
    renderer.restore(second.id)
    expectExact(before)
  })

  it('restoreAll returns the page to its original state', () => {
    const before = snapshot()
    renderer.apply(rangeForText(article, 'OLS'), define)
    renderer.apply(rangeForText(article, 'Breusch–Pagan'), define)
    expect(renderer.restoreAll()).toBe(2)
    expectExact(before)
  })
})
