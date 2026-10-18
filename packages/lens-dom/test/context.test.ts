import { LENS_LIMITS } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import { clampText, extractContext, headingPath, languageOf, windowAround } from '../src/context'
import { InlineRenderer } from '../src/render/inline'
import { loadArticle, rangeForText } from './helpers'

describe('extractContext', () => {
  it('collects span, paragraph, heading path, title and lang', () => {
    const article = loadArticle()
    const context = extractContext(rangeForText(article, 'heteroscedasticity'))
    expect(context).toEqual({
      span: 'heteroscedasticity',
      paragraph:
        'When you fit a linear model, look at the residuals. If they fan out as the fitted values grow, the model shows heteroscedasticity, and the usual standard errors are no longer trustworthy.',
      headingPath: ['Reading regression output', 'Residuals'],
      title: 'Reading regression output',
      lang: 'en'
    })
  })

  it('tracks the nearest h1 to h3 chain', () => {
    const article = loadArticle()
    expect(headingPath(rangeForText(article, 'own variance'))).toEqual([
      'Reading regression output',
      'Residuals',
      'Notation'
    ])
    document.body.insertAdjacentHTML('beforeend', '<h2>Diagnostics</h2><p id="late">later text</p>')
    expect(headingPath(rangeForText(document.getElementById('late')!, 'later'))).toEqual([
      'Reading regression output',
      'Diagnostics'
    ])
  })

  it('normalizes whitespace and reads the paragraph through existing marks', () => {
    const article = loadArticle()
    const renderer = new InlineRenderer({ document })
    renderer.apply(rangeForText(article, 'OLS'), {
      action: 'replace',
      transform: 'expand',
      text: 'ordinary least squares'
    })
    const context = extractContext(rangeForText(article, 'still unbiased'))
    expect(context.paragraph).toBe(
      'The OLS estimator is still unbiased, but it is no longer BLUE; weighted least squares or heteroscedasticity-consistent (HC3) errors fix the inference.'
    )
    renderer.destroy()
  })

  it('prefers the closest lang attribute', () => {
    document.body.innerHTML = '<p lang="fr-CA">Le <span>modèle</span></p>'
    document.documentElement.lang = 'en'
    expect(languageOf(document.querySelector('span')!.firstChild!)).toBe('fr-CA')
    expect(languageOf(document.body)).toBe('en')
  })

  it('caps the span at 600 and windows the paragraph around it', () => {
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ')
    document.body.innerHTML = `<p id="long">${words}</p>`
    const text = document.getElementById('long')!.firstChild as Text
    const middle = words.indexOf('w300')
    const range = document.createRange()
    range.setStart(text, middle)
    range.setEnd(text, middle + 'w300 w301'.length)
    const context = extractContext(range)
    expect(context.span).toBe('w300 w301')
    expect(context.paragraph.length).toBeLessThanOrEqual(LENS_LIMITS.paragraph)
    expect(context.paragraph).toContain('w300 w301')
    expect(context.paragraph.startsWith('…')).toBe(true)
    expect(context.paragraph.endsWith('…')).toBe(true)

    range.setStart(text, 0)
    range.setEnd(text, text.length)
    expect(extractContext(range).span.length).toBeLessThanOrEqual(LENS_LIMITS.span)
  })
})

describe('text helpers', () => {
  it('clamps at a word boundary with an ellipsis', () => {
    expect(clampText('one two three four', 12)).toBe('one two…')
    expect(clampText('short', 12)).toBe('short')
  })

  it('keeps the span whole inside the window', () => {
    const text = `${'a '.repeat(50)}TARGET${' b'.repeat(50)}`
    const windowed = windowAround(text, 'TARGET', 40)
    expect(windowed).toContain('TARGET')
    expect(windowed.length).toBeLessThanOrEqual(42)
  })
})
