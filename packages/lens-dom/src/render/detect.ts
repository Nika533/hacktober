import { isInsideLens } from '../guard'

export const STRONG_MARKERS = [
  '[data-reactroot]',
  '#__next',
  '#__nuxt',
  '#___gatsby',
  '[data-v-app]',
  '[ng-version]',
  '[data-server-rendered]',
  '[data-sveltekit-hydrate]',
  '[data-svelte-h]',
  'astro-island',
  '[q\\:container]'
] as const

export const WEAK_MARKERS = ['#root', '#app', '[data-reactid]'] as const

export interface DynamicSignals {
  strong: string[]
  weak: string[]
  mutationsPerSecond: number
}

export const MUTATION_RATE_DYNAMIC = 8
export const MUTATION_RATE_WITH_WEAK_MARKER = 1

export function frameworkMarkers(doc: Document): { strong: string[]; weak: string[] } {
  const found = (selectors: readonly string[]): string[] =>
    selectors.filter((selector) => {
      try {
        return doc.querySelector(selector) !== null
      } catch {
        return false
      }
    })
  return { strong: found(STRONG_MARKERS), weak: found(WEAK_MARKERS) }
}

export function isDynamic(signals: DynamicSignals): boolean {
  if (signals.strong.length) return true
  if (signals.mutationsPerSecond >= MUTATION_RATE_DYNAMIC) return true
  return signals.weak.length > 0 && signals.mutationsPerSecond >= MUTATION_RATE_WITH_WEAK_MARKER
}

export interface DynamicPageDetectorOptions {
  document: Document
  windowMs?: number
  now?: () => number
}

export class DynamicPageDetector {
  readonly #doc: Document
  readonly #windowMs: number
  readonly #now: () => number
  #observer: MutationObserver | null = null
  #startedAt = 0
  #stoppedAt = 0
  #mutations = 0
  #forced = false

  constructor(options: DynamicPageDetectorOptions) {
    this.#doc = options.document
    this.#windowMs = options.windowMs ?? 3000
    this.#now = options.now ?? (() => Date.now())
  }

  start(): void {
    if (this.#observer) return
    const Observer = this.#doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
    if (!Observer) return
    this.#startedAt = this.#now()
    this.#observer = new Observer((records) => {
      for (const record of records) if (!isInsideLens(record.target)) this.#mutations++
      if (this.#now() - this.#startedAt >= this.#windowMs) this.stop()
    })
    this.#observer.observe(this.#doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    })
  }

  stop(): void {
    if (!this.#observer) return
    this.#observer.disconnect()
    this.#observer = null
    this.#stoppedAt = this.#now()
  }

  markDynamic(): void {
    this.#forced = true
  }

  signals(): DynamicSignals {
    const end = this.#observer ? this.#now() : this.#stoppedAt || this.#now()
    const seconds = Math.max((end - this.#startedAt) / 1000, 1)
    return { ...frameworkMarkers(this.#doc), mutationsPerSecond: this.#mutations / seconds }
  }

  get dynamic(): boolean {
    return this.#forced || isDynamic(this.signals())
  }
}
