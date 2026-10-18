import type { PageMark } from '@hoot/core'
import { UI_TAG } from '@hoot/lens-dom'

export const HIGHLIGHT_NAME = 'hoot-find'
const STYLE_ID = 'hoot-find-style'
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'input', UI_TAG])

/** One character of the page's text, folded for matching, and where it came from. */
interface Index {
  text: string
  at: Array<{ node: Text; offset: number }>
}

const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '\u00a0': ' '
}

const fold = (c: string): string => {
  const f = FOLD[c] ?? c.toLowerCase()
  return f.length === 1 ? f : c
}

/** The folded text of `root` with a map back to each character's text node. */
export function indexText(root: Element): Index {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.TEXT_NODE
          ? NodeFilter.FILTER_ACCEPT
          : SKIP.has((node as Element).localName)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP
    }
  )
  const index: Index = { text: '', at: [] }
  let space = true
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data
    for (let i = 0; i < data.length; i++) {
      const c = fold(data[i] ?? '')
      if (/\s/.test(c)) {
        if (space) continue
        space = true
        index.text += ' '
      } else {
        space = false
        index.text += c
      }
      index.at.push({ node, offset: i })
    }
  }
  return index
}

const normalize = (quote: string): string =>
  [...quote.trim()]
    .map(fold)
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^["']+|["']+$/g, '')
    .trim()

/** Ranges for each quote found on the page (case and quote style don't matter). */
export function findQuotes(root: Element, quotes: readonly string[]): Range[] {
  const index = indexText(root)
  const ranges: Range[] = []
  for (const quote of quotes) {
    const needle = normalize(quote)
    if (needle.length < 2) continue
    const start = index.text.indexOf(needle)
    if (start < 0) continue
    const first = index.at[start]
    const last = index.at[start + needle.length - 1]
    if (!first || !last) continue
    const range = root.ownerDocument.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset + 1)
    ranges.push(range)
  }
  return ranges
}

type HighlightCtor = new (...ranges: Range[]) => unknown
/** The CSS Custom Highlight API, typed loosely so it degrades where it's missing. */
type HighlightWindow = Window & {
  Highlight?: HighlightCtor
  CSS?: { highlights?: Map<string, unknown> }
}

/**
 * Show Hoot's passages on the page with the CSS Custom Highlight API (no DOM
 * changes besides one style element) and scroll to the first. An empty list
 * clears them. Returns how many were found.
 */
export function showMarks(doc: Document, marks: readonly PageMark[]): number {
  const win = doc.defaultView as HighlightWindow | null
  const registry = win?.CSS?.highlights
  const Highlight = win?.Highlight
  if (!registry || !Highlight || !doc.body) return 0
  registry.delete(HIGHLIGHT_NAME)
  if (marks.length === 0) return 0
  const ranges = findQuotes(
    doc.body,
    marks.map((m) => m.quote)
  )
  if (ranges.length === 0) return 0
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:rgba(56,189,248,.35);color:inherit;text-decoration:underline 2px rgba(14,116,144,.9);text-underline-offset:3px}@media (forced-colors:active){::highlight(${HIGHLIGHT_NAME}){background-color:Highlight;color:HighlightText}}`
    ;(doc.head ?? doc.documentElement).append(style)
  }
  registry.set(HIGHLIGHT_NAME, new Highlight(...ranges))
  const target = ranges[0]?.startContainer.parentElement
  const still = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  target?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
  return ranges.length
}
