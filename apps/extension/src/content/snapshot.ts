import { PAGE_LIMITS, type PageSnapshot } from '@hoot/core'
import { UI_TAG } from '@hoot/lens-dom'

/** What the content script reads; the service worker adds the tab and the site rules. */
export type PageRead = Omit<PageSnapshot, 'tab' | 'site'>

const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'textarea',
  'input',
  'select',
  'option',
  'head',
  UI_TAG
])
const BLOCKS =
  /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul|br)$/

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

const tidy = (text: string): string =>
  text
    .replace(/[ \t\f\r\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

function hidden(el: Element, win: Window): boolean {
  if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return true
  // Chrome's own check is much cheaper than a computed style per element.
  if (typeof el.checkVisibility === 'function') {
    return !el.checkVisibility({ visibilityProperty: true })
  }
  const style = win.getComputedStyle(el)
  return style.display === 'none' || style.visibility === 'hidden'
}

/**
 * The text of `root` in document order, blocks on their own lines. With
 * `viewport`, only elements that intersect it (what's on screen right now).
 * Hidden elements, form fields and Hoot's own UI are left out.
 */
export function readText(
  root: Element,
  win: Window,
  max: number,
  viewport?: { width: number; height: number }
): string {
  const doc = root.ownerDocument
  const onScreen = (el: Element): boolean => {
    if (!viewport) return true
    const r = el.getBoundingClientRect()
    // Zero-size wrappers (display: contents, inline roots) don't decide.
    if (r.width === 0 && r.height === 0) return true
    return r.bottom > 0 && r.right > 0 && r.top < viewport.height && r.left < viewport.width
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
      const el = node as Element
      if (SKIP.has(el.localName) || hidden(el, win) || !onScreen(el)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_SKIP
    }
  })
  let out = ''
  let block: Element | null = null
  for (let node = walker.nextNode(); node && out.length < max; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    if (!text.trim()) continue
    let parent = node.parentElement
    while (parent && parent !== root && !BLOCKS.test(parent.localName))
      parent = parent.parentElement
    if (block && parent !== block) out += '\n'
    block = parent
    out += text
  }
  return clip(tidy(out), max)
}

/** The main content, if the page marks it; else the body. */
const mainOf = (doc: Document): Element | null =>
  doc.querySelector('main, article, [role="main"]') ?? doc.body

/**
 * The page in front, as text: what's on screen, the selection, the main text
 * and the headings. A page with a password field is never read (`private`).
 */
export function readPage(doc: Document, win: Window): PageRead {
  const base = {
    url: clip(doc.location?.href ?? '', PAGE_LIMITS.urlChars),
    title: clip(doc.title.trim(), PAGE_LIMITS.titleChars),
    lang: (doc.documentElement.lang || '').slice(0, PAGE_LIMITS.langChars)
  }
  const empty = { selection: '', visible: '', text: '', headings: [] }
  if (doc.querySelector('input[type="password" i]')) {
    return { ...base, ...empty, blocked: 'private' }
  }
  const body = doc.body
  if (!body) return { ...base, ...empty, blocked: 'unreadable' }
  const viewport = { width: win.innerWidth, height: win.innerHeight }
  const main = mainOf(doc) ?? body
  const headings = [...doc.querySelectorAll('h1, h2, h3')]
    .filter((h) => !hidden(h, win))
    .map((h) => clip(tidy(h.textContent ?? '').replace(/\n/g, ' '), PAGE_LIMITS.headingChars))
    .filter(Boolean)
    .slice(0, PAGE_LIMITS.headings)
  return {
    ...base,
    selection: clip(tidy(win.getSelection()?.toString() ?? ''), PAGE_LIMITS.selectionChars),
    visible: readText(body, win, PAGE_LIMITS.visibleChars, viewport),
    text: readText(main, win, PAGE_LIMITS.textChars),
    headings,
    blocked: null
  }
}
