import type { ReflowBlock } from './reflow'

/**
 * Renders reflowed blocks as plain semantic HTML (sections per page, h2/h3,
 * p). Text nodes only, never innerHTML, so PDF text can't inject markup.
 * The result is ordinary selectable DOM that lens-dom's inline renderer can
 * work on directly.
 */
export function renderReflow(
  blocks: readonly ReflowBlock[],
  pageCount: number,
  doc: Document = document
): HTMLElement {
  const article = doc.createElement('article')
  article.className = 'hoot-pdf-reflow'
  const sections = new Map<number, HTMLElement>()
  const sectionFor = (page: number): HTMLElement => {
    let s = sections.get(page)
    if (!s) {
      s = doc.createElement('section')
      s.className = 'hoot-pdf-reflow__page'
      s.dataset.page = String(page)
      s.setAttribute('aria-label', `Page ${page} of ${pageCount}`)
      sections.set(page, s)
      article.append(s)
    }
    return s
  }
  for (const b of blocks) {
    const el = doc.createElement(b.kind === 'heading' ? `h${b.level}` : 'p')
    el.textContent = b.text
    sectionFor(b.page).append(el)
  }
  if (blocks.length === 0) {
    const p = doc.createElement('p')
    p.className = 'hoot-pdf-reflow__empty'
    p.textContent =
      'This PDF has no selectable text (it may be a scan), so it can’t be shown as text.'
    article.append(p)
  }
  return article
}
