import { describeMark } from '../copy'
import { el } from '../dom'
import { stripWrappingParens, wordCount } from '../text'
import { MARK_CSS, StyleSheets } from '../ui/styles'
import { containedRoots, normalizeRange, siblingRuns, type SplitPair } from './split'
import type { DropListener, GlossPlacement, Mark, MarkSpec, RangeCheck, Renderer } from './types'

export const MARK_TAG = 'hoot-lens-mark'
const INLINE_GLOSS_MAX_WORDS = 5

interface Segment {
  host: HTMLElement
  shadow: ShadowRoot
  nodes: Node[]
}

interface Entry {
  mark: InlineMark
  segments: Segment[]
}

class InlineMark implements Mark {
  constructor(
    readonly id: string,
    readonly spec: MarkSpec,
    readonly original: string,
    readonly anchor: HTMLElement,
    readonly hosts: readonly HTMLElement[]
  ) {}

  rects(): DOMRect[] {
    return this.hosts.flatMap((host) => Array.from(host.getClientRects()))
  }
}

export interface InlineRendererOptions {
  document: Document
  shadowMode?: ShadowRootMode
}

export class InlineRenderer implements Renderer {
  readonly kind = 'inline'
  readonly #doc: Document
  readonly #mode: ShadowRootMode
  readonly #styles: StyleSheets
  readonly #entries = new Map<string, Entry>()
  readonly #hosts = new WeakSet<Node>()
  readonly #dropListeners = new Set<DropListener>()
  #pending: SplitPair[] = []
  #seq = 0

  constructor(options: InlineRendererOptions) {
    this.#doc = options.document
    this.#mode = options.shadowMode ?? 'closed'
    this.#styles = new StyleSheets(this.#doc)
  }

  check(range: Range): RangeCheck {
    if (range.collapsed) return { ok: false, reason: 'collapsed' }
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) {
      return { ok: false, reason: 'detached' }
    }
    if (!range.toString().trim()) return { ok: false, reason: 'no-text' }
    return { ok: true }
  }

  apply(range: Range, spec: MarkSpec): Mark | null {
    if (!this.check(range).ok) return null
    const original = range.toString()
    const { range: normalized, splits } = normalizeRange(range)
    this.#pending.push(...splits)
    const runs = siblingRuns(containedRoots(normalized))
    if (!runs.length) {
      this.#mergePending()
      return null
    }
    const id = `inline-${++this.#seq}`
    const segments = runs.map((nodes) => this.#wrap(nodes, id))
    const anchor = this.#render(segments, spec, original)
    const mark = new InlineMark(
      id,
      spec,
      original,
      anchor,
      segments.map((segment) => segment.host)
    )
    this.#entries.set(id, { mark, segments })
    return mark
  }

  restore(id: string): boolean {
    const entry = this.#entries.get(id)
    if (!entry) return false
    this.#entries.delete(id)
    this.#unwrap(entry)
    this.#mergePending()
    return true
  }

  restoreAll(): number {
    const ids = [...this.#entries.keys()].reverse()
    for (const id of ids) this.restore(id)
    return ids.length
  }

  get(id: string): Mark | undefined {
    return this.#entries.get(id)?.mark
  }

  marks(): Mark[] {
    return [...this.#entries.values()].map((entry) => entry.mark)
  }

  onDrop(listener: DropListener): () => void {
    this.#dropListeners.add(listener)
    return () => this.#dropListeners.delete(listener)
  }

  destroy(): void {
    this.restoreAll()
    this.#dropListeners.clear()
  }

  #wrap(nodes: Node[], id: string): Segment {
    const first = nodes[0]
    const parent = first?.parentNode
    if (!first || !parent) throw new Error('lens-dom: cannot wrap a detached node')
    const host = this.#doc.createElement(MARK_TAG)
    host.dataset.hootLens = id
    parent.insertBefore(host, first)
    for (const node of nodes) host.appendChild(node)
    const shadow = host.attachShadow({ mode: this.#mode })
    this.#styles.apply(shadow, MARK_CSS)
    this.#hosts.add(host)
    return { host, shadow, nodes }
  }

  #render(segments: Segment[], spec: MarkSpec, original: string): HTMLElement {
    const doc = this.#doc
    let anchor: HTMLElement | null = null
    for (const [index, segment] of segments.entries()) {
      const primary = index === 0
      if (spec.action === 'replace') {
        if (!primary) continue
        anchor = el(doc, 'mark', { text: spec.text })
        segment.shadow.append(anchor)
        continue
      }
      const mark = el(doc, 'mark')
      mark.append(doc.createElement('slot'))
      segment.shadow.append(mark)
      if (primary) anchor = mark
      if (index === segments.length - 1) {
        segment.shadow.append(this.#gloss(spec, glossPlacement(spec, original)))
      }
    }
    const first = segments[0]
    if (!anchor || !first) throw new Error('lens-dom: nothing to render')
    first.shadow.append(
      el(doc, 'span', {
        text: describeMark(spec, original),
        attrs: { id: 'hoot-lens-desc', hidden: '' }
      })
    )
    anchor.tabIndex = 0
    anchor.setAttribute('aria-describedby', 'hoot-lens-desc')
    return anchor
  }

  #gloss(spec: MarkSpec, placement: GlossPlacement): HTMLElement {
    const text = stripWrappingParens(spec.text)
    return el(this.#doc, 'span', {
      className: 'gloss',
      text: placement === 'inline' ? ` (${text})` : text,
      attrs: { 'data-placement': placement }
    })
  }

  #unwrap(entry: Entry): void {
    for (const { host } of entry.segments) {
      this.#hosts.delete(host)
      const parent = host.parentNode
      if (!parent) continue
      while (host.firstChild) parent.insertBefore(host.firstChild, host)
      host.remove()
    }
  }

  #mergePending(): void {
    let progress = true
    while (progress) {
      progress = false
      for (let i = this.#pending.length - 1; i >= 0; i--) {
        const pair = this.#pending[i]
        if (!pair) continue
        const { head, tail } = pair
        if (!head.parentNode && !tail.parentNode) {
          this.#pending.splice(i, 1)
          continue
        }
        const wrapped =
          this.#hosts.has(head.parentNode as Node) || this.#hosts.has(tail.parentNode as Node)
        if (wrapped || !head.parentNode || head.nextSibling !== tail) continue
        head.appendData(tail.data)
        tail.remove()
        this.#pending.splice(i, 1)
        for (const other of this.#pending) if (other.head === tail) other.head = head
        progress = true
      }
    }
  }
}

function glossPlacement(spec: MarkSpec, original: string): GlossPlacement {
  return spec.placement ?? (wordCount(original) <= INLINE_GLOSS_MAX_WORDS ? 'inline' : 'block')
}
