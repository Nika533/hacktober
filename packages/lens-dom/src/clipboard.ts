import { isBlock } from './blocks'
import { isElement, isText } from './dom'
import { MARK_TAG, UI_TAG } from './guard'

export type CopyMode = 'original' | 'visible'

const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript'])
const KEEP_SPACES = new Set(['pre', 'pre-wrap', 'break-spaces'])

type Part = number | { text: string; collapse: boolean }

function join(parts: Part[]): string {
  let out = ''
  let pending = 0
  let softSpace = false
  for (const part of parts) {
    if (typeof part === 'number') {
      pending = Math.max(pending, part)
      continue
    }
    let { text } = part
    if (!text) continue
    if (pending) {
      if (part.collapse && !text.trim()) continue
      if (softSpace) out = out.replace(/ $/, '')
      if (out) out += '\n'.repeat(pending)
      pending = 0
      if (part.collapse) text = text.replace(/^ /, '')
    } else if (part.collapse && softSpace && out.endsWith(' ')) {
      text = text.replace(/^ /, '')
    }
    out += text
    softSpace = part.collapse
  }
  return out.replace(/^ | $/g, '')
}

export function serializeRange(
  range: Range,
  override: (element: Element) => string | null
): string {
  const parts: Part[] = []
  const view = (range.startContainer.ownerDocument ?? document).defaultView
  const whiteSpace = (node: Node): string => {
    const parent = node.parentElement
    return parent && view?.getComputedStyle ? view.getComputedStyle(parent).whiteSpace : 'normal'
  }
  const text = (node: Text): void => {
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    let data = node.data.slice(start, end)
    const mode = whiteSpace(node)
    const collapse = !KEEP_SPACES.has(mode)
    if (mode === 'pre-line') data = data.replace(/[\t\r\f ]+/g, ' ')
    else if (collapse) data = data.replace(/[\t\n\r\f ]+/g, ' ')
    parts.push({ text: data, collapse })
  }
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!range.intersectsNode(child)) continue
      if (isText(child)) {
        text(child)
        continue
      }
      if (!isElement(child) || child.localName === UI_TAG || SKIP_TAGS.has(child.localName)) {
        continue
      }
      const replaced = override(child)
      if (replaced !== null) {
        parts.push({ text: replaced, collapse: true })
        continue
      }
      if (child.localName === 'br') {
        parts.push({ text: '\n', collapse: false })
        continue
      }
      const weight = isBlock(child) ? (child.localName === 'p' ? 2 : 1) : 0
      if (weight) parts.push(weight)
      walk(child)
      if (weight) parts.push(weight)
    }
  }
  const root = range.commonAncestorContainer
  if (isText(root)) text(root)
  else walk(root)
  return join(parts)
}

export function marksIn(range: Range): Element[] {
  const root = range.commonAncestorContainer
  const scope = isElement(root) ? root : root.parentElement
  const hosts: Element[] = []
  for (let node: Node | null = root; node; node = node.parentNode) {
    if (isElement(node) && node.localName === MARK_TAG) hosts.push(node)
  }
  if (scope) {
    for (const host of Array.from(scope.querySelectorAll(MARK_TAG))) {
      if (range.intersectsNode(host)) hosts.push(host)
    }
  }
  return hosts
}

export interface CopyControllerOptions {
  document: Document
  mode: () => CopyMode
  visibleText: (host: Element) => string | null
}

export class CopyController {
  readonly #doc: Document
  readonly #options: CopyControllerOptions
  #pending: string | null = null

  constructor(options: CopyControllerOptions) {
    this.#doc = options.document
    this.#options = options
    this.#doc.addEventListener('copy', this.#onCopy, true)
  }

  async writeText(text: string): Promise<boolean> {
    try {
      await this.#doc.defaultView?.navigator.clipboard.writeText(text)
      return true
    } catch {
      this.#pending = text
      try {
        return this.#doc.execCommand?.('copy') ?? false
      } finally {
        this.#pending = null
      }
    }
  }

  destroy(): void {
    this.#doc.removeEventListener('copy', this.#onCopy, true)
  }

  #onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return
    if (this.#pending !== null) {
      event.clipboardData.setData('text/plain', this.#pending)
      event.preventDefault()
      return
    }
    const visible = this.#options.mode() === 'visible'
    const textOf = (host: Element): string =>
      (visible ? this.#options.visibleText(host) : null) ?? host.textContent ?? ''
    const selection = this.#doc.getSelection()
    const host = event
      .composedPath()
      .find(
        (node): node is Element =>
          isElement(node as Node) && (node as Element).localName === MARK_TAG
      )
    if (host && (!selection || selection.isCollapsed)) {
      event.clipboardData.setData('text/plain', textOf(host))
      event.preventDefault()
      return
    }
    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    if (!marksIn(range).length) return
    const text = serializeRange(range, (element) =>
      visible && element.localName === MARK_TAG ? this.#options.visibleText(element) : null
    )
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
  }
}
