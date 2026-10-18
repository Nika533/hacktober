import { afterEach, describe, expect, it } from 'vitest'
import { ReadingTracker, rarityOf } from '../src/signals'

describe('rarityOf (s6)', () => {
  it('scores notation as jargon', () => {
    expect(rarityOf('Var(εᵢ | Xᵢ) = σ²ᵢ', 'en')).toBe(1)
    expect(rarityOf('n × p matrix', 'en')).toBe(1)
    expect(rarityOf('∑ residuals', 'en')).toBe(1)
  })

  it('scores acronyms, less so inside longer spans', () => {
    expect(rarityOf('OLS', 'en')).toBeCloseTo(0.8)
    expect(rarityOf('HC3', 'en')).toBeCloseTo(0.8)
    expect(rarityOf('the APIs', 'en')).toBeCloseTo(0.8)
    expect(rarityOf('OLS and VIF', 'en')).toBeCloseTo(0.8)
    const sentence = 'The OLS estimator is still unbiased but it is no longer the best one'
    expect(rarityOf(sentence, 'en')).toBeCloseTo((0.8 * 3) / 14)
  })

  it('gives ordinary words 0 until the frequency lists land', () => {
    expect(rarityOf('heteroscedasticity', 'en')).toBe(0)
    expect(rarityOf('I', 'en')).toBe(0)
    expect(rarityOf('Paris', 'en')).toBe(0)
    expect(rarityOf('', 'en')).toBe(0)
  })

  it('reads Greek as words on Greek pages and ignores acronyms in all-caps text', () => {
    expect(rarityOf('καλημέρα', 'el')).toBe(0)
    expect(rarityOf('καλημέρα', 'en')).toBe(1)
    expect(rarityOf('NOTE', 'en', 'NOTE: READ THE TERMS BEFORE YOU SIGN')).toBe(0)
  })
})

describe('ReadingTracker (s5)', () => {
  let tracker: ReadingTracker | null = null

  afterEach(() => {
    tracker?.destroy()
    window.scrollTo(0, 0)
    document.body.innerHTML = ''
  })

  function paragraphAt(top: number): Range {
    const p = document.createElement('p')
    p.textContent = 'A paragraph.'
    document.body.append(p)
    p.getBoundingClientRect = () => new DOMRect(0, top - window.scrollY, 600, 40)
    const range = document.createRange()
    range.selectNodeContents(p)
    return range
  }

  const scroll = (y: number): void => {
    window.scrollTo(0, y)
    window.dispatchEvent(new Event('scroll'))
  }

  it('flags a paragraph the reader scrolled back up to', () => {
    tracker = new ReadingTracker(document)
    const early = paragraphAt(100)
    const later = paragraphAt(2000)
    expect(tracker.reread(early)).toBe(0)
    scroll(1500)
    expect(tracker.reread(later)).toBe(0)
    scroll(0)
    expect(tracker.reread(early)).toBe(1)
    expect(tracker.reread(later)).toBe(0)
  })
})
