import { blockOf } from '../blocks'
import { describeMark } from '../copy'
import { el } from '../dom'
import { findTextRange } from '../find'
import { MARK_TAG, checkRange } from '../guard'
import { normalizeWhitespace, stripWrappingParens, wordCount } from '../text'
import { MARK_CSS, StyleSheets } from '../ui/styles'
import { containedRoots, normalizeRange, siblingRuns, type SplitPair } from './split'
import type {
  GlossPlacement,
  Mark,
  MarkSpec,
  RangeCheck,
  Renderer,
  RendererEvent,
  RendererListener
} from './types'

const INLINE_GLOSS_MAX_WORDS = 5
const MAX_REAPPLIES = 3
const MAX_DROPPED = 24

interface Segment {
  host: HTMLElement
  shadow: ShadowRoot
  nodes: Node[]
  text: string
}

interface Entry {
  mark: InlineMark
  segments: Segment[]
  block: Element | null
  blockText: string
  reapplies: number
}

interface Dropped {
  id: string
  spec: MarkSpec
  original: string
  scope: Element | null
  blockText: string
  reapplies: number
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
  reapplyDelayMs?: number
}

export class InlineRenderer implements Renderer {
  readonly kind = 'inline'
  readonly #doc: Document
  readonly #mode: ShadowRootMode
  readonly #styles: StyleSheets
  readonly #reapplyDelay: number
  readonly #entries = new Map<string, Entry>()
  readonly #hosts = new WeakSet<Node>()
  readonly #listeners = new Set<RendererListener>()
  #pending: SplitPair[] = []
  #dropped: Dropped[] = []
  #observer: MutationObserver | null = null
  #reapplyTimer: ReturnType<typeof setTimeout> | null = null
  #seq = 0

  constructor(options: InlineRendererOptions) {
    this.#doc = options.document
    this.#mode = options.shadowMode ?? 'closed'
    this.#styles = new StyleSheets(this.#doc)
    this.#reapplyDelay = options.reapplyDelayMs ?? 100
  }

  check(range: Range, spec?: MarkSpec): RangeCheck {
    return checkRange(range, spec?.action)
  }

  apply(range: Range, spec: MarkSpec): Mark | null {
    return this.#apply(range, spec, 0)?.mark ?? null
  }

  restore(id: string): boolean {
    const entry = this.#entries.get(id)
    if (!entry) return false
    this.#entries.delete(id)
    this.#unwrap(entry)
    this.#mergePending()
    this.#syncObserver()
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

  subscribe(listener: RendererListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  destroy(): void {
    this.restoreAll()
    this.#dropped = []
    if (this.#reapplyTimer) clearTimeout(this.#reapplyTimer)
    this.#observer?.disconnect()
    this.#observer = null
    this.#listeners.clear()
  }

  #apply(range: Range, spec: MarkSpec, reapplies: number): Entry | null {
    if (!this.check(range, spec).ok) return null
    const original = range.toString()
    const block = blockOf(range.startContainer)
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
    const entry: Entry = {
      mark,
      segments,
      block,
      blockText: normalizeWhitespace(block?.textContent ?? ''),
      reapplies
    }
    this.#entries.set(id, entry)
    this.#syncObserver()
    return entry
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
    return { host, shadow, nodes, text: host.textContent ?? '' }
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

  #syncObserver(): void {
    const needed = this.#entries.size > 0 || this.#dropped.length > 0
    if (needed && !this.#observer) {
      const Observer = this.#doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
      if (!Observer) return
      this.#observer = new Observer(() => this.#onMutations())
      this.#observer.observe(this.#doc.body ?? this.#doc.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      })
    } else if (!needed && this.#observer) {
      this.#observer.disconnect()
      this.#observer = null
    }
  }

  #onMutations(): void {
    for (const entry of [...this.#entries.values()]) {
      if (!isIntact(entry)) this.#drop(entry)
    }
    if (this.#dropped.length && !this.#reapplyTimer) {
      this.#reapplyTimer = setTimeout(() => {
        this.#reapplyTimer = null
        this.#reapply()
      }, this.#reapplyDelay)
    }
  }

  #drop(entry: Entry): void {
    const { mark } = entry
    this.#entries.delete(mark.id)
    this.#unwrap(entry)
    this.#mergePending()
    if (entry.reapplies < MAX_REAPPLIES) {
      const scope = entry.block?.isConnected ? entry.block : (entry.block?.parentElement ?? null)
      this.#dropped.push({
        id: mark.id,
        spec: mark.spec,
        original: mark.original,
        scope,
        blockText: entry.blockText,
        reapplies: entry.reapplies + 1
      })
      if (this.#dropped.length > MAX_DROPPED) this.#dropped.shift()
    }
    this.#emit({ type: 'dropped', mark })
    this.#syncObserver()
  }

  #reapply(): void {
    const remaining: Dropped[] = []
    for (const dropped of this.#dropped) {
      const entry = this.#findAndApply(dropped)
      if (entry) this.#emit({ type: 'reapplied', mark: entry.mark, previousId: dropped.id })
      else remaining.push(dropped)
    }
    this.#dropped = remaining
    this.#syncObserver()
  }

  #findAndApply(dropped: Dropped): Entry | null {
    const root = dropped.scope?.isConnected ? dropped.scope : this.#doc.body
    if (!root) return null
    const candidates = [root, ...Array.from(root.querySelectorAll('*'))]
    for (const candidate of candidates) {
      if (blockOf(candidate) !== candidate && candidate !== root) continue
      if (normalizeWhitespace(candidate.textContent ?? '') !== dropped.blockText) continue
      const range = findTextRange(candidate, dropped.original)
      if (!range || blockOf(range.startContainer) !== candidate) continue
      const entry = this.#apply(range, dropped.spec, dropped.reapplies)
      if (entry) return entry
    }
    return null
  }

  #emit(event: RendererEvent): void {
    for (const listener of this.#listeners) listener(event)
  }
}

function isIntact(entry: Entry): boolean {
  return entry.segments.every(
    ({ host, nodes, text }) =>
      host.isConnected &&
      host.childNodes.length === nodes.length &&
      nodes.every((node, index) => host.childNodes[index] === node) &&
      host.textContent === text
  )
}

function glossPlacement(spec: MarkSpec, original: string): GlossPlacement {
  return spec.placement ?? (wordCount(original) <= INLINE_GLOSS_MAX_WORDS ? 'inline' : 'block')
}
