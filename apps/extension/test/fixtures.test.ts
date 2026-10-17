import { checkRange, extractContext, findTextRange, languageOf } from '@hoot/lens-dom'
import { describe, expect, it } from 'vitest'
import article from '../fixtures/article.html?raw'
import codeAndInputs from '../fixtures/code-and-inputs.html?raw'
import foreign from '../fixtures/foreign.html?raw'
import frameChild from '../fixtures/frame-child.html?raw'
import highStakes from '../fixtures/high-stakes.html?raw'
import iframes from '../fixtures/iframes.html?raw'
import index from '../fixtures/index.html?raw'
import password from '../fixtures/password.html?raw'
import reactPage from '../fixtures/react/index.html?raw'

const PAGES: Record<string, string> = {
  'article.html': article,
  'code-and-inputs.html': codeAndInputs,
  'foreign.html': foreign,
  'frame-child.html': frameChild,
  'high-stakes.html': highStakes,
  'iframes.html': iframes,
  'password.html': password,
  'react/index.html': reactPage
}

function load(html: string): HTMLElement {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.title = parsed.title
  document.documentElement.lang = parsed.documentElement.lang
  document.body.innerHTML = parsed.body.innerHTML
  return document.body
}

const textRanges = (root: Element): Range[] => {
  const walker = document.createTreeWalker(root, 4)
  const ranges: Range[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const start = text.data.search(/\S/)
    if (start < 0) continue
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, text.data.trimEnd().length)
    ranges.push(range)
  }
  return ranges
}

describe('fixtures', () => {
  it('links every fixture from the index', () => {
    for (const page of Object.keys(PAGES).filter((name) => name !== 'frame-child.html')) {
      expect(index).toContain(`./${page}`)
    }
  })

  it('never lets Lens touch the protected content in code-and-inputs', () => {
    load(codeAndInputs)
    const protectedElements = Array.from(document.querySelectorAll('[data-lens-expect="never"]'))
    expect(protectedElements.length).toBeGreaterThanOrEqual(12)
    for (const element of protectedElements) {
      for (const range of textRanges(element)) {
        expect(checkRange(range, 'replace').ok, element.outerHTML.slice(0, 60)).toBe(false)
        expect(checkRange(range, 'gloss').ok, element.outerHTML.slice(0, 60)).toBe(false)
      }
    }
    expect(checkRange(findTextRange(document.body, 'heteroscedasticity')!).ok).toBe(true)
  })

  it.each([
    ['heteroscedasticity', 'Residuals that fan out'],
    ['OLS', 'Residuals that fan out'],
    ['Gauss–Markov conditions fail', 'A denser explanation'],
    ['variance inflation factor (VIF)', 'Multicollinearity'],
    ['Breusch–Pagan', 'What to try']
  ])('offers "%s" in the static article', (term, heading) => {
    load(article)
    const range = findTextRange(document.getElementById('article')!, term)!
    expect(checkRange(range, 'replace')).toEqual({ ok: true })
    expect(extractContext(range).headingPath.at(-1)).toBe(heading)
  })

  it('reports page and span languages on the foreign page', () => {
    load(foreign)
    const lang = (id: string): string => languageOf(document.getElementById(id)!.firstChild!)
    expect(lang('p-de')).toBe('de')
    expect(languageOf(document.querySelector('#p-fr span')!.firstChild!)).toBe('fr')
    expect(lang('p-es')).toBe('es')
    expect(lang('p-ar')).toBe('ar')
    expect(lang('p-en')).toBe('en')
  })

  it('gives the high-stakes page legal headings for the risk classifier', () => {
    load(highStakes)
    const context = extractContext(
      findTextRange(document.body, 'indemnify, defend and hold harmless')!
    )
    expect(context.title).toBe('Terms of Service — Example Analytics Inc.')
    expect(context.headingPath).toEqual(['Terms of Service', '7. Indemnification'])
  })

  it('has a password field on the password page and frames on the frames page', () => {
    load(password)
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
    load(iframes)
    expect(document.querySelectorAll('iframe')).toHaveLength(3)
    expect(document.querySelector('#srcdoc')?.getAttribute('srcdoc')).toContain('p-srcdoc')
  })

  it('keeps the whitespace edge cases in the static article', () => {
    expect(article).toContain('The   <b>OLS</b>  estimator&nbsp;is')
    expect(article).toMatch(/σ²ᵢ\t— not a constant σ²\.\n {2}Each observation {2}gets/)
  })
})
