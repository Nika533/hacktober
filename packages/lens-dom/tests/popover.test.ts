import { beforeEach, expect, it, vi } from 'vitest'
import { InlineRenderer } from '../src/render/inline'
import { Popover } from '../src/ui/popover'
import { UI_TAG, createUiRoot } from '../src/ui/root'
import { loadArticle, rangeForText, shadowOf, textNodes } from './helpers'

let article: HTMLElement

beforeEach(() => {
  document.documentElement.querySelectorAll(UI_TAG).forEach((node) => node.remove())
  article = loadArticle()
})

it('shows the exact original and restores the page from the Restore button', () => {
  const renderer = new InlineRenderer({ document, shadowMode: 'open' })
  const root = createUiRoot({ document, shadowMode: 'open' })
  const restore = vi.fn((mark) => renderer.restore(mark.id))
  const popover = new Popover(root, { restore })
  const html = article.innerHTML
  const nodes = textNodes(article)

  const mark = renderer.apply(rangeForText(article, 'estimator\u00a0is still unbiased'), {
    action: 'replace',
    transform: 'simplify',
    text: 'method still gets it right on average'
  })!
  popover.show(mark)

  const shadow = shadowOf(document.documentElement.querySelector(UI_TAG)!)
  const dialog = shadow.querySelector('[role="dialog"]') as HTMLElement
  expect(dialog.hidden).toBe(false)
  expect(dialog.querySelector('.original')?.textContent).toBe('estimator\u00a0is still unbiased')

  ;(dialog.querySelector('[data-action="restore"]') as HTMLButtonElement).click()
  expect(restore).toHaveBeenCalledOnce()
  expect(dialog.hidden).toBe(true)
  expect(article.innerHTML).toBe(html)
  expect(textNodes(article)).toEqual(nodes)
})
