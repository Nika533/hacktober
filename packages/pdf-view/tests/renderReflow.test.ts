import { describe, expect, it } from 'vitest'
import { renderReflow } from '../src/renderReflow'

describe('renderReflow', () => {
  it('renders sections per page with semantic headings', () => {
    const article = renderReflow(
      [
        { kind: 'heading', level: 2, text: 'Title', page: 1 },
        { kind: 'paragraph', text: 'Intro.', page: 1 },
        { kind: 'heading', level: 3, text: 'Part two', page: 2 },
        { kind: 'paragraph', text: 'More.', page: 2 }
      ],
      2
    )
    const sections = [...article.querySelectorAll('section')]
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Page 1 of 2',
      'Page 2 of 2'
    ])
    expect(sections.map((s) => s.dataset.page)).toEqual(['1', '2'])
    expect([...article.querySelectorAll('h2, h3, p')].map((e) => e.tagName)).toEqual([
      'H2',
      'P',
      'H3',
      'P'
    ])
  })

  it('treats PDF text as text, never markup', () => {
    const article = renderReflow(
      [{ kind: 'paragraph', text: '<img src=x onerror=alert(1)> & <b>bold</b>', page: 1 }],
      1
    )
    expect(article.querySelector('img, b')).toBeNull()
    expect(article.querySelector('p')?.textContent).toBe(
      '<img src=x onerror=alert(1)> & <b>bold</b>'
    )
  })

  it('explains an empty (scanned) document', () => {
    const article = renderReflow([], 3)
    expect(article.textContent).toContain('no selectable text')
  })
})
