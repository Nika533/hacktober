import { blockOf } from './blocks'
import { isElement, ownerDocument } from './dom'
import { normalizeWhitespace } from './text'

export const SPAN_MAX = 600
export const PARAGRAPH_MAX = 1500
const HEADING_MAX = 120
const TITLE_MAX = 200
const ELLIPSIS = '…'

export interface PageContext {
  span: string
  paragraph: string
  headingPath: string[]
  title: string
  lang: string
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space >= max * 0.5 ? cut.slice(0, space) : cut}${ELLIPSIS}`
}

export function windowAround(text: string, span: string, max: number): string {
  if (text.length <= max) return text
  const index = span ? text.indexOf(span) : -1
  if (index < 0) return clampText(text, max)
  const room = Math.max(max - span.length - 2, 0)
  let start = Math.max(0, index - Math.floor(room / 2))
  let end = Math.min(text.length, start + span.length + room)
  start = Math.max(0, end - span.length - room)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < index) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > index + span.length) end = space
  }
  return `${start > 0 ? ELLIPSIS : ''}${text.slice(start, end)}${end < text.length ? ELLIPSIS : ''}`
}

function precedes(node: Node, range: Range): boolean {
  return range.comparePoint(node, 0) < 0 || node.contains(range.startContainer)
}

export function headingPath(range: Range): string[] {
  const doc = ownerDocument(range.startContainer)
  const stack: Array<{ level: number; text: string }> = []
  for (const heading of Array.from(doc.querySelectorAll('h1, h2, h3'))) {
    if (!precedes(heading, range)) break
    const level = Number(heading.tagName.slice(1))
    const text = clampText(normalizeWhitespace(heading.textContent ?? ''), HEADING_MAX)
    if (!text) continue
    while (stack.length && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop()
    stack.push({ level, text })
  }
  return stack.map((heading) => heading.text)
}

export function languageOf(node: Node): string {
  const element = isElement(node) ? node : node.parentElement
  const lang =
    element?.closest('[lang]')?.getAttribute('lang') ??
    ownerDocument(node).documentElement.getAttribute('lang') ??
    ''
  return lang.trim()
}

export function extractContext(range: Range): PageContext {
  const doc = ownerDocument(range.startContainer)
  const span = clampText(normalizeWhitespace(range.toString()), SPAN_MAX)
  const block = blockOf(range.startContainer)
  const paragraph = windowAround(
    normalizeWhitespace(block?.textContent ?? span),
    span.endsWith(ELLIPSIS) ? span.slice(0, -1) : span,
    PARAGRAPH_MAX
  )
  return {
    span,
    paragraph,
    headingPath: headingPath(range),
    title: clampText(normalizeWhitespace(doc.title ?? ''), TITLE_MAX),
    lang: languageOf(range.startContainer)
  }
}
