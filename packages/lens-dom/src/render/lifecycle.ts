import { blockOf } from '../blocks'
import { findTextRange } from '../find'
import { normalizeWhitespace } from '../text'
import type { Mark, MarkSpec, RendererEvent, RendererListener } from './types'

export const MAX_REAPPLIES = 3
const MAX_REMEMBERED = 24

export interface Remembered {
  id: string
  spec: MarkSpec
  original: string
  scope: Element | null
  blockText: string
  reapplies: number
}

export function blockTextOf(block: Element | null): string {
  return normalizeWhitespace(block?.textContent ?? '')
}

export function remember(
  mark: Mark,
  block: Element | null,
  blockText: string,
  reapplies: number
): Remembered {
  return {
    id: mark.id,
    spec: mark.spec,
    original: mark.original,
    scope: block?.isConnected ? block : (block?.parentElement ?? null),
    blockText,
    reapplies: reapplies + 1
  }
}

export function locate(doc: Document, item: Remembered): Range | null {
  const root = item.scope?.isConnected ? item.scope : doc.body
  if (!root) return null
  const candidates = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const candidate of candidates) {
    if (candidate !== root && blockOf(candidate) !== candidate) continue
    if (normalizeWhitespace(candidate.textContent ?? '') !== item.blockText) continue
    const range = findTextRange(candidate, item.original)
    if (range && blockOf(range.startContainer) === candidate) return range
  }
  return null
}

export class Lifecycle {
  readonly #doc: Document
  readonly #delay: number
  readonly #active: () => boolean
  readonly #onCheck: () => void
  readonly #onReapply: (item: Remembered) => Mark | null
  readonly #listeners = new Set<RendererListener>()
  #remembered: Remembered[] = []
  #observer: MutationObserver | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: {
    document: Document
    delayMs: number
    active: () => boolean
    check: () => void
    reapply: (item: Remembered) => Mark | null
  }) {
    this.#doc = options.document
    this.#delay = options.delayMs
    this.#active = options.active
    this.#onCheck = options.check
    this.#onReapply = options.reapply
  }

  subscribe(listener: RendererListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  emit(event: RendererEvent): void {
    for (const listener of this.#listeners) listener(event)
  }

  dropped(mark: Mark, item: Remembered): void {
    if (item.reapplies <= MAX_REAPPLIES) {
      this.#remembered.push(item)
      if (this.#remembered.length > MAX_REMEMBERED) this.#remembered.shift()
    }
    this.emit({ type: 'dropped', mark })
    this.sync()
  }

  sync(): void {
    const needed = this.#active() || this.#remembered.length > 0
    if (needed && !this.#observer) {
      const Observer = this.#doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
      if (!Observer) return
      this.#observer = new Observer(() => this.#mutated())
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

  destroy(): void {
    this.#remembered = []
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#observer?.disconnect()
    this.#observer = null
    this.#listeners.clear()
  }

  #mutated(): void {
    this.#onCheck()
    if (!this.#remembered.length || this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#reapply()
    }, this.#delay)
  }

  #reapply(): void {
    const remaining: Remembered[] = []
    for (const item of this.#remembered) {
      const mark = this.#onReapply(item)
      if (mark) this.emit({ type: 'reapplied', mark, previousId: item.id })
      else remaining.push(item)
    }
    this.#remembered = remaining
    this.sync()
  }
}
