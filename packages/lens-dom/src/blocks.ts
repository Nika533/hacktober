import { isElement } from './dom'

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BODY',
  'CAPTION',
  'DD',
  'DETAILS',
  'DIALOG',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HTML',
  'LEGEND',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TD',
  'TH',
  'TR',
  'UL'
])

const INLINE_DISPLAYS = new Set(['inline', 'contents', 'ruby', 'ruby-text'])

export function isBlock(element: Element): boolean {
  const display = element.ownerDocument.defaultView?.getComputedStyle?.(element).display
  if (display) return !INLINE_DISPLAYS.has(display)
  return BLOCK_TAGS.has(element.tagName)
}

export function blockOf(node: Node): Element | null {
  let current: Node | null = isElement(node) ? node : node.parentNode
  while (current && isElement(current)) {
    if (isBlock(current)) return current
    current = current.parentNode
  }
  return null
}
