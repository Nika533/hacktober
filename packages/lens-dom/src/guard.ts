import { LENS_LIMITS, type RenderAction } from '@hoot/core'
import { blockOf } from './blocks'
import { isElement } from './dom'
import type { BlockReason, RangeCheck } from './render/types'

export const MARK_TAG = 'hoot-lens-mark'
export const UI_TAG = 'hoot-lens-ui'

const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON'])
const HIDDEN_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE'])
const EMBEDDED_TAGS = new Set(['IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'VIDEO', 'AUDIO'])
const CODE_TAGS = new Set(['PRE', 'CODE', 'KBD', 'SAMP', 'TT'])
const QUOTE_TAGS = new Set(['BLOCKQUOTE', 'Q'])
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])
const FOREIGN_TAGS = new Set(['svg', 'math'])

function isEditable(element: Element): boolean {
  const html = element as HTMLElement
  if (html.isContentEditable === true) return true
  const attr = element.getAttribute('contenteditable')
  if (attr !== null && attr !== 'false') return true
  return EDITABLE_ROLES.has(element.getAttribute('role') ?? '')
}

export function elementReason(
  element: Element,
  action: RenderAction | undefined,
  contained: boolean
): BlockReason | null {
  const tag = element.tagName.toUpperCase()
  const local = element.localName
  if (local === MARK_TAG) return 'marked'
  if (local === UI_TAG) return 'lens-ui'
  if (CONTROL_TAGS.has(tag) || isEditable(element)) return 'editable'
  if (HIDDEN_TAGS.has(tag)) return 'hidden'
  if (element.hasAttribute('hidden') || element.hasAttribute('inert')) return 'hidden'
  if (element.getAttribute('aria-hidden') === 'true') return 'hidden'
  if (EMBEDDED_TAGS.has(tag) || FOREIGN_TAGS.has(local)) return 'embedded'
  if (CODE_TAGS.has(tag)) return 'code'
  if (QUOTE_TAGS.has(tag)) return 'quote'
  if (tag === 'A' && element.hasAttribute('href') && !(contained && action === 'gloss')) {
    return 'link'
  }
  return null
}

function boundaryReason(node: Node, action: RenderAction | undefined): BlockReason | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (!isElement(current)) continue
    const reason = elementReason(current, action, false)
    if (reason) return reason
  }
  return null
}

function innerReason(range: Range, action: RenderAction | undefined): BlockReason | null {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 1)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    const reason = elementReason(node as Element, action, true)
    if (reason) return reason
  }
  return null
}

const no = (reason: BlockReason): RangeCheck => ({ ok: false, reason })

export function checkRange(range: Range, action?: RenderAction): RangeCheck {
  if (range.collapsed) return no('collapsed')
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return no('detached')
  const text = range.toString()
  if (!text.trim()) return no('no-text')
  if (text.length > LENS_LIMITS.span) return no('too-long')
  const reason =
    boundaryReason(range.startContainer, action) ?? boundaryReason(range.endContainer, action)
  if (reason) return no(reason)
  if (blockOf(range.startContainer) !== blockOf(range.endContainer)) return no('multi-block')
  const inner = innerReason(range, action)
  return inner ? no(inner) : { ok: true }
}

export function isInsideLens(node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (isElement(current) && (current.localName === MARK_TAG || current.localName === UI_TAG)) {
      return true
    }
  }
  return false
}
