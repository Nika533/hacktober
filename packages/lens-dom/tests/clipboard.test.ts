import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CopyController, serializeRange, type CopyMode } from '../src/clipboard'
import { InlineRenderer } from '../src/render/inline'
import { findTextRange } from '../src/find'
import { loadArticle, rangeForText } from './helpers'

let article: HTMLElement
let renderer: InlineRenderer
let controller: CopyController
let mode: CopyMode

function copySelection(range: Range): { text: string | undefined; prevented: boolean } {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  const data = new DataTransfer()
  const event = new ClipboardEvent('copy', {
    bubbles: true,
    cancelable: true,
    clipboardData: data
  })
  document.body.dispatchEvent(event)
  return { text: data.getData('text/plain') || undefined, prevented: event.defaultPrevented }
}

beforeEach(() => {
  article = loadArticle()
  renderer = new InlineRenderer({ document, shadowMode: 'open' })
  mode = 'original'
  controller = new CopyController({
    document,
    mode: () => mode,
    visibleText: (host) => renderer.visibleText(host)
  })
})

afterEach(() => {
  controller.destroy()
  renderer.destroy()
})

describe('copy behaviour', () => {
  it('leaves copies without marks to the browser', () => {
    const result = copySelection(rangeForText(article, 'linear model'))
    expect(result).toEqual({ text: undefined, prevented: false })
  })

  const acrossMark = (): Range => {
    const p1 = article.querySelector('#p1')!
    const start = findTextRange(p1, 'shows')!
    const end = findTextRange(p1, ', and')!
    const range = document.createRange()
    range.setStart(start.startContainer, start.startOffset)
    range.setEnd(end.endContainer, end.endOffset)
    return range
  }

  it('copies the original text by default', () => {
    renderer.apply(rangeForText(article, 'heteroscedasticity'), {
      action: 'replace',
      transform: 'define',
      text: 'unequal spread'
    })
    const result = copySelection(acrossMark())
    expect(result.prevented).toBe(true)
    expect(result.text).toBe('shows heteroscedasticity, and')
  })

  it('copies what the reader sees in "visible" mode', () => {
    mode = 'visible'
    renderer.apply(rangeForText(article, 'heteroscedasticity'), {
      action: 'replace',
      transform: 'define',
      text: 'unequal spread'
    })
    expect(copySelection(acrossMark()).text).toBe('shows unequal spread, and')
  })

  it('includes an inline note in "visible" mode for glosses', () => {
    mode = 'visible'
    renderer.apply(rangeForText(article, 'OLS'), {
      action: 'gloss',
      transform: 'expand',
      text: 'ordinary least squares'
    })
    const p2 = article.querySelector('#p2')!
    const range = document.createRange()
    range.selectNodeContents(p2)
    expect(copySelection(range).text).toMatch(/^The OLS \(ordinary least squares\) estimator/)
  })

  it('collapses source whitespace but keeps block breaks', () => {
    const range = document.createRange()
    range.selectNodeContents(article.querySelector('#list')!)
    expect(serializeRange(range, () => null)).toBe(
      'Plot residuals against fitted values.\nRun the Breusch–Pagan test.'
    )
  })

  it('writes text through the copy event when the async clipboard is unavailable', async () => {
    let written: string | undefined
    document.addEventListener(
      'copy',
      (event) => {
        written = event.clipboardData?.getData('text/plain')
      },
      { once: true }
    )
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true
    })
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        const data = new DataTransfer()
        document.dispatchEvent(
          new ClipboardEvent('copy', { clipboardData: data, cancelable: true })
        )
        written = data.getData('text/plain')
        return true
      },
      configurable: true
    })
    expect(await controller.writeText('the rewrite')).toBe(true)
    expect(written).toBe('the rewrite')
  })
})
